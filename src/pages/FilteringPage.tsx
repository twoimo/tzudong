import { useState, useMemo } from "react";
import { Search, ArrowUpDown, ArrowUp, ArrowDown, Filter } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Checkbox } from "@/components/ui/checkbox";
import {
    Popover,
    PopoverContent,
    PopoverTrigger,
} from "@/components/ui/popover";
import { RESTAURANT_CATEGORIES, Restaurant } from "@/types/restaurant";
import { useRestaurants } from "@/hooks/use-restaurants";
import { useAuth } from "@/contexts/AuthContext";

// 지역 목록
const REGIONS = [
    "서울", "경기", "인천", "부산", "대구", "광주", "대전", "울산",
    "세종", "강원", "충북", "충남", "전북", "전남", "경북", "경남", "제주"
];

type SortColumn = "name" | "category" | "fanVisits";
type SortDirection = "asc" | "desc" | null;

interface FilterState {
    searchQuery: string;
    categories: string[];
    regions: string[];
    fanVisitsMin: number;
}

interface FilteringPageProps {
    onAdminEditRestaurant?: (restaurant: Restaurant) => void;
}

const FilteringPage = ({ onAdminEditRestaurant }: FilteringPageProps) => {
    const { data: restaurants = [], isLoading } = useRestaurants({ enabled: true });
    const { isAdmin } = useAuth();

    const [sortColumn, setSortColumn] = useState<SortColumn | null>(null);
    const [sortDirection, setSortDirection] = useState<SortDirection>(null);

    const [filters, setFilters] = useState<FilterState>({
        searchQuery: "",
        categories: [],
        regions: [],
        fanVisitsMin: 0,
    });

    const handleSort = (column: SortColumn) => {
        if (sortColumn === column) {
            if (sortDirection === "asc") {
                setSortDirection("desc");
            } else if (sortDirection === "desc") {
                setSortColumn(null);
                setSortDirection(null);
            } else {
                setSortDirection("asc");
            }
        } else {
            setSortColumn(column);
            setSortDirection("asc");
        }
    };

    const getSortIcon = (column: SortColumn) => {
        if (sortColumn !== column) return <ArrowUpDown className="h-4 w-4" />;
        if (sortDirection === "asc") return <ArrowUp className="h-4 w-4" />;
        if (sortDirection === "desc") return <ArrowDown className="h-4 w-4" />;
        return <ArrowUpDown className="h-4 w-4" />;
    };

    const handleCategoryToggle = (category: string) => {
        setFilters(prev => ({
            ...prev,
            categories: prev.categories.includes(category)
                ? prev.categories.filter(c => c !== category)
                : [...prev.categories, category]
        }));
    };

    const handleRegionToggle = (region: string) => {
        setFilters(prev => ({
            ...prev,
            regions: prev.regions.includes(region)
                ? prev.regions.filter(r => r !== region)
                : [...prev.regions, region]
        }));
    };

    const handleResetFilters = () => {
        setFilters({
            searchQuery: "",
            categories: [],
            regions: [],
            fanVisitsMin: 0,
        });
        setSortColumn(null);
        setSortDirection(null);
    };

    // 주소에서 지역 추출 함수
    const extractRegion = (address: string): string => {
        if (!address) return "";

        // 시/도 패턴 매칭
        const regionPatterns = [
            { pattern: /^서울/, region: "서울" },
            { pattern: /^경기도|^경기/, region: "경기" },
            { pattern: /^인천/, region: "인천" },
            { pattern: /^부산/, region: "부산" },
            { pattern: /^대구/, region: "대구" },
            { pattern: /^광주/, region: "광주" },
            { pattern: /^대전/, region: "대전" },
            { pattern: /^울산/, region: "울산" },
            { pattern: /^세종/, region: "세종" },
            { pattern: /^강원/, region: "강원" },
            { pattern: /^충청북도|^충북/, region: "충북" },
            { pattern: /^충청남도|^충남/, region: "충남" },
            { pattern: /^전라북도|^전북/, region: "전북" },
            { pattern: /^전라남도|^전남/, region: "전남" },
            { pattern: /^경상북도|^경북/, region: "경북" },
            { pattern: /^경상남도|^경남/, region: "경남" },
            { pattern: /^제주/, region: "제주" },
        ];

        for (const { pattern, region } of regionPatterns) {
            if (pattern.test(address)) {
                return region;
            }
        }

        return "";
    };

    const filteredAndSortedRestaurants = useMemo(() => {
        if (!restaurants) return [];

        let result = [...restaurants];

        // 검색 필터
        if (filters.searchQuery) {
            result = result.filter(r =>
                r.name?.toLowerCase().includes(filters.searchQuery.toLowerCase())
            );
        }

        // 카테고리 필터
        if (filters.categories.length > 0) {
            result = result.filter(r => {
                // 카테고리 타입 처리: TEXT[] 배열 또는 단일 값
                let restaurantCategories: string[] = [];
                if (Array.isArray(r.category)) {
                    restaurantCategories = r.category;
                } else {
                    restaurantCategories = [String(r.category)].filter(Boolean);
                }

                return filters.categories.some(filterCat => restaurantCategories.includes(filterCat));
            });
        }

        // 지역 필터
        if (filters.regions.length > 0) {
            result = result.filter(r => {
                const region = extractRegion(r.address || "");
                return filters.regions.includes(region);
            });
        }


        // 쯔양 팬 방문 (리뷰) 횟수 필터
        if (filters.fanVisitsMin > 0) {
            result = result.filter(r => (r.review_count || 0) >= filters.fanVisitsMin);
        }



        // 정렬
        if (sortColumn && sortDirection) {
            result.sort((a, b) => {
                let aValue: any;
                let bValue: any;

                switch (sortColumn) {
                    case "name":
                        aValue = a.name || "";
                        bValue = b.name || "";
                        break;
                    case "category":
                        aValue = a.category || "";
                        bValue = b.category || "";
                        break;
                    case "fanVisits":
                        aValue = a.review_count || 0;
                        bValue = b.review_count || 0;
                        break;
                }

                if (typeof aValue === "string") {
                    return sortDirection === "asc"
                        ? aValue.localeCompare(bValue)
                        : bValue.localeCompare(aValue);
                } else {
                    return sortDirection === "asc" ? aValue - bValue : bValue - aValue;
                }
            });
        }

        return result;
    }, [restaurants, filters, sortColumn, sortDirection]);

    const getStarEmoji = (rating: number) => {
        const count = Math.round(rating);
        return "⭐".repeat(count);
    };

    const activeFilterCount =
        (filters.searchQuery ? 1 : 0) +
        filters.categories.length +
        filters.regions.length +
        (filters.fanVisitsMin > 0 ? 1 : 0);

    return (
        <div className="flex flex-col h-full bg-background">
            {/* Header */}
            <div className="border-b border-border bg-card p-6">
                <div className="flex items-center justify-between mb-4">
                    <div>
                        <div className="flex items-center gap-3">
                            <h1 className="text-2xl font-bold bg-gradient-primary bg-clip-text text-transparent flex items-center gap-2">
                                <Filter className="h-6 w-6 text-primary" />
                                쯔동여지도 필터링
                            </h1>
                        </div>
                        <p className="text-sm text-muted-foreground mt-1">
                            총 {filteredAndSortedRestaurants.length}개의 맛집
                            {activeFilterCount > 0 && (
                                <span className="ml-2 text-primary font-medium">
                                    ({activeFilterCount}개 필터 적용 중)
                                </span>
                            )}
                        </p>
                    </div>
                    <Button variant="outline" onClick={handleResetFilters}>
                        필터 초기화
                    </Button>
                </div>

                {/* Filter Controls */}
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-6 gap-3">
                    {/* 검색 */}
                    <div className="lg:col-span-2">
                        <div className="relative">
                            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                            <Input
                                placeholder="맛집명 검색..."
                                value={filters.searchQuery}
                                onChange={(e) => setFilters({ ...filters, searchQuery: e.target.value })}
                                className="pl-9"
                            />
                        </div>
                    </div>

                    {/* 지역 */}
                    <Popover>
                        <PopoverTrigger asChild>
                            <Button variant="outline" className="justify-between">
                                <span className="truncate">
                                    지역 {filters.regions.length > 0 && `(${filters.regions.length})`}
                                </span>
                                <Filter className="h-4 w-4 ml-2" />
                            </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-64" align="start">
                            <div className="space-y-2">
                                <h4 className="font-semibold text-sm mb-3">지역 선택</h4>
                                <ScrollArea className="h-64">
                                    <div className="grid grid-cols-2 gap-2 pr-3">
                                        {REGIONS.map((region) => (
                                            <div key={region} className="flex items-center space-x-2">
                                                <Checkbox
                                                    id={`region-${region}`}
                                                    checked={filters.regions.includes(region)}
                                                    onCheckedChange={() => handleRegionToggle(region)}
                                                />
                                                <label
                                                    htmlFor={`region-${region}`}
                                                    className="text-sm cursor-pointer flex-1"
                                                >
                                                    {region}
                                                </label>
                                            </div>
                                        ))}
                                    </div>
                                </ScrollArea>
                            </div>
                        </PopoverContent>
                    </Popover>

                    {/* 카테고리 */}
                    <Popover>
                        <PopoverTrigger asChild>
                            <Button variant="outline" className="justify-between">
                                <span className="truncate">
                                    카테고리 {filters.categories.length > 0 && `(${filters.categories.length})`}
                                </span>
                                <Filter className="h-4 w-4 ml-2" />
                            </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-64" align="start">
                            <div className="space-y-2">
                                <h4 className="font-semibold text-sm mb-3">카테고리 선택</h4>
                                <ScrollArea className="h-64">
                                    <div className="space-y-2 pr-3">
                                        {RESTAURANT_CATEGORIES.map((category) => (
                                            <div key={category} className="flex items-center space-x-2">
                                                <Checkbox
                                                    id={`cat-${category}`}
                                                    checked={filters.categories.includes(category)}
                                                    onCheckedChange={() => handleCategoryToggle(category)}
                                                />
                                                <label
                                                    htmlFor={`cat-${category}`}
                                                    className="text-sm cursor-pointer flex-1"
                                                >
                                                    {category}
                                                </label>
                                            </div>
                                        ))}
                                    </div>
                                </ScrollArea>
                            </div>
                        </PopoverContent>
                    </Popover>


                    {/* 쯔양 팬 방문횟수 */}
                    <Select
                        value={filters.fanVisitsMin.toString()}
                        onValueChange={(v) => setFilters({ ...filters, fanVisitsMin: parseInt(v) })}
                    >
                        <SelectTrigger>
                            <SelectValue placeholder="쯔양 팬 방문" />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="0">쯔양 팬 방문 (전체)</SelectItem>
                            <SelectItem value="10">10회 이상</SelectItem>
                            <SelectItem value="50">50회 이상</SelectItem>
                            <SelectItem value="100">100회 이상</SelectItem>
                            <SelectItem value="500">500회 이상</SelectItem>
                        </SelectContent>
                    </Select>

                </div>


                {/* 선택된 필터 태그 */}
                {activeFilterCount > 0 && (
                    <div className="flex flex-wrap gap-2 mt-4">
                        {filters.searchQuery && (
                            <Badge variant="secondary" className="gap-1">
                                검색: {filters.searchQuery}
                            </Badge>
                        )}
                        {filters.regions.map(region => (
                            <Badge key={region} variant="secondary" className="gap-1">
                                📍 {region}
                            </Badge>
                        ))}
                        {filters.categories.map(cat => (
                            <Badge key={cat} variant="secondary">
                                {cat}
                            </Badge>
                        ))}
                        {filters.fanVisitsMin > 0 && (
                            <Badge variant="secondary">
                                쯔양 팬 {filters.fanVisitsMin}회+
                            </Badge>
                        )}
                    </div>
                )}
            </div>

            {/* Table */}
            <div className="flex-1 overflow-hidden">
                <ScrollArea className="h-full">
                    <Table>
                        <TableHeader className="sticky top-0 bg-muted z-10">
                            <TableRow>
                                <TableHead className="w-[250px]">
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        onClick={() => handleSort("name")}
                                        className="hover:bg-accent w-full justify-start"
                                    >
                                        맛집명
                                        {getSortIcon("name")}
                                    </Button>
                                </TableHead>
                                <TableHead className="w-[150px]">
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        onClick={() => handleSort("category")}
                                        className="hover:bg-accent w-full justify-start"
                                    >
                                        카테고리
                                        {getSortIcon("category")}
                                    </Button>
                                </TableHead>
                                <TableHead className="w-[120px] text-center">
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        onClick={() => handleSort("fanVisits")}
                                        className="hover:bg-accent w-full justify-center"
                                    >
                                        쯔양 팬 방문 (리뷰)
                                        {getSortIcon("fanVisits")}
                                    </Button>
                                </TableHead>
                                <TableHead className="w-[250px]">주소</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {isLoading ? (
                                // Loading skeleton
                                Array.from({ length: 5 }).map((_, index) => (
                                    <TableRow key={index}>
                                        <TableCell>
                                            <div className="flex items-center gap-2">
                                                <div className="w-5 h-5 bg-muted rounded animate-pulse"></div>
                                                <div className="h-4 bg-muted rounded animate-pulse w-32"></div>
                                            </div>
                                        </TableCell>
                                        <TableCell>
                                            <div className="flex gap-1">
                                                <div className="h-5 bg-muted rounded animate-pulse w-16"></div>
                                                <div className="h-5 bg-muted rounded animate-pulse w-12"></div>
                                            </div>
                                        </TableCell>
                                        <TableCell className="text-center">
                                            <div className="h-4 bg-muted rounded animate-pulse w-12 mx-auto"></div>
                                        </TableCell>
                                        <TableCell className="text-center">
                                            <div className="h-4 bg-muted rounded animate-pulse w-8 mx-auto"></div>
                                        </TableCell>
                                    </TableRow>
                                ))
                            ) : filteredAndSortedRestaurants.length === 0 ? (
                                <TableRow>
                                    <TableCell colSpan={4} className="text-center py-12">
                                        <p className="text-muted-foreground">필터 조건에 맞는 맛집이 없습니다.</p>
                                    </TableCell>
                                </TableRow>
                            ) : (
                                filteredAndSortedRestaurants.map((restaurant) => (
                                    <TableRow
                                        key={restaurant.id}
                                        className="hover:bg-muted/50 cursor-pointer transition-colors"
                                        onClick={() => {
                                            if (isAdmin && onAdminEditRestaurant) {
                                                onAdminEditRestaurant(restaurant);
                                            }
                                        }}
                                    >
                                        <TableCell className="font-medium">
                                            <div className="flex items-center gap-2">
                                                {(restaurant.ai_rating || 0) >= 4 ? "🔥" : "⭐"}
                                                <span className="truncate">{restaurant.name}</span>
                                            </div>
                                        </TableCell>
                                        <TableCell>
                                            <div className="flex flex-wrap gap-1">
                                                {Array.isArray(restaurant.category)
                                                    ? restaurant.category.map((cat, idx) => (
                                                        <Badge key={idx} variant="outline">{cat}</Badge>
                                                    ))
                                                    : <Badge variant="outline">{restaurant.category}</Badge>
                                                }
                                            </div>
                                        </TableCell>
                                        <TableCell className="text-center">
                                            <span className="font-semibold">
                                                {restaurant.review_count || 0}회
                                            </span>
                                        </TableCell>
                                        <TableCell>
                                            <span className="text-sm text-muted-foreground truncate block">
                                                {restaurant.address}
                                            </span>
                                        </TableCell>
                                    </TableRow>
                                ))
                            )}
                        </TableBody>
                    </Table>
                </ScrollArea>
            </div>
        </div>
    );
};

export default FilteringPage;

