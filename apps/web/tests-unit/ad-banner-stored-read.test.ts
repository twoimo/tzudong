import { beforeAll, describe, expect, mock, test } from 'bun:test';

const SUPABASE_ORIGIN = 'https://project-ref.supabase.co';
const MEDIA_URL = `${SUPABASE_ORIGIN}/storage/v1/object/public/ad-banner-images/campaigns/summer-banner.webp`;

mock.module('@/integrations/supabase/client', () => ({
    supabase: {
        storage: {
            from: (bucket: string) => ({
                getPublicUrl: (path: string) => ({
                    data: {
                        publicUrl: `${SUPABASE_ORIGIN}/storage/v1/object/public/${bucket}/${path}`,
                    },
                }),
            }),
        },
    },
}));
mock.module('@/hooks/use-toast', () => ({ toast: () => ({}) }));
mock.module('@/contexts/AuthContext', () => ({ useAuth: () => ({ isAdmin: true }) }));
mock.module('@tanstack/react-query', () => ({
    useQuery: () => ({}),
    useMutation: () => ({}),
    useQueryClient: () => ({}),
}));

const priorSupabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
process.env.NEXT_PUBLIC_SUPABASE_URL = SUPABASE_ORIGIN;

const { readStoredAdBannerRows, readAdminBannerRows } = await import('../hooks/use-ad-banners.tsx?stored-read');

const base = {
    id: 'f3733e87-deeb-495d-ae3a-6de06d6e6d47',
    title: '배너',
    description: null,
    video_url: null,
    link_url: null,
    is_active: true,
    priority: 100,
    display_target: ['sidebar', 'mobile_popup'],
    created_at: '2025-12-29T12:43:13.278007+00:00',
    updated_at: '2025-12-29T13:01:59.911107+00:00',
    created_by: null,
};

describe('stored banner reads', () => {
    beforeAll(() => {
        process.env.NEXT_PUBLIC_SUPABASE_URL = SUPABASE_ORIGIN;
    });

    test('keeps a banner whose stored type is none while an image URL is present', () => {
        const rows = readStoredAdBannerRows([{
            ...base,
            image_url: MEDIA_URL,
            media_type: 'none',
        }]);

        expect(rows).toHaveLength(1);
        expect(rows[0]?.media_type).toBe('image');
        expect(rows[0]?.image_url).toBe(MEDIA_URL);
    });


    test('shows an operator banner whose destination is a normal https site', () => {
        const rows = readAdminBannerRows([{
            ...base,
            image_url: MEDIA_URL,
            media_type: 'none',
            link_url: 'https://gardens.it.kr/',
        }]);

        expect(rows).toHaveLength(1);
        expect(rows[0]?.media_type).toBe('image');
        expect(rows[0]?.link_url).toBe('https://gardens.it.kr/');
    });
    test('still rejects the list when a row has an untrusted media URL', () => {
        expect(() => readStoredAdBannerRows([
            {
                ...base,
                image_url: MEDIA_URL,
                media_type: 'image',
            },
            {
                ...base,
                id: '11111111-1111-4111-8111-111111111111',
                image_url: 'https://evil.example/banner.webp',
                media_type: 'image',
            },
        ])).toThrow('배너 URL 또는 미디어 유형이 올바르지 않습니다.');
    });
});

process.env.NEXT_PUBLIC_SUPABASE_URL = priorSupabaseUrl;
