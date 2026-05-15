'use client';

import { useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { Bookmark, MapPin } from 'lucide-react';
import type { User } from '@supabase/supabase-js';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
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
    const [isOpen, setIsOpen] = useState(false);
    const { data: bookmarksData = [], isLoading: isBookmarksLoading, isError: isBookmarksError } = useBookmarks({ enabled: isOpen });

    return (
        <DropdownMenu onOpenChange={setIsOpen}>
            <DropdownMenuTrigger asChild>
                <Button
                    variant="ghost"
                    size="icon"
                    className={cn(
                        'relative h-11 w-11 rounded-full border border-border bg-background',
                        'hover:bg-secondary/80 focus-visible:ring-2 focus-visible:ring-primary touch-manipulation'
                    )}
                    aria-label={bookmarksData.length > 0 ? `북마크, 저장한 맛집 ${bookmarksData.length}개` : "북마크"}
                >
                    <Bookmark className="h-[18px] w-[18px]" aria-hidden="true" />
                    {!isBookmarksLoading && bookmarksData.length > 0 && (
                        <Badge
                            variant="secondary"
                            aria-hidden="true"
                            className="absolute -top-1 -right-1 h-5 min-w-5 rounded-full bg-primary px-1 text-[10px] font-bold tabular-nums text-primary-foreground"
                        >
                            {bookmarksData.length > 99 ? '99+' : bookmarksData.length}
                        </Badge>
                    )}
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-[min(calc(100vw-1rem),22rem)] bg-card border-border font-serif z-[110] shadow-primary">
                <DropdownMenuLabel className="flex items-start justify-between gap-3 text-foreground">
                    <div className="min-w-0">
                        <span className="block font-semibold">북마크</span>
                        <span className="block text-xs font-normal text-muted-foreground">저장한 맛집 {isBookmarksLoading ? '확인 중' : `${bookmarksData.length}개`}</span>
                    </div>
                    <Button
                        variant="ghost"
                        size="sm"
                        type="button"
                        aria-label="북마크 전체보기 페이지로 이동"
                        onClick={() => router.push('/mypage/bookmarks')}
                        className="h-8 shrink-0 rounded-lg px-2 text-xs focus-visible:ring-2 focus-visible:ring-primary touch-manipulation"
                    >
                        전체보기
                    </Button>
                </DropdownMenuLabel>
                <DropdownMenuSeparator className="bg-border" />
                <ScrollArea className="h-72 max-h-[min(70vh,28rem)]">
                    {isBookmarksLoading ? (
                        <div role="status" aria-label="북마크 목록 로딩 중" className="space-y-3 p-3">
                            {[0, 1, 2].map((item) => (
                                <div key={item} className="space-y-2">
                                    <Skeleton className="h-4 w-3/4 rounded" />
                                    <Skeleton className="h-3 w-full rounded" />
                                </div>
                            ))}
                        </div>
                    ) : isBookmarksError ? (
                        <div role="status" className="grid min-h-40 place-items-center p-4 text-center text-sm text-muted-foreground">
                            <div>
                                <Bookmark className="mx-auto mb-2 h-8 w-8 text-muted-foreground/50" aria-hidden="true" />
                                <p className="font-medium text-foreground">북마크를 불러오지 못했습니다</p>
                                <p className="mt-1 text-xs leading-5">잠시 후 다시 열어 주세요.</p>
                            </div>
                        </div>
                    ) : bookmarksData.length === 0 ? (
                        <div className="grid min-h-40 place-items-center p-4 text-center text-sm text-muted-foreground">
                            <div>
                                <Bookmark className="mx-auto mb-2 h-8 w-8 text-muted-foreground/50" aria-hidden="true" />
                                <p className="font-medium text-foreground">북마크한 맛집이 없습니다</p>
                                <p className="mt-1 text-xs leading-5">맛집 상세에서 북마크를 누르면 여기에 모입니다.</p>
                            </div>
                        </div>
                    ) : (
                        <DropdownMenuGroup>
                            {bookmarksData.slice(0, 20).map((bookmark) => (
                                <DropdownMenuItem
                                    key={bookmark.id}
                                    aria-label={`${bookmark.restaurant.name} 북마크 열기`}
                                    className="flex items-center gap-3 p-3 cursor-pointer hover:bg-accent focus:bg-accent w-full max-w-full touch-manipulation"
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
                                    <MapPin className="h-4 w-4 shrink-0 text-primary/70" aria-hidden="true" />
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
