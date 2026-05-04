// [SSR] 서버 컴포넌트 - SEO 메타데이터와 가벼운 홈 클라이언트 로더
import type { Metadata } from 'next';
import { HomeLandingShell } from './home-landing-shell';
import HomeMapIsland from './home-map-island';

// [SSR] 메타데이터 생성 - 검색 엔진 최적화
export const metadata: Metadata = {
    title: '쯔동여지도 - 쯔양이 다녀간 맛집을 한눈에!',
    description: '쯔양이 방문한 전국 및 해외 맛집을 지도에서 확인하세요. 지역별, 카테고리별로 맛집을 검색하고 리뷰를 확인할 수 있습니다.',
    keywords: ['쯔양', '맛집', '맛집지도', '음식', '레스토랑', '쯔양맛집'],
    openGraph: {
        title: '쯔동여지도 - 쯔양이 다녀간 맛집을 한눈에!',
        description: '쯔양이 방문한 전국 및 해외 맛집을 지도에서 확인하세요',
        type: 'website',
        locale: 'ko_KR',
        siteName: '쯔동여지도',
        images: [
            {
                url: '/og-image-20260213.png',
                width: 1200,
                height: 630,
                alt: '쯔동여지도 - 쯔양이 다녀간 맛집을 한눈에!',
            },
        ],
    },
    twitter: {
        card: 'summary_large_image',
        title: '쯔동여지도 - 쯔양이 다녀간 맛집을 한눈에!',
        description: '쯔양이 방문한 전국 및 해외 맛집을 지도에서 확인하세요',
        images: ['/og-image-20260213.png'],
    },
};

// [SSR] 서버 컴포넌트 홈 페이지 - 첫 화면은 앱 소유 랜딩 셸로 그리고 지도 런타임은 HomeMapIsland가 활성화합니다.
export default function HomePage() {
    return (
        <HomeMapIsland>
            <HomeLandingShell />
        </HomeMapIsland>
    );
}
