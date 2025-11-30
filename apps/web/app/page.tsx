// [SSR] 서버 컴포넌트 - SEO 최적화 및 초기 로딩 성능 개선
import type { Metadata } from 'next';
import { Suspense } from 'react';
import HomeClient from './home-client';

// [SSR] 메타데이터 생성 - 검색 엔진 최적화
export const metadata: Metadata = {
    title: '쯔동여지도 - 쯔양이 다녀간 맛집 지도',
    description: '쯔양이 방문한 전국 및 해외 맛집을 지도에서 확인하세요. 지역별, 카테고리별로 맛집을 검색하고 리뷰를 확인할 수 있습니다.',
    keywords: ['쯔양', '맛집', '맛집지도', '음식', '레스토랑', '쯔양맛집'],
    openGraph: {
        title: '쯔동여지도 - 쯔양 맛집 지도',
        description: '쯔양이 방문한 전국 및 해외 맛집을 지도에서 확인하세요',
        type: 'website',
        locale: 'ko_KR',
    },
    twitter: {
        card: 'summary_large_image',
        title: '쯔동여지도 - 쯔양 맛집 지도',
        description: '쯔양이 방문한 전국 및 해외 맛집을 지도에서 확인하세요',
    },
};

// [SSR] 서버 컴포넌트 홈 페이지 - 빠른 초기 렌더링
export default function HomePage() {
    return (
        // [SSR] Suspense로 스트리밍 렌더링 지원
        <Suspense fallback={
            <div className="flex items-center justify-center h-screen w-screen bg-background">
                <div className="text-center space-y-4">
                    <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto"></div>
                    <p className="text-muted-foreground">지도를 불러오는 중...</p>
                </div>
            </div>
        }>
            {/* [CSR] 모든 클라이언트 로직은 HomeClient로 위임 */}
            <HomeClient />
        </Suspense>
    );
}
