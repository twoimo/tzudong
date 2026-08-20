'use client';

import { useEffect, useRef } from 'react';
import { useBannerAnnouncements } from '@/hooks/use-banner-announcements';
import {
    resolveNaverAnnouncementToastCleanupPlan,
    resolveNaverAnnouncementToastInactivePlan,
    resolveNaverAnnouncementToastPlan,
    resolveNaverAnnouncementToastSchedulePlan,
} from '@/lib/naver-map-toast-helpers';
import type { Announcement } from '@/types/announcement';

const ANNOUNCEMENT_TOAST_INTERVAL_MS = 70000;

type NaverMapAnnouncementRuntimeProps = {
    isAnnouncementToastVisible: boolean;
    onAnnouncementToastPayloadChange: (announcement: Announcement | null) => void;
    onAnnouncementToastTitleChange: (title: string) => void;
    onShowAnnouncementToastChange: (show: boolean) => void;
};

export default function NaverMapAnnouncementRuntime({
    isAnnouncementToastVisible,
    onAnnouncementToastPayloadChange,
    onAnnouncementToastTitleChange,
    onShowAnnouncementToastChange,
}: NaverMapAnnouncementRuntimeProps) {
    const { data: bannerAnnouncements = [] } = useBannerAnnouncements(true);
    const announcementToastIndexRef = useRef(0);
    const announcementToastHideTimerRef = useRef<NodeJS.Timeout | null>(null);
    const announcementToastInitialTimerRef = useRef<NodeJS.Timeout | null>(null);

    useEffect(() => {
        if (isAnnouncementToastVisible || !announcementToastHideTimerRef.current) return;
        clearTimeout(announcementToastHideTimerRef.current);
        announcementToastHideTimerRef.current = null;
    }, [isAnnouncementToastVisible]);

    useEffect(() => {
        if (bannerAnnouncements.length === 0) {
            const inactivePlan = resolveNaverAnnouncementToastInactivePlan({
                hasHideTimer: announcementToastHideTimerRef.current !== null,
                hasInitialTimer: announcementToastInitialTimerRef.current !== null,
            });
            onShowAnnouncementToastChange(inactivePlan.shouldShowAnnouncementToast);
            onAnnouncementToastTitleChange(inactivePlan.nextTitle);
            onAnnouncementToastPayloadChange(null);
            if (inactivePlan.shouldClearInitialTimer && announcementToastInitialTimerRef.current) {
                clearTimeout(announcementToastInitialTimerRef.current);
                announcementToastInitialTimerRef.current = null;
            }
            if (inactivePlan.shouldClearHideTimer && announcementToastHideTimerRef.current) {
                clearTimeout(announcementToastHideTimerRef.current);
                announcementToastHideTimerRef.current = null;
            }
            return;
        }

        const showAnnouncementBadge = () => {
            const announcementPlan = resolveNaverAnnouncementToastPlan({
                announcements: bannerAnnouncements,
                currentIndex: announcementToastIndexRef.current,
            });
            if (!announcementPlan.shouldShow || !announcementPlan.announcement) return;

            onAnnouncementToastTitleChange(announcementPlan.announcement.title);
            onAnnouncementToastPayloadChange(announcementPlan.announcement);
            onShowAnnouncementToastChange(true);

            announcementToastIndexRef.current = announcementPlan.nextIndex;

            if (announcementToastHideTimerRef.current) clearTimeout(announcementToastHideTimerRef.current);
            announcementToastHideTimerRef.current = setTimeout(() => {
                announcementToastHideTimerRef.current = null;
                onShowAnnouncementToastChange(false);
            }, announcementPlan.hideDelayMs);
        };

        const schedulePlan = resolveNaverAnnouncementToastSchedulePlan({
            hasExistingInitialTimer: announcementToastInitialTimerRef.current !== null,
            intervalMs: ANNOUNCEMENT_TOAST_INTERVAL_MS,
        });
        if (schedulePlan.shouldClearExistingInitialTimer && announcementToastInitialTimerRef.current) {
            clearTimeout(announcementToastInitialTimerRef.current);
        }
        announcementToastInitialTimerRef.current = setTimeout(showAnnouncementBadge, schedulePlan.initialDelayMs);

        const interval = setInterval(showAnnouncementBadge, schedulePlan.intervalMs);

        return () => {
            const cleanupPlan = resolveNaverAnnouncementToastCleanupPlan({
                hasHideTimer: announcementToastHideTimerRef.current !== null,
                hasInitialTimer: announcementToastInitialTimerRef.current !== null,
            });
            if (cleanupPlan.shouldClearInterval) {
                clearInterval(interval);
            }
            if (cleanupPlan.shouldClearInitialTimer && announcementToastInitialTimerRef.current) {
                clearTimeout(announcementToastInitialTimerRef.current);
                announcementToastInitialTimerRef.current = null;
            }
            if (cleanupPlan.shouldClearHideTimer && announcementToastHideTimerRef.current) {
                clearTimeout(announcementToastHideTimerRef.current);
                announcementToastHideTimerRef.current = null;
            }
        };
    }, [
        bannerAnnouncements,
        onAnnouncementToastPayloadChange,
        onAnnouncementToastTitleChange,
        onShowAnnouncementToastChange,
    ]);

    return null;
}
