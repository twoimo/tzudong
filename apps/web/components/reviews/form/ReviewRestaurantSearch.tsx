import { memo } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Search, CheckCircle2 } from "lucide-react";

interface ReviewRestaurantSearchProps {
    selectedRestaurant: { id: string; name: string } | null;
    initialRestaurant: { id: string; name: string } | null; // 모달에 전달된 초기 맛집 정보
    searchQuery: string;
    setSearchQuery: (query: string) => void;
    searchResults: { id: string; name: string }[];
    isSearching: boolean;
    onSelectRestaurant: (restaurant: { id: string; name: string }) => void;
    onClearRestaurant: () => void;
}

export const ReviewRestaurantSearch = memo(function ReviewRestaurantSearch({
    selectedRestaurant,
    initialRestaurant,
    searchQuery,
    setSearchQuery,
    searchResults,
    isSearching,
    onSelectRestaurant,
    onClearRestaurant
}: ReviewRestaurantSearchProps) {
    const effectiveRestaurant = selectedRestaurant || initialRestaurant;

    return (
        <div className={`space-y-2 transition-all duration-500 ${(!effectiveRestaurant && searchQuery && !isSearching)
            ? "ring-2 ring-primary ring-offset-2 rounded-lg p-1 bg-primary/5"
            : ""
            }`}>
            <Label>
                방문한 쯔양 맛집 <span className="text-red-500">*</span>
            </Label>
            {effectiveRestaurant ? (
                <div className="flex items-center gap-2 p-3 bg-green-50 border border-green-200 rounded-lg">
                    <CheckCircle2 className="h-5 w-5 text-green-600" />
                    <span className="font-medium text-green-800 flex-1">
                        {effectiveRestaurant.name}
                    </span>
                    {!initialRestaurant && (
                        <Button
                            variant="ghost"
                            size="sm"
                            onClick={onClearRestaurant}
                            className="h-6 px-2 text-xs"
                        >
                            변경
                        </Button>
                    )}
                </div>
            ) : (
                <div className="space-y-2">
                    <div className="relative">
                        <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                        <Input
                            placeholder="맛집 이름을 검색하세요..."
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="pl-9"
                        />
                    </div>
                    {isSearching && (
                        <div className="flex items-center gap-2 text-sm text-muted-foreground p-2">
                            <div className="animate-spin h-4 w-4 border-2 border-primary border-t-transparent rounded-full" />
                            검색 중...
                        </div>
                    )}
                    {!isSearching && searchQuery.length >= 2 && searchResults.length === 0 && (
                        <div className="text-sm text-muted-foreground p-2">
                            검색 결과가 없습니다.
                        </div>
                    )}
                    {searchResults.length > 0 && (
                        <div className="border rounded-lg overflow-hidden max-h-48 overflow-y-auto">
                            {searchResults.map((result) => (
                                <button
                                    key={result.id}
                                    onClick={() => onSelectRestaurant(result)}
                                    className="w-full text-left px-3 py-2 hover:bg-muted/50 transition-colors border-b last:border-b-0 text-sm"
                                >
                                    {result.name}
                                </button>
                            ))}
                        </div>
                    )}
                    {searchQuery.length < 2 && (
                        <p className="text-xs text-muted-foreground">
                            2글자 이상 입력하면 검색됩니다.
                        </p>
                    )}
                </div>
            )}
        </div>
    );
});
