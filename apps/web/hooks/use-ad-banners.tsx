'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { AdBanner, AdBannerFormData, FALLBACK_AD_BANNERS, DisplayTarget } from '@/types/ad-banner';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from '@/hooks/use-toast';

const AD_BANNERS_QUERY_KEY = ['ad-banners'];

/**
 * 모든 광고 배너 조회 (관리자용)
 */
export function useAdBannersAdmin() {
    const { isAdmin } = useAuth();

    return useQuery({
        queryKey: [...AD_BANNERS_QUERY_KEY, 'admin'],
        queryFn: async (): Promise<AdBanner[]> => {
            const { data, error } = await (supabase as any)
                .from('ad_banners')
                .select('*')
                .order('priority', { ascending: false });

            if (error) {
                console.error('광고 배너 조회 실패:', error);
                throw error;
            }

            return data || [];
        },
        enabled: isAdmin,
        staleTime: 5 * 60 * 1000, // 5분
    });
}

/**
 * 활성화된 광고 배너 조회 (공개용)
 */
export function useActiveAdBanners(displayTarget?: DisplayTarget) {
    return useQuery({
        queryKey: [...AD_BANNERS_QUERY_KEY, 'active', displayTarget],
        queryFn: async (): Promise<AdBanner[]> => {
            try {
                let query = (supabase as any)
                    .from('ad_banners')
                    .select('*')
                    .eq('is_active', true)
                    .order('priority', { ascending: false });

                // display_target 필터링
                if (displayTarget) {
                    query = query.contains('display_target', [displayTarget]);
                }

                const { data, error } = await query;

                if (error) {
                    console.error('광고 배너 조회 실패:', error);
                    // 폴백 데이터 반환
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

                return data;
            } catch (err) {
                console.error('광고 배너 조회 중 오류:', err);
                return displayTarget
                    ? FALLBACK_AD_BANNERS.filter(b => b.display_target.includes(displayTarget))
                    : FALLBACK_AD_BANNERS;
            }
        },
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
export function usePopupAdBanners() {
    return useActiveAdBanners('mobile_popup');
}

/**
 * 광고 배너 생성
 */
export function useCreateAdBanner() {
    const queryClient = useQueryClient();
    const { user } = useAuth();

    return useMutation({
        mutationFn: async (data: AdBannerFormData): Promise<AdBanner> => {
            const { data: result, error } = await (supabase as any)
                .from('ad_banners')
                .insert({
                    ...data,
                    created_by: user?.id,
                })
                .select()
                .single();

            if (error) {
                throw error;
            }

            return result;
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: AD_BANNERS_QUERY_KEY });
            toast({
                title: '배너 생성 완료',
                description: '새 광고 배너가 생성되었습니다.',
            });
        },
        onError: (error: Error) => {
            console.error('배너 생성 실패:', error);
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
            const { data: result, error } = await (supabase as any)
                .from('ad_banners')
                .update(data)
                .eq('id', id)
                .select()
                .single();

            if (error) {
                throw error;
            }

            return result;
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: AD_BANNERS_QUERY_KEY });
            toast({
                title: '배너 수정 완료',
                description: '광고 배너가 수정되었습니다.',
            });
        },
        onError: (error: Error) => {
            console.error('배너 수정 실패:', error);
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
            const { error } = await (supabase as any)
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
            console.error('배너 삭제 실패:', error);
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
            const { data: result, error } = await (supabase as any)
                .from('ad_banners')
                .update({ is_active })
                .eq('id', id)
                .select()
                .single();

            if (error) {
                throw error;
            }

            return result;
        },
        onSuccess: (_, variables) => {
            queryClient.invalidateQueries({ queryKey: AD_BANNERS_QUERY_KEY });
            toast({
                title: variables.is_active ? '배너 활성화' : '배너 비활성화',
                description: `광고 배너가 ${variables.is_active ? '활성화' : '비활성화'}되었습니다.`,
            });
        },
        onError: (error: Error) => {
            console.error('배너 토글 실패:', error);
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

            // Public URL 가져오기
            const { data: urlData } = supabase.storage
                .from('ad-banner-images')
                .getPublicUrl(data.path);

            return {
                url: urlData.publicUrl,
                path: data.path,
            };
        },
        onError: (error: Error) => {
            console.error('이미지 업로드 실패:', error);
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
            console.error('이미지 삭제 실패:', error);
            toast({
                title: '이미지 삭제 실패',
                description: error.message,
                variant: 'destructive',
            });
        },
    });
}
