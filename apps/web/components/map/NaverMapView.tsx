'use client';

/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useRef, useState, memo, useCallback, useMemo } from "react";
import { useNaverMaps } from "@/hooks/use-naver-maps";
import { useRestaurants } from "@/hooks/use-restaurants";
import { FilterState } from "@/components/filters/FilterPanel";
import { Restaurant, Region } from "@/types/restaurant";
import { REGION_MAP_CONFIG } from "@/config/maps";
import { RestaurantDetailPanel } from "@/components/restaurant/RestaurantDetailPanel";
import { ReviewModal } from "@/components/reviews/ReviewModal";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { MapPin, Star, Users, ChefHat } from "lucide-react";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { MapSkeleton } from "@/components/skeletons/MapSkeleton";
import { useLayout } from "@/contexts/LayoutContext";

interface NaverMapViewProps {
    filters: FilterState;
    selectedRegion: Region | null;
    searchedRestaurant: Restaurant | null;
    selectedRestaurant: Restaurant | null;
    refreshTrigger: number;
    onAdminAddRestaurant?: () => void;
    onAdminEditRestaurant?: (restaurant: Restaurant) => void;
    onRequestEditRestaurant?: (restaurant: Restaurant) => void;
    isGridMode?: boolean;
    gridSelectedRestaurant?: Restaurant | null; // 그리드 모드에서 각 그리드별 선택된 맛집
    onRestaurantSelect?: (restaurant: Restaurant) => void;
    activePanel?: 'map' | 'detail' | 'control';
    onPanelClick?: (panel: 'map' | 'detail' | 'control') => void;
    onMarkerClick?: (restaurant: Restaurant) => void; // 외부 패널 열기
    externalPanelOpen?: boolean; // 외부에서 패널 열림 상태 제어
    isPanelCollapsed?: boolean; // 패널 접기 상태 (접혀있으면 오프셋 없음)
}

