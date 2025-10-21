import { useEffect, useRef, useState } from "react";

// Mock restaurant data
const mockRestaurants = [
  {
    id: 1,
    name: "홍대 떡볶이 맛집",
    lat: 37.5563,
    lng: 126.9236,
    rating: 4.5,
    category: "분식",
    reviews: 128,
  },
  {
    id: 2,
    name: "강남 삼겹살",
    lat: 37.4979,
    lng: 127.0276,
    rating: 3.8,
    category: "고기",
    reviews: 95,
  },
  {
    id: 3,
    name: "명동 칼국수",
    lat: 37.5636,
    lng: 126.9834,
    rating: 4.7,
    category: "한식",
    reviews: 201,
  },
];

const MapView = () => {
  const mapRef = useRef<HTMLDivElement>(null);
  const [selectedRestaurant, setSelectedRestaurant] = useState<typeof mockRestaurants[0] | null>(null);

  useEffect(() => {
    // Google Maps will be integrated here
    // For now, showing a placeholder
  }, []);

  return (
    <div className="relative w-full h-full">
      {/* Map container */}
      <div ref={mapRef} className="w-full h-full bg-muted">
        <div className="flex items-center justify-center h-full">
          <div className="text-center space-y-4">
            <div className="text-6xl">🗺️</div>
            <div className="space-y-2">
              <h2 className="text-2xl font-bold bg-gradient-primary bg-clip-text text-transparent">
                구글맵 연동 준비중
              </h2>
              <p className="text-muted-foreground">
                쯔양의 맛집을 한눈에 확인하세요
              </p>
            </div>

            {/* Mock markers preview */}
            <div className="mt-8 flex gap-4 justify-center">
              {mockRestaurants.map((restaurant) => (
                <button
                  key={restaurant.id}
                  onClick={() => setSelectedRestaurant(restaurant)}
                  className="bg-card border border-border rounded-lg p-4 hover:shadow-primary transition-all hover:scale-105"
                >
                  <div className="text-2xl mb-2">
                    {restaurant.rating >= 4 ? "🔥" : "⭐"}
                  </div>
                  <div className="text-sm font-semibold">{restaurant.name}</div>
                  <div className="text-xs text-muted-foreground mt-1">
                    ⭐ {restaurant.rating} · {restaurant.reviews} 리뷰
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Restaurant detail panel */}
      {selectedRestaurant && (
        <div className="absolute right-4 top-4 w-80 bg-card border border-border rounded-lg shadow-primary p-4 space-y-4">
          <div className="flex justify-between items-start">
            <div>
              <h3 className="font-bold text-lg">{selectedRestaurant.name}</h3>
              <div className="flex items-center gap-2 mt-1">
                <span className="text-sm bg-accent text-accent-foreground px-2 py-1 rounded">
                  {selectedRestaurant.category}
                </span>
              </div>
            </div>
            <button
              onClick={() => setSelectedRestaurant(null)}
              className="text-muted-foreground hover:text-foreground"
            >
              ✕
            </button>
          </div>

          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <span className="text-2xl">⭐</span>
              <span className="font-semibold">{selectedRestaurant.rating}</span>
              <span className="text-sm text-muted-foreground">
                ({selectedRestaurant.reviews} 리뷰)
              </span>
            </div>
          </div>

          <div className="pt-4 border-t border-border">
            <button className="w-full bg-gradient-primary text-primary-foreground py-2 rounded-lg font-semibold hover:opacity-90 transition-opacity">
              리뷰 작성하기
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default MapView;
