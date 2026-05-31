import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Check, ChevronsUpDown, ChefHat } from "lucide-react";
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

    const { data: restaurants = [] } = useQuery({
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
            } catch (error) {
                console.error('카테고리 데이터 조회 실패:', error);
                return [];
            }
        },
        enabled: true,
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

    const handleCategoryToggle = (category: string) => {
        const newCategories = selectedCategories.includes(category)
            ? selectedCategories.filter(cat => cat !== category)
            : [...selectedCategories, category];
        onCategoryChange(newCategories);
    };

    const handleClearAll = () => {
        onCategoryChange([]);
    };

    return (
        <Popover open={isOpen} onOpenChange={setIsOpen}>
            <PopoverTrigger asChild>
                <Button
                    variant="outline"
                    role="combobox"
                    aria-expanded={isOpen}
                    aria-label="카테고리 필터"
                    className={cn("justify-between", className)}
                >
                    <div className="flex min-w-max flex-1 items-center gap-2 whitespace-nowrap">
                        <ChefHat className="h-4 w-4 text-muted-foreground shrink-0" />
                        <div className="flex min-w-max flex-1 items-center justify-between whitespace-nowrap">
                            <span className={selectedCategories.length > 0 ? "truncate" : ""}>
                                {selectedCategories.length > 0
                                    ? `${selectedCategories.length}개 선택됨`
                                    : "카테고리"
                                }
                            </span>
                            {selectedCategories.length === 0 && (
                                <span className="ml-2 shrink-0 whitespace-nowrap text-xs text-muted-foreground">({totalCount}개)</span>
                            )}
                        </div>
                    </div>
                    <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                </Button>
            </PopoverTrigger>
            <PopoverContent
                className={cn(
                    "z-[180] w-[min(21rem,calc(100vw-2rem))] overflow-hidden rounded-2xl border-border bg-card p-0 shadow-2xl",
                    contentClassName
                )}
                align={contentAlign}
                side={contentSide}
                sideOffset={8}
            >
                <Command className="rounded-2xl bg-card">
                    <div className="border-b border-border/70 bg-muted/30 px-3 py-2.5">
                        <div className="flex items-center justify-between gap-3">
                            <div className="min-w-0">
                                <p className="text-sm font-semibold text-foreground">카테고리 필터</p>
                                <p className="mt-0.5 text-xs text-muted-foreground">
                                    {selectedCategories.length > 0
                                        ? `${selectedCategories.length}개 선택됨`
                                        : `전체 ${totalCount}개`}
                                </p>
                            </div>
                            {selectedCategories.length > 0 && (
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={handleClearAll}
                                    className="h-8 shrink-0 rounded-full px-2.5 text-xs text-muted-foreground hover:text-foreground"
                                >
                                    초기화
                                </Button>
                            )}
                        </div>
                    </div>
                    <CommandInput
                        placeholder="카테고리 검색…"
                        className="h-11 text-sm"
                    />
                    <CommandList className="max-h-[min(21rem,calc(100dvh-9rem))] overscroll-contain p-1.5">
                        <CommandEmpty className="py-8 text-center text-sm text-muted-foreground">
                            카테고리를 찾을 수 없습니다.
                        </CommandEmpty>
                        <CommandGroup className="p-0">
                            <div className="flex items-center justify-between px-2 py-2">
                                <span className="text-xs font-medium text-muted-foreground">전체 {totalCount}개</span>
                                {selectedCategories.length > 0 && (
                                    <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">
                                        {selectedCategories.length}개 선택
                                    </span>
                                )}
                            </div>
                            {CATEGORIES.map((category) => {
                                const isSelected = selectedCategories.includes(category);
                                const count = categoryCounts[category] || 0;
                                return (
                                    <CommandItem
                                        key={category}
                                        onSelect={() => handleCategoryToggle(category)}
                                        className="min-h-10 rounded-xl px-2.5 py-2 data-[selected='true']:bg-accent"
                                    >
                                        <div className="flex min-w-0 flex-1 items-center gap-2">
                                            <Check
                                                className={cn(
                                                    "h-4 w-4 shrink-0 text-primary",
                                                    isSelected ? "opacity-100" : "opacity-0"
                                                )}
                                                aria-hidden="true"
                                            />
                                            <span className="truncate text-sm font-medium">{category}</span>
                                        </div>
                                        <span className="ml-3 shrink-0 rounded-full bg-muted px-2 py-0.5 text-[11px] tabular-nums text-muted-foreground">
                                            {count}개
                                        </span>
                                    </CommandItem>
                                );
                            })}
                        </CommandGroup>
                    </CommandList>
                </Command>
            </PopoverContent>
        </Popover>
    );
};

export default CategoryFilter;
