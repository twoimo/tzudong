declare var google: any;
import { useEffect, useRef, useState, memo, useCallback, useMemo } from "react";
import { ErrorBoundary } from "react-error-boundary";
import { useGoogleMaps } from "@/hooks/use-google-maps";
import { useRestaurants } from "@/hooks/use-restaurants";
import { Restaurant, Region } from "@/types/restaurant";
import { FilterState } from "@/components/filters/FilterPanel";
import { ReviewModal } from "@/components/reviews/ReviewModal";
import { RestaurantDetailPanel } from "@/components/restaurant/RestaurantDetailPanel";
import { Loader2 } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { Badge } from "@/components/ui/badge";
import { MapSkeleton } from "@/components/skeletons/MapSkeleton";

// 국가별 지도 중심 좌표
const SEOUL_CENTER = { lat: 37.5665, lng: 126.9780 };
const USA_CENTER = { lat: 39.8283, lng: -98.5795 };
const INITIAL_ZOOM = 12;
const USA_ZOOM = 4;
const COUNTRY_CENTERS: Record<string, { lat: number; lng: number; zoom: number }> = {
  "미국": { lat: 39.8283, lng: -98.5795, zoom: 5 },
  "일본": { lat: 35.1815, lng: 136.9066, zoom: 10 }, // 나고야시 중심으로 변경
  "대만": { lat: 25.0330, lng: 121.5654, zoom: 10 }, // 타이베이 중심
  "태국": { lat: 13.7563, lng: 100.5018, zoom: 11 }, // 방콕 중심으로 확대
  "인도네시아": { lat: -6.9667, lng: 110.4167, zoom: 7 }, // 줌아웃 -3
  "튀르키예": { lat: 41.0082, lng: 28.9784, zoom: 11 }, // 이스탄불 더 확대
  "헝가리": { lat: 47.4979, lng: 19.0402, zoom: 11 }, // 줌인 +3
  "오스트레일리아": { lat: -33.8688, lng: 151.2093, zoom: 10 }, // 시드니 중심으로 변경
};

interface MapViewProps {
  filters: FilterState;
  selectedCountry?: string | null;
  searchedRestaurant?: Restaurant | null;
  selectedRestaurant?: Restaurant | null;
  refreshTrigger?: number;
  onAdminAddRestaurant?: () => void;
  onAdminEditRestaurant?: (restaurant: Restaurant) => void;
  onRestaurantSelect?: (restaurant: Restaurant | null) => void;
  onMapReady?: (moveToRestaurant: (restaurant: Restaurant) => void) => void;
  onRequestEditRestaurant?: (restaurant: Restaurant) => void;
  // [패널 관리] 마커 클릭, 패널 닫기 등 콜백
  onMarkerClick?: (restaurant: Restaurant) => void;
  // [동적 레이아웃] 패널 너비에 따른 지도 중심 오프셋 계산용
  panelWidth?: number;
  activePanel?: 'map' | 'detail' | 'control';
  onPanelClick?: (panel: 'map' | 'detail' | 'control') => void;
  isPanelOpen?: boolean;
  onPanelClose?: () => void;
  onTogglePanelCollapse?: () => void;
}

// 에러 바운더리용 폴백 컴포넌트
const MapErrorFallback = ({ error, resetErrorBoundary }: { error: Error; resetErrorBoundary: () => void }) => (
  <div className="flex items-center justify-center h-full bg-muted">
    <div className="text-center space-y-4">
      <div className="text-6xl">🚨</div>
      <div className="space-y-2">
        <h2 className="text-2xl font-bold text-destructive">
          지도 로딩 실패
        </h2>
        <p className="text-muted-foreground">
          지도를 불러오는데 문제가 발생했습니다.
        </p>
        <div className="text-sm text-muted-foreground space-y-1">
          <p>🔧 오류: {error.message}</p>
        </div>
        <button
          onClick={resetErrorBoundary}
          className="px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90"
        >
          다시 시도
        </button>
      </div>
    </div>
  </div>
);

