// [SSR] 서버 컴포넌트 - SEO 메타데이터와 홈 지도 런타임
import type { Metadata } from 'next';
import { DEFAULT_DESCRIPTION, DEFAULT_TITLE, homeJsonLd, OG_IMAGE_ALT, OG_IMAGE_PATH, SITE_NAME } from '@/lib/seo';
import { HomeRuntimeShell } from './home-runtime-shell';
import HomeClient from './home-client';

// [SSR] 메타데이터 생성 - 검색 엔진 최적화
export const metadata: Metadata = {
    title: DEFAULT_TITLE,
    description: DEFAULT_DESCRIPTION,
    alternates: {
        canonical: '/',
    },
    keywords: ['쯔양', '맛집', '맛집지도', '음식', '레스토랑', '쯔양맛집'],
    openGraph: {
        title: DEFAULT_TITLE,
        description: DEFAULT_DESCRIPTION,
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
        title: DEFAULT_TITLE,
        description: DEFAULT_DESCRIPTION,
        images: [OG_IMAGE_PATH],
    },
};

// [SSR] 서버 컴포넌트 홈 페이지 - / 진입 즉시 실제 홈 지도 런타임을 시작합니다.
export default function HomePage() {
    return (
        <>
            <script
                type="application/ld+json"
                dangerouslySetInnerHTML={{ __html: JSON.stringify(homeJsonLd).replace(/</g, '\\u003c') }}
            />
            <HomeRuntimeShell>
                <HomeClient />
            </HomeRuntimeShell>
        </>
    );
}
