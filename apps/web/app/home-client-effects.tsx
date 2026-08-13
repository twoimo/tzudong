'use client';

import { useEffect, useRef } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { flushSync } from 'react-dom';
import type { MutableRefObject } from 'react';
import type { Announcement } from '@/types/announcement';
import type { Restaurant } from '@/types/restaurant';
import { requestAuthUi } from '@/lib/auth-ui-events';
import { isPublicRestrictedMode } from '@/lib/site-config';
import { toast } from '@/lib/no-toast';
import { HOME_DESKTOP_INLINE_DETAIL_OPEN_FAILED_EVENT } from '@/lib/desktop-left-panel-entry';
import {
    resolveHomeDetailMapModeParam,
    isHomeDetailHistoryState,
    resolveHomeDetailRestaurantParam,
} from '@/lib/home-detail-route-state';

type HomeSupabaseActions = typeof import('./home-supabase-actions');
type HomeRestaurantDeepLinkResult = Awaited<ReturnType<HomeSupabaseActions['resolveHomeRestaurantDeepLink']>>;

type PanelType = 'mypage' | 'adminReviews' | 'announcement' | null;


type HomeClientEffectsProps = {
    activeRightPanel: PanelType;
    clearRestaurantDetailSelection: () => void;
    closeAllPanels: () => void;
    isAdmin: boolean;
    isLoggedIn: boolean;
    isAnnouncementSheetOpen: boolean;
    mapMode: 'domestic' | 'overseas';
    openDetailPanelRef: MutableRefObject<(restaurant: Restaurant, focusZoom?: number, options?: { source?: 'user' | 'url'; searchFocusRestaurant?: Restaurant | null; mapMode?: 'domestic' | 'overseas'; restoreKey?: string | null }) => void>;
    openPanelRef: MutableRefObject<(panel: PanelType) => void>;
    selectedAnnouncement: Announcement | null;
    setMapMode: (mode: 'domestic' | 'overseas') => void;
    setSelectedAnnouncement: (announcement: Announcement | null) => void;
};
const EMPTY_SEARCH_PARAMS = new URLSearchParams();

