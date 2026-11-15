'use client';

import { useState, useCallback, useMemo, useEffect, useRef, Suspense, lazy } from "react";
import dynamic from "next/dynamic";
import { FilterPanel } from "@/components/filters/FilterPanel";
import type { FilterState } from "@/components/filters/filter-state";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { MapPin, Grid3X3, Map } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import type { Restaurant } from "@/types/restaurant";
import CategoryFilter from "@/components/filters/CategoryFilter";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";

import { toast } from "@/lib/no-toast";
import { Group, Panel, Separator } from "react-resizable-panels";
import { useQuery } from "@tanstack/react-query";
import { mergeRestaurants, RESTAURANT_MERGE_SELECT } from "@/hooks/use-restaurants";
import { LoadingSurface } from "@/components/ui/loading-surface";
import { debugLog as logDebug } from "@/lib/debug-log";
import { restaurantMatchesOverseasCountry } from "@/lib/overseas-region-matching";
import { GOOGLE_MAPS_LOAD_STATE_EVENT } from "@/hooks/use-google-maps";
import { buildEditRestaurantInitialFormData } from "@/lib/edit-restaurant-request-form";

// 코드 스플리팅으로 성능 최적화
const RestaurantSearch = lazy(() => import("@/components/search/RestaurantSearch"));
const MapView = dynamic(() => import("@/components/map/MapView"), {
    ssr: false,
    loading: () => null,
});
const AdminRestaurantModal = dynamic(
    () => import("@/components/admin/AdminRestaurantModal").then((mod) => ({ default: mod.AdminRestaurantModal })),
    { ssr: false }
);
const RestaurantDetailPanel = dynamic(
    () => import("@/components/restaurant/RestaurantDetailPanel").then((mod) => ({ default: mod.RestaurantDetailPanel })),
    { ssr: false }
);
const ReviewModal = dynamic(
    () => import("@/components/reviews/ReviewModal").then((mod) => ({ default: mod.ReviewModal })),
    { ssr: false }
);
const EditRestaurantModal = dynamic(
    () => import("@/components/modals/EditRestaurantModal").then((mod) => ({ default: mod.EditRestaurantModal })),
    { ssr: false }
);

// 글로벌 페이지용 국가 목록
const GLOBAL_COUNTRIES = [
    "미국", "일본", "대만", "태국", "인도네시아", "튀르키예", "헝가리", "오스트레일리아"
] as const;

type GlobalCountry = typeof GLOBAL_COUNTRIES[number];

function GlobalMapSearchLoading() {
    return (
        <div className="w-full sm:col-span-2 lg:col-span-1" aria-hidden="true" data-global-map-search-skeleton="true">
            <LoadingSurface label="맛집 검색 준비 중">
                <div className="flex h-10 items-center rounded-md border px-3 text-sm">맛집 검색하기</div>
            </LoadingSurface>
        </div>
    );
}

// 그리드 지역 설정 (글로벌 국가)
const GRID_COUNTRIES: GlobalCountry[] = ["미국", "일본", "태국", "인도네시아"];

type GoogleMapsFallbackState = "idle" | "loaded" | "error";

const GLOBAL_MAP_FALLBACK_RESULT_LIMIT = 10;

function getGlobalMapFallbackCategories(restaurant: Restaurant): string[] {
    if (Array.isArray(restaurant.categories)) {
        return restaurant.categories.filter(Boolean);
    }

    if (typeof restaurant.categories === "string") {
        return [restaurant.categories];
    }

    if (Array.isArray(restaurant.category)) {
        return restaurant.category.filter(Boolean);
    }

    return restaurant.category ? [restaurant.category] : [];
}

function getGlobalMapFallbackAddress(restaurant: Restaurant): string {
    return restaurant.road_address || restaurant.jibun_address || restaurant.address || "주소 정보 없음";
}

