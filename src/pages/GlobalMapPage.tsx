import { useState, memo, Suspense, lazy } from "react";
import MapView from "@/components/map/MapView";
import { FilterPanel, FilterState } from "@/components/filters/FilterPanel";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { MapPin, Grid3X3, Map } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { Restaurant } from "@/types/restaurant";

// 코드 스플리팅으로 성능 최적화
const RestaurantSearch = lazy(() => import("@/components/search/RestaurantSearch"));

// 글로벌 페이지용 국가 목록
const GLOBAL_COUNTRIES = [
  "미국", "일본", "태국", "인도네시아", "튀르키예", "헝가리", "오스트레일리아"
] as const;

type GlobalCountry = typeof GLOBAL_COUNTRIES[number];

interface GlobalMapPageProps {
    refreshTrigger: number;
    selectedRestaurant: Restaurant | null;
    setSelectedRestaurant: (restaurant: Restaurant | null) => void;
    onAdminEditRestaurant?: (restaurant: Restaurant) => void;
}

// 그리드 지역 설정 (글로벌 국가)
const GRID_COUNTRIES: GlobalCountry[] = ["미국", "일본", "태국", "인도네시아"];

const GlobalMapPage = memo(({ refreshTrigger, selectedRestaurant, setSelectedRestaurant, onAdminEditRestaurant }: GlobalMapPageProps) => {
    const { isAdmin } = useAuth();
    const [isFilterOpen, setIsFilterOpen] = useState(false);
    const [selectedCountry, setSelectedCountry] = useState<GlobalCountry | null>("미국");
    const [searchedRestaurant, setSearchedRestaurant] = useState<Restaurant | null>(null);
    const [isGridMode, setIsGridMode] = useState(false);
    const [filters, setFilters] = useState<FilterState>({
        categories: [],
        minRating: 1,
        minReviews: 0,
        minUserVisits: 0,
        minJjyangVisits: 0,
    });

    const handleFilterChange = (newFilters: FilterState) => {
        setFilters(newFilters);
    };

    const handleRestaurantSelect = (restaurant: Restaurant) => {
        // 선택된 맛집을 MapView에 전달하기 위해 상태 업데이트
        setSelectedRestaurant(restaurant);
    };

    const handleRestaurantSearch = (restaurant: Restaurant) => {
        // 검색 시에는 지도 재조정을 위해 searchedRestaurant 설정
        setSearchedRestaurant(restaurant);
        setSelectedRestaurant(restaurant);
        // 그리드 모드에서 검색 시 단일 모드로 전환
        if (isGridMode) {
            setIsGridMode(false);
            // 검색된 맛집의 국가로 전환 (가능하다면)
            // TODO: 맛집의 국가 정보를 기반으로 selectedCountry 설정
        }
    };

    const switchToSingleMap = () => {
        // 그리드 모드에서 검색 시 단일 모드로 전환
        if (isGridMode) {
            setIsGridMode(false);
        }
    };

    return (
        <>
            {/* 하단 컨트롤 패널 */}
            <div className="absolute bottom-4 left-1/2 transform -translate-x-1/2 z-10">
                <div className="flex items-center gap-3 bg-background/95 backdrop-blur-sm rounded-lg border border-border p-3 shadow-lg">
                    {/* 국가 선택 */}
                    <Select
                        value={selectedCountry || "all"}
                        onValueChange={(value) => {
                            const newCountry = value === "all" ? null : (value as GlobalCountry);
                            setSelectedCountry(newCountry);
                        }}
                    >
                        <SelectTrigger className="w-40">
                            <div className="flex items-center gap-2">
                                <MapPin className="h-4 w-4 text-muted-foreground" />
                                <SelectValue placeholder="국가를 선택하세요" />
                            </div>
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="all">전체</SelectItem>
                            {GLOBAL_COUNTRIES.map((country) => (
                                <SelectItem key={country} value={country}>
                                    {country}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>

                    {/* 맛집 검색 */}
                    <Suspense fallback={<div className="w-72 h-10 bg-muted animate-pulse rounded" />}>
                        <RestaurantSearch
                            onRestaurantSelect={handleRestaurantSelect}
                            onRestaurantSearch={handleRestaurantSearch}
                            onSearchExecute={switchToSingleMap}
                        />
                    </Suspense>

                    {/* 카테고리 필터링 */}
                    <Select
                        value={filters.categories.length > 0 ? filters.categories.join(',') : 'all'}
                        onValueChange={(value) => {
                            if (value === 'all') {
                                setFilters(prev => ({ ...prev, categories: [] }));
                            } else {
                                setFilters(prev => ({ ...prev, categories: value.split(',').filter(Boolean) }));
                            }
                        }}
                    >
                        <SelectTrigger className="w-40">
                            <SelectValue placeholder="카테고리 필터" />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="all">전체</SelectItem>
                            <SelectItem value="한식">한식</SelectItem>
                            <SelectItem value="중식">중식</SelectItem>
                            <SelectItem value="양식">양식</SelectItem>
                            <SelectItem value="분식">분식</SelectItem>
                            <SelectItem value="치킨">치킨</SelectItem>
                            <SelectItem value="피자">피자</SelectItem>
                            <SelectItem value="고기">고기</SelectItem>
                            <SelectItem value="족발·보쌈">족발·보쌈</SelectItem>
                            <SelectItem value="돈까스·회">돈까스·회</SelectItem>
                            <SelectItem value="아시안">아시안</SelectItem>
                            <SelectItem value="패스트푸드">패스트푸드</SelectItem>
                            <SelectItem value="카페·디저트">카페·디저트</SelectItem>
                            <SelectItem value="찜·탕">찜·탕</SelectItem>
                            <SelectItem value="야식">야식</SelectItem>
                            <SelectItem value="도시락">도시락</SelectItem>
                        </SelectContent>
                    </Select>

                    <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setIsGridMode(!isGridMode)}
                        className="flex items-center gap-2"
                    >
                        {isGridMode ? <Map className="h-4 w-4" /> : <Grid3X3 className="h-4 w-4" />}
                    </Button>
                </div>
            </div>

            {isGridMode ? (
                // 그리드 모드: 2x2 그리드로 4개 국가 표시
                <div className="grid grid-cols-2 grid-rows-2 h-full w-full gap-1 p-1">
                    {GRID_COUNTRIES.map((country, index) => (
                        <div key={country} className="relative min-h-0 overflow-hidden rounded-md border border-border">
                            <Suspense fallback={<div className="flex items-center justify-center h-full">지도 로딩 중...</div>}>
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
                                className="absolute top-2 left-2 bg-background/95 backdrop-blur-sm hover:bg-background text-sm font-semibold shadow z-10 h-auto py-1 px-2 text-foreground"
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
                <Suspense fallback={
                    <div className="flex items-center justify-center h-full bg-muted">
                        <div className="text-center space-y-4">
                            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto"></div>
                            <div className="space-y-2">
                                <h2 className="text-lg font-semibold bg-gradient-primary bg-clip-text text-transparent">
                                    지도 준비 중...
                                </h2>
                                <p className="text-sm text-muted-foreground">
                                    잠시만 기다려주세요
                                </p>
                            </div>
                        </div>
                    </div>
                }>
                    <MapView
                        filters={filters}
                        selectedCountry={selectedCountry}
                        searchedRestaurant={searchedRestaurant} // 검색 시 지도 재조정용
                        selectedRestaurant={selectedRestaurant}
                        refreshTrigger={refreshTrigger}
                        onAdminEditRestaurant={onAdminEditRestaurant}
                        onRestaurantSelect={setSelectedRestaurant}
                    />
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
        </>
    );
});

GlobalMapPage.displayName = 'GlobalMapPage';

export default GlobalMapPage;

