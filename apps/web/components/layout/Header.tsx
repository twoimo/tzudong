import Link from "next/link";
import NextImage from "next/image";
import { PanelLeft, Bell, Maximize, User, LogOut, X, CheckCheck, Megaphone, ChevronLeft, ChevronRight, ChevronDown, ChevronUp, BarChart2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useState, useEffect, useCallback, memo, useMemo, useRef, Suspense, type ComponentType } from "react";
import { createPortal } from "react-dom";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  DropdownMenuLabel,
  DropdownMenuGroup,
} from "@/components/ui/dropdown-menu";
import { BottomSheet } from "@/components/ui/bottom-sheet";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useNotifications } from "@/contexts/NotificationContextBase";
import { formatDistanceToNow } from "date-fns";
import { ko } from "date-fns/locale";
import { cn } from "@/lib/utils";
import { usePathname, useRouter } from "next/navigation";
import { Announcement } from "@/types/announcement";
import type { Notification } from "@/types/notification";
import { useHydration } from "@/hooks/useHydration";
import { useImmediateMobileOrTablet } from "@/hooks/useDeviceType";
import { useBannerAnnouncements } from "@/hooks/use-banner-announcements";
import { useDeferredComponent } from "@/hooks/use-deferred-component";
import { updateMobileHeaderHeight } from "@/lib/mobile-sheet-layout";
import { siteConfig } from "@/lib/site-config";
import AnnouncementPanelLoadingFallback from "@/components/announcement/AnnouncementPanelLoadingFallback";

interface HeaderProps {
  onToggleSidebar: () => void;
  isLoggedIn: boolean;
  isAuthLoading?: boolean;
  onOpenAuth: () => void;
  onLogout: () => void;
  onProfileClick?: () => void;
  onMyPageClick?: () => void;
  isCenteredLayout?: boolean;
  onToggleCenteredLayout?: () => void;
  isAdmin?: boolean;
  onAnnouncementClick?: (announcement: Announcement) => void;
  hideToggleSidebar?: boolean;
}

function HeaderActionSkeleton({ label, className }: { label: string; className?: string }) {
  return (
    <Skeleton
      role="status"
      aria-label={label}
      className={cn("h-11 w-11 flex-shrink-0 rounded-xl motion-reduce:animate-none", className)}
    />
  );
}

type HeaderDeferredComponentProps = Record<string, never>;

const loadHeaderBookmarkMenuButton = async () => {
  const mod = await import("@/components/layout/HeaderBookmarkMenuButton");
  return mod.default as ComponentType<HeaderDeferredComponentProps>;
};

const loadRankingWidget = async () => {
  const mod = await import("./RankingWidget");
  return mod.RankingWidget as ComponentType<HeaderDeferredComponentProps>;
};

type HeaderAnnouncementPanelProps = {
  isOpen: boolean;
  onClose: () => void;
  isAdmin?: boolean;
  initialAnnouncement?: Announcement | null;
  isBottomSheet?: boolean;
  adminActionsMode?: "inline";
};

const loadAnnouncementPanel = async () => {
  const mod = await import("@/components/announcement/AnnouncementPanel");
  return mod.default as ComponentType<HeaderAnnouncementPanelProps>;
};

const BANNER_ROTATION_INTERVAL = 5000;
const HEADER_BANNER_FRAME_CLASS = "flex items-center gap-2 px-2 py-0.5 md:px-3 md:py-1 rounded-md transition-all duration-300 relative z-10 flex-1 min-w-0";

