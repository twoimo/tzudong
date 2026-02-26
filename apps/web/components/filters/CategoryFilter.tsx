import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Badge } from "@/components/ui/badge";
import { Check, ChevronsUpDown, X, ChefHat } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { Region } from "@/types/restaurant";
import { mergeRestaurants } from "@/hooks/use-restaurants";

interface CategoryFilterProps {
    selectedCategories: string[];
    onCategoryChange: (categories: string[]) => void;
    selectedRegion?: Region | null; // 글로벌에서는 선택적
    selectedCountry?: string | null; // 글로벌용
    className?: string;
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

const CategoryFilter = ({ selectedCategories, onCategoryChange, selectedRegion, selectedCountry, className }: CategoryFilterProps) => {
    const [isOpen, setIsOpen] = useState(false);

    // 선택된 지역/국가에 따른 맛집 데이터 가져오기 (병합 로직 적용을 위해 전체 데이터 필요)
    const { data: restaurants = [] } = useQuery({
        queryKey: ['restaurants-categories', selectedRegion, selectedCountry],
        queryFn: async () => {
            let query = supabase
                .from('restaurants')
                .select('*')
                .eq('status', 'approved');

            // 지역 또는 국가 필터링 적용
            if (selectedRegion) {
                // 국내 지역 필터링
                if (selectedRegion === "울릉도") {
                    query = query.or(`road_address.ilike.%울릉%,jibun_address.ilike.%울릉%`);
                } else if (selectedRegion === "욕지도") {
                    query = query.or(`road_address.ilike.%욕지%,jibun_address.ilike.%욕지%`);
                } else {
                    query = query.or(`road_address.ilike.%${selectedRegion}%,jibun_address.ilike.%${selectedRegion}%`);
                }
            } else if (selectedCountry) {
                // 글로벌 국가 필터링 (영어 주소에서 국가명 검색)
                query = query.ilike('english_address', `%${selectedCountry}%`);
            }

            const { data, error } = await query;

            if (error) {
                console.error('카테고리 데이터 조회 실패:', error);
                return [];
            }
            // 병합 로직 적용하여 중복 제거
            return mergeRestaurants(data || []);
        },
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
                    className={cn("justify-between", className)}
                >
                    <div className="flex items-center gap-2 flex-1 min-w-0">
                        <ChefHat className="h-4 w-4 text-muted-foreground shrink-0" />
                        <div className="flex items-center justify-between flex-1 min-w-0">
                            <span className={selectedCategories.length > 0 ? "truncate" : ""}>
                                {selectedCategories.length > 0
                                    ? `${selectedCategories.length}개 선택됨`
                                    : "카테고리"
                                }
                            </span>
                            {selectedCategories.length === 0 && (
                                <span className="ml-2 text-xs text-muted-foreground shrink-0">({totalCount}개)</span>
                            )}
                        </div>
                    </div>
                    <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                </Button>
            </PopoverTrigger>
            <PopoverContent className="w-[min(20rem,calc(100vw-2rem))] p-0" align="start">
                <Command>
                    <CommandInput placeholder="카테고리 검색..." />
                    <CommandList>
                        <CommandEmpty>카테고리를 찾을 수 없습니다.</CommandEmpty>
                        <CommandGroup>
                            <div className="flex items-center justify-between p-2 border-b">
                                <span className="text-sm font-medium">전체 ({totalCount}개)</span>
                                {selectedCategories.length > 0 && (
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        onClick={handleClearAll}
                                        className="h-6 px-2 text-xs"
                                    >
                                        초기화
                                    </Button>
                                )}
                            </div>
                            {CATEGORIES.map((category) => {
                                const isSelected = selectedCategories.includes(category);
                                const count = categoryCounts[category] || 0;
                                return (
                                    <CommandItem
                                        key={category}
                                        onSelect={() => handleCategoryToggle(category)}
                                        className="flex items-center justify-between"
                                    >
                                        <div className="flex items-center gap-2">
                                            <Check
                                                className={cn(
                                                    "h-4 w-4",
                                                    isSelected ? "opacity-100" : "opacity-0"
                                                )}
                                            />
                                            <span>{category}</span>
                                        </div>
                                        <span className="text-xs text-muted-foreground">({count}개)</span>
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
