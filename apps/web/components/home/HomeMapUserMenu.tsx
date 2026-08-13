"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Image from "next/image";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
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
import { useAuth } from "@/contexts/AuthContextBase";
import { supabase } from "@/integrations/supabase/client";
import {
  DESKTOP_LEFT_PANEL_EXPAND_ON_ENTRY_EVENT,
  shouldExpandDesktopLeftPanelForRoute,
} from "@/lib/desktop-left-panel-entry";
import { toast } from "@/lib/no-toast";
import { cn } from "@/lib/utils";
import type { HomeMapPanelSide } from "@/lib/home-map-user-preferences";
import { siteConfig } from "@/lib/site-config";
import { resolveProfileAvatarUrl } from "@/lib/profile-avatar-url";
import { readPublicProfileSummaries } from "@/lib/public-profile-read";

const desktopUserMenuItemClass =
  "cursor-pointer rounded-xl px-3 py-2.5 text-sm font-medium text-foreground whitespace-nowrap focus:bg-accent focus:text-foreground";
const DESKTOP_MAP_SIDE_PANEL_WIDTH_CSS = "min(392px, calc(100vw - 32px))";
const DesktopAuthModal = dynamic(() => import("@/components/auth/AuthModal"), {
  ssr: false,
  loading: () => null,
});

const getDisplayName = (user: ReturnType<typeof useAuth>["user"]) => {
  if (!user) return "사용자";

  const metadata = user.user_metadata ?? {};
  const candidates = [
    metadata.nickname,
    metadata.name,
    metadata.full_name,
    user.email?.split("@")[0],
  ];
  const displayName = candidates.find(
    (candidate): candidate is string =>
      typeof candidate === "string" && candidate.trim().length > 0,
  );

  return displayName?.trim() ?? "사용자";
};

