import { useEffect, useRef, useState } from "react";
import { useGoogleMaps } from "@/hooks/use-google-maps";
import { useRestaurants } from "@/hooks/use-restaurants";
import { Restaurant } from "@/types/restaurant";
import { FilterState } from "@/components/filters/FilterPanel";
import { ReviewModal } from "@/components/reviews/ReviewModal";
import { Loader2 } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";

const SEOUL_CENTER = { lat: 37.5665, lng: 126.9780 };
const INITIAL_ZOOM = 12;

interface MapViewProps {
  filters: FilterState;
  refreshTrigger?: number;
  onAdminAddRestaurant?: () => void;
}

const MapView = ({ filters, refreshTrigger, onAdminAddRestaurant }: MapViewProps) => {
  const { user } = useAuth();
  const mapRef = useRef<HTMLDivElement>(null);
  const googleMapRef = useRef<google.maps.Map | null>(null);
  const markersRef = useRef<google.maps.marker.AdvancedMarkerElement[]>([]);

  const [selectedRestaurant, setSelectedRestaurant] = useState<Restaurant | null>(null);
  const [mapBounds, setMapBounds] = useState<google.maps.LatLngBounds | null>(null);
  const [isReviewModalOpen, setIsReviewModalOpen] = useState(false);

  const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY || "";
  const { isLoaded, loadError } = useGoogleMaps({ apiKey });

  const { data: restaurants = [], isLoading: isLoadingRestaurants, refetch } = useRestaurants({
    bounds: mapBounds ? {
      south: mapBounds.getSouthWest().lat(),
      west: mapBounds.getSouthWest().lng(),
      north: mapBounds.getNorthEast().lat(),
      east: mapBounds.getNorthEast().lng(),
    } : undefined,
    category: filters.categories.length > 0 ? filters.categories : undefined,
    minRating: filters.minRating,
    minReviews: filters.minReviews,
    minVisits: filters.minVisits,
    enabled: isLoaded && !!mapBounds,
  });

  // Refetch when refreshTrigger changes
  useEffect(() => {
    if (refreshTrigger) {
      refetch();
    }
  }, [refreshTrigger, refetch]);

  // Initialize map
  useEffect(() => {
    if (!isLoaded || !mapRef.current) return;

    const map = new google.maps.Map(mapRef.current, {
      center: SEOUL_CENTER,
      zoom: INITIAL_ZOOM,
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
      }
    });
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
      const markerType = (restaurant.ai_rating ?? 0) >= 4 ? "fire" : "star";
      const icon = markerType === "fire" ? "🔥" : "⭐";

      const markerElement = document.createElement("div");
      markerElement.className = "custom-marker";
      markerElement.innerHTML = `
        <div class="flex flex-col items-center cursor-pointer transform transition-transform hover:scale-110">
          <div class="text-2xl">${icon}</div>
        </div>
      `;

      const marker = new google.maps.marker.AdvancedMarkerElement({
        map: googleMapRef.current,
        position: { lat: Number(restaurant.lat), lng: Number(restaurant.lng) },
        content: markerElement,
        title: restaurant.name,
      });

      markerElement.addEventListener("click", () => {
        setSelectedRestaurant(restaurant);
        googleMapRef.current?.panTo({ lat: Number(restaurant.lat), lng: Number(restaurant.lng) });
      });

      markersRef.current.push(marker);
    });
  }, [restaurants, isLoaded]);

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
              Google Maps API를 불러오는데 실패했습니다.
            </p>
            <p className="text-sm text-muted-foreground">
              .env.local 파일에 VITE_GOOGLE_MAPS_API_KEY를 설정해주세요.
            </p>
          </div>
        </div>
      </div>
    );
  }

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
    <div className="relative w-full h-full">
      {/* Map container */}
      <div ref={mapRef} className="w-full h-full" />

      {/* Loading indicator */}
      {isLoadingRestaurants && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 bg-card border border-border rounded-lg px-4 py-2 shadow-lg flex items-center gap-2">
          <Loader2 className="h-4 w-4 animate-spin text-primary" />
          <span className="text-sm font-medium">맛집 로딩 중...</span>
        </div>
      )}

      {/* Restaurant count */}
      {!isLoadingRestaurants && restaurants.length > 0 && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 bg-card border border-border rounded-lg px-4 py-2 shadow-lg">
          <span className="text-sm font-medium">
            🔥 {restaurants.length}개의 맛집 발견
          </span>
        </div>
      )}

      {/* Admin Add Button */}
      {onAdminAddRestaurant && (
        <button
          onClick={onAdminAddRestaurant}
          className="absolute bottom-8 right-8 bg-gradient-primary text-primary-foreground px-6 py-3 rounded-full shadow-lg hover:opacity-90 transition-opacity font-semibold flex items-center gap-2"
        >
          <span className="text-xl">+</span>
          맛집 등록
        </button>
      )}

      {/* Restaurant detail panel */}
      {selectedRestaurant && (
        <div className="absolute right-4 top-4 w-80 bg-card border border-border rounded-lg shadow-primary p-4 space-y-4 max-h-[calc(100vh-8rem)] overflow-y-auto">
          <div className="flex justify-between items-start">
            <div className="flex-1">
              <h3 className="font-bold text-lg">{selectedRestaurant.name}</h3>
              <div className="flex items-center gap-2 mt-1">
                <span className="text-sm bg-accent text-accent-foreground px-2 py-1 rounded">
                  {selectedRestaurant.category}
                </span>
              </div>
            </div>
            <button
              onClick={() => setSelectedRestaurant(null)}
              className="text-muted-foreground hover:text-foreground ml-2"
            >
              ✕
            </button>
          </div>

          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <span className="text-2xl">
                {(selectedRestaurant.ai_rating ?? 0) >= 4 ? "🔥" : "⭐"}
              </span>
              <span className="font-semibold">
                AI 점수: {selectedRestaurant.ai_rating ?? "N/A"}
              </span>
            </div>
            <div className="text-sm text-muted-foreground">
              📍 {selectedRestaurant.address}
            </div>
            {selectedRestaurant.phone && (
              <div className="text-sm text-muted-foreground">
                📞 {selectedRestaurant.phone}
              </div>
            )}
            <div className="flex gap-4 text-sm">
              <span>👥 방문: {selectedRestaurant.visit_count ?? 0}회</span>
              <span>💬 리뷰: {selectedRestaurant.review_count ?? 0}개</span>
            </div>
          </div>

          {selectedRestaurant.tzuyang_review && (
            <div className="pt-2 border-t border-border">
              <h4 className="font-semibold text-sm mb-2">🎬 쯔양 리뷰</h4>
              <p className="text-sm text-muted-foreground">
                {selectedRestaurant.tzuyang_review}
              </p>
            </div>
          )}

          {selectedRestaurant.youtube_link && (
            <div className="pt-2">
              <a
                href={selectedRestaurant.youtube_link}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm text-primary hover:underline flex items-center gap-1"
              >
                🎥 유튜브 영상 보기 →
              </a>
            </div>
          )}

          <div className="pt-4 border-t border-border">
            <button
              onClick={() => {
                if (!user) {
                  alert("로그인이 필요합니다");
                  return;
                }
                setIsReviewModalOpen(true);
              }}
              className="w-full bg-gradient-primary text-primary-foreground py-2 rounded-lg font-semibold hover:opacity-90 transition-opacity"
            >
              리뷰 작성하기
            </button>
          </div>
        </div>
      )}

      {/* Review Modal */}
      {selectedRestaurant && isReviewModalOpen && (
        <ReviewModal
          isOpen={isReviewModalOpen}
          onClose={() => setIsReviewModalOpen(false)}
          restaurant={selectedRestaurant}
        />
      )}
    </div>
  );
};

export default MapView;
