import { useEffect, useRef, useState, memo } from "react";
import { useNaverMaps } from "@/hooks/use-naver-maps";
import { useRestaurants } from "@/hooks/use-restaurants";
import { FilterState } from "@/components/filters/FilterPanel";
import { Restaurant } from "@/types/restaurant";
import { RestaurantDetailPanel } from "@/components/restaurant/RestaurantDetailPanel";
import { ReviewModal } from "@/components/reviews/ReviewModal";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";

interface NaverMapViewProps {
    filters: FilterState;
    refreshTrigger: number;
    onAdminAddRestaurant?: () => void;
    onAdminEditRestaurant?: (restaurant: Restaurant) => void;
}

const NaverMapView = memo(({ filters, refreshTrigger, onAdminEditRestaurant }: NaverMapViewProps) => {
    const mapRef = useRef<HTMLDivElement>(null);
    const mapInstanceRef = useRef<any>(null);
    const markersRef = useRef<any[]>([]);
    const { isLoaded, loadError } = useNaverMaps();

    const [selectedRestaurant, setSelectedRestaurant] = useState<Restaurant | null>(null);
    const [isReviewModalOpen, setIsReviewModalOpen] = useState(false);

    const { data: restaurants = [], isLoading: isLoadingRestaurants, refetch } = useRestaurants({
        category: filters.categories.length > 0 ? [filters.categories[0]] : undefined,
        minRating: filters.minRating,
        minReviews: filters.minReviews,
        minUserVisits: filters.minUserVisits,
        minJjyangVisits: filters.minJjyangVisits,
        enabled: isLoaded, // 지도가 로드된 후에만 데이터 가져오기
    });

    const isDummyData = restaurants.length > 0 && restaurants[0].id.startsWith('dummy-');

    // 디버깅: 레스토랑 데이터 상태 로그
    useEffect(() => {
        console.log('🍽️ 레스토랑 데이터 상태:', {
            count: restaurants.length,
            isLoading: isLoadingRestaurants,
            isDummy: isDummyData,
            isLoaded,
            hasMap: !!mapInstanceRef.current,
            refreshTrigger
        });
    }, [restaurants, isLoadingRestaurants, isDummyData, isLoaded, refreshTrigger]);

    // 지도 초기화
    useEffect(() => {
        if (!isLoaded || !mapRef.current || mapInstanceRef.current) return;

        try {
            const { naver } = window;

            // 한반도 전체(제주도 포함)가 보이도록 지도 생성
            const map = new naver.maps.Map(mapRef.current, {
                center: new naver.maps.LatLng(36.5, 127.5), // 한반도 중앙
                zoom: 7, // 제주도까지 포함되는 줌 레벨
                minZoom: 6,
                maxZoom: 18,
                zoomControl: true,
                zoomControlOptions: {
                    position: naver.maps.Position.TOP_RIGHT,
                },
                mapTypeControl: true,
                mapTypeControlOptions: {
                    position: naver.maps.Position.TOP_LEFT,
                },
            });

            mapInstanceRef.current = map;
        } catch (error) {
            console.error("네이버 지도 초기화 오류:", error);
            toast.error("지도를 초기화하는 중 오류가 발생했습니다.");
        }
    }, [isLoaded]);

    // 마커 업데이트 (최적화됨)
    useEffect(() => {
        console.log('🔄 마커 업데이트 useEffect 실행:', {
            hasMap: !!mapInstanceRef.current,
            hasNaver: !!window.naver,
            restaurantCount: restaurants.length
        });

        if (!mapInstanceRef.current || !window.naver) {
            console.warn('⚠️ 지도 또는 네이버 객체가 없음');
            return;
        }

        const { naver } = window;

        // requestAnimationFrame을 사용하여 렌더링 최적화
        requestAnimationFrame(() => {
            console.log('🎨 requestAnimationFrame 실행');

            // 기존 마커 제거 (배치로 처리)
            const oldMarkers = markersRef.current;
            console.log(`🗑️ 기존 마커 ${oldMarkers.length}개 제거 중`);
            oldMarkers.forEach(marker => marker.setMap(null));
            markersRef.current = [];

            // restaurants가 없으면 마커만 제거하고 종료
            if (restaurants.length === 0) {
                console.log('🗺️ 레스토랑 데이터 없음, 마커 제거됨');
                return;
            }

            console.log(`📍 ${restaurants.length}개 레스토랑 마커 생성 시작`);

            // 새 마커 배열 준비
            const newMarkers: any[] = [];

            // 모든 마커를 한 번에 생성 (DOM 조작 최소화)
            restaurants.forEach((restaurant) => {
                const isHotPlace = (restaurant.ai_rating ?? 0) >= 4;
                const icon = isHotPlace ? '🔥' : '⭐';

                // 간단한 HTML 마커 (인라인 스타일 최소화)
                const markerContent = `<div class="marker-icon">${icon}</div>`;

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
                    setSelectedRestaurant(restaurant);
                });

                newMarkers.push(marker);
            });

            // 모든 마커를 한 번에 할당
            markersRef.current = newMarkers;
            console.log(`✅ ${newMarkers.length}개 마커 표시됨`);
        });

        // 지도 중심은 초기 위치 유지 (한반도 전체 보기)
        // 마커 표시 후 자동 이동하지 않음
    }, [restaurants, isDummyData, refreshTrigger]);

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
                    {isDummyData && (
                        <Badge variant="secondary" className="text-xs">
                            📊 샘플
                        </Badge>
                    )}
                </div>
            )}

            {/* 레스토랑 상세 패널 */}
            {selectedRestaurant && (
                <div className="absolute right-0 top-0 h-full w-96 z-20 shadow-xl">
                    <RestaurantDetailPanel
                        restaurant={selectedRestaurant}
                        onClose={() => setSelectedRestaurant(null)}
                        onWriteReview={() => {
                            setIsReviewModalOpen(true);
                        }}
                        onEditRestaurant={onAdminEditRestaurant ? () => {
                            onAdminEditRestaurant(selectedRestaurant);
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

