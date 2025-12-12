'use client';

import { Suspense } from 'react';
import dynamic from 'next/dynamic';

// [OPTIMIZATION] 동적 import로 초기 번들 크기 감소
// 각 섹션 컴포넌트를 개별적으로 lazy loading하여 TBT 개선
const InsightClient = dynamic(() => import('./insight-client'), {
    ssr: false,
    loading: () => (
        <div className="flex-1 flex items-center justify-center bg-muted/30 animate-pulse min-h-screen">
            <div className="text-muted-foreground">인사이트 페이지 로딩 중...</div>
        </div>
    ),
});

// [CLIENT] 클라이언트 컴포넌트로 변환 (ssr: false 사용을 위해)
export default function InsightPage() {
    return (
        <Suspense fallback={
            <div className="flex-1 flex items-center justify-center min-h-screen">
                <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" />
            </div>
        }>
            <InsightClient />
        </Suspense>
    );
}
