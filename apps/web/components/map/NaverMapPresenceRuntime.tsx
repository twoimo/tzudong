'use client';

import { useEffect, useRef } from 'react';

import { supabase } from '@/integrations/supabase/client';
import {
    resolveNaverInitialOnlineToastPlan,
    resolveNaverOnlineToastDisplayPlan,
} from '@/lib/naver-map-presence-helpers';
import { startOnlinePresence } from '@/lib/online-presence';

const ONLINE_USERS_TOAST_INTERVAL_MS = 30000;

type NaverMapPresenceRuntimeProps = {
    isOnlineUsersToastVisible: boolean;
    onOnlineUsersCountChange: (count: number) => void;
    onShowOnlineUsersChange: (shouldShow: boolean) => void;
};

export default function NaverMapPresenceRuntime({
    isOnlineUsersToastVisible,
    onOnlineUsersCountChange,
    onShowOnlineUsersChange,
}: NaverMapPresenceRuntimeProps) {
    const hasShownInitialToastRef = useRef(false);
    const initialTimerRef = useRef<NodeJS.Timeout | null>(null);
    const hideTimerRef = useRef<NodeJS.Timeout | null>(null);

    useEffect(() => {
        if (isOnlineUsersToastVisible || !hideTimerRef.current) return;
        clearTimeout(hideTimerRef.current);
        hideTimerRef.current = null;
    }, [isOnlineUsersToastVisible]);

    useEffect(() => {
        hasShownInitialToastRef.current = false;

        const clearInitialTimer = () => {
            if (initialTimerRef.current) {
                clearTimeout(initialTimerRef.current);
                initialTimerRef.current = null;
            }
        };

        const clearHideTimer = () => {
            if (hideTimerRef.current) {
                clearTimeout(hideTimerRef.current);
                hideTimerRef.current = null;
            }
        };

        const showOnlineToast = () => {
            const toastDisplayPlan = resolveNaverOnlineToastDisplayPlan({
                hasExistingHideTimer: hideTimerRef.current !== null,
            });

            if (toastDisplayPlan.shouldClearExistingHideTimer) {
                clearHideTimer();
            }

            onShowOnlineUsersChange(toastDisplayPlan.shouldShowOnlineUsers);
            hideTimerRef.current = setTimeout(
                () => {
                    hideTimerRef.current = null;
                    onShowOnlineUsersChange(false);
                },
                toastDisplayPlan.hideDelayMs,
            );
        };

        const cleanupPresence = startOnlinePresence({
            client: supabase,
            channelName: 'map-online-users',
            onCount: (count) => {
                onOnlineUsersCountChange(count);

                const initialToastPlan = resolveNaverInitialOnlineToastPlan({
                    hasExistingInitialTimer: initialTimerRef.current !== null,
                    hasShownInitialToast: hasShownInitialToastRef.current,
                });

                if (initialToastPlan.shouldScheduleInitialToast) {
                    hasShownInitialToastRef.current = initialToastPlan.nextHasShownInitialToast;
                    if (initialToastPlan.shouldClearExistingInitialTimer) {
                        clearInitialTimer();
                    }
                    initialTimerRef.current = setTimeout(
                        showOnlineToast,
                        initialToastPlan.initialDelayMs,
                    );
                }
            },
        });
        const toastInterval = window.setInterval(showOnlineToast, ONLINE_USERS_TOAST_INTERVAL_MS);

        return () => {
            cleanupPresence();
            window.clearInterval(toastInterval);
            clearInitialTimer();
            clearHideTimer();
            onShowOnlineUsersChange(false);
        };
    }, [onOnlineUsersCountChange, onShowOnlineUsersChange]);

    return null;
}