const MapView = memo(({ filters, selectedCountry, searchedRestaurant, selectedRestaurant, refreshTrigger, onAdminAddRestaurant, onAdminEditRestaurant, onRestaurantSelect, onMapReady, onRequestEditRestaurant, onMarkerClick, panelWidth: propPanelWidth, activePanel, onPanelClick, isPanelOpen: propIsPanelOpen, onPanelClose, onTogglePanelCollapse }: MapViewProps) => {
  // 필터 객체 메모이제이션
  const memoizedFilters = useMemo(() => filters, [filters]);
  const { user } = useAuth();
  const mapRef = useRef<HTMLDivElement>(null);
  const googleMapRef = useRef<any | null>(null);
  const markersRef = useRef<any[]>([]);
  const detailPanelRef = useRef<HTMLDivElement>(null);

  // [상태] 지도 이동 - 선택된 맛집으로 이동 (한 번만 수행)
  const lastCenteredRestaurantId = useRef<string | null>(null);

  // 패널 상태 관리 (내부적으로 관리하거나 props로 제어)
  const [mapBounds, setMapBounds] = useState<any | null>(null);
  const [isReviewModalOpen, setIsReviewModalOpen] = useState(false);
  const [hasUserInteracted, setHasUserInteracted] = useState(false);
  const [panelWidth, setPanelWidth] = useState(0);
  const [showRestaurantCount, setShowRestaurantCount] = useState(false);
  const [localIsPanelOpen, setLocalIsPanelOpen] = useState(false);

  // props로 전달된 isPanelOpen이 있으면 우선 사용, 없으면 로컬 상태 사용
  const isPanelOpen = propIsPanelOpen !== undefined ? propIsPanelOpen : localIsPanelOpen;
  const setIsPanelOpen = (isOpen: boolean) => {
    if (onTogglePanelCollapse) {
      onTogglePanelCollapse();
    } else {
      setLocalIsPanelOpen(isOpen);
    }
  };

  // props로 전달된 panelWidth가 있으면 우선 사용
  const effectivePanelWidth = propPanelWidth !== undefined ? propPanelWidth : panelWidth;


  // 맛집으로 지도 이동하는 함수 (즉시 실행, 재시도 없음)
  const moveToRestaurant = useCallback((restaurant: Restaurant) => {
    if (!googleMapRef.current) {

      return;
    }

    const position = { lat: Number(restaurant.lat), lng: Number(restaurant.lng) };

    try {
      // 패널이 열리면서 지도 크기가 변했을 수 있으므로 리사이즈 트리거
      google.maps.event.trigger(googleMapRef.current, "resize");

      googleMapRef.current.panTo(position);
      googleMapRef.current.setZoom(14); // 줌 레벨 14로 조정
    } catch (error) {
      console.error('MapView: Error moving to restaurant position:', error);
    }
  }, []);

  // Google Maps API 로드
  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || "";
  const { isLoaded, loadError } = useGoogleMaps({ apiKey });

  // ResizeObserver로 패널 너비 추적 (내부 패널이 있는 경우만)
  useEffect(() => {
    // props로 panelWidth가 전달되면 ResizeObserver 불필요
    if (propPanelWidth !== undefined || !detailPanelRef.current) return;

    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setPanelWidth(entry.contentRect.width);
      }
    });

    resizeObserver.observe(detailPanelRef.current);

    return () => {
      resizeObserver.disconnect();
    };
  }, [propPanelWidth]);

  // 외부 콜백에 지도 이동 함수 전달
  useEffect(() => {
    if (onMapReady) {
      // 부모 컴포넌트에 지도 이동 함수를 전달
      onMapReady(moveToRestaurant);
    }
  }, [onMapReady, moveToRestaurant]);

  // 검색된 맛집으로 지도 이동 (정확히 중앙)
  useEffect(() => {
    if (!searchedRestaurant || !isLoaded || !googleMapRef.current) {
      return;
    }

    const lat = Number(searchedRestaurant.lat);
    const lng = Number(searchedRestaurant.lng);

    if (isNaN(lat) || isNaN(lng)) {
      return;
    }

    const position = { lat, lng };

    try {
      if (!googleMapRef.current) return;

      // 지도 리사이즈 인식
      google.maps.event.trigger(googleMapRef.current, "resize");

      // 정확히 중앙에 배치 (오프셋 없음)
      googleMapRef.current.panTo(position);
      googleMapRef.current.setZoom(14);

      // 검색된 맛집 선택 상태로 설정
      if (onRestaurantSelect) {
        onRestaurantSelect(searchedRestaurant);
      }
    } catch (error) {
      console.error('MapView: Error moving to searched restaurant position:', error);
    }
  }, [searchedRestaurant, onRestaurantSelect, isLoaded]);

  // [지도 이동] 선택된 맛집으로 이동 (한 번만 수행)
  useEffect(() => {
    if (!selectedRestaurant || !mapRef.current || !isLoaded) return;

    // 이미 이 맛집으로 이동했다면 건너뛰기 (사용자가 지도를 움직일 수 있게 함)
    // 단, selectedRestaurant 객체가 아예 바뀌었더라도 ID가 같다면 이동하지 않음
    if (lastCenteredRestaurantId.current === selectedRestaurant.id) {
      return;
    }

    const lat = Number(selectedRestaurant.lat);
    const lng = Number(selectedRestaurant.lng);

    if (isNaN(lat) || isNaN(lng)) {
      return;
    }

    try {
      const map = googleMapRef.current;
      const bounds = map.getBounds();
      if (!bounds) return;

      // 지도의 실제 너비 계산
      const mapWidth = mapRef.current?.offsetWidth || 0;
      const sidebarWidth = 0; // GlobalMapPage에는 사이드바 없음

      // 경도 범위 계산
      const lngSpan = bounds.getNorthEast().lng() - bounds.getSouthWest().lng();

      // 오른쪽 패널이 차지하는 경도 범위
      const rightPanelLngSpan = lngSpan * (effectivePanelWidth / mapWidth);

      // 왼쪽 사이드바가 차지하는 경도 범위
      const leftSidebarLngSpan = lngSpan * (sidebarWidth / mapWidth);

      // 오프셋 계산: 오른쪽으로 이동 - 왼쪽으로 이동
      const offset = (rightPanelLngSpan / 2) - (leftSidebarLngSpan / 2);

      // 조정된 경도
      const adjustedLng = lng + offset;

      // 지도 이동
      map.panTo({ lat, lng: adjustedLng });

      // 이동 완료 표시
      lastCenteredRestaurantId.current = selectedRestaurant.id;
    } catch (error) {
      console.error('MapView: Error moving to selected restaurant:', error);
    }
  }, [selectedRestaurant, isLoaded, effectivePanelWidth]);

  // 선택 해제 시 ref 초기화
  useEffect(() => {
    if (!selectedRestaurant) {
      lastCenteredRestaurantId.current = null;
    }
  }, [selectedRestaurant]);

  // useRestaurants 옵션 메모이제이션
  const restaurantsOptions = useMemo(() => ({
    bounds: mapBounds ? {
      south: mapBounds.getSouthWest().lat(),
      west: mapBounds.getSouthWest().lng(),
      north: mapBounds.getNorthEast().lat(),
      east: mapBounds.getNorthEast().lng(),
    } : undefined,
    category: memoizedFilters.categories.length > 0 ? memoizedFilters.categories : undefined,
    region: selectedCountry as Region || undefined, // 선택된 국가가 있을 때만 필터링
    minReviews: memoizedFilters.minReviews,
    enabled: isLoaded && !!selectedCountry, // 선택된 국가가 있을 때만 활성화
  }), [mapBounds, memoizedFilters, selectedCountry, isLoaded]);

  const { data: restaurants = [], isLoading: isLoadingRestaurants, refetch } = useRestaurants(restaurantsOptions);

  // 맛집 개수 표시 자동 숨김 처리
  useEffect(() => {
    if (restaurants.length > 0 && !isLoadingRestaurants) {
      setShowRestaurantCount(true);
      const timer = setTimeout(() => {
        setShowRestaurantCount(false);
      }, 3000);
      return () => clearTimeout(timer);
    }
  }, [restaurants, isLoadingRestaurants]);

  // 마커를 표시할 맛집 목록 (기존 restaurants + 검색된 맛집)
  const restaurantsToShow = useMemo(() => {
    const result = [...restaurants];

    // 검색된 맛집이 기존 목록에 없는 경우 추가
    if (searchedRestaurant) {
      // 병합된 데이터의 경우
      let alreadyExists = false;
      if (searchedRestaurant.mergedRestaurants && searchedRestaurant.mergedRestaurants.length > 0) {
        const mergedIds = searchedRestaurant.mergedRestaurants.map(r => r.id);
        alreadyExists = restaurants.some(r => mergedIds.includes(r.id));
      } else {
        alreadyExists = restaurants.some(r => r.id === searchedRestaurant.id);
      }

      if (!alreadyExists) {
        result.push(searchedRestaurant);
      }
    }

    return result;
  }, [restaurants, searchedRestaurant]);


  // [데이터 갱신] refreshTrigger 변경 시 재조회 (리뷰 작성 등)
  useEffect(() => {
    if (refreshTrigger) {
      refetch();
    }
  }, [refreshTrigger, refetch]);


  // refreshTrigger 변경 시 선택된 레스토랑 정보 업데이트
  useEffect(() => {
    if (selectedRestaurant) {
      // 업데이트된 레스토랑 정보 찾기
      const updatedRestaurant = restaurants.find(r => r.id === selectedRestaurant.id);
      if (updatedRestaurant) {
        // selectedRestaurant 업데이트 (외부 상태 동기화)
        onRestaurantSelect?.(updatedRestaurant);
      }
      // [수정] 화면 밖으로 벗어나서 리스트에 없더라도 패널을 닫지 않음
      // else if (!updatedRestaurant) {
      //   onRestaurantSelect?.(null);
      // }
    }
  }, [restaurants, refreshTrigger, selectedRestaurant, onRestaurantSelect]);


  // [지도 초기화] Google Maps 인스턴스 생성
  useEffect(() => {
    if (!isLoaded || !mapRef.current) {
      return;
    }

    // [유효성 검사] Google Maps API 로드 확인
    if (!window.google || !window.google.maps || !window.google.maps.Map) {
      return;
    }

    // 선택된 국가에 따라 중심점과 줌 설정 (기본값: 미국)
    const countryConfig = selectedCountry && COUNTRY_CENTERS[selectedCountry];
    const center = countryConfig ? { lat: countryConfig.lat, lng: countryConfig.lng } : USA_CENTER;
    const zoom = countryConfig ? countryConfig.zoom : USA_ZOOM;

    try {
      const map = new google.maps.Map(mapRef.current, {
        center: center,
        zoom: zoom,
        mapId: "tzudong-map",
        disableDefaultUI: false,
        zoomControl: true,
        mapTypeControl: false,
        streetViewControl: false,
        fullscreenControl: false,
      });

      googleMapRef.current = map;

      // [이동 감지] 지도 이동 종료 시 경계값 업데이트
      map.addListener("idle", () => {
        const bounds = map.getBounds();
        if (bounds) {
          setMapBounds(bounds);
          // 첫 번째 idle 이벤트에서 사용자 상호작용으로 간주
          setHasUserInteracted(true);
        }
      });
    } catch (error) {
      console.error("Error creating Google Map:", error);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoaded]);

  // [국가 변경] 선택된 국가에 따라 지도 중심 및 줌 레벨 조정
  useEffect(() => {
    if (!googleMapRef.current || !selectedCountry) return;

    // 검색된 맛집이 있으면 국가 중심으로 이동하지 않음 (검색 이동 로직이 우선)
    // 단, 검색된 맛집이 현재 선택된 국가와 다를 수 있으므로 주의 필요하지만,
    // handleRestaurantSearch에서 이미 국가를 맞춰주므로 여기서는 이동만 막으면 됨
    if (searchedRestaurant) return;

    const countryConfig = COUNTRY_CENTERS[selectedCountry];
    if (countryConfig) {
      googleMapRef.current.setCenter({ lat: countryConfig.lat, lng: countryConfig.lng });
      googleMapRef.current.setZoom(countryConfig.zoom);
    }
  }, [selectedCountry, searchedRestaurant]);

  // [재시도 로직] 지도 로드 실패 시 재시도 (API 지연 로드 대응)
  useEffect(() => {
    if (!isLoaded && window.google && window.google.maps && window.google.maps.Map && mapRef.current && !googleMapRef.current) {
      // 강제 재로드 실행
      setTimeout(() => {
        window.location.reload();
      }, 500);
    }
  }, [isLoaded]);

  // [마커 관리] 맛집 데이터 변경 시 마커 업데이트
  useEffect(() => {
    if (!googleMapRef.current || !isLoaded) return;

    // 기존 마커 제거 (메모리 누수 방지)
    markersRef.current.forEach(marker => {
      marker.map = null;
    });
    markersRef.current = [];

    // 새 마커 생성
    restaurantsToShow.forEach((restaurant) => {
      // selectedRestaurant 또는 searchedRestaurant와 비교하여 선택 상태 판단
      const isSelected = selectedRestaurant?.id === restaurant.id || searchedRestaurant?.id === restaurant.id;



      // 카테고리별 적절한 이모티콘으로 변경
      const getCategoryIcon = (categories: string | string[] | null | undefined) => {
        // categories가 null이나 undefined면 기본값
        if (!categories) return '⭐';

        // categories가 배열이면 첫 번째 값 사용, 아니면 그대로 사용
        const categoryStr = Array.isArray(categories) ? categories[0] : categories;

        const imageMap: { [key: string]: string } = {
          '고기': '/images/maker-images/meat_bbq.png',
          '치킨': '/images/maker-images/chicken.png',
          '한식': '/images/maker-images/korean.png',
          '중식': '/images/maker-images/chinese.png',
          '일식': '/images/maker-images/cutlet_sashimi.png',
          '양식': '/images/maker-images/western.png',
          '분식': '/images/maker-images/snack_bar.png',
          '카페·디저트': '/images/maker-images/cafe_dessert.png',
          '아시안': '/images/maker-images/asian.png',
          '패스트푸드': '/images/maker-images/fastfood.png',
          '족발·보쌈': '/images/maker-images/pork_feet.png',
          '돈까스·회': '/images/maker-images/cutlet_sashimi.png',
          '피자': '/images/maker-images/pizza.png',
          '찜·탕': '/images/maker-images/stew.png',
          '야식': '/images/maker-images/late_night.png',
          '도시락': '/images/maker-images/lunch_box.png'
        };
        return imageMap[categoryStr] || '/images/maker-images/korean.png'; // 기본값
      };

      const imagePath = getCategoryIcon(restaurant.categories);

      // 선택된 마커는 더 큰 크기와 강조 효과
      const markerSize = isSelected ? 42 : 32;

      const markerElement = document.createElement("div");
      markerElement.className = `custom-marker ${isSelected ? 'selected-marker' : ''}`;
      markerElement.innerHTML = `
        <div style="
          position: relative;
          width: ${markerSize}px;
          height: ${markerSize}px;
          cursor: pointer;
          transition: all 0.3s ease;
          filter: drop-shadow(0 2px 5px rgba(0, 0, 0, 0.3));
        " class="${isSelected ? 'animate-bounce' : ''} hover:scale-125">
          <img src="${imagePath}" alt="${restaurant.name}" style="width: 100%; height: 100%; object-fit: contain;" draggable="false" />
        </div>
      `;

      const marker = new google.maps.marker.AdvancedMarkerElement({
        map: googleMapRef.current,
        position: { lat: Number(restaurant.lat), lng: Number(restaurant.lng) },
        content: markerElement,
        title: restaurant.name,
      });

      markerElement.addEventListener("click", () => {


        // 1. 패널을 먼저 즉시 열기 (지도 이동 전에)
        onMarkerClick?.(restaurant);


        // 2. selectedRestaurant 업데이트
        onRestaurantSelect?.(restaurant);


        // 3. 지도 이동은 마지막에 (비동기 작업)
        moveToRestaurant(restaurant);

      });

      markersRef.current.push(marker);
    });
  }, [restaurants, isLoaded, onRestaurantSelect, onMarkerClick]);

  // 선택된 마커의 스타일을 실시간 업데이트 (줌 이벤트 시 애니메이션 유지)
  useEffect(() => {
    if (!isLoaded || markersRef.current.length === 0 || !restaurantsToShow) return;



    markersRef.current.forEach((marker, index) => {
      const restaurant = restaurantsToShow[index];
      if (!restaurant) {
        return;
      }

      // selectedRestaurant 또는 searchedRestaurant와 비교하여 활성화 상태 결정
      const isSelected = selectedRestaurant?.id === restaurant.id || searchedRestaurant?.id === restaurant.id;



      const markerElement = marker.content as HTMLElement;
      if (!markerElement) return;

      const innerDiv = markerElement.querySelector('div');
      if (!innerDiv) return;

      // 크기 업데이트
      const markerSize = isSelected ? 42 : 32;
      innerDiv.style.width = `${markerSize}px`;
      innerDiv.style.height = `${markerSize}px`;

      // 애니메이션 클래스 업데이트
      if (isSelected) {
        innerDiv.classList.add('animate-bounce');
      } else {
        innerDiv.classList.remove('animate-bounce');
      }
    });
  }, [selectedRestaurant?.id, searchedRestaurant?.id, restaurantsToShow, isLoaded]);

  // 줌 이벤트 시 마커 스타일 유지
  useEffect(() => {
    if (!googleMapRef.current || !isLoaded) return;

    const handleZoomChange = () => {
      // 줌 변경 후 약간의 지연을 주어 마커 스타일 재적용
      setTimeout(() => {
        if (!isLoaded || markersRef.current.length === 0) return;

        markersRef.current.forEach((marker, index) => {
          const restaurant = restaurantsToShow[index];
          if (!restaurant) return;

          const isSelected = selectedRestaurant?.id === restaurant.id || searchedRestaurant?.id === restaurant.id;
          const markerElement = marker.content as HTMLElement;
          if (!markerElement) return;

          const innerDiv = markerElement.querySelector('div');
          if (!innerDiv) return;

          // 크기 업데이트
          const markerSize = isSelected ? 42 : 32;
          innerDiv.style.width = `${markerSize}px`;
          innerDiv.style.height = `${markerSize}px`;

          // 애니메이션 클래스 업데이트
          if (isSelected) {
            innerDiv.classList.add('animate-bounce');
          } else {
            innerDiv.classList.remove('animate-bounce');
          }
        });
      }, 100);
    };

    // 줌 변경 이벤트 리스너 추가
    const zoomListener = googleMapRef.current.addListener('zoom_changed', handleZoomChange);

    return () => {
      if (zoomListener) {
        google.maps.event.removeListener(zoomListener);
      }
    };
  }, [isLoaded, selectedRestaurant?.id, restaurantsToShow]);

  if (loadError) {
    return (
      <div className="flex items-center justify-center h-full bg-muted">
        <div className="text-center space-y-4">
          <div className="text-6xl">❌</div>
          <div className="space-y-2">
            <h2 className="text-2xl font-bold text-destructive">
              구글 지도 로딩 실패
            </h2>
            <p className="text-muted-foreground">
              Google Maps API를 불러오는데 실패했습니다.
            </p>
            <div className="text-sm text-muted-foreground space-y-1">
              <p>🔧 해결 방법:</p>
              <p>1. Google Cloud Console에서 API 키 확인</p>
              <p>2. Application restrictions → HTTP referrers 설정</p>
              <p>3. 다음 도메인 추가: <code className="bg-muted px-1 rounded">localhost:8080/*</code></p>
              <p>4. Maps JavaScript API 활성화 확인</p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!isLoaded) {
    return <MapSkeleton />;
  }

  // API 키가 없으면 에러 표시
  if (!apiKey) {
    return (
      <div className="flex items-center justify-center h-full bg-muted">
        <div className="text-center space-y-4">
          <div className="text-6xl">🔑</div>
          <div className="space-y-2">
            <h2 className="text-2xl font-bold text-destructive">
              Google Maps API 키 필요
            </h2>
            <p className="text-muted-foreground">
              .env 파일에 NEXT_PUBLIC_GOOGLE_MAPS_API_KEY를 설정해주세요.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <ErrorBoundary FallbackComponent={MapErrorFallback}>
      <div className="relative w-full h-full flex">
        {/* Map container */}
        <div
          ref={mapRef}
          className="flex-1 h-full"
          onClick={() => {
            // 지도 클릭 시 패널 닫기/모드 변경 등의 동작이 필요하다면 여기서 처리
            // 단, 드래그 시에는 발생하지 않아야 함.
            // onPanelClick?.('map');
          }}
        />


        {/* Loading indicator */}
        {isLoadingRestaurants && (
          <div className="absolute top-4 left-1/2 -translate-x-1/2 bg-card border border-border rounded-lg px-4 py-2 shadow-lg flex items-center gap-2 z-10">
            <Loader2 className="h-4 w-4 animate-spin text-primary" />
            <span className="text-sm font-medium">맛집 로딩 중...</span>
          </div>
        )}

        {/* Restaurant count */}
        {!isLoadingRestaurants && restaurants.length > 0 && showRestaurantCount && (
          <div className="absolute top-4 left-1/2 -translate-x-1/2 bg-card border border-border rounded-lg px-4 py-2 shadow-lg z-10 flex items-center gap-2 animate-in fade-in zoom-in duration-300">
            <span className="text-sm font-medium">
              🔥 {restaurants.length}개의 맛집 발견
            </span>
          </div>
        )}

        {/* Admin Add Button */}
        {onAdminAddRestaurant && (
          <button
            onClick={onAdminAddRestaurant}
            className="absolute bottom-8 right-8 bg-gradient-primary text-primary-foreground px-6 py-3 rounded-full shadow-lg hover:opacity-90 transition-opacity font-semibold flex items-center gap-2 z-10"
          >
            <span className="text-xl">+</span>
            맛집 등록
          </button>
        )}


        {/* 레스토랑 상세 패널 - 고정 너비 400px, 애니메이션 적용, 클릭 시 앞으로 가져오기 */}
        {selectedRestaurant && (
          <div
            className={`h-full relative shadow-xl bg-background transition-all duration-300 ease-in-out ${isPanelOpen ? 'w-[min(400px,calc(100vw-1rem))]' : 'w-0'} ${activePanel === 'detail' ? 'z-[50]' : 'z-20'} hover:z-[60]`}
            style={{ overflow: 'visible' }}
            onClick={(e) => {
              // 이벤트 버블링 방지 (지도 클릭으로 전파되지 않도록)
              e.stopPropagation();
              onPanelClick?.('detail');
            }}
          >
            <div ref={detailPanelRef} className="h-full w-[min(400px,calc(100vw-1rem))] bg-background border-l border-border">
              <RestaurantDetailPanel
                restaurant={selectedRestaurant}
                onClose={() => {
                  if (onPanelClose) onPanelClose();
                  else setIsPanelOpen(false);
                }}
                onWriteReview={() => {
                  setIsReviewModalOpen(true);
                }}
                onEditRestaurant={onAdminEditRestaurant ? () => {
                  onAdminEditRestaurant(selectedRestaurant!);
                } : undefined}
                onRequestEditRestaurant={onRequestEditRestaurant ? () => {
                  onRequestEditRestaurant(selectedRestaurant!);
                } : undefined}
                onToggleCollapse={() => setIsPanelOpen(!isPanelOpen)}
                isPanelOpen={isPanelOpen}
              />
            </div>
          </div>
        )}

        {/* Review Modal */}
        {selectedRestaurant && isReviewModalOpen && (
          <ReviewModal
            isOpen={isReviewModalOpen}
            onClose={() => setIsReviewModalOpen(false)}
            restaurant={selectedRestaurant}
            onSuccess={refetch}
          />
        )}
      </div>
    </ErrorBoundary>
  );
});

MapView.displayName = 'MapView';

export default MapView;
