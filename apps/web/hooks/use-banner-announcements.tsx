'use client';

import { useQuery } from '@tanstack/react-query';
import { fetchSupabaseRows } from '@/lib/supabase-rest-client';
import type { Announcement } from '@/types/announcement';

const ANNOUNCEMENTS_QUERY_KEY = ['announcements'];
const ANNOUNCEMENT_SELECT = 'id,title,content,is_active,show_on_banner,priority,created_at,updated_at';
const ACTIVE_ANNOUNCEMENTS_STALE_TIME_MS = 5 * 60 * 1000;
const BANNER_ANNOUNCEMENTS_STALE_TIME_MS = 10 * 60 * 1000;
const ANNOUNCEMENTS_GC_TIME_MS = 30 * 60 * 1000;

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
            } catch {
                return getFallbackActiveAnnouncements();
            }
        },
        enabled,
        staleTime: ACTIVE_ANNOUNCEMENTS_STALE_TIME_MS,
        gcTime: ANNOUNCEMENTS_GC_TIME_MS,
    });
}

export function useBannerAnnouncements(enabled = true) {
    return useQuery({
        queryKey: [...ANNOUNCEMENTS_QUERY_KEY, 'banner'],
        queryFn: async (): Promise<Announcement[]> => {
            try {
                const rows = await fetchSupabaseRows<AnnouncementRow>('announcements', [
                    ['select', ANNOUNCEMENT_SELECT],
                    ['is_active', 'eq.true'],
                    ['show_on_banner', 'eq.true'],
                    ['order', 'priority.desc,created_at.desc'],
                ]);

                return parseAnnouncements(rows);
            } catch {
                const fallbackAnnouncements = await getFallbackActiveAnnouncements();
                return fallbackAnnouncements.filter((announcement) => announcement.showOnBanner);
            }
        },
        enabled,
        staleTime: BANNER_ANNOUNCEMENTS_STALE_TIME_MS,
        gcTime: ANNOUNCEMENTS_GC_TIME_MS,
    });
}
