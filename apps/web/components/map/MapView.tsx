import { useEffect, useRef, useState, memo, useCallback, useMemo } from "react";
import { ErrorBoundary } from "react-error-boundary";
import { useGoogleMaps } from "@/hooks/use-google-maps";
import { useRestaurants } from "@/hooks/use-restaurants";
import type { Restaurant } from "@/types/restaurant";
import type { FilterState } from "@/components/filters/filter-state";
import { MapSkeleton } from "@/components/skeletons/MapSkeleton";
import { MapViewSurface } from "@/components/map/map-view-surface";
import { MapViewSidepanelStack } from "@/components/map/map-view-sidepanel-stack";
import {
  MapViewErrorState,
  MapViewGoogleLoadErrorState,
  MapViewMissingApiKeyState,
} from "@/components/map/map-view-status-panels";
import {
  getMapViewCountryConfig,
  getMapViewMarkerIcon,
  mergeSearchedRestaurant,
} from "@/lib/map-view-helpers";
import {
  resolveMapViewSelectedPanTarget,
  shouldCenterSelectedRestaurant,
} from "@/lib/map-view-movement-helpers";
import {
  applyMapViewMarkerSelectedState,
  buildMapViewMarkerHtml,
  getMapViewMarkerSize,
  isMapViewMarkerSelected,
} from "@/lib/map-view-marker-helpers";
import {
  buildMapViewBoundsQuery,
  findUpdatedSelectedRestaurant,
  getMapViewRestaurantCountToastVisible,
} from "@/lib/map-view-state-helpers";
import { buildMapViewRestaurantsQueryOptions } from "@/lib/map-query-helpers";
import {
  buildMapViewPanelStateSetter,
  buildMapViewPanelCloseHandler,
  buildMapViewRestaurantAction,
  buildMapViewReviewOpenHandler,
  buildMapViewTogglePanelHandler,
  resolveMapViewPanelOpenState,
  resolveMapViewPanelWidth,
} from "@/lib/map-view-panel-helpers";
import {
  buildMapViewDetailPanelFocusCaptureHandler,
  buildMapViewDetailPanelMouseDownCaptureHandler,
  buildMapViewReviewCloseHandler,
  buildMapViewReviewSuccessHandler,
  shouldShowMapViewDetailPanel,
} from "@/lib/map-view-sidepanel-helpers";
import {
  buildGoogleMapOptions,
  getRestaurantLatLng,
} from "@/lib/map-view-google-helpers";

interface MapPointLike {
  lat: () => number;
  lng: () => number;
}

interface MapBoundsLike {
  getNorthEast: () => MapPointLike;
  getSouthWest: () => MapPointLike;
}

interface GoogleMapLike {
  panTo: (position: { lat: number; lng: number }) => void;
  setZoom: (zoom: number) => void;
  setCenter: (position: { lat: number; lng: number }) => void;
  getBounds: () => MapBoundsLike | null;
  addListener: (eventName: string, handler: (...args: unknown[]) => void) => unknown;
}

interface GoogleMarkerLike {
  map: GoogleMapLike | null;
  content: Element | null;
}

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

