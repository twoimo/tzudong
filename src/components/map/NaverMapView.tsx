import { useEffect, useRef, useState } from "react";
import { useNaverMaps } from "@/hooks/use-naver-maps";
import { useRestaurants } from "@/hooks/use-restaurants";
import { FilterState } from "@/components/filters/FilterPanel";
import { Restaurant } from "@/types/restaurant";
import { RestaurantDetailPanel } from "@/components/restaurant/RestaurantDetailPanel";
import { ReviewModal } from "@/components/reviews/ReviewModal";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";

interface NaverMapViewProps {
    filters: FilterState;
    refreshTrigger: number;
    onAdminAddRestaurant?: () => void;
}

const NaverMapView = ({ filters, refreshTrigger }: NaverMapViewProps) => {
    const mapRef = useRef<HTMLDivElement>(null);
    const mapInstanceRef = useRef<any>(null);
    const markersRef = useRef<any[]>([]);
    const { isLoaded, loadError } = useNaverMaps();

    const [selectedRestaurant, setSelectedRestaurant] = useState<Restaurant | null>(null);
    const [isReviewModalOpen, setIsReviewModalOpen] = useState(false);

    const { data: restaurants = [], isLoading: isLoadingRestaurants, refetch } = useRestaurants({
        category: filters.categories.length > 0 ? filters.categories[0] : undefined,
        minRating: filters.minRating,
        minReviews: filters.minReviews,
        minUserVisits: filters.minUserVisits,
        minJjyangVisits: filters.minJjyangVisits,
        enabled: true,
    });

    const isDummyData = restaurants.length > 0 && restaurants[0].id.startsWith('dummy-');

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

    // 마커 업데이트
    useEffect(() => {
        if (!mapInstanceRef.current || !window.naver) return;

        // 기존 마커 제거
        markersRef.current.forEach(marker => marker.setMap(null));
        markersRef.current = [];

        const { naver } = window;

        // 새 마커 추가
        restaurants.forEach((restaurant) => {
            const isHotPlace = (restaurant.ai_rating ?? 0) >= 4;

            // HTML 마커 생성 (이모티콘만 표시)
            const markerContent = `
        <div style="
          position: relative;
          font-size: 32px;
          cursor: pointer;
          transition: transform 0.2s;
          filter: drop-shadow(0 2px 4px rgba(0,0,0,0.3));
        " onmouseover="this.style.transform='scale(1.2)'" onmouseout="this.style.transform='scale(1)'">
          ${isHotPlace ? '🔥' : '⭐'}
        </div>
      `;

            const marker = new naver.maps.Marker({
                position: new naver.maps.LatLng(restaurant.lat, restaurant.lng),
                map: mapInstanceRef.current,
                icon: {
                    content: markerContent,
                    anchor: new naver.maps.Point(16, 16),
                },
                title: restaurant.name,
            });

            // 마커 클릭 이벤트
            naver.maps.Event.addListener(marker, "click", () => {
                setSelectedRestaurant(restaurant);
            });

            markersRef.current.push(marker);
        });

        // 첫 번째 레스토랑으로 지도 중심 이동 (레스토랑이 있을 경우)
        if (restaurants.length > 0 && !isDummyData) {
            const firstRestaurant = restaurants[0];
            mapInstanceRef.current.setCenter(
                new naver.maps.LatLng(firstRestaurant.lat, firstRestaurant.lng)
            );
        }
    }, [restaurants, isDummyData]);

    // 로딩 에러 처리
    if (loadError) {
        return (
            <div className="h-full flex items-center justify-center bg-muted">
                <div className="text-center space-y-2">
                    <p className="text-lg font-semibold text-destructive">⚠️ 지도 로드 실패</p>
                    <p className="text-sm text-muted-foreground">{loadError.message}</p>
                    <p className="text-xs text-muted-foreground">
                        네이버 지도 API 설정을 확인해주세요.
                    </p>
                </div>
            </div>
        );
    }

    // 로딩 중
    if (!isLoaded) {
        return (
            <div className="h-full flex items-center justify-center bg-muted">
                <div className="text-center space-y-2">
                    <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto"></div>
                    <p className="text-sm text-muted-foreground">네이버 지도 로딩 중...</p>
                </div>
            </div>
        );
    }

    return (
        <div className="relative h-full">
            {/* 지도 컨테이너 */}
            <div ref={mapRef} className="w-full h-full" />

            {/* 레스토랑 개수 표시 */}
            {!isLoadingRestaurants && restaurants.length > 0 && (
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
                    />
                </div>
            )}

            {/* 리뷰 작성 모달 */}
            {selectedRestaurant && (
                <ReviewModal
                    isOpen={isReviewModalOpen}
                    onClose={() => setIsReviewModalOpen(false)}
                    restaurantId={selectedRestaurant.id}
                    restaurantName={selectedRestaurant.name}
                    onSuccess={() => {
                        refetch();
                        toast.success("리뷰가 성공적으로 등록되었습니다!");
                    }}
                />
            )}
        </div>
    );
};

export default NaverMapView;

