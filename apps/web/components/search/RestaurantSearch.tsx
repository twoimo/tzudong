import { useState, useEffect, useRef, useMemo, useCallback, useDeferredValue } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Restaurant, YoutubeMeta } from "@/types/restaurant";
import { mergeRestaurants } from "@/hooks/use-restaurants";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Search, MapPin, X, Video, Clock, TrendingUp, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { FilterState } from "@/components/filters/FilterPanel";
import { useSearchHistory } from "@/hooks/use-search-history";
import { incrementSearchCount } from "@/lib/search-count";

interface RestaurantSearchProps {
  onRestaurantSelect: (restaurant: Restaurant) => void;
  onSearchExecute?: () => void; // [OPTIMIZATION] 그리드 모드에서 검색 실행 시 호출
  onRestaurantSearch?: (restaurant: Restaurant) => void; // [OPTIMIZATION] 검색 시 별도 처리
  className?: string;
  filters?: FilterState; // [OPTIMIZATION] 필터 상태 추가
  selectedRegion?: string | null; // [OPTIMIZATION] 선택된 지역 (국가)
  isKoreanOnly?: boolean; // [OPTIMIZATION] 한국 지역만 필터링 (홈페이지용)
  maxItems?: number; // [OPTIMIZATION] 표시할 최대 아이템 수 (최근 검색, 인기 검색어)
}

type SearchType = 'name' | 'youtube';

