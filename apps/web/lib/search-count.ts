'use client';

import { supabase } from '@/integrations/supabase/client';

interface SearchCountRpcArgs {
    restaurant_id: string;
    user_id: string | null;
    session_id: string | null;
    ip_address: string | null;
    user_agent: string | null;
}

interface SearchCountRpcResponse {
    success: boolean;
    reason: string;
    message: string;
}

interface SearchCountRpcClient {
    rpc: (
        fn: string,
        args: SearchCountRpcArgs
    ) => Promise<{ data: SearchCountRpcResponse | null; error: { message: string } | null }>;
}

// 세션 ID 생성 (비로그인 사용자용)
function getSessionId(): string {
    if (typeof window === 'undefined') return '';

    let sessionId = localStorage.getItem('search_session_id');
    if (!sessionId) {
        sessionId = `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        localStorage.setItem('search_session_id', sessionId);
    }
    return sessionId;
}

/**
 * 맛집 검색 카운트 증가 (남용 방지 포함)
 * @param restaurantId - 검색한 레스토랑 ID
 * @returns 성공 여부와 메시지
 */
export async function incrementSearchCount(restaurantId: string): Promise<{
    success: boolean;
    reason: string;
    message: string;
}> {
    try {
        // 현재 사용자 정보 가져오기
        const { data: { user } } = await supabase.auth.getUser();

        // 세션 ID (비로그인 사용자용)
        const sessionId = user ? null : getSessionId();

        // RPC 호출
        const rpcClient = supabase as unknown as SearchCountRpcClient;
        const { data, error } = await rpcClient.rpc('increment_search_count', {
            restaurant_id: restaurantId,
            user_id: user?.id || null,
            session_id: sessionId,
            ip_address: null, // 클라이언트에서는 IP 추출 불가
            user_agent: typeof navigator !== 'undefined' ? navigator.userAgent : null,
        });

        if (error) {
            console.error('검색 카운트 증가 실패:', error);
            return {
                success: false,
                reason: 'error',
                message: '검색 카운트 증가에 실패했습니다.',
            };
        }

        // rate limit 초과 시 조용히 처리 (사용자에게 알리지 않음)
        if (data && !data.success && data.reason === 'rate_limit_exceeded') {
            // 로그만 남기고 조용히 성공 처리
            console.info('[Search Count] Rate limit exceeded, but no action needed');
        }

        return data as { success: boolean; reason: string; message: string };
    } catch (err) {
        console.error('검색 카운트 증가 중 오류:', err);
        return {
            success: false,
            reason: 'error',
            message: '검색 카운트 증가 중 오류가 발생했습니다.',
        };
    }
}
