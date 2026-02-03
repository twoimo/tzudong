'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';

export function QueryProvider({ children }: { children: React.ReactNode }) {
    const [queryClient] = useState(
        () =>
            new QueryClient({
                defaultOptions: {
                    queries: {
                        // [OPTIMIZATION] 쿼리 캐싱 및 재시도 전략 최적화
                        staleTime: 60 * 1000, // 1분 - 데이터 신선도 유지
                        gcTime: 5 * 60 * 1000, // 5분 - 가비지 컬렉션 타이밍
                        retry: 1, // 실패 시 1회만 재시도 (기본값 3)
                        refetchOnWindowFocus: false,
                        refetchOnMount: false,
                        refetchOnReconnect: false,
                    },
                },
            })
    );

    return (
        <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
}
