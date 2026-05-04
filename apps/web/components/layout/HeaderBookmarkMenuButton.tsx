'use client';

import { useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { Bookmark, Settings } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useBookmarks } from '@/hooks/use-bookmarks';

export default function HeaderBookmarkMenuButton() {
  const pathname = usePathname();
  const router = useRouter();
  const { data: bookmarksData = [] } = useBookmarks();
  const [visibleBookmarkCount, setVisibleBookmarkCount] = useState(20);

  return (
    <DropdownMenu onOpenChange={(open) => {
      if (!open) {
        setTimeout(() => setVisibleBookmarkCount(20), 300);
      }
    }}>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          type="button"
          aria-label="북마크"
          className="h-9 w-9 hover:bg-accent text-foreground relative transition-colors"
        >
          <Bookmark className="h-5 w-5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="w-72 bg-card border-border font-serif z-[100]"
      >
        <DropdownMenuLabel className="flex items-center justify-between text-foreground">
          <span>북마크</span>
          <Button
            variant="ghost"
            size="icon"
            type="button"
            aria-label="북마크 관리 페이지로 이동"
            onClick={() => router.push('/mypage/bookmarks')}
            className="h-6 w-6 hover:bg-accent text-foreground"
          >
            <Settings className="h-3 w-3" />
          </Button>
        </DropdownMenuLabel>
        <DropdownMenuSeparator className="bg-border" />
        <ScrollArea className="h-64">
          {bookmarksData.length === 0 ? (
            <div className="p-4 text-center text-sm text-muted-foreground">
              북마크한 맛집이 없습니다
            </div>
          ) : (
            <DropdownMenuGroup>
              {bookmarksData.slice(0, visibleBookmarkCount).map((bookmark) => (
                <DropdownMenuItem
                  key={bookmark.id}
                  className="flex items-center gap-2 p-3 cursor-pointer hover:bg-accent w-full max-w-full"
                  onClick={() => {
                    const restaurant = bookmark.restaurant;
                    const isOverseas = restaurant.lat && restaurant.lng && (
                      restaurant.lat < 33 || restaurant.lat > 39 ||
                      restaurant.lng < 124 || restaurant.lng > 132
                    );

                    if (pathname === '/') {
                      window.dispatchEvent(new CustomEvent('selectBookmarkRestaurant', {
                        detail: {
                          id: bookmark.restaurant.id,
                          mode: isOverseas ? 'overseas' : 'domestic',
                        },
                      }));
                    } else {
                      const modeParam = isOverseas ? '&mode=overseas' : '';
                      router.push(`/?r=${bookmark.restaurant.id}${modeParam}&z=13`);
                    }
                  }}
                >
                  <div className="flex-1 min-w-0 flex flex-col gap-0.5">
                    <div className="flex items-center justify-between gap-2 w-full">
                      <span className="text-sm font-medium text-foreground truncate block">
                        {bookmark.restaurant.name}
                      </span>
                      {bookmark.restaurant.category?.[0] && (
                        <Badge variant="secondary" className="text-[10px] shrink-0 h-5 px-1.5 font-normal">
                          {bookmark.restaurant.category[0]}
                        </Badge>
                      )}
                    </div>
                    <span className="text-xs text-muted-foreground truncate block">
                      {bookmark.restaurant.road_address || bookmark.restaurant.jibun_address || '주소 없음'}
                    </span>
                  </div>
                </DropdownMenuItem>
              ))}
              {visibleBookmarkCount < bookmarksData.length && (
                <div
                  className="h-4 w-full"
                  ref={(el) => {
                    if (!el) return;
                    const observer = new IntersectionObserver(
                      (entries) => {
                        if (entries[0].isIntersecting) {
                          setVisibleBookmarkCount((prev) => Math.min(prev + 20, bookmarksData.length));
                        }
                      },
                      { threshold: 0.5 }
                    );
                    observer.observe(el);
                    return () => observer.disconnect();
                  }}
                />
              )}
            </DropdownMenuGroup>
          )}
        </ScrollArea>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
