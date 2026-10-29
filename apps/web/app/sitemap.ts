import type { MetadataRoute } from 'next';
import { PUBLIC_ROUTES, canonicalUrl } from '@/lib/seo';

export default function sitemap(): MetadataRoute.Sitemap {
    const lastModified = new Date('2026-09-15T00:00:00.000Z');

    return PUBLIC_ROUTES.map(({ path, changeFrequency, priority }) => ({
        url: canonicalUrl(path),
        lastModified,
        changeFrequency,
        priority,
    }));
}
