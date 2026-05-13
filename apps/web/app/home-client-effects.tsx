'use client';

import { useEffect, useRef } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import type { MutableRefObject } from 'react';
import type { Announcement } from '@/types/announcement';
import type { Restaurant } from '@/types/restaurant';
import { requestAuthUi } from '@/lib/auth-ui-events';

type HomeSupabaseActions = typeof import('./home-supabase-actions');
type HomeRestaurantDeepLinkResult = Awaited<ReturnType<HomeSupabaseActions['resolveHomeRestaurantDeepLink']>>;

type PanelType = 'mypage' | 'adminReviews' | 'announcement' | null;

type HomeClientEffectsProps = {
    activeRightPanel: PanelType;
    clearRestaurantDetailSelection: () => void;
    isAdmin: boolean;
    isLoggedIn: boolean;
    isMobileOrTablet: boolean;
    mapMode: 'domestic' | 'overseas';
    openDetailPanelRef: MutableRefObject<(restaurant: Restaurant, focusZoom?: number) => void>;
    openPanelRef: MutableRefObject<(panel: PanelType) => void>;
    selectedAnnouncement: Announcement | null;
    setMapMode: (mode: 'domestic' | 'overseas') => void;
    setSelectedAnnouncement: (announcement: Announcement | null) => void;
    togglePanelCollapse: () => void;
};

