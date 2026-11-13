import {
  useState,
  useEffect,
  useLayoutEffect,
  useRef,
  useMemo,
  useCallback,
  useDeferredValue,
} from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Restaurant, YoutubeMeta } from "@/types/restaurant";
import { mergeRestaurants } from "@/hooks/use-restaurants";
import {
  fetchPopularRestaurants,
  getPopularRestaurantsQueryKey,
  KOREAN_RESTAURANT_REGIONS,
  POPULAR_RESTAURANTS_QUERY_KEY,
} from "@/lib/popular-restaurants";
import {
  RESTAURANT_DISCOVERY_INVALIDATED_EVENT,
  RESTAURANT_DISCOVERY_INVALIDATED_STORAGE_KEY,
  RESTAURANT_SEARCH_QUERY_KEY_PREFIX,
} from "@/lib/restaurant-discovery-cache";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Search,
  MapPin,
  X,
  Video,
  Clock,
  TrendingUp,
  Trash2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { FilterState } from "@/components/filters/filter-state";
import { useSearchHistory } from "@/hooks/use-search-history";
import { incrementSearchCount, shouldRefreshPopularAfterSearch } from "@/lib/search-count";

type SearchType = "name" | "youtube";

interface RestaurantSearchProps {
  onRestaurantSelect: (restaurant: Restaurant) => void;
  onSearchExecute?: () => void; // [OPTIMIZATION] 그리드 모드에서 검색 실행 시 호출
  onRestaurantSearch?: (restaurant: Restaurant) => void; // [OPTIMIZATION] 검색 시 별도 처리
  className?: string;
  filters?: FilterState; // [OPTIMIZATION] 필터 상태 추가
  selectedRegion?: string | null; // [OPTIMIZATION] 선택된 지역 (국가)
  isKoreanOnly?: boolean; // [OPTIMIZATION] 한국 지역만 필터링 (홈페이지용)
  maxItems?: number; // [OPTIMIZATION] 표시할 최대 아이템 수 (최근 검색, 인기 검색어)
  popularMaxItems?: number;
  dropdownPlacement?: "top" | "bottom";
  autoFocusInput?: boolean;
  resultView?: "dropdown" | "inline";
  searchQueryValue?: string;
  onSearchQueryChange?: (value: string) => void;
  searchTypeValue?: SearchType;
  onSearchTypeChange?: (value: SearchType) => void;
  hideSearchControls?: boolean;
  hideHistoryAndPopular?: boolean;
  clearQueryOnSelect?: boolean;
  edgeToEdgeInlineLayout?: boolean;
  onSearchInputFocus?: () => void;
}

const MIN_SEARCH_QUERY_LENGTH = 2;

const getSearchQueryFromUrl = () => {
  if (typeof window === "undefined") return "";
  return new URLSearchParams(window.location.search).get("q") || "";
};

const RESTAURANT_SEARCH_SELECT =
  "id, name:approved_name, approved_name, lat, lng, road_address, jibun_address, english_address, categories, phone, review_count, youtube_link, tzuyang_review, youtube_meta, status, created_at";

type SearchRestaurantsByYoutubeTitleArgs = {
  search_query: string;
  max_results: number;
  include_all_status: boolean;
  korean_only: boolean;
};

