'use client';

import { Suspense } from 'react';
import dynamic from 'next/dynamic';
import { InsightSkeleton } from '@/components/ui/skeleton-loaders';

// [OPTIMIZATION] 동적 import로 초기 번들 크기 감소
// 각 섹션 컴포넌트를 개별적으로 lazy loading하여 TBT 개선
const InsightClient = dynamic(() => import('./insight-client'), {
    ssr: false,
    loading: () => <InsightSkeleton />,
});

// [CLIENT] 클라이언트 컴포넌트로 변환 (ssr: false 사용을 위해)
export default function InsightPage() {
    return (
        <Suspense fallback={<InsightSkeleton />}>
            <InsightClient />
        </Suspense>
    );
}
