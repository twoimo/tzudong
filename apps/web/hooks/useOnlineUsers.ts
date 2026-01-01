'use client';

import { useEffect, useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';

/**
 * 실시간 동시 접속자 수를 조회하는 훅
 * Supabase Presence 채널을 사용하여 실시간 업데이트
 */
export function useOnlineUsers() {
    const { user } = useAuth();
    const [onlineCount, setOnlineCount] = useState(0);

    useEffect(() => {
        const channel = supabase.channel('online-users-global')
            .on('presence', { event: 'sync' }, () => {
                const state = channel.presenceState();
                // 고유 user_id만 카운트 (동일 유저의 여러 탭/브라우저를 1명으로 계산)
                const uniqueUserIds = new Set<string>();
                Object.entries(state).forEach(([presenceKey, presences]) => {
                    (presences as any[]).forEach((presence: any) => {
                        // 로그인 사용자는 user_id로, 비로그인은 presence_ref로 식별
                        uniqueUserIds.add(presence.user_id || presence.presence_ref || presenceKey);
                    });
                });
                setOnlineCount(uniqueUserIds.size);
            })
            .subscribe(async (status) => {
                if (status === 'SUBSCRIBED') {
                    await channel.track({
                        user_id: user?.id || `anonymous-${Math.random().toString(36).slice(2)}`,
                        online_at: new Date().toISOString(),
                    });
                }
            });

        return () => {
            supabase.removeChannel(channel);
        };
    }, [user]);

    return onlineCount;
}
