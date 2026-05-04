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
                        const { fetchHomeAnnouncementById } = await import('./home-supabase-actions');
                        const announcement = await fetchHomeAnnouncementById(announcementId);
                        if (!announcement) return;

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
                    const { resolveHomeRestaurantDeepLink } = await import('./home-supabase-actions');
                    const result = await resolveHomeRestaurantDeepLink(restaurantId);
                    if (!result) return;

                    const zoomParam = searchParams.get('z');
                    const focusZoom = zoomParam ? parseFloat(zoomParam) : undefined;
                    const modeParam = searchParams.get('mode');
                    const targetMode: 'domestic' | 'overseas' | null =
                        modeParam === 'overseas' ? 'overseas' : (modeParam === 'domestic' ? 'domestic' : result.inferredMode);

                    if (targetMode) {
                        setMapMode(targetMode);
                    }

                    setTimeout(() => {
                        openDetailPanelRef.current(
                            result.restaurant,
                            !isNaN(Number(focusZoom)) ? Number(focusZoom) : undefined
                        );
                    }, 300);
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
                        const { resolveHomeRestaurantByCoordinates } = await import('./home-supabase-actions');
                        const restaurant = await resolveHomeRestaurantByCoordinates(lat, lng);

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
                const { resolveHomeBookmarkRestaurantSelection } = await import('./home-supabase-actions');
                const result = await resolveHomeBookmarkRestaurantSelection(restaurantId, mode);
                if (!result) return;

                if (result.inferredMode) {
                    setMapMode(result.inferredMode);
                }

                openDetailPanelRef.current(result.restaurant, 13);
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
