'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { AdBanner, AdBannerFormData, AdBannerSchema, FALLBACK_AD_BANNERS, DisplayTarget } from '@/types/ad-banner';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from '@/hooks/use-toast';
import {
    AD_BANNER_URL_VALIDATION_ERROR,
    resolveAdBannerMediaUrl,
    resolveAdBannerPersistenceUrls,
} from '@/lib/ad-banner-url';

const AD_BANNERS_QUERY_KEY = ['ad-banners'];
const AD_BANNER_SELECT = [
    'id',
    'title',
    'description',
    'image_url',
    'video_url',
    'media_type',
    'link_url',
    'is_active',
    'priority',
    'display_target',
    'created_at',
    'updated_at',
    'created_by',
].join(', ');
type AdBannerDatabaseRow = {
    id: string;
    title: string;
    description: string | null;
    image_url: string | null;
    video_url: string | null;
    media_type: 'image' | 'video' | 'none';
    link_url: string | null;
    is_active: boolean;
    priority: number;
    display_target: DisplayTarget[];
    created_at: string;
    updated_at: string;
    created_by: string | null;
};

type AdBannerPersistenceRow = Pick<AdBannerDatabaseRow, 'image_url' | 'video_url' | 'media_type' | 'link_url'>;

type AdBannerPersistenceInput = {
    image_url?: unknown;
    video_url?: unknown;
    media_type?: unknown;
    link_url?: unknown;
};


type AdBannerUpdate = Partial<Omit<AdBannerDatabaseRow, 'id' | 'created_at' | 'updated_at' | 'created_by'>>;

function resolvePersistedBannerUrls(data: AdBannerPersistenceInput) {
    const resolvedUrls = resolveAdBannerPersistenceUrls({
        image_url: data.image_url,
        video_url: data.video_url,
        media_type: data.media_type ?? 'none',
        link_url: data.link_url,
    });
    if (!resolvedUrls) {
        throw new Error(AD_BANNER_URL_VALIDATION_ERROR);
    }

    return resolvedUrls;
}

