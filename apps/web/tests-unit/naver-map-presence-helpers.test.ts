import { describe, expect, test } from 'bun:test';

import {
    resolveNaverInitialOnlineToastPlan,
    resolveNaverOnlineToastDisplayPlan,
} from '../lib/naver-map-presence-helpers';
import { countOnlinePresence, startOnlinePresence } from '../lib/online-presence';

type PresenceClient = Parameters<typeof startOnlinePresence>[0]['client'];

function createFakePresenceClient() {
    const joined: string[] = [];
    const tracked: unknown[] = [];
    const removed: unknown[] = [];
    let onSync = () => {};
    let onStatus: (status: string) => void = () => {};
    let state: Record<string, unknown> = {};
    const channel = {
        on: (_type: string, _filter: unknown, callback: () => void) => {
            onSync = callback;
            return channel;
        },
        subscribe: (callback: (status: string) => void) => {
            onStatus = callback;
            return channel;
        },
        track: async (payload: unknown) => {
            tracked.push(payload);
            return 'ok';
        },
        presenceState: () => state,
    };
    const client = {
        channel: (name: string) => {
            joined.push(name);
            return channel;
        },
        removeChannel: async (removedChannel: unknown) => {
            removed.push(removedChannel);
            return 'ok';
        },
    };

    return {
        channel,
        client: client as unknown as PresenceClient,
        joined,
        removed,
        tracked,
        emitStatus: (status: string) => onStatus(status),
        emitSync: (nextState: Record<string, unknown>) => {
            state = nextState;
            onSync();
        },
    };
}

describe('online presence', () => {
    test('counts each connection once, even when two claim the same user_id', () => {
        expect(countOnlinePresence({
            keyA: [{ user_id: 'same-account', presence_ref: 'ref-a' }],
            keyB: [{ user_id: 'same-account', presence_ref: 'ref-b' }, { presence_ref: 'ref-c' }],
            keyC: [null],
            keyD: 'not-array',
        })).toBe(4);
    });

    test('tracks only an anonymous timestamp after subscribing, counts synced connections, and leaves on cleanup', () => {
        const fake = createFakePresenceClient();
        const counts: number[] = [];
        const stop = startOnlinePresence({
            client: fake.client,
            channelName: 'online-users',
            onCount: (count) => counts.push(count),
        });

        fake.emitStatus('CHANNEL_ERROR');
        expect(fake.tracked).toEqual([]);

        fake.emitStatus('SUBSCRIBED');
        expect(fake.joined).toEqual(['online-users']);
        expect(fake.tracked).toEqual([{ online_at: expect.any(String) }]);

        fake.emitSync({
            first: [{ online_at: '2026-11-16T00:00:00.000Z', presence_ref: 'ref-1' }],
            second: [{ online_at: '2026-11-16T00:00:01.000Z', presence_ref: 'ref-2' }],
        });
        expect(counts).toEqual([2]);

        stop();
        expect(fake.removed).toEqual([fake.channel]);
    });
});

describe('naver map presence helpers', () => {
    test('resolves online toast display plan and hide timer replacement', () => {
        expect(resolveNaverOnlineToastDisplayPlan({
            hasExistingHideTimer: true,
        })).toEqual({
            hideDelayMs: 4000,
            shouldClearExistingHideTimer: true,
            shouldShowOnlineUsers: true,
        });

        expect(resolveNaverOnlineToastDisplayPlan({
            hasExistingHideTimer: false,
            hideDelayMs: 1000,
        })).toEqual({
            hideDelayMs: 1000,
            shouldClearExistingHideTimer: false,
            shouldShowOnlineUsers: true,
        });
    });

    test('schedules initial online toast only once', () => {
        expect(resolveNaverInitialOnlineToastPlan({
            hasExistingInitialTimer: true,
            hasShownInitialToast: false,
        })).toEqual({
            initialDelayMs: 5000,
            nextHasShownInitialToast: true,
            shouldClearExistingInitialTimer: true,
            shouldScheduleInitialToast: true,
        });

        expect(resolveNaverInitialOnlineToastPlan({
            hasShownInitialToast: true,
        })).toEqual({
            initialDelayMs: 5000,
            nextHasShownInitialToast: true,
            shouldClearExistingInitialTimer: false,
            shouldScheduleInitialToast: false,
        });
    });
});
