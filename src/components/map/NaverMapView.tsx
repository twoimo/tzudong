import { useEffect, useRef, useState, memo } from "react";
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

// Naver Maps 타입 선언
declare global {
    interface Window {
        naver: any;
    }
}


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
    const { isLoaded, loadError } = useNaverMaps();

    const [isReviewModalOpen, setIsReviewModalOpen] = useState(false);
    const [isPanelOpen, setIsPanelOpen] = useState(false);

    // 선택된 맛집이 변경될 때 지도 중앙 재조정
    useEffect(() => {
        if (selectedRestaurant && mapInstanceRef.current && !isGridMode) {
            // 현재 줌 레벨에 따라 적절한 오프셋 계산
            const currentZoom = mapInstanceRef.current.getZoom();
            const zoomFactor = Math.pow(2, 15 - currentZoom);
            const offsetLng = 0.004 * zoomFactor;

            const targetLatLng = new naver.maps.LatLng(selectedRestaurant.lat, selectedRestaurant.lng - offsetLng);

            // 부드러운 애니메이션으로 지도 중앙 이동
            mapInstanceRef.current.panTo(targetLatLng, {
                duration: 300
            });
        }
    }, [selectedRestaurant, isGridMode]);

    const { data: restaurants = [], isLoading: isLoadingRestaurants, refetch } = useRestaurants({
        category: filters.categories.length > 0 ? [filters.categories[0]] : undefined,
        region: selectedRegion || undefined,
        minReviews: filters.minReviews,
        enabled: isLoaded, // 지도가 로드된 후에만 데이터 가져오기
    });



    // 지도 초기화
    useEffect(() => {
        if (!isLoaded || !mapRef.current || mapInstanceRef.current) return;

        try {
            const { naver } = window;

            // 선택된 지역에 따라 지도 중심과 줌 레벨 설정
            const regionConfig = selectedRegion ? REGION_MAP_CONFIG[selectedRegion] : REGION_MAP_CONFIG["전국"];
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

        const regionConfig = selectedRegion ? REGION_MAP_CONFIG[selectedRegion] : REGION_MAP_CONFIG["전국"];
        const { naver } = window;

        mapInstanceRef.current.setCenter(new naver.maps.LatLng(regionConfig.center[0], regionConfig.center[1]));
        mapInstanceRef.current.setZoom(regionConfig.zoom);
    }, [selectedRegion]); // eslint-disable-line react-hooks/exhaustive-deps

    // 검색된 맛집 선택 시 지도 중심 이동 및 선택 상태 설정
    useEffect(() => {
        if (!searchedRestaurant || !mapInstanceRef.current) return;

        const { naver } = window;

        // 상세 패널이 이미 열려있는 경우 중심을 오른쪽으로 조정 (패널이 지도를 가리지 않도록)
        if (selectedRestaurant && selectedRestaurant.id !== searchedRestaurant.id) {
            // 다른 맛집의 상세 패널이 열려있을 때는 중심을 오른쪽으로 0.008도 이동 (약 800m)
            const adjustedLng = searchedRestaurant.lng + 0.008;
            mapInstanceRef.current.setCenter(new naver.maps.LatLng(searchedRestaurant.lat, adjustedLng));
        } else {
            // 상세 패널이 닫혀있거나 같은 맛집을 다시 선택한 경우 그대로 중심 설정
            mapInstanceRef.current.setCenter(new naver.maps.LatLng(searchedRestaurant.lat, searchedRestaurant.lng));
        }

        mapInstanceRef.current.setZoom(15); // 맛집 상세 보기용 줌 레벨

        // 검색된 맛집을 부모 컴포넌트 상태에 설정
        if (onRestaurantSelect) {
            onRestaurantSelect(searchedRestaurant);
        }

        // 패널 열기 (검색 시에만)
        setIsPanelOpen(true);

        // 토스트 메시지 표시
        toast.success(`"${searchedRestaurant.name}" 맛집을 찾았습니다!`);
    }, [searchedRestaurant]); // eslint-disable-line react-hooks/exhaustive-deps

    // 마커 업데이트 (최적화됨)
    useEffect(() => {
        if (!mapInstanceRef.current || !window.naver) {
            return;
        }

        const { naver } = window;

        // requestAnimationFrame을 사용하여 렌더링 최적화
        requestAnimationFrame(() => {
            // 기존 마커 제거 (배치로 처리)
            const oldMarkers = markersRef.current;
            oldMarkers.forEach(marker => marker.setMap(null));
            markersRef.current = [];

            // 마커를 표시할 맛집 목록 생성 (기존 restaurants + 검색된 맛집)
            const restaurantsToShow = [...restaurants];

            // 검색된 맛집이 기존 목록에 없는 경우 추가
            if (searchedRestaurant && !restaurants.find(r => r.id === searchedRestaurant.id)) {
                restaurantsToShow.push(searchedRestaurant);
            }

            // restaurants가 없으면 마커만 제거하고 종료
            if (restaurantsToShow.length === 0) {
                return;
            }

            // 마커 생성 대상
            const markersToCreate = restaurantsToShow;

            // 새 마커 배열 준비
            const newMarkers: any[] = [];

            // 모든 마커를 한 번에 생성 (DOM 조작 최소화)
            markersToCreate.forEach((restaurant) => {
                // 그리드 모드에서는 gridSelectedRestaurant, 단일 모드에서는 props의 selectedRestaurant 사용
                const currentSelectedRestaurant = isGridMode ? gridSelectedRestaurant : selectedRestaurant;
                const isSelected = currentSelectedRestaurant && currentSelectedRestaurant.id === restaurant.id;
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
                        '찜·탕': '🥘',
                        '야식': '🌙',
                        '도시락': '🍱'
                    };
                    return iconMap[category] || '⭐'; // 기본값은 별표
                };

                const icon = getCategoryIcon(restaurant.category);

                // 선택된 맛집은 더 큰 크기와 강조 효과
                const size = isSelected ? 36 : 28;

                const markerContent = `<div class="marker-icon ${isSelected ? 'selected-marker' : ''}" style="
                    color: white;
                    border-radius: 50%;
                    width: ${size}px;
                    height: ${size}px;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    font-size: ${isSelected ? 15 : 13}px;
                ">${icon}</div>`;

                const marker = new naver.maps.Marker({
                    position: new naver.maps.LatLng(restaurant.lat, restaurant.lng),
                    map: mapInstanceRef.current,
                    icon: {
                        content: markerContent,
                        anchor: new naver.maps.Point(12, 12),
                    },
                    title: restaurant.name,
                });

                // 마커 클릭 이벤트
                naver.maps.Event.addListener(marker, "click", () => {
                    // 모든 모드에서 부모 컴포넌트로 맛집 선택 전달 (단일 모드에서도 상태 일관성 유지)
                    if (onRestaurantSelect) {
                        onRestaurantSelect(restaurant);
                    }

                    // 패널 열기 (마커 클릭 시에만)
                    setIsPanelOpen(true);

                    // 마커 클릭 시 지도 이동 제거 - 상세 패널 열릴 때 이동 수행
                });

                newMarkers.push(marker);
            });

            // 모든 마커를 한 번에 할당
            markersRef.current = newMarkers;
        });

        // 지도 중심은 초기 위치 유지 (한반도 전체 보기)
        // 마커 표시 후 자동 이동하지 않음
    }, [restaurants, refreshTrigger, selectedRegion, searchedRestaurant, selectedRestaurant]);

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

            {/* 레스토랑 상세 패널 - 그리드 모드에서는 간소화된 모달로 표시 */}
            {!isGridMode && selectedRestaurant && isPanelOpen && (
                <div className="absolute right-0 top-0 h-full w-96 z-20 shadow-xl">
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

