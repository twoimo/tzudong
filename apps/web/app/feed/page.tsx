'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import FeedContent from '@/components/feed/FeedContent';
import { useDeviceType } from '@/hooks/useDeviceType';

/**
 * 피드 페이지 (모바일/태블릿)
 * - FeedContent 컴포넌트를 전체 페이지로 렌더링
 * - 데스크탑에서는 접근 불가 (홈으로 리다이렉트)
 */
export default function FeedPage() {
    const { isMobileOrTablet } = useDeviceType();
    const router = useRouter();

    useEffect(() => {
        if (isMobileOrTablet === false) {
            router.replace('/');
        }
    }, [isMobileOrTablet, router]);

    // 데스크탑에서는 아무것도 렌더링하지 않음 (리다이렉트 대기)
    if (isMobileOrTablet === false) return null;

    return <FeedContent variant="page" />;
}
