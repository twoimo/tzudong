'use client';

import { memo, useCallback, useMemo, useRef, useEffect, useTransition } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { Home, MessageSquareText, Stamp, Trophy, User } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';

interface NavItem {
    icon: typeof Home;
    label: string;
    path: string;
}

// [OPTIMIZATION] 상수를 컴포넌트 외부로 이동하여 재생성 방지
const NAV_ITEMS: NavItem[] = [
    { icon: Home, label: '홈', path: '/' },
    { icon: MessageSquareText, label: '리뷰', path: '/feed' },
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
    const queryClient = useQueryClient();
    const { user } = useAuth();
    const [, startTransition] = useTransition();

    // [OPTIMIZATION] 마운트 시 모든 네비게이션 경로 prefetch
    useEffect(() => {
        NAV_ITEMS.forEach(item => {
            router.prefetch(item.path);
        });
    }, [router]);

    // [최적화] 도장 페이지 데이터 프리페치
    const prefetchStampData = useCallback(async () => {
        await queryClient.prefetchQuery({
            queryKey: ["restaurants", undefined, undefined, undefined, undefined],
            queryFn: async () => {
                const { data, error } = await supabase
                    .from("restaurants")
                    .select("id, name, lat, lng, road_address, jibun_address, categories, phone, review_count, youtube_link, tzuyang_review, youtube_meta, english_address, status, created_at")
                    .eq("status", "approved")
                    .order("name");
                if (error) throw error;
                return data || [];
            },
            staleTime: 5 * 60 * 1000,
        });

        if (user?.id) {
            await queryClient.prefetchQuery({
                queryKey: ['user-stamp-reviews', user.id],
                queryFn: async () => {
                    const { data, error } = await supabase
                        .from('reviews')
                        .select('restaurant_id, is_verified')
                        .eq('user_id', user.id)
                        .eq('is_verified', true);
                    if (error) throw error;
                    return data || [];
                },
            });
        }
    }, [queryClient, user?.id]);

    // [최적화] 랭킹 페이지 데이터 프리페치
    const prefetchLeaderboardData = useCallback(async () => {
        await queryClient.prefetchQuery({
            queryKey: ['leaderboard-all-users'],
            queryFn: async () => {
                try {
                    const { data: profilesData, error: profilesError } = await supabase
                        .from('profiles')
                        .select('user_id, nickname')
                        .not('nickname', 'is', null)
                        .neq('nickname', '탈퇴한 사용자');

                    if (profilesError) throw new Error(`프로필 데이터 조회 실패: ${profilesError.message}`);
                    if (!profilesData || profilesData.length === 0) return [];

                    const userIds = profilesData.map((profile: any) => profile.user_id);
                    const { data: allReviewsData } = await supabase
                        .from('reviews')
                        .select('id, user_id, is_verified')
                        .in('user_id', userIds);

                    let reviewIds: string[] = [];
                    if (allReviewsData) {
                        reviewIds = allReviewsData.map((review: any) => review.id);
                    }

                    const { data: likesData } = await supabase
                        .from('review_likes')
                        .select('review_id')
                        .in('review_id', reviewIds);

                    const reviewCountMap = new Map<string, number>();
                    const verifiedReviewCountMap = new Map<string, number>();
                    const totalLikesMap = new Map<string, number>();
                    const reviewLikesMap = new Map<string, number>();

                    if (likesData) {
                        likesData.forEach((like: any) => {
                            const current = reviewLikesMap.get(like.review_id) || 0;
                            reviewLikesMap.set(like.review_id, current + 1);
                        });
                    }

                    if (allReviewsData && allReviewsData.length > 0) {
                        allReviewsData.forEach((review: any) => {
                            const currentReviewCount = reviewCountMap.get(review.user_id) || 0;
                            reviewCountMap.set(review.user_id, currentReviewCount + 1);

                            if (review.is_verified) {
                                const currentVerifiedCount = verifiedReviewCountMap.get(review.user_id) || 0;
                                verifiedReviewCountMap.set(review.user_id, currentVerifiedCount + 1);
                            }

                            const reviewLikes = reviewLikesMap.get(review.id) || 0;
                            const currentLikes = totalLikesMap.get(review.user_id) || 0;
                            totalLikesMap.set(review.user_id, currentLikes + reviewLikes);
                        });
                    }

                    const users = profilesData.map((profile: any) => {
                        const reviewCount = reviewCountMap.get(profile.user_id) || 0;
                        const verifiedReviewCount = verifiedReviewCountMap.get(profile.user_id) || 0;
                        const totalLikes = totalLikesMap.get(profile.user_id) || 0;

                        return {
                            id: profile.user_id,
                            username: profile.nickname,
                            reviewCount,
                            verifiedReviewCount,
                            totalLikes,
                        };
                    });

                    return users
                        .sort((a: any, b: any) => b.verifiedReviewCount - a.verifiedReviewCount)
                        .map((user: any, index: number) => ({
                            ...user,
                            rank: index + 1,
                        }));
                } catch (error) {
                    console.warn('리더보드 데이터 조회 중 오류 발생:', error);
                    return [];
                }
            },
            staleTime: 5 * 60 * 1000,
        });
    }, [queryClient]);

    // [OPTIMIZATION] startTransition으로 UI 블로킹 방지
    const handleNavClick = useCallback((path: string) => {
        startTransition(() => {
            router.push(path);
        });
    }, [router, startTransition]);

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
                'grid grid-cols-5',
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
                        onTouchStart={() => {
                            // [성능 최적화] 터치 시작 시 해당 페이지 데이터 미리 로드
                            if (!isActive) {
                                if (item.path === "/stamp") {
                                    prefetchStampData();
                                } else if (item.path === "/leaderboard") {
                                    prefetchLeaderboardData();
                                }
                            }
                        }}
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
