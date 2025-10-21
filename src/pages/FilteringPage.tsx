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
import { RESTAURANT_CATEGORIES } from "@/types/restaurant";
import { useRestaurants } from "@/hooks/use-restaurants";

type SortColumn = "name" | "category" | "jjyangVisits" | "userVisits" | "reviews" | "rating";
type SortDirection = "asc" | "desc" | null;

interface FilterState {
    searchQuery: string;
    categories: string[];
    jjyangVisitsMin: number;
    userVisitsMin: number;
    reviewsMin: number;
    ratingMin: number;
    ratingMax: number;
}

const FilteringPage = () => {
    const { data: restaurants = [], isLoading } = useRestaurants({ enabled: true });
    const isDummyData = restaurants.length > 0 && restaurants[0].id.startsWith('dummy-');

    const [sortColumn, setSortColumn] = useState<SortColumn | null>(null);
    const [sortDirection, setSortDirection] = useState<SortDirection>(null);

    const [filters, setFilters] = useState<FilterState>({
        searchQuery: "",
        categories: [],
        jjyangVisitsMin: 0,
        userVisitsMin: 0,
        reviewsMin: 0,
        ratingMin: 1,
        ratingMax: 10,
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

    const handleResetFilters = () => {
        setFilters({
            searchQuery: "",
            categories: [],
            jjyangVisitsMin: 0,
            userVisitsMin: 0,
            reviewsMin: 0,
            ratingMin: 1,
            ratingMax: 10,
        });
        setSortColumn(null);
        setSortDirection(null);
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
            result = result.filter(r => filters.categories.includes(r.category || ""));
        }

        // 쯔양 방문횟수 필터
        if (filters.jjyangVisitsMin > 0) {
            result = result.filter(r => (r.jjyang_visit_count || 0) >= filters.jjyangVisitsMin);
        }

        // 사용자 방문횟수 필터
        if (filters.userVisitsMin > 0) {
            result = result.filter(r => (r.visit_count || 0) >= filters.userVisitsMin);
        }

        // 리뷰수 필터
        if (filters.reviewsMin > 0) {
            result = result.filter(r => (r.review_count || 0) >= filters.reviewsMin);
        }

        // AI 별점 필터
        result = result.filter(r => {
            const rating = r.ai_rating || 0;
            return rating >= filters.ratingMin && rating <= filters.ratingMax;
        });

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
                    case "jjyangVisits":
                        aValue = a.jjyang_visit_count || 0;
                        bValue = b.jjyang_visit_count || 0;
                        break;
                    case "userVisits":
                        aValue = a.visit_count || 0;
                        bValue = b.visit_count || 0;
                        break;
                    case "reviews":
                        aValue = a.review_count || 0;
                        bValue = b.review_count || 0;
                        break;
                    case "rating":
                        aValue = a.ai_rating || 0;
                        bValue = b.ai_rating || 0;
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
        (filters.jjyangVisitsMin > 0 ? 1 : 0) +
        (filters.userVisitsMin > 0 ? 1 : 0) +
        (filters.reviewsMin > 0 ? 1 : 0) +
        (filters.ratingMin > 1 || filters.ratingMax < 10 ? 1 : 0);

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
                            {isDummyData && (
                                <Badge variant="secondary" className="text-xs">
                                    📊 샘플 데이터
                                </Badge>
                            )}
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

                    {/* 쯔양 방문횟수 */}
                    <Select
                        value={filters.jjyangVisitsMin.toString()}
                        onValueChange={(v) => setFilters({ ...filters, jjyangVisitsMin: parseInt(v) })}
                    >
                        <SelectTrigger>
                            <SelectValue placeholder="쯔양 방문" />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="0">쯔양 방문 (전체)</SelectItem>
                            <SelectItem value="1">1회 이상</SelectItem>
                            <SelectItem value="2">2회 이상</SelectItem>
                            <SelectItem value="3">3회 이상</SelectItem>
                            <SelectItem value="5">5회 이상</SelectItem>
                        </SelectContent>
                    </Select>

                    {/* 사용자 방문횟수 */}
                    <Select
                        value={filters.userVisitsMin.toString()}
                        onValueChange={(v) => setFilters({ ...filters, userVisitsMin: parseInt(v) })}
                    >
                        <SelectTrigger>
                            <SelectValue placeholder="사용자 방문" />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="0">사용자 방문 (전체)</SelectItem>
                            <SelectItem value="10">10회 이상</SelectItem>
                            <SelectItem value="50">50회 이상</SelectItem>
                            <SelectItem value="100">100회 이상</SelectItem>
                            <SelectItem value="500">500회 이상</SelectItem>
                        </SelectContent>
                    </Select>

                    {/* 리뷰수 */}
                    <Select
                        value={filters.reviewsMin.toString()}
                        onValueChange={(v) => setFilters({ ...filters, reviewsMin: parseInt(v) })}
                    >
                        <SelectTrigger>
                            <SelectValue placeholder="리뷰수" />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="0">리뷰수 (전체)</SelectItem>
                            <SelectItem value="5">5개 이상</SelectItem>
                            <SelectItem value="10">10개 이상</SelectItem>
                            <SelectItem value="20">20개 이상</SelectItem>
                            <SelectItem value="50">50개 이상</SelectItem>
                        </SelectContent>
                    </Select>
                </div>

                {/* AI 별점 슬라이더 */}
                <div className="mt-4 p-4 bg-muted/50 rounded-lg">
                    <div className="flex items-center justify-between mb-2">
                        <label className="text-sm font-medium">AI 별점</label>
                        <span className="text-sm text-primary font-semibold">
                            {filters.ratingMin}⭐ ~ {filters.ratingMax}⭐
                        </span>
                    </div>
                    <Slider
                        value={[filters.ratingMin, filters.ratingMax]}
                        onValueChange={([min, max]) => setFilters({ ...filters, ratingMin: min, ratingMax: max })}
                        min={1}
                        max={10}
                        step={1}
                        minStepsBetweenThumbs={1}
                        className="w-full"
                    />
                    <div className="flex justify-between text-xs text-muted-foreground mt-1">
                        <span>1⭐ (맛집X)</span>
                        <span>10⭐ (맛집O)</span>
                    </div>
                </div>

                {/* 선택된 필터 태그 */}
                {activeFilterCount > 0 && (
                    <div className="flex flex-wrap gap-2 mt-4">
                        {filters.searchQuery && (
                            <Badge variant="secondary" className="gap-1">
                                검색: {filters.searchQuery}
                            </Badge>
                        )}
                        {filters.categories.map(cat => (
                            <Badge key={cat} variant="secondary">
                                {cat}
                            </Badge>
                        ))}
                        {filters.jjyangVisitsMin > 0 && (
                            <Badge variant="secondary">
                                쯔양 {filters.jjyangVisitsMin}회+
                            </Badge>
                        )}
                        {filters.userVisitsMin > 0 && (
                            <Badge variant="secondary">
                                사용자 {filters.userVisitsMin}회+
                            </Badge>
                        )}
                        {filters.reviewsMin > 0 && (
                            <Badge variant="secondary">
                                리뷰 {filters.reviewsMin}개+
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
                                        onClick={() => handleSort("jjyangVisits")}
                                        className="hover:bg-accent w-full justify-center"
                                    >
                                        쯔양 방문
                                        {getSortIcon("jjyangVisits")}
                                    </Button>
                                </TableHead>
                                <TableHead className="w-[120px] text-center">
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        onClick={() => handleSort("userVisits")}
                                        className="hover:bg-accent w-full justify-center"
                                    >
                                        사용자 방문
                                        {getSortIcon("userVisits")}
                                    </Button>
                                </TableHead>
                                <TableHead className="w-[100px] text-center">
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        onClick={() => handleSort("reviews")}
                                        className="hover:bg-accent w-full justify-center"
                                    >
                                        리뷰수
                                        {getSortIcon("reviews")}
                                    </Button>
                                </TableHead>
                                <TableHead className="w-[200px] text-center">
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        onClick={() => handleSort("rating")}
                                        className="hover:bg-accent w-full justify-center"
                                    >
                                        AI 별점
                                        {getSortIcon("rating")}
                                    </Button>
                                </TableHead>
                                <TableHead className="w-[250px]">주소</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {isLoading ? (
                                <TableRow>
                                    <TableCell colSpan={7} className="text-center py-12">
                                        <div className="flex items-center justify-center gap-2">
                                            <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary"></div>
                                            <span className="text-muted-foreground">로딩 중...</span>
                                        </div>
                                    </TableCell>
                                </TableRow>
                            ) : filteredAndSortedRestaurants.length === 0 ? (
                                <TableRow>
                                    <TableCell colSpan={7} className="text-center py-12">
                                        <p className="text-muted-foreground">필터 조건에 맞는 맛집이 없습니다.</p>
                                    </TableCell>
                                </TableRow>
                            ) : (
                                filteredAndSortedRestaurants.map((restaurant) => (
                                    <TableRow
                                        key={restaurant.id}
                                        className="hover:bg-muted/50 cursor-pointer transition-colors"
                                    >
                                        <TableCell className="font-medium">
                                            <div className="flex items-center gap-2">
                                                {(restaurant.ai_rating || 0) >= 4 ? "🔥" : "⭐"}
                                                <span className="truncate">{restaurant.name}</span>
                                            </div>
                                        </TableCell>
                                        <TableCell>
                                            <Badge variant="outline">{restaurant.category}</Badge>
                                        </TableCell>
                                        <TableCell className="text-center">
                                            <span className="font-semibold text-primary">
                                                {restaurant.jjyang_visit_count || 0}회
                                            </span>
                                        </TableCell>
                                        <TableCell className="text-center">
                                            <span className="font-semibold">
                                                {restaurant.visit_count || 0}회
                                            </span>
                                        </TableCell>
                                        <TableCell className="text-center">
                                            {restaurant.review_count || 0}개
                                        </TableCell>
                                        <TableCell className="text-center">
                                            <div className="flex flex-col items-center gap-1">
                                                <span className="text-lg">
                                                    {getStarEmoji(restaurant.ai_rating || 0)}
                                                </span>
                                                <span className="text-xs text-muted-foreground">
                                                    {restaurant.ai_rating?.toFixed(1) || "0.0"}점
                                                </span>
                                            </div>
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

