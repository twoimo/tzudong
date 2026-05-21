import type { MetadataRoute } from 'next';
import { PUBLIC_ROUTES, canonicalUrl } from '@/lib/seo';

export default function sitemap(): MetadataRoute.Sitemap {
    return PUBLIC_ROUTES.map(({ path, changeFrequency, priority }) => ({
        url: canonicalUrl(path),
        changeFrequency,
        priority,
    }));
}