const MapView = memo(({ filters, selectedCountry, searchedRestaurant, selectedRestaurant, refreshTrigger, onAdminAddRestaurant, onAdminEditRestaurant, onRestaurantSelect, onMapReady, onRequestEditRestaurant, onMarkerClick, panelWidth: propPanelWidth, activePanel, onPanelClick, isPanelOpen: propIsPanelOpen, onPanelClose, onTogglePanelCollapse }: MapViewProps) => {
  // 필터 객체 메모이제이션
  const memoizedFilters = useMemo(() => filters, [filters]);
  const mapRef = useRef<HTMLDivElement>(null);
  const googleMapRef = useRef<GoogleMapLike | null>(null);
  const markersRef = useRef<GoogleMarkerLike[]>([]);
  const detailPanelRef = useRef<HTMLDivElement>(null);
  const selectedCountryRef = useRef<string | null | undefined>(selectedCountry);

  // [상태] 지도 이동 - 선택된 맛집으로 이동 (한 번만 수행)
  const lastCenteredRestaurantId = useRef<string | null>(null);

  // 패널 상태 관리 (내부적으로 관리하거나 props로 제어)
  const [mapBounds, setMapBounds] = useState<MapBoundsLike | null>(null);
  const [isReviewModalOpen, setIsReviewModalOpen] = useState(false);
  const [panelWidth, setPanelWidth] = useState(0);
  const [showRestaurantCount, setShowRestaurantCount] = useState(false);
  const [localIsPanelOpen, setLocalIsPanelOpen] = useState(false);

  useEffect(() => {
    selectedCountryRef.current = selectedCountry;
  }, [selectedCountry]);

  // props로 전달된 isPanelOpen이 있으면 우선 사용, 없으면 로컬 상태 사용
  const isPanelOpen = useMemo(
    () => resolveMapViewPanelOpenState({ localIsPanelOpen, propIsPanelOpen }),
    [localIsPanelOpen, propIsPanelOpen]
  );
  const setIsPanelOpen = useMemo(
    () => buildMapViewPanelStateSetter({ onTogglePanelCollapse, setLocalIsPanelOpen }),
    [onTogglePanelCollapse]
  );

  const handleDetailPanelMouseDownCapture = useMemo(
    () => buildMapViewDetailPanelMouseDownCaptureHandler(onPanelClick),
    [onPanelClick]
  );

  const handleDetailPanelFocusCapture = useMemo(
    () => buildMapViewDetailPanelFocusCaptureHandler(onPanelClick),
    [onPanelClick]
  );

  // props로 전달된 panelWidth가 있으면 우선 사용
  const effectivePanelWidth = useMemo(
    () => resolveMapViewPanelWidth({ panelWidth, propPanelWidth }),
    [panelWidth, propPanelWidth]
  );
  const handlePanelClose = useMemo(
    () => buildMapViewPanelCloseHandler({ onPanelClose, setIsPanelOpen }),
    [onPanelClose, setIsPanelOpen]
  );
  const handleOpenReviewModal = useMemo(
    () => buildMapViewReviewOpenHandler(setIsReviewModalOpen),
    []
  );
  const handleCloseReviewModal = useMemo(
    () => buildMapViewReviewCloseHandler(setIsReviewModalOpen),
    []
  );
  const handleTogglePanel = useMemo(
    () => buildMapViewTogglePanelHandler({ isPanelOpen, setIsPanelOpen }),
    [isPanelOpen, setIsPanelOpen]
  );
  const handleEditSelectedRestaurant = useMemo(
    () => buildMapViewRestaurantAction(onAdminEditRestaurant, selectedRestaurant),
    [onAdminEditRestaurant, selectedRestaurant]
  );
  const handleRequestEditSelectedRestaurant = useMemo(
    () => buildMapViewRestaurantAction(onRequestEditRestaurant, selectedRestaurant),
    [onRequestEditRestaurant, selectedRestaurant]
  );


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

    const position = getRestaurantLatLng(searchedRestaurant);
    if (!position) {
      return;
    }

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
    if (!shouldCenterSelectedRestaurant({
      lastCenteredRestaurantId: lastCenteredRestaurantId.current,
      selectedRestaurantId: selectedRestaurant.id,
    })) {
      return;
    }

    const position = getRestaurantLatLng(selectedRestaurant);
    if (!position) {
      return;
    }

    try {
      const map = googleMapRef.current;
      if (!map) return;
      const bounds = map.getBounds();
      if (!bounds) return;

      // 지도의 실제 너비 계산
      const mapWidth = mapRef.current?.offsetWidth || 0;
      const sidebarWidth = 0; // GlobalMapPage에는 사이드바 없음

      const adjustedLng = resolveMapViewSelectedPanTarget({
        boundsNorthEastLng: bounds.getNorthEast().lng(),
        boundsSouthWestLng: bounds.getSouthWest().lng(),
        lng: position.lng,
        mapWidth,
        panelWidth: effectivePanelWidth,
        sidebarWidth,
      });

      // 지도 이동
      map.panTo({ lat: position.lat, lng: adjustedLng });

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
  const restaurantsOptions = useMemo(() => buildMapViewRestaurantsQueryOptions({
    bounds: buildMapViewBoundsQuery(mapBounds),
    filters: memoizedFilters,
    isLoaded,
    selectedCountry,
  }), [mapBounds, memoizedFilters, selectedCountry, isLoaded]);

  const { data: restaurants = [], isLoading: isLoadingRestaurants, refetch } = useRestaurants(restaurantsOptions);
  const handleReviewSuccess = useMemo(
    () => buildMapViewReviewSuccessHandler(refetch),
    [refetch]
  );

  // 맛집 개수 표시 자동 숨김 처리
  useEffect(() => {
    if (getMapViewRestaurantCountToastVisible(restaurants.length, isLoadingRestaurants)) {
      setShowRestaurantCount(true);
      const timer = setTimeout(() => {
        setShowRestaurantCount(false);
      }, 3000);
      return () => clearTimeout(timer);
    }
  }, [restaurants, isLoadingRestaurants]);

  // 마커를 표시할 맛집 목록 (기존 restaurants + 검색된 맛집)
  const restaurantsToShow = useMemo(() => {
    return mergeSearchedRestaurant(restaurants, searchedRestaurant ?? null);
  }, [restaurants, searchedRestaurant]);


  // [데이터 갱신] refreshTrigger 변경 시 재조회 (리뷰 작성 등)
  useEffect(() => {
    if (refreshTrigger) {
      refetch();
    }
  }, [refreshTrigger, refetch]);


  // refreshTrigger 변경 시 선택된 레스토랑 정보 업데이트
  useEffect(() => {
    const updatedRestaurant = findUpdatedSelectedRestaurant(restaurants, selectedRestaurant);
    if (updatedRestaurant) {
      onRestaurantSelect?.(updatedRestaurant);
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
    const initialSelectedCountry = selectedCountryRef.current;
    const countryConfig = getMapViewCountryConfig(initialSelectedCountry);
    const center = { lat: countryConfig.lat, lng: countryConfig.lng };
    const zoom = countryConfig.zoom;

    try {
      const map = new google.maps.Map(mapRef.current, buildGoogleMapOptions({ center, zoom }));

      googleMapRef.current = map;

      // [이동 감지] 지도 이동 종료 시 경계값 업데이트
      map.addListener("idle", () => {
        const bounds = map.getBounds();
        if (bounds) {
          setMapBounds(bounds);
        }
      });
    } catch (error) {
      console.error("Error creating Google Map:", error);
    }
  }, [isLoaded]);

  // [국가 변경] 선택된 국가에 따라 지도 중심 및 줌 레벨 조정
  useEffect(() => {
    if (!googleMapRef.current || !selectedCountry) return;

    // 검색된 맛집이 있으면 국가 중심으로 이동하지 않음 (검색 이동 로직이 우선)
    // 단, 검색된 맛집이 현재 선택된 국가와 다를 수 있으므로 주의 필요하지만,
    // handleRestaurantSearch에서 이미 국가를 맞춰주므로 여기서는 이동만 막으면 됨
    if (searchedRestaurant) return;

    const countryConfig = getMapViewCountryConfig(selectedCountry);
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
      const isSelected = isMapViewMarkerSelected({
        restaurantId: restaurant.id,
        searchedRestaurantId: searchedRestaurant?.id,
        selectedRestaurantId: selectedRestaurant?.id,
      });
      const imagePath = getMapViewMarkerIcon(restaurant.categories);
      const markerSize = getMapViewMarkerSize(isSelected);

      const markerElement = document.createElement("div");
      markerElement.className = `custom-marker ${isSelected ? 'selected-marker' : ''}`;
      markerElement.innerHTML = buildMapViewMarkerHtml({
        imagePath,
        isSelected,
        markerSize,
        name: restaurant.name,
      });

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
  }, [isLoaded, moveToRestaurant, onMarkerClick, onRestaurantSelect, restaurantsToShow, searchedRestaurant?.id, selectedRestaurant?.id]);

  // 선택된 마커의 스타일을 실시간 업데이트 (줌 이벤트 시 애니메이션 유지)
  useEffect(() => {
    if (!isLoaded || markersRef.current.length === 0 || !restaurantsToShow) return;



    markersRef.current.forEach((marker, index) => {
      const restaurant = restaurantsToShow[index];
      if (!restaurant) {
        return;
      }

      const isSelected = isMapViewMarkerSelected({
        restaurantId: restaurant.id,
        searchedRestaurantId: searchedRestaurant?.id,
        selectedRestaurantId: selectedRestaurant?.id,
      });
      const markerElement = marker.content as HTMLElement;
      if (!markerElement) return;
      applyMapViewMarkerSelectedState({ isSelected, markerElement });
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

          const isSelected = isMapViewMarkerSelected({
            restaurantId: restaurant.id,
            searchedRestaurantId: searchedRestaurant?.id,
            selectedRestaurantId: selectedRestaurant?.id,
          });
          const markerElement = marker.content as HTMLElement;
          if (!markerElement) return;
          applyMapViewMarkerSelectedState({ isSelected, markerElement });
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
  }, [isLoaded, selectedRestaurant?.id, searchedRestaurant?.id, restaurantsToShow]);

  if (loadError) {
    return <MapViewGoogleLoadErrorState />;
  }

  if (!isLoaded) {
    return <MapSkeleton />;
  }

  if (!apiKey) {
    return <MapViewMissingApiKeyState />;
  }

  return (
    <ErrorBoundary FallbackComponent={MapViewErrorState}>
      <div className="relative w-full h-full flex">
        <MapViewSurface
          isLoadingRestaurants={isLoadingRestaurants}
          mapRef={mapRef}
          onAdminAddRestaurant={onAdminAddRestaurant}
          restaurantCount={restaurants.length}
          showRestaurantCount={showRestaurantCount}
        />

        {shouldShowMapViewDetailPanel({ onMarkerClick, selectedRestaurant }) && (
          <MapViewSidepanelStack
            activePanel={activePanel}
            detailPanelRef={detailPanelRef}
            isPanelOpen={isPanelOpen}
            isReviewModalOpen={isReviewModalOpen}
            onClose={handlePanelClose}
            onEditRestaurant={handleEditSelectedRestaurant}
            onFocusCapture={handleDetailPanelFocusCapture}
            onMouseDownCapture={handleDetailPanelMouseDownCapture}
            onRequestEditRestaurant={handleRequestEditSelectedRestaurant}
            onReviewModalClose={handleCloseReviewModal}
            onReviewModalSuccess={handleReviewSuccess}
            onToggleCollapse={handleTogglePanel}
            onWriteReview={handleOpenReviewModal}
            restaurant={selectedRestaurant}
          />
        )}
      </div>
    </ErrorBoundary>
  );
});

MapView.displayName = 'MapView';

export default MapView;
