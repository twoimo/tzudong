import { useState, useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Restaurant } from "@/types/restaurant";
import { mergeRestaurants } from "@/hooks/use-restaurants";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Search, MapPin, X, Video } from "lucide-react";
import { cn } from "@/lib/utils";
import { FilterState } from "@/components/filters/FilterPanel";

interface RestaurantSearchProps {
  onRestaurantSelect: (restaurant: Restaurant) => void;
  onSearchExecute?: () => void; // 그리드 모드에서 검색 실행 시 호출
  onRestaurantSearch?: (restaurant: Restaurant) => void; // 검색 시 별도 처리
  className?: string;
  filters?: FilterState; // 필터 상태 추가
  selectedRegion?: string | null; // 선택된 지역 (국가)
  isKoreanOnly?: boolean; // 한국 지역만 필터링 (홈페이지용)
}

type SearchType = 'name' | 'youtube';

const RestaurantSearch = ({ 
  onRestaurantSelect, 
  onSearchExecute, 
  onRestaurantSearch, 
  className, 
  filters, 
  selectedRegion,
  isKoreanOnly = false 
}: RestaurantSearchProps) => {
  const [searchQuery, setSearchQuery] = useState("");
  const [isFocused, setIsFocused] = useState(false);
  const [searchType, setSearchType] = useState<SearchType>('name');
  const searchRef = useRef<HTMLDivElement>(null);

  // 한국 지역 목록 (홈페이지 필터링용)
  const KOREAN_REGIONS = [
    "서울특별시", "부산광역시", "대구광역시", "인천광역시", "광주광역시",
    "대전광역시", "울산광역시", "세종특별자치시",
    "경기도", "강원특별자치도", "충청북도", "충청남도",
    "전북특별자치도", "전라남도", "경상북도", "경상남도", "제주특별자치도"
  ];

  // 맛집 검색 쿼리
  const { data: restaurants = [], isLoading } = useQuery({
    queryKey: ["restaurant-search", searchQuery, searchType, filters?.categories, selectedRegion, isKoreanOnly],
    queryFn: async () => {
      if (!searchQuery.trim()) return [];

      const trimmedQuery = searchQuery.trim();
      let results: Restaurant[] = [];

      try {
        if (searchType === 'name') {
          // 맛집 이름으로 검색
          const categoriesToSearch = filters?.categories && filters.categories.length > 0 
            ? filters.categories 
            : null;

          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const { data, error } = await (supabase as any).rpc("search_restaurants_by_name", {
            search_query: trimmedQuery,
            search_categories: categoriesToSearch,
            max_results: 50,
            include_all_status: false,
            korean_only: isKoreanOnly,  // 한국 지역만 필터링 (홈페이지용)
          });

          if (error) {
            console.warn("맛집 이름 검색 실패:", error);
            return [];
          }

          results = (data || []) as Restaurant[];
        } else {
          // 유튜브 제목으로 검색
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const { data, error } = await (supabase as any).rpc("search_restaurants_by_youtube_title", {
            search_query: trimmedQuery,
            max_results: 50,
            include_all_status: false,  // 일반 사용자는 approved만 표시
            korean_only: isKoreanOnly,  // 한국 지역만 필터링 (홈페이지용)
          });

          if (error) {
            console.warn("유튜브 제목 검색 실패:", error);
            return [];
          }

          results = (data || []) as Restaurant[];
        }

        // 지역 필터 적용 (글로벌 페이지용 - 선택된 국가로 필터링)
        if (!isKoreanOnly && selectedRegion) {
          results = results.filter((restaurant: Restaurant) => {
            const address = restaurant.road_address || restaurant.jibun_address || restaurant.english_address || '';
            return address.includes(selectedRegion);
          });
        }

        // 병합 로직 적용 (동일한 상호명 처리)
        const merged = mergeRestaurants(results);

        // 최대 10개로 제한
        return merged.slice(0, 10);
      } catch (error) {
        console.error("검색 오류:", error);
        return [];
      }
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

  const toggleSearchType = () => {
    setSearchType(prev => prev === 'name' ? 'youtube' : 'name');
    // 검색어가 있으면 검색 타입 변경 시 재검색
    if (searchQuery.trim()) {
      setIsFocused(true);
    }
  };

  const showResults = isFocused && (searchQuery.length > 0 || restaurants.length > 0);

  return (
    <div ref={searchRef} className={cn("relative flex items-center gap-2", className)}>
      <div className="relative flex-1">
        <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder={searchType === 'name' ? "맛집 이름 검색..." : "유튜브 제목 검색..."}
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          onFocus={() => setIsFocused(true)}
          className="pl-10 pr-10 w-full min-w-[250px]"
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

      {/* 검색 타입 토글 버튼 */}
      <Button
        variant="outline"
        size="sm"
        onClick={toggleSearchType}
        className="flex items-center gap-2 flex-shrink-0"
        title={searchType === 'name' ? "유튜브 제목으로 검색" : "맛집 이름으로 검색"}
      >
        {searchType === 'name' ? (
          <>
            <MapPin className="h-4 w-4" />
            <span className="hidden sm:inline">맛집명</span>
          </>
        ) : (
          <>
            <Video className="h-4 w-4" />
            <span className="hidden sm:inline">유튜브</span>
          </>
        )}
      </Button>

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
