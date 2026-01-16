'use client';

import { useEffect } from 'react';

/**
 * 관리자 데이터 검수 오버레이
 * - /admin/evaluations 페이지로 이동
 */
export default function AdminReviewsOverlay() {
    useEffect(() => {
        window.dispatchEvent(new CustomEvent('closeOverlayAndNavigate', { detail: '/admin/evaluations' }));
    }, []);

    return (
        <div className="flex flex-col items-center justify-center h-full p-8">
            <div className="animate-spin h-6 w-6 border-2 border-primary border-t-transparent rounded-full" />
            <p className="text-muted-foreground mt-4">데이터 검수 페이지로 이동 중...</p>
        </div>
    );
}
