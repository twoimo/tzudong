'use client';

import { memo, useCallback, useMemo, useRef, useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { Home, Stamp, Trophy, User } from 'lucide-react';
import { cn } from '@/lib/utils';

interface NavItem {
    icon: typeof Home;
    label: string;
    path: string;
}

// [OPTIMIZATION] 상수를 컴포넌트 외부로 이동하여 재생성 방지
const NAV_ITEMS: NavItem[] = [
    { icon: Home, label: '홈', path: '/' },
    { icon: Stamp, label: '도장', path: '/stamp' },
    { icon: Trophy, label: '랭킹', path: '/leaderboard' },
    { icon: User, label: 'MY', path: '/mypage/profile' },
];

interface MobileBottomNavProps {
    className?: string;
}

/**
 * 모바일/태블릿용 하단 네비게이션바 컴포넌트
 * [OPTIMIZATION] useCallback으로 이벤트 핸들러 메모이제이션
 */
function MobileBottomNavComponent({ className }: MobileBottomNavProps) {
    const pathname = usePathname();
    const router = useRouter();
    const navRef = useRef<HTMLElement>(null);

    // [OPTIMIZATION] useCallback으로 핸들러 메모이제이션
    const handleNavClick = useCallback((path: string) => {
        router.push(path);
    }, [router]);

    // [OPTIMIZATION] 현재 경로에 따른 활성 상태 계산을 useMemo로 캐싱
    const activeStates = useMemo(() => {
        return NAV_ITEMS.map(item => ({
            path: item.path,
            isActive: pathname === item.path ||
                (item.path === '/mypage/profile' && pathname?.startsWith('/mypage'))
        }));
    }, [pathname]);

    // [브라우저 호환성] ResizeObserver로 실제 높이 측정 및 CSS 변수 설정
    useEffect(() => {
        if (!navRef.current) return;

        const updateNavHeight = () => {
            if (navRef.current) {
                const height = navRef.current.offsetHeight;
                document.documentElement.style.setProperty('--mobile-bottom-nav-height', `${height}px`);
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
            className={cn(
                // 기본 스타일 및 고정 위치
                'fixed bottom-0 left-0 right-0 z-50',
                // 배경 및 테두리
                'bg-background/95 backdrop-blur-md border-t border-border',
                // 그리드 레이아웃
                'grid grid-cols-4',
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
                        onClick={() => handleNavClick(item.path)}
                        className={cn(
                            'flex flex-col items-center justify-center py-2.5 px-1',
                            'min-h-[60px]',
                            'transition-all duration-200',
                            'relative',
                            isActive
                                ? 'text-red-800'
                                : 'text-muted-foreground active:text-foreground'
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
                            'text-[11px] font-medium tracking-wide',
                            isActive && 'font-bold'
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
