'use client';

import { useEffect } from 'react';
import { Button } from '@/components/ui/button';

/**
 * [PERF] 글로벌 맵 에러 바운더리
 */
export default function GlobalMapError({
    error,
    reset,
}: {
    error: Error & { digest?: string };
    reset: () => void;
}) {
    useEffect(() => {
        console.error('[GlobalMapError]', error);
    }, [error]);

    return (
        <div className="flex-1 flex items-center justify-center">
            <div className="text-center max-w-md p-6">
                <div className="text-4xl mb-4">🗺️</div>
                <h2 className="text-lg font-bold mb-2">지도를 불러올 수 없습니다</h2>
                <p className="text-sm text-muted-foreground mb-6">
                    일시적인 오류가 발생했습니다. 다시 시도해 주세요.
                </p>
                <Button onClick={reset} variant="default">다시 시도</Button>
            </div>
        </div>
    );
}
