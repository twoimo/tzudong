'use client';

/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useRef, useState, memo } from "react";
import { useNaverMaps } from "@/hooks/use-naver-maps";
import { useRestaurants } from "@/hooks/use-restaurants";
import { FilterState } from "@/components/filters/FilterPanel";
import { Restaurant, Region } from "@/types/restaurant";
import { REGION_MAP_CONFIG } from "@/config/maps";
import { RestaurantDetailPanel } from "@/components/restaurant/RestaurantDetailPanel";
import { ReviewModal } from "@/components/reviews/ReviewModal";
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { MapPin, Star, Users, ChefHat } from "lucide-react";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";




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
}

const NaverMapView = memo(({ filters, selectedRegion, searchedRestaurant, selectedRestaurant, refreshTrigger, onAdminEditRestaurant, onRequestEditRestaurant, isGridMode = false, gridSelectedRestaurant, onRestaurantSelect }: NaverMapViewProps) => {
    const mapRef = useRef<HTMLDivElement>(null);
    const mapInstanceRef = useRef<any>(null);
    const markersRef = useRef<any[]>([]);
    const restaurantsRef = useRef<Restaurant[]>([]); // 병합된 레스토랑 데이터 참조
    const previousSearchedRestaurantRef = useRef<Restaurant | null>(null); // 이전 searchedRestaurant 추적
    const detailPanelRef = useRef<HTMLDivElement>(null); // 상세 패널 참조
    const { isLoaded, loadError } = useNaverMaps();

    const [isReviewModalOpen, setIsReviewModalOpen] = useState(false);
    const [isPanelOpen, setIsPanelOpen] = useState(false);
    const [panelWidth, setPanelWidth] = useState(0); // 패널 너비 상태

    // selectedRestaurant가 설정되면 자동으로 패널 열기
    useEffect(() => {
        if (selectedRestaurant && !isGridMode) {
            setIsPanelOpen(true);
        } else if (!selectedRestaurant) {
            setIsPanelOpen(false);
        }
    }, [selectedRestaurant, isGridMode]);

    // 패널 너비 측정 (ResizeObserver 사용)
    useEffect(() => {
        if (!detailPanelRef.current || !isPanelOpen) {
            setPanelWidth(0);
            return;
        }

        const resizeObserver = new ResizeObserver((entries) => {
            for (const entry of entries) {
                setPanelWidth(entry.contentRect.width);
            }
        });

        resizeObserver.observe(detailPanelRef.current);

        return () => {
            resizeObserver.disconnect();
        };
    }, [isPanelOpen]);

    // 선택된 맛집이 변경될 때 지도 중앙 재조정
    useEffect(() => {
        if (selectedRestaurant && mapInstanceRef.current && !isGridMode) {
            // 검색된 맛집의 정확한 위치로 이동하고 줌 레벨 설정
            const targetLatLng = new naver.maps.LatLng(selectedRestaurant.lat!, selectedRestaurant.lng!);

            // 줌 레벨을 16으로 설정 (개별 맛집이 보이는 수준)
            mapInstanceRef.current.setZoom(16);

            // 약간의 딜레이 후 지도 중앙 이동 (줌 애니메이션 완료 대기)
            setTimeout(() => {
                if (mapInstanceRef.current && mapRef.current) {
                    let adjustedLng = selectedRestaurant.lng!;

                    if (isPanelOpen && panelWidth > 0) {
                        // 지도의 전체 너비
                        const mapWidth = mapRef.current.clientWidth;

                        // 왼쪽 사이드바 너비 (256px = 64 * 4, Tailwind의 w-64)
                        const sidebarWidth = 256;

                        // 현재 지도의 경도 범위
                        const bounds = mapInstanceRef.current.getBounds();
                        const lngSpan = bounds.maxX() - bounds.minX();

                        // 오른쪽 패널이 가리는 경도 범위
                        const rightPanelLngSpan = lngSpan * (panelWidth / mapWidth);

                        // 왼쪽 사이드바가 가리는 경도 범위
                        const leftSidebarLngSpan = lngSpan * (sidebarWidth / mapWidth);

                        // 보이는 영역의 중심으로 이동
                        // 오른쪽 패널 때문에 → 지도 중심을 동쪽(+)으로 → 마커가 서쪽(왼쪽, 보이는 영역)으로
                        // 왼쪽 사이드바 때문에 → 지도 중심을 서쪽(-)으로 → 마커가 동쪽(오른쪽, 보이는 영역)으로
                        const offset = (rightPanelLngSpan / 2) - (leftSidebarLngSpan / 2);
                        adjustedLng = selectedRestaurant.lng! + offset;
                    }

                    const centerLatLng = new naver.maps.LatLng(selectedRestaurant.lat!, adjustedLng);

                    // 부드러운 애니메이션으로 지도 중앙 이동
                    mapInstanceRef.current.panTo(centerLatLng, {
                        duration: 300
                    });
                }
            }, 50);
        }
    }, [selectedRestaurant, isGridMode, isPanelOpen, panelWidth]);

    const { data: restaurants = [], isLoading: isLoadingRestaurants, refetch } = useRestaurants({
        category: filters.categories.length > 0 ? [filters.categories[0]] : undefined,
        region: selectedRegion || undefined,
        minReviews: filters.minReviews,
        enabled: isLoaded, // 지도가 로드된 후에만 데이터 가져오기
    });

    // 지역 변경 시 로딩 중에도 이전 마커를 유지하기 위한 상태
    const [previousRestaurants, setPreviousRestaurants] = useState<Restaurant[]>([]);

    // restaurants가 변경될 때 이전 데이터를 저장
    useEffect(() => {
        if (restaurants.length > 0 && !isLoadingRestaurants) {
            setPreviousRestaurants(restaurants);
        }
    }, [restaurants, isLoadingRestaurants]);

    // 표시할 마커 데이터 (로딩 중에는 이전 데이터를 사용)
    const displayRestaurants = isLoadingRestaurants && previousRestaurants.length > 0 ? previousRestaurants : restaurants;

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
                background: 'white', // 배경색 명시로 렌더링 최적화
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

        mapInstanceRef.current.setCenter(new naver.maps.LatLng(regionConfig.center[0], regionConfig.center[1]));
        mapInstanceRef.current.setZoom(regionConfig.zoom);
    }, [selectedRegion]);

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

        // 오프셋 없이 정확히 중앙에 배치
        mapInstanceRef.current.setCenter(new naver.maps.LatLng(actualSearchedRestaurant.lat!, actualSearchedRestaurant.lng!));

        mapInstanceRef.current.setZoom(14); // 맛집 상세 보기용 줌 레벨 (약간 줌아웃)

        // 검색된 맛집을 부모 컴포넌트 상태에 설정 (이미 위에서 처리됨)

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
            // 카테고리별 적절한 이모티콘으로 변경
            const getCategoryIcon = (category: string | string[] | null | undefined) => {
                // category가 null이나 undefined면 기본값
                if (!category) return '⭐';

                // category가 배열이면 첫 번째 값 사용
                const categoryStr = Array.isArray(category) ? category[0] : category;

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
                return iconMap[categoryStr] || '⭐'; // 기본값은 별표
            };

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
                // 즉시 selectedRestaurant 설정 (마커 활성화)
                if (onRestaurantSelect) {
                    onRestaurantSelect(restaurant);
                }

                // 패널 열기 (마커 클릭 시에만)
                setIsPanelOpen(true);

                // searchedRestaurant는 설정하지 않음 (지도 이동 방지)
                // selectedRestaurant만으로 마커 활성화
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
        return (
            <div className="flex items-center justify-center h-full bg-muted">
                <div className="text-center space-y-4">
                    <Loader2 className="h-12 w-12 animate-spin mx-auto text-primary" />
                    <div className="space-y-2">
                        <h2 className="text-2xl font-bold bg-gradient-primary bg-clip-text text-transparent">
                            지도 로딩 중...
                        </h2>
                        <p className="text-muted-foreground">
                            쯔양의 맛집을 불러오고 있습니다
                        </p>
                    </div>
                </div>
            </div>
        );
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

                {/* 레스토랑 개수 표시 */}
                {!isLoadingRestaurants && isLoaded && restaurants.length > 0 && (
                    <div className="absolute top-4 left-1/2 -translate-x-1/2 bg-card border border-border rounded-lg px-4 py-2 shadow-lg z-10 flex items-center gap-2">
                        <span className="text-sm font-medium">
                            🔥 {restaurants.length}개의 맛집 발견
                        </span>
                    </div>
                )}
            </div>
        );
    }

    // 단일 지도 모드에서는 resizable 패널 적용
    return (
        <PanelGroup direction="horizontal" className="h-full">
            {/* 지도 패널 */}
            <Panel id="map-panel" order={1} defaultSize={selectedRestaurant && isPanelOpen ? 75 : 100} minSize={40} className="relative">
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

                {/* 레스토랑 개수 표시 */}
                {!isLoadingRestaurants && isLoaded && restaurants.length > 0 && (
                    <div className="absolute top-4 left-1/2 -translate-x-1/2 bg-card border border-border rounded-lg px-4 py-2 shadow-lg z-10 flex items-center gap-2">
                        <span className="text-sm font-medium">
                            🔥 {restaurants.length}개의 맛집 발견
                        </span>
                    </div>
                )}
            </Panel>

            {/* Resize Handle */}
            {selectedRestaurant && isPanelOpen && (
                <PanelResizeHandle className="w-2 bg-border hover:bg-primary/20 transition-colors relative">
                    <div className="absolute inset-y-0 left-1/2 transform -translate-x-1/2 w-1 bg-muted-foreground/30 rounded-full"></div>
                </PanelResizeHandle>
            )}

            {/* 레스토랑 상세 패널 */}
            {selectedRestaurant && isPanelOpen && (
                <Panel id="detail-panel" order={2} defaultSize={25} minSize={20} maxSize={33}>
                    <div ref={detailPanelRef} className="h-full">
                        <RestaurantDetailPanel
                            restaurant={selectedRestaurant}
                            onClose={() => setIsPanelOpen(false)}
                            onWriteReview={() => {
                                setIsReviewModalOpen(true);
                            }}
                            onEditRestaurant={onAdminEditRestaurant ? () => {
                                onAdminEditRestaurant(selectedRestaurant);
                            } : undefined}
                            onRequestEditRestaurant={onRequestEditRestaurant ? () => {
                                onRequestEditRestaurant(selectedRestaurant);
                            } : undefined}
                        />
                    </div>
                </Panel>
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
        </PanelGroup>
    );
});

NaverMapView.displayName = 'NaverMapView';

export default NaverMapView;