function isAdBannerRow(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function mapAdBannerRow(value: unknown): AdBanner | null {
    if (!isAdBannerRow(value)) return null;

    const row = value;
    if (typeof row.link_url !== 'string' && row.link_url !== null) return null;

    const resolvedUrls = resolveAdBannerPersistenceUrls({
        image_url: row.image_url,
        video_url: row.video_url,
        media_type: row.media_type,
        link_url: row.link_url,
    });
    if (!resolvedUrls) return null;

    const parsed = AdBannerSchema.safeParse({
        ...row,
        link_url: null,
    });
    if (!parsed.success) return null;

    return {
        id: parsed.data.id,
        title: parsed.data.title,
        description: parsed.data.description,
        image_url: resolvedUrls.image_url,
        video_url: resolvedUrls.video_url,
        media_type: resolvedUrls.media_type,
        link_url: resolvedUrls.link_url,
        is_active: parsed.data.is_active,
        priority: parsed.data.priority,
        display_target: [...parsed.data.display_target],
        created_at: parsed.data.created_at,
        updated_at: parsed.data.updated_at,
        created_by: parsed.data.created_by,
    };
}

function requireAdBannerRow(value: unknown): AdBanner {
    const banner = mapAdBannerRow(value);
    if (!banner) throw new Error(AD_BANNER_URL_VALIDATION_ERROR);
    return banner;
}

function mapAdBannerRows(rows: readonly unknown[] | null): AdBanner[] {
    if (!rows) return [];
    return rows.map(requireAdBannerRow);
}


function createAdBannerUpdate(
    data: Partial<AdBannerFormData>,
    persistedUrls: AdBannerPersistenceRow,
): AdBannerUpdate {
    const resolvedUrls = resolvePersistedBannerUrls({
        image_url: data.image_url === undefined ? persistedUrls.image_url : data.image_url,
        video_url: data.video_url === undefined ? persistedUrls.video_url : data.video_url,
        media_type: data.media_type === undefined ? persistedUrls.media_type : data.media_type,
        link_url: data.link_url === undefined ? persistedUrls.link_url : data.link_url,
    });

    return {
        ...data,
        ...resolvedUrls,
    };
}

async function getPersistedBannerUrls(id: string): Promise<AdBannerPersistenceRow> {
    const { data, error } = await supabase
        .from('ad_banners')
        .select('image_url, video_url, media_type, link_url')
        .eq('id', id)
        .single()
        .overrideTypes<AdBannerPersistenceRow, { merge: false }>();

    if (error || !data) {
        throw new Error('배너 정보를 확인할 수 없습니다.');
    }

    return resolvePersistedBannerUrls(data);
}

/**
 * 모든 광고 배너 조회 (관리자용)
 */
export function useAdBannersAdmin(enabled = true) {
    const { isAdmin } = useAuth();

    return useQuery({
        queryKey: [...AD_BANNERS_QUERY_KEY, 'admin'],
        queryFn: async (): Promise<AdBanner[]> => {
            const { data, error } = await supabase
                .from('ad_banners')
                .select(AD_BANNER_SELECT)
                .order('priority', { ascending: false })
                .overrideTypes<AdBannerDatabaseRow[], { merge: false }>();

            if (error) {
                console.error('광고 배너 조회 실패:');
                throw error;
            }

            return mapAdBannerRows(data);
        },
        enabled: isAdmin && enabled,
        staleTime: 5 * 60 * 1000, // 5분
    });
}

/**
 * 활성화된 광고 배너 조회 (공개용)
 */
export function useActiveAdBanners(
    displayTarget?: DisplayTarget,
    options: { enabled?: boolean } = {},
) {
    return useQuery({
        queryKey: [...AD_BANNERS_QUERY_KEY, 'active', displayTarget],
        queryFn: async (): Promise<AdBanner[]> => {
            try {
                let query = supabase
                    .from('ad_banners')
                    .select(AD_BANNER_SELECT)
                    .eq('is_active', true)
                    .order('priority', { ascending: false });

                // display_target 필터링
                if (displayTarget) {
                    query = query.contains('display_target', [displayTarget]);
                }

                const { data, error } = await query
                    .overrideTypes<AdBannerDatabaseRow[], { merge: false }>();

                if (error) {
                    return displayTarget
                        ? FALLBACK_AD_BANNERS.filter(b => b.display_target.includes(displayTarget))
                        : FALLBACK_AD_BANNERS;
                }

                // 데이터가 없으면 폴백
                if (!data || data.length === 0) {
                    return displayTarget
                        ? FALLBACK_AD_BANNERS.filter(b => b.display_target.includes(displayTarget))
                        : FALLBACK_AD_BANNERS;
                }

                return mapAdBannerRows(data);
            } catch {
                return displayTarget
                    ? FALLBACK_AD_BANNERS.filter(b => b.display_target.includes(displayTarget))
                    : FALLBACK_AD_BANNERS;
            }
        },
        enabled: options.enabled ?? true,
        staleTime: 5 * 60 * 1000, // 5분
        gcTime: 10 * 60 * 1000, // 10분
    });
}

/**
 * 사이드바용 광고 배너
 */
export function useSidebarAdBanners() {
    return useActiveAdBanners('sidebar');
}

/**
 * 모바일 팝업용 광고 배너 (호환성 유지 용도)
 */
export function useMobilePopupAdBanners() {
    return usePopupAdBanners();
}

/**
 * 팝업형 광고 배너 (모바일/데스크탑 통합)
 */
export function usePopupAdBanners(options: { enabled?: boolean } = {}) {
    return useActiveAdBanners('mobile_popup', options);
}

/**
 * 광고 배너 생성
 */
export function useCreateAdBanner() {
    const queryClient = useQueryClient();
    const { user } = useAuth();

    return useMutation({
        mutationFn: async (data: AdBannerFormData): Promise<AdBanner> => {
            const resolvedUrls = resolvePersistedBannerUrls(data);
            const { data: result, error } = await supabase
                .from('ad_banners')
                .insert({
                    title: data.title,
                    ...(data.description === undefined ? {} : { description: data.description }),
                    ...resolvedUrls,
                    is_active: data.is_active,
                    priority: data.priority,
                    display_target: [...data.display_target],
                    ...(user?.id === undefined ? {} : { created_by: user.id }),
                })
                .select(AD_BANNER_SELECT)
                .single()
                .overrideTypes<AdBannerDatabaseRow, { merge: false }>();

            if (error) {
                throw error;
            }

            return requireAdBannerRow(result);
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: AD_BANNERS_QUERY_KEY });
            toast({
                title: '배너 생성 완료',
                description: '새 광고 배너가 생성되었습니다.',
            });
        },
        onError: (error: Error) => {
            console.error('배너 생성 실패:');
            toast({
                title: '배너 생성 실패',
                description: error.message,
                variant: 'destructive',
            });
        },
    });
}

/**
 * 광고 배너 수정
 */
export function useUpdateAdBanner() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: async ({ id, data }: { id: string; data: Partial<AdBannerFormData> }): Promise<AdBanner> => {
            const persistedUrls = await getPersistedBannerUrls(id);
            const { data: result, error } = await supabase
                .from('ad_banners')
                .update(createAdBannerUpdate(data, persistedUrls))
                .eq('id', id)
                .select(AD_BANNER_SELECT)
                .single()
                .overrideTypes<AdBannerDatabaseRow, { merge: false }>();

            if (error) {
                throw error;
            }

            return requireAdBannerRow(result);
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: AD_BANNERS_QUERY_KEY });
            toast({
                title: '배너 수정 완료',
                description: '광고 배너가 수정되었습니다.',
            });
        },
        onError: (error: Error) => {
            console.error('배너 수정 실패:');
            toast({
                title: '배너 수정 실패',
                description: error.message,
                variant: 'destructive',
            });
        },
    });
}

