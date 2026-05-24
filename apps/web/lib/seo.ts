import type { Metadata } from 'next';

import { siteConfig } from '@/lib/site-config';

export const SITE_URL = siteConfig.productionUrl;
export const SITE_NAME = siteConfig.name;
export const DEFAULT_TITLE = '쯔동여지도 - 쯔양이 다녀간 맛집 지도';
export const DEFAULT_DESCRIPTION =
    '쯔양 유튜브에 나온 국내·해외 맛집을 지도에서 찾고, 영상·리뷰·도장 깨기까지 확인하세요.';
export const OG_IMAGE_PATH = '/og-image-20260213.png';
export const OG_IMAGE_ALT = '쯔동여지도 - 쯔양이 다녀간 맛집 지도';

export const PUBLIC_ROUTES = [
    { path: '/', changeFrequency: 'daily', priority: 1 },
    { path: '/global-map', changeFrequency: 'weekly', priority: 0.7 },
    { path: '/feed', changeFrequency: 'daily', priority: 0.6 },
    { path: '/stamp', changeFrequency: 'weekly', priority: 0.6 },
    { path: '/leaderboard', changeFrequency: 'weekly', priority: 0.6 },
    { path: '/insights', changeFrequency: 'monthly', priority: 0.5 },
    { path: '/privacy', changeFrequency: 'yearly', priority: 0.3 },
    { path: '/data-deletion', changeFrequency: 'yearly', priority: 0.3 },
] as const;

export const canonicalUrl = (path = '/') => `${SITE_URL}${path.startsWith('/') ? path : `/${path}`}`;

export const noIndexMetadata: Metadata = {
    robots: {
        index: false,
        follow: false,
        googleBot: {
            index: false,
            follow: false,
        },
    },
};

export function buildPublicMetadata({
    title,
    description,
    path,
    keywords,
}: {
    title: string;
    description: string;
    path: string;
    keywords?: string[];
}): Metadata {
    return {
        title,
        description,
        keywords,
        alternates: {
            canonical: path,
        },
        openGraph: {
            title,
            description,
            url: canonicalUrl(path),
            type: 'website',
            locale: 'ko_KR',
            siteName: SITE_NAME,
            images: [
                {
                    url: OG_IMAGE_PATH,
                    width: 1200,
                    height: 630,
                    alt: OG_IMAGE_ALT,
                },
            ],
        },
        twitter: {
            card: 'summary_large_image',
            title,
            description,
            images: [OG_IMAGE_PATH],
        },
    };
}

export const homeJsonLd = [
    {
        '@context': 'https://schema.org',
        '@type': 'WebSite',
        name: SITE_NAME,
        url: SITE_URL,
        description: DEFAULT_DESCRIPTION,
        inLanguage: 'ko-KR',
    },
    {
        '@context': 'https://schema.org',
        '@type': 'WebApplication',
        name: SITE_NAME,
        url: SITE_URL,
        applicationCategory: 'LifestyleApplication',
        operatingSystem: 'Web',
        description: DEFAULT_DESCRIPTION,
        inLanguage: 'ko-KR',
    },
];
