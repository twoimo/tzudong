"use client";

import { useCallback, type MouseEvent as ReactMouseEvent } from "react";
import { Bookmark, MapPin, Trash2, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useBookmarks, useToggleBookmark } from "@/hooks/use-bookmarks";
import type { Restaurant } from "@/types/restaurant";

interface DesktopLeftPanelBookmarksProps {
  onRestaurantOpen: (
    restaurant: Pick<Restaurant, "id" | "lat" | "lng">,
  ) => void;
  onClose?: () => void;
}

export default function DesktopLeftPanelBookmarks({
  onRestaurantOpen,
  onClose,
}: DesktopLeftPanelBookmarksProps) {
  const {
    data: bookmarks = [],
    isLoading,
    isError,
  } = useBookmarks({ enabled: true });
  const { toggleBookmark, isLoading: isToggling } = useToggleBookmark();

  const handleRemoveBookmark = useCallback(
    async (restaurantId: string, event: ReactMouseEvent<HTMLButtonElement>) => {
      event.stopPropagation();
      await toggleBookmark(restaurantId, true);
    },
    [toggleBookmark],
  );

  return (
    <div
      className="flex h-full min-h-0 flex-col bg-background"
      data-desktop-left-panel-view="bookmarks"
    >
      <div className="border-b border-border bg-gradient-to-br from-background via-background to-muted/35 px-4 py-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="flex items-center gap-2 text-base font-bold text-primary">
              <Bookmark className="h-4 w-4" aria-hidden="true" />
              북마크
            </h2>
            <p className="mt-1 text-xs text-muted-foreground">
              저장한 맛집을 지도와 상세로 바로 열어요.
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Badge
              variant="secondary"
              className="rounded-full px-2 py-0.5 text-[11px]"
            >
              {isLoading ? "확인 중" : `${bookmarks.length}개`}
            </Badge>
            {onClose && (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={onClose}
                className="h-9 w-9 rounded-full hover:bg-muted"
                aria-label="북마크 패널 닫기"
              >
                <X className="h-5 w-5" aria-hidden="true" />
              </Button>
            )}
          </div>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
        {isLoading ? (
          <div
            role="status"
            aria-label="북마크 목록 로딩 중"
            className="space-y-3"
          >
            {[0, 1, 2, 3].map((item) => (
              <div
                key={item}
                className="rounded-xl border border-border bg-card p-3"
              >
                <Skeleton className="h-4 w-2/3 rounded" />
                <Skeleton className="mt-2 h-3 w-full rounded" />
                <Skeleton className="mt-2 h-3 w-1/2 rounded" />
              </div>
            ))}
          </div>
        ) : isError ? (
          <div
            role="status"
            className="grid min-h-52 place-items-center rounded-2xl border border-dashed border-border bg-muted/30 p-5 text-center text-sm text-muted-foreground"
          >
            <div>
              <Bookmark
                className="mx-auto mb-2 h-10 w-10 rounded-full bg-primary/10 p-2 text-primary/70"
                aria-hidden="true"
              />
              <p className="font-medium text-foreground">
                북마크를 불러오지 못했습니다
              </p>
              <p className="mt-1 text-xs leading-5">
                잠시 후 다시 열어 주세요.
              </p>
            </div>
          </div>
        ) : bookmarks.length === 0 ? (
          <div className="grid min-h-52 place-items-center rounded-2xl border border-dashed border-border bg-muted/30 p-5 text-center text-sm text-muted-foreground">
            <div>
              <Bookmark
                className="mx-auto mb-2 h-10 w-10 rounded-full bg-primary/10 p-2 text-primary/70"
                aria-hidden="true"
              />
              <p className="font-medium text-foreground">
                북마크한 맛집이 없습니다
              </p>
              <p className="mt-1 text-xs leading-5">
                맛집 상세에서 북마크를 누르면 여기에 모입니다.
              </p>
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            {bookmarks.map((bookmark) => (
              <div
                key={bookmark.id}
                className="group rounded-xl border border-border bg-card shadow-sm transition-colors hover:bg-accent"
              >
                <button
                  type="button"
                  aria-label={`${bookmark.restaurant.name} 북마크 열기`}
                  onClick={() => onRestaurantOpen(bookmark.restaurant)}
                  className="flex w-full items-start gap-3 rounded-t-xl p-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                >
                  <MapPin
                    className="mt-0.5 h-9 w-9 shrink-0 rounded-full bg-primary/10 p-2 text-primary"
                    aria-hidden="true"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="flex min-w-0 items-start justify-between gap-2">
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-semibold text-foreground">
                          {bookmark.restaurant.name}
                        </span>
                        <span className="mt-1 block truncate text-xs text-muted-foreground">
                          {bookmark.restaurant.road_address ||
                            bookmark.restaurant.jibun_address ||
                            "주소 정보 없음"}
                        </span>
                      </span>
                      {bookmark.restaurant.category?.[0] && (
                        <Badge
                          variant="secondary"
                          className="h-5 shrink-0 px-1.5 text-[10px] font-normal"
                        >
                          {bookmark.restaurant.category[0]}
                        </Badge>
                      )}
                    </span>
                  </span>
                </button>
                <div className="flex items-center justify-between gap-2 border-t border-border/60 px-3 py-2 text-[11px] text-muted-foreground">
                  <span>리뷰 {bookmark.restaurant.review_count || 0}개</span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={isToggling}
                    onClick={(event) =>
                      handleRemoveBookmark(bookmark.restaurant.id, event)
                    }
                    className="h-7 rounded-full px-2 text-muted-foreground hover:text-destructive"
                    aria-label={`${bookmark.restaurant.name} 북마크 삭제`}
                  >
                    <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                    <span className="sr-only">삭제</span>
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
