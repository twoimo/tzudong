'use client';

import { useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import type { MutableRefObject } from 'react';
import type { Announcement } from '@/types/announcement';
import type { Restaurant } from '@/types/restaurant';
import { requestAuthUi } from '@/lib/auth-ui-events';
import type { useHomeState } from './hooks/useHomeState';

type HomeState = ReturnType<typeof useHomeState>;
type PanelType = 'mypage' | 'adminReviews' | 'announcement' | null;

type AnnouncementRow = {
    id: string;
    title: string;
    content: string;
    is_active: boolean;
    show_on_banner: boolean;
    priority: number;
    created_at: string;
    updated_at: string;
};

type HomeClientEffectsProps = {
    activeRightPanel: PanelType;
    isAdmin: boolean;
    isLoggedIn: boolean;
    isMobileOrTablet: boolean;
    mapMode: 'domestic' | 'overseas';
    openDetailPanelRef: MutableRefObject<(restaurant: Restaurant, focusZoom?: number) => void>;
    openPanelRef: MutableRefObject<(panel: PanelType) => void>;
    selectedAnnouncement: Announcement | null;
    setMapMode: (mode: 'domestic' | 'overseas') => void;
    setSelectedAnnouncement: (announcement: Announcement | null) => void;
    state: HomeState;
    togglePanelCollapse: () => void;
};

export default function HomeClientEffects({
    activeRightPanel,
    isAdmin,
    isLoggedIn,
    isMobileOrTablet,
    mapMode,
    openDetailPanelRef,
    openPanelRef,
    selectedAnnouncement,
    setMapMode,
    setSelectedAnnouncement,
    state,
    togglePanelCollapse,
}: HomeClientEffectsProps) {
    const searchParams = useSearchParams();
    const router = useRouter();

    useEffect(() => {
        const timer = setTimeout(() => {
            window.dispatchEvent(new Event('mapLoadingComplete'));
        }, 200);

        return () => clearTimeout(timer);
    }, []);

    useEffect(() => {
        const panelParam = searchParams.get('panel');
        const announcementId = searchParams.get('announcementId');
        const restaurantId = searchParams.get('r') || searchParams.get('restaurant');

        if (panelParam === 'announcement') {
            if (announcementId) {
                (async () => {
                    try {
                        const { supabase } = await import('@/integrations/supabase/client');
                        const announcementsTable = supabase.from('announcements' as never);
                        const { data: rawAnnouncement, error } = await announcementsTable
                            .select('id, title, content, is_active, show_on_banner, priority, created_at, updated_at')
                            .eq('id', announcementId)
                            .maybeSingle();

                        const announcementRow = rawAnnouncement as AnnouncementRow | null;
                        if (error || !announcementRow) {
                            return;
                        }

                        const announcement: Announcement = {
                            id: announcementRow.id,
                            title: announcementRow.title,
                            content: announcementRow.content,
                            isActive: announcementRow.is_active,
                            showOnBanner: announcementRow.show_on_banner,
                            priority: announcementRow.priority,
                            createdAt: announcementRow.created_at,
                            updatedAt: announcementRow.updated_at,
                        };

                        setTimeout(() => {
                            setSelectedAnnouncement(announcement);
                            openPanelRef.current('announcement');
                            router.replace('/', { scroll: false });
                        }, 500);
                    } catch {
                        // ignore
                    }
                })();
            } else {
                setTimeout(() => {
                    setSelectedAnnouncement(null);
                    openPanelRef.current('announcement');
                    router.replace('/', { scroll: false });
                }, 350);
            }
        }

        if (restaurantId) {
            (async () => {
                try {
                    const { supabase } = await import('@/integrations/supabase/client');
                    const { mergeRestaurants } = await import('@/hooks/use-restaurants');
                    const { data: targetRestaurant, error } = await supabase
                        .from('restaurants')
                        .select('*, name:approved_name')
                        .eq('id', restaurantId)
                        .single();

                    if (error || !targetRestaurant) {
                        console.error('맛집 조회 실패:', error);
                        return;
                    }

                    const { data: sameNameRestaurants } = await supabase
                        .from('restaurants')
                        .select('*')
                        .eq('approved_name', (targetRestaurant as Restaurant).name)
                        .eq('status', 'approved');

                    const merged = mergeRestaurants((sameNameRestaurants || [targetRestaurant]) as Restaurant[]);
                    const mergedRestaurant = merged.find((restaurant) => restaurant.id === restaurantId) || merged[0];

                    if (mergedRestaurant) {
                        const zoomParam = searchParams.get('z');
                        const focusZoom = zoomParam ? parseFloat(zoomParam) : undefined;
                        const modeParam = searchParams.get('mode');
                        let targetMode: 'domestic' | 'overseas' | null =
                            modeParam === 'overseas' ? 'overseas' : (modeParam === 'domestic' ? 'domestic' : null);

                        if (!targetMode && mergedRestaurant.lat && mergedRestaurant.lng) {
                            const { lat, lng } = mergedRestaurant;
                            targetMode = lat < 33 || lat > 39 || lng < 124 || lng > 132 ? 'overseas' : 'domestic';
                        }

                        if (targetMode) {
                            setMapMode(targetMode);
                        }

                        setTimeout(() => {
                            openDetailPanelRef.current(
                                mergedRestaurant,
                                !isNaN(Number(focusZoom)) ? Number(focusZoom) : undefined
                            );
                        }, 300);
                    }
                } catch (error) {
                    console.error('맛집 조회 실패:', error);
                }
            })();
        }

        const urlLat = searchParams.get('lat');
        const urlLng = searchParams.get('lng');
        const urlZoom = searchParams.get('z');
        const sharedReviewId = searchParams.get('review');

        if (urlLat && urlLng && urlZoom && !restaurantId && !sharedReviewId) {
            const lat = parseFloat(urlLat);
            const lng = parseFloat(urlLng);

            if (!isNaN(lat) && !isNaN(lng)) {
                (async () => {
                    try {
                        const { supabase } = await import('@/integrations/supabase/client');
                        const { mergeRestaurants } = await import('@/hooks/use-restaurants');
                        const tolerance = 0.0001;
                        const { data: restaurants, error } = await supabase
                            .from('restaurants')
                            .select('*, name:approved_name')
                            .gte('lat', lat - tolerance)
                            .lte('lat', lat + tolerance)
                            .gte('lng', lng - tolerance)
                            .lte('lng', lng + tolerance)
                            .eq('status', 'approved');

                        if (error || !restaurants || restaurants.length === 0) {
                            return;
                        }

                        const merged = mergeRestaurants(restaurants as Restaurant[]);
                        const restaurant = merged[0];

                        if (restaurant) {
                            setTimeout(() => {
                                openDetailPanelRef.current(restaurant);
                            }, 500);
                        }
                    } catch (error) {
                        console.error('맛집 조회 실패:', error);
                    }
                })();
            }
        }

        const reviewId = searchParams.get('review');
        if (reviewId) {
            const isMobileWidth = typeof window !== 'undefined' && window.innerWidth <= 1024;

            if (!isMobileWidth) {
                window.dispatchEvent(new CustomEvent('openFeedOverlay', { detail: { reviewId } }));
            } else {
                router.replace(`/feed?review=${reviewId}`);
            }
        }
    }, [openDetailPanelRef, openPanelRef, router, searchParams, setMapMode, setSelectedAnnouncement]);

    useEffect(() => {
        const handleChangeMapMode = (event: Event) => {
            const nextMode = (event as CustomEvent<'domestic' | 'overseas'>).detail;
            state.clearRestaurantDetailSelection();
            setMapMode(nextMode);
        };

        window.addEventListener('changeMapMode', handleChangeMapMode);
        return () => window.removeEventListener('changeMapMode', handleChangeMapMode);
    }, [setMapMode, state]);

    useEffect(() => {
        window.dispatchEvent(new CustomEvent('syncMapMode', { detail: mapMode }));
    }, [mapMode]);

    useEffect(() => {
        const handleMyPageOpen = () => {
            if (!isLoggedIn) {
                requestAuthUi({ source: 'home-open-mypage-event', route: '/', reason: 'mypage' });
                return;
            }

            router.push('/mypage');
        };

        const handleAdminSubmissionsOpen = () => {
            if (isAdmin) {
                router.push('/admin/evaluations?view=submissions');
            }
        };

        const handleAdminReviewsOpen = () => {
            if (isAdmin) {
                openPanelRef.current('adminReviews');
            }
        };

        const handleAdminAnnouncementsOpen = () => {
            setSelectedAnnouncement(null);
            openPanelRef.current('announcement');
        };

        const handleAnnouncementDetailOpen = (event: Event) => {
            const announcement = (event as CustomEvent<Announcement>).detail;

            if (activeRightPanel === 'announcement' && selectedAnnouncement?.id === announcement.id) {
                togglePanelCollapse();
            } else {
                setSelectedAnnouncement(announcement);
                openPanelRef.current('announcement');
            }
        };

        const handleSelectBookmarkRestaurant = async (event: Event) => {
            const detail = (event as CustomEvent<{ id: string, mode: 'domestic' | 'overseas' } | string>).detail;
            const restaurantId = typeof detail === 'string' ? detail : detail.id;
            const mode = typeof detail === 'string' ? null : detail.mode;

            if (mode) {
                setMapMode(mode);
            }

            try {
                const { supabase } = await import('@/integrations/supabase/client');
                const { mergeRestaurants } = await import('@/hooks/use-restaurants');
                const { data: targetRestaurant, error } = await supabase
                    .from('restaurants')
                    .select('*, name:approved_name')
                    .eq('id', restaurantId)
                    .single();

                if (error || !targetRestaurant) return;

                const restaurant = targetRestaurant as Restaurant;
                if (!mode && typeof restaurant.lat === 'number' && typeof restaurant.lng === 'number') {
                    const isOverseasCoord = restaurant.lat < 33 || restaurant.lat > 39 || restaurant.lng < 124 || restaurant.lng > 132;
                    setMapMode(isOverseasCoord ? 'overseas' : 'domestic');
                }

                const { data: sameNameRestaurants } = await supabase
                    .from('restaurants')
                    .select('*')
                    .eq('approved_name', restaurant.name)
                    .eq('status', 'approved');

                const merged = mergeRestaurants((sameNameRestaurants || [targetRestaurant]) as Restaurant[]);
                const mergedRestaurant = merged.find((item) => item.id === restaurantId) || merged[0];

                if (mergedRestaurant) {
                    openDetailPanelRef.current(mergedRestaurant, 13);
                }
            } catch (error) {
                console.error('맛집 조회 실패:', error);
            }
        };

        window.addEventListener('openMyPage', handleMyPageOpen);
        window.addEventListener('openAdminSubmissions', handleAdminSubmissionsOpen);
        window.addEventListener('openAdminReviews', handleAdminReviewsOpen);
        window.addEventListener('openAdminAnnouncements', handleAdminAnnouncementsOpen);
        window.addEventListener('openAnnouncementDetail', handleAnnouncementDetailOpen);
        window.addEventListener('selectBookmarkRestaurant', handleSelectBookmarkRestaurant);

        return () => {
            window.removeEventListener('openMyPage', handleMyPageOpen);
            window.removeEventListener('openAdminSubmissions', handleAdminSubmissionsOpen);
            window.removeEventListener('openAdminReviews', handleAdminReviewsOpen);
            window.removeEventListener('openAdminAnnouncements', handleAdminAnnouncementsOpen);
            window.removeEventListener('openAnnouncementDetail', handleAnnouncementDetailOpen);
            window.removeEventListener('selectBookmarkRestaurant', handleSelectBookmarkRestaurant);
        };
    }, [
        activeRightPanel,
        isAdmin,
        isLoggedIn,
        openDetailPanelRef,
        openPanelRef,
        router,
        selectedAnnouncement,
        setMapMode,
        setSelectedAnnouncement,
        togglePanelCollapse,
    ]);

    return null;
}