const HeaderComponent = ({ onToggleSidebar, isLoggedIn, isAuthLoading = true, onOpenAuth, onLogout, isAdmin = false, onAnnouncementClick, hideToggleSidebar = false }: HeaderProps) => {
  const isHydrated = useHydration();
  const isMobileOrTablet = useImmediateMobileOrTablet();
  const { notifications, unreadCount, isLoading: isNotificationsLoading, isError: isNotificationsError, markAsRead, markAllAsRead, removeNotification } = useNotifications();
  const pathname = usePathname();
  const router = useRouter();
  const headerRef = useRef<HTMLElement>(null);

  // 공지 배너 상태
  const [currentBannerIndex, setCurrentBannerIndex] = useState(0);
  const [isBannerDismissed, setIsBannerDismissed] = useState(false);
  const [isBannerPaused, setIsBannerPaused] = useState(false);
  // 공지사항 바텀시트 상태
  const [isAnnouncementSheetOpen, setIsAnnouncementSheetOpen] = useState(false);
  const [selectedAnnouncement, setSelectedAnnouncement] = useState<Announcement | null>(null);
  const { data: bannerAnnouncements = [], isLoading: isBannerAnnouncementsLoading } = useBannerAnnouncements();

  // 사업자 정보 펼치기 상태
  const [isBusinessInfoExpanded, setIsBusinessInfoExpanded] = useState(false);

  // 성능 최적화: 조건부 렌더링 로직 메모이제이션
  const shouldShowAuthUI = useMemo(() => isHydrated && !isAuthLoading, [isHydrated, isAuthLoading]);
  const shouldShowHeaderIcons = isLoggedIn && shouldShowAuthUI;
  const shouldShowLoginButton = !isLoggedIn && shouldShowAuthUI;
  const shouldShowAuthSkeleton = !shouldShowAuthUI;
  const shouldShowNotificationSkeleton = shouldShowAuthSkeleton;
  const shouldShowBookmarkSkeleton = shouldShowAuthSkeleton;
  const shouldShowFullscreenSkeleton = shouldShowAuthSkeleton;
  const shouldShowAccountSkeleton = shouldShowAuthSkeleton;
  const shouldShowBannerSkeleton = (!isHydrated || isBannerAnnouncementsLoading) && bannerAnnouncements.length === 0;
  const isMobileBannerOnlyHeader = isMobileOrTablet;
  const shouldLoadAuthenticatedHeaderWidgets = shouldShowHeaderIcons && !isMobileBannerOnlyHeader;
  const RankingWidget = useDeferredComponent<HeaderDeferredComponentProps>(shouldLoadAuthenticatedHeaderWidgets, loadRankingWidget);
  const HeaderBookmarkMenuButton = useDeferredComponent<HeaderDeferredComponentProps>(shouldShowHeaderIcons, loadHeaderBookmarkMenuButton);

  const HeaderAnnouncementPanel = useDeferredComponent<HeaderAnnouncementPanelProps>(isAnnouncementSheetOpen, loadAnnouncementPanel);

  const handleInsightMenuClick = useCallback(() => {
    if (isLoggedIn) {
      router.push('/insights');
    }
  }, [isLoggedIn, router]);

  useEffect(() => {
    const dismissed = sessionStorage.getItem('announcementBannerDismissed');
    if (dismissed) {
      setIsBannerDismissed(true);
    }
  }, []);

  useEffect(() => {
    if (bannerAnnouncements.length === 0) {
      setCurrentBannerIndex(0);
      return;
    }
    if (currentBannerIndex >= bannerAnnouncements.length) {
      setCurrentBannerIndex(0);
    }
  }, [bannerAnnouncements.length, currentBannerIndex]);

  useEffect(() => {
    if (!headerRef.current) return;

    const element = headerRef.current;
    const updateHeaderHeight = () => {
      updateMobileHeaderHeight(element.offsetHeight);
    };

    updateHeaderHeight();

    const resizeObserver = new ResizeObserver(updateHeaderHeight);
    resizeObserver.observe(element);

    return () => {
      resizeObserver.disconnect();
    };
  }, []);

  // 배너 자동 순환
  useEffect(() => {
    if (bannerAnnouncements.length <= 1 || isBannerPaused || isBannerDismissed) return;
    const timer = setInterval(() => {
      setCurrentBannerIndex(prev => (prev + 1) % bannerAnnouncements.length);
    }, BANNER_ROTATION_INTERVAL);
    return () => clearInterval(timer);
  }, [bannerAnnouncements.length, isBannerPaused, isBannerDismissed]);

  const handleBannerPrev = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setCurrentBannerIndex(prev => (prev - 1 + bannerAnnouncements.length) % bannerAnnouncements.length);
  }, [bannerAnnouncements.length]);

  const handleBannerNext = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setCurrentBannerIndex(prev => (prev + 1) % bannerAnnouncements.length);
  }, [bannerAnnouncements.length]);

  const handleBannerClick = useCallback(() => {
    const currentAnnouncement = bannerAnnouncements[currentBannerIndex];
    if (currentAnnouncement) {
      if (!isMobileOrTablet && onAnnouncementClick) {
        onAnnouncementClick(currentAnnouncement);
        return;
      }
      setSelectedAnnouncement(currentAnnouncement);
      setIsAnnouncementSheetOpen(true);
    }
  }, [bannerAnnouncements, currentBannerIndex, isMobileOrTablet, onAnnouncementClick]);

  const handleMyPageClick = useCallback(() => {
    // 마이페이지 프로필 페이지로 이동
    router.push('/mypage/profile');
  }, [router]);

  const toggleFullscreen = useCallback(() => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen();
    } else {
      document.exitFullscreen();
    }
  }, []);

  const getNotificationColor = (type: string) => {
    switch (type) {
      case 'admin_announcement':
        return 'bg-blue-500';
      case 'new_restaurant':
      case 'new_restaurants_batch':
        return 'bg-green-500';
      case 'submission_approved':
      case 'recommendation_approved':
        return 'bg-emerald-500';
      case 'submission_rejected':
      case 'recommendation_rejected':
        return 'bg-red-500';
      case 'review_approved':
        return 'bg-emerald-500';
      case 'review_rejected':
        return 'bg-red-500';
      case 'user_ranking':
        return 'bg-yellow-500';
      case 'review_like':
        return 'bg-pink-500';
      default:
        return 'bg-muted-foreground';
    }
  };

  const currentBanner = useMemo(() => {
    if (isBannerDismissed) return null;
    return bannerAnnouncements[currentBannerIndex];
  }, [bannerAnnouncements, currentBannerIndex, isBannerDismissed]);

  const handleNotificationClick = (notification: Notification) => {
    markAsRead(notification.id);

    // 리뷰 관련 알림인 경우 마이페이지 리뷰 목록으로 이동
    if (notification.type === 'review_approved' || notification.type === 'review_rejected') {
      const reviewId = notification.data?.reviewId;
      const status = notification.type === 'review_approved' ? 'approved' : 'rejected';

      if (reviewId) {
        router.push(`/mypage/reviews?reviewId=${reviewId}&status=${status}`);
      } else {
        router.push(`/mypage/reviews?status=${status}`);
      }
      return;
    }

    const restaurantId = typeof notification.data?.restaurantId === 'string' ? notification.data.restaurantId : null;
    if (restaurantId) {
      router.push(`/?r=${restaurantId}&z=13`);
      return;
    }

    router.push('/?panel=announcement');
  };

  return (
    <header
      ref={headerRef}
      className="border-b border-border bg-background flex items-center shadow-sm z-[92] relative transition-[opacity,transform,background-color] duration-300 gap-1.5 sm:gap-3 h-12 px-2 md:h-14 md:px-3"
      style={{
        transform: 'translateY(calc(-1 * var(--mobile-sheet-header-offset, 0px)))',
        opacity: 'calc(1 - var(--mobile-sheet-header-progress, 0))',
      }}
    >
      {/* 한지 질감 오버레이 - 다크모드에서 숨김 */}
      <div
        className="absolute inset-0 opacity-30 dark:opacity-0 pointer-events-none transition-opacity"
        style={{ backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noiseFilter'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.65' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noiseFilter)' opacity='0.1'/%3E%3C/svg%3E")` }}
      />

      {/* 전통 문양 테두리 - 다크모드에서 숨김 */}
      <div className="absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-border to-transparent dark:via-border" />

      {/* 좌측: 로고 */}
      {!isMobileBannerOnlyHeader && (
        <Link href="/" className="relative z-10 flex-shrink-0 flex items-center justify-center">
          <NextImage
            src="/logo.png"
            alt="Tzudong Logo"
            width={32}
            height={32}
            className="rounded-lg object-contain"
            priority
          />
        </Link>
      )}

      {/* 좌측: 사이드바 토글 */}
      {!isMobileBannerOnlyHeader && !hideToggleSidebar && shouldShowHeaderIcons && (
        <div className={cn(
          "flex items-center relative z-10 flex-shrink-0 transition-all duration-300",
          isHydrated ? "opacity-100 translate-y-0" : "opacity-0 translate-y-1"
        )}>
          <Button
            variant="ghost"
            size="icon"
            type="button"
            aria-label="사이드바 토글"
            onClick={onToggleSidebar}
            className="h-9 w-9 hover:bg-accent text-foreground font-serif transition-colors"
          >
            <PanelLeft className="h-5 w-5" />
          </Button>
        </div>
      )}



      {/* 중앙: 공지 배너 - 로딩 중 스켈레톤으로 레이아웃 고정 */}
      {shouldShowBannerSkeleton ? (
        <div className={cn(HEADER_BANNER_FRAME_CLASS, "h-7 bg-secondary/30 md:h-8")} aria-hidden />
      ) : currentBanner ? (
        <div
          aria-live="polite"
          role="button"
          tabIndex={0}
          aria-label={currentBanner?.title ? `공지: ${currentBanner.title}` : "공지사항 배너"}
          className={cn(
            HEADER_BANNER_FRAME_CLASS,
            "bg-secondary/50 hover:bg-secondary cursor-pointer group",
            isHydrated ? "opacity-100 translate-y-0" : "opacity-0 translate-y-1"
          )}
          onClick={handleBannerClick}
          onKeyDown={(e) => {
            if (e.target !== e.currentTarget) return;
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              handleBannerClick();
            }
          }}
          onMouseEnter={() => setIsBannerPaused(true)}
          onMouseLeave={() => setIsBannerPaused(false)}
        >
          {bannerAnnouncements.length > 1 && (
            <Button
              variant="ghost"
              size="icon"
              type="button"
              aria-label="이전 공지 보기"
              onClick={handleBannerPrev}
              className="h-5 w-5 p-0 hover:bg-secondary text-muted-foreground flex-shrink-0"
            >
              <ChevronLeft className="h-3 w-3" />
            </Button>
          )}
          <Megaphone className="h-4 w-4 text-red-700 flex-shrink-0" />
          <span className="font-medium truncate group-hover:text-red-800 transition-colors text-foreground flex-1 min-w-0 text-xs md:text-sm">
            {currentBanner.title}
          </span>
          {bannerAnnouncements.length > 1 && (
            <Button
              variant="ghost"
              size="icon"
              type="button"
              aria-label="다음 공지 보기"
              onClick={handleBannerNext}
              className="h-5 w-5 p-0 hover:bg-secondary text-muted-foreground flex-shrink-0"
            >
              <ChevronRight className="h-3 w-3" />
            </Button>
          )}
        </div>
      ) : (
        <div className="flex-1 min-w-0" aria-hidden />
      )}

      {/* 우측: 위젯 및 버튼들 */}
      {!isMobileBannerOnlyHeader && (
        <div className={cn(
          "flex items-center gap-1 sm:gap-2 relative z-10 flex-shrink-0 transition-all duration-300",
          isHydrated ? "opacity-100 translate-y-0" : "opacity-0 translate-y-1"
        )}>
        {/* 랭킹 및 접속자 위젯 - 데스크탑에서만 표시 */}
        <div className={cn(
          "hidden md:flex",
          shouldShowHeaderIcons ? (isHydrated ? "opacity-100" : "opacity-0 pointer-events-none") : "hidden"
        )}>
          {RankingWidget ? <RankingWidget /> : null}
        </div>



        {/* 알림 */}
        {shouldShowNotificationSkeleton && (
          <HeaderActionSkeleton label="알림 로딩 중" />
        )}
        {shouldShowHeaderIcons && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                type="button"
                aria-label={unreadCount > 0 ? `알림, 안 읽은 알림 ${unreadCount > 99 ? "99개 이상" : `${unreadCount}개`}` : "알림"}
                className="h-11 w-11 rounded-xl hover:bg-accent text-foreground relative transition-colors focus-visible:ring-2 focus-visible:ring-primary touch-manipulation"
              >
                <Bell className="h-5 w-5" aria-hidden="true" />
                {unreadCount > 0 && (
                  <Badge
                    variant="destructive"
                    aria-hidden="true"
                    className="absolute -top-1 -right-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-red-800 px-1.5 py-0 text-[10px] font-bold leading-none tabular-nums text-white"
                  >
                    {unreadCount > 99 ? '99+' : unreadCount}
                  </Badge>
                )}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              className="w-[min(calc(100vw-1rem),22rem)] rounded-2xl border-border bg-card p-2 font-serif shadow-primary z-[100]"
            >
              <DropdownMenuLabel className="flex items-start justify-between gap-3 px-1 py-1 text-foreground">
                <div className="min-w-0">
                  <span className="block font-semibold">알림</span>
                  <span className="block text-xs font-normal text-muted-foreground">최근 알림 {notifications.length}개 · 안 읽음 {unreadCount > 99 ? '99+' : unreadCount}</span>
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
                    <CheckCheck className="h-3 w-3 mr-1" aria-hidden="true" />
                    모두 읽음
                  </Button>
                )}
              </DropdownMenuLabel>
              <DropdownMenuSeparator className="my-2 bg-border" />
              <ScrollArea className="h-72 max-h-[min(70vh,28rem)] pr-1">
                {isNotificationsLoading ? (
                  <div role="status" aria-label="알림 목록 로딩 중" className="space-y-3 rounded-xl bg-background/70 p-3">
                    {[0, 1, 2].map((item) => (
                      <div key={item} className="space-y-2">
                        <Skeleton className="h-4 w-3/4 rounded" />
                        <Skeleton className="h-3 w-full rounded" />
                      </div>
                    ))}
                  </div>
                ) : isNotificationsError ? (
                  <div role="status" className="grid min-h-40 place-items-center rounded-xl bg-background/70 p-4 text-center text-sm text-muted-foreground">
                    <div>
                      <Bell className="mx-auto mb-2 h-9 w-9 rounded-full bg-primary/10 p-2 text-primary/70" aria-hidden="true" />
                      <p className="font-medium text-foreground">알림을 불러오지 못했습니다</p>
                      <p className="mt-1 text-xs leading-5">잠시 후 다시 열어 주세요.</p>
                    </div>
                  </div>
                ) : notifications.length === 0 ? (
                  <div className="grid min-h-40 place-items-center rounded-xl bg-background/70 p-4 text-center text-sm text-muted-foreground">
                    <div>
                      <Bell className="mx-auto mb-2 h-9 w-9 rounded-full bg-primary/10 p-2 text-primary/70" aria-hidden="true" />
                      <p className="font-medium text-foreground">새로운 알림이 없습니다</p>
                      <p className="mt-1 text-xs leading-5">리뷰 승인, 제보 처리, 랭킹 소식이 생기면 여기에 표시됩니다.</p>
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
                          !notification.isRead && "bg-primary/5"
                        )}
                        onSelect={() => handleNotificationClick(notification)}
                      >
                        {/* 타입별 컬러 인디케이터 */}
                        <div className={cn(
                          "h-12 w-1.5 shrink-0 rounded-full",
                          getNotificationColor(notification.type)
                        )} />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <p className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
                              {notification.title}
                            </p>
                            {!notification.isRead && (
                              <span className="shrink-0 rounded-full bg-red-800 px-1.5 py-0.5 text-[10px] font-bold leading-none text-white">새 알림</span>
                            )}
                          </div>
                          <p className="text-xs text-muted-foreground truncate">
                            {notification.message}
                          </p>
                          <p className="text-xs text-muted-foreground/70 mt-0.5">
                            {formatDistanceToNow(notification.createdAt, {
                              addSuffix: true,
                              locale: ko
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
        )}

        {/* 북마크 - 드롭다운 */}
        {shouldShowBookmarkSkeleton && (
          <HeaderActionSkeleton label="북마크 로딩 중" />
        )}
        {shouldShowHeaderIcons && (
          <Suspense fallback={<HeaderActionSkeleton label="북마크 로딩 중" />}>
            {HeaderBookmarkMenuButton ? <HeaderBookmarkMenuButton /> : <HeaderActionSkeleton label="북마크 로딩 중" />}
          </Suspense>
        )}

        {/* 전체화면 - 데스크탑에서만 표시 */}
        {shouldShowFullscreenSkeleton && (
          <HeaderActionSkeleton label="전체화면 로딩 중" className="hidden md:block" />
        )}
        {shouldShowHeaderIcons && (
          <Button
            variant="ghost"
            size="icon"
            type="button"
            aria-label="전체화면 토글"
            onClick={toggleFullscreen}
            className="h-11 w-11 hidden md:flex rounded-xl hover:bg-accent text-foreground transition-colors focus-visible:ring-2 focus-visible:ring-primary touch-manipulation"
          >
            <Maximize className="h-5 w-5" aria-hidden="true" />
          </Button>
        )}

        {/* 로그인 상태 */}
        {shouldShowAccountSkeleton && (
          <HeaderActionSkeleton label="사용자 메뉴 로딩 중" />
        )}
        {shouldShowHeaderIcons && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                type="button"
                aria-label="내 계정 메뉴"
                className="h-11 w-11 rounded-xl hover:bg-accent text-foreground transition-colors focus-visible:ring-2 focus-visible:ring-primary touch-manipulation"
              >
                <User className="h-5 w-5" aria-hidden="true" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="bg-card border-border font-serif w-36 z-[100]">
              <DropdownMenuItem onClick={handleMyPageClick} className="text-foreground hover:bg-accent focus:bg-accent py-2 touch-manipulation">
                <User className="mr-2 h-4 w-4" />
                마이페이지
              </DropdownMenuItem>
              {!isAdmin && (
                <DropdownMenuItem onClick={handleInsightMenuClick} className="text-foreground hover:bg-accent focus:bg-accent py-2 touch-manipulation">
                  <BarChart2 className="mr-2 h-4 w-4" />
                  인사이트
                </DropdownMenuItem>
              )}
              {isAdmin && (
                <>
                  <DropdownMenuSeparator className="bg-border my-1" />
                  <DropdownMenuItem onClick={() => router.push('/admin')} className="text-foreground hover:bg-accent focus:bg-accent py-2 touch-manipulation">
                    <PanelLeft className="mr-2 h-4 w-4" />
                    관리자 콘솔
                  </DropdownMenuItem>
                </>
              )}
              <DropdownMenuSeparator className="bg-border my-1" />
              <DropdownMenuItem onClick={onLogout} className="text-foreground hover:bg-accent focus:bg-accent py-2 touch-manipulation">
                <LogOut className="mr-2 h-4 w-4" />
                로그아웃
              </DropdownMenuItem>
              <DropdownMenuSeparator className="bg-border my-1" />
              <div className="px-2 py-1">
                <button
                  type="button"
                  aria-label="사업자 정보 펼치기/접기"
                  onClick={() => setIsBusinessInfoExpanded(!isBusinessInfoExpanded)}
                  className="w-full flex items-center justify-between hover:bg-accent rounded px-1 py-0.5 transition-colors"
                >
                  <span className="text-[10px] text-muted-foreground">{siteConfig.operator.copyrightLabel}</span>
                  {isBusinessInfoExpanded ? (
                    <ChevronUp className="h-3 w-3 text-muted-foreground ml-1" />
                  ) : (
                    <ChevronDown className="h-3 w-3 text-muted-foreground ml-1" />
                  )}
                </button>
                {isBusinessInfoExpanded && (
                  <div className="mt-1 pt-1 border-t border-border text-[9px] text-muted-foreground space-y-0.5 px-1">
                    <p className="font-medium text-foreground">{siteConfig.operator.companyName}</p>
                    <p>대표: {siteConfig.operator.representative}</p>
                    <p>사업자: {siteConfig.operator.businessRegistrationNumber}</p>
                    <p>이메일: {siteConfig.contact.email}</p>
                  </div>
                )}
              </div>
            </DropdownMenuContent>
          </DropdownMenu>
        )}

        {/* 로그인 버튼 */}
        {
          shouldShowLoginButton && (
            <Button
              onClick={onOpenAuth}
              type="button"
              aria-label="로그인"
              className={cn(
                "bg-red-800 hover:bg-red-900 text-white font-serif transition-colors shadow-md",
                "h-8 px-4 text-xs md:h-9 md:px-4 md:text-sm"
              )}
            >
              로그인
            </Button>
          )
        }
      </div>
      )}

      {/* 공지사항 바텀시트 (Portal로 렌더링하여 헤더 transform 영향 제거) */}
      {isHydrated && createPortal(
        <BottomSheet
          isOpen={isAnnouncementSheetOpen}
          onClose={() => {
            setIsAnnouncementSheetOpen(false);
            setSelectedAnnouncement(null);
          }}
          defaultHeight={50}
          minHeight={25}
          maxHeight={100}
          enablePeek
          hideBottomNavWhenOpen
          progressiveHeaderHide
          showBackdrop={false}
          closeOnOutsidePointerDown
          layoutSource="header-announcement-bottom-sheet"
          className="z-[95] p-0"
        >
          <div className="h-full min-h-0 overflow-hidden bg-background font-serif">
            {HeaderAnnouncementPanel ? (
              <HeaderAnnouncementPanel
                key={selectedAnnouncement?.id ?? 'announcement-list'}
                isOpen={isAnnouncementSheetOpen}
                onClose={() => {
                  setIsAnnouncementSheetOpen(false);
                  setSelectedAnnouncement(null);
                }}
                isAdmin={isAdmin}
                initialAnnouncement={selectedAnnouncement}
                isBottomSheet
                adminActionsMode="inline"
              />
            ) : (
              <AnnouncementPanelLoadingFallback
                isAdmin={isAdmin}
                onClose={() => {
                  setIsAnnouncementSheetOpen(false);
                  setSelectedAnnouncement(null);
                }}
              />
            )}
          </div>
        </BottomSheet>,
        document.body
      )}
    </header>
  );
};

// React.memo로 래핑하여 props가 변경되지 않으면 리렌더링 방지
const Header = memo(HeaderComponent);
Header.displayName = "Header";

export default Header;
