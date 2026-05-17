'use client';

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchSupabaseRows } from '@/lib/supabase-rest-client';
import type { Announcement } from '@/types/announcement';

const ANNOUNCEMENTS_QUERY_KEY = ['announcements'];
const ANNOUNCEMENT_SELECT = 'id,title,content,is_active,show_on_banner,priority,created_at,updated_at';

interface AnnouncementRow {
    id: string;
    title: string;
    content: string;
    is_active: boolean;
    show_on_banner: boolean;
    priority: number;
    created_at: string;
    updated_at: string;
}

const sortAnnouncements = (announcements: Announcement[]): Announcement[] => {
    return [...announcements].sort((a, b) => {
        if (b.priority !== a.priority) {
            return b.priority - a.priority;
        }
        return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });
};

const mapAnnouncementRow = (row: AnnouncementRow): Announcement => ({
    id: row.id,
    title: row.title,
    content: row.content,
    isActive: row.is_active,
    showOnBanner: row.show_on_banner,
    priority: row.priority,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
});

const parseAnnouncements = (rows: AnnouncementRow[] | null | undefined): Announcement[] => {
    return sortAnnouncements((rows || []).map(mapAnnouncementRow));
};

const getFallbackActiveAnnouncements = async (): Promise<Announcement[]> => {
    const { DUMMY_ANNOUNCEMENTS } = await import('@/types/announcement');
    return sortAnnouncements(DUMMY_ANNOUNCEMENTS.filter((announcement) => announcement.isActive));
};

export function useActiveAnnouncements(enabled = true) {
    return useQuery({
        queryKey: [...ANNOUNCEMENTS_QUERY_KEY, 'active'],
        queryFn: async (): Promise<Announcement[]> => {
            try {
                const rows = await fetchSupabaseRows<AnnouncementRow>('announcements', [
                    ['select', ANNOUNCEMENT_SELECT],
                    ['is_active', 'eq.true'],
                    ['order', 'priority.desc,created_at.desc'],
                ]);

                return parseAnnouncements(rows);
            } catch (error) {
                console.error('활성 공지사항 조회 중 오류:', error);
                return getFallbackActiveAnnouncements();
            }
        },
        enabled,
        staleTime: 60 * 1000,
        gcTime: 5 * 60 * 1000,
    });
}

export function useBannerAnnouncements(enabled = true) {
    const activeAnnouncementsQuery = useActiveAnnouncements(enabled);
    const bannerAnnouncements = useMemo(
        () => (activeAnnouncementsQuery.data ?? []).filter((announcement) => announcement.showOnBanner),
        [activeAnnouncementsQuery.data],
    );

    return {
        ...activeAnnouncementsQuery,
        data: bannerAnnouncements,
    };
}
