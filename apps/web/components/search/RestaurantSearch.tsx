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

type SearchType = 'name' | 'youtube';

interface RestaurantSearchProps {
  onRestaurantSelect: (restaurant: Restaurant) => void;
  onSearchExecute?: () => void; // [OPTIMIZATION] 그리드 모드에서 검색 실행 시 호출
  onRestaurantSearch?: (restaurant: Restaurant) => void; // [OPTIMIZATION] 검색 시 별도 처리
  className?: string;
  filters?: FilterState; // [OPTIMIZATION] 필터 상태 추가
  selectedRegion?: string | null; // [OPTIMIZATION] 선택된 지역 (국가)
  isKoreanOnly?: boolean; // [OPTIMIZATION] 한국 지역만 필터링 (홈페이지용)
  maxItems?: number; // [OPTIMIZATION] 표시할 최대 아이템 수 (최근 검색, 인기 검색어)
  dropdownPlacement?: 'top' | 'bottom';
  autoFocusInput?: boolean;
  resultView?: 'dropdown' | 'inline';
  searchQueryValue?: string;
  onSearchQueryChange?: (value: string) => void;
  searchTypeValue?: SearchType;
  onSearchTypeChange?: (value: SearchType) => void;
  hideSearchControls?: boolean;
  clearQueryOnSelect?: boolean;
}

const MIN_SEARCH_QUERY_LENGTH = 2;

const KOREAN_REGIONS = [
  "서울특별시", "부산광역시", "대구광역시", "인천광역시", "광주광역시",
  "대전광역시", "울산광역시", "세종특별자치시",
  "경기도", "강원특별자치도", "충청북도", "충청남도",
  "전북특별자치도", "전라남도", "경상북도", "경상남도", "제주특별자치도",
];

const getSearchQueryFromUrl = () => {
  if (typeof window === 'undefined') return '';
  return new URLSearchParams(window.location.search).get('q') || '';
};

const POPULAR_RESTAURANTS_QUERY_KEY = ["popular-searches-weekly"] as const;

type SearchRestaurantsByYoutubeTitleArgs = {
  search_query: string;
  max_results: number;
  include_all_status: boolean;
  korean_only: boolean;
};

type YoutubeTitleRpcClient = {
  rpc: (
    fn: 'search_restaurants_by_youtube_title',
    args: SearchRestaurantsByYoutubeTitleArgs
  ) => Promise<{ data: unknown; error: unknown }>;
};

