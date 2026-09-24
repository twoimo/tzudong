"use client";

import { useCallback, type MouseEvent as ReactMouseEvent } from "react";
import { CheckCheck, MapPin, Trash2 } from "lucide-react";
import { MapPanelHeader, mapPanelIconButtonClass } from "@/components/home/map-panel-chrome";
import { formatDistanceToNow } from "date-fns";
import { ko } from "date-fns/locale";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useNotifications } from "@/contexts/NotificationContextBase";
import { cn } from "@/lib/utils";
import type { Notification } from "@/types/notification";

interface DesktopLeftPanelNotificationsProps {
  onRestaurantIdOpen: (restaurantId: string) => void;
  onOpenProfile: () => void;
  onOpenAnnouncements: () => void;
  onClose?: () => void;
}

export default function DesktopLeftPanelNotifications({
  onRestaurantIdOpen,
  onOpenProfile,
  onOpenAnnouncements,
  onClose,
}: DesktopLeftPanelNotificationsProps) {
  const {
    notifications,
    unreadCount,
    isLoading,
    isError,
    markAsRead,
    markAllAsRead,
    removeNotification,
  } = useNotifications();

  const handleNotificationOpen = useCallback(
    (notification: Notification) => {
      markAsRead(notification.id);

      if (
        notification.type === "review_approved" ||
        notification.type === "review_rejected"
      ) {
        onOpenProfile();
        return;
      }

      const restaurantId =
        typeof notification.data?.restaurantId === "string"
          ? notification.data.restaurantId
          : null;
      if (restaurantId) {
        onRestaurantIdOpen(restaurantId);
        return;
      }

      onOpenAnnouncements();
    },
    [markAsRead, onOpenAnnouncements, onOpenProfile, onRestaurantIdOpen],
  );
  const handleNotificationRemove = useCallback(
    (notificationId: string, event: ReactMouseEvent<HTMLButtonElement>) => {
      event.stopPropagation();
      removeNotification(notificationId);
    },
    [removeNotification],
  );

  return (
    <div
      className="flex h-full min-h-0 flex-col bg-background"
      data-desktop-left-panel-view="notifications"
    >
      <MapPanelHeader
        title="알림"
        description="리뷰, 맛집, 공지 소식을 확인해요"
        count={isLoading ? undefined : notifications.length}
        onClose={onClose}
        closeLabel="알림 패널 닫기"
        actions={unreadCount > 0 ? (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={markAllAsRead}
            className={mapPanelIconButtonClass}
            aria-label="모든 알림 읽음 처리"
          >
            <CheckCheck className="h-4 w-4" aria-hidden="true" />
          </Button>
        ) : null}
      />

      <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-contain px-4 py-3">
        {isLoading ? (
          <div
            role="status"
            aria-label="알림 목록 로딩 중"
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
              <Bell
                className="mx-auto mb-2 h-10 w-10 rounded-full bg-primary/10 p-2 text-primary/70"
                aria-hidden="true"
              />
              <p className="font-medium text-foreground">
                알림을 불러오지 못했습니다
              </p>
              <p className="mt-1 text-xs leading-5">
                잠시 후 다시 열어 주세요.
              </p>
            </div>
          </div>
        ) : notifications.length === 0 ? (
          <div className="grid min-h-52 place-items-center rounded-2xl border border-dashed border-border bg-muted/30 p-5 text-center text-sm text-muted-foreground">
            <div>
              <Bell
                className="mx-auto mb-2 h-10 w-10 rounded-full bg-primary/10 p-2 text-primary/70"
                aria-hidden="true"
              />
              <p className="font-medium text-foreground">
                새로운 알림이 없습니다
              </p>
              <p className="mt-1 text-xs leading-5">
                리뷰 승인, 제보 처리, 랭킹 소식이 생기면 여기에 표시됩니다.
              </p>
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            {notifications.slice(0, 50).map((notification) => (
              <div
                key={notification.id}
                className={cn(
                  "group rounded-xl border border-border bg-card shadow-sm transition-colors hover:bg-accent",
                  !notification.isRead && "border-primary/30 bg-primary/5 hover:bg-primary/10",
                )}
              >
                <button
                  type="button"
                  aria-label={`${notification.title} 알림 열기${notification.isRead ? "" : ", 읽지 않음"}`}
                  onClick={() => handleNotificationOpen(notification)}
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
                          {notification.title}
                        </span>
                      </span>
                      {!notification.isRead && (
                        <Badge
                          variant="secondary"
                          className="h-5 shrink-0 px-1.5 text-2xs font-normal"
                        >
                          새 알림
                        </Badge>
                      )}
                    </span>
                    <span className="mt-1 block line-clamp-2 text-xs leading-5 text-muted-foreground">
                      {notification.message}
                    </span>
                  </span>
                </button>
                <div className="flex items-center justify-between gap-2 border-t border-border/60 px-3 py-2 text-2xs text-muted-foreground">
                  <span>
                    {formatDistanceToNow(notification.createdAt, {
                      addSuffix: true,
                      locale: ko,
                    })}
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={(event) =>
                      handleNotificationRemove(notification.id, event)
                    }
                    className="h-7 rounded-full px-2 text-muted-foreground hover:text-destructive"
                    aria-label={`${notification.title} 알림 삭제`}
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
