import type { MetadataRoute } from 'next';
import { SITE_NAME, DEFAULT_DESCRIPTION } from '@/lib/seo';

export default function manifest(): MetadataRoute.Manifest {
    return {
        name: `${SITE_NAME} - 쯔양이 다녀간 맛집 지도`,
        short_name: SITE_NAME,
        description: DEFAULT_DESCRIPTION,
        start_url: '/',
        display: 'standalone',
        background_color: '#ffffff',
        theme_color: '#14b8a6',
        icons: [
            {
                src: '/favicon-32x32.png',
                sizes: '32x32',
                type: 'image/png',
            },
            {
                src: '/apple-touch-icon.png',
                sizes: '180x180',
                type: 'image/png',
            },
        ],
        categories: ['food', 'lifestyle', 'navigation', 'travel'],
        lang: 'ko',
        orientation: 'portrait-primary',
    };
}
