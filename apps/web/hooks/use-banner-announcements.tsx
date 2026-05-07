'use client';

import { useQuery } from '@tanstack/react-query';
import { fetchSupabaseRows } from '@/lib/supabase-rest-client';
import { type Announcement, DUMMY_ANNOUNCEMENTS } from '@/types/announcement';

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

const ANNOUNCEMENTS_QUERY_KEY = ['announcements'];
const ANNOUNCEMENT_SELECT = 'id,title,content,is_active,show_on_banner,priority,created_at,updated_at';

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


const getFallbackActiveAnnouncements = (): Announcement[] => {
    return sortAnnouncements(DUMMY_ANNOUNCEMENTS.filter((announcement) => announcement.isActive));
};

const getFallbackBannerAnnouncements = (): Announcement[] => {
    return sortAnnouncements(
        DUMMY_ANNOUNCEMENTS.filter((announcement) => announcement.isActive && announcement.showOnBanner)
    );
};

export function useBannerAnnouncements() {
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

                return sortAnnouncements(rows.map(mapAnnouncementRow));
            } catch (error) {
                console.error('배너 공지사항 조회 중 오류:', error);
                return getFallbackBannerAnnouncements();
            }
        },
        staleTime: 60 * 1000,
        gcTime: 5 * 60 * 1000,
    });
}


export function useActiveAnnouncements() {
    return useQuery({
        queryKey: [...ANNOUNCEMENTS_QUERY_KEY, 'active'],
        queryFn: async (): Promise<Announcement[]> => {
            try {
                const rows = await fetchSupabaseRows<AnnouncementRow>('announcements', [
                    ['select', ANNOUNCEMENT_SELECT],
                    ['is_active', 'eq.true'],
                    ['order', 'priority.desc,created_at.desc'],
                ]);

                return sortAnnouncements(rows.map(mapAnnouncementRow));
            } catch (error) {
                console.error('활성 공지사항 조회 중 오류:', error);
                return getFallbackActiveAnnouncements();
            }
        },
        staleTime: 60 * 1000,
        gcTime: 5 * 60 * 1000,
    });
}