export default function GlobalMapPage() {
    const { isAdmin } = useAuth();

    // Page State
    const [refreshTrigger, setRefreshTrigger] = useState(0);
    const [selectedRestaurant, setSelectedRestaurant] = useState<Restaurant | null>(null);

    // Admin Edit State
    const [isAdminEditModalOpen, setIsAdminEditModalOpen] = useState(false);
    const [adminRestaurantToEdit, setAdminRestaurantToEdit] = useState<Restaurant | null>(null);

    const handleAdminEditRestaurant = useCallback((restaurant: Restaurant) => {
        setAdminRestaurantToEdit(restaurant);
        setIsAdminEditModalOpen(true);
    }, []);

    const onAdminEditRestaurant = isAdmin ? handleAdminEditRestaurant : undefined;
    const prevSelectedRestaurantRef = useRef<Restaurant | null>(null);
    const detailPanelRef = useRef<HTMLDivElement>(null);

    // State Declarations
    const [panelWidth, setPanelWidth] = useState(0);
    const [panelRestaurant, setPanelRestaurant] = useState<Restaurant | null>(null);
    const [isFilterOpen, setIsFilterOpen] = useState(false);
    const [selectedCountry, setSelectedCountry] = useState<GlobalCountry | null>("튀르키예");
    const [searchedRestaurant, setSearchedRestaurant] = useState<Restaurant | null>(null);
    const [isGridMode, setIsGridMode] = useState(false);
    const [restaurantToEdit, setRestaurantToEdit] = useState<Restaurant | null>(null);
    const [moveToRestaurant, setMoveToRestaurant] = useState<((restaurant: Restaurant) => void) | null>(null);
    const [isPanelOpen, setIsPanelOpen] = useState(false);
    const [isReviewModalOpen, setIsReviewModalOpen] = useState(false);
    const [filters, setFilters] = useState<FilterState>({
        categories: [],
        minRating: 1,
        minReviews: 0,
        minUserVisits: 0,
        minJjyangVisits: 0,
    });
    const [googleMapsFallbackState, setGoogleMapsFallbackState] = useState<GoogleMapsFallbackState>("idle");
    const [fallbackSearchQuery, setFallbackSearchQuery] = useState("");

    // 팝업에서 선택된 맛집 처리 (초기 로딩 시 + 이벤트 수신 시)
    useEffect(() => {
        const handleRestaurantSelected = (event: Event) => {
            const customEvent = event as CustomEvent;
            const { restaurant } = customEvent.detail;

            if (restaurant) {
                setSelectedRestaurant(restaurant);
                setPanelRestaurant(restaurant);
                setIsPanelOpen(true);
            }
        };

        window.addEventListener('restaurant-selected', handleRestaurantSelected);

        const storedRestaurant = sessionStorage.getItem('selectedRestaurant');

        if (storedRestaurant) {
            try {
                const restaurant = JSON.parse(storedRestaurant);
                setSelectedRestaurant(restaurant);
                setPanelRestaurant(restaurant);
                setIsPanelOpen(true);

                // 사용 후 스토리지 클리어
                sessionStorage.removeItem('selectedRestaurant');
            } catch (e) {
                console.error('Failed to parse stored restaurant:', e);
            }
        }

        return () => {
            window.removeEventListener('restaurant-selected', handleRestaurantSelected);
        };
    }, []);

    useEffect(() => {
        const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || "";

        if (!apiKey) {
            setGoogleMapsFallbackState("error");
            return;
        }

        const currentState = window.__tzudongGoogleMapsLoadState;
        if (currentState?.status === "error" || currentState?.status === "loaded") {
            setGoogleMapsFallbackState(currentState.status);
        }

        const handleGoogleMapsLoadState = (event: Event) => {
            const detail = (event as CustomEvent<{ status?: GoogleMapsFallbackState }>).detail;
            if (detail?.status === "error" || detail?.status === "loaded") {
                setGoogleMapsFallbackState(detail.status);
            }
        };

        window.addEventListener(GOOGLE_MAPS_LOAD_STATE_EVENT, handleGoogleMapsLoadState);
        return () => {
            window.removeEventListener(GOOGLE_MAPS_LOAD_STATE_EVENT, handleGoogleMapsLoadState);
        };
    }, []);

    // 글로벌 맛집 데이터 가져오기 (병합 로직 적용을 위해 전체 데이터 필요)
    const { data: globalRestaurants = [] } = useQuery({
        queryKey: ['global-restaurants-count'],
        queryFn: async () => {
            const { data: allRestaurants, error } = await supabase
                .from('restaurants')
                .select(RESTAURANT_MERGE_SELECT)
                .eq('status', 'approved')
                .returns<Restaurant[]>();

            if (error) {
                return [];
            }
            // 병합 로직 적용하여 중복 제거
            return mergeRestaurants(allRestaurants || []);
        },
    });

    // 국가별 맛집 수 계산 (병합된 데이터 기준)
    const countryCounts = useMemo(() => {
        const counts: Record<string, number> = {};

        globalRestaurants.forEach((restaurant) => {
            // 각 국가에 대해 확인
            GLOBAL_COUNTRIES.forEach((country) => {
                if (restaurantMatchesOverseasCountry(restaurant, country)) {
                    counts[country] = (counts[country] || 0) + 1;
                }
            });
        });

        return counts;
    }, [globalRestaurants]);

    const normalizedFallbackSearchQuery = fallbackSearchQuery.trim().toLowerCase();
    const fallbackRestaurants = useMemo(() => {
        return globalRestaurants.filter((restaurant) => {
            if (selectedCountry && !restaurantMatchesOverseasCountry(restaurant, selectedCountry)) {
                return false;
            }

            const restaurantCategories = getGlobalMapFallbackCategories(restaurant);
            if (
                filters.categories.length > 0 &&
                !filters.categories.some((category) => restaurantCategories.includes(category))
            ) {
                return false;
            }

            if (!normalizedFallbackSearchQuery) {
                return true;
            }

            const searchableText = [
                restaurant.name,
                getGlobalMapFallbackAddress(restaurant),
                restaurantCategories.join(" "),
            ].join(" ").toLowerCase();

            return searchableText.includes(normalizedFallbackSearchQuery);
        });
    }, [filters.categories, globalRestaurants, normalizedFallbackSearchQuery, selectedCountry]);
    const visibleFallbackRestaurants = fallbackRestaurants.slice(0, GLOBAL_MAP_FALLBACK_RESULT_LIMIT);
    const shouldShowGoogleMapsFallback = !isGridMode && googleMapsFallbackState === "error";

    const handleFallbackRestaurantSelect = useCallback((restaurant: Restaurant) => {
        setSelectedRestaurant(restaurant);
        setPanelRestaurant(restaurant);
        setIsPanelOpen(true);
    }, []);

    // selectedRestaurant 변경 감지 - 팝업에서 전달된 경우에만 패널 열기
    useEffect(() => {
        prevSelectedRestaurantRef.current = selectedRestaurant;
    }, [selectedRestaurant]);

    // ResizeObserver로 패널 너비 추적
    useEffect(() => {
        const detailPanel = detailPanelRef.current;
        if (!isPanelOpen || !panelRestaurant || !detailPanel) {
            setPanelWidth(0);
            return;
        }

        const updatePanelWidth = (width: number) => {
            if (Number.isFinite(width) && width > 0) {
                setPanelWidth(width);
            }
        };
        updatePanelWidth(detailPanel.getBoundingClientRect().width);

        const resizeObserver = new ResizeObserver((entries) => {
            for (const entry of entries) {
                updatePanelWidth(entry.contentRect.width);
            }
        });
        resizeObserver.observe(detailPanel);

        return () => {
            resizeObserver.disconnect();
        };
    }, [isPanelOpen, panelRestaurant]);

    const handleFilterChange = useCallback((newFilters: FilterState) => {
        setFilters(newFilters);
    }, []);

    const handleRestaurantSelect = useCallback((restaurant: Restaurant) => {
        // 선택된 맛집을 MapView에 전달하기 위해 상태 업데이트
        setSelectedRestaurant(restaurant);
    }, [setSelectedRestaurant]);

    // 검색된 맛집의 국가를 찾는 헬퍼 함수
    const getRestaurantCountry = useCallback((restaurant: Restaurant): GlobalCountry | null => {
        // 각 국가에 대해 확인
        for (const country of GLOBAL_COUNTRIES) {
            if (restaurantMatchesOverseasCountry(restaurant, country)) {
                return country;
            }
        }
        return null;
    }, []);

    const handleRestaurantSearch = useCallback((restaurant: Restaurant) => {
        logDebug("[handleRestaurantSearch] 호출", {
            restaurant,
            moveToRestaurantExists: !!moveToRestaurant,
            isGridMode,
            selectedCountry,
        });

        // 검색된 맛집의 국가로 하단 컨트롤 패널의 국가 필터 실시간 변경
        const restaurantCountry = getRestaurantCountry(restaurant);
        if (restaurantCountry && restaurantCountry !== selectedCountry) {
            setSelectedCountry(restaurantCountry);
            logDebug('🌍 검색된 맛집 국가로 필터 변경:', restaurantCountry);
        }

        // 검색 시에는 지도 재조정을 위해 searchedRestaurant 설정 (객체 복사로 참조 변경 보장)
        setSearchedRestaurant({ ...restaurant });
        setSelectedRestaurant(restaurant);

        // 검색 시 자동으로 패널 열기
        setPanelRestaurant(restaurant);
        setIsPanelOpen(true);

        // 지도 이동 함수가 준비되었다면 약간의 지연 후 이동 (패널 오픈 애니메이션 고려)
        if (moveToRestaurant) {
            logDebug("[handleRestaurantSearch] moveToRestaurant 실행 예약", { restaurant });
            // 300ms 지연 후 이동 (패널이 열리고 지도가 리사이즈될 시간을 줌)
            setTimeout(() => {
                moveToRestaurant(restaurant);
            }, 300);
        }

        // 그리드 모드에서 검색 시 단일 모드로 전환
        if (isGridMode) {
            logDebug("[handleRestaurantSearch] 그리드 모드에서 단일 모드로 전환");
            setIsGridMode(false);
        }
    }, [moveToRestaurant, isGridMode, setSelectedRestaurant, selectedCountry, getRestaurantCountry]);

    const switchToSingleMap = useCallback(() => {
        // 그리드 모드에서 검색 시 단일 모드로 전환
        if (isGridMode) {
            setIsGridMode(false);
        }
    }, [isGridMode]);

    const handleMapReady = useCallback((moveFunction: (restaurant: Restaurant) => void) => {
        setMoveToRestaurant(() => moveFunction);
    }, []);

    // 패널 관리를 GlobalMapPage 레벨로 완전 이동
    const handleMarkerClick = useCallback((restaurant: Restaurant) => {
        setSelectedRestaurant(restaurant); // 외부 상태 관리
        setPanelRestaurant(restaurant); // 패널 전용 상태
        setIsPanelOpen(true); // 패널 열기
    }, [setSelectedRestaurant]);

    const handlePanelClose = useCallback(() => {
        setIsPanelOpen(false);
        setPanelRestaurant(null);
    }, []);

    // refreshTrigger 변경 시 패널 레스토랑 정보 업데이트
    useEffect(() => {
        if (panelRestaurant) {
            // 패널에 표시된 레스토랑이 업데이트되었는지 확인
            // 여기서는 간단히 refreshTrigger로 인한 업데이트만 처리
            // 실제 데이터 업데이트는 MapView에서 처리됨
        }
    }, [refreshTrigger, panelRestaurant]);

    return (
        <>
            {/* 하단 컨트롤 패널 */}
            <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-10 w-[min(calc(100vw-1rem),72rem)] px-2">
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-[minmax(0,12rem)_minmax(0,12rem)_minmax(0,1fr)_auto] gap-2 lg:gap-3 bg-background/95 rounded-lg border border-border p-2 lg:p-3 shadow-lg">
                    {/* 국가 선택 */}
                    <Select
                        value={selectedCountry || "튀르키예"}
                        onValueChange={(value) => {
                            setSelectedCountry(value as GlobalCountry);
                        }}
                    >
                        <SelectTrigger className="w-full">
                            <MapPin className="h-4 w-4 shrink-0 text-muted-foreground" />
                            <SelectValue>{selectedCountry || "튀르키예"}</SelectValue>
                        </SelectTrigger>
                        <SelectContent>
                            {GLOBAL_COUNTRIES.map((country) => {
                                const count = countryCounts[country] || 0;
                                return (
                                    <SelectItem key={country} value={country} textValue={country}>
                                        <div className="flex items-center justify-between w-full">
                                            <span className="whitespace-nowrap">{country}</span>
                                            <span className="ml-2 text-xs text-muted-foreground whitespace-nowrap">({count}개)</span>
                                        </div>
                                    </SelectItem>
                                );
                            })}
                        </SelectContent>
                    </Select>

                    {/* 카테고리 필터링 */}
                    <CategoryFilter
                        selectedCategories={filters.categories}
                        onCategoryChange={(categories) => setFilters(prev => ({ ...prev, categories }))}
                        selectedCountry={selectedCountry}
                        className="w-full"
                    />

                    {/* 맛집 검색 */}
                    <Suspense fallback={<GlobalMapSearchLoading />}>
                        <RestaurantSearch
                            onRestaurantSelect={handleRestaurantSelect}
                            onRestaurantSearch={handleRestaurantSearch}
                            onSearchExecute={switchToSingleMap}
                            filters={filters}
                            selectedRegion={selectedCountry}
                        />
                    </Suspense>

                    <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setIsGridMode(!isGridMode)}
                        className="flex items-center justify-center gap-2 w-full sm:col-span-2 lg:col-span-1 lg:w-auto"
                        aria-label={isGridMode ? "단일 지도 보기" : "국가별 지도 보기"}
                    >
                        {isGridMode ? <Map className="h-4 w-4" /> : <Grid3X3 className="h-4 w-4" />}
                    </Button>
                </div>
            </div>

            {isGridMode ? (
                // 그리드 모드: 2x2 그리드로 4개 국가 표시
                <div className="grid grid-cols-2 grid-rows-2 h-full w-full gap-1 p-1">
                    {GRID_COUNTRIES.map((country) => (
                        <div key={country} className="relative min-h-0 overflow-hidden rounded-md border border-border">
                            <Suspense fallback={null}>
                                <MapView
                                    filters={filters}
                                    selectedCountry={country}
                                    selectedRestaurant={null} // 그리드 모드에서는 단일 지도 selectedRestaurant 사용 안 함
                                    refreshTrigger={refreshTrigger}
                                    onAdminEditRestaurant={onAdminEditRestaurant}
                                />
                            </Suspense>
                            <Button
                                variant="secondary"
                                size="sm"
                                className="absolute top-2 left-2 bg-background/95 hover:bg-background text-sm font-semibold shadow z-10 h-auto py-1 px-2 text-foreground"
                                onClick={() => {
                                    setIsGridMode(false);
                                    setSelectedCountry(country);
                                }}
                            >
                                {country}
                            </Button>
                        </div>
                    ))}
                </div>
            ) : (
                // 단일 지도 모드
                <Suspense fallback={null}>
                    <Group
                        orientation="horizontal"
                        className="w-full h-full"
                        data-global-map-panel-group="true"
                        data-global-map-observed-detail-width={Math.round(panelWidth)}
                    >
                        <Panel
                            id="map-panel"
                            defaultSize={panelRestaurant && isPanelOpen ? "75%" : "100%"}
                            minSize="40%"
                            maxSize="100%"
                            data-global-map-panel="map"
                        >
                            <div className="relative h-full w-full">
                                <MapView
                                    filters={filters}
                                    selectedCountry={selectedCountry}
                                    searchedRestaurant={searchedRestaurant} // 검색 시 지도 재조정용
                                    selectedRestaurant={selectedRestaurant}
                                    refreshTrigger={refreshTrigger}
                                    onAdminEditRestaurant={onAdminEditRestaurant}
                                    onRestaurantSelect={setSelectedRestaurant}
                                    onMapReady={handleMapReady}
                                    onRequestEditRestaurant={setRestaurantToEdit}
                                    onMarkerClick={handleMarkerClick}
                                    panelWidth={panelWidth}
                                />

                                {shouldShowGoogleMapsFallback && (
                                    <Card
                                        className="absolute left-3 top-3 z-20 max-h-[calc(100%-1.5rem)] w-[min(calc(100%-1.5rem),24rem)] overflow-hidden border-border bg-background/95 p-3 shadow-lg"
                                        data-global-map-google-fallback="true"
                                        data-global-map-fallback-source="globalRestaurants"
                                    >
                                        <div className="space-y-3">
                                            <div className="space-y-1">
                                                <p className="text-sm font-semibold text-foreground">지도 없이 글로벌 맛집 둘러보기</p>
                                                <p className="text-xs leading-5 text-muted-foreground">
                                                    Google 지도가 준비되지 않아도 현재 필터와 검색으로 맛집을 고르고 상세 정보를 볼 수 있어요.
                                                </p>
                                            </div>

                                            <Input
                                                aria-label="글로벌 지도 대체 목록 검색"
                                                value={fallbackSearchQuery}
                                                onChange={(event) => setFallbackSearchQuery(event.target.value)}
                                                placeholder="이름, 주소, 카테고리 검색"
                                                className="h-9"
                                            />

                                            <div className="text-xs text-muted-foreground" aria-live="polite">
                                                {fallbackRestaurants.length}개 중 {visibleFallbackRestaurants.length}개 표시
                                            </div>

                                            <div className="max-h-72 space-y-2 overflow-y-auto pr-1">
                                                {visibleFallbackRestaurants.length > 0 ? (
                                                    visibleFallbackRestaurants.map((restaurant) => {
                                                        const categories = getGlobalMapFallbackCategories(restaurant);
                                                        return (
                                                            <button
                                                                key={restaurant.id}
                                                                type="button"
                                                                className="w-full rounded-md border border-border bg-card/80 p-2 text-left transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                                                                onClick={() => handleFallbackRestaurantSelect(restaurant)}
                                                            >
                                                                <span className="block truncate text-sm font-medium text-foreground">{restaurant.name}</span>
                                                                <span className="mt-1 block truncate text-xs text-muted-foreground">
                                                                    {getGlobalMapFallbackAddress(restaurant)}
                                                                </span>
                                                                {categories.length > 0 && (
                                                                    <span className="mt-2 flex flex-wrap gap-1">
                                                                        {categories.slice(0, 3).map((category) => (
                                                                            <Badge key={category} variant="secondary" className="text-2xs">
                                                                                {category}
                                                                            </Badge>
                                                                        ))}
                                                                    </span>
                                                                )}
                                                            </button>
                                                        );
                                                    })
                                                ) : (
                                                    <p className="rounded-md border border-dashed border-border p-3 text-sm text-muted-foreground">
                                                        현재 국가, 카테고리, 검색어에 맞는 맛집이 없습니다.
                                                    </p>
                                                )}
                                            </div>
                                        </div>
                                    </Card>
                                )}
                            </div>
                        </Panel>

                        {/* Resize Handle */}
                        {panelRestaurant && isPanelOpen && (
                            <Separator
                                className="w-2 bg-border hover:bg-primary/20 transition-colors relative"
                                aria-label="글로벌 지도 상세 패널 너비 조절"
                                data-global-map-resize-handle="true"
                            >
                                <div className="absolute inset-y-0 left-1/2 transform -translate-x-1/2 w-1 bg-muted-foreground/30 rounded-full"></div>
                            </Separator>
                        )}

                        {/* Restaurant Detail Panel */}
                        {panelRestaurant && isPanelOpen && (
                            <Panel
                                id="detail-panel"
                                defaultSize="25%"
                                minSize="20%"
                                maxSize="33%"
                                data-global-map-panel="detail"
                            >
                                <div ref={detailPanelRef} className="h-full">
                                    <RestaurantDetailPanel
                                        restaurant={panelRestaurant}
                                        onClose={handlePanelClose}
                                        onWriteReview={() => {
                                            setIsReviewModalOpen(true);
                                        }}
                                        onEditRestaurant={onAdminEditRestaurant ? () => {
                                            onAdminEditRestaurant(panelRestaurant);
                                        } : undefined}
                                        onRequestEditRestaurant={setRestaurantToEdit}
                                    />
                                </div>
                            </Panel>
                        )}
                    </Group>
                </Suspense>
            )}

            <Sheet open={isFilterOpen} onOpenChange={setIsFilterOpen}>
                <SheetContent side="left" className="w-80 p-0">
                    <FilterPanel
                        filters={filters}
                        onFilterChange={handleFilterChange}
                        onClose={() => setIsFilterOpen(false)}
                    />
                </SheetContent>
            </Sheet>

            {/* 맛집 수정 요청 모달 */}
            {restaurantToEdit && (
                <EditRestaurantModal
                    isOpen={true}
                    onClose={() => setRestaurantToEdit(null)}
                    restaurant={restaurantToEdit}
                    initialFormData={buildEditRestaurantInitialFormData(restaurantToEdit)}
                />
            )}

            {/* 리뷰 작성 모달 */}
            {isReviewModalOpen && (
                <ReviewModal
                    isOpen={isReviewModalOpen}
                    onClose={() => setIsReviewModalOpen(false)}
                    restaurant={panelRestaurant ? { id: panelRestaurant.id, name: panelRestaurant.name } : null}
                    onSuccess={() => {
                        // refreshTrigger를 업데이트해서 데이터 새로고침
                        // 부모 컴포넌트에서 refreshTrigger를 관리하므로 여기서는 사용하지 않음
                        toast.success("리뷰가 성공적으로 등록되었습니다!");
                    }}
                />
            )}
            {/* 관리자 맛집 수정 모달 */}
            {isAdmin && (
                <AdminRestaurantModal
                    isOpen={isAdminEditModalOpen}
                    onClose={() => {
                        setIsAdminEditModalOpen(false);
                        setAdminRestaurantToEdit(null);
                    }}
                    restaurant={adminRestaurantToEdit}
                    onSuccess={(updatedRestaurant) => {
                        setRefreshTrigger(prev => prev + 1);
                        if (updatedRestaurant && selectedRestaurant?.id === updatedRestaurant.id) {
                            setSelectedRestaurant(updatedRestaurant);
                            setPanelRestaurant(updatedRestaurant);
                        }
                        setIsAdminEditModalOpen(false);
                        setAdminRestaurantToEdit(null);
                    }}
                />
            )}
        </>
    );
}