const RestaurantSearch = ({
  onRestaurantSelect,
  onSearchExecute,
  onRestaurantSearch,
  className,
  filters,
  selectedRegion,
  isKoreanOnly = false,
  maxItems, // [OPTIMIZATION] 기본값은 undefined (제한 없음)
  dropdownPlacement = 'top',
  autoFocusInput = false,
  resultView = 'dropdown',
  searchQueryValue,
  onSearchQueryChange,
  searchTypeValue,
  onSearchTypeChange,
  hideSearchControls = false,
  clearQueryOnSelect = true,
}: RestaurantSearchProps) => {
  const [internalSearchQuery, setInternalSearchQuery] = useState(getSearchQueryFromUrl);
  const [internalSearchType, setInternalSearchType] = useState<SearchType>('name');
  const searchQuery = searchQueryValue ?? internalSearchQuery;
  const searchType = searchTypeValue ?? internalSearchType;
  const setSearchQuery = useCallback((value: string) => {
    onSearchQueryChange?.(value);
    if (searchQueryValue === undefined) {
      setInternalSearchQuery(value);
    }
  }, [onSearchQueryChange, searchQueryValue]);
  const setSearchType = useCallback((value: SearchType) => {
    onSearchTypeChange?.(value);
    if (searchTypeValue === undefined) {
      setInternalSearchType(value);
    }
  }, [onSearchTypeChange, searchTypeValue]);
  const debouncedSearchQuery = useDeferredValue(searchQuery); // [OPTIMIZATION] 디바운싱
  const trimmedDebouncedSearchQuery = useMemo(
    () => debouncedSearchQuery.trim(),
    [debouncedSearchQuery]
  );
  const [isFocused, setIsFocused] = useState(false);
  const searchRef = useRef<HTMLDivElement>(null);
  const { history, addToHistory, removeFromHistory, clearHistory } = useSearchHistory();
  const queryClient = useQueryClient();
  const normalizedCategoryFilter = useMemo(() => {
    if (!filters?.categories?.length) {
      return [];
    }

    return [...filters.categories].filter(Boolean).sort();
  }, [filters?.categories]);
  const categoryFilterKey = useMemo(
    () => normalizedCategoryFilter.join('|'),
    [normalizedCategoryFilter]
  );

  // 주간 인기 검색어 쿼리 (weekly_search_count 기준 상위 5개) - [OPTIMIZATION] 병합 로직 적용
  const { data: popularRestaurants = [] } = useQuery({
    queryKey: POPULAR_RESTAURANTS_QUERY_KEY,
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
    () => ["restaurant-search", trimmedDebouncedSearchQuery, searchType, categoryFilterKey, selectedRegion, isKoreanOnly],
    [trimmedDebouncedSearchQuery, searchType, categoryFilterKey, selectedRegion, isKoreanOnly]
  );

  // 맛집 검색 쿼리
  const { data: restaurants = [], isLoading } = useQuery({
    queryKey,
    queryFn: async () => {
      // [OPTIMIZATION] 최소 2자 이상부터 검색
      if (trimmedDebouncedSearchQuery.length < MIN_SEARCH_QUERY_LENGTH) return [];

      const trimmedQuery = trimmedDebouncedSearchQuery;


      let results: Restaurant[] = [];

      try {
        if (searchType === 'name') {
          // 맛집 이름(approved_name)으로 검색
          const categoriesToSearch = normalizedCategoryFilter.length > 0
            ? normalizedCategoryFilter
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
          const youtubeTitleRpcClient = supabase as unknown as YoutubeTitleRpcClient;
          const { data, error } = await youtubeTitleRpcClient.rpc("search_restaurants_by_youtube_title", {
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
    enabled: trimmedDebouncedSearchQuery.length >= MIN_SEARCH_QUERY_LENGTH,
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
    queryClient.invalidateQueries({ queryKey: POPULAR_RESTAURANTS_QUERY_KEY });



    // 검색 시에는 별도 콜백 호출 (지도 재조정용)
    if (onRestaurantSearch) {
      onRestaurantSearch(restaurant);
    } else {
      onRestaurantSelect(restaurant);
    }
    // 그리드 모드에서 검색 실행 시 콜백 호출
    onSearchExecute?.();
    if (clearQueryOnSelect) {
      setSearchQuery("");
    } else {
      setSearchQuery(restaurant.name);
    }
    setIsFocused(false);
  }, [addToHistory, clearQueryOnSelect, onRestaurantSearch, onRestaurantSelect, onSearchExecute, queryClient, setSearchQuery]);

  const clearSearch = useCallback(() => {
    setSearchQuery("");
    setIsFocused(false);

  }, [setSearchQuery]);

  const toggleSearchType = useCallback(() => {
    setSearchType(searchType === 'name' ? 'youtube' : 'name');
    // 검색어가 있으면 검색 타입 변경 시 재검색
    if (searchQuery.trim()) {
      setIsFocused(true);
    }
  }, [searchQuery, searchType, setSearchType]);

  const handleHistoryOrPopularSelect = useCallback(async (name: string, selectedRestaurantId?: string) => {
    const { data } = await supabase
      .from('restaurants')
      .select('*, name:approved_name')
      .eq('approved_name', name)
      .eq('status', 'approved');

    if (!data || data.length === 0) {
      return;
    }

    const merged = mergeRestaurants(data as Restaurant[]);
    const selectedRestaurant =
      merged.find((restaurant) => restaurant.id === selectedRestaurantId) ||
      merged.find((restaurant) => restaurant.name === name) ||
      merged[0];
    if (selectedRestaurant) {
      handleSelect(selectedRestaurant);
    }
  }, [handleSelect]);

  const isInlineView = resultView === 'inline';
  const showResults = isInlineView
    ? trimmedDebouncedSearchQuery.length > 0 || restaurants.length > 0
    : isFocused && (trimmedDebouncedSearchQuery.length > 0 || restaurants.length > 0);
  const showHistoryAndPopular = isInlineView
    ? !searchQuery.trim()
    : isFocused && !searchQuery.trim();

  return (
    <div ref={searchRef} className={cn("relative", isInlineView && "h-full flex flex-col", className)}>
      {!hideSearchControls && (
        <div className="flex items-center gap-2">
        {/* 검색 타입 토글 버튼 */}
        <Button
          variant="outline"
          size="sm"
          onClick={toggleSearchType}
          className="flex items-center gap-1.5 flex-shrink-0 order-last ml-auto px-2 md:px-3"
          title={searchType === 'name' ? "유튜브 제목으로 검색" : "맛집 이름으로 검색"}
        >
          {searchType === 'name' ? (
            <>
              <MapPin className="h-4 w-4" />
              <span className="hidden md:inline">맛집명</span>
            </>
          ) : (
            <>
              <Video className="h-4 w-4" />
              <span className="hidden md:inline">유튜브</span>
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
            autoFocus={autoFocusInput}
            className="pl-10 pr-10 w-full min-w-0"
            inputMode="search"
            enterKeyHint="search"
            autoComplete="off"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={clearSearch}
              className="absolute right-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
        </div>
      )}

      {/* 검색 결과, 최근 검색, 인기 검색어 드롭다운 */}
      {(showResults || showHistoryAndPopular) && (
        <div
          className={cn(
            isInlineView
              ? "z-10 overflow-y-auto bg-transparent border-0 shadow-none rounded-none"
              : "bg-background border border-border rounded-md shadow-lg z-50 overflow-y-auto",
            isInlineView
              ? cn("flex-1", hideSearchControls ? "mt-0" : "mt-3")
              : "absolute left-0 right-0",
            !isInlineView && (dropdownPlacement === 'top'
              ? "bottom-full mb-1 max-h-[19rem]"
              : "top-full mt-1 max-h-[min(60vh,28rem)]")
          )}
        >
          {showResults ? (
            // 검색 결과 표시
            <>
              {isLoading ? (
                <div className="p-3 text-sm text-muted-foreground">검색 중...</div>
              ) : trimmedDebouncedSearchQuery.length > 0 && trimmedDebouncedSearchQuery.length < MIN_SEARCH_QUERY_LENGTH ? (
                <div className="p-3 text-sm text-muted-foreground">두 글자 이상 입력해 주세요.</div>
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
                      ) : trimmedDebouncedSearchQuery ? (
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
                      <div
                        key={item.id}
                        role="button"
                        tabIndex={0}
                        onClick={() => handleHistoryOrPopularSelect(item.name, item.id)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            handleHistoryOrPopularSelect(item.name, item.id);
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
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            removeFromHistory(item.id);
                          }}
                          className="opacity-0 group-hover:opacity-100 p-1 hover:bg-background rounded cursor-pointer"
                          aria-label={`${item.name} 최근 검색 삭제`}
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </div>
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
                        onClick={() => handleHistoryOrPopularSelect(restaurant.name, restaurant.id)}
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
