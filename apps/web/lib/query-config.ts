import { QueryClient } from '@tanstack/react-query';

/**
 * [PERF] 전역 QueryClient 설정 - providers.tsx와 동기화
 * 이 파일은 서버 컴포넌트나 유틸리티에서 사용할 때 참조됩니다.
 */
export const queryClient = new QueryClient({
    defaultOptions: {
        queries: {
            staleTime: 5 * 60 * 1000,    // 5분 - 데이터가 fresh로 간주되는 시간
            gcTime: 30 * 60 * 1000,       // 30분 - 캐시 유지 시간 (뒤로가기 대응)
            refetchOnWindowFocus: false,   // 윈도우 포커스 시 자동 재요청 비활성화
            refetchOnMount: false,         // 컴포넌트 마운트 시 자동 재요청 비활성화
            refetchOnReconnect: false,     // 재연결 시 자동 재요청 비활성화
            retry: 1,                      // 실패 시 재시도 횟수 제한
        },
    },
});
