'use client';

import { useEffect } from 'react';

import { CenteredErrorState } from '@/components/layout/CenteredErrorState';

/**
 * [PERF] 루트 에러 바운더리 - 에러 발생 시 앱 전체 크래시 방지
 * 사용자에게 친절한 오류 메시지를 표시하고 복구 옵션을 제공합니다.
 */
export default function RootError({
    error,
    reset,
}: {
    error: Error & { digest?: string };
    reset: () => void;
}) {
    useEffect(() => {
        console.error('[RootError]');
    }, [error]);

    return (
        <CenteredErrorState
            title="문제가 발생했습니다"
            description="일시적인 오류가 발생했습니다. 다시 시도해 주세요."
            reset={reset}
            data-root-error-boundary="centered"
        />
    );
}
