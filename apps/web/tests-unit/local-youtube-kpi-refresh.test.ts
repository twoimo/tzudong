import { expect, test } from 'bun:test';
import { normalizeVideoSnapshot, sameSnapshot, videoIdFromLink } from '../../../backend/supabase/scripts/refresh-local-youtube-kpis.mjs';
const item = {
    id: 'abcdefghijk', snippet: { channelId: `UC${'a'.repeat(22)}`, title: '영상', publishedAt: '2026-01-01T00:00:00Z', categoryId: '24' },
    contentDetails: { duration: 'PT1H2M3S' }, statistics: { viewCount: '1000', likeCount: '20', commentCount: '3' },
};
const bucket = '2026-09-08T10:00:00.000Z';
test('only recognized YouTube links become collection targets', () => {
    expect(videoIdFromLink('https://www.youtube.com/watch?v=abcdefghijk')).toBe('abcdefghijk');
    expect(videoIdFromLink('https://youtu.be/abcdefghijk')).toBe('abcdefghijk');
    expect(videoIdFromLink('https://example.com/watch?v=abcdefghijk')).toBeNull();
    expect(videoIdFromLink('https://youtube.com@evil.example/watch?v=abcdefghijk')).toBeNull();
});
test('valid public statistics preserve exact counts and timestamps', () => {
    const row = normalizeVideoSnapshot(item, bucket);
    expect(row).toMatchObject({ view_count: 1000, like_count: 20, comment_count: 3, duration_seconds: 3723 });
    expect(sameSnapshot(row, { ...row, fetched_at: '2026-09-08T10:00:00+00:00' })).toBe(true);
    expect(sameSnapshot(row, { ...row, view_count: 999 })).toBe(false);
});
test('hidden, invalid and missing statistics are not fabricated as zeros', () => {
    expect(normalizeVideoSnapshot({ ...item, statistics: { viewCount: '1000' } }, bucket)).toBeNull();
    expect(normalizeVideoSnapshot({ ...item, statistics: { ...item.statistics, commentCount: '-1' } }, bucket)).toBeNull();
    expect(normalizeVideoSnapshot({ ...item, statistics: { ...item.statistics, commentCount: '0' } }, bucket)?.comment_count).toBe(0);
});

// Synthetic API payloads test admission only; they are never collection inputs.
import { CHANNEL_HANDLE, fetchChannelSnapshot, normalizeChannelSnapshot, sameChannelSnapshot, insertAndVerifySnapshots } from '../../../backend/supabase/scripts/refresh-local-youtube-kpis.mjs';
const channelItem = {
    id: `UC${'b'.repeat(22)}`, snippet: { title: '쯔양', customUrl: CHANNEL_HANDLE },
    statistics: { subscriberCount: '12300000', viewCount: '4567890123', videoCount: '1234', hiddenSubscriberCount: false },
};
test('channel snapshot maps API fields and never invents history or fixture deltas', () => {
    const row = normalizeChannelSnapshot(channelItem, bucket);
    expect(row).toMatchObject({ channel_id: channelItem.id, channel_handle: CHANNEL_HANDLE, subscriber_count: 12300000,
        view_count: 4567890123, video_count: 1234, source: 'youtube-data-api-v3', previous_bucket_started_at: null,
        subscriber_delta: null, view_delta: null, video_delta: null });
    expect(sameChannelSnapshot(row, { ...row, fetched_at: '2026-09-08T10:00:00+00:00' })).toBe(true);
    expect(sameChannelSnapshot(row, { ...row, subscriber_delta: 0 })).toBe(false);
    expect(sameChannelSnapshot(row, { ...row, source: 'LOCAL_TEST_ONLY' })).toBe(false);
});
test('channel identity, safe counts and hidden subscriber semantics fail closed', () => {
    expect(normalizeChannelSnapshot({ ...channelItem, id: 'local-nightly-channel' }, bucket)).toBeNull();
    expect(normalizeChannelSnapshot({ ...channelItem, snippet: { customUrl: '@other' } }, bucket)).toBeNull();
    expect(normalizeChannelSnapshot(channelItem, 'invalid')).toBeNull();
    for (const value of ['-1', '1.5', '9007199254740992', undefined]) {
        expect(normalizeChannelSnapshot({ ...channelItem, statistics: { ...channelItem.statistics, viewCount: value } }, bucket)).toBeNull();
    }
    expect(normalizeChannelSnapshot({ ...channelItem, statistics: { ...channelItem.statistics, videoCount: '2147483648' } }, bucket)).toBeNull();
    const hidden = normalizeChannelSnapshot({ ...channelItem, statistics: { ...channelItem.statistics, subscriberCount: undefined, hiddenSubscriberCount: true } }, bucket);
    expect(hidden?.subscriber_count).toBeNull();
    expect(hidden?.hidden_subscriber_count).toBe(true);
    expect(normalizeChannelSnapshot({ ...channelItem, statistics: { ...channelItem.statistics, hiddenSubscriberCount: undefined } }, bucket)).toBeNull();
});
test('channel request resolves the actual handle and rejects ambiguous or mismatched responses', async () => {
    const fetcher = async (url: URL) => {
        expect(url.origin + url.pathname).toBe('https://www.googleapis.com/youtube/v3/channels');
        expect(url.searchParams.get('forHandle')).toBe('@tzuyang6145');
        expect(url.searchParams.has('id')).toBe(false);
        return Response.json({ items: [channelItem] });
    };
    expect((await fetchChannelSnapshot('test-key', bucket, fetcher)).channel_id).toBe(channelItem.id);
    for (const items of [[], [channelItem, channelItem], [{ ...channelItem, snippet: { customUrl: '@other' } }]]) {
        await expect(fetchChannelSnapshot('test-key', bucket, async () => Response.json({ items }))).rejects.toThrow();
    }
    await expect(fetchChannelSnapshot('test-key', bucket, async () => { throw Error('private diagnostic test-key'); })).rejects.toThrow('YOUTUBE_CHANNEL_FETCH_FAILED');
});
test('uncertain insert is independently read back once without resubmission', async () => {
    const row = normalizeChannelSnapshot(channelItem, bucket);
    const methods: string[] = [];
    const request = async (_table: string, _query: unknown, init: { method?: string } = {}) => {
        methods.push(init.method ?? 'GET');
        if (init.method === 'POST') throw Error('delivery unknown');
        return Response.json([row]);
    };
    await insertAndVerifySnapshots(request, 'youtube_channel_kpi_snapshots', [row], bucket, 'channel_id', sameChannelSnapshot);
    expect(methods).toEqual(['POST', 'GET']);
});
test('failed or mismatched readbacks cannot certify channel delivery', async () => {
    const row = normalizeChannelSnapshot(channelItem, bucket);
    for (const actual of [[], [{ ...row, video_count: 100 }], [row, row]]) {
        let writes = 0;
        const request = async (_table: string, _query: unknown, init: { method?: string } = {}) => {
            if (init.method === 'POST') { writes++; return new Response(null, { status: 500 }); }
            return Response.json(actual);
        };
        await expect(insertAndVerifySnapshots(request, 'youtube_channel_kpi_snapshots', [row], bucket, 'channel_id', sameChannelSnapshot)).rejects.toThrow('LOCAL_SNAPSHOT_READBACK_MISMATCH');
        expect(writes).toBe(1);
    }
});
