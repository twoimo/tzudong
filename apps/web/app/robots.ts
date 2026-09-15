import type { MetadataRoute } from 'next';
import { SITE_URL } from '@/lib/seo';

export default function robots(): MetadataRoute.Robots {
    const disallowedPaths = ['/admin', '/admin/', '/api/', '/auth/', '/home-frame', '/mypage/', '/submissions/', '/user/', '/s/'];

    return {
        rules: [
            {
                userAgent: '*',
                allow: '/',
                disallow: disallowedPaths,
            },
            {
                userAgent: ['GPTBot', 'ChatGPT-User', 'ClaudeBot', 'Claude-Web', 'PerplexityBot', 'Google-Extended', 'Applebot-Extended'],
                allow: '/',
                disallow: disallowedPaths,
            },
        ],
        sitemap: `${SITE_URL}/sitemap.xml`,
    };
}
