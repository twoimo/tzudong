'use client';

import { useEffect } from 'react';
import { UserRound } from 'lucide-react';

import { CenteredErrorState } from '@/components/layout/CenteredErrorState';

/**
 * [PERF] 마이페이지 에러 바운더리
 */
export default function MyPageError({
    error,
    reset,
}: {
    error: Error & { digest?: string };
    reset: () => void;
}) {
    useEffect(() => {
        console.error('[MyPageError]');
    }, [error]);

    return (
        <CenteredErrorState
            title="마이페이지를 불러올 수 없습니다"
            description="일시적인 오류가 발생했습니다. 다시 시도해 주세요."
            reset={reset}
            icon={UserRound}
        />
    );
}