const RestaurantSearch = ({
  onRestaurantSelect,
  onSearchExecute,
  onRestaurantSearch,
  className,
  filters,
  selectedRegion,
  isKoreanOnly = false,
  maxItems // [OPTIMIZATION] 기본값은 undefined (제한 없음)
}: RestaurantSearchProps) => {
  // [URL 동기화] 초기 로드 시 URL에서 검색어 복원
  const getInitialQuery = () => {
    if (typeof window === 'undefined') return '';
    const params = new URLSearchParams(window.location.search);
    return params.get('q') || '';
  };
  const [searchQuery, setSearchQuery] = useState(getInitialQuery);
  const debouncedSearchQuery = useDeferredValue(searchQuery); // [OPTIMIZATION] 디바운싱
  const [isFocused, setIsFocused] = useState(false);
  const [searchType, setSearchType] = useState<SearchType>('name');
  const searchRef = useRef<HTMLDivElement>(null);
  const { history, addToHistory, removeFromHistory, clearHistory } = useSearchHistory();
  const queryClient = useQueryClient();

  // 한국 지역 목록 (홈페이지 필터링용)
  const KOREAN_REGIONS = [
    "서울특별시", "부산광역시", "대구광역시", "인천광역시", "광주광역시",
    "대전광역시", "울산광역시", "세종특별자치시",
    "경기도", "강원특별자치도", "충청북도", "충청남도",
    "전북특별자치도", "전라남도", "경상북도", "경상남도", "제주특별자치도"
  ];

  // 주간 인기 검색어 쿼리 (weekly_search_count 기준 상위 5개) - [OPTIMIZATION] 병합 로직 적용
  const { data: popularRestaurants = [] } = useQuery({
    queryKey: ["popular-searches-weekly"],
    queryFn: async () => {
      try {
        const { data, error } = await supabase
          .from('restaurants')
          .select('id, name:approved_name, road_address, jibun_address, english_address, status, weekly_search_count, categories, youtube_meta')
          .eq('status', 'approved')
          .gt('weekly_search_count', 0)  // weekly_search_count가 0보다 큰 것만
          .order('weekly_search_count', { ascending: false })
          .limit(20); // 병합 전에 더 많이 가져오기

        if (error) throw error;

        // 병합 로직 적용
        const merged = mergeRestaurants((data || []) as Restaurant[]);

        // 병합 후 weekly_search_count 기준으로 정렬하여 상위 5개 선택
        return merged
          .sort((a, b) => (b.weekly_search_count || 0) - (a.weekly_search_count || 0))
          .slice(0, 5);
      } catch (error) {
        console.error('주간 인기 검색어 조회 실패:', error);
        return [];
      }
    },
    staleTime: 1000 * 60 * 10, // 10분간 캐시 (인기 검색어는 자주 변하지 않음)
    gcTime: 1000 * 60 * 30, // 30분간 메모리 보존
  });

  // 메모이제이션된 쿼리 키 (debouncedSearchQuery 사용)
  const queryKey = useMemo(
    () => ["restaurant-search", debouncedSearchQuery, searchType, filters?.categories, selectedRegion, isKoreanOnly],
    [debouncedSearchQuery, searchType, filters?.categories, selectedRegion, isKoreanOnly]
  );

  // 맛집 검색 쿼리
  const { data: restaurants = [], isLoading } = useQuery({
    queryKey,
    queryFn: async () => {
      // [OPTIMIZATION] 최소 2자 이상부터 검색
      if (!debouncedSearchQuery.trim() || debouncedSearchQuery.trim().length < 2) return [];

      const trimmedQuery = debouncedSearchQuery.trim();


      let results: Restaurant[] = [];

      try {
        if (searchType === 'name') {
          // 맛집 이름(approved_name)으로 검색
          const categoriesToSearch = filters?.categories && filters.categories.length > 0
            ? filters.categories
            : null;

          let query = supabase
            .from('restaurants')
            .select('*, name:approved_name')
            .eq('status', 'approved')
            .ilike('approved_name', `%${trimmedQuery}%`)
            .limit(50);

          if (categoriesToSearch) {
            query = query.contains('categories', categoriesToSearch);
          }

          const { data, error } = await query;

          if (error) {
            console.warn("맛집 이름 검색 실패:", error);
            return [];
          }

          results = (data || []) as Restaurant[];

          // 한국 지역 필터링 (클라이언트 측 처리)
          if (isKoreanOnly) {
            results = results.filter(r => {
              const addr = r.road_address || r.jibun_address || '';
              return KOREAN_REGIONS.some(region => addr.includes(region));
            });
          }
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

        // 지역 필터 적용 (선택된 지역/국가로 필터링)
        if (selectedRegion) {
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
    enabled: debouncedSearchQuery.trim().length >= 2, // [OPTIMIZATION] 2자 이상부터 쿼리 실행
    staleTime: 1000 * 60 * 5, // 5분간 캐시
    gcTime: 1000 * 60 * 10, // 10분간 메모리 보존
  });

  // [OPTIMIZATION] 외부 클릭 핸들러 안정화 (useCallback 사용)
  const handleClickOutside = useCallback((event: MouseEvent) => {
    if (searchRef.current && !searchRef.current.contains(event.target as Node)) {
      setIsFocused(false);
    }
  }, []);

  useEffect(() => {
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [handleClickOutside]);

  const handleSelect = useCallback((restaurant: Restaurant) => {
    // 검색 카운트 증가 (비동기, 에러 무시)
    incrementSearchCount(restaurant.id).catch(() => { });

    // 검색 기록에 추가
    addToHistory({
      id: restaurant.id,
      name: restaurant.name,
      address: restaurant.road_address || restaurant.jibun_address || restaurant.english_address || '주소 없음',
    });

    // 인기 검색어 쿼리 무효화하여 즉시 업데이트
    queryClient.invalidateQueries({ queryKey: ["popular-searches"] });



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
  }, [addToHistory, onRestaurantSearch, onRestaurantSelect, onSearchExecute, queryClient]);

  const clearSearch = useCallback(() => {
    setSearchQuery("");
    setIsFocused(false);

  }, []);

  const toggleSearchType = useCallback(() => {
    setSearchType(prev => prev === 'name' ? 'youtube' : 'name');
    // 검색어가 있으면 검색 타입 변경 시 재검색
    if (searchQuery.trim()) {
      setIsFocused(true);
    }
  }, [searchQuery]);

  const showResults = isFocused && (searchQuery.length > 0 || restaurants.length > 0);
  const showHistoryAndPopular = isFocused && !searchQuery.trim();

  return (
    <div ref={searchRef} className={cn("relative flex items-center gap-2", className)}>
      {/* 검색 타입 토글 버튼 */}
      <Button
        variant="outline"
        size="sm"
        onClick={toggleSearchType}
        className="flex items-center gap-2 flex-shrink-0 order-last ml-auto"
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

      <div className="relative flex-1">
        <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder={searchType === 'name' ? "맛집 이름 검색..." : "유튜브 제목 검색..."}
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          onFocus={() => setIsFocused(true)}
          className="pl-10 pr-10 w-full min-w-[250px]"
          inputMode="search"
          enterKeyHint="search"
          autoComplete="off"
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

      {/* 검색 결과, 최근 검색, 인기 검색어 드롭다운 */}
      {(showResults || showHistoryAndPopular) && (
        <div className="absolute bottom-full left-0 right-0 mb-1 bg-background border border-border rounded-md shadow-lg z-50 max-h-[19rem] overflow-y-auto">
          {showResults ? (
            // 검색 결과 표시
            <>
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
                    <div className="flex flex-col min-w-0 flex-1">
                      {isKoreanOnly && searchType === 'youtube' ? (
                        <div className="flex items-baseline gap-2 min-w-0">
                          <span className="font-medium flex-shrink-0">{restaurant.name}</span>
                          {restaurant.youtube_meta &&
                            typeof restaurant.youtube_meta === 'object' &&
                            'title' in restaurant.youtube_meta && (
                              <span className="text-xs text-muted-foreground truncate">
                                ({(restaurant.youtube_meta as YoutubeMeta).title})
                              </span>
                            )}
                        </div>
                      ) : (
                        <span className="font-medium">{restaurant.name}</span>
                      )}

                      {!isKoreanOnly && searchType === 'youtube' &&
                        restaurant.youtube_meta &&
                        typeof restaurant.youtube_meta === 'object' &&
                        'title' in restaurant.youtube_meta && (
                          <span className="text-xs text-muted-foreground truncate">
                            {(restaurant.youtube_meta as YoutubeMeta).title}
                          </span>
                        )}

                      <span className="text-sm text-muted-foreground truncate">
                        {restaurant.address}
                      </span>
                    </div>
                  </button>
                ))
              ) : searchQuery ? (
                <div className="p-3 text-sm text-muted-foreground">검색 결과가 없습니다.</div>
              ) : null}
            </>
          ) : (
            // 최근 검색 및 인기 검색어 표시
            <>
              {/* 최근 검색 */}
              {history.length > 0 && (
                <div className="border-b border-border">
                  <div className="flex items-center justify-between p-3 pb-2">
                    <div className="flex items-center gap-2 text-sm font-medium">
                      <Clock className="h-4 w-4" />
                      최근 검색한 맛집
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={clearHistory}
                      className="h-6 px-2 text-xs"
                    >
                      <Trash2 className="h-3 w-3 mr-1" />
                      전체 삭제
                    </Button>
                  </div>
                  {history
                    .slice(0, maxItems)
                    .map((item) => (
                      <button
                        key={item.id}
                        onClick={async () => {
                          // 같은 이름의 모든 레스토랑 조회 (병합을 위해)
                          const { data } = await supabase
                            .from('restaurants')
                            .select('*, name:approved_name') // [Fix] name 별칭 추가
                            .eq('approved_name', item.name)
                            .eq('status', 'approved');

                          if (data && data.length > 0) {
                            // 병합 로직 적용
                            const merged = mergeRestaurants(data as Restaurant[]);
                            // 원래 선택한 레스토랑을 우선적으로 사용
                            const selectedRestaurant = merged.find(r => r.id === item.id) || merged[0];
                            handleSelect(selectedRestaurant);
                          }
                        }}
                        className="w-full text-left p-3 hover:bg-muted border-b border-border last:border-b-0 flex items-center gap-2 group"
                      >
                        <Clock className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                        <div className="flex flex-col min-w-0 flex-1">
                          <span className="font-medium">{item.name}</span>
                          <span className="text-sm text-muted-foreground truncate">
                            {item.address}
                          </span>
                        </div>
                        <div
                          onClick={(e) => {
                            e.stopPropagation();
                            removeFromHistory(item.id);
                          }}
                          className="opacity-0 group-hover:opacity-100 p-1 hover:bg-background rounded cursor-pointer"
                        >
                          <X className="h-3 w-3" />
                        </div>
                      </button>
                    ))}
                </div>
              )}

              {/* 인기 검색어 */}
              {popularRestaurants.length > 0 && (
                <div>
                  <div className="flex items-center gap-2 p-3 pb-2 text-sm font-medium">
                    <TrendingUp className="h-4 w-4" />
                    인기 검색 맛집
                  </div>
                  {popularRestaurants
                    .slice(0, maxItems)
                    .map((restaurant, index) => (
                      <button
                        key={restaurant.id}
                        onClick={async () => {
                          // 같은 이름의 모든 레스토랑 조회 (병합을 위해)
                          const { data } = await supabase
                            .from('restaurants')
                            .select('*, name:approved_name') // [Fix] name 별칭 추가
                            .eq('approved_name', restaurant.name)
                            .eq('status', 'approved');

                          if (data && data.length > 0) {
                            // 병합 로직 적용
                            const merged = mergeRestaurants(data as Restaurant[]);
                            // 원래 선택한 레스토랑을 우선적으로 사용
                            const selectedRestaurant = merged.find(r => r.id === restaurant.id) || merged[0];
                            handleSelect(selectedRestaurant);
                          }
                        }}
                        className="w-full text-left p-3 hover:bg-muted border-b border-border last:border-b-0 flex items-center gap-2"
                      >
                        <div className="flex items-center justify-center w-5 h-5 rounded-full bg-primary/10 text-primary text-xs font-bold flex-shrink-0">
                          {index + 1}
                        </div>
                        <div className="flex flex-col min-w-0 flex-1">
                          <span className="font-medium">{restaurant.name}</span>
                          <span className="text-sm text-muted-foreground truncate">
                            {restaurant.road_address || restaurant.jibun_address || restaurant.english_address || '주소 없음'}
                          </span>
                        </div>
                      </button>
                    ))}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
};

export default RestaurantSearch;
