import { RankingWidget } from "./RankingWidget";
import { PanelLeft, Moon, Sun, Bell, BellOff, Maximize, User, LogOut, X, CheckCheck, ClipboardList, MessageSquare, Megaphone, ChevronLeft, ChevronRight, Bookmark, Settings, Eye, EyeOff, Edit2, Trash2, Image, ChevronDown, ChevronUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useState, useEffect, useCallback, memo, useMemo } from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  DropdownMenuLabel,
  DropdownMenuGroup,
} from "@/components/ui/dropdown-menu";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { useNotifications } from "@/contexts/NotificationContext";
import { formatDistanceToNow } from "date-fns";
import { ko } from "date-fns/locale";
import { cn } from "@/lib/utils";
import { usePathname, useRouter } from "next/navigation";
import { getBannerAnnouncements, getActiveAnnouncements, Announcement } from "@/types/announcement";
import { useHydration } from "@/hooks/useHydration";
import { supabase } from "@/integrations/supabase/client";
import { useBookmarks } from "@/hooks/use-bookmarks";
import { useDeviceType } from "@/hooks/useDeviceType";

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

const BANNER_ROTATION_INTERVAL = 5000;

const HeaderComponent = ({ onToggleSidebar, isLoggedIn, isAuthLoading = true, onOpenAuth, onLogout, onProfileClick, onMyPageClick, isCenteredLayout = false, onToggleCenteredLayout, isAdmin = false, onAnnouncementClick, hideToggleSidebar = false }: HeaderProps) => {
  const [isHanjiMode, setIsHanjiMode] = useState(false);
  const isHydrated = useHydration();
  const { isMobileOrTablet } = useDeviceType();
  const { notifications, unreadCount, markAsRead, markAllAsRead, removeNotification } = useNotifications();
  const pathname = usePathname();
  const router = useRouter();

  // 공지 배너 상태
  const [bannerAnnouncements, setBannerAnnouncements] = useState<Announcement[]>([]);
  const [currentBannerIndex, setCurrentBannerIndex] = useState(0);
  const [isBannerDismissed, setIsBannerDismissed] = useState(false);
  const [isBannerPaused, setIsBannerPaused] = useState(false);

  // 공지사항 바텀시트 상태
  const [isAnnouncementSheetOpen, setIsAnnouncementSheetOpen] = useState(false);
  const [selectedAnnouncement, setSelectedAnnouncement] = useState<Announcement | null>(null);
  const [announcementViewMode, setAnnouncementViewMode] = useState<'list' | 'detail'>('list');
  const [allAnnouncements, setAllAnnouncements] = useState<Announcement[]>([]);
  const [announcementPage, setAnnouncementPage] = useState(1);
  const ANNOUNCEMENTS_PER_PAGE = 3;

  // 미처리 제보 건수 상태
  const [pendingSubmissionCount, setPendingSubmissionCount] = useState(0);
  // 미처리 리뷰 건수 상태
  const [pendingReviewCount, setPendingReviewCount] = useState(0);
  // 사업자 정보 펼치기 상태
  const [isBusinessInfoExpanded, setIsBusinessInfoExpanded] = useState(false);

  // 북마크 데이터
  const { data: bookmarksData = [] } = useBookmarks();

  // 성능 최적화: 조건부 렌더링 로직 메모이제이션
  const shouldShowAuthUI = useMemo(() => isHydrated && !isAuthLoading, [isHydrated, isAuthLoading]);

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

  const handleBannerDismiss = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setIsBannerDismissed(true);
    sessionStorage.setItem('announcementBannerDismissed', 'true');
  }, []);

  const handleBannerClick = useCallback(() => {
    const currentAnnouncement = bannerAnnouncements[currentBannerIndex];
    if (currentAnnouncement) {
      if (isMobileOrTablet) {
        // 모바일/태블릿: 바텀시트로 상세 뷰 표시
        // 뒤로가기를 위해 전체 공지사항 리스트도 로드
        const announcements = getActiveAnnouncements();
        setAllAnnouncements(announcements);
        setAnnouncementPage(1);
        setSelectedAnnouncement(currentAnnouncement);
        setAnnouncementViewMode('detail');
        setIsAnnouncementSheetOpen(true);
      } else {
        // 데스크탑: 우측 패널로 공지사항 열기
        if (onAnnouncementClick) {
          onAnnouncementClick(currentAnnouncement);
        }
      }
    }
  }, [bannerAnnouncements, currentBannerIndex, isMobileOrTablet, onAnnouncementClick]);

  const handleAnnouncementListClick = useCallback(() => {
    if (isMobileOrTablet) {
      // 모바일/태블릿: 바텀시트로 공지사항 리스트 표시
      const announcements = getActiveAnnouncements();
      console.log('Loaded announcements:', announcements);
      setAllAnnouncements(announcements);
      setAnnouncementPage(1);
      setAnnouncementViewMode('list');
      setIsAnnouncementSheetOpen(true);
    } else {
      // 데스크탑: 기존 우측 패널로 공지사항 열기
      handleAdminAnnouncementsClick();
    }
  }, [isMobileOrTablet]);

  const handleDeleteAnnouncement = useCallback((id: string) => {
    if (confirm('정말 이 공지사항을 삭제하시겠습니까?')) {
      setAllAnnouncements(prev => prev.filter(a => a.id !== id));
      setAnnouncementViewMode('list');
      // TODO: 실제 삭제 API 호출
    }
  }, []);

  const handleToggleAnnouncementActive = useCallback((id: string) => {
    setAllAnnouncements(prev =>
      prev.map(a =>
        a.id === id ? { ...a, isActive: !a.isActive } : a
      )
    );
    setSelectedAnnouncement(prev => prev?.id === id ? { ...prev, isActive: !prev.isActive } : prev);
    // TODO: 실제 상태 변경 API 호출
  }, []);

  const handleToggleAnnouncementBanner = useCallback((id: string) => {
    setAllAnnouncements(prev =>
      prev.map(a =>
        a.id === id ? { ...a, showOnBanner: !a.showOnBanner } : a
      )
    );
    setSelectedAnnouncement(prev => prev?.id === id ? { ...prev, showOnBanner: !prev.showOnBanner } : prev);
    // TODO: 실제 배너 상태 변경 API 호출
  }, []);

  const handleMyPageClick = useCallback(() => {
    // 마이페이지 프로필 페이지로 이동
    router.push('/mypage/profile');
  }, [router]);

  const handleAdminSubmissionsClick = useCallback(() => {
    // /admin/evaluations 페이지로 이동하며 <제보 관리 탭 활성화
    router.push('/admin/evaluations?view=submissions');
  }, [router]);

  const handleAdminReviewsClick = useCallback(() => {
    // /admin/evaluations 페이지로 이동하며 리뷰 검수 탭 활성화
    router.push('/admin/evaluations?view=submissions&tab=reviews');
  }, [router]);

  const handleAdminAnnouncementsClick = useCallback(() => {
    if (pathname === '/') {
      window.dispatchEvent(new CustomEvent('openAdminAnnouncements'));
    } else {
      // 홈으로 이동 후 패널 열기
      window.location.href = '/';
    }
  }, [pathname]);

  const handleAdminBannersClick = useCallback(() => {
    router.push('/admin/banners');
  }, [router]);

  const toggleTheme = useCallback(() => {
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
  }, [isHanjiMode]);

  const toggleFullscreen = useCallback(() => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen();
    } else {
      document.exitFullscreen();
    }
  }, []);

  const getNotificationIcon = (type: string) => {
    switch (type) {
      case 'admin_announcement':
        return '📢';
      case 'new_restaurant':
      case 'new_restaurants_batch':
        return '🍽️';
      case 'submission_approved':
        return '📝✅';
      case 'submission_rejected':
        return '📝❌';
      case 'review_approved':
        return '✅';
      case 'review_rejected':
        return '❌';
      case 'recommendation_approved':
        return '💖✅';
      case 'recommendation_rejected':
        return '💖❌';
      case 'user_ranking':
        return '🏆';
      case 'review_like':
        return '❤️';
      default:
        return '🔔';
    }
  };

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
        return 'bg-gray-500';
    }
  };

  const currentBanner = useMemo(() => bannerAnnouncements[currentBannerIndex], [bannerAnnouncements, currentBannerIndex]);

  return (
    <header
      className="border-b border-stone-800/10 bg-card flex items-center shadow-sm z-10 relative transition-colors duration-300 gap-2 sm:gap-4 h-14 px-2 md:h-16 md:px-4"
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
        <div className={cn(
          "flex items-center relative z-10 flex-shrink-0 transition-all duration-300",
          isHydrated ? "opacity-100 translate-y-0" : "opacity-0 translate-y-1"
        )}>
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

      {/* 중앙: 공지 배너 - 남은 공간 최대 활용, 내용 길이와 무관하게 고정 */}
      {currentBanner && (
        <div
          className={cn(
            "flex items-center gap-2 px-3 py-1 rounded-md bg-secondary/50 hover:bg-secondary cursor-pointer transition-all duration-300 group relative z-10",
            // 모바일/데스크탑 모두 flex-1로 남은 공간 활용
            "flex-1 min-w-0",
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
          <span className="font-medium truncate group-hover:text-red-800 transition-colors text-stone-700 flex-1 min-w-0 text-xs md:text-sm">
            {currentBanner.title}
          </span>
          {bannerAnnouncements.length > 1 && (
            <Button
              variant="ghost"
              size="icon"
              onClick={handleBannerNext}
              className="h-5 w-5 p-0 hover:bg-secondary text-muted-foreground flex-shrink-0"
            >
              <ChevronRight className="h-3 w-3" />
            </Button>
          )}
        </div>
      )}

      {/* 우측: 위젯 및 버튼들 */}
      <div className={cn(
        "flex items-center gap-1 sm:gap-2 relative z-10 flex-shrink-0 transition-all duration-300",
        isHydrated ? "opacity-100 translate-y-0" : "opacity-0 translate-y-1"
      )}>
        {/* 랭킹 및 접속자 위젯 - 데스크탑에서만 표시 */}
        <div className={cn(
          "hidden md:flex",
          isHydrated ? "opacity-100" : "opacity-0 pointer-events-none"
        )}>
          <RankingWidget />
        </div>

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

        {/* 알림 */}
        {shouldShowAuthUI && (
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
              <ScrollArea className="h-64">
                {notifications.length === 0 ? (
                  <div className="p-4 text-center text-sm text-stone-500">
                    새로운 알림이 없습니다
                  </div>
                ) : (
                  <DropdownMenuGroup>
                    {notifications.map((notification) => (
                      <DropdownMenuItem
                        key={notification.id}
                        className={cn(
                          "flex items-center gap-2 p-3 cursor-pointer hover:bg-stone-100",
                          !notification.isRead && "bg-stone-100/50"
                        )}
                        onClick={() => markAsRead(notification.id)}
                      >
                        {/* 타입별 컬러 인디케이터 */}
                        <div className={cn(
                          "w-1 h-10 rounded-full flex-shrink-0",
                          getNotificationColor(notification.type)
                        )} />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-stone-900 truncate">
                            {notification.title}
                          </p>
                          <p className="text-xs text-stone-500 truncate">
                            {notification.message}
                          </p>
                          <p className="text-xs text-stone-400 mt-0.5">
                            {formatDistanceToNow(notification.createdAt, {
                              addSuffix: true,
                              locale: ko
                            })}
                          </p>
                        </div>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-6 w-6 p-0 opacity-50 hover:opacity-100 flex-shrink-0"
                          onClick={(e) => {
                            e.stopPropagation();
                            removeNotification(notification.id);
                          }}
                        >
                          <X className="h-3 w-3" />
                        </Button>
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuGroup>
                )}
              </ScrollArea>
            </DropdownMenuContent>
          </DropdownMenu>
        )}

        {/* 북마크 - 드롭다운 */}
        {isLoggedIn && shouldShowAuthUI && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="hover:bg-stone-200/50 text-stone-700 relative transition-colors">
                <Bookmark className="h-5 w-5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              className="w-72 bg-[#fdfbf7] border-stone-800/10 font-serif"
            >
              <DropdownMenuLabel className="flex items-center justify-between text-stone-900">
                <span>북마크</span>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => router.push('/mypage/bookmarks')}
                  className="h-6 w-6 hover:bg-stone-200/50 text-stone-600"
                >
                  <Settings className="h-3 w-3" />
                </Button>
              </DropdownMenuLabel>
              <DropdownMenuSeparator className="bg-stone-800/10" />
              <ScrollArea className="h-64">
                {bookmarksData.length === 0 ? (
                  <div className="p-4 text-center text-sm text-stone-500">
                    북마크한 맛집이 없습니다
                  </div>
                ) : (
                  <DropdownMenuGroup>
                    {bookmarksData.slice(0, 5).map((bookmark) => (
                      <DropdownMenuItem
                        key={bookmark.id}
                        className="flex items-center gap-2 p-3 cursor-pointer hover:bg-stone-100"
                        onClick={() => {
                          // 이미 홈페이지면 커스텀 이벤트 발생, 아니면 URL로 이동
                          if (pathname === '/') {
                            window.dispatchEvent(new CustomEvent('selectBookmarkRestaurant', { detail: bookmark.restaurant_id }));
                          } else {
                            router.push(`/?r=${bookmark.restaurant_id}`);
                          }
                        }}
                      >
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-stone-900 truncate">
                            {bookmark.restaurant.name}
                          </p>
                          <p className="text-xs text-stone-500 truncate">
                            {bookmark.restaurant.road_address || bookmark.restaurant.jibun_address || '주소 없음'}
                          </p>
                        </div>
                        {bookmark.restaurant.category?.[0] && (
                          <Badge variant="secondary" className="text-[10px] shrink-0">
                            {bookmark.restaurant.category[0]}
                          </Badge>
                        )}
                      </DropdownMenuItem>
                    ))}
                    {bookmarksData.length > 5 && (
                      <div className="p-2 text-center text-xs text-stone-500">
                        +{bookmarksData.length - 5}개 더
                      </div>
                    )}
                  </DropdownMenuGroup>
                )}
              </ScrollArea>
            </DropdownMenuContent>
          </DropdownMenu>
        )}

        {/* 전체화면 - 데스크탑에서만 표시 */}
        <Button
          variant="ghost"
          size="icon"
          onClick={toggleFullscreen}
          className="hidden md:flex hover:bg-stone-200/50 text-stone-700 transition-colors"
        >
          <Maximize className="h-5 w-5" />
        </Button>

        {/* 로그인 상태 */}
        {isLoggedIn && shouldShowAuthUI && (
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
              <DropdownMenuSeparator className="bg-stone-800/10" />
              <DropdownMenuItem onClick={handleAnnouncementListClick} className="text-stone-900 hover:bg-stone-200/50">
                <Megaphone className="mr-2 h-4 w-4" />
                공지사항
              </DropdownMenuItem>
              {isAdmin && (
                <>
                  <DropdownMenuSeparator className="bg-stone-800/10" />
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
                  <DropdownMenuItem onClick={handleAdminBannersClick} className="text-stone-900 hover:bg-stone-200/50">
                    <Image className="mr-2 h-4 w-4" />
                    배너관리
                  </DropdownMenuItem>
                </>
              )}
              <DropdownMenuSeparator className="bg-stone-800/10" />
              <DropdownMenuItem onClick={onLogout} className="text-stone-900 hover:bg-stone-200/50">
                <LogOut className="mr-2 h-4 w-4" />
                로그아웃
              </DropdownMenuItem>
              <DropdownMenuSeparator className="bg-stone-800/10" />
              <div className="px-2 py-1">
                <button
                  onClick={() => setIsBusinessInfoExpanded(!isBusinessInfoExpanded)}
                  className="w-full flex items-center justify-between hover:bg-stone-100 rounded px-1.5 py-1 transition-colors"
                >
                  <div className="text-[10px] text-stone-400 flex-1">
                    <p>쯔동여지도 v2.0.0</p>
                    <p className="text-stone-300">© 2026 타이니번 데이터랩</p>
                  </div>
                  {isBusinessInfoExpanded ? (
                    <ChevronUp className="h-3 w-3 text-stone-400 flex-shrink-0 ml-1" />
                  ) : (
                    <ChevronDown className="h-3 w-3 text-stone-400 flex-shrink-0 ml-1" />
                  )}
                </button>
                {isBusinessInfoExpanded && (
                  <div className="mt-1.5 pt-1.5 border-t border-stone-200 text-[10px] text-stone-500 space-y-0.5 px-1.5">
                    <p className="font-semibold text-stone-600">타이니번 데이터랩</p>
                    <p>대표: 최연우</p>
                    <p>사업자등록번호: 601-09-04613</p>
                    <p>이메일: twoimo@dgu.ac.kr</p>
                  </div>
                )}
              </div>
            </DropdownMenuContent>
          </DropdownMenu>
        )}

        {/* 로그인 버튼 */}
        {
          !isLoggedIn && (
            <Button
              onClick={onOpenAuth}
              className={cn(
                "bg-red-800 hover:bg-red-900 text-white font-serif transition-colors shadow-md",
                "h-8 px-5 text-xs ml-1 md:h-10 md:px-4 md:text-sm md:ml-2",
                shouldShowAuthUI ? "opacity-100" : "opacity-0 pointer-events-none"
              )}
            >
              로그인
            </Button>
          )
        }
      </div >

      {/* 공지사항 바텀시트 */}
      < Sheet open={isAnnouncementSheetOpen} onOpenChange={setIsAnnouncementSheetOpen} >
        <SheetContent side="bottom" className="bg-[#fdfbf7] border-stone-800/10 font-serif max-h-[80vh] flex flex-col">
          <SheetHeader className="flex-shrink-0">
            <div className="flex items-center gap-2">
              {announcementViewMode === 'detail' && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setAnnouncementViewMode('list')}
                  className="p-0 h-auto hover:bg-transparent"
                >
                  <ChevronLeft className="h-5 w-5 text-stone-700" />
                </Button>
              )}
              <div className="flex-1 min-w-0">
                <SheetTitle className="text-stone-900 flex items-center gap-2">
                  <Megaphone className="h-5 w-5 text-red-700 flex-shrink-0" />
                  <span className="truncate">{announcementViewMode === 'list' ? '공지사항' : selectedAnnouncement?.title}</span>
                  {announcementViewMode === 'detail' && selectedAnnouncement?.createdAt && (
                    <span className="text-xs text-stone-500 font-normal whitespace-nowrap flex-shrink-0">
                      · {formatDistanceToNow(new Date(selectedAnnouncement.createdAt), {
                        addSuffix: true,
                        locale: ko
                      })}
                    </span>
                  )}
                </SheetTitle>
              </div>
            </div>
          </SheetHeader>
          <div className="flex-1 overflow-hidden mt-4">
            {announcementViewMode === 'list' ? (
              <div className="h-full flex flex-col">
                <ScrollArea className="flex-1 pr-4">
                  <div className="space-y-3">
                    {(() => {
                      const startIdx = (announcementPage - 1) * ANNOUNCEMENTS_PER_PAGE;
                      const endIdx = startIdx + ANNOUNCEMENTS_PER_PAGE;
                      const paginatedAnnouncements = allAnnouncements.slice(startIdx, endIdx);
                      const totalPages = Math.ceil(allAnnouncements.length / ANNOUNCEMENTS_PER_PAGE);

                      if (allAnnouncements.length === 0) {
                        return (
                          <div className="text-center py-12 text-stone-500">
                            <Megaphone className="h-12 w-12 mx-auto mb-3 opacity-30" />
                            <p>현재 공지사항이 없습니다</p>
                          </div>
                        );
                      }

                      return (
                        <>
                          {paginatedAnnouncements.map((announcement) => (
                            <div
                              key={announcement.id}
                              className="p-4 rounded-lg border border-stone-200 hover:bg-stone-100 cursor-pointer transition-colors"
                              onClick={() => {
                                setSelectedAnnouncement(announcement);
                                setAnnouncementViewMode('detail');
                              }}
                            >
                              <h4 className="font-semibold text-stone-900 mb-1">{announcement.title}</h4>
                              <p className="text-sm text-stone-600 line-clamp-2 mb-2">{announcement.content}</p>
                              <div className="text-xs text-stone-500">
                                {formatDistanceToNow(new Date(announcement.createdAt), {
                                  addSuffix: true,
                                  locale: ko
                                })}
                              </div>
                            </div>
                          ))}
                        </>
                      );
                    })()}
                  </div>
                </ScrollArea>

                {/* 페이지네이션 */}
                {allAnnouncements.length > ANNOUNCEMENTS_PER_PAGE && (
                  <div className="flex items-center justify-center gap-2 pt-3 border-t border-stone-200">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setAnnouncementPage(p => Math.max(1, p - 1))}
                      disabled={announcementPage === 1}
                      className="h-8"
                    >
                      <ChevronLeft className="h-4 w-4" />
                    </Button>
                    <span className="text-sm text-stone-600 px-2">
                      {announcementPage} / {Math.ceil(allAnnouncements.length / ANNOUNCEMENTS_PER_PAGE)}
                    </span>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setAnnouncementPage(p => Math.min(Math.ceil(allAnnouncements.length / ANNOUNCEMENTS_PER_PAGE), p + 1))}
                      disabled={announcementPage === Math.ceil(allAnnouncements.length / ANNOUNCEMENTS_PER_PAGE)}
                      className="h-8"
                    >
                      <ChevronRight className="h-4 w-4" />
                    </Button>
                  </div>
                )}
              </div>
            ) : (
              <div className="h-full flex flex-col">
                <ScrollArea className="flex-1 pr-4">
                  <div className="text-stone-700 text-sm whitespace-pre-wrap leading-relaxed">
                    {selectedAnnouncement?.content}
                  </div>
                </ScrollArea>

                {/* 관리자 제어 버튼 */}
                {isAdmin && selectedAnnouncement && (
                  <div className="flex-shrink-0 pt-4 border-t border-stone-200 mt-4">
                    <div className="grid grid-cols-2 gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleToggleAnnouncementActive(selectedAnnouncement.id)}
                        className="gap-1 text-xs"
                      >
                        {selectedAnnouncement.isActive ? (
                          <>
                            <EyeOff className="h-3 w-3" />
                            비활성화
                          </>
                        ) : (
                          <>
                            <Eye className="h-3 w-3" />
                            활성화
                          </>
                        )}
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleToggleAnnouncementBanner(selectedAnnouncement.id)}
                        className={`gap-1 text-xs ${selectedAnnouncement.showOnBanner ? 'text-orange-600' : ''}`}
                      >
                        {selectedAnnouncement.showOnBanner ? (
                          <>
                            <BellOff className="h-3 w-3" />
                            배너해제
                          </>
                        ) : (
                          <>
                            <Bell className="h-3 w-3" />
                            배너노출
                          </>
                        )}
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleDeleteAnnouncement(selectedAnnouncement.id)}
                        className="gap-1 text-xs text-destructive hover:text-destructive col-span-2"
                      >
                        <Trash2 className="h-3 w-3" />
                        삭제
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </SheetContent>
      </Sheet >
    </header >
  );
};

// React.memo로 래핑하여 props가 변경되지 않으면 리렌더링 방지
const Header = memo(HeaderComponent);
Header.displayName = "Header";

export default Header;
