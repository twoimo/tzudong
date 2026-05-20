'use client';

import { useEffect } from 'react';

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
        console.error('[RootError]', error);
    }, [error]);

    return (
        <div className="flex-1 flex items-center justify-center p-6">
            <div className="text-center max-w-md">
                <div className="text-4xl mb-4">⚠️</div>
                <h2 className="text-xl font-bold text-foreground mb-2">
                    문제가 발생했습니다
                </h2>
                <p className="text-sm text-muted-foreground mb-6">
                    일시적인 오류가 발생했습니다. 다시 시도해 주세요.
                </p>
                <div className="flex gap-3 justify-center">
                    <button
                        type="button"
                        onClick={reset}
                        className="inline-flex h-10 items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                    >
                        다시 시도
                    </button>
                    <button
                        type="button"
                        onClick={() => window.location.href = '/'}
                        className="inline-flex h-10 items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium shadow-sm transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                    >
                        홈으로 이동
                    </button>
                </div>
            </div>
        </div>
    );
}
