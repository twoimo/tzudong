import { z } from 'zod';

// 광고 배너 Zod 스키마
export const AdBannerSchema = z.object({
    id: z.string().uuid(),
    title: z.string().min(1, '제목을 입력해주세요').max(100, '제목은 100자 이내로 입력해주세요'),
    description: z.string().nullable(),
    image_url: z.string().nullable(),
    link_url: z.string().url().nullable().or(z.literal('')),
    is_active: z.boolean().default(true),
    priority: z.number().int().min(0).max(1000).default(0),
    display_target: z.array(z.enum(['sidebar', 'mobile_popup'])).default(['sidebar', 'mobile_popup']),
    created_at: z.string().datetime(),
    updated_at: z.string().datetime(),
    created_by: z.string().uuid().nullable(),
});

// TypeScript 타입
export type AdBanner = z.infer<typeof AdBannerSchema>;

// 광고 배너 표시 위치 타입
export type DisplayTarget = 'sidebar' | 'mobile_popup';

// 광고 배너 생성/수정용 스키마
export const AdBannerFormSchema = z.object({
    title: z.string().min(1, '제목을 입력해주세요').max(100, '제목은 100자 이내로 입력해주세요'),
    description: z.string().nullable().optional(),
    image_url: z.string().nullable().optional(),
    link_url: z.string().url('유효한 URL을 입력해주세요').nullable().optional().or(z.literal('')),
    is_active: z.boolean().default(true),
    priority: z.number().int().min(0).max(1000).default(0),
    display_target: z.array(z.enum(['sidebar', 'mobile_popup'])).default(['sidebar', 'mobile_popup']),
});

export type AdBannerFormData = z.infer<typeof AdBannerFormSchema>;

// 이미지 업로드 응답 타입
export interface ImageUploadResponse {
    url: string;
    path: string;
}

// 기본 더미 데이터 (Supabase 연결 전 폴백용)
export const FALLBACK_AD_BANNERS: AdBanner[] = [
    {
        id: 'fallback-1',
        title: '광고주 모집',
        description: '귀하의 맛집을\n천하에 널리 알리옵소서',
        image_url: null,
        link_url: null,
        is_active: true,
        priority: 100,
        display_target: ['sidebar', 'mobile_popup'],
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        created_by: null,
    },
    {
        id: 'fallback-2',
        title: '명당 자리',
        description: '수많은 미식가들이\n오가는 길목이옵니다',
        image_url: null,
        link_url: null,
        is_active: true,
        priority: 90,
        display_target: ['sidebar', 'mobile_popup'],
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        created_by: null,
    },
    {
        id: 'fallback-3',
        title: '동반 성장',
        description: '쯔동여지도와 더불어\n큰 뜻을 펼치시옵소서',
        image_url: null,
        link_url: null,
        is_active: true,
        priority: 80,
        display_target: ['sidebar', 'mobile_popup'],
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        created_by: null,
    },
];
