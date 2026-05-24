"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { Bell, CheckCheck, X } from "lucide-react";
import type { User } from "@supabase/supabase-js";
import { formatDistanceToNow } from "date-fns";
import { ko } from "date-fns/locale";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { useNotifications } from "@/contexts/NotificationContextBase";
import { cn } from "@/lib/utils";
import type { Notification } from "@/types/notification";

interface MobileNotificationMenuButtonProps {
  user: User;
  defaultOpen?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

export default function MobileNotificationMenuButton({
  user: _user,
  defaultOpen = false,
  open,
  onOpenChange,
}: MobileNotificationMenuButtonProps) {
  const router = useRouter();
  const [uncontrolledOpen, setUncontrolledOpen] = useState(defaultOpen);
  const isOpen = open ?? uncontrolledOpen;
  const handleOpenChange = onOpenChange ?? setUncontrolledOpen;
  const {
    notifications,
    unreadCount,
    isLoading: isNotificationsLoading,
    isError: isNotificationsError,
    markAsRead,
    markAllAsRead,
    removeNotification,
  } = useNotifications();

  const handleNotificationItemClick = useCallback(
    (notification: Notification) => {
      markAsRead(notification.id);

      if (
        notification.type === "review_approved" ||
        notification.type === "review_rejected"
      ) {
        const reviewId = notification.data?.reviewId;
        const status =
          notification.type === "review_approved" ? "approved" : "rejected";
        if (reviewId) {
          router.push(`/mypage/reviews?reviewId=${reviewId}&status=${status}`);
        } else {
          router.push(`/mypage/reviews?status=${status}`);
        }
        return;
      }

      const restaurantId =
        typeof notification.data?.restaurantId === "string"
          ? notification.data.restaurantId
          : null;
      if (restaurantId) {
        router.push(`/?r=${restaurantId}&z=13`);
        return;
      }

      router.push("/?panel=announcement");
    },
    [markAsRead, router],
  );

  return (
    <DropdownMenu open={isOpen} onOpenChange={handleOpenChange}>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className={cn(
            "h-9 w-9 rounded-full border border-border bg-background",
            "hover:bg-secondary/80 relative focus-visible:ring-2 focus-visible:ring-primary touch-manipulation",
          )}
          aria-label={
            unreadCount > 0
              ? `알림, 안 읽은 알림 ${unreadCount > 99 ? "99개 이상" : `${unreadCount}개`}`
              : "알림"
          }
        >
          <Bell className="h-[18px] w-[18px]" aria-hidden="true" />
          {unreadCount > 0 && (
            <Badge
              variant="destructive"
              aria-hidden="true"
              className="absolute -top-1 -right-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-red-800 px-1.5 py-0 text-[10px] font-bold leading-none tabular-nums text-white"
            >
              {unreadCount > 99 ? "99+" : unreadCount}
            </Badge>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="w-[min(calc(100vw-1rem),22rem)] rounded-2xl border-border bg-card p-2 font-serif shadow-primary z-[110]"
      >
        <DropdownMenuLabel className="flex items-start justify-between gap-3 px-1 py-1 text-foreground">
          <div className="min-w-0">
            <span className="block font-semibold">알림</span>
            <span className="block text-xs font-normal text-muted-foreground">
              최근 알림 {notifications.length}개 · 안 읽음{" "}
              {unreadCount > 99 ? "99+" : unreadCount}
            </span>
          </div>
          {unreadCount > 0 && (
            <Button
              variant="ghost"
              size="sm"
              type="button"
              aria-label="모든 알림 읽음 처리"
              onClick={markAllAsRead}
              className="h-8 shrink-0 rounded-full px-2.5 text-xs text-muted-foreground hover:bg-transparent hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary touch-manipulation"
            >
              <CheckCheck className="mr-1 h-3 w-3" aria-hidden="true" />
              모두 읽음
            </Button>
          )}
        </DropdownMenuLabel>
        <DropdownMenuSeparator className="my-2 bg-border" />
        <ScrollArea className="h-72 max-h-[min(70vh,28rem)] pr-1">
          {isNotificationsLoading ? (
            <div
              role="status"
              aria-label="알림 목록 로딩 중"
              className="space-y-3 rounded-xl bg-background/70 p-3"
            >
              {[0, 1, 2].map((item) => (
                <div key={item} className="space-y-2">
                  <Skeleton className="h-4 w-3/4 rounded" />
                  <Skeleton className="h-3 w-full rounded" />
                </div>
              ))}
            </div>
          ) : isNotificationsError ? (
            <div
              role="status"
              className="grid min-h-40 place-items-center rounded-xl bg-background/70 p-4 text-center text-sm text-muted-foreground"
            >
              <div>
                <Bell
                  className="mx-auto mb-2 h-9 w-9 rounded-full bg-primary/10 p-2 text-primary/70"
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
            <div className="grid min-h-40 place-items-center rounded-xl bg-background/70 p-4 text-center text-sm text-muted-foreground">
              <div>
                <Bell
                  className="mx-auto mb-2 h-9 w-9 rounded-full bg-primary/10 p-2 text-primary/70"
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
            <DropdownMenuGroup>
              {notifications.slice(0, 50).map((notification) => (
                <DropdownMenuItem
                  key={notification.id}
                  aria-label={`${notification.title} 알림 열기${notification.isRead ? "" : ", 읽지 않음"}`}
                  className={cn(
                    "flex w-full max-w-full cursor-pointer items-center gap-2 rounded-xl p-2.5 touch-manipulation hover:bg-accent focus:bg-accent",
                    !notification.isRead && "bg-primary/5",
                  )}
                  onSelect={() => handleNotificationItemClick(notification)}
                >
                  <div className="flex-1 min-w-0 flex flex-col gap-0.5">
                    <div className="flex items-center justify-between gap-2 w-full">
                      <p className="text-sm font-medium text-foreground truncate">
                        {notification.title}
                      </p>
                      {!notification.isRead && (
                        <span
                          className="h-2 w-2 rounded-full bg-red-700 shrink-0"
                          aria-hidden
                        />
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground truncate">
                      {notification.message}
                    </p>
                    <p className="text-[11px] text-muted-foreground/70 mt-0.5">
                      {formatDistanceToNow(notification.createdAt, {
                        addSuffix: true,
                        locale: ko,
                      })}
                    </p>
                  </div>
                  <button
                    type="button"
                    aria-label={`${notification.title} 알림 삭제`}
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-destructive/10 hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-destructive/40"
                    onPointerDown={(event) => event.stopPropagation()}
                    onClick={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      removeNotification(notification.id);
                    }}
                  >
                    <X className="h-3.5 w-3.5" aria-hidden="true" />
                    <span className="sr-only">알림 삭제</span>
                  </button>
                </DropdownMenuItem>
              ))}
            </DropdownMenuGroup>
          )}
        </ScrollArea>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