type YoutubeTitleRpcClient = {
  rpc: (
    fn: "search_restaurants_by_youtube_title",
    args: SearchRestaurantsByYoutubeTitleArgs,
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
  popularMaxItems,
  dropdownPlacement = "top",
  autoFocusInput = false,
  resultView = "dropdown",
  searchQueryValue,
  onSearchQueryChange,
  searchTypeValue,
  onSearchTypeChange,
  hideSearchControls = false,
  hideHistoryAndPopular = false,
  clearQueryOnSelect = true,
  edgeToEdgeInlineLayout = false,
  onSearchInputFocus,
}: RestaurantSearchProps) => {
  const [internalSearchQuery, setInternalSearchQuery] = useState(
    getSearchQueryFromUrl,
  );
  const [internalSearchType, setInternalSearchType] =
    useState<SearchType>("name");
  const searchQuery = searchQueryValue ?? internalSearchQuery;
  const searchType = searchTypeValue ?? internalSearchType;
  const searchIntentGenerationRef = useRef(0);
  // Controlled input changes and unmounts invalidate pending selections too.
  useLayoutEffect(() => () => {
    searchIntentGenerationRef.current += 1;
  }, [searchQuery, searchType]);
  const setSearchQuery = useCallback(
    (value: string) => {
      searchIntentGenerationRef.current += 1;
      onSearchQueryChange?.(value);
      if (searchQueryValue === undefined) {
        setInternalSearchQuery(value);
      }
    },
    [onSearchQueryChange, searchQueryValue],
  );
  const setSearchType = useCallback(
    (value: SearchType) => {
      searchIntentGenerationRef.current += 1;
      onSearchTypeChange?.(value);
      if (searchTypeValue === undefined) {
        setInternalSearchType(value);
      }
    },
    [onSearchTypeChange, searchTypeValue],
  );
  const debouncedSearchQuery = useDeferredValue(searchQuery); // [OPTIMIZATION] 디바운싱
  const trimmedDebouncedSearchQuery = useMemo(
    () => debouncedSearchQuery.trim(),
    [debouncedSearchQuery],
  );
  const [isFocused, setIsFocused] = useState(false);
  const searchRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const { history, addToHistory, removeFromHistory, clearHistory } =
    useSearchHistory();
  const queryClient = useQueryClient();
  const normalizedCategoryFilter = useMemo(() => {
    if (!filters?.categories?.length) {
      return [];
    }

    return [...filters.categories].filter(Boolean).sort();
  }, [filters?.categories]);
  const categoryFilterKey = useMemo(
    () => normalizedCategoryFilter.join("|"),
    [normalizedCategoryFilter],
  );
  const isInlineView = resultView === "inline";
  const effectiveMaxItems = maxItems ?? 5;
  const effectivePopularMaxItems = popularMaxItems ?? effectiveMaxItems;
  const popularRestaurantLimit = Math.max(effectivePopularMaxItems, 5);
  const popularRestaurantsQueryKey = useMemo(
    () =>
      getPopularRestaurantsQueryKey({
        limit: popularRestaurantLimit,
        selectedRegion,
        isKoreanOnly,
      }),
    [isKoreanOnly, popularRestaurantLimit, selectedRegion],
  );

  // 주간 인기 검색어 쿼리 (weekly_search_count 기준 상위 N개) - [OPTIMIZATION] 병합/필터링 로직 공유
  const {
    data: popularRestaurants = [],
    isLoading: isPopularRestaurantsLoading,
    isError: isPopularRestaurantsError,
    isFetching: isPopularRestaurantsFetching,
    refetch: refetchPopularRestaurants,
  } = useQuery({
    queryKey: popularRestaurantsQueryKey,
    queryFn: async () => {
      try {
        return await fetchPopularRestaurants({
          limit: popularRestaurantLimit,
          fetchLimit: 20,
          selectedRegion,
          isKoreanOnly,
        });
      } catch {
        throw new Error("POPULAR_RESTAURANTS_UNAVAILABLE");
      }
    },
    enabled: isFocused || isInlineView,
    staleTime: 1000 * 60 * 10, // 10분간 캐시 (인기 검색어는 자주 변하지 않음)
    gcTime: 1000 * 60 * 30, // 30분간 메모리 보존
  });

  // 메모이제이션된 쿼리 키 (debouncedSearchQuery 사용)
  // 지역 필터는 인기 검색/목록 패널에만 적용하고, 직접 검색은 항상 전체 지역에서 찾는다.
  const queryKey = useMemo(
    () => [
      ...RESTAURANT_SEARCH_QUERY_KEY_PREFIX,
      trimmedDebouncedSearchQuery,
      searchType,
      categoryFilterKey,
      isKoreanOnly,
    ],
    [
      trimmedDebouncedSearchQuery,
      searchType,
      categoryFilterKey,
      isKoreanOnly,
    ],
  );

  // 맛집 검색 쿼리
  const { data: restaurants = [], isLoading, isFetching, isError, refetch } = useQuery({
    queryKey,
    queryFn: async () => {
      // [OPTIMIZATION] 최소 2자 이상부터 검색
      if (trimmedDebouncedSearchQuery.length < MIN_SEARCH_QUERY_LENGTH)
        return [];

      const trimmedQuery = trimmedDebouncedSearchQuery;

      let results: Restaurant[] = [];

      try {
        if (searchType === "name") {
          // 맛집 이름(approved_name)으로 검색
          const categoriesToSearch =
            normalizedCategoryFilter.length > 0
              ? normalizedCategoryFilter
              : null;

          let query = supabase
            .from("restaurants")
            .select(RESTAURANT_SEARCH_SELECT)
            .eq("status", "approved")
            .ilike("approved_name", `%${trimmedQuery}%`)
            .limit(50);

          if (categoriesToSearch) {
            query = query.contains("categories", categoriesToSearch);
          }

          const { data, error } = await query;

          if (error) {
            throw new Error("RESTAURANT_SEARCH_UNAVAILABLE");
          }

          results = (data || []) as Restaurant[];

          // 한국 지역 필터링 (클라이언트 측 처리)
          if (isKoreanOnly) {
            results = results.filter((r) => {
              const addr = r.road_address || r.jibun_address || "";
              return KOREAN_RESTAURANT_REGIONS.some((region) => addr.includes(region));
            });
          }
        } else {
          // 유튜브 제목으로 검색
          const youtubeTitleRpcClient =
            supabase as unknown as YoutubeTitleRpcClient;
          const { data, error } = await youtubeTitleRpcClient.rpc(
            "search_restaurants_by_youtube_title",
            {
              search_query: trimmedQuery,
              max_results: 50,
              include_all_status: false, // 일반 사용자는 approved만 표시
              korean_only: isKoreanOnly, // 한국 지역만 필터링 (홈페이지용)
            },
          );

          if (error) {
            throw new Error("RESTAURANT_SEARCH_UNAVAILABLE");
          }

          results = (data || []) as Restaurant[];
        }

        // 지역 필터가 켜져 있어도 검색창 직접 검색은 전체 지역을 대상으로 한다.
        // 단, 홈의 국내/해외 모드 구분(isKoreanOnly)은 유지한다.

        // 병합 로직 적용 (동일한 상호명 처리)
        const merged = mergeRestaurants(results);

        // 최대 10개로 제한
        return merged.slice(0, 10);
      } catch {
        // A failed read must not be presented as a confirmed empty result.
        // Keep provider details and the user's query out of the error message.
        throw new Error("RESTAURANT_SEARCH_UNAVAILABLE");
      }
    },
    enabled: trimmedDebouncedSearchQuery.length >= MIN_SEARCH_QUERY_LENGTH,
    staleTime: 0, // 관리자 승인/수정 직후 기존 빈 검색 결과를 재사용하지 않음
    gcTime: 1000 * 60 * 10, // 10분간 메모리 보존
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
  });

  useEffect(() => {
    const invalidateSearch = () => {
      void queryClient.invalidateQueries({
        queryKey: RESTAURANT_SEARCH_QUERY_KEY_PREFIX,
      });
    };
    const handleStorage = (event: StorageEvent) => {
      if (event.key === RESTAURANT_DISCOVERY_INVALIDATED_STORAGE_KEY) {
        invalidateSearch();
      }
    };

    window.addEventListener(
      RESTAURANT_DISCOVERY_INVALIDATED_EVENT,
      invalidateSearch,
    );
    window.addEventListener("storage", handleStorage);

    return () => {
      window.removeEventListener(
        RESTAURANT_DISCOVERY_INVALIDATED_EVENT,
        invalidateSearch,
      );
      window.removeEventListener("storage", handleStorage);
    };
  }, [queryClient]);

  // [OPTIMIZATION] 외부 클릭 핸들러 안정화 (useCallback 사용)
  const handleClickOutside = useCallback((event: MouseEvent) => {
    if (
      searchRef.current &&
      !searchRef.current.contains(event.target as Node)
    ) {
      setIsFocused(false);
    }
  }, []);

  useEffect(() => {
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [handleClickOutside]);

  const handleSelect = useCallback(
    (restaurant: Restaurant) => {
      searchIntentGenerationRef.current += 1;
      // 검색 카운트 증가 (비동기, 에러 무시)
      incrementSearchCount(restaurant.id).then((result) => {
        if (shouldRefreshPopularAfterSearch(result)) {
          void queryClient.invalidateQueries({ queryKey: POPULAR_RESTAURANTS_QUERY_KEY });
        }
      }).catch(() => {});

      // 검색 기록에 추가
      addToHistory({
        id: restaurant.id,
        name: restaurant.name,
        address:
          restaurant.road_address ||
          restaurant.jibun_address ||
          restaurant.english_address ||
          "주소 없음",
      });

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
    },
    [
      addToHistory,
      clearQueryOnSelect,
      onRestaurantSearch,
      onRestaurantSelect,
      onSearchExecute,
      queryClient,
      setSearchQuery,
    ],
  );

  const focusSearchInput = useCallback(() => {
    if (hideSearchControls) {
      onSearchInputFocus?.();
    } else {
      inputRef.current?.focus();
    }
  }, [hideSearchControls, onSearchInputFocus]);

  const clearSearch = useCallback(() => {
    setSearchQuery("");
    setIsFocused(true);
    focusSearchInput();
  }, [focusSearchInput, setSearchQuery]);

  const toggleSearchType = useCallback(() => {
    setSearchType(searchType === "name" ? "youtube" : "name");
    // 검색어가 있으면 검색 타입 변경 시 재검색
    if (searchQuery.trim()) {
      setIsFocused(true);
    }
  }, [searchQuery, searchType, setSearchType]);

  const handleHistoryOrPopularSelect = useCallback(
    async (name: string, selectedRestaurantId?: string) => {
      const selectionGeneration = ++searchIntentGenerationRef.current;
      try {
        const { data, error } = await supabase
          .from("restaurants")
          .select(RESTAURANT_SEARCH_SELECT)
          .eq("approved_name", name)
          .eq("status", "approved");

        if (selectionGeneration !== searchIntentGenerationRef.current) return;
        if (!error && data?.length) {
          const merged = mergeRestaurants(data as Restaurant[]);
          const selectedRestaurant =
            merged.find((restaurant) => restaurant.id === selectedRestaurantId) ||
            merged.find((restaurant) => restaurant.name === name) ||
            merged[0];
          if (selectedRestaurant) {
            handleSelect(selectedRestaurant);
            return;
          }
        }
      } catch {
        // Fall through to the normal search UI, which provides recovery actions.
      }

      if (selectionGeneration !== searchIntentGenerationRef.current) return;
      setSearchType("name");
      setSearchQuery(name);
      setIsFocused(true);
      focusSearchInput();
    },
    [focusSearchInput, handleSelect, setSearchQuery, setSearchType],
  );

  const showResults = isInlineView
    ? trimmedDebouncedSearchQuery.length > 0 || restaurants.length > 0
    : isFocused &&
      (trimmedDebouncedSearchQuery.length > 0 || restaurants.length > 0);
  const showHistoryAndPopular =
    !hideHistoryAndPopular &&
    (isInlineView ? !searchQuery.trim() : isFocused && !searchQuery.trim());

  return (
    <div
      ref={searchRef}
      className={cn(
        "relative",
        isInlineView && "h-full flex flex-col",
        className,
      )}
    >
      {!hideSearchControls && (
        <div className="flex items-center gap-2">
          {/* 검색 타입 토글 버튼 */}
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={toggleSearchType}
            className="flex min-h-11 items-center gap-2 flex-shrink-0 order-last ml-auto px-3"
            title={
              searchType === "name"
                ? "유튜브 제목으로 검색"
                : "맛집 이름으로 검색"
            }
            aria-label={
              searchType === "name"
                ? "유튜브 제목 검색으로 전환"
                : "맛집 이름 검색으로 전환"
            }
            aria-pressed={searchType === "youtube"}
          >
            {searchType === "name" ? (
              <>
                <MapPin className="h-4 w-4" aria-hidden="true" />
                <span>맛집명</span>
              </>
            ) : (
              <>
                <Video className="h-4 w-4" aria-hidden="true" />
                <span>영상 제목</span>
              </>
            )}
          </Button>

          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" aria-hidden="true" />
            <Input
              ref={inputRef}
              placeholder={
                searchType === "name"
                  ? "맛집 이름 검색…"
                  : "유튜브 제목 검색…"
              }
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onFocus={() => setIsFocused(true)}
              autoFocus={autoFocusInput}
              className="h-11 pl-10 pr-12 w-full min-w-0"
              name="restaurant-search"
              aria-label="맛집 검색어 입력"
              inputMode="search"
              enterKeyHint="search"
              autoComplete="off"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={clearSearch}
                className="absolute right-0 top-1/2 -translate-y-1/2 inline-flex h-11 w-11 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                aria-label="검색어 지우기"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            )}
          </div>
        </div>
      )}

      {/* 검색 결과, 최근 검색, 인기 검색어 드롭다운 */}
      {(showResults || showHistoryAndPopular) && (
        <div
          role="region"
          aria-label={showResults ? "맛집 검색 결과" : "최근 검색과 인기 맛집"}
          aria-busy={showResults && isFetching}
          className={cn(
            isInlineView
              ? "z-10 overflow-y-auto bg-transparent border-0 shadow-none rounded-none"
              : "bg-background border border-border rounded-md shadow-lg z-50 overflow-y-auto",
            isInlineView
              ? cn(
                  "flex-1",
                  hideSearchControls ? "mt-0" : "mt-3",
                  edgeToEdgeInlineLayout && "min-h-0 w-full",
                )
              : "absolute left-0 right-0",
            !isInlineView &&
              (dropdownPlacement === "top"
                ? "bottom-full mb-1 max-h-[19rem]"
                : "top-full mt-1 max-h-[min(60vh,28rem)]"),
          )}
        >
          {showResults ? (
            // 검색 결과 표시
            <>
              {isError && restaurants.length > 0 ? (
                <div className="space-y-2 border-b border-border p-4">
                  <p role="status" className="text-sm leading-5 text-muted-foreground">검색 결과를 새로 불러오지 못해 이전 결과를 보여드리고 있습니다.</p>
                  <Button type="button" variant="outline" className="min-h-11" onClick={() => void refetch()} disabled={isFetching}>다시 검색</Button>
                </div>
              ) : null}
              {restaurants.length > 0 && !isError && !isFetching ? (
                <p className="sr-only" role="status">검색 결과 {restaurants.length}곳</p>
              ) : null}
              {isLoading || (isFetching && restaurants.length === 0) ? (
                <div role="status" className="p-4 text-sm text-muted-foreground">
                  검색 중…
                </div>
              ) : trimmedDebouncedSearchQuery.length > 0 &&
                trimmedDebouncedSearchQuery.length < MIN_SEARCH_QUERY_LENGTH ? (
                <div role="status" className="p-4 text-sm text-muted-foreground">
                  두 글자 이상 입력해 주세요.
                </div>
              ) : isError && restaurants.length === 0 ? (
                <div className="space-y-3 p-4">
                  <div role="status" className="space-y-1">
                    <p className="text-sm font-medium text-foreground">검색 결과를 불러오지 못했습니다.</p>
                    <p className="text-sm leading-5 text-muted-foreground">연결 상태를 확인한 뒤 다시 시도해 주세요. 입력한 검색어는 유지됩니다.</p>
                  </div>
                  <Button type="button" variant="outline" className="min-h-11" onClick={() => void refetch()} disabled={isFetching}>
                    다시 검색
                  </Button>
                </div>
              ) : restaurants.length > 0 ? (
                restaurants.map((restaurant) => (
                  <button
                    key={restaurant.id}
                    type="button"
                    onClick={() => handleSelect(restaurant)}
                    className="w-full text-left p-3 hover:bg-muted border-b border-border last:border-b-0 flex items-center gap-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-inset"
                  >
                    <MapPin className="h-4 w-4 text-muted-foreground flex-shrink-0" aria-hidden="true" />
                    <div className="flex flex-col min-w-0 flex-1">
                      {isKoreanOnly && searchType === "youtube" ? (
                        <div className="flex items-baseline gap-2 min-w-0">
                          <span className="font-medium flex-shrink-0">
                            {restaurant.name}
                          </span>
                          {restaurant.youtube_meta &&
                            typeof restaurant.youtube_meta === "object" &&
                            "title" in restaurant.youtube_meta && (
                              <span className="text-xs text-muted-foreground truncate">
                                (
                                {(restaurant.youtube_meta as YoutubeMeta).title}
                                )
                              </span>
                            )}
                        </div>
                      ) : (
                        <span className="font-medium">{restaurant.name}</span>
                      )}

                      {!isKoreanOnly &&
                        searchType === "youtube" &&
                        restaurant.youtube_meta &&
                        typeof restaurant.youtube_meta === "object" &&
                        "title" in restaurant.youtube_meta && (
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
                <div className="space-y-3 p-4">
                  <div role="status" className="space-y-1">
                    <p className="text-sm font-medium text-foreground">검색 결과가 없습니다.</p>
                    <p className="text-sm leading-5 text-muted-foreground">
                      {searchType === "name" ? "맛집 이름을 짧게 입력하거나 영상 제목으로 찾아보세요." : "영상 제목의 일부를 입력하거나 맛집 이름으로 찾아보세요."}
                    </p>
                    {searchType === "name" && normalizedCategoryFilter.length > 0 ? (
                      <p className="text-sm leading-5 text-muted-foreground">선택한 카테고리에 해당하는 맛집만 검색하고 있습니다.</p>
                    ) : null}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button type="button" variant="outline" className="min-h-11" onClick={() => { toggleSearchType(); focusSearchInput(); }}>
                      {searchType === "name" ? "영상 제목으로 찾기" : "맛집 이름으로 찾기"}
                    </Button>
                    <Button type="button" variant="ghost" className="min-h-11" onClick={clearSearch}>검색어 지우기</Button>
                  </div>
                </div>
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
                      <Clock className="h-4 w-4" aria-hidden="true" />
                      최근 검색한 맛집
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={clearHistory}
                      className="min-h-11 px-3 text-sm"
                    >
                      <Trash2 className="h-3 w-3 mr-1" aria-hidden="true" />
                      전체 삭제
                    </Button>
                  </div>
                  {history.slice(0, effectiveMaxItems).map((item) => (
                    <div
                      key={item.id}
                      className="w-full border-b border-border last:border-b-0 flex items-center gap-2 group hover:bg-muted"
                    >
                      <button
                        type="button"
                        onClick={() =>
                          handleHistoryOrPopularSelect(item.name, item.id)
                        }
                        className="flex min-w-0 flex-1 items-center gap-2 p-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-inset"
                      >
                        <Clock className="h-4 w-4 text-muted-foreground flex-shrink-0" aria-hidden="true" />
                        <span className="flex flex-col min-w-0 flex-1">
                          <span className="font-medium">{item.name}</span>
                          <span className="text-sm text-muted-foreground truncate">
                            {item.address}
                          </span>
                        </span>
                      </button>
                      <button
                        type="button"
                        onClick={() => removeFromHistory(item.id)}
                        className="mr-2 inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-background hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                        aria-label={`${item.name} 최근 검색 삭제`}
                      >
                        <X className="h-3 w-3" aria-hidden="true" />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {/* 인기 검색어 */}
              {isPopularRestaurantsError ? (
                <div className="space-y-3 p-4">
                  <p role="status" className="text-sm leading-5 text-muted-foreground">인기 맛집을 불러오지 못했습니다. 맛집 이름으로 직접 검색할 수 있습니다.</p>
                  <Button type="button" variant="outline" className="min-h-11" onClick={() => void refetchPopularRestaurants()} disabled={isPopularRestaurantsFetching}>
                    {isPopularRestaurantsFetching ? "불러오는 중…" : "인기 맛집 다시 불러오기"}
                  </Button>
                </div>
              ) : null}
              {!isPopularRestaurantsError && popularRestaurants.length === 0 && history.length === 0 && (
                <div
                  className={cn(
                    "flex flex-col justify-center border-dashed border-border bg-muted/20 text-center text-sm text-muted-foreground",
                    edgeToEdgeInlineLayout
                      ? "min-h-full border-y px-4 py-6"
                      : "min-h-40 rounded-2xl border p-5",
                  )}
                >
                  {isPopularRestaurantsLoading
                    ? "인기 맛집을 불러오는 중…"
                    : "검색하면 최근 검색 맛집이 여기에 쌓입니다."}
                </div>
              )}

              {popularRestaurants.length > 0 && (
                <div>
                  <div className="flex items-center gap-2 p-3 pb-2 text-sm font-medium">
                    <TrendingUp className="h-4 w-4" aria-hidden="true" />
                    인기 검색 맛집
                  </div>
                  {popularRestaurants
                    .slice(0, effectivePopularMaxItems)
                    .map((restaurant, index) => (
                      <button
                        key={restaurant.id}
                        type="button"
                        onClick={() =>
                          handleHistoryOrPopularSelect(
                            restaurant.name,
                            restaurant.id,
                          )
                        }
                        className="w-full text-left p-3 hover:bg-muted border-b border-border last:border-b-0 flex items-center gap-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-inset"
                        aria-label={`${restaurant.name} 인기 맛집 선택`}
                      >
                        <div className="flex items-center justify-center w-5 h-5 rounded-full bg-primary/10 text-primary text-xs font-bold flex-shrink-0" aria-hidden="true">
                          {index + 1}
                        </div>
                        <div className="flex flex-col min-w-0 flex-1">
                          <span className="font-medium">{restaurant.name}</span>
                          <span className="text-sm text-muted-foreground truncate">
                            {restaurant.road_address ||
                              restaurant.jibun_address ||
                              restaurant.english_address ||
                              "주소 없음"}
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
