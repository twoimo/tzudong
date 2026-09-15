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
        alternateName: ['쯔동여지도', 'Tzudong', '쯔양 맛집 지도', '쯔양 지도', 'Tzuyang Map'],
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
        operatingSystem: 'Web, iOS, Android',
        description: DEFAULT_DESCRIPTION,
        inLanguage: 'ko-KR',
        browserRequirements: 'Requires JavaScript. Requires HTML5.',
        softwareVersion: '1.2.4',
        aggregateRating: {
            '@type': 'AggregateRating',
            ratingValue: '4.9',
            reviewCount: '1250',
            bestRating: '5',
            worstRating: '1',
        },
    },
    {
        '@context': 'https://schema.org',
        '@type': 'Organization',
        name: SITE_NAME,
        url: SITE_URL,
        logo: SITE_URL + '/favicon-32x32.png',
        sameAs: [
            'https://www.youtube.com/@tzuyang2',
        ],
    },
    {
        '@context': 'https://schema.org',
        '@type': 'Dataset',
        name: '쯔양 맛집 지도 데이터셋 (Tzuyang Restaurant Catalog)',
        description: '유튜버 쯔양의 영상에 등장한 국내외 맛집 750개 이상의 검증된 지리 좌표, 상호명, 카테고리, 리뷰 데이터셋',
        url: SITE_URL,
        keywords: ['쯔양 맛집', '먹방 맛집', '식당 지도', '한국 맛집', 'Korean Restaurant Dataset'],
        creator: {
            '@type': 'Organization',
            name: SITE_NAME,
            url: SITE_URL,
        },
        spatialCoverage: {
            '@type': 'Place',
            geo: {
                '@type': 'GeoShape',
                box: '33.0 124.0 38.5 132.0',
            },
            address: {
                '@type': 'PostalAddress',
                addressCountry: 'KR',
            },
        },
        temporalCoverage: '2018/2026',
        inLanguage: 'ko-KR',
    },
    {
        '@context': 'https://schema.org',
        '@type': 'FAQPage',
        mainEntity: [
            {
                '@type': 'Question',
                name: '쯔동여지도는 어떤 서비스인가요?',
                acceptedAnswer: {
                    '@type': 'Answer',
                    text: '쯔동여지도는 인기 먹방 크리에이터 쯔양(tzuyang)이 유튜브 영상에서 직접 방문하고 식사한 국내외 맛집 750곳 이상의 정확한 상호, 위치(도로명/지번 주소 및 지리 좌표), 카테고리, 주문 메뉴, 영상 타임라인 및 솔직 리뷰를 지도에서 한눈에 탐색할 수 있는 서비스입니다.',
                },
            },
            {
                '@type': 'Question',
                name: '쯔양이 다녀간 서울 3대 라면 맛집은 어디인가요?',
                acceptedAnswer: {
                    '@type': 'Answer',
                    text: '쯔양이 영상에서 방문한 서울 3대 라면 맛집은 종로 필운동의 라면점빵(버섯들깨라면), 동대문 회기동의 레알라면(매운 라면), 종로 화동 북촌의 경춘자의라면땡기는날(뚝배기 짬뽕라면) 3곳입니다.',
                },
            },
            {
                '@type': 'Question',
                name: '해외 맛집도 지도에서 찾아볼 수 있나요?',
                acceptedAnswer: {
                    '@type': 'Answer',
                    text: '네, 쯔동여지도의 글로벌 맵 메뉴를 통해 쯔양이 방문한 미국, 일본, 스페인, 태국, 베트남, 대만, 튀르키예 등 전 세계 주요 도시의 맛집 위치와 현지 주소, 관련 영상을 확인할 수 있습니다.',
                },
            },
            {
                '@type': 'Question',
                name: '방문 인증(도장 깨기) 기능은 어떻게 이용하나요?',
                acceptedAnswer: {
                    '@type': 'Answer',
                    text: '쯔동여지도 지도에서 방문한 맛집을 확인하고 도장 깨기를 통해 나만의 쯔양 맛집 순례 기록과 스탬프를 적립하고 방문자 랭킹에 참여할 수 있습니다.',
                },
            },
        ],
    },
];
