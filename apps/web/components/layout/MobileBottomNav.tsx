'use client';

import { memo, useCallback, useMemo, useRef, useEffect, useTransition, type CSSProperties } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { Home, MessageSquareText, Stamp, Trophy, User } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAuth } from '@/contexts/AuthContextBase';
import { AUTH_NAV_ROUTES } from '@/components/layout/navigation-routes';
import { updateMobileBottomNavHeight } from '@/lib/mobile-sheet-layout';
import { requestAuthUi } from '@/lib/auth-ui-events';

interface NavItem {
    icon: typeof Home;
    label: string;
    path: string;
    requiresAuth?: boolean;
    testId: string;
}

// [OPTIMIZATION] 상수를 컴포넌트 외부로 이동하여 재생성 방지
const NAV_ITEMS: NavItem[] = [
    { icon: Home, label: '홈', path: '/', testId: 'home' },
    { icon: MessageSquareText, label: '리뷰', path: '/feed', testId: 'feed' },
    { icon: Stamp, label: '도장', path: '/stamp', testId: 'stamp' },
    { icon: Trophy, label: '랭킹', path: '/leaderboard', testId: 'leaderboard' },
    { icon: User, label: 'MY', path: '/mypage/profile', testId: 'my', requiresAuth: true },
];
const MYPAGE_SUB_ROUTES = AUTH_NAV_ROUTES.filter((route) => route !== '/mypage/profile');
const isAuthNavRoute = (path: string) => AUTH_NAV_ROUTES.some((route) => route === path);
const isProtectedNavItem = (item: NavItem) => item.requiresAuth === true || isAuthNavRoute(item.path);
const isMobileNavItemActive = (pathname: string | null, item: NavItem) => {
    if (item.path === '/') return pathname === '/';
    if (item.path === '/mypage/profile') {
        return pathname?.startsWith('/mypage') === true;
    }

    return pathname === item.path;
};
type IdleCallbackHandle = number;
const HOME_NAV_PREFETCH_IDLE_TIMEOUT_MS = 2500;
const MOBILE_BOTTOM_NAV_BUTTON_STYLE: CSSProperties = {
    minHeight: 60,
    paddingTop: 10,
    paddingRight: 4,
    paddingBottom: 10,
    paddingLeft: 4,
};

function runHomeNavPrefetchWhenIdle(callback: () => void): () => void {
    const idleWindow = window as Window & {
        requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => IdleCallbackHandle;
        cancelIdleCallback?: (id: IdleCallbackHandle) => void;
    };

    if (idleWindow.requestIdleCallback && idleWindow.cancelIdleCallback) {
        const handle = idleWindow.requestIdleCallback(callback, { timeout: HOME_NAV_PREFETCH_IDLE_TIMEOUT_MS });
        return () => idleWindow.cancelIdleCallback?.(handle);
    }

    const timer = window.setTimeout(callback, HOME_NAV_PREFETCH_IDLE_TIMEOUT_MS);
    return () => window.clearTimeout(timer);
}

interface MobileBottomNavProps {
    className?: string;
    style?: CSSProperties;
}

/**
 * 모바일/태블릿용 하단 네비게이션바 컴포넌트
 * [OPTIMIZATION] useCallback으로 이벤트 핸들러 메모이제이션
 */
