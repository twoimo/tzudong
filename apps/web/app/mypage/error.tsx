'use client';

import { useEffect } from 'react';
import { Button } from '@/components/ui/button';

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
        console.error('[MyPageError]', error);
    }, [error]);

    return (
        <div className="h-[calc(100vh-64px)] bg-background flex items-center justify-center">
            <div className="text-center max-w-md p-6">
                <div className="text-4xl mb-4">⚠️</div>
                <h2 className="text-lg font-bold mb-2">마이페이지를 불러올 수 없습니다</h2>
                <p className="text-sm text-muted-foreground mb-6">
                    일시적인 오류가 발생했습니다. 다시 시도해 주세요.
                </p>
                <div className="flex gap-3 justify-center">
                    <Button onClick={reset} variant="default">다시 시도</Button>
                    <Button onClick={() => window.location.href = '/'} variant="outline">홈으로</Button>
                </div>
            </div>
        </div>
    );
}
