'use client';

import { memo, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Bookmark } from "lucide-react";
import { useBookmarkIds, useToggleBookmark, useBookmarkCount } from "@/hooks/use-bookmarks";
import { useAuth } from "@/contexts/AuthContext";
import { cn } from "@/lib/utils";

interface BookmarkButtonProps {
    restaurantId: string;
    variant?: 'default' | 'icon';
    showCount?: boolean;
    className?: string;
}

// [성능 최적화] 함수를 컴포넌트 외부로 이동하여 재생성 방지
const formatCount = (count: number): string => {
    if (count >= 1000) return '999+';
    return count.toString();
};

// [성능 최적화] memo로 불필요한 리렌더링 방지
const BookmarkButtonComponent = ({ restaurantId, variant = 'icon', showCount = true, className }: BookmarkButtonProps) => {
    const { user } = useAuth();
    const { data: bookmarkIds = new Set() } = useBookmarkIds();
    const { toggleBookmark, isLoading } = useToggleBookmark();
    const { data: bookmarkCount = 0 } = useBookmarkCount(restaurantId);

    const isBookmarked = user ? bookmarkIds.has(restaurantId) : false;

    // [성능 최적화] useCallback으로 이벤트 핸들러 메모이제이션
    const handleClick = useCallback((e: React.MouseEvent) => {
        e.stopPropagation();
        if (!user) return; // 비로그인 시 클릭 무시 (UI는 표시)
        toggleBookmark(restaurantId, isBookmarked);
    }, [user, restaurantId, isBookmarked, toggleBookmark]);

    if (variant === 'icon') {
        return (
            <Button
                variant="outline"
                size="icon"
                onClick={handleClick}
                disabled={isLoading}
                className={cn(
                    "transition-colors relative",
                    isBookmarked && "bg-primary/10 border-primary text-primary hover:bg-primary/20",
                    className
                )}
                title={!user ? `북마크 ${bookmarkCount}개` : isBookmarked ? "북마크 해제" : "북마크 추가"}
            >
                <Bookmark className={cn("h-4 w-4", isBookmarked && "fill-current")} />
                {showCount && bookmarkCount > 0 && (
                    <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 text-[10px] font-bold bg-primary text-primary-foreground rounded-full flex items-center justify-center">
                        {formatCount(bookmarkCount)}
                    </span>
                )}
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
            {!user ? "북마크" : isBookmarked ? "북마크됨" : "북마크"}
            {showCount && bookmarkCount > 0 && (
                <span className="text-xs opacity-80">({formatCount(bookmarkCount)})</span>
            )}
        </Button>
    );
};

// [성능 최적화] React.memo로 감싸서 props가 변경되지 않으면 리렌더링 방지
export const BookmarkButton = memo(BookmarkButtonComponent);
BookmarkButton.displayName = "BookmarkButton";
