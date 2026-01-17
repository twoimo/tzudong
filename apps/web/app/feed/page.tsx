'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import FeedContent from '@/components/feed/FeedContent';
import { useDeviceType } from '@/hooks/useDeviceType';

/**
 * 피드 페이지 (모바일/태블릿)
 * - FeedContent 컴포넌트를 전체 페이지로 렌더링
 * - 데스크탑에서는 접근 불가 (홈으로 리다이렉트)
 */
import { Suspense } from 'react';

// ... (imports)

function FeedPageContent() {
    const { isMobileOrTablet } = useDeviceType();
    const router = useRouter();

    const [isMounted, setIsMounted] = useState(false);

    useEffect(() => {
        setIsMounted(true);
        // [DESKTOP CHECK] Mount 후 화면 너비 확인하여 데스크탑이면 리다이렉트
        // useDeviceType 훅 초기값(false) 의존성 제거
        if (window.innerWidth > 1024) {
            router.replace('/');
        }
    }, [router]);

    // Mount 전에는 아무것도 렌더링하지 않음 (Hydration Mismatch 방지)
    if (!isMounted) return null;

    // Desktop일 경우(useEffect에서 감지되겠지만) 렌더링 방지
    // 단, SSR/Hydration 과정에서는 일단 렌더링될 수 있음
    if (typeof window !== 'undefined' && window.innerWidth > 1024) return null;

    return (
        <div className="h-full w-full bg-background overflow-hidden">
            <FeedContent variant="page" />
        </div>
    );
}

export default function FeedPage() {
    return (
        <Suspense fallback={<div className="h-screen w-full flex items-center justify-center">Loading...</div>}>
            <FeedPageContent />
        </Suspense>
    );
}
