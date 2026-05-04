'use client';

import { usePathname, useRouter } from 'next/navigation';
import { Bookmark } from 'lucide-react';
import type { User } from '@supabase/supabase-js';
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
import { cn } from '@/lib/utils';

interface MobileBookmarkMenuButtonProps {
    user: User;
}

export default function MobileBookmarkMenuButton({ user }: MobileBookmarkMenuButtonProps) {
    const pathname = usePathname();
    const router = useRouter();
    const { data: bookmarksData = [] } = useBookmarks();

    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <Button
                    variant="ghost"
                    size="icon"
                    className={cn(
                        'h-9 w-9 rounded-full border border-border bg-background',
                        'hover:bg-secondary/80'
                    )}
                    aria-label="북마크"
                >
                    <Bookmark className="h-[18px] w-[18px]" />
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-72 bg-card border-border font-serif z-[110]">
                <DropdownMenuLabel className="flex items-center justify-between text-foreground">
                    <span>북마크</span>
                    <Button
                        variant="ghost"
                        size="sm"
                        type="button"
                        onClick={() => router.push('/mypage/bookmarks')}
                        className="h-6 px-2 text-xs"
                    >
                        전체보기
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
                            {bookmarksData.slice(0, 20).map((bookmark) => (
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
                                            return;
                                        }

                                        const modeParam = isOverseas ? '&mode=overseas' : '';
                                        router.push(`/?r=${bookmark.restaurant.id}${modeParam}&z=13`);
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
                        </DropdownMenuGroup>
                    )}
                </ScrollArea>
            </DropdownMenuContent>
        </DropdownMenu>
    );
}