export default function HomeClientEffects({
    activeRightPanel,
    clearRestaurantDetailSelection,
    closeAllPanels,
    isAdmin,
    isLoggedIn,
    isAnnouncementSheetOpen,
    mapMode,
    openDetailPanelRef,
    openPanelRef,
    selectedAnnouncement,
    setMapMode,
    setSelectedAnnouncement,
}: HomeClientEffectsProps) {
    const searchParams = useSearchParams() ?? EMPTY_SEARCH_PARAMS;
    const router = useRouter();
    const lastAnnouncementRequestKeyRef = useRef<string | null>(null);
    const lastRestaurantDeepLinkRequestKeyRef = useRef<string | null>(null);
    const lastCoordinateRequestKeyRef = useRef<string | null>(null);
    const pendingAnnouncementRequestRef = useRef<{ key: string; promise: Promise<Announcement | null> } | null>(null);
    const pendingRestaurantDeepLinkRequestRef = useRef<{ key: string; promise: Promise<HomeRestaurantDeepLinkResult | null> } | null>(null);
    const userDetailOpenGenerationRef = useRef(0);
    const pendingCoordinateRequestRef = useRef<{ key: string; promise: Promise<Restaurant | null> } | null>(null);
    const wasAnnouncementUrlActiveRef = useRef(searchParams.get('panel') === 'announcement');
    useEffect(() => {
        const handleUserDetailOpened = () => {
            userDetailOpenGenerationRef.current += 1;
            lastRestaurantDeepLinkRequestKeyRef.current = null;
            pendingRestaurantDeepLinkRequestRef.current = null;
        };

        window.addEventListener('home:detail-user-opened', handleUserDetailOpened);
        return () => window.removeEventListener('home:detail-user-opened', handleUserDetailOpened);
    }, []);

    useEffect(() => {
        const timer = setTimeout(() => {
            window.dispatchEvent(new Event('mapLoadingComplete'));
        }, 200);

        return () => clearTimeout(timer);
    }, []);

    useEffect(() => {
        const isAnnouncementUrlActive = searchParams.get('panel') === 'announcement';
        if (
            !isAnnouncementUrlActive &&
            wasAnnouncementUrlActiveRef.current &&
            (activeRightPanel === 'announcement' || isAnnouncementSheetOpen)
        ) {
            closeAllPanels();
        }
        wasAnnouncementUrlActiveRef.current = isAnnouncementUrlActive;
    }, [activeRightPanel, closeAllPanels, isAnnouncementSheetOpen, searchParams]);

    useEffect(() => {
        const panelParam = searchParams.get('panel');
        if (isPublicRestrictedMode && panelParam === 'announcement') {
            closeAllPanels();
            return;
        }
        const announcementId = searchParams.get('announcementId');
        const restaurantId = resolveHomeDetailRestaurantParam(searchParams);
        const timers: number[] = [];
        let isCancelled = false;

        const schedule = (callback: () => void, delay: number) => {
            const timer = window.setTimeout(() => {
                if (!isCancelled) {
                    callback();
                }
            }, delay);
            timers.push(timer);
        };

        const runRestaurantDeepLinkResolution = (callback: () => void) => {
            if (isCancelled) return;

            callback();
        };

        const resolveAnnouncementRequestKey = (params: URLSearchParams) => {
            if (params.get('panel') !== 'announcement') return null;
            const requestedAnnouncementId = params.get('announcementId');
            return requestedAnnouncementId ? `detail:${requestedAnnouncementId}` : 'list';
        };

        const resolveRestaurantRequestKey = (params: URLSearchParams) => {
            const requestedRestaurantId = resolveHomeDetailRestaurantParam(params);
            if (!requestedRestaurantId) return null;
            const requestedMode = resolveHomeDetailMapModeParam(params);
            return [
                requestedRestaurantId,
                requestedMode ?? '',
            ].join('|');
        };

        const resolveCoordinateRequestKey = (params: URLSearchParams) => {
            const requestedRestaurantId = resolveHomeDetailRestaurantParam(params);
            const requestedLat = params.get('lat');
            const requestedLng = params.get('lng');
            const requestedZoom = params.get('z');
            const requestedReviewId = params.get('review');
            if (!requestedLat || !requestedLng || !requestedZoom || requestedRestaurantId || requestedReviewId) {
                return null;
            }
            return `${requestedLat}|${requestedLng}|${requestedZoom}`;
        };

        const clearRegisteredRequestKeys = () => {
            const currentSearchParams = new URLSearchParams(window.location.search);
            if (lastAnnouncementRequestKeyRef.current !== resolveAnnouncementRequestKey(currentSearchParams)) {
                lastAnnouncementRequestKeyRef.current = null;
            }
            if (lastRestaurantDeepLinkRequestKeyRef.current !== resolveRestaurantRequestKey(currentSearchParams)) {
                lastRestaurantDeepLinkRequestKeyRef.current = null;
            }
            if (lastCoordinateRequestKeyRef.current !== resolveCoordinateRequestKey(currentSearchParams)) {
                lastCoordinateRequestKeyRef.current = null;
            }
        };

        if (panelParam === 'announcement') {
            const announcementKey = resolveAnnouncementRequestKey(searchParams) ?? 'list';
            openPanelRef.current('announcement');

            if (lastAnnouncementRequestKeyRef.current !== announcementKey) {
                lastAnnouncementRequestKeyRef.current = announcementKey;

                if (announcementId) {
                    setSelectedAnnouncement(null);
                    let request = pendingAnnouncementRequestRef.current;
                    if (request?.key !== announcementKey) {
                        const promise = import('./home-supabase-actions')
                            .then(({ fetchHomeAnnouncementById }) => fetchHomeAnnouncementById(announcementId))
                            .catch((error) => {
                                console.error('공지사항 조회 실패:');
                                toast.error('공지사항을 불러오지 못했어요');
                                return null;
                            });
                        request = { key: announcementKey, promise };
                        pendingAnnouncementRequestRef.current = request;
                        void promise.finally(() => {
                            if (pendingAnnouncementRequestRef.current === request) {
                                pendingAnnouncementRequestRef.current = null;
                            }
                        });
                    }

                    void request.promise.then((announcement) => {
                        if (isCancelled || lastAnnouncementRequestKeyRef.current !== announcementKey) return;

                        setSelectedAnnouncement(announcement ?? null);
                    });
                } else {
                    setSelectedAnnouncement(null);
                }
            }
        } else {
            lastAnnouncementRequestKeyRef.current = null;
        }

        if (restaurantId) {
            const requestedMode = resolveHomeDetailMapModeParam(searchParams);
            const restaurantKey = resolveRestaurantRequestKey(searchParams) ?? restaurantId;
            const requestGeneration = userDetailOpenGenerationRef.current;

            if (lastRestaurantDeepLinkRequestKeyRef.current !== restaurantKey) {
                lastRestaurantDeepLinkRequestKeyRef.current = restaurantKey;

                runRestaurantDeepLinkResolution(() => {
                    let request = pendingRestaurantDeepLinkRequestRef.current;
                    if (request?.key !== restaurantKey) {
                        const promise = import('./home-supabase-actions')
                            .then(({ resolveHomeRestaurantDeepLink }) => resolveHomeRestaurantDeepLink(restaurantId))
                            .catch((error) => {
                                console.error('맛집 조회 실패:');
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
                        if (isCancelled || lastRestaurantDeepLinkRequestKeyRef.current !== restaurantKey) return;
                        if (userDetailOpenGenerationRef.current !== requestGeneration) return;
                        if (!result) {
                            toast.error('맛집 정보를 불러오지 못했어요');
                            return;
                        }

                        const currentRestaurantId = resolveHomeDetailRestaurantParam(new URLSearchParams(window.location.search));
                        if (currentRestaurantId !== restaurantId) return;
                        if (
                            isHomeDetailHistoryState(window.history.state) &&
                            window.history.state.restaurantId !== restaurantId
                        ) return;

                        const zoomParam = searchParams.get('z');
                        const focusZoom = zoomParam ? parseFloat(zoomParam) : undefined;
                        const targetMode: 'domestic' | 'overseas' | null =
                            requestedMode ?? result.inferredMode;
                        const restoreKey = searchParams.get('restore');

                        if (targetMode) {
                            setMapMode(targetMode);
                        }

                        schedule(() => {
                            if (userDetailOpenGenerationRef.current !== requestGeneration) return;
                            const currentRestaurantId = resolveHomeDetailRestaurantParam(new URLSearchParams(window.location.search));
                            if (currentRestaurantId !== restaurantId) return;
                            if (
                                isHomeDetailHistoryState(window.history.state) &&
                                window.history.state.restaurantId !== restaurantId
                            ) return;
                            openDetailPanelRef.current(
                                result.restaurant,
                                !isNaN(Number(focusZoom)) ? Number(focusZoom) : undefined,
                                { source: 'url', mapMode: targetMode ?? undefined, restoreKey },
                            );
                        }, 0);
                    });
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
                lastCoordinateRequestKeyRef.current = coordinateKey;

                let request = pendingCoordinateRequestRef.current;
                if (request?.key !== coordinateKey) {
                    const promise = import('./home-supabase-actions')
                        .then(({ resolveHomeRestaurantByCoordinates }) => resolveHomeRestaurantByCoordinates(lat, lng))
                        .catch((error) => {
                            console.error('맛집 조회 실패:');
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
                    if (isCancelled || lastCoordinateRequestKeyRef.current !== coordinateKey) return;
                    if (!restaurant) {
                        toast.error('해당 위치의 맛집을 찾지 못했어요');
                        return;
                    }

                    schedule(() => {
                        openDetailPanelRef.current(restaurant, undefined, { source: 'url', mapMode });
                    }, 500);
                });
            } else if (isNaN(lat) || isNaN(lng)) {
                toast.error('지도 좌표 링크가 올바르지 않아요');
                lastCoordinateRequestKeyRef.current = null;
            } else {
            }
        } else {
            lastCoordinateRequestKeyRef.current = null;
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

        return () => {
            isCancelled = true;
            clearRegisteredRequestKeys();
            timers.forEach((timer) => window.clearTimeout(timer));
        };
    }, [closeAllPanels, mapMode, openDetailPanelRef, openPanelRef, router, searchParams, setMapMode, setSelectedAnnouncement]);

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
                toast.info('로그인 후 마이페이지를 확인할 수 있어요');
                requestAuthUi({ source: 'home-open-mypage-event', route: '/', reason: 'mypage', force: true });
                return;
            }

            router.push('/mypage/profile');
        };

        const handleAdminSubmissionsOpen = () => {
            if (isAdmin) {
                router.push('/admin?module=submissions');
            }
        };

        const handleAdminReviewsOpen = () => {
            if (isAdmin) {
                openPanelRef.current('adminReviews');
            }
        };

        const handleAdminAnnouncementsOpen = () => {
            flushSync(() => {
                setSelectedAnnouncement(null);
                openPanelRef.current('announcement');
            });
            router.push('/?panel=announcement', { scroll: false });
        };

        const handleAnnouncementDetailOpen = (event: Event) => {
            const announcement = (event as CustomEvent<Announcement>).detail;

            if (activeRightPanel === 'announcement' && selectedAnnouncement?.id === announcement.id) {
                openPanelRef.current('announcement');
            } else {
                flushSync(() => {
                    setSelectedAnnouncement(announcement);
                    openPanelRef.current('announcement');
                });
                router.push(`/?panel=announcement&announcementId=${encodeURIComponent(announcement.id)}`, { scroll: false });
            }
        };

        const handleSelectBookmarkRestaurant = async (event: Event) => {
            const detail = (event as CustomEvent<{ id: string, mode: 'domestic' | 'overseas' } | string>).detail;
            const restaurantId = typeof detail === 'string' ? detail : detail.id;
            const mode = typeof detail === 'string' ? null : detail.mode;
            const notifyInlineDetailOpenFailed = () => {
                window.dispatchEvent(
                    new CustomEvent(HOME_DESKTOP_INLINE_DETAIL_OPEN_FAILED_EVENT, {
                        detail: { restaurantId },
                    }),
                );
            };

            if (mode) {
                setMapMode(mode);
            }

            try {
                const { resolveHomeBookmarkRestaurantSelection } = await import('./home-supabase-actions');
                const result = await resolveHomeBookmarkRestaurantSelection(restaurantId, mode);
                if (!result) {
                    notifyInlineDetailOpenFailed();
                    toast.error('맛집 정보를 불러오지 못했어요');
                    return;
                }

                if (result.inferredMode) {
                    setMapMode(result.inferredMode);
                }

                openDetailPanelRef.current(result.restaurant, 13);
            } catch (error) {
                notifyInlineDetailOpenFailed();
                toast.error('맛집 정보를 불러오지 못했어요');
                console.error('맛집 조회 실패:');
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
        ]);

    return null;
}
