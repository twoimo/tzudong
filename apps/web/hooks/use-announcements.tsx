'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Announcement, AnnouncementFormData, DUMMY_ANNOUNCEMENTS } from '@/types/announcement';
import { toast } from 'sonner';

const ANNOUNCEMENTS_QUERY_KEY = ['announcements'];

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

const mapAnnouncementRow = (row: AnnouncementRow): Announcement => {
    return {
        id: row.id,
        title: row.title,
        content: row.content,
        isActive: row.is_active,
        showOnBanner: row.show_on_banner,
        priority: row.priority,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
    };
};

const parseAnnouncements = (rows: AnnouncementRow[] | null | undefined): Announcement[] => {
    return sortAnnouncements((rows || []).map(mapAnnouncementRow));
};

const mapFormDataToPayload = (data: AnnouncementFormData) => {
    return {
        title: data.title.trim(),
        content: data.content.trim(),
        is_active: data.isActive,
        show_on_banner: data.showOnBanner,
        priority: data.priority,
    };
};

const getFallbackActiveAnnouncements = (): Announcement[] => {
    return sortAnnouncements(DUMMY_ANNOUNCEMENTS.filter((announcement) => announcement.isActive));
};

const getFallbackBannerAnnouncements = (): Announcement[] => {
    return sortAnnouncements(
        DUMMY_ANNOUNCEMENTS.filter((announcement) => announcement.isActive && announcement.showOnBanner)
    );
};

/**
 * 모든 공지사항 조회 (관리자용)
 */
export function useAnnouncementsAdmin() {
    const { isAdmin } = useAuth();

    return useQuery({
        queryKey: [...ANNOUNCEMENTS_QUERY_KEY, 'admin'],
        queryFn: async (): Promise<Announcement[]> => {
            const { data, error } = await (supabase as any)
                .from('announcements')
                .select('*')
                .order('priority', { ascending: false })
                .order('created_at', { ascending: false });

            if (error) {
                console.error('관리자 공지사항 조회 실패:', error);
                throw error;
            }

            return parseAnnouncements(data as AnnouncementRow[]);
        },
        enabled: isAdmin,
        staleTime: 60 * 1000,
    });
}

/**
 * 활성 공지사항 조회 (일반 사용자용)
 */
export function useActiveAnnouncements() {
    return useQuery({
        queryKey: [...ANNOUNCEMENTS_QUERY_KEY, 'active'],
        queryFn: async (): Promise<Announcement[]> => {
            try {
                const { data, error } = await (supabase as any)
                    .from('announcements')
                    .select('*')
                    .eq('is_active', true)
                    .order('priority', { ascending: false })
                    .order('created_at', { ascending: false });

                if (error) {
                    console.error('활성 공지사항 조회 실패:', error);
                    return getFallbackActiveAnnouncements();
                }

                return parseAnnouncements(data as AnnouncementRow[]);
            } catch (error) {
                console.error('활성 공지사항 조회 중 오류:', error);
                return getFallbackActiveAnnouncements();
            }
        },
        staleTime: 60 * 1000,
        gcTime: 5 * 60 * 1000,
    });
}

/**
 * 배너 노출 공지사항 조회
 */
export function useBannerAnnouncements() {
    return useQuery({
        queryKey: [...ANNOUNCEMENTS_QUERY_KEY, 'banner'],
        queryFn: async (): Promise<Announcement[]> => {
            try {
                const { data, error } = await (supabase as any)
                    .from('announcements')
                    .select('*')
                    .eq('is_active', true)
                    .eq('show_on_banner', true)
                    .order('priority', { ascending: false })
                    .order('created_at', { ascending: false });

                if (error) {
                    console.error('배너 공지사항 조회 실패:', error);
                    return getFallbackBannerAnnouncements();
                }

                return parseAnnouncements(data as AnnouncementRow[]);
            } catch (error) {
                console.error('배너 공지사항 조회 중 오류:', error);
                return getFallbackBannerAnnouncements();
            }
        },
        staleTime: 60 * 1000,
        gcTime: 5 * 60 * 1000,
    });
}

