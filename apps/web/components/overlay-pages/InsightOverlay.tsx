'use client';

import { useEffect } from 'react';

/**
 * 쯔동여지도 인사이트 오버레이
 * - /admin/insight 페이지로 이동
 */
export default function InsightOverlay() {
    useEffect(() => {
        window.dispatchEvent(new CustomEvent('closeOverlayAndNavigate', { detail: '/admin/insight' }));
    }, []);

    return (
        <div className="flex flex-col items-center justify-center h-full p-8">
            <div className="animate-spin h-6 w-6 border-2 border-primary border-t-transparent rounded-full" />
            <p className="text-muted-foreground mt-4">인사이트 페이지로 이동 중...</p>
        </div>
    );
}