// 카테고리 아이콘 맵 (컴포넌트 외부에서 한 번만 생성)
const CATEGORY_ICON_MAP: Record<string, string> = {
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

// 카테고리 아이콘 반환 함수 (외부에서 정의하여 재생성 방지)
const getCategoryIcon = (category: string | string[] | null | undefined): string => {
    if (!category) return '⭐';
    const categoryStr = Array.isArray(category) ? category[0] : category;
    return CATEGORY_ICON_MAP[categoryStr] || '⭐';
};

const NaverMapView = memo(({
    filters,
    selectedRegion,
    searchedRestaurant,
    selectedRestaurant,
    refreshTrigger,
    onAdminEditRestaurant,
    onRequestEditRestaurant,
    isGridMode = false,
    gridSelectedRestaurant,
    onRestaurantSelect,
    activePanel,
    onPanelClick,
    onMarkerClick,
    externalPanelOpen,
    isPanelCollapsed = false,
}: NaverMapViewProps) => {
    const mapRef = useRef<HTMLDivElement>(null);
    const mapInstanceRef = useRef<any>(null);
    const markersRef = useRef<any[]>([]);
    const restaurantsRef = useRef<Restaurant[]>([]); // 병합된 레스토랑 데이터 참조
    const previousSearchedRestaurantRef = useRef<Restaurant | null>(null); // 이전 searchedRestaurant 추적
    const detailPanelRef = useRef<HTMLDivElement>(null); // 상세 패널 참조
    const prevPanelOpenRef = useRef<boolean>(false); // 이전 패널 열림 상태 추적 (오프셋 델타 계산용)
    const prevSelectedRestaurantIdRef = useRef<string | null>(null); // 이전 선택된 레스토랑 ID 추적 (동일 마커 재클릭 감지용)
    const prevSidebarOpenRef = useRef<boolean>(true); // 이전 사이드바 열림 상태 추적

    // 사이드바 상태 가져오기
    const { isSidebarOpen } = useLayout();

    // Naver Maps API 로드
    const { isLoaded, loadError } = useNaverMaps({ autoLoad: true });

    const [isReviewModalOpen, setIsReviewModalOpen] = useState(false);
    const [isPanelOpen, setIsPanelOpen] = useState(false);
    const [showRestaurantCount, setShowRestaurantCount] = useState(false);

    // selectedRestaurant가 설정되면 자동으로 패널 열기
    useEffect(() => {
        if (selectedRestaurant && !isGridMode) {
            setIsPanelOpen(true);
        } else if (!selectedRestaurant) {
            setIsPanelOpen(false);
        }
    }, [selectedRestaurant, isGridMode]);

    // 외부에서 패널 닫기 요청 시 닫기 (externalPanelOpen이 false면 닫기)
    useEffect(() => {
        if (externalPanelOpen === false) {
            setIsPanelOpen(false);
        }
    }, [externalPanelOpen]);

    // 선택된 맛집이 변경될 때 지도 중앙 재조정 (모든 우측 패널 너비 고려)
    useEffect(() => {
        if (selectedRestaurant && mapInstanceRef.current && !isGridMode) {
            const map = mapInstanceRef.current;
            const panelWidth = 400; // 패널 고정 너비

            // 현재 선택된 레스토랑 ID
            const currentId = selectedRestaurant.id;
            const prevId = prevSelectedRestaurantIdRef.current;

            // 동일한 마커를 다시 클릭한 경우에도 중앙 정렬 실행
            // (이전 ID와 같더라도 패널 접기 후 다시 클릭한 경우를 위해)
            const shouldRecenter = currentId !== prevId || !isPanelOpen;

            // 이전 선택된 레스토랑 ID 업데이트
            prevSelectedRestaurantIdRef.current = currentId;

            // 현재 줌 레벨 확인
            const currentZoom = map.getZoom();
            const targetZoom = 16;
            const zoomDiff = Math.abs(currentZoom - targetZoom);

            // 현재 중심과 목표 좌표 간 거리 계산 (Haversine 공식 간소화)
            const currentCenter = map.getCenter();
            const targetLat = selectedRestaurant.lat!;
            const targetLng = selectedRestaurant.lng!;
            const currentLat = currentCenter.lat();
            const currentLng = currentCenter.lng();

            // 거리 계산 (대략적인 km 단위)
            const latDiff = Math.abs(targetLat - currentLat);
            const lngDiff = Math.abs(targetLng - currentLng);
            // 한국 위도 기준 1도 ≈ 111km (위도), 1도 ≈ 88km (경도)
            const distanceKm = Math.sqrt(
                Math.pow(latDiff * 111, 2) + Math.pow(lngDiff * 88, 2)
            );

            // 임계값 설정
            const ZOOM_THRESHOLD = 4; // 줌 차이 4 이상이면 즉시 전환
            const DISTANCE_THRESHOLD_KM = 50; // 50km 이상이면 즉시 전환

            // 즉시 전환 필요 여부
            const shouldInstantTransition = zoomDiff >= ZOOM_THRESHOLD || distanceKm >= DISTANCE_THRESHOLD_KM;

            const centerLatLng = new naver.maps.LatLng(targetLat, targetLng);

            // 우측 패널 상태 확인
            // selectedRestaurant가 있으면 패널이 열릴 것이므로, 접힌 상태가 아니면 오프셋 적용
            // 외부 패널(마이페이지 등)이 열려있어도 마커 클릭 시 상세 패널로 전환되므로 오프셋 필요
            const isAnyPanelOpen = !isPanelCollapsed;

            // 패널 오프셋 적용된 좌표 계산
            const getOffsetLatLng = () => {
                try {
                    if (isAnyPanelOpen) {
                        const projection = map.getProjection();
                        const centerPoint = projection.fromCoordToOffset(centerLatLng);
                        const offsetPoint = new naver.maps.Point(
                            centerPoint.x + (panelWidth / 2),
                            centerPoint.y
                        );
                        return projection.fromOffsetToCoord(offsetPoint);
                    }
                } catch (e) {
                    // 프로젝션 준비 안됨
                }
                return centerLatLng;
            };

            const moveToCenter = () => {
                if (!map || !mapRef.current) return;

                try {
                    if (isAnyPanelOpen) {
                        const projection = map.getProjection();
                        const centerPoint = projection.fromCoordToOffset(centerLatLng);
                        const offsetPoint = new naver.maps.Point(
                            centerPoint.x + (panelWidth / 2),
                            centerPoint.y
                        );
                        const offsetLatLng = projection.fromOffsetToCoord(offsetPoint);

                        map.panTo(offsetLatLng, { duration: 300, easing: 'easeOutCubic' });
                    } else {
                        map.panTo(centerLatLng, { duration: 300, easing: 'easeOutCubic' });
                    }
                } catch (e) {
                    map.panTo(centerLatLng, { duration: 300 });
                }
            };

            if (!shouldRecenter) {
                return; // 중앙 정렬 필요 없음
            }

            // 즉시 전환 (줌 차이가 크거나 거리가 멀 때)
            if (shouldInstantTransition) {
                // 즉시 줌 및 중심 설정 (애니메이션 없이)
                map.setZoom(targetZoom);
                const finalLatLng = getOffsetLatLng();
                map.setCenter(finalLatLng);
                return;
            }

            // 부드러운 전환 (줌 차이가 작고 거리가 가까울 때)
            if (currentZoom !== targetZoom) {
                // 부드러운 줌 전환
                map.morph(centerLatLng, targetZoom, {
                    duration: 400,
                    easing: 'easeOutCubic'
                });

                // 줌 완료 후 패널 오프셋 적용
                setTimeout(() => {
                    if (isAnyPanelOpen) {
                        moveToCenter();
                    }
                }, 450);
            } else {
                // 줌 변경 없이 중앙 이동만
                setTimeout(moveToCenter, 50);
            }
        }
    }, [selectedRestaurant, isGridMode, isPanelOpen, externalPanelOpen, isPanelCollapsed]);

    // 패널 열림/닫힘/접힘 상태 변경 시 지도 중심 부드럽게 이동
    useEffect(() => {
        if (!mapInstanceRef.current) return;

        const panelWidth = 400;

        // 현재 패널 상태 계산
        const isCurrentlyOpen = (isPanelOpen || externalPanelOpen === false) && !isPanelCollapsed;
        const wasPreviouslyOpen = prevPanelOpenRef.current;

        // 상태가 변하지 않으면 리사이즈만 트리거
        if (isCurrentlyOpen === wasPreviouslyOpen) {
            const map = mapInstanceRef.current;
            if (map) {
                naver.maps.Event.trigger(map, 'resize');
            }
            return;
        }

        // 이전 상태 즉시 업데이트 (중복 트리거 방지)
        prevPanelOpenRef.current = isCurrentlyOpen;

        const handleMapCenter = () => {
            const map = mapInstanceRef.current;
            if (!map || !mapRef.current) return;

            naver.maps.Event.trigger(map, 'resize');

            // 선택된 맛집이 없으면 리사이즈만 하고 중심 이동은 하지 않음 (누적 방지)
            const hasRestaurant = !!(selectedRestaurant?.lat && selectedRestaurant?.lng);
            if (!hasRestaurant) {
                return;
            }

            try {
                const projection = map.getProjection();

                // 항상 마커의 원본 좌표를 기준으로 오프셋 계산 (누적 불가)
                const markerLatLng = new naver.maps.LatLng(selectedRestaurant!.lat!, selectedRestaurant!.lng!);
                const centerPoint = projection.fromCoordToOffset(markerLatLng);

                // 패널 열림 상태에 따라 오프셋 적용
                const offsetX = isCurrentlyOpen ? panelWidth / 2 : 0;

                const offsetPoint = new naver.maps.Point(
                    centerPoint.x + offsetX,
                    centerPoint.y
                );
                const offsetLatLng = projection.fromOffsetToCoord(offsetPoint);

                map.panTo(offsetLatLng, {
                    duration: 250,
                    easing: 'easeOutCubic'
                });
            } catch (e) {
                // 프로젝션 오류 - 무시
            }
        };

        const timer = setTimeout(handleMapCenter, 50);
        return () => clearTimeout(timer);
    }, [isPanelOpen, externalPanelOpen, isPanelCollapsed, selectedRestaurant]);

    // 브라우저 창 크기 변경 시 지도 리사이즈 및 중심 이동
    useEffect(() => {
        if (!mapInstanceRef.current) return;

        const handleWindowResize = () => {
            const map = mapInstanceRef.current;
            if (map) {
                naver.maps.Event.trigger(map, 'resize');
                if (selectedRestaurant) {
                    const center = new naver.maps.LatLng(selectedRestaurant.lat!, selectedRestaurant.lng!);
                    map.panTo(center, { duration: 0 }); // 리사이즈 시에는 즉시 이동
                }
            }
        };

        window.addEventListener('resize', handleWindowResize);
        return () => window.removeEventListener('resize', handleWindowResize);
    }, [selectedRestaurant]);

    // 사이드바 토글 시 지도 리사이즈 및 중심 조정
    useEffect(() => {
        if (!mapInstanceRef.current) return;
        if (prevSidebarOpenRef.current === isSidebarOpen) return;

        prevSidebarOpenRef.current = isSidebarOpen;

        const map = mapInstanceRef.current;
        const PANEL_WIDTH = 400;

        const timer = setTimeout(() => {
            naver.maps.Event.trigger(map, 'resize');

            // 선택된 맛집이 없으면 리사이즈만 (누적 방지)
            const hasRestaurant = !!(selectedRestaurant?.lat && selectedRestaurant?.lng);
            if (!hasRestaurant) {
                return;
            }

            try {
                const projection = map.getProjection();
                const isRightPanelOpen = !isPanelCollapsed || externalPanelOpen === false;

                // 항상 마커의 원본 좌표를 기준으로 오프셋 계산 (누적 불가)
                const markerLatLng = new naver.maps.LatLng(selectedRestaurant!.lat!, selectedRestaurant!.lng!);
                const centerPoint = projection.fromCoordToOffset(markerLatLng);

                // 우측 패널 열림 상태에 따라 오프셋 적용 (사이드바는 리사이즈로 자동 처리)
                const offsetX = isRightPanelOpen ? PANEL_WIDTH / 2 : 0;

                const offsetPoint = new naver.maps.Point(centerPoint.x + offsetX, centerPoint.y);
                const targetLatLng = projection.fromOffsetToCoord(offsetPoint);

                map.panTo(targetLatLng, { duration: 300, easing: 'easeOutCubic' });
            } catch {
                // 프로젝션 오류 무시
            }
        }, 150);

        return () => clearTimeout(timer);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isSidebarOpen]);

    // useRestaurants 옵션 메모이제이션
    const restaurantQueryOptions = useMemo(() => ({
        category: filters.categories.length > 0 ? [filters.categories[0]] : undefined,
        region: selectedRegion || undefined,
        minReviews: filters.minReviews,
        enabled: isLoaded,
    }), [filters.categories, filters.minReviews, selectedRegion, isLoaded]);

    const { data: restaurants = [], isLoading: isLoadingRestaurants, refetch } = useRestaurants(restaurantQueryOptions);

    // 지역 변경 시 로딩 중에도 이전 마커를 유지하기 위한 상태
    const [previousRestaurants, setPreviousRestaurants] = useState<Restaurant[]>([]);

    // restaurants가 변경될 때 이전 데이터를 저장하고, 개수 표시를 3초간 활성화
    useEffect(() => {
        if (restaurants.length > 0 && !isLoadingRestaurants) {
            setPreviousRestaurants(restaurants);

            // 맛집 개수가 있을 때만 배지 표시 및 타이머 설정
            setShowRestaurantCount(true);
            const timer = setTimeout(() => {
                setShowRestaurantCount(false);
            }, 3000);
            return () => clearTimeout(timer);
        }
    }, [restaurants, isLoadingRestaurants]);

    // 표시할 마커 데이터 (로딩 중에는 이전 데이터를 사용) - 메모이제이션
    const displayRestaurants = useMemo(() => {
        return isLoadingRestaurants && previousRestaurants.length > 0 ? previousRestaurants : restaurants;
    }, [isLoadingRestaurants, previousRestaurants, restaurants]);

    // selectedRestaurant이 기존 데이터와 다른 경우 기존 데이터로 교체
    useEffect(() => {
        if (selectedRestaurant && displayRestaurants.length > 0) {
            let existingRestaurant = null;

            // 병합된 데이터의 경우
            if (selectedRestaurant.mergedRestaurants && selectedRestaurant.mergedRestaurants.length > 0) {
                const mergedIds = selectedRestaurant.mergedRestaurants.map(r => r.id);
                existingRestaurant = displayRestaurants.find(r =>
                    mergedIds.includes(r.id) ||
                    (r.name === selectedRestaurant.name &&
                        Math.abs((r.lat || 0) - (selectedRestaurant.lat || 0)) < 0.0001 &&
                        Math.abs((r.lng || 0) - (selectedRestaurant.lng || 0)) < 0.0001)
                );
            } else {
                // 일반 데이터의 경우
                existingRestaurant = displayRestaurants.find(r =>
                    r.id === selectedRestaurant.id ||
                    (r.name === selectedRestaurant.name &&
                        Math.abs((r.lat || 0) - (selectedRestaurant.lat || 0)) < 0.0001 &&
                        Math.abs((r.lng || 0) - (selectedRestaurant.lng || 0)) < 0.0001)
                );
            }

            if (existingRestaurant && existingRestaurant.id !== selectedRestaurant.id) {
                if (onRestaurantSelect) {
                    onRestaurantSelect(existingRestaurant);
                }
            }
        }
    }, [selectedRestaurant, onRestaurantSelect]); // restaurants를 dependency에서 제거하여 무한 루프 방지



    // 지도 초기화
    useEffect(() => {
        if (!isLoaded || !mapRef.current || mapInstanceRef.current) return;

        try {
            const { naver } = window;

            // 선택된 지역에 따라 지도 중심과 줌 레벨 설정
            const regionKey = selectedRegion && (selectedRegion in REGION_MAP_CONFIG) ? selectedRegion : "전국";
            const regionConfig = REGION_MAP_CONFIG[regionKey as keyof typeof REGION_MAP_CONFIG];
            const map = new naver.maps.Map(mapRef.current, {
                center: new naver.maps.LatLng(regionConfig.center[0], regionConfig.center[1]),
                zoom: regionConfig.zoom,
                minZoom: 6,
                maxZoom: 18,
                zoomControl: false,
                zoomControlOptions: {
                    position: naver.maps.Position.TOP_RIGHT,
                },
                mapTypeControl: false,
                mapTypeControlOptions: {
                    position: naver.maps.Position.TOP_LEFT,
                },
                scaleControl: false,
                logoControl: false,
                logoControlOptions: {
                    position: naver.maps.Position.BOTTOM_RIGHT,
                },
                mapDataControl: false,
                // 성능 최적화 옵션들
                background: '#ffffff', // 배경색 명시로 렌더링 최적화
            });

            mapInstanceRef.current = map;
        } catch (error) {
            console.error("네이버 지도 초기화 오류:", error);
            toast.error("지도를 초기화하는 중 오류가 발생했습니다.");
        }
    }, [isLoaded]); // eslint-disable-line react-hooks/exhaustive-deps

    // 네이버 로고 숨기기 - 지도 로드 후 실행
    useEffect(() => {
        if (!mapInstanceRef.current) return;

        const hideLogos = () => {
            const logoSelectors = [
                '.naver-logo',
                '[class*="logo"]',
                '[class*="Logo"]',
                'img[alt*="naver" i]',
                'img[alt*="네이버" i]',
                'a[href*="naver.com"]',
                'a[href*="navercorp.com"]',
                '[title*="NAVER"]',
                '[title*="네이버"]'
            ];

            logoSelectors.forEach(selector => {
                const elements = document.querySelectorAll(selector);
                elements.forEach((element) => {
                    const htmlElement = element as HTMLElement;
                    if (htmlElement.offsetParent !== null) { // 화면에 실제로 표시되는 요소만
                        htmlElement.style.setProperty('display', 'none', 'important');
                        htmlElement.style.setProperty('visibility', 'hidden', 'important');
                        htmlElement.style.setProperty('opacity', '0', 'important');
                    }
                });
            });
        };

        // 초기 숨김 - 여러 타이밍으로 실행
        const timeouts = [
            setTimeout(hideLogos, 100),
            setTimeout(hideLogos, 500),
            setTimeout(hideLogos, 1000),
            setTimeout(hideLogos, 2000)
        ];

        // MutationObserver로 동적 요소 감시
        const observer = new MutationObserver((mutations) => {
            let hasNewElements = false;
            mutations.forEach((mutation) => {
                if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
                    hasNewElements = true;
                }
            });
            if (hasNewElements) {
                setTimeout(hideLogos, 50);
            }
        });

        observer.observe(document.body, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: ['class', 'style']
        });

        // 컴포넌트 언마운트 시 정리
        return () => {
            timeouts.forEach(clearTimeout);
            observer.disconnect();
        };
    }, [isLoaded]);

    // 지역 변경 시 지도 중심 이동
    useEffect(() => {
        if (!mapInstanceRef.current) return;

        const regionKey = selectedRegion && (selectedRegion in REGION_MAP_CONFIG) ? selectedRegion : "전국";
        const regionConfig = REGION_MAP_CONFIG[regionKey as keyof typeof REGION_MAP_CONFIG];
        const { naver } = window;
        const map = mapInstanceRef.current;
        const panelWidth = 400;

        // 지역 중심 좌표 (절대 좌표 - 누적 불가)
        const targetCenter = new naver.maps.LatLng(regionConfig.center[0], regionConfig.center[1]);
        map.setZoom(regionConfig.zoom);

        // 패널 열림 상태 확인 (현재 값 참조)
        const isAnyPanelOpen = (isPanelOpen || externalPanelOpen === false) && !isPanelCollapsed;

        if (isAnyPanelOpen) {
            // 패널 오프셋 적용하여 중심 이동
            setTimeout(() => {
                try {
                    const projection = map.getProjection();
                    const centerPoint = projection.fromCoordToOffset(targetCenter);
                    const offsetPoint = new naver.maps.Point(centerPoint.x + panelWidth / 2, centerPoint.y);
                    const offsetLatLng = projection.fromOffsetToCoord(offsetPoint);
                    map.setCenter(offsetLatLng);
                } catch {
                    map.setCenter(targetCenter);
                }
            }, 50);
        } else {
            map.setCenter(targetCenter);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selectedRegion]); // 지역 변경 시에만 실행 (패널 상태 변경은 별도 로직에서 처리)

    // 검색된 맛집 선택 시 지도 중심 이동 및 선택 상태 설정
    useEffect(() => {
        if (!searchedRestaurant || !mapInstanceRef.current) return;

        // 검색된 맛집이 병합된 데이터라면 기존 restaurants에서 같은 데이터를 찾아서 교체
        let actualSearchedRestaurant = searchedRestaurant;
        if (searchedRestaurant.mergedRestaurants && searchedRestaurant.mergedRestaurants.length > 0) {
            const mergedIds = searchedRestaurant.mergedRestaurants.map(r => r.id);
            const existingRestaurant = restaurants.find(r =>
                mergedIds.includes(r.id) ||
                (r.name === searchedRestaurant.name &&
                    Math.abs((r.lat || 0) - (searchedRestaurant.lat || 0)) < 0.0001 &&
                    Math.abs((r.lng || 0) - (searchedRestaurant.lng || 0)) < 0.0001)
            );
            if (existingRestaurant) {
                actualSearchedRestaurant = existingRestaurant;
                // 부모 컴포넌트의 selectedRestaurant도 업데이트
                if (onRestaurantSelect) {
                    onRestaurantSelect(existingRestaurant);
                }
            }
        }

        const { naver } = window;
        const map = mapInstanceRef.current;
        const panelWidth = 400;
        const targetCenter = new naver.maps.LatLng(actualSearchedRestaurant.lat!, actualSearchedRestaurant.lng!);

        map.setZoom(14); // 맛집 상세 보기용 줌 레벨

        // 패널이 열리므로 오프셋 적용
        setTimeout(() => {
            try {
                const projection = map.getProjection();
                const centerPoint = projection.fromCoordToOffset(targetCenter);
                const offsetPoint = new naver.maps.Point(centerPoint.x + panelWidth / 2, centerPoint.y);
                const offsetLatLng = projection.fromOffsetToCoord(offsetPoint);
                map.setCenter(offsetLatLng);
            } catch {
                map.setCenter(targetCenter);
            }
        }, 50);

        // 패널 열기 (검색 시에만)
        setIsPanelOpen(true);

        // 토스트 메시지 표시 (검색 또는 팝업에서 온 경우만, 마커 클릭은 제외)
        // 마커 클릭은 이미 선택된 상태이므로 토스트 불필요
        const isFromMarkerClick = previousSearchedRestaurantRef.current === searchedRestaurant;
        if (!isFromMarkerClick) {
            toast.success(`"${actualSearchedRestaurant.name}" 맛집을 찾았습니다!`);
        }

        // 현재 searchedRestaurant 저장
        previousSearchedRestaurantRef.current = searchedRestaurant;
    }, [searchedRestaurant]); // eslint-disable-line react-hooks/exhaustive-deps

    // 마커 업데이트 (최적화됨)
    useEffect(() => {
        if (!mapInstanceRef.current || !window.naver) {
            return;
        }

        const { naver } = window;

        // 기존 마커 제거 (배치로 처리)
        const oldMarkers = markersRef.current;
        oldMarkers.forEach(marker => marker.setMap(null));
        markersRef.current = [];

        // 마커를 표시할 맛집 목록 생성 (기존 displayRestaurants + 검색된 맛집)
        const restaurantsToShow = [...displayRestaurants];

        // 검색된 맛집이 기존 목록에 없는 경우 추가
        // searchedRestaurant이 교체된 경우에도 기존 데이터와 일치하도록 보장
        if (searchedRestaurant) {

            // 병합된 데이터의 경우 mergedRestaurants로 확인
            let alreadyExists = false;
            if (searchedRestaurant.mergedRestaurants && searchedRestaurant.mergedRestaurants.length > 0) {
                const mergedIds = searchedRestaurant.mergedRestaurants.map(r => r.id);
                alreadyExists = displayRestaurants.some(r => mergedIds.includes(r.id));
            } else {
                alreadyExists = displayRestaurants.some(r => r.id === searchedRestaurant.id);
            }

            if (!alreadyExists) {
                restaurantsToShow.push(searchedRestaurant);
            }
        }

        // restaurantsRef 업데이트 (마커 클릭 핸들러에서 사용)
        restaurantsRef.current = restaurantsToShow;

        // restaurants가 없으면 마커만 제거하고 종료
        if (restaurantsToShow.length === 0) {
            return;
        }

        // 마커 생성 대상 (좌표가 있는 것만)
        const markersToCreate = restaurantsToShow.filter(r => r.lat !== null && r.lng !== null);

        // 새 마커 배열 준비
        const newMarkers: any[] = [];

        // 모든 마커를 한 번에 생성 (DOM 조작 최소화)
        markersToCreate.forEach((restaurant) => {
            // 그리드 모드에서는 gridSelectedRestaurant, 단일 모드에서는 props의 selectedRestaurant 사용
            const currentSelectedRestaurant = isGridMode ? gridSelectedRestaurant : selectedRestaurant;
            const isSelected = currentSelectedRestaurant && currentSelectedRestaurant.id === restaurant.id;

            // categories 필드 사용 (호환성 속성인 category도 사용 가능)
            const icon = getCategoryIcon(restaurant.categories || restaurant.category);

            // 선택된 맛집은 더 큰 크기와 강조 효과 (조금 더 작게)
            const markerSize = isSelected ? 32 : 24;

            // HTML 요소를 직접 생성해서 마커로 사용 (MapView 방식과 동일)
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

            const marker = new naver.maps.Marker({
                position: new naver.maps.LatLng(restaurant.lat!, restaurant.lng!),
                map: mapInstanceRef.current,
                icon: {
                    content: markerElement,
                    anchor: new naver.maps.Point(markerSize / 2, markerSize / 2),
                },
                title: restaurant.name,
            });

            // 마커 클릭 이벤트
            naver.maps.Event.addListener(marker, "click", () => {
                // 외부 onMarkerClick이 있으면 호출 (외부 패널 관리)
                if (onMarkerClick) {
                    onMarkerClick(restaurant);
                } else {
                    // 기존 동작: 내부 패널 열기
                    if (onRestaurantSelect) {
                        onRestaurantSelect(restaurant);
                    }
                    setIsPanelOpen(true);
                }
            }); newMarkers.push(marker);
        });

        // 모든 마커를 한 번에 할당
        markersRef.current = newMarkers;

        // 지도 중심은 초기 위치 유지 (한반도 전체 보기)
        // 마커 표시 후 자동 이동하지 않음
    }, [displayRestaurants, refreshTrigger, selectedRegion, searchedRestaurant, selectedRestaurant, isGridMode, gridSelectedRestaurant, onRestaurantSelect]);

    // 선택된 마커의 스타일을 실시간 업데이트 (줌 이벤트 시 애니메이션 유지)
    useEffect(() => {
        if (!isLoaded || markersRef.current.length === 0 || !selectedRestaurant) return;

        // 약간의 딜레이 후 스타일 업데이트 (마커 배열 생성 완료 대기)
        const timeoutId = setTimeout(() => {
            markersRef.current.forEach((marker, index) => {
                const restaurant = restaurantsRef.current[index];
                if (!restaurant) return;

                // 선택된 맛집 비교 (ID, 이름+좌표, 병합된 데이터 모두 고려)
                let isSelected = false;

                if (selectedRestaurant) {
                    isSelected = selectedRestaurant.id === restaurant.id;

                    // 병합된 데이터의 경우 이름과 좌표로도 비교
                    if (!isSelected) {
                        isSelected = selectedRestaurant.name === restaurant.name &&
                            Math.abs((selectedRestaurant.lat || 0) - (restaurant.lat || 0)) < 0.0001 &&
                            Math.abs((selectedRestaurant.lng || 0) - (restaurant.lng || 0)) < 0.0001;
                    }

                    // 병합된 데이터의 경우 mergedRestaurants로 확인
                    if (!isSelected && selectedRestaurant.mergedRestaurants) {
                        const mergedIds = selectedRestaurant.mergedRestaurants.map(r => r.id);
                        isSelected = mergedIds.includes(restaurant.id);
                    }
                }

                const markerElement = marker.getIcon().content as HTMLElement;
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
        }, 150); // 마커 생성 후 약간의 딜레이

        return () => clearTimeout(timeoutId);
    }, [selectedRestaurant, displayRestaurants, isLoaded]);

    // 줌 이벤트 시 마커 스타일 유지
    useEffect(() => {
        if (!mapInstanceRef.current || !isLoaded) return;

        const handleZoomChange = () => {
            // 줌 변경 후 약간의 지연을 주어 마커 스타일 재적용
            setTimeout(() => {
                if (!isLoaded || markersRef.current.length === 0) return;

                markersRef.current.forEach((marker, index) => {
                    const restaurant = restaurantsRef.current[index];
                    if (!restaurant) return;

                    // 선택된 맛집 비교 (ID, 이름+좌표, 병합된 데이터 모두 고려)
                    let isSelected = false;

                    if (selectedRestaurant) {
                        isSelected = selectedRestaurant.id === restaurant.id;

                        // 병합된 데이터의 경우 이름과 좌표로도 비교
                        if (!isSelected) {
                            isSelected = selectedRestaurant.name === restaurant.name &&
                                Math.abs((selectedRestaurant.lat || 0) - (restaurant.lat || 0)) < 0.0001 &&
                                Math.abs((selectedRestaurant.lng || 0) - (restaurant.lng || 0)) < 0.0001;
                        }

                        // 병합된 데이터의 경우 mergedRestaurants로 확인
                        if (!isSelected && selectedRestaurant.mergedRestaurants) {
                            const mergedIds = selectedRestaurant.mergedRestaurants.map(r => r.id);
                            isSelected = mergedIds.includes(restaurant.id);
                        }
                    }

                    const markerElement = marker.getIcon().content as HTMLElement;
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
        naver.maps.Event.addListener(mapInstanceRef.current, 'zoom_changed', handleZoomChange);

        return () => {
            // Naver Maps에서는 이벤트 리스너가 자동으로 정리됨
        };
    }, [isLoaded, selectedRestaurant, displayRestaurants]);

    // 로딩 에러 처리
    if (loadError) {
        return (
            <div className="flex items-center justify-center h-full bg-muted">
                <div className="text-center space-y-4">
                    <div className="text-6xl">❌</div>
                    <div className="space-y-2">
                        <h2 className="text-2xl font-bold text-destructive">
                            지도 로딩 실패
                        </h2>
                        <p className="text-muted-foreground">
                            네이버 지도 API를 불러오는데 실패했습니다.
                        </p>
                        <p className="text-sm text-muted-foreground">
                            {loadError.message}
                        </p>
                    </div>
                </div>
            </div>
        );
    }

    // 로딩 중
    if (!isLoaded) {
        return <MapSkeleton />;
    }

    // 그리드 모드에서는 기존 레이아웃 유지
    if (isGridMode) {
        return (
            <div className="relative h-full">
                {/* 지도 컨테이너 */}
                <div ref={mapRef} className="w-full h-full" />

                {/* 로딩 상태 표시 */}
                {(isLoadingRestaurants || !isLoaded) && (
                    <div className="absolute top-4 left-1/2 -translate-x-1/2 bg-card border border-border rounded-lg px-4 py-2 shadow-lg z-10 flex items-center gap-2">
                        <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-primary"></div>
                        <span className="text-sm font-medium">
                            {!isLoaded ? '지도 로딩 중...' : '맛집 검색 중...'}
                        </span>
                    </div>
                )}

                {/* 레스토랑 개수 표시 (3초 후 사라짐) */}
                {!isLoadingRestaurants && isLoaded && restaurants.length > 0 && showRestaurantCount && (
                    <div className="absolute top-4 left-1/2 -translate-x-1/2 bg-card border border-border rounded-lg px-4 py-2 shadow-lg z-10 flex items-center gap-2 animate-in fade-in zoom-in duration-300">
                        <span className="text-sm font-medium">
                            🔥 {restaurants.length}개의 맛집 발견
                        </span>
                    </div>
                )}
            </div>
        );
    }

    // 단일 지도 모드에서는 Flexbox 레이아웃 적용 (고정 너비 패널)
    return (
        <div className="h-full flex relative overflow-hidden">
            {/* 지도 영역 */}
            <div
                className="flex-1 h-full relative z-0"
                onClick={() => {
                    onPanelClick?.('map');
                }}
            >
                {/* 지도 컨테이너 */}
                <div ref={mapRef} className="w-full h-full" />

                {/* 로딩 상태 표시 */}
                {(isLoadingRestaurants || !isLoaded) && (
                    <div className="absolute top-4 left-1/2 -translate-x-1/2 bg-card border border-border rounded-lg px-4 py-2 shadow-lg z-10 flex items-center gap-2">
                        <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-primary"></div>
                        <span className="text-sm font-medium">
                            {!isLoaded ? '지도 로딩 중...' : '맛집 검색 중...'}
                        </span>
                    </div>
                )}

                {/* 레스토랑 개수 표시 (3초 후 사라짐) */}
                {!isLoadingRestaurants && isLoaded && restaurants.length > 0 && showRestaurantCount && (
                    <div className="absolute top-4 left-1/2 -translate-x-1/2 bg-card border border-border rounded-lg px-4 py-2 shadow-lg z-10 flex items-center gap-2 animate-in fade-in zoom-in duration-300">
                        <span className="text-sm font-medium">
                            🔥 {restaurants.length}개의 맛집 발견
                        </span>
                    </div>
                )}
            </div>

            {/* 레스토랑 상세 패널 - 외부 onMarkerClick이 없을 때만 렌더링 (외부 패널 관리가 아닌 경우에만) */}
            {selectedRestaurant && !onMarkerClick && (
                <div
                    className={`h-full relative shadow-xl bg-background transition-all duration-300 ease-in-out ${isPanelOpen ? 'w-[400px]' : 'w-0'} ${activePanel === 'detail' ? 'z-[50]' : 'z-20'} hover:z-[60]`}
                    style={{ overflow: 'visible' }}
                    onClick={(e) => {
                        // 이벤트 버블링 방지 (지도 클릭으로 전파되지 않도록)
                        e.stopPropagation();
                        onPanelClick?.('detail');
                    }}
                >
                    <div ref={detailPanelRef} className="h-full w-[400px] bg-background border-l border-border">
                        <RestaurantDetailPanel
                            restaurant={selectedRestaurant}
                            onClose={() => setIsPanelOpen(false)}
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


            {/* 리뷰 작성 모달 */}
            <ReviewModal
                isOpen={isReviewModalOpen}
                onClose={() => setIsReviewModalOpen(false)}
                restaurant={selectedRestaurant ? { id: selectedRestaurant.id, name: selectedRestaurant.name } : null}
                onSuccess={() => {
                    refetch();
                    toast.success("리뷰가 성공적으로 등록되었습니다!");
                }}
            />
        </div>
    );
});

NaverMapView.displayName = 'NaverMapView';

export default NaverMapView;
