'use client';

import { useState, useRef, useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import Header from '@/components/layout/Header';
import Sidebar from '@/components/layout/Sidebar';
import AuthModal from '@/components/auth/AuthModal';
import { ProfileModal } from '@/components/profile/ProfileModal';
import { NicknameSetupModal } from '@/components/profile/NicknameSetupModal';
import { AdminRestaurantModal } from '@/components/admin/AdminRestaurantModal';
import { DailyRecommendationPopup } from '@/components/recommendation/DailyRecommendationPopup';
import { useAuth } from '@/contexts/AuthContext';
import { useLayout } from '@/contexts/LayoutContext';
import { cn } from '@/lib/utils';
import { Restaurant } from '@/types/restaurant';
import { supabase } from '@/integrations/supabase/client';

export function MainLayoutContent({ children }: { children: React.ReactNode }) {
    const { user, signOut, isAdmin, needsNicknameSetup, completeNicknameSetup } = useAuth();
    const queryClient = useQueryClient();
    const pathname = usePathname();
    const { isSidebarOpen, setIsSidebarOpen } = useLayout();
    const [isCenteredLayout, setIsCenteredLayout] = useState(false);
    const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);
    const [isProfileModalOpen, setIsProfileModalOpen] = useState(false);
    const [isAdminModalOpen, setIsAdminModalOpen] = useState(false);
    const [selectedRestaurant, setSelectedRestaurant] = useState<Restaurant | null>(null);
    const [refreshTrigger, setRefreshTrigger] = useState(0);

    const prevPathnameRef = useRef(pathname);

    // 페이지 이동 감지
    useEffect(() => {
        if (prevPathnameRef.current !== pathname) {
            setSelectedRestaurant(null);
            prevPathnameRef.current = pathname;
        }
    }, [pathname]);

    // 사용자 데이터 prefetch
    useEffect(() => {
        if (user?.id) {
            queryClient.prefetchQuery({
                queryKey: ['user-reviews', user.id],
                queryFn: async () => {
                    const { data, error } = await supabase
                        .from('reviews')
                        .select('restaurant_id, is_verified')
                        .eq('user_id', user.id)
                        .eq('is_verified', true);
                    if (error) throw error;
                    return data;
                },
                staleTime: 5 * 60 * 1000,
            });

            queryClient.prefetchQuery({
                queryKey: ['unvisited-restaurants-all'],
                queryFn: async () => {
                    const { data, error } = await supabase
                        .from('restaurants')
                        .select('id, name, youtube_link, review_count, categories, road_address, jibun_address, lat, lng, tzuyang_review, created_at')
                        .eq('status', 'approved')
                        .not('youtube_link', 'is', null)
                        .order('created_at', { ascending: false });
                    if (error) throw error;
                    return data;
                },
                staleTime: 5 * 60 * 1000,
            });
        }
    }, [user?.id, queryClient]);

    const shouldShowCenteredLayoutButton = pathname !== '/' && pathname !== '/global' && pathname !== '/filtering';

    const handleLogout = async () => {
        try {
            await signOut();
        } catch (error) {
            console.error("Logout error:", error);
        }
    };

    const handleAdminSuccess = (updatedRestaurant?: Restaurant) => {
        queryClient.invalidateQueries({ queryKey: ['restaurants'] });
        setRefreshTrigger(prev => prev + 1);

        if (updatedRestaurant) {
            setSelectedRestaurant(updatedRestaurant);
        }
    };

    const handleAdminEditRestaurant = (restaurant: Restaurant) => {
        setSelectedRestaurant(restaurant);
        setIsAdminModalOpen(true);
    };

    return (
        <div className="h-screen flex overflow-hidden">
            <Sidebar isOpen={isSidebarOpen} />

            <div className={cn(
                "flex-1 flex flex-col overflow-hidden transition-all duration-300",
                isSidebarOpen ? "ml-64" : "ml-16"
            )}>
                <Header
                    onToggleSidebar={() => setIsSidebarOpen(!isSidebarOpen)}
                    isLoggedIn={!!user}
                    onOpenAuth={() => setIsAuthModalOpen(true)}
                    onLogout={handleLogout}
                    onProfileClick={() => setIsProfileModalOpen(true)}
                    isCenteredLayout={isCenteredLayout}
                    onToggleCenteredLayout={shouldShowCenteredLayoutButton ? () => setIsCenteredLayout(!isCenteredLayout) : undefined}
                />

                <main className={cn(
                    "flex-1 relative overflow-hidden",
                    isCenteredLayout && shouldShowCenteredLayoutButton && "flex items-center justify-center"
                )}>
                    <div className={cn(
                        "h-full w-full",
                        isCenteredLayout && shouldShowCenteredLayoutButton && "max-w-7xl mx-auto"
                    )}>
                        {children}
                    </div>
                </main>
            </div>

            <AuthModal
                isOpen={isAuthModalOpen}
                onClose={() => setIsAuthModalOpen(false)}
            />

            <ProfileModal
                isOpen={isProfileModalOpen}
                onClose={() => setIsProfileModalOpen(false)}
            />

            <AdminRestaurantModal
                isOpen={isAdminModalOpen}
                onClose={() => setIsAdminModalOpen(false)}
                restaurant={selectedRestaurant}
                onSuccess={handleAdminSuccess}
            />

            <NicknameSetupModal
                isOpen={needsNicknameSetup}
                onComplete={completeNicknameSetup}
            />

            <DailyRecommendationPopup />
        </div>
    );
}

import { LayoutProvider } from '@/contexts/LayoutContext';

export function MainLayout({ children }: { children: React.ReactNode }) {
    return (
        <LayoutProvider>
            <MainLayoutContent>{children}</MainLayoutContent>
        </LayoutProvider>
    );
}
