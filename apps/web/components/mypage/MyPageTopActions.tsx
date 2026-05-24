"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import {
  ChevronDown,
  ChevronUp,
  LogOut,
  Maximize2,
  Minimize2,
  Settings2,
  ShieldCheck,
  UserRound,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAuth } from "@/contexts/AuthContext";
import { useUserProfileIdentity } from "@/hooks/useUserProfile";
import { toast } from "@/lib/no-toast";
import { cn } from "@/lib/utils";
import { siteConfig } from "@/lib/site-config";

const myPageTopActionButtonClass =
  "h-11 w-11 rounded-full border border-border bg-background/95 p-0 shadow-lg backdrop-blur-sm transition-colors hover:bg-secondary/80 focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2";
const myPageUserMenuItemClass =
  "cursor-pointer rounded-xl px-3 py-2.5 text-sm font-medium text-foreground whitespace-nowrap focus:bg-accent focus:text-foreground";
const myPageUserAvatarClass =
  "relative flex h-9 w-9 items-center justify-center overflow-hidden rounded-full bg-primary/10 text-primary";
const myPageUserAvatarIconClass =
  "absolute left-1/2 top-1/2 !h-5 !w-5 -translate-x-1/2 -translate-y-1/2";

export function MyPageTopActions() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { user, isAdmin, signOut, profileNickname } = useAuth();
  const { data: profile } = useUserProfileIdentity(user?.id ?? "");
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isBusinessInfoExpanded, setIsBusinessInfoExpanded] = useState(false);

  const displayName = useMemo(
    () =>
      profile?.nickname ||
      profileNickname ||
      user?.email?.split("@")[0] ||
      "사용자",
    [profile?.nickname, profileNickname, user?.email],
  );

  const profileAvatarUrl =
    typeof profile?.avatarUrl === "string" && profile.avatarUrl.trim()
      ? profile.avatarUrl
      : null;

  useEffect(() => {
    const syncFullscreenState = () => {
      setIsFullscreen(Boolean(document.fullscreenElement));
    };

    syncFullscreenState();
    document.addEventListener("fullscreenchange", syncFullscreenState);

    return () => {
      document.removeEventListener("fullscreenchange", syncFullscreenState);
    };
  }, []);

  const handleFullscreenToggle = useCallback(async () => {
    try {
      if (!document.fullscreenElement) {
        await document.documentElement.requestFullscreen();
        return;
      }

      await document.exitFullscreen();
    } catch (error) {
      console.error("마이페이지 전체화면 전환 실패:", error);
      toast.error("전체화면 전환에 실패했습니다");
    }
  }, []);

  const handleLogout = useCallback(async () => {
    try {
      await signOut();
      queryClient.clear();
      toast.success("로그아웃되었습니다");
      router.push("/");
    } catch (error) {
      console.error("로그아웃 실패:", error);
      toast.error("로그아웃에 실패했습니다");
    }
  }, [queryClient, router, signOut]);

  if (!user) return null;

  const userAvatarButton = (
    <span
      className={myPageUserAvatarClass}
      data-mypage-user-avatar="centered"
      aria-hidden="true"
    >
      {profileAvatarUrl ? (
        <Image
          src={profileAvatarUrl}
          alt=""
          fill
          sizes="36px"
          className="rounded-full object-cover"
        />
      ) : (
        <UserRound className={myPageUserAvatarIconClass} />
      )}
    </span>
  );

  return (
    <div
      className="hidden items-center gap-2 md:flex"
      data-mypage-top-actions="map-style"
    >
      <Button
        type="button"
        variant="ghost"
        size="icon"
        data-mypage-fullscreen-toggle="true"
        className={myPageTopActionButtonClass}
        aria-label={
          isFullscreen ? "마이페이지 전체화면 끄기" : "마이페이지 전체화면 켜기"
        }
        aria-pressed={isFullscreen}
        onClick={handleFullscreenToggle}
      >
        {isFullscreen ? (
          <Minimize2 className="h-5 w-5" aria-hidden="true" />
        ) : (
          <Maximize2 className="h-5 w-5" aria-hidden="true" />
        )}
      </Button>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            data-mypage-user-menu="true"
            className={myPageTopActionButtonClass}
            aria-label="사용자 메뉴 열기"
          >
            {userAvatarButton}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          sideOffset={10}
          className="z-[180] w-max min-w-[max-content] max-w-[min(24rem,calc(100vw-2rem))] rounded-2xl border-border bg-card p-1.5 font-serif shadow-2xl"
        >
          <DropdownMenuLabel className="max-w-[min(22rem,calc(100vw-4rem))] rounded-xl px-3 py-2 text-foreground">
            <span className="block truncate text-sm font-semibold">
              {displayName}
            </span>
            {user.email && (
              <span className="block truncate text-xs font-normal text-muted-foreground">
                {user.email}
              </span>
            )}
          </DropdownMenuLabel>
          <DropdownMenuSeparator className="my-1 bg-border" />
          <DropdownMenuItem
            onClick={() => router.push("/mypage/profile")}
            className={myPageUserMenuItemClass}
          >
            <UserRound className="mr-2 h-4 w-4" aria-hidden="true" />
            마이페이지
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() => router.push("/?panel=settings")}
            className={myPageUserMenuItemClass}
          >
            <Settings2 className="mr-2 h-4 w-4" aria-hidden="true" />
            환경설정
          </DropdownMenuItem>
          {isAdmin && (
            <DropdownMenuItem
              onClick={() => router.push("/admin")}
              className={myPageUserMenuItemClass}
            >
              <ShieldCheck className="mr-2 h-4 w-4" aria-hidden="true" />
              관리자 콘솔
            </DropdownMenuItem>
          )}
          <DropdownMenuSeparator className="my-1 bg-border" />
          <DropdownMenuItem
            onClick={handleLogout}
            className={cn(
              myPageUserMenuItemClass,
              "text-destructive focus:text-destructive",
            )}
          >
            <LogOut className="mr-2 h-4 w-4" aria-hidden="true" />
            로그아웃
          </DropdownMenuItem>
          <DropdownMenuSeparator className="my-1 bg-border" />
          <div className="px-2 py-1" data-desktop-map-business-info="true">
            <button
              type="button"
              aria-label="사업자 정보 펼치기/접기"
              aria-expanded={isBusinessInfoExpanded}
              aria-controls="desktop-map-business-info-content"
              onClick={() => setIsBusinessInfoExpanded((prev) => !prev)}
              className="flex w-max max-w-full items-center justify-between rounded-lg px-1 py-1 text-left whitespace-nowrap transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              <span className="text-[10px] text-muted-foreground">
                {siteConfig.operator.copyrightLabel}
              </span>
              {isBusinessInfoExpanded ? (
                <ChevronUp
                  className="ml-2 h-3 w-3 text-muted-foreground"
                  aria-hidden="true"
                />
              ) : (
                <ChevronDown
                  className="ml-2 h-3 w-3 text-muted-foreground"
                  aria-hidden="true"
                />
              )}
            </button>
            {isBusinessInfoExpanded && (
              <div
                id="desktop-map-business-info-content"
                className="mt-1 space-y-0.5 border-t border-border px-1 pt-1 text-[9px] leading-4 text-muted-foreground whitespace-nowrap"
              >
                <p className="font-medium text-foreground">{siteConfig.operator.companyName}</p>
                <p>대표: {siteConfig.operator.representative}</p>
                <p>사업자: {siteConfig.operator.businessRegistrationNumber}</p>
                <p>이메일: {siteConfig.contact.email}</p>
              </div>
            )}
          </div>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
