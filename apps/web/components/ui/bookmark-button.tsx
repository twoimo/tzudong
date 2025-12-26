'use client';

import { Button } from "@/components/ui/button";
import { Bookmark } from "lucide-react";
import { useBookmarkIds, useToggleBookmark } from "@/hooks/use-bookmarks";
import { useAuth } from "@/contexts/AuthContext";
import { cn } from "@/lib/utils";

interface BookmarkButtonProps {
    restaurantId: string;
    variant?: 'default' | 'icon';
    className?: string;
}

export function BookmarkButton({ restaurantId, variant = 'icon', className }: BookmarkButtonProps) {
    const { user } = useAuth();
    const { data: bookmarkIds = new Set() } = useBookmarkIds();
    const { toggleBookmark, isLoading } = useToggleBookmark();

    const isBookmarked = bookmarkIds.has(restaurantId);

    if (!user) return null;

    const handleClick = (e: React.MouseEvent) => {
        e.stopPropagation();
        toggleBookmark(restaurantId, isBookmarked);
    };

    if (variant === 'icon') {
        return (
            <Button
                variant="outline"
                size="icon"
                onClick={handleClick}
                disabled={isLoading}
                className={cn(
                    "transition-colors",
                    isBookmarked && "bg-primary/10 border-primary text-primary hover:bg-primary/20",
                    className
                )}
                title={isBookmarked ? "북마크 해제" : "북마크 추가"}
            >
                <Bookmark className={cn("h-4 w-4", isBookmarked && "fill-current")} />
            </Button>
        );
    }

    return (
        <Button
            variant={isBookmarked ? "default" : "outline"}
            onClick={handleClick}
            disabled={isLoading}
            className={cn("gap-2", className)}
        >
            <Bookmark className={cn("h-4 w-4", isBookmarked && "fill-current")} />
            {isBookmarked ? "북마크됨" : "북마크"}
        </Button>
    );
}
