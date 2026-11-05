import { describe, expect, test } from 'bun:test';

import { AdBannerSchema } from '../types/ad-banner';

const banner = {
    id: 'f3733e87-deeb-495d-ae3a-6de06d6e6d47',
    title: '배너',
    description: null,
    image_url: null,
    video_url: null,
    media_type: 'none' as const,
    link_url: null,
    is_active: true,
    priority: 1,
    display_target: ['sidebar'] as const,
    created_by: null,
};

describe('AdBannerSchema timestamps', () => {
    test('accepts Postgres timestamptz offsets used by the banner API', () => {
        const parsed = AdBannerSchema.safeParse({
            ...banner,
            created_at: '2026-05-30T08:38:32.061779+00:00',
            updated_at: '2026-07-13T08:09:40.331572+00:00',
        });

        expect(parsed.success).toBe(true);
    });

    test('rejects a timestamp without a timezone', () => {
        const parsed = AdBannerSchema.safeParse({
            ...banner,
            created_at: '2026-05-30T08:38:32.061779',
            updated_at: '2026-07-13T08:09:40.331572Z',
        });

        expect(parsed.success).toBe(false);
    });
});
