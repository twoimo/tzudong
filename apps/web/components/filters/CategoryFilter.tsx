import { useMemo, useState } from "react";
import {
    DropdownMenu, DropdownMenuContent, DropdownMenuTrigger, DropdownMenuCheckboxItem,
} from "@/components/ui/dropdown-menu";
import { ChevronDown, ChefHat } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { fetchSupabaseRows } from "@/lib/supabase-rest-client";
import { cn } from "@/lib/utils";
import { Region, Restaurant } from "@/types/restaurant";
import { mergeRestaurants } from "@/hooks/use-restaurants";
import { buildOverseasCountryAddressOrFilter } from "@/lib/overseas-region-matching";
import { buildRestaurantRegionAddressOrFilter } from "@/lib/popular-restaurants";

interface CategoryFilterProps {
    selectedCategories: string[];
    onCategoryChange: (categories: string[]) => void;
    selectedRegion?: Region | null; // 글로벌에서는 선택적
    selectedCountry?: string | null; // 글로벌용
    className?: string;
    contentSide?: "top" | "right" | "bottom" | "left";
    contentAlign?: "start" | "center" | "end";
    contentClassName?: string;
}

const CATEGORIES = [
    "한식",
    "중식",
    "양식",
    "분식",
    "치킨",
    "피자",
    "고기",
    "족발·보쌈",
    "돈까스·회",
    "아시안",
    "패스트푸드",
    "카페·디저트",
    "찜·탕",
    "야식",
    "도시락"
];

const CategoryFilter = ({
    selectedCategories,
    onCategoryChange,
    selectedRegion,
    selectedCountry,
    className,
    contentSide = "bottom",
    contentAlign = "start",
    contentClassName
}: CategoryFilterProps) => {
    const [isOpen, setIsOpen] = useState(false);

    // 선택된 지역/국가에 따른 맛집 데이터 가져오기 (병합 로직 적용을 위해 전체 데이터 필요)
    const categoryQueryKey = selectedRegion || selectedCountry
        ? ['restaurants-categories', selectedRegion, selectedCountry]
        : ['restaurants-count'];

    const { data: restaurants = [], isError, isPending } = useQuery({
        queryKey: categoryQueryKey,
        queryFn: async () => {
            const params: Array<[string, string]> = [
                ['select', 'id, name:approved_name, approved_name, road_address, jibun_address, english_address, categories, status, review_count'],
                ['status', 'eq.approved'],
            ];

            // 지역 또는 국가 필터링 적용
            if (selectedRegion) {
                const regionFilter = buildRestaurantRegionAddressOrFilter(selectedRegion, '%');
                if (regionFilter) {
                    params.push(['or', `(${regionFilter})`]);
                }
            } else if (selectedCountry) {
                const overseasFilter = buildOverseasCountryAddressOrFilter(selectedCountry, '%');
                if (overseasFilter) {
                    params.push(['or', `(${overseasFilter})`]);
                }
            }

            try {
                const data = await fetchSupabaseRows<Restaurant>('restaurants', params);
                // 병합 로직 적용하여 중복 제거
                return mergeRestaurants(data || []);
            } catch {
                throw new Error('RESTAURANT_COUNTS_UNAVAILABLE');
            }
        },
        enabled: true,
        retry: 1,
        staleTime: 10 * 60 * 1000,
        gcTime: 30 * 60 * 1000,
        refetchOnWindowFocus: false,
    });

    // 카테고리별 맛집 수 계산 (병합된 데이터 기준)
    const categoryCounts = useMemo(() => {
        const counts: Record<string, number> = {};

        restaurants.forEach((restaurant) => {
            const categories = restaurant.categories || [];
            categories.forEach((category: string) => {
                counts[category] = (counts[category] || 0) + 1;
            });
        });

        return counts;
    }, [restaurants]);

    // 전체 맛집 수 (병합된 데이터 기준)
    const totalCount = restaurants.length;
    const totalLabel = isError ? '조회 실패' : isPending ? '조회 중' : `${totalCount}개`;

    const handleCategoryToggle = (category: string) => {
        const newCategories = selectedCategories.includes(category)
            ? selectedCategories.filter(cat => cat !== category)
            : [...selectedCategories, category];
        onCategoryChange(newCategories);
    };

    const handleClearAll = () => {
        onCategoryChange([]);
    };

    const selectedLabel = selectedCategories.length === 0 ? "전체 카테고리"
        : selectedCategories.length === 1 ? selectedCategories[0]
            : `${selectedCategories[0]} 외 ${selectedCategories.length - 1}개`;

    return (
        <DropdownMenu open={isOpen} onOpenChange={setIsOpen}>
            <DropdownMenuTrigger asChild>
                <button
                    type="button"
                    aria-label="카테고리 필터"
                    className={cn(
                        "flex h-10 w-full min-w-0 items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 sm:w-[200px]",
                        className,
                    )}
                >
                    <span className="flex min-w-0 items-center gap-2 whitespace-nowrap">
                        <ChefHat className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                        <span className="truncate">{selectedLabel}</span>
                        {selectedCategories.length === 0 && (
                            <span className="text-xs text-muted-foreground">({totalLabel})</span>
                        )}
                    </span>
                    <ChevronDown className="h-4 w-4 shrink-0 opacity-50" aria-hidden="true" />
                </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
                aria-label="카테고리 선택 · 여러 개 선택 가능"
                className={cn(
                    "z-[180] max-h-[min(24rem,calc(100dvh-8rem))] min-w-[var(--radix-dropdown-menu-trigger-width)] overflow-y-auto overscroll-contain rounded-2xl border-border shadow-2xl",
                    contentClassName,
                )}
                align={contentAlign}
                side={contentSide}
                sideOffset={4}
            >
                <DropdownMenuCheckboxItem checked={selectedCategories.length === 0} onCheckedChange={handleClearAll}>
                    <span className="flex w-full items-center justify-between whitespace-nowrap">
                        <span>전체 카테고리</span>
                        <span className="ml-2 text-xs text-muted-foreground">({totalLabel})</span>
                    </span>
                </DropdownMenuCheckboxItem>
                {CATEGORIES.map(category => (
                    <DropdownMenuCheckboxItem
                        key={category}
                        checked={selectedCategories.includes(category)}
                        onCheckedChange={() => handleCategoryToggle(category)}
                        onSelect={event => event.preventDefault()}
                    >
                        <span className="flex w-full items-center justify-between whitespace-nowrap">
                            <span>{category}</span>
                            <span className="ml-2 text-xs text-muted-foreground">
                                {isError ? '조회 실패' : isPending ? '조회 중' : `(${categoryCounts[category] || 0}개)`}
                            </span>
                        </span>
                    </DropdownMenuCheckboxItem>
                ))}
            </DropdownMenuContent>
        </DropdownMenu>
    );
};

export default CategoryFilter;
