'use client';

import { useEffect } from 'react';
import { Button } from '@/components/ui/button';

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
                    <Button onClick={reset} variant="default">
                        다시 시도
                    </Button>
                    <Button onClick={() => window.location.href = '/'} variant="outline">
                        홈으로 이동
                    </Button>
                </div>
            </div>
        </div>
    );
}