export default function HomeMapUserMenu({
  desktopPanelSide = "left",
  isPanelCollapsed = false,
}: {
  desktopPanelSide?: HomeMapPanelSide;
  isPanelCollapsed?: boolean;
}) {
  const { user, isLoading: isAuthLoading, isAdmin, signOut } = useAuth();
  const router = useRouter();
  const queryClient = useQueryClient();

  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isBusinessInfoExpanded, setIsBusinessInfoExpanded] = useState(false);
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);

  const displayName = useMemo(() => getDisplayName(user), [user]);
  const { data: profileAvatarUrl = null } = useQuery({
    queryKey: ["home-map-user-menu-avatar", user?.id],
    queryFn: async () => {
      if (!user?.id) return null;

      try {
        const [profile] = await readPublicProfileSummaries(supabase, [user.id]);
        return resolveProfileAvatarUrl(profile?.avatar_url, user.id);
      } catch {
        console.error("지도 사용자 프로필 사진 조회 실패:");
        return null;
      }
    },
    enabled: Boolean(user?.id),
    staleTime: 5 * 60 * 1000,
  });

  const navigateToPage = useCallback(
    (href: string) => {
      if (shouldExpandDesktopLeftPanelForRoute(href)) {
        window.dispatchEvent(
          new CustomEvent(DESKTOP_LEFT_PANEL_EXPAND_ON_ENTRY_EVENT, {
            detail: { href },
          }),
        );
      }

      router.push(href);
    },
    [router],
  );

  const handleLogout = useCallback(async () => {
    try {
      await signOut();
      queryClient.clear();
      toast.success("로그아웃되었습니다");
      router.push("/");
    } catch (error) {
      console.error("로그아웃 실패:");
      toast.error("로그아웃에 실패했습니다");
    }
  }, [queryClient, router, signOut]);

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

  useEffect(() => {
    if (user) {
      setIsAuthModalOpen(false);
    }
  }, [user]);

  const handleFullscreenToggle = useCallback(async () => {
    try {
      if (!document.fullscreenElement) {
        await document.documentElement.requestFullscreen();
        return;
      }

      await document.exitFullscreen();
    } catch (error) {
      console.error("지도 전체화면 전환 실패:");
      toast.error("전체화면 전환에 실패했습니다");
    }
  }, []);

  const closeAuthModal = useCallback(() => {
    setIsAuthModalOpen(false);
  }, []);

  const handleLoginClick = useCallback(() => {
    setIsAuthModalOpen(true);
    toast.info("로그인 후 마이페이지를 확인할 수 있어요");
  }, []);

  const shouldOffsetForRightPanel = desktopPanelSide === "right" && !isPanelCollapsed;
  const userButtonStyle = shouldOffsetForRightPanel
    ? { right: `calc(${DESKTOP_MAP_SIDE_PANEL_WIDTH_CSS} + 1.5rem)` }
    : undefined;
  const fullscreenButtonStyle = shouldOffsetForRightPanel
    ? { right: `calc(${DESKTOP_MAP_SIDE_PANEL_WIDTH_CSS} + 5rem)` }
    : undefined;

  const userAvatarButton = (
    <span
      className="relative grid h-9 w-9 place-items-center overflow-hidden rounded-full bg-primary/10 text-primary"
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
        <UserRound className="h-5 w-5" />
      )}
    </span>
  );

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        data-desktop-map-fullscreen-toggle="true"
        className={cn(
          "fixed top-4 z-[120] h-11 w-11 rounded-full border border-border bg-background/95 p-0 text-foreground shadow-lg backdrop-blur-sm transition-colors hover:bg-secondary/80 focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2",
          shouldOffsetForRightPanel ? "" : "right-20",
        )}
        style={fullscreenButtonStyle}
        aria-label={isFullscreen ? "지도 전체화면 끄기" : "지도 전체화면 켜기"}
        aria-pressed={isFullscreen}
        onClick={handleFullscreenToggle}
      >
        {isFullscreen ? (
          <Minimize2 className="h-5 w-5" aria-hidden="true" />
        ) : (
          <Maximize2 className="h-5 w-5" aria-hidden="true" />
        )}
      </Button>

      {user ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              data-desktop-map-user-menu="true"
              className={cn(
                "fixed top-4 z-[120] h-11 w-11 rounded-full border border-border bg-background/95 p-0 shadow-lg backdrop-blur-sm transition-colors hover:bg-secondary/80 focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2",
                shouldOffsetForRightPanel ? "" : "right-6",
              )}
              style={userButtonStyle}
              aria-label="사용자 메뉴 열기"
            >
              {userAvatarButton}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="end"
            sideOffset={10}
            className="z-[180] w-max min-w-[max-content] max-w-[min(24rem,calc(100vw-2rem))] rounded-2xl border-border bg-card p-1.5 font-sans shadow-2xl"
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
              onClick={() => navigateToPage("/mypage/profile")}
              className={desktopUserMenuItemClass}
            >
              <UserRound className="mr-2 h-4 w-4" aria-hidden="true" />
              마이페이지
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => navigateToPage("/?panel=settings")}
              className={desktopUserMenuItemClass}
            >
              <Settings2 className="mr-2 h-4 w-4" aria-hidden="true" />
              환경설정
            </DropdownMenuItem>
            {isAdmin && (
              <DropdownMenuItem
                onSelect={() => navigateToPage("/admin")}
                data-admin-console-menu-item="true"
                className={desktopUserMenuItemClass}
              >
                <ShieldCheck className="mr-2 h-4 w-4" aria-hidden="true" />
                관리자 콘솔
              </DropdownMenuItem>
            )}
            <DropdownMenuSeparator className="my-1 bg-border" />
            <DropdownMenuItem
              onClick={handleLogout}
              className={cn(
                desktopUserMenuItemClass,
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
      ) : isAuthLoading ? (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          data-desktop-map-user-menu="true"
          data-auth-session-pending="true"
          className={cn(
            "fixed top-4 z-[120] h-11 w-11 rounded-full border border-border bg-background/95 p-0 shadow-lg backdrop-blur-sm transition-colors focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2",
            shouldOffsetForRightPanel ? "" : "right-6",
          )}
          style={userButtonStyle}
          aria-label="사용자 세션 확인 중"
          disabled
        >
          {userAvatarButton}
        </Button>
      ) : (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          data-desktop-map-user-menu="true"
          className={cn(
            "fixed top-4 z-[120] h-11 w-11 rounded-full border border-border bg-background/95 p-0 shadow-lg backdrop-blur-sm transition-colors hover:bg-secondary/80 focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2",
            shouldOffsetForRightPanel ? "" : "right-6",
          )}
          style={userButtonStyle}
          aria-label="로그인 열기"
          onClick={handleLoginClick}
        >
          {userAvatarButton}
        </Button>
      )}
      {!user && isAuthModalOpen && (
        <DesktopAuthModal
          isOpen={isAuthModalOpen}
          onClose={closeAuthModal}
          onAuthSuccess={closeAuthModal}
          redirectTo="/mypage/profile"
          reason="mypage"
        />
      )}
    </>
  );
}
