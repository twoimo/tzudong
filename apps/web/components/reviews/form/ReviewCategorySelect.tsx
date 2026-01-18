import { memo } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ChevronDown, X as XIcon } from "lucide-react";
import { ReviewCategory, REVIEW_CATEGORIES } from "../constants";

interface ReviewCategorySelectProps {
    categories: ReviewCategory[];
    setCategories: (categories: ReviewCategory[]) => void;
    idPrefix?: string;
}

export const ReviewCategorySelect = memo(function ReviewCategorySelect({
    categories,
    setCategories,
    idPrefix = "review"
}: ReviewCategorySelectProps) {
    const toggleCategory = (cat: ReviewCategory, checked: boolean) => {
        if (checked) {
            setCategories([...categories, cat]);
        } else {
            setCategories(categories.filter(c => c !== cat));
        }
    };

    return (
        <div className="space-y-2">
            <Label>
                카테고리 <span className="text-red-500">*</span>
            </Label>
            <Popover>
                <PopoverTrigger asChild>
                    <Button variant="outline" className="w-full justify-between">
                        <span className="truncate">
                            {categories.length > 0
                                ? `${categories.length}개 선택됨`
                                : "어떤 종류의 음식을 드셨나요?"
                            }
                        </span>
                        <ChevronDown className="h-4 w-4 opacity-50" />
                    </Button>
                </PopoverTrigger>
                <PopoverContent className="w-64" align="start">
                    <div className="space-y-2">
                        <h4 className="font-semibold text-sm">카테고리 선택</h4>
                        <div className="space-y-2 max-h-48 overflow-y-auto">
                            {REVIEW_CATEGORIES.map((cat) => (
                                <div key={cat} className="flex items-center space-x-2">
                                    <Checkbox
                                        id={`${idPrefix}-category-${cat}`}
                                        checked={categories.includes(cat)}
                                        onCheckedChange={(checked) => toggleCategory(cat, checked as boolean)}
                                    />
                                    <Label htmlFor={`${idPrefix}-category-${cat}`} className="text-sm cursor-pointer flex-1">
                                        {cat}
                                    </Label>
                                </div>
                            ))}
                        </div>
                        {categories.length > 0 && (
                            <div className="pt-2 border-t">
                                <Button variant="outline" size="sm" onClick={() => setCategories([])} className="w-full">
                                    선택 해제
                                </Button>
                            </div>
                        )}
                    </div>
                </PopoverContent>
            </Popover>
            {categories.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-2">
                    {categories.map((category) => (
                        <Badge key={category} variant="secondary" className="text-xs">
                            {category}
                            <button
                                type="button"
                                onClick={() => setCategories(categories.filter(c => c !== category))}
                                className="ml-1 hover:bg-secondary-foreground/20 rounded-full p-0.5"
                            >
                                <XIcon className="h-3 w-3" />
                            </button>
                        </Badge>
                    ))}
                </div>
            )}
        </div>
    );
});
