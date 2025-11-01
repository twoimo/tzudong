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

const SEOUL_CENTER = { lat: 37.5665, lng: 126.9780 };
const USA_CENTER = { lat: 39.8283, lng: -98.5795 }; // 미국 중심
const INITIAL_ZOOM = 12;
const USA_ZOOM = 4; // 미국 줌 레벨

// 국가별 지도 중심 좌표
const COUNTRY_CENTERS: Record<string, { lat: number; lng: number; zoom: number }> = {
  "미국": { lat: 39.8283, lng: -98.5795, zoom: 4 },
  "일본": { lat: 35.1815, lng: 136.9066, zoom: 10 }, // 나고야시 중심으로 변경
  "태국": { lat: 13.7563, lng: 100.5018, zoom: 10 }, // 방콕 중심으로 확대
  "인도네시아": { lat: -6.9667, lng: 110.4167, zoom: 7 }, // 줌아웃 -3
  "튀르키예": { lat: 41.0082, lng: 28.9784, zoom: 10 }, // 이스탄불 더 확대
  "헝가리": { lat: 47.4979, lng: 19.0402, zoom: 10 }, // 줌인 +3
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
  // 패널 관리를 위한 콜백 추가
  onMarkerClick?: (restaurant: Restaurant) => void;
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

const MapView = memo(({ filters, selectedCountry, searchedRestaurant, selectedRestaurant, refreshTrigger, onAdminAddRestaurant, onAdminEditRestaurant, onRestaurantSelect, onMapReady, onRequestEditRestaurant, onMarkerClick }: MapViewProps) => {
  // 필터 객체 메모이제이션
  const memoizedFilters = useMemo(() => filters, [filters]);
  const { user } = useAuth();
  const mapRef = useRef<HTMLDivElement>(null);
  const googleMapRef = useRef<google.maps.Map | null>(null);
  const markersRef = useRef<google.maps.marker.AdvancedMarkerElement[]>([]);

  const [mapBounds, setMapBounds] = useState<google.maps.LatLngBounds | null>(null);
  const [isReviewModalOpen, setIsReviewModalOpen] = useState(false);
  const [hasUserInteracted, setHasUserInteracted] = useState(false);


  // 맛집으로 지도 이동하는 함수
  const moveToRestaurant = useCallback((restaurant: Restaurant) => {
    if (googleMapRef.current) {
      console.log('MapView: Moving to restaurant:', restaurant.name);
      const position = { lat: Number(restaurant.lat), lng: Number(restaurant.lng) };

      try {
        googleMapRef.current.setCenter(position);
        googleMapRef.current.setZoom(15); // 맛집 상세 보기용 줌 레벨
        console.log('MapView: Successfully moved to restaurant position');
      } catch (error) {
        console.error('MapView: Error moving to restaurant position:', error);
      }
    } else {
      console.warn('MapView: Map not ready for moving to restaurant');
    }
  }, []);

  // 외부 콜백에 지도 이동 함수 전달
  useEffect(() => {
    if (onMapReady) {
      // 부모 컴포넌트에 지도 이동 함수를 전달
      onMapReady(moveToRestaurant);
    }
  }, [onMapReady, moveToRestaurant]);

  const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY || "";
  const { isLoaded, loadError } = useGoogleMaps({ apiKey });

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


  // Refetch when refreshTrigger changes
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
      } else if (!updatedRestaurant) {
        // 삭제된 경우에만 패널 닫기
        onRestaurantSelect?.(null);
      }
    }
  }, [restaurants, refreshTrigger, selectedRestaurant, onRestaurantSelect]);


  // Initialize map
  useEffect(() => {
    if (!isLoaded || !mapRef.current) {
      return;
    }

    // Additional check for Google Maps API
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

      // Update bounds when map moves
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

  // Update map center and zoom when selectedCountry changes
  useEffect(() => {
    if (!googleMapRef.current || !selectedCountry) return;

    const countryConfig = COUNTRY_CENTERS[selectedCountry];
    if (countryConfig) {
      googleMapRef.current.setCenter({ lat: countryConfig.lat, lng: countryConfig.lng });
      googleMapRef.current.setZoom(countryConfig.zoom);
    }
  }, [selectedCountry]);

  // Retry map initialization if Google Maps becomes available later
  useEffect(() => {
    if (!isLoaded && window.google && window.google.maps && window.google.maps.Map && mapRef.current && !googleMapRef.current) {
      console.log("Google Maps became available, initializing map...");
      // Force re-run of map initialization
      setTimeout(() => {
        window.location.reload();
      }, 500);
    }
  }, [isLoaded]);

  // Update markers when restaurants change
  useEffect(() => {
    if (!googleMapRef.current || !isLoaded) return;

    // Clear existing markers
    markersRef.current.forEach(marker => {
      marker.map = null;
    });
    markersRef.current = [];

    // Create new markers
    restaurants.forEach((restaurant) => {
      const isSelected = selectedRestaurant?.id === restaurant.id;

      // 카테고리별 적절한 이모티콘으로 변경
      const getCategoryIcon = (category: string) => {
        const iconMap: { [key: string]: string } = {
          '고기': '🥩',
          '치킨': '🍗',
          '한식': '🍚',
          '중식': '🥢',
          '일식': '🍣',
          '양식': '🍝',
          '분식': '🥟',
          '카페·디저트': '☕',
          '아시안': '🍜',
          '패스트푸드': '🍔',
          '족발·보쌈': '🍖',
          '돈까스·회': '🍱',
          '피자': '🍕',
          '찜·탕': '🥘',
          '야식': '🌙',
          '도시락': '🍱'
        };
        return iconMap[category] || '⭐'; // 기본값은 별표
      };

      const icon = getCategoryIcon(restaurant.category);

      // 선택된 마커는 더 큰 크기와 강조 효과 (조금 더 작게)
      const markerSize = isSelected ? 32 : 24;

      const markerElement = document.createElement("div");
      markerElement.className = `custom-marker ${isSelected ? 'selected-marker' : ''}`;
      markerElement.innerHTML = `
        <div style="
          position: relative;
          font-size: ${markerSize}px;
          cursor: pointer;
          transition: all 0.3s ease;
          filter: drop-shadow(0 2px 4px rgba(0,0,0,0.3));
        " class="${isSelected ? 'animate-bounce' : ''} hover:scale-125">
          ${icon}
        </div>
      `;

      const marker = new google.maps.marker.AdvancedMarkerElement({
        map: googleMapRef.current,
        position: { lat: Number(restaurant.lat), lng: Number(restaurant.lng) },
        content: markerElement,
        title: restaurant.name,
      });

      markerElement.addEventListener("click", () => {
        // selectedRestaurant 업데이트 (외부 상태 관리용)
        onRestaurantSelect?.(restaurant);

        // 패널 관리는 부모 컴포넌트에서 처리 (완전 분리)
        onMarkerClick?.(restaurant);

        // 지도 이동 제거 - 현재 위치 유지
      });

      markersRef.current.push(marker);
    });
  }, [restaurants, isLoaded, onRestaurantSelect, onMarkerClick, selectedRestaurant?.id]);

  // 선택된 마커의 스타일을 실시간 업데이트 (줌 이벤트 시 애니메이션 유지)
  useEffect(() => {
    if (!isLoaded || markersRef.current.length === 0) return;

    markersRef.current.forEach((marker, index) => {
      const restaurant = restaurants[index];
      if (!restaurant) return;

      const isSelected = selectedRestaurant?.id === restaurant.id;
      const markerElement = marker.content as HTMLElement;
      if (!markerElement) return;

      const innerDiv = markerElement.querySelector('div');
      if (!innerDiv) return;

      // 크기 업데이트
      const markerSize = isSelected ? 32 : 24;
      innerDiv.style.fontSize = `${markerSize}px`;

      // 애니메이션 클래스 업데이트
      if (isSelected) {
        innerDiv.classList.add('animate-bounce');
      } else {
        innerDiv.classList.remove('animate-bounce');
      }
    });
  }, [selectedRestaurant?.id, restaurants, isLoaded]);

  // 줌 이벤트 시 마커 스타일 유지
  useEffect(() => {
    if (!googleMapRef.current || !isLoaded) return;

    const handleZoomChange = () => {
      // 줌 변경 후 약간의 지연을 주어 마커 스타일 재적용
      setTimeout(() => {
        if (!isLoaded || markersRef.current.length === 0) return;

        markersRef.current.forEach((marker, index) => {
          const restaurant = restaurants[index];
          if (!restaurant) return;

          const isSelected = selectedRestaurant?.id === restaurant.id;
          const markerElement = marker.content as HTMLElement;
          if (!markerElement) return;

          const innerDiv = markerElement.querySelector('div');
          if (!innerDiv) return;

          // 크기 업데이트
          const markerSize = isSelected ? 32 : 24;
          innerDiv.style.fontSize = `${markerSize}px`;

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
  }, [isLoaded, selectedRestaurant?.id, restaurants]);

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
    return (
      <div className="flex items-center justify-center h-full bg-gradient-to-br from-background to-muted">
        <div className="text-center space-y-6">
          <div className="relative">
            <div className="animate-spin rounded-full h-16 w-16 border-4 border-primary/20 border-t-primary mx-auto"></div>
            <div className="absolute inset-0 rounded-full border-4 border-transparent border-r-secondary animate-spin mx-auto h-16 w-16" style={{ animationDuration: '1.5s' }}></div>
          </div>
          <div className="space-y-3">
            <h2 className="text-xl font-bold bg-gradient-to-r from-primary to-secondary bg-clip-text text-transparent">
              쯔동여지도 로딩 중...
            </h2>
            <p className="text-muted-foreground">
              맛있는 발견을 준비하고 있습니다
            </p>
            <div className="flex justify-center space-x-1">
              <div className="w-2 h-2 bg-primary rounded-full animate-bounce"></div>
              <div className="w-2 h-2 bg-primary rounded-full animate-bounce" style={{ animationDelay: '0.1s' }}></div>
              <div className="w-2 h-2 bg-primary rounded-full animate-bounce" style={{ animationDelay: '0.2s' }}></div>
            </div>
            {loadError && (
              <div className="mt-4 p-3 bg-destructive/10 border border-destructive/20 rounded-lg">
                <p className="text-xs text-destructive">
                  로딩 중 오류 발생: {loadError.message}
                </p>
                <button
                  onClick={() => window.location.reload()}
                  className="mt-2 px-3 py-1 bg-destructive text-destructive-foreground text-xs rounded hover:bg-destructive/90"
                >
                  새로고침
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    );
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
              .env 파일에 VITE_GOOGLE_MAPS_API_KEY를 설정해주세요.
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
        <div ref={mapRef} className="flex-1 h-full" />


        {/* Loading indicator */}
        {isLoadingRestaurants && (
          <div className="absolute top-4 left-1/2 -translate-x-1/2 bg-card border border-border rounded-lg px-4 py-2 shadow-lg flex items-center gap-2 z-10">
            <Loader2 className="h-4 w-4 animate-spin text-primary" />
            <span className="text-sm font-medium">맛집 로딩 중...</span>
          </div>
        )}

        {/* Restaurant count */}
        {!isLoadingRestaurants && restaurants.length > 0 && (
          <div className="absolute top-4 left-1/2 -translate-x-1/2 bg-card border border-border rounded-lg px-4 py-2 shadow-lg z-10 flex items-center gap-2">
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
