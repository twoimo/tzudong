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
  className?: string;
}

const RestaurantSearch = ({ onRestaurantSelect, onSearchExecute, className }: RestaurantSearchProps) => {
  const [searchQuery, setSearchQuery] = useState("");
  const [isFocused, setIsFocused] = useState(false);
  const searchRef = useRef<HTMLDivElement>(null);

  // 맛집 검색 쿼리 (전체 맛집 대상)
  const { data: restaurants = [], isLoading } = useQuery({
    queryKey: ["restaurant-search", searchQuery],
    queryFn: async () => {
      if (!searchQuery.trim()) return [];

      const { data, error } = await supabase
        .from("restaurants")
        .select("*")
        .ilike("name", `%${searchQuery}%`)
        .limit(10);

      if (error) throw error;
      return data as Restaurant[];
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
    onRestaurantSelect(restaurant);
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
          placeholder="맛집 검색..."
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
