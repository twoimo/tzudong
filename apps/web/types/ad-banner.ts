import { z } from 'zod';

// 광고 배너 Zod 스키마
export const AdBannerSchema = z.object({
    id: z.string().uuid(),
    title: z.string().min(1, '제목을 입력해주세요').max(100, '제목은 100자 이내로 입력해주세요'),
    description: z.string().nullable(),
    image_url: z.string().nullable(),
    video_url: z.string().nullable(),
    media_type: z.enum(['image', 'video', 'none']).default('none'),
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
    video_url: z.string().nullable().optional(),
    media_type: z.enum(['image', 'video', 'none']).default('none'),
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

// 기본 폴백용 (빈 배열 - 더미 데이터 제거됨)
export const FALLBACK_AD_BANNERS: AdBanner[] = [];