/**
 * 광고 배너 삭제
 */
export function useDeleteAdBanner() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: async (id: string): Promise<void> => {
            const { error } = await supabase
                .from('ad_banners')
                .delete()
                .eq('id', id);

            if (error) {
                throw error;
            }
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: AD_BANNERS_QUERY_KEY });
            toast({
                title: '배너 삭제 완료',
                description: '광고 배너가 삭제되었습니다.',
            });
        },
        onError: (error: Error) => {
            console.error('배너 삭제 실패:');
            toast({
                title: '배너 삭제 실패',
                description: error.message,
                variant: 'destructive',
            });
        },
    });
}

/**
 * 광고 배너 토글 (활성화/비활성화)
 */
export function useToggleAdBanner() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: async ({ id, is_active }: { id: string; is_active: boolean }): Promise<AdBanner> => {
            const persistedUrls = await getPersistedBannerUrls(id);
            resolvePersistedBannerUrls(persistedUrls);

            const { data: result, error } = await supabase
                .from('ad_banners')
                .update({ is_active })
                .eq('id', id)
                .select(AD_BANNER_SELECT)
                .single()
                .overrideTypes<AdBannerDatabaseRow, { merge: false }>();

            if (error) {
                throw error;
            }

            return requireAdBannerRow(result);
        },
        onSuccess: (_, variables) => {
            queryClient.invalidateQueries({ queryKey: AD_BANNERS_QUERY_KEY });
            toast({
                title: variables.is_active ? '배너 활성화' : '배너 비활성화',
                description: `광고 배너가 ${variables.is_active ? '활성화' : '비활성화'}되었습니다.`,
            });
        },
        onError: (error: Error) => {
            console.error('배너 토글 실패:');
            toast({
                title: '배너 상태 변경 실패',
                description: error.message,
                variant: 'destructive',
            });
        },
    });
}

/**
 * 미디어 파일 업로드 (이미지/동영상 지원)
 */
export function useUploadBannerImage() {
    const { user } = useAuth();

    return useMutation({
        mutationFn: async (file: File): Promise<{ url: string; path: string }> => {
            if (!user) {
                throw new Error('로그인이 필요합니다.');
            }

            // 파일 타입 감지
            const isVideo = file.type.startsWith('video/');

            // 확장자 및 content-type 결정
            let extension: string;
            let contentType: string;

            if (isVideo) {
                // 동영상: 원본 확장자 및 content-type 유지
                extension = file.name.split('.').pop()?.toLowerCase() || 'mp4';
                contentType = file.type || 'video/mp4';
            } else {
                // 이미지: webp 변환 (기존 로직)
                extension = 'webp';
                contentType = 'image/webp';
            }

            // 파일명 생성 (안전한 파일명)
            const timestamp = Date.now();
            const randomString = Math.random().toString(36).substring(2, 15);
            const fileName = `${user.id}/${timestamp}_${randomString}.${extension}`;

            const { data: publicUrlData } = supabase.storage
                .from('ad-banner-images')
                .getPublicUrl(fileName);
            const publicUrl = resolveAdBannerMediaUrl(publicUrlData.publicUrl);
            if (!publicUrl) {
                throw new Error(AD_BANNER_URL_VALIDATION_ERROR);
            }

            // Supabase Storage에 업로드
            const { data, error } = await supabase.storage
                .from('ad-banner-images')
                .upload(fileName, file, {
                    cacheControl: '3600',
                    upsert: false,
                    contentType: contentType,
                });

            if (error) {
                throw error;
            }

            return {
                url: publicUrl,
                path: data.path,
            };
        },
        onError: (error: Error) => {
            console.error('이미지 업로드 실패:');
            toast({
                title: '이미지 업로드 실패',
                description: error.message,
                variant: 'destructive',
            });
        },
    });
}

/**
 * 이미지 삭제
 */
export function useDeleteBannerImage() {
    return useMutation({
        mutationFn: async (path: string): Promise<void> => {
            const { error } = await supabase.storage
                .from('ad-banner-images')
                .remove([path]);

            if (error) {
                throw error;
            }
        },
        onError: (error: Error) => {
            console.error('이미지 삭제 실패:');
            toast({
                title: '이미지 삭제 실패',
                description: error.message,
                variant: 'destructive',
            });
        },
    });
}
