// [SSR] 서버 컴포넌트 - SEO 최적화 및 초기 로딩 성능 개선
import type { Metadata } from 'next';
import dynamic from 'next/dynamic';
import { MapSkeleton } from '@/components/skeletons/MapSkeleton';

// [OPTIMIZATION] 동적 import로 초기 번들 크기 감소 (예상 TBT 개선: ~200ms)
const HomeClient = dynamic(() => import('./home-client'), {
    loading: () => <MapSkeleton />
});

// [SSR] 메타데이터 생성 - 검색 엔진 최적화
export const metadata: Metadata = {
    title: '쯔동여지도 - 쯔양이 다녀간 맛집을 한눈에! 전국 맛집 지도 플랫폼',
    description: '쯔양이 방문한 전국 및 해외 맛집을 지도에서 확인하세요. 지역별, 카테고리별로 맛집을 검색하고 리뷰를 확인할 수 있습니다.',
    keywords: ['쯔양', '맛집', '맛집지도', '음식', '레스토랑', '쯔양맛집'],
    openGraph: {
        title: '쯔동여지도 - 쯔양 맛집 지도',
        description: '쯔양이 방문한 전국 및 해외 맛집을 지도에서 확인하세요',
        type: 'website',
        locale: 'ko_KR',
        siteName: '쯔동여지도',
        images: [
            {
                url: '/og-image-1.png',
                width: 1200,
                height: 630,
                alt: '쯔동여지도 - 쯔양 맛집 지도',
            },
        ],
    },
    twitter: {
        card: 'summary_large_image',
        title: '쯔동여지도 - 쯔양 맛집 지도',
        description: '쯔양이 방문한 전국 및 해외 맛집을 지도에서 확인하세요',
        images: ['/og-image-1.png'],
    },
};

// [SSR] 서버 컴포넌트 홈 페이지 - 빠른 초기 렌더링
export default function HomePage() {
    return (
        // [OPTIMIZATION] 동적 import가 자체 로딩 처리
        <HomeClient />
    );
}
