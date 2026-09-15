import { beforeEach, expect, mock, test } from 'bun:test';

// Isolate module mocks from the shared suite (Bun mock.restore does not unmock modules).
if (process.env.YOUTUBE_KPI_SNAPSHOT_TEST_CHILD !== '1') {
  test('snapshot query runtime regressions in isolated process', () => {
    const child = Bun.spawnSync([process.execPath, 'test', import.meta.path], {
      env: { ...process.env, YOUTUBE_KPI_SNAPSHOT_TEST_CHILD: '1' }, stdout: 'pipe', stderr: 'pipe',
    });
    expect(child.exitCode, new TextDecoder().decode(child.stderr)).toBe(0);
  });
} else {
  type Row = Record<string, string | number | boolean | null>;
  let tables: Record<string, Row[]> = {};
  let failedTable: string | null = null;
  let queryCount = 0;
  let rangeGate: Promise<void> | null = null;
  let singleReads = 0;
  let failRange = false;
  class Query {
    private filters: ((row: Row) => boolean)[] = [];
    private ordering: { key: string; ascending: boolean } | null = null;
    private limitCount = Infinity;
    constructor(private table: string) { queryCount++; }
    select() { return this; }
    ilike(key: string, value: string) {
      let pattern = '';
      for (let index = 0; index < value.length; index++) {
        const char = value[index];
        if (char === '\\') pattern += value[++index].replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        else if (char === '%') pattern += '.*';
        else if (char === '_') pattern += '.';
        else pattern += char.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      }
      const regex = new RegExp(`^${pattern}$`, 'i');
      this.filters.push(row => typeof row[key] === 'string' && regex.test(String(row[key])));
      return this;
    }
    eq(key: string, value: string) { this.filters.push(row => row[key] === value); return this; }
    neq(key: string, value: string) { this.filters.push(row => row[key] != null && row[key] !== value); return this; }
    lte(key: string, value: string) { this.filters.push(row => row[key] != null && String(row[key]) <= value); return this; }
    gt(key: string, value: string) { this.filters.push(row => row[key] != null && String(row[key]) > value); return this; }
    gte(key: string, value: string) { this.filters.push(row => row[key] != null && String(row[key]) >= value); return this; }
    in(key: string, values: string[]) { this.filters.push(row => values.includes(String(row[key]))); return this; }
    order(key: string, options: { ascending: boolean }) { this.ordering = { key, ...options }; return this; }
    limit(count: number) { this.limitCount = count; return this; }
    private result() {
      const data = (tables[this.table] ?? []).filter(row => this.filters.every(filter => filter(row)));
      const order = this.ordering;
      if (order) data.sort((a, b) => (a[order.key]! < b[order.key]! ? -1 : a[order.key] === b[order.key] ? 0 : 1) * (order.ascending ? 1 : -1));
      return { data: data.slice(0, this.limitCount), error: failedTable === this.table ? { code: 'TEST_QUERY_FAILED' } : null };
    }
    async maybeSingle() { singleReads++; const result = this.result(); return { ...result, data: result.data[0] ?? null }; }
    async range(from: number, to: number) { if (rangeGate) await rangeGate; if (failRange) return { data: [], error: { code: 'TEST_QUERY_FAILED' } }; const result = this.result(); return { ...result, data: result.data.slice(from, to + 1) }; }
    then(resolve: (result: ReturnType<Query['result']>) => unknown) { return Promise.resolve(this.result()).then(resolve); }
  }
  mock.module('@/lib/supabase/service-role', () => ({ createSupabaseServiceRoleClient: () => ({ from: (table: string) => new Query(table) }) }));
  const { getLatestYouTubeChannelSnapshot, getYouTubeKpiSnapshotData } = await import('../lib/admin/youtube-kpi-snapshots');
  const latest = '2026-09-08T12:00:00.000Z';
  const target = '2026-09-08T11:00:00.000Z';
  function channel(id: string, bucket: string, subscribers: number): Row {
    return { channel_id: id, bucket_started_at: bucket, fetched_at: bucket,
      channel_title: id, channel_handle: id === 'real-a' ? '@tzuyang6145' : '@otherchannel', subscriber_count: subscribers,
      view_count: subscribers * 10, video_count: 100, hidden_subscriber_count: false,
      subscriber_delta: 999, view_delta: 999, video_delta: 999,
      source: id === 'local-nightly-channel' ? 'LOCAL_TEST_ONLY:NOT_PRODUCTION:nightly-ci:youtube-channel-snapshot-v1' : 'youtube-data-api' };
  }
  function video(bucket = latest): Row {
    return { video_id: 'video-a', title: 'Video', bucket_started_at: bucket, fetched_at: bucket,
      published_at: '2020-01-01T00:00:00.000Z', category_id: null, duration_seconds: 60,
      view_count: bucket === latest ? 200 : 100, like_count: 10, comment_count: 1 };
  }
  beforeEach(() => {
    tables = {}; failedTable = null; queryCount = 0; rangeGate = null; singleReads = 0; failRange = false;
    for (const key of ['YOUTUBE_CHANNEL_ID', 'NEXT_PUBLIC_YOUTUBE_CHANNEL_ID', 'YOUTUBE_CHANNEL_HANDLE', 'NEXT_PUBLIC_YOUTUBE_CHANNEL_HANDLE']) delete process.env[key];
  });
  test('comparison lookup starts while current rows are still pending', async () => {
    tables.youtube_video_kpi_snapshots = [video(), video(target)];
    let release!: () => void;
    rangeGate = new Promise<void>(resolve => { release = resolve; });
    const pending = getYouTubeKpiSnapshotData('1H', { filterByPublishedPeriod: false });
    // Flush the latest-bucket continuation while the row query is explicitly held.
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    const readsBeforeRelease = singleReads;
    release();
    const result = await pending;
    expect(readsBeforeRelease).toBe(2);
    expect(queryCount).toBe(4);
    expect(result?.videos[0]).toMatchObject({ previousViewCount: 100, comparisonStatus: 'compared' });
  });
  test('parallel baseline lookup cannot turn a row query failure into an empty success', async () => {
    tables.youtube_video_kpi_snapshots = [video(), video(target)];
    failRange = true;
    await expect(getYouTubeKpiSnapshotData('1H')).rejects.toThrow('youtube-kpi-snapshot-videos:query_failed');
    expect(singleReads).toBe(2);
  });
  test('repeated calls reread current data instead of sharing cached results', async () => {
    tables.youtube_video_kpi_snapshots = [video()];
    const first = await getYouTubeKpiSnapshotData('ALL');
    tables.youtube_video_kpi_snapshots = [{ ...video(), view_count: 321 }];
    const second = await getYouTubeKpiSnapshotData('ALL');
    expect(first?.videos[0].viewCount).toBe(200);
    expect(second?.videos[0].viewCount).toBe(321);
    expect(queryCount).toBe(4);
  });
  test('skips newest fixture before limit and compares same actual channel', async () => {
    tables.youtube_channel_kpi_snapshots = [channel('local-nightly-channel', '2026-09-08T12:15:00.000Z', 1000),
      channel('real-a', latest, 120), channel('other-b', target, 9000), channel('real-a', '2026-09-08T10:59:00.000Z', 100)];
    expect(await getLatestYouTubeChannelSnapshot('1H')).toMatchObject({ channelId: 'real-a', subscriberCount: 120,
      previousSubscriberCount: 100, subscriberDelta: 20, deltaSource: 'derived-snapshot-comparison' });
  });
  test('latest selection excludes newer unrelated channel and untrusted source', async () => {
    tables.youtube_channel_kpi_snapshots = [channel('other-b', '2026-09-08T12:30:00.000Z', 9000),
      { ...channel('real-a', '2026-09-08T12:15:00.000Z', 1000), source: 'untrusted' },
      { ...channel('real-a', latest, 120), source: 'youtube-data-api-v3' },
      { ...channel('real-a', target, 110), source: 'untrusted' }];
    expect(await getLatestYouTubeChannelSnapshot('1H')).toMatchObject({ channelId: 'real-a', subscriberCount: 120, subscriberDelta: null });
  });
  test('configured channel ID takes precedence over handle and other channels', async () => {
    process.env.YOUTUBE_CHANNEL_ID = ' configured-id ';
    process.env.YOUTUBE_CHANNEL_HANDLE = '@otherchannel';
    tables.youtube_channel_kpi_snapshots = [channel('other-b', latest, 9000), channel('configured-id', target, 120)];
    expect(await getLatestYouTubeChannelSnapshot()).toMatchObject({ channelId: 'configured-id', subscriberCount: 120 });
  });
  test('configured public handle normalizes optional at sign, whitespace and case', async () => {
    process.env.NEXT_PUBLIC_YOUTUBE_CHANNEL_HANDLE = ' Custom_Handle ';
    tables.youtube_channel_kpi_snapshots = [channel('real-a', latest, 9000),
      { ...channel('wildcard-imposter', latest, 9000), channel_handle: '@CustomXHandle' },
      { ...channel('configured-id', target, 120), channel_handle: '@CUSTOM_HANDLE' }];
    expect(await getLatestYouTubeChannelSnapshot()).toMatchObject({ channelId: 'configured-id', subscriberCount: 120 });
  });
  test('configured identity with no match never falls back to another channel', async () => {
    process.env.NEXT_PUBLIC_YOUTUBE_CHANNEL_ID = 'missing-id';
    tables.youtube_channel_kpi_snapshots = [channel('real-a', latest, 9000)];
    expect(await getLatestYouTubeChannelSnapshot()).toBeNull();
  });
  test('malformed wildcard handle fails closed rather than selecting any channel', async () => {
    process.env.YOUTUBE_CHANNEL_HANDLE = '@*';
    tables.youtube_channel_kpi_snapshots = [channel('real-a', latest, 9000)];
    expect(await getLatestYouTubeChannelSnapshot()).toBeNull();
    expect(queryCount).toBe(0);
  });
  test('fixture-only is unavailable without deleting seed', async () => {
    const fixture = channel('local-nightly-channel', latest, 1000);
    tables.youtube_channel_kpi_snapshots = [fixture];
    expect(await getLatestYouTubeChannelSnapshot('1H')).toBeNull();
    expect(tables.youtube_channel_kpi_snapshots).toEqual([fixture]);
  });
  test('real metrics matching seed counts are retained', async () => {
    tables.youtube_channel_kpi_snapshots = [channel('real-a', latest, 1000)];
    expect(await getLatestYouTubeChannelSnapshot()).toMatchObject({ channelId: 'real-a', subscriberCount: 1000, videoCount: 100 });
  });
  test('other channel or seed cannot supply missing comparison or stored period delta', async () => {
    tables.youtube_channel_kpi_snapshots = [channel('real-a', latest, 120), channel('other-b', target, 90), channel('local-nightly-channel', target, 1000)];
    expect(await getLatestYouTubeChannelSnapshot('1H')).toMatchObject({ previousSubscriberCount: null, subscriberDelta: null, deltaSource: 'unavailable' });
  });
  for (const bucket of ['2026-09-08T10:45:00.000Z', '2025-09-08T11:00:00.000Z', '2026-09-08T11:00:01.000Z']) {
    test(`rejects channel and video baseline outside period window: ${bucket}`, async () => {
      tables.youtube_channel_kpi_snapshots = [channel('real-a', latest, 120), channel('real-a', bucket, 100)];
      tables.youtube_video_kpi_snapshots = [video(), video(bucket)];
      expect(await getLatestYouTubeChannelSnapshot('1H')).toMatchObject({ subscriberDelta: null, previousBucketStartedAt: null, comparisonFetchedAt: null });
      const result = await getYouTubeKpiSnapshotData('1H', { filterByPublishedPeriod: false });
      expect(result?.meta?.comparisonBucketStartedAt).toBeNull();
      expect(result?.videos[0]).toMatchObject({ previousViewCount: null, comparisonStatus: 'not_applicable' });
    });
  }
  test('exact baseline produces correct period comparison', async () => {
    tables.youtube_channel_kpi_snapshots = [channel('real-a', latest, 120), channel('real-a', target, 100)];
    tables.youtube_video_kpi_snapshots = [video(), video(target)];
    expect(await getLatestYouTubeChannelSnapshot('1H')).toMatchObject({ subscriberDelta: 20, previousBucketStartedAt: target });
    const result = await getYouTubeKpiSnapshotData('1H', { filterByPublishedPeriod: false });
    expect(result?.videos[0]).toMatchObject({ viewCount: 200, previousViewCount: 100, comparisonStatus: 'compared' });
    expect(result?.meta?.comparisonBucketStartedAt).toBe(target);
  });
  for (const [period, bucket] of [['30MIN', '2026-09-08T11:30:00.000Z'], ['1D', '2026-09-07T12:00:00.000Z'], ['1M', '2026-08-09T12:00:00.000Z']] as const) {
    test(`uses selected ${period} duration rather than latest preceding sample`, async () => {
      tables.youtube_channel_kpi_snapshots = [channel('real-a', latest, 120),
        channel('real-a', '2026-09-08T11:45:00.000Z', 119), channel('real-a', bucket, 100)];
      tables.youtube_video_kpi_snapshots = [video(), video('2026-09-08T11:45:00.000Z'), video(bucket)];
      expect(await getLatestYouTubeChannelSnapshot(period)).toMatchObject({ subscriberDelta: 20, previousBucketStartedAt: bucket });
      expect((await getYouTubeKpiSnapshotData(period, { filterByPublishedPeriod: false }))?.meta?.comparisonBucketStartedAt).toBe(bucket);
    });
  }
  test('empty publication cohort retains source, bucket, coverage and quality metadata', async () => {
    tables.youtube_video_kpi_snapshots = [video(), video(target)];
    const result = await getYouTubeKpiSnapshotData('1H');
    expect(result).toMatchObject({ asOf: latest, period: '1H', totalVideos: 0, videos: [], meta: {
      dataSource: 'youtube-snapshot', latestBucketStartedAt: latest, comparisonBucketStartedAt: target,
      comparisonCoverage: { totalVideos: 0, comparedVideos: 0 },
    } });
    expect(result?.meta?.dataQuality).toBeDefined();
    expect((await getYouTubeKpiSnapshotData('1H', { filterByPublishedPeriod: false }))?.totalVideos).toBe(1);
  });
  test('absent bucket remains unavailable', async () => { expect(await getYouTubeKpiSnapshotData('1H')).toBeNull(); });
  test('query errors fail closed', async () => {
    tables.youtube_channel_kpi_snapshots = [channel('real-a', latest, 100)];
    failedTable = 'youtube_channel_kpi_snapshots';
    expect(await getLatestYouTubeChannelSnapshot('1H')).toBeNull();
  });
  test('ALL preserves stored deltas without period query', async () => {
    tables.youtube_channel_kpi_snapshots = [channel('real-a', latest, 120)];
    expect(await getLatestYouTubeChannelSnapshot('ALL')).toMatchObject({ subscriberDelta: 999, deltaSource: 'snapshot-delta' });
    expect(queryCount).toBe(1);
  });
}
