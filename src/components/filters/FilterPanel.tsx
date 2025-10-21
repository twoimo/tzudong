import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { RESTAURANT_CATEGORIES } from "@/types/restaurant";
import { X } from "lucide-react";

export interface FilterState {
    categories: string[];
    minRating: number;
    minReviews: number;
    minVisits: number;
}

interface FilterPanelProps {
    filters: FilterState;
    onFilterChange: (filters: FilterState) => void;
    onClose?: () => void;
}

export function FilterPanel({ filters, onFilterChange, onClose }: FilterPanelProps) {
    const [localFilters, setLocalFilters] = useState<FilterState>(filters);

    const handleCategoryToggle = (category: string) => {
        const newCategories = localFilters.categories.includes(category)
            ? localFilters.categories.filter((c) => c !== category)
            : [...localFilters.categories, category];

        setLocalFilters({ ...localFilters, categories: newCategories });
    };

    const handleApply = () => {
        onFilterChange(localFilters);
        onClose?.();
    };

    const handleReset = () => {
        const resetFilters: FilterState = {
            categories: [],
            minRating: 1,
            minReviews: 0,
            minVisits: 0,
        };
        setLocalFilters(resetFilters);
        onFilterChange(resetFilters);
    };

    const activeFilterCount =
        localFilters.categories.length +
        (localFilters.minRating > 1 ? 1 : 0) +
        (localFilters.minReviews > 0 ? 1 : 0) +
        (localFilters.minVisits > 0 ? 1 : 0);

    return (
        <div className="flex flex-col h-full">
            {/* Header */}
            <div className="p-4 border-b border-border flex items-center justify-between">
                <div>
                    <h2 className="text-lg font-bold">필터</h2>
                    {activeFilterCount > 0 && (
                        <p className="text-sm text-muted-foreground">
                            {activeFilterCount}개 필터 적용됨
                        </p>
                    )}
                </div>
                {onClose && (
                    <Button variant="ghost" size="icon" onClick={onClose}>
                        <X className="h-4 w-4" />
                    </Button>
                )}
            </div>

            {/* Filters */}
            <ScrollArea className="flex-1">
                <div className="p-4 space-y-6">
                    {/* Categories */}
                    <div className="space-y-3">
                        <Label className="text-base font-semibold">카테고리</Label>
                        <div className="space-y-2">
                            {RESTAURANT_CATEGORIES.map((category) => (
                                <div key={category} className="flex items-center space-x-2">
                                    <Checkbox
                                        id={`category-${category}`}
                                        checked={localFilters.categories.includes(category)}
                                        onCheckedChange={() => handleCategoryToggle(category)}
                                    />
                                    <label
                                        htmlFor={`category-${category}`}
                                        className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 cursor-pointer"
                                    >
                                        {category}
                                    </label>
                                </div>
                            ))}
                        </div>
                    </div>

                    <Separator />

                    {/* AI Rating */}
                    <div className="space-y-3">
                        <div className="flex items-center justify-between">
                            <Label className="text-base font-semibold">AI 점수</Label>
                            <span className="text-sm font-medium text-primary">
                                {localFilters.minRating}점 이상
                            </span>
                        </div>
                        <Slider
                            value={[localFilters.minRating]}
                            onValueChange={([value]) =>
                                setLocalFilters({ ...localFilters, minRating: value })
                            }
                            min={1}
                            max={10}
                            step={0.5}
                            className="w-full"
                        />
                        <div className="flex justify-between text-xs text-muted-foreground">
                            <span>1점</span>
                            <span>10점</span>
                        </div>
                    </div>

                    <Separator />

                    {/* Review Count */}
                    <div className="space-y-3">
                        <div className="flex items-center justify-between">
                            <Label className="text-base font-semibold">리뷰 수</Label>
                            <span className="text-sm font-medium text-primary">
                                {localFilters.minReviews}개 이상
                            </span>
                        </div>
                        <Slider
                            value={[localFilters.minReviews]}
                            onValueChange={([value]) =>
                                setLocalFilters({ ...localFilters, minReviews: value })
                            }
                            min={0}
                            max={100}
                            step={5}
                            className="w-full"
                        />
                        <div className="flex justify-between text-xs text-muted-foreground">
                            <span>0개</span>
                            <span>100개+</span>
                        </div>
                    </div>

                    <Separator />

                    {/* Visit Count */}
                    <div className="space-y-3">
                        <div className="flex items-center justify-between">
                            <Label className="text-base font-semibold">방문 횟수</Label>
                            <span className="text-sm font-medium text-primary">
                                {localFilters.minVisits}회 이상
                            </span>
                        </div>
                        <Slider
                            value={[localFilters.minVisits]}
                            onValueChange={([value]) =>
                                setLocalFilters({ ...localFilters, minVisits: value })
                            }
                            min={0}
                            max={50}
                            step={1}
                            className="w-full"
                        />
                        <div className="flex justify-between text-xs text-muted-foreground">
                            <span>0회</span>
                            <span>50회+</span>
                        </div>
                    </div>
                </div>
            </ScrollArea>

            {/* Footer */}
            <div className="p-4 border-t border-border space-y-2">
                <Button
                    onClick={handleApply}
                    className="w-full bg-gradient-primary hover:opacity-90"
                >
                    필터 적용
                </Button>
                <Button
                    onClick={handleReset}
                    variant="outline"
                    className="w-full"
                >
                    초기화
                </Button>
            </div>
        </div>
    );
}

