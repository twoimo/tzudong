'use client';

import { memo, useCallback, useMemo } from 'react';
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

    return (
        <nav
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
                            // 기본 스타일
                            'flex flex-col items-center justify-center py-2 px-1',
                            // 터치 영역 확보
                            'min-h-[56px]',
                            // 트랜지션
                            'transition-colors duration-200',
                            // 활성 상태
                            isActive
                                ? 'text-red-800'
                                : 'text-muted-foreground active:text-foreground'
                        )}
                    >
                        <Icon
                            className={cn(
                                'h-5 w-5 mb-0.5',
                                isActive && 'fill-red-800/20'
                            )}
                        />
                        <span
                            className={cn(
                                'text-[10px] font-medium',
                                isActive && 'font-bold'
                            )}
                        >
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
