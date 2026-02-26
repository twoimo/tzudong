'use client';

import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { MapSkeleton } from "@/components/skeletons/MapSkeleton";

function isChatOrInsightRoute(pathname: string | null): boolean {
    if (!pathname) return false;
    return pathname.startsWith('/insights') || pathname.startsWith('/admin/insight');
}

/**
 * [PERF] 루트 로딩 UI - 페이지 전환 시 즉각적 피드백 제공
 * Next.js App Router가 자동으로 Suspense 바운더리를 생성하여
 * 페이지 간 이동 시 빈 화면 대신 이 컴포넌트를 표시합니다.
 *
 * 센터링 전략:
 * - 모바일/태블릿: 상단 헤더(56px) + 하단 네비게이션(60px) 제외 영역 정중앙
 * - 데스크탑(md+): 상단 헤더(64px) 제외 영역 정중앙 (바텀 네비 없음)
 */
export default function RootLoading() {
    const pathname = usePathname();
    const [isMounted, setIsMounted] = useState(false);

    useEffect(() => {
        setIsMounted(true);
    }, []);

    if (!isMounted) {
        return null;
    }

    if (isChatOrInsightRoute(pathname)) {
        return null;
    }

    return (
        <div
            className="hidden min-[1025px]:fixed min-[1025px]:inset-0 min-[1025px]:z-40 min-[1025px]:flex min-[1025px]:items-center min-[1025px]:justify-center min-[1025px]:bg-background
                min-[1025px]:pt-16 min-[1025px]:pb-0"
            aria-label="페이지 로딩 중"
        >
            <MapSkeleton />
        </div>
    );
}
