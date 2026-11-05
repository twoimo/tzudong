import { afterEach, expect, test } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildPublicPopularity } from '../scripts/build-public-popularity';

const dirs: string[] = [];
afterEach(async () => { for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true }); });

const metric = { video_id: 'abc123DEF45', view_count: 123,
  fetched_at: '2026-07-01T00:00:00Z', bucket_started_at: '2026-07-01T00:00:00Z' };

async function build(patch: Record<string, unknown> = {}, metricRows: unknown[] = [metric]) {
  const dir = await mkdtemp(join(tmpdir(), 'tzudong-popularity-boundary-')); dirs.push(dir);
  const row = { id: 'approved-a', name: '한식당', approved_name: '승인 식당명', status: 'approved', lat: 37.5, lng: 127,
    road_address: '서울특별시 강남구', categories: ['한식'], youtube_link: 'https://www.youtube.com/watch?v=abc123DEF45', ...patch };
  await writeFile(join(dir, 'source.json'), JSON.stringify({ rows: [row] }));
  await writeFile(join(dir, 'metrics.json'), JSON.stringify({ rows: metricRows }));
  return buildPublicPopularity(join(dir, 'source.json'), join(dir, 'metrics.json'), 'a'.repeat(40));
}

test('rejects unapproved source rows before merge rather than granting a public tier', async () => {
  for (const status of ['pending', 'deleted', null]) {
    await expect(build({ status })).rejects.toThrow('popularity_source_not_approved');
  }
});

test('malformed count values remain missing instead of coercing into a public flame', async () => {
  for (const view_count of [true, false, [123], { valueOf: 123 }, null, '', '1.5', -1]) {
    const result = await build({}, [{ ...metric, view_count }]);
    expect(result.evidence.groups[0].viewCount).toBeNull();
    expect(result.publication.entries[0].tier).toBe('standard');
  }
});

test('conflicting metrics for the same video fail in either input order', async () => {
  const other = { ...metric, view_count: 456 };
  for (const rows of [[metric, other], [other, metric]]) {
    await expect(build({}, rows)).rejects.toThrow('popularity_metrics_video_conflict');
  }
  expect((await build({}, [metric, { ...metric }])).evidence.groups[0].viewCount).toBe(123);
});

test('rejects missing, blank, nonfinite and out-of-range source coordinates before merge coerces them', async () => {
  for (const patch of [{ lat: null }, { lng: null }, { lat: '' }, { lng: ' ' }, { lat: 'NaN' }, { lat: 91 }, { lng: -181 }, { lat: 0, lng: 0 }]) {
    await expect(build(patch)).rejects.toThrow('popularity_source_coordinates_invalid');
  }
});

test('preserves approved names and records the actual P98/P95/P85 policy for valid inputs', async () => {
  const result = await build();
  expect(result.evidence.groups[0].name).toBe('승인 식당명');
  expect(result.evidence.groups[0].cohort).toBe('domestic');
  expect(result.evidence.policy).toBe('map-cohort-max-linked-video-views-nearest-rank-p98-p95-p85-v2');
  // One known group reaches all three nearest-rank thresholds; this is not a fixed percentage quota.
  expect(result.publication.entries[0].tier).toBe('fire');
});

test('uses the shared-map latitude boundary and rejects unnamed publication inputs', async () => {
  for (const lat of [32.5, 39.5]) expect((await build({ lat })).evidence.groups[0].cohort).toBe('overseas');
  await expect(build({ approved_name: '', name: '' })).rejects.toThrow('popularity_source_name_invalid');
});

test('nearest-rank has no ember at n=19 but separates P95 and P98 at n=20', async () => {
  for (const size of [19, 20]) {
    const dir = await mkdtemp(join(tmpdir(), 'tzudong-nearest-rank-')); dirs.push(dir);
    const rows = Array.from({ length: size }, (_, index) => ({ id: `shop-${index}`, name: `식당 ${index}`, status: 'approved',
      lat: 37.5, lng: 127, road_address: `서울특별시 강남구 테스트로 ${index}`, youtube_link: `https://www.youtube.com/watch?v=${String(index).padStart(11, '0')}` }));
    const metrics = rows.map((_, index) => ({ video_id: String(index).padStart(11, '0'), view_count: index + 1, fetched_at: '2026-07-01T00:00:00Z' }));
    await writeFile(join(dir, 'source.json'), JSON.stringify({ rows }));
    await writeFile(join(dir, 'metrics.json'), JSON.stringify({ rows: metrics }));
    const result = await buildPublicPopularity(join(dir, 'source.json'), join(dir, 'metrics.json'), 'a'.repeat(40));
    expect(result.evidence.thresholds[0]).toMatchObject({ knownGroups: size, fireAt: size, emberAt: 19 });
    expect(result.publication.entries.filter(entry => entry.tier === 'ember')).toHaveLength(size === 19 ? 0 : 1);
  }
});

test('duplicate observations reject timestamp conflicts in either order and normalize video identity', async () => {
  const later = {...metric, fetched_at: '2026-07-02T00:00:00Z'};
  for (const rows of [[metric, later], [later, metric]]) {
    await expect(build({}, rows)).rejects.toThrow('popularity_metrics_video_conflict');
  }
  const aliased = {...metric, video_id: 'https://youtu.be/abc123DEF45'};
  for (const rows of [[metric, aliased], [aliased, metric]]) {
    const result = await build({}, rows);
    expect(result.evidence.groups[0].observed).toEqual([{videoId: metric.video_id, count: 123, observedAt: metric.fetched_at}]);
  }
  expect((await build({}, [aliased])).evidence.groups[0].viewCount).toBe(123);
  await expect(build({}, [{...metric, video_id: 'invalid'}])).rejects.toThrow('popularity_metrics_video_invalid');
});
