'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';

/**
 * [PERF] React Query Provider - 적극적 캐싱으로 페이지 이동 시 데이터 즉시 표시
 *
 * 핵심 전략:
 * - staleTime을 5분으로 설정하여 페이지 이동 시 캐시된 데이터 즉시 표시
 * - gcTime을 30분으로 설정하여 뒤로가기 시에도 데이터 유지
 * - refetchOnMount: false → 이미 캐시된 데이터가 있으면 재요청 안 함
 * - refetchOnWindowFocus: false → 탭 전환 시 불필요한 요청 방지
 */
export function QueryProvider({ children }: { children: React.ReactNode }) {
    const [queryClient] = useState(
        () =>
            new QueryClient({
                defaultOptions: {
                    queries: {
                        // [PERF] 적극적 캐싱 - 페이지 이동 시 즉각적 데이터 표시
                        staleTime: 5 * 60 * 1000,    // 5분 - 이 기간 동안 캐시 데이터를 fresh로 간주
                        gcTime: 30 * 60 * 1000,       // 30분 - 캐시 데이터 유지 기간 (뒤로가기 대응)
                        retry: 1,                      // 실패 시 1회만 재시도
                        refetchOnWindowFocus: false,   // 탭 전환 시 재요청 방지
                        refetchOnMount: false,         // 마운트 시 재요청 방지 (캐시 활용)
                        refetchOnReconnect: false,     // 재연결 시 재요청 방지
                        // [PERF] 네트워크 오류 시 이전 데이터 유지 (에러 화면 방지)
                        placeholderData: (previousData: unknown) => previousData,
                    },
                    mutations: {
                        // [PERF] 뮤테이션 재시도 비활성화 (중복 제출 방지)
                        retry: false,
                    },
                },
            })
    );

    return (
        <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
}
