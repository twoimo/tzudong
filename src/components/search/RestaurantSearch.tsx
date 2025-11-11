import { useState, useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Restaurant } from "@/types/restaurant";
import { Input } from "@/components/ui/input";
import { Search, MapPin, X } from "lucide-react";
import { cn } from "@/lib/utils";

interface RestaurantSearchProps {
  onRestaurantSelect: (restaurant: Restaurant) => void;
  onSearchExecute?: () => void; // 그리드 모드에서 검색 실행 시 호출
  onRestaurantSearch?: (restaurant: Restaurant) => void; // 검색 시 별도 처리
  className?: string;
}

const RestaurantSearch = ({ onRestaurantSelect, onSearchExecute, onRestaurantSearch, className }: RestaurantSearchProps) => {
  const [searchQuery, setSearchQuery] = useState("");
  const [isFocused, setIsFocused] = useState(false);
  const searchRef = useRef<HTMLDivElement>(null);

  // 맛집 검색 쿼리 (전체 맛집 대상)
  const { data: restaurants = [], isLoading } = useQuery({
    queryKey: ["restaurant-search", searchQuery],
    queryFn: async () => {
      if (!searchQuery.trim()) return [];

      const trimmedQuery = searchQuery.trim();

      // 1. 맛집 이름으로 검색 (RPC 함수 사용 - Trigram 유사도 기반)
      let nameResults: any = null;
      try {
        const rpcResult = await (supabase as any).rpc("search_restaurants_by_name", {
          search_query: trimmedQuery,
          similarity_threshold: 0.001,  // SQL 기본값과 동일하게 낮춤
          max_results: 50,
        });
        nameResults = rpcResult.data;
        
        if (rpcResult.error) {
          console.warn("맛집 이름 검색 실패:", rpcResult.error);
        }
      } catch (error) {
        console.warn("맛집 이름 검색 오류:", error);
      }

      // SQL에서 이미 필터링했으므로 그대로 사용
      const nameResultsArray = (nameResults || []) as Restaurant[];

      // 2. YouTube 제목으로 검색 (RPC 함수 사용)
      let youtubeResults: any = null;
      try {
        const rpcResult = await (supabase as any).rpc("search_restaurants_by_youtube_title", {
          search_query: trimmedQuery,
          similarity_threshold: 0.01,  // 일관성을 위해 동일하게 설정
          max_results: 50,
        });
        youtubeResults = rpcResult.data;
        
        if (rpcResult.error) {
          console.warn("YouTube 제목 검색 실패:", rpcResult.error);
        }
      } catch (error) {
        console.warn("YouTube 제목 검색 오류:", error);
      }

      // 3. 두 결과 병합 (ID 기준 중복 제거)
      const youtubeResultsArray = ((youtubeResults || []) as Restaurant[])
        .filter(r => r.status === "approved"); // YouTube 결과도 approved만
      
      const restaurantMap = new Map<string, Restaurant>();
      
      // 이름 검색 결과 추가
      nameResultsArray.forEach(restaurant => {
        restaurantMap.set(restaurant.id, restaurant);
      });

      // YouTube 결과 중 없는 것만 추가
      youtubeResultsArray.forEach(restaurant => {
        if (!restaurantMap.has(restaurant.id)) {
          restaurantMap.set(restaurant.id, restaurant);
        }
      });

      // 4. 같은 음식점명 중복 제거 (첫 번째 것만 유지)
      const seenNames = new Set<string>();
      const uniqueResults: Restaurant[] = [];

      for (const restaurant of restaurantMap.values()) {
        const normalizedName = restaurant.name.trim().toLowerCase();
        if (!seenNames.has(normalizedName)) {
          seenNames.add(normalizedName);
          uniqueResults.push(restaurant);
        }
      }

      // 5. 최대 10개로 제한
      return uniqueResults.slice(0, 10);
    },
    enabled: searchQuery.length > 0,
  });

  // 외부 클릭 시 검색 결과 숨김
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (searchRef.current && !searchRef.current.contains(event.target as Node)) {
        setIsFocused(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleSelect = (restaurant: Restaurant) => {
    // 검색 시에는 별도 콜백 호출 (지도 재조정용)
    if (onRestaurantSearch) {
      onRestaurantSearch(restaurant);
    } else {
      onRestaurantSelect(restaurant);
    }
    // 그리드 모드에서 검색 실행 시 콜백 호출
    onSearchExecute?.();
    setSearchQuery("");
    setIsFocused(false);
  };

  const clearSearch = () => {
    setSearchQuery("");
    setIsFocused(false);
  };

  const showResults = isFocused && (searchQuery.length > 0 || restaurants.length > 0);

  return (
    <div ref={searchRef} className={cn("relative", className)}>
      <div className="relative">
        <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="맛집 이름 또는 유튜브 제목 검색..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          onFocus={() => setIsFocused(true)}
          className="pl-10 pr-10 w-[300px]"
        />
        {searchQuery && (
          <button
            onClick={clearSearch}
            className="absolute right-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      {/* 검색 결과 드롭다운 */}
      {showResults && (
        <div className="absolute bottom-full left-0 right-0 mb-1 bg-background border border-border rounded-md shadow-lg z-50 max-h-64 overflow-y-auto">
          {isLoading ? (
            <div className="p-3 text-sm text-muted-foreground">검색 중...</div>
          ) : restaurants.length > 0 ? (
            restaurants.map((restaurant) => (
              <button
                key={restaurant.id}
                onClick={() => handleSelect(restaurant)}
                className="w-full text-left p-3 hover:bg-muted border-b border-border last:border-b-0 flex items-center gap-2"
              >
                <MapPin className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                <div className="flex flex-col min-w-0">
                  <span className="font-medium truncate">{restaurant.name}</span>
                  <span className="text-sm text-muted-foreground truncate">
                    {restaurant.address}
                  </span>
                </div>
              </button>
            ))
          ) : searchQuery ? (
            <div className="p-3 text-sm text-muted-foreground">검색 결과가 없습니다.</div>
          ) : null}
        </div>
      )}
    </div>
  );
};

export default RestaurantSearch;