export default function HomeClientEffects({
    activeRightPanel,
    clearRestaurantDetailSelection,
    isAdmin,
    isLoggedIn,
    isMobileOrTablet,
    mapMode,
    openDetailPanelRef,
    openPanelRef,
    selectedAnnouncement,
    setMapMode,
    setSelectedAnnouncement,
    togglePanelCollapse,
}: HomeClientEffectsProps) {
    const searchParams = useSearchParams();
    const router = useRouter();
    const lastAnnouncementRequestKeyRef = useRef<string | null>(null);
    const lastRestaurantDeepLinkRequestKeyRef = useRef<string | null>(null);
    const lastCoordinateRequestKeyRef = useRef<string | null>(null);
    const pendingAnnouncementRequestRef = useRef<{ key: string; promise: Promise<Announcement | null> } | null>(null);
    const pendingRestaurantDeepLinkRequestRef = useRef<{ key: string; promise: Promise<HomeRestaurantDeepLinkResult | null> } | null>(null);
    const pendingCoordinateRequestRef = useRef<{ key: string; promise: Promise<Restaurant | null> } | null>(null);

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
        const timers: number[] = [];
        let isCancelled = false;
        let registeredAnnouncementKey: string | null = null;
        let registeredRestaurantDeepLinkKey: string | null = null;
        let registeredCoordinateKey: string | null = null;

        const schedule = (callback: () => void, delay: number) => {
            const timer = window.setTimeout(() => {
                if (!isCancelled) {
                    callback();
                }
            }, delay);
            timers.push(timer);
        };

        if (panelParam === 'announcement') {
            const announcementKey = announcementId ? `detail:${announcementId}` : 'list';
            registeredAnnouncementKey = announcementKey;

            if (lastAnnouncementRequestKeyRef.current !== announcementKey) {
                lastAnnouncementRequestKeyRef.current = announcementKey;

                if (announcementId) {
                    let request = pendingAnnouncementRequestRef.current;
                    if (request?.key !== announcementKey) {
                        const promise = import('./home-supabase-actions')
                            .then(({ fetchHomeAnnouncementById }) => fetchHomeAnnouncementById(announcementId))
                            .catch(() => null);
                        request = { key: announcementKey, promise };
                        pendingAnnouncementRequestRef.current = request;
                        void promise.finally(() => {
                            if (pendingAnnouncementRequestRef.current === request) {
                                pendingAnnouncementRequestRef.current = null;
                            }
                        });
                    }

                    void request.promise.then((announcement) => {
                        if (isCancelled || lastAnnouncementRequestKeyRef.current !== announcementKey || !announcement) return;

                        schedule(() => {
                            setSelectedAnnouncement(announcement);
                            openPanelRef.current('announcement');
                            router.replace('/', { scroll: false });
                        }, 500);
                    });
                } else {
                    schedule(() => {
                        setSelectedAnnouncement(null);
                        openPanelRef.current('announcement');
                        router.replace('/', { scroll: false });
                    }, 350);
                }
            }
        } else {
            lastAnnouncementRequestKeyRef.current = null;
        }

        if (restaurantId) {
            const restaurantKey = [
                restaurantId,
                searchParams.get('z') ?? '',
                searchParams.get('mode') ?? '',
            ].join('|');
            registeredRestaurantDeepLinkKey = restaurantKey;

            if (lastRestaurantDeepLinkRequestKeyRef.current !== restaurantKey) {
                lastRestaurantDeepLinkRequestKeyRef.current = restaurantKey;

                let request = pendingRestaurantDeepLinkRequestRef.current;
                if (request?.key !== restaurantKey) {
                    const promise = import('./home-supabase-actions')
                        .then(({ resolveHomeRestaurantDeepLink }) => resolveHomeRestaurantDeepLink(restaurantId))
                        .catch((error) => {
                            console.error('맛집 조회 실패:', error);
                            return null;
                        });
                    request = { key: restaurantKey, promise };
                    pendingRestaurantDeepLinkRequestRef.current = request;
                    void promise.finally(() => {
                        if (pendingRestaurantDeepLinkRequestRef.current === request) {
                            pendingRestaurantDeepLinkRequestRef.current = null;
                        }
                    });
                }

                void request.promise.then((result) => {
                    if (isCancelled || lastRestaurantDeepLinkRequestKeyRef.current !== restaurantKey || !result) return;

                    const zoomParam = searchParams.get('z');
                    const focusZoom = zoomParam ? parseFloat(zoomParam) : undefined;
                    const modeParam = searchParams.get('mode');
                    const targetMode: 'domestic' | 'overseas' | null =
                        modeParam === 'overseas' ? 'overseas' : (modeParam === 'domestic' ? 'domestic' : result.inferredMode);

                    if (targetMode) {
                        setMapMode(targetMode);
                    }

                    schedule(() => {
                        openDetailPanelRef.current(
                            result.restaurant,
                            !isNaN(Number(focusZoom)) ? Number(focusZoom) : undefined
                        );
                    }, 300);
                });
            }
        } else {
            lastRestaurantDeepLinkRequestKeyRef.current = null;
        }

        const urlLat = searchParams.get('lat');
        const urlLng = searchParams.get('lng');
        const urlZoom = searchParams.get('z');
        const sharedReviewId = searchParams.get('review');

        if (urlLat && urlLng && urlZoom && !restaurantId && !sharedReviewId) {
            const lat = parseFloat(urlLat);
            const lng = parseFloat(urlLng);
            const coordinateKey = `${urlLat}|${urlLng}|${urlZoom}`;

            if (!isNaN(lat) && !isNaN(lng) && lastCoordinateRequestKeyRef.current !== coordinateKey) {
                registeredCoordinateKey = coordinateKey;
                lastCoordinateRequestKeyRef.current = coordinateKey;

                let request = pendingCoordinateRequestRef.current;
                if (request?.key !== coordinateKey) {
                    const promise = import('./home-supabase-actions')
                        .then(({ resolveHomeRestaurantByCoordinates }) => resolveHomeRestaurantByCoordinates(lat, lng))
                        .catch((error) => {
                            console.error('맛집 조회 실패:', error);
                            return null;
                        });
                    request = { key: coordinateKey, promise };
                    pendingCoordinateRequestRef.current = request;
                    void promise.finally(() => {
                        if (pendingCoordinateRequestRef.current === request) {
                            pendingCoordinateRequestRef.current = null;
                        }
                    });
                }

                void request.promise.then((restaurant) => {
                    if (isCancelled || lastCoordinateRequestKeyRef.current !== coordinateKey || !restaurant) return;

                    schedule(() => {
                        openDetailPanelRef.current(restaurant);
                    }, 500);
                });
            } else if (isNaN(lat) || isNaN(lng)) {
                lastCoordinateRequestKeyRef.current = null;
            } else {
                registeredCoordinateKey = coordinateKey;
            }
        } else {
            lastCoordinateRequestKeyRef.current = null;
        }

        const clearRegisteredRequestKeys = () => {
            if (
                registeredAnnouncementKey &&
                lastAnnouncementRequestKeyRef.current === registeredAnnouncementKey
            ) {
                lastAnnouncementRequestKeyRef.current = null;
            }
            if (
                registeredRestaurantDeepLinkKey &&
                lastRestaurantDeepLinkRequestKeyRef.current === registeredRestaurantDeepLinkKey
            ) {
                lastRestaurantDeepLinkRequestKeyRef.current = null;
            }
            if (
                registeredCoordinateKey &&
                lastCoordinateRequestKeyRef.current === registeredCoordinateKey
            ) {
                lastCoordinateRequestKeyRef.current = null;
            }
        };

        const reviewId = searchParams.get('review');
        if (reviewId) {
            const isMobileWidth = typeof window !== 'undefined' && window.innerWidth <= 1024;

            if (!isMobileWidth) {
                window.dispatchEvent(new CustomEvent('openFeedOverlay', { detail: { reviewId } }));
            } else {
                router.replace(`/feed?review=${reviewId}`);
            }
        }

        return () => {
            isCancelled = true;
            clearRegisteredRequestKeys();
            timers.forEach((timer) => window.clearTimeout(timer));
        };
    }, [openDetailPanelRef, openPanelRef, router, searchParams, setMapMode, setSelectedAnnouncement]);

    useEffect(() => {
        const handleChangeMapMode = (event: Event) => {
            const nextMode = (event as CustomEvent<'domestic' | 'overseas'>).detail;
            clearRestaurantDetailSelection();
            setMapMode(nextMode);
        };

        window.addEventListener('changeMapMode', handleChangeMapMode);
        return () => window.removeEventListener('changeMapMode', handleChangeMapMode);
    }, [clearRestaurantDetailSelection, setMapMode]);

    useEffect(() => {
        window.dispatchEvent(new CustomEvent('syncMapMode', { detail: mapMode }));
    }, [mapMode]);

    useEffect(() => {
        const handleMyPageOpen = () => {
            if (!isLoggedIn) {
                requestAuthUi({ source: 'home-open-mypage-event', route: '/', reason: 'mypage' });
                return;
            }

            router.push('/mypage/profile');
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
