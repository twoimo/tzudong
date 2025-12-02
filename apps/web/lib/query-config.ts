import { QueryClient } from '@tanstack/react-query';

export const queryClient = new QueryClient({
    defaultOptions: {
        queries: {
            staleTime: 5 * 60 * 1000, // 5분 - 데이터가 fresh로 간주되는 시간
            gcTime: 10 * 60 * 1000, // 10분 - 캐시 유지 시간 (구 cacheTime)
            refetchOnWindowFocus: false, // 윈도우 포커스 시 자동 재요청 비활성화
            refetchOnMount: false, // 컴포넌트 마운트 시 자동 재요청 비활성화
            retry: 1, // 실패 시 재시도 횟수 제한
        },
    },
});