/**
 * 공지사항 생성
 */
export function useCreateAnnouncement() {
    const queryClient = useQueryClient();
    const { user } = useAuth();

    return useMutation({
        mutationFn: async (data: AnnouncementFormData): Promise<Announcement> => {
            const { data: result, error } = await (supabase as any)
                .from('announcements')
                .insert({
                    ...mapFormDataToPayload(data),
                    created_by: user?.id ?? null,
                })
                .select('*')
                .single();

            if (error) {
                throw error;
            }

            return mapAnnouncementRow(result as AnnouncementRow);
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ANNOUNCEMENTS_QUERY_KEY });
            toast.success('공지사항이 작성되었습니다');
        },
        onError: (error: Error) => {
            console.error('공지사항 작성 실패:', error);
            toast.error(error.message || '공지사항 작성에 실패했습니다');
        },
    });
}

/**
 * 공지사항 수정
 */
export function useUpdateAnnouncement() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: async ({ id, data }: { id: string; data: AnnouncementFormData }): Promise<Announcement> => {
            const { data: result, error } = await (supabase as any)
                .from('announcements')
                .update(mapFormDataToPayload(data))
                .eq('id', id)
                .select('*')
                .single();

            if (error) {
                throw error;
            }

            return mapAnnouncementRow(result as AnnouncementRow);
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ANNOUNCEMENTS_QUERY_KEY });
            toast.success('공지사항이 수정되었습니다');
        },
        onError: (error: Error) => {
            console.error('공지사항 수정 실패:', error);
            toast.error(error.message || '공지사항 수정에 실패했습니다');
        },
    });
}

/**
 * 공지사항 삭제
 */
export function useDeleteAnnouncement() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: async (id: string): Promise<void> => {
            const { error } = await (supabase as any)
                .from('announcements')
                .delete()
                .eq('id', id);

            if (error) {
                throw error;
            }
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ANNOUNCEMENTS_QUERY_KEY });
            toast.success('공지사항이 삭제되었습니다');
        },
        onError: (error: Error) => {
            console.error('공지사항 삭제 실패:', error);
            toast.error(error.message || '공지사항 삭제에 실패했습니다');
        },
    });
}

/**
 * 공지사항 활성화 토글
 */
export function useToggleAnnouncementActive() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: async ({ id, isActive }: { id: string; isActive: boolean }): Promise<Announcement> => {
            const { data: result, error } = await (supabase as any)
                .from('announcements')
                .update({ is_active: isActive })
                .eq('id', id)
                .select('*')
                .single();

            if (error) {
                throw error;
            }

            return mapAnnouncementRow(result as AnnouncementRow);
        },
        onSuccess: (_, variables) => {
            queryClient.invalidateQueries({ queryKey: ANNOUNCEMENTS_QUERY_KEY });
            toast.success(variables.isActive ? '공지사항이 활성화되었습니다' : '공지사항이 비활성화되었습니다');
        },
        onError: (error: Error) => {
            console.error('공지사항 활성 상태 변경 실패:', error);
            toast.error(error.message || '공지사항 상태 변경에 실패했습니다');
        },
    });
}

/**
 * 공지사항 배너 노출 토글
 */
export function useToggleAnnouncementBanner() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: async ({ id, showOnBanner }: { id: string; showOnBanner: boolean }): Promise<Announcement> => {
            const { data: result, error } = await (supabase as any)
                .from('announcements')
                .update({ show_on_banner: showOnBanner })
                .eq('id', id)
                .select('*')
                .single();

            if (error) {
                throw error;
            }

            return mapAnnouncementRow(result as AnnouncementRow);
        },
        onSuccess: (_, variables) => {
            queryClient.invalidateQueries({ queryKey: ANNOUNCEMENTS_QUERY_KEY });
            toast.success(variables.showOnBanner ? '배너 노출이 설정되었습니다' : '배너 노출이 해제되었습니다');
        },
        onError: (error: Error) => {
            console.error('공지사항 배너 상태 변경 실패:', error);
            toast.error(error.message || '배너 노출 상태 변경에 실패했습니다');
        },
    });
}
