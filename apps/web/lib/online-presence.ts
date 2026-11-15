import type { SupabaseClient } from '@supabase/supabase-js';

export type OnlinePresenceChannelName = 'online-users' | 'map-online-users';

type OnlinePresenceClient = Pick<SupabaseClient, 'channel' | 'removeChannel'>;

export function countOnlinePresence(state: Record<string, unknown>) {
    const connections = new Set<string>();

    Object.entries(state).forEach(([presenceKey, presences]) => {
        if (!Array.isArray(presences)) return;

        presences.forEach((presence) => {
            const presenceRef = (presence as { presence_ref?: unknown } | null)?.presence_ref;
            connections.add(typeof presenceRef === 'string' && presenceRef ? presenceRef : presenceKey);
        });
    });

    return connections.size;
}

// Every client on a public presence channel can read every tracked payload, so the
// payload must never carry an account, profile or device identifier.
export function startOnlinePresence({
    client,
    channelName,
    onCount,
}: {
    client: OnlinePresenceClient;
    channelName: OnlinePresenceChannelName;
    onCount: (count: number) => void;
}) {
    const channel = client.channel(channelName)
        .on('presence', { event: 'sync' }, () => {
            onCount(countOnlinePresence(channel.presenceState()));
        })
        .subscribe((status) => {
            if (status === 'SUBSCRIBED') {
                void channel.track({ online_at: new Date().toISOString() });
            }
        });

    return () => {
        void client.removeChannel(channel);
    };
}
