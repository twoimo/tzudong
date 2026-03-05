'use client';

import { useEffect, useState, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';

function getPresenceIdentity(value: unknown, fallback: string): string {
    if (typeof value !== 'object' || value === null) return fallback;
    const record = value as Record<string, unknown>;
    const userId = typeof record.user_id === 'string' ? record.user_id : undefined;
    const presenceRef = typeof record.presence_ref === 'string' ? record.presence_ref : undefined;
    return userId || presenceRef || fallback;
}

/**
 * 실시간 동시 접속자 수를 조회하는 훅
 * Supabase Presence 채널을 사용하여 실시간 업데이트
 * [최적화] useRef로 user.id 고정하여 불필요한 재구독 방지
 */
export function useOnlineUsers() {
    const { user } = useAuth();
    const [onlineCount, setOnlineCount] = useState(0);

    // [최적화] user.id를 ref로 저장하여 채널 재구독 방지
    const userIdRef = useRef(user?.id);
    useEffect(() => { userIdRef.current = user?.id; }, [user?.id]);

    useEffect(() => {
        // [최적화] 고유 anonymous ID 생성 (탭당 1회)
        const anonymousId = `anonymous-${Math.random().toString(36).slice(2)}`;

        const channel = supabase.channel('online-users-global')
            .on('presence', { event: 'sync' }, () => {
                const state = channel.presenceState();
                // 고유 user_id만 카운트 (동일 유저의 여러 탭/브라우저를 1명으로 계산)
                const uniqueUserIds = new Set<string>();
                Object.entries(state).forEach(([presenceKey, presences]) => {
                    const normalizedPresences = Array.isArray(presences) ? presences : [];
                    normalizedPresences.forEach((presence) => {
                        uniqueUserIds.add(getPresenceIdentity(presence, presenceKey));
                    });
                });
                setOnlineCount(uniqueUserIds.size);
            })
            .subscribe(async (status) => {
                if (status === 'SUBSCRIBED') {
                    await channel.track({
                        user_id: userIdRef.current || anonymousId,
                        online_at: new Date().toISOString(),
                    });
                }
            });

        return () => {
            supabase.removeChannel(channel);
        };
    }, []); // 의존성 배열 비움 - 최초 마운트 시만 구독

    return onlineCount;
}
