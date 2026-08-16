'use client';

import { supabase } from '@/integrations/supabase/client';
import { countUniqueNaverPresenceUsers } from '@/lib/naver-map-presence-helpers';

type NaverMapPresenceOptions = {
    onSync: (count: number) => void;
    onInterval: () => void;
    intervalMs: number;
};

export function startNaverMapPresence({ onSync, onInterval, intervalMs }: NaverMapPresenceOptions) {
    const channel = supabase.channel('map-online-users')
        .on('presence', { event: 'sync' }, () => {
            onSync(countUniqueNaverPresenceUsers(channel.presenceState()));
        })
        .subscribe(async (status) => {
            if (status === 'SUBSCRIBED') {
                await channel.track({
                    user_id: `map-user-${crypto.randomUUID()}`,
                    online_at: new Date().toISOString(),
                });
            }
        });

    const interval = window.setInterval(onInterval, intervalMs);

    return () => {
        window.clearInterval(interval);
        void supabase.removeChannel(channel);
    };
}
