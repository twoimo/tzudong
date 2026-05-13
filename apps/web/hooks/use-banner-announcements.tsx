'use client';

import { useMemo } from 'react';
import { useActiveAnnouncements as useBaseActiveAnnouncements } from '@/hooks/use-announcements';

export function useActiveAnnouncements(enabled = true) {
    return useBaseActiveAnnouncements(enabled);
}

export function useBannerAnnouncements() {
    const activeAnnouncementsQuery = useActiveAnnouncements();
    const bannerAnnouncements = useMemo(
        () => (activeAnnouncementsQuery.data ?? []).filter((announcement) => announcement.showOnBanner),
        [activeAnnouncementsQuery.data],
    );

    return {
        ...activeAnnouncementsQuery,
        data: bannerAnnouncements,
    };
}