function MobileBottomNavComponent({ className, style }: MobileBottomNavProps) {
    const pathname = usePathname();
    const router = useRouter();
    const navRef = useRef<HTMLElement>(null);
    const { user } = useAuth();
    const [, startTransition] = useTransition();

    const prefetchRoute = useCallback((path: string) => {
        if (process.env.NODE_ENV === 'development') {
            return;
        }

        try {
            router.prefetch(path);
        } catch {
            // Prefetch failure should not block navigation.
        }
    }, [router]);

    // [PERF] 홈 첫 화면에서는 Lighthouse/CWV 측정 창 이후에만 네비게이션 워밍
    useEffect(() => {
        const prefetchNavigationTargets = () => {
            NAV_ITEMS.forEach(({ path }) => prefetchRoute(path));

            if (user?.id) {
                AUTH_NAV_ROUTES.forEach((path) => prefetchRoute(path));
            }
        };

        if (pathname === '/') {
            return runHomeNavPrefetchWhenIdle(prefetchNavigationTargets);
        }

        prefetchNavigationTargets();
    }, [pathname, prefetchRoute, user?.id]);

    const handleNavIntent = useCallback((item: NavItem, isActive: boolean) => {
        if (isActive) {
            return;
        }

        prefetchRoute(item.path);

        if (isProtectedNavItem(item) && user?.id) {
            MYPAGE_SUB_ROUTES.forEach((subPath) => prefetchRoute(subPath));
        }
    }, [prefetchRoute, user?.id]);

    // [OPTIMIZATION] startTransition으로 UI 블로킹 방지
    const handleNavClick = useCallback((item: NavItem) => {
        if (isProtectedNavItem(item) && !user?.id) {
            requestAuthUi({
                source: 'mobile-bottom-nav-my',
                route: pathname ?? undefined,
                reason: 'mypage',
            });
            return;
        }

        prefetchRoute(item.path);
        startTransition(() => {
            router.push(item.path);
        });
    }, [pathname, prefetchRoute, router, startTransition, user?.id]);

    // [OPTIMIZATION] 현재 경로에 따른 활성 상태 계산을 useMemo로 캐싱
    const activeStates = useMemo(() => {
        return NAV_ITEMS.map(item => ({
            path: item.path,
            isActive: isMobileNavItemActive(pathname, item),
        }));
    }, [pathname]);

    // [브라우저 호환성] ResizeObserver로 실제 높이 측정 및 CSS 변수 설정
    useEffect(() => {
        if (!navRef.current) return;

        const updateNavHeight = () => {
            if (navRef.current) {
                const height = navRef.current.offsetHeight;
                updateMobileBottomNavHeight(height);
            }
        };

        // 초기 높이 설정
        updateNavHeight();

        // ResizeObserver로 safe-area 변화 감지 (브라우저 주소창 숨김/표시 등)
        const resizeObserver = new ResizeObserver(updateNavHeight);
        resizeObserver.observe(navRef.current);

        return () => {
            resizeObserver.disconnect();
        };
    }, []);

    return (
        <nav
            ref={navRef}
            aria-label="주요 탐색"
            data-testid="bottom-nav"
            style={{ gridTemplateColumns: `repeat(${NAV_ITEMS.length}, minmax(0, 1fr))`, ...style }}
            className={cn(
                // 기본 스타일 및 고정 위치
                'mobile-bottom-nav',
                'fixed bottom-0 left-0 right-0 z-50',
                'font-sans',
                // 배경 및 테두리
                'bg-background/95 backdrop-blur-md border-t border-border',
                // 그리드 레이아웃
                'grid',
                // iOS safe area 지원
                'pb-[env(safe-area-inset-bottom)]',
                // 그림자
                'shadow-lg shadow-black/5',
                // [OPTIMIZATION] GPU 가속
                'transform-gpu',
                className
            )}
        >
            {NAV_ITEMS.map((item, index) => {
                const { isActive } = activeStates[index];
                const Icon = item.icon;

                return (
                    <button
                        key={item.path}
                        data-testid={`bottom-nav-${item.testId}`}
                        type="button"
                        aria-label={`${item.label} 페이지로 이동`}
                        aria-current={isActive ? 'page' : undefined}
                        onClick={() => handleNavClick(item)}
                        onTouchStart={() => handleNavIntent(item, isActive)}
                        onMouseEnter={() => handleNavIntent(item, isActive)}
                        onFocus={() => handleNavIntent(item, isActive)}
                        style={MOBILE_BOTTOM_NAV_BUTTON_STYLE}
                        className={cn(
                            'flex flex-col items-center justify-center py-2.5 px-1',
                            'min-h-[60px]',
                            'transition-all duration-200',
                            'relative',
                            isActive
                                ? 'text-red-800'
                                : 'text-foreground/65 active:text-foreground'
                        )}
                    >
                        {/* 활성 상태 배경 원 */}
                        {isActive && (
                            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-12 h-12 bg-red-50 rounded-full -z-10 transition-all duration-200" />
                        )}

                        <Icon
                            className={cn(
                                'h-6 w-6 mb-1 transition-all duration-200',
                                isActive && 'fill-red-800/20 scale-110'
                            )}
                        />
                        <span className={cn(
                            'text-[12px] font-medium leading-none tracking-normal',
                            isActive && 'font-semibold'
                        )}>
                            {item.label}
                        </span>
                    </button>
                );
            })}

        </nav>
    );
}

// [OPTIMIZATION] React.memo로 props 변경없으면 리렌더링 방지
const MobileBottomNav = memo(MobileBottomNavComponent);
MobileBottomNav.displayName = 'MobileBottomNav';

export default MobileBottomNav;
