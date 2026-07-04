import type { Metadata } from 'next';

import { siteConfig } from '@/lib/site-config';

export const SITE_URL = siteConfig.productionUrl;
export const SITE_NAME = siteConfig.name;
export const DEFAULT_BROWSER_TITLE_LABEL = '쯔양이 다녀간 맛집 지도';
export const DEFAULT_TITLE = `${DEFAULT_BROWSER_TITLE_LABEL} - ${SITE_NAME}`;
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

const CONTROL_AND_BIDI_PATTERN = /[\u0000-\u001f\u007f-\u009f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/g;
const WHITESPACE_PATTERN = /\s+/g;
const DEFAULT_BROWSER_TITLE_LABEL_MAX_CODE_POINTS = 60;

type BrowserTitleOptions = {
    fallbackLabel?: string | null;
    maxCodePoints?: number;
};

function normalizeBrowserTitleText(value: string | null | undefined): string {
    return value?.replace(WHITESPACE_PATTERN, ' ').replace(CONTROL_AND_BIDI_PATTERN, '').trim() ?? '';
}

export function truncateBrowserTitleLabel(
    label: string | null | undefined,
    maxCodePoints = DEFAULT_BROWSER_TITLE_LABEL_MAX_CODE_POINTS,
): string {
    const normalized = normalizeBrowserTitleText(label);
    const limit = Math.max(0, Math.floor(maxCodePoints));

    if (normalized.length === 0 || limit === 0) {
        return '';
    }

    const codePoints = Array.from(normalized);

    if (codePoints.length <= limit) {
        return normalized;
    }

    return `${codePoints.slice(0, limit).join('')}…`;
}

export function sanitizeBrowserTitleLabel(
    label: string | null | undefined,
    maxCodePoints = DEFAULT_BROWSER_TITLE_LABEL_MAX_CODE_POINTS,
): string {
    const sanitized = truncateBrowserTitleLabel(label, maxCodePoints);

    return sanitized.length > 0 ? sanitized : DEFAULT_BROWSER_TITLE_LABEL;
}

export function buildBrowserTitle(label: string | null | undefined, options: BrowserTitleOptions = {}): string {
    const fallbackLabel = sanitizeBrowserTitleLabel(options.fallbackLabel ?? DEFAULT_BROWSER_TITLE_LABEL, options.maxCodePoints);
    const sanitizedLabel = truncateBrowserTitleLabel(label, options.maxCodePoints) || fallbackLabel;

    return `${sanitizedLabel} - ${SITE_NAME}`;
}

export function buildScopedBrowserTitle(
    labels: Array<string | null | undefined>,
    options: BrowserTitleOptions = {},
): string {
    const fallbackLabel = sanitizeBrowserTitleLabel(options.fallbackLabel ?? DEFAULT_BROWSER_TITLE_LABEL, options.maxCodePoints);
    const sanitizedLabels = labels
        .map((label) => truncateBrowserTitleLabel(label, options.maxCodePoints))
        .filter((label) => label.length > 0);
    const titleLabels = sanitizedLabels.length > 0 ? sanitizedLabels : [fallbackLabel];

    return `${titleLabels.join(' - ')} - ${SITE_NAME}`;
}

export function buildNoIndexMetadata({
    title,
    description,
}: {
    title: string;
    description?: string;
}): Metadata {
    return {
        ...noIndexMetadata,
        title,
        ...(description ? { description } : {}),
    };
}

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
