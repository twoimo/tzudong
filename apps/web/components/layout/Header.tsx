import { RankingWidget } from "./RankingWidget";
import { PanelLeft, Moon, Sun, Bell, Maximize, User, LogOut, X, CheckCheck, AlignCenter, ClipboardList, MessageSquare, Megaphone, ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useState, useEffect, useCallback, memo } from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  DropdownMenuLabel,
  DropdownMenuGroup,
} from "@/components/ui/dropdown-menu";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { useNotifications } from "@/contexts/NotificationContext";
import { formatDistanceToNow } from "date-fns";
import { ko } from "date-fns/locale";
import { cn } from "@/lib/utils";
import { usePathname, useRouter } from "next/navigation";
import { getBannerAnnouncements, Announcement } from "@/types/announcement";
import { useHydration } from "@/hooks/useHydration";
import { supabase } from "@/integrations/supabase/client";

interface HeaderProps {
  onToggleSidebar: () => void;
  isLoggedIn: boolean;
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

const BANNER_ROTATION_INTERVAL = 5000;

const HeaderComponent = ({ onToggleSidebar, isLoggedIn, onOpenAuth, onLogout, onProfileClick, onMyPageClick, isCenteredLayout = false, onToggleCenteredLayout, isAdmin = false, onAnnouncementClick, hideToggleSidebar = false }: HeaderProps) => {
  const [isHanjiMode, setIsHanjiMode] = useState(false);
  const isHydrated = useHydration();
  const { notifications, unreadCount, markAsRead, markAllAsRead, removeNotification } = useNotifications();
  const pathname = usePathname();
  const router = useRouter();

  // 공지 배너 상태
  const [bannerAnnouncements, setBannerAnnouncements] = useState<Announcement[]>([]);
  const [currentBannerIndex, setCurrentBannerIndex] = useState(0);
  const [isBannerDismissed, setIsBannerDismissed] = useState(false);
  const [isBannerPaused, setIsBannerPaused] = useState(false);

  // 미처리 제보 건수 상태
  const [pendingSubmissionCount, setPendingSubmissionCount] = useState(0);
  // 미처리 리뷰 건수 상태
  const [pendingReviewCount, setPendingReviewCount] = useState(0);

  useEffect(() => {
    const dismissed = sessionStorage.getItem('announcementBannerDismissed');
    if (dismissed) {
      setIsBannerDismissed(true);
    }
    setBannerAnnouncements(getBannerAnnouncements());
  }, []);

  // 미처리 제보 건수 조회
  useEffect(() => {
    if (!isAdmin) return;

    const fetchPendingCount = async () => {
      try {
        const { count, error } = await supabase
          .from('restaurant_submissions')
          .select('*', { count: 'exact', head: true })
          .eq('status', 'pending');

        if (!error && count !== null) {
          setPendingSubmissionCount(count);
        }
      } catch (err) {
        console.error('Failed to fetch pending submission count:', err);
      }
    };

    fetchPendingCount();
    // 1분마다 갱신
    const interval = setInterval(fetchPendingCount, 60000);
    return () => clearInterval(interval);
  }, [isAdmin]);

  // 미처리 리뷰 건수 조회
  useEffect(() => {
    if (!isAdmin) return;

    const fetchPendingReviewCount = async () => {
      try {
        const { count, error } = await supabase
          .from('reviews')
          .select('*', { count: 'exact', head: true })
          .eq('is_verified', false);

        if (!error && count !== null) {
          setPendingReviewCount(count);
        }
      } catch (err) {
        console.error('Failed to fetch pending review count:', err);
      }
    };

    fetchPendingReviewCount();
    // 1분마다 갱신
    const interval = setInterval(fetchPendingReviewCount, 60000);
    return () => clearInterval(interval);
  }, [isAdmin]);

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

  const handleBannerDismiss = (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsBannerDismissed(true);
    sessionStorage.setItem('announcementBannerDismissed', 'true');
  };

  const handleBannerClick = () => {
    const currentAnnouncement = bannerAnnouncements[currentBannerIndex];
    if (currentAnnouncement && onAnnouncementClick) {
      onAnnouncementClick(currentAnnouncement);
    }
  };

  const handleMyPageClick = () => {
    // 마이페이지 프로필 페이지로 이동
    router.push('/mypage/profile');
  };

  const handleAdminSubmissionsClick = () => {
    // /admin/evaluations 페이지로 이동하며 제보 관리 탭 활성화
    router.push('/admin/evaluations?view=submissions');
  };

  const handleAdminReviewsClick = () => {
    // /admin/evaluations 페이지로 이동하며 리뷰 검수 탭 활성화
    router.push('/admin/evaluations?view=submissions&tab=reviews');
  };

  const handleAdminAnnouncementsClick = () => {
    if (pathname === '/') {
      window.dispatchEvent(new CustomEvent('openAdminAnnouncements'));
    } else {
      // 홈으로 이동 후 패널 열기
      window.location.href = '/';
    }
  };

  const toggleTheme = () => {
    // 한지 모드 전환 시 모든 transition 임시 비활성화하여 즉시 적용
    const root = document.documentElement;

    // 모든 transition 비활성화
    const style = document.createElement('style');
    style.textContent = '* { transition: none !important; }';
    document.head.appendChild(style);

    setIsHanjiMode(!isHanjiMode);
    root.classList.toggle("dark");

    // 다음 프레임에서 transition 복구
    requestAnimationFrame(() => {
      document.head.removeChild(style);
    });
  };

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen();
    } else {
      document.exitFullscreen();
    }
  };

  const getNotificationIcon = (type: string) => {
    switch (type) {
      case 'admin_announcement':
        return '📢';
      case 'new_restaurant':
        return '🍽️';
      case 'review_approved':
        return '✅';
      case 'review_rejected':
        return '❌';
      case 'user_ranking':
        return '🏆';
      default:
        return '🔔';
    }
  };

  const getNotificationColor = (type: string) => {
    switch (type) {
      case 'admin_announcement':
        return 'bg-blue-500';
      case 'new_restaurant':
        return 'bg-green-500';
      case 'review_approved':
        return 'bg-emerald-500';
      case 'review_rejected':
        return 'bg-red-500';
      case 'user_ranking':
        return 'bg-yellow-500';
      default:
        return 'bg-gray-500';
    }
  };

  const currentBanner = bannerAnnouncements[currentBannerIndex];

  return (
    <header
      className="h-16 border-b border-stone-800/10 bg-card flex items-center px-4 shadow-sm z-10 relative transition-colors duration-300 gap-4"
    >
      {/* 한지 질감 오버레이 */}
      <div
        className="absolute inset-0 opacity-30 pointer-events-none"
        style={{ backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noiseFilter'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.65' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noiseFilter)' opacity='0.1'/%3E%3C/svg%3E")` }}
      />

      {/* 전통 문양 테두리 */}
      <div className="absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-stone-800/20 to-transparent" />

      {/* 좌측: 사이드바 토글 */}
      {!hideToggleSidebar && (
        <div className="flex items-center relative z-10 flex-shrink-0">
          <Button
            variant="ghost"
            size="icon"
            onClick={onToggleSidebar}
            className="hover:bg-stone-200/50 text-stone-700 font-serif transition-colors"
          >
            <PanelLeft className="h-5 w-5" />
          </Button>
        </div>
      )}

      {/* 중앙: 공지 배너 (최대 너비) */}
      {currentBanner && (
        <div
          className={cn(
            "flex-1 flex items-center gap-2 px-3 py-1 rounded-md bg-secondary/50 hover:bg-secondary cursor-pointer transition-all duration-300 group relative z-10",
            isHydrated ? "opacity-100 translate-y-0" : "opacity-0 translate-y-1"
          )}
          onClick={handleBannerClick}
          onMouseEnter={() => setIsBannerPaused(true)}
          onMouseLeave={() => setIsBannerPaused(false)}
        >
          {bannerAnnouncements.length > 1 && (
            <Button
              variant="ghost"
              size="icon"
              onClick={handleBannerPrev}
              className="h-5 w-5 p-0 hover:bg-secondary text-muted-foreground flex-shrink-0"
            >
              <ChevronLeft className="h-3 w-3" />
            </Button>
          )}
          <Megaphone className="h-4 w-4 text-red-700 flex-shrink-0" />
          <span className="text-sm text-stone-700 font-medium truncate group-hover:text-red-800 transition-colors">
            {currentBanner.title}
          </span>
          {bannerAnnouncements.length > 1 && (
            <Button
              variant="ghost"
              size="icon"
              onClick={handleBannerNext}
              className="h-5 w-5 p-0 hover:bg-secondary text-muted-foreground flex-shrink-0 ml-auto"
            >
              <ChevronRight className="h-3 w-3" />
            </Button>
          )}
        </div>
      )}

      {/* 우측: 위젯 및 버튼들 */}
      <div className={cn(
        "flex items-center gap-2 relative z-10 flex-shrink-0 transition-all duration-300",
        isHydrated ? "opacity-100 translate-y-0" : "opacity-0 translate-y-1"
      )}>
        {/* 랭킹 및 접속자 위젯 */}
        {isHydrated && <RankingWidget />}

        {/* 한지 모드 토글 */}
        <Button
          variant="ghost"
          size="icon"
          onClick={toggleTheme}
          className="hover:bg-stone-200/50 text-stone-700 transition-colors"
          title={isHanjiMode ? "밝은 모드" : "한지 모드"}
        >
          {isHanjiMode ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
        </Button>

        {/* 알림 - hydration 완료 후 렌더링 */}
        {isHydrated && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="hover:bg-stone-200/50 text-stone-700 relative transition-colors">
                <Bell className="h-5 w-5" />
                {unreadCount > 0 && (
                  <Badge
                    variant="destructive"
                    className="absolute -top-1 -right-1 h-5 w-5 flex items-center justify-center p-0 text-xs bg-red-800"
                  >
                    {unreadCount > 99 ? '99+' : unreadCount}
                  </Badge>
                )}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              className="w-80 bg-[#fdfbf7] border-stone-800/10 font-serif"
            >
              <DropdownMenuLabel className="flex items-center justify-between text-stone-900">
                <span>알림</span>
                {unreadCount > 0 && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={markAllAsRead}
                    className="h-6 px-2 text-xs hover:bg-stone-200/50 text-stone-600"
                  >
                    <CheckCheck className="h-3 w-3 mr-1" />
                    모두 읽음
                  </Button>
                )}
              </DropdownMenuLabel>
              <DropdownMenuSeparator className="bg-stone-800/10" />
              <ScrollArea className="h-96">
                {notifications.length === 0 ? (
                  <div className="p-4 text-center text-sm text-stone-500">
                    새로운 알림이 없습니다
                  </div>
                ) : (
                  <DropdownMenuGroup>
                    {notifications.map((notification) => (
                      <DropdownMenuItem
                        key={notification.id}
                        className={`flex-col items-start p-4 cursor-pointer ${!notification.isRead ? 'bg-stone-100/50' : ''
                          }`}
                        onClick={() => markAsRead(notification.id)}
                      >
                        <div className="flex items-start justify-between w-full mb-2">
                          <div className="flex items-center gap-2">
                            <span className="text-lg">{getNotificationIcon(notification.type)}</span>
                            <span className="font-medium text-sm text-stone-900">{notification.title}</span>
                          </div>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-6 w-6 p-0 opacity-50 hover:opacity-100"
                            onClick={(e) => {
                              e.stopPropagation();
                              removeNotification(notification.id);
                            }}
                          >
                            <X className="h-3 w-3" />
                          </Button>
                        </div>
                        <p className="text-sm text-stone-600 mb-2">{notification.message}</p>
                        <div className="flex items-center justify-between w-full">
                          <span className="text-xs text-stone-500">
                            {formatDistanceToNow(notification.createdAt, {
                              addSuffix: true,
                              locale: ko
                            })}
                          </span>
                          {!notification.isRead && (
                            <div className={`w-2 h-2 rounded-full ${getNotificationColor(notification.type)}`} />
                          )}
                        </div>
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuGroup>
                )}
              </ScrollArea>
            </DropdownMenuContent>
          </DropdownMenu>
        )}

        {/* Centered Layout 버튼 */}
        {onToggleCenteredLayout && (
          <Button
            variant="ghost"
            size="icon"
            className={cn(
              "hover:bg-stone-200/50 text-stone-700 transition-colors",
              isCenteredLayout && "bg-stone-200/50"
            )}
            onClick={onToggleCenteredLayout}
          >
            <AlignCenter className="h-5 w-5" />
          </Button>
        )}

        {/* 전체화면 */}
        <Button
          variant="ghost"
          size="icon"
          onClick={toggleFullscreen}
          className="hover:bg-stone-200/50 text-stone-700 transition-colors"
        >
          <Maximize className="h-5 w-5" />
        </Button>

        {/* 로그인 상태 - hydration 완료 후에만 렌더링 */}
        {isHydrated && isLoggedIn && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="hover:bg-stone-200/50 text-stone-700 transition-colors">
                <User className="h-5 w-5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="bg-[#fdfbf7] border-stone-800/10 font-serif">
              <DropdownMenuItem onClick={handleMyPageClick} className="text-stone-900 hover:bg-stone-200/50">
                <User className="mr-2 h-4 w-4" />
                마이페이지
              </DropdownMenuItem>
              {isAdmin && (
                <>
                  <DropdownMenuSeparator className="bg-stone-800/10" />
                  <DropdownMenuItem onClick={handleAdminAnnouncementsClick} className="text-stone-900 hover:bg-stone-200/50">
                    <Megaphone className="mr-2 h-4 w-4" />
                    공지사항
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={handleAdminSubmissionsClick} className="text-stone-900 hover:bg-stone-200/50">
                    <ClipboardList className="mr-2 h-4 w-4" />
                    제보관리
                    {pendingSubmissionCount > 0 && (
                      <Badge
                        variant="destructive"
                        className="ml-2 h-5 min-w-[20px] flex items-center justify-center p-0 px-1.5 text-xs bg-red-800"
                      >
                        {pendingSubmissionCount > 99 ? '99+' : pendingSubmissionCount}
                      </Badge>
                    )}
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={handleAdminReviewsClick} className="text-stone-900 hover:bg-stone-200/50">
                    <MessageSquare className="mr-2 h-4 w-4" />
                    리뷰관리
                    {pendingReviewCount > 0 && (
                      <Badge
                        variant="destructive"
                        className="ml-2 h-5 min-w-[20px] flex items-center justify-center p-0 px-1.5 text-xs bg-red-800"
                      >
                        {pendingReviewCount > 99 ? '99+' : pendingReviewCount}
                      </Badge>
                    )}
                  </DropdownMenuItem>
                </>
              )}
              <DropdownMenuSeparator className="bg-stone-800/10" />
              <DropdownMenuItem onClick={onLogout} className="text-stone-900 hover:bg-stone-200/50">
                <LogOut className="mr-2 h-4 w-4" />
                로그아웃
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}

        {/* 로그인 버튼 - hydration 완료 후에만 렌더링 */}
        {isHydrated && !isLoggedIn && (
          <Button
            onClick={onOpenAuth}
            className="ml-2 bg-red-800 hover:bg-red-900 text-white font-serif transition-colors shadow-md"
          >
            로그인
          </Button>
        )}
      </div>
    </header>
  );
};

// React.memo로 래핑하여 props가 변경되지 않으면 리렌더링 방지
const Header = memo(HeaderComponent);
Header.displayName = "Header";

export default Header;
