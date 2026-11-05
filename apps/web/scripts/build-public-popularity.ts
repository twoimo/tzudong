import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { mergeRestaurants } from '../hooks/use-restaurants';
import { extractCanonicalYouTubeVideoId } from '../lib/youtube-url';
import { parsePublicPopularityPublication } from '../lib/evidence-engineering/published-popularity';
import { safeCount } from '../lib/evidence-engineering/guards';
import { restaurantMatchesOverseasCountry } from '../lib/overseas-region-matching';
import { OVERSEAS_REGIONS } from '../constants/overseas-regions';
import type { Tables } from '../integrations/supabase/types';

export async function buildPublicPopularity(sourcePath: string, metricsPath: string, revision: string) {
  const sourceBytes = await readFile(sourcePath);
  const metricBytes = await readFile(metricsPath);
  const source = JSON.parse(sourceBytes.toString()) as { rows: Array<Record<string, unknown>> };
  const metrics = JSON.parse(metricBytes.toString()) as { rows: Array<{ video_id: string; view_count: number | string; fetched_at: string; bucket_started_at: string }> };
  const byVideo = new Map<string, typeof metrics.rows[number]>();
  for (const row of metrics.rows) {
    const videoId = extractCanonicalYouTubeVideoId(row.video_id);
    if (!videoId) throw new Error('popularity_metrics_video_invalid');
    const previous = byVideo.get(videoId);
    if (previous && (safeCount(previous.view_count, Number.MAX_SAFE_INTEGER) !== safeCount(row.view_count, Number.MAX_SAFE_INTEGER)
      || (previous.fetched_at || previous.bucket_started_at) !== (row.fetched_at || row.bucket_started_at))) {
      throw new Error('popularity_metrics_video_conflict');
    }
    byVideo.set(videoId, { ...row, video_id: videoId });
  }
  const rows = source.rows.map((r) => {
    if (r.status !== 'approved') throw new Error('popularity_source_not_approved');
    const validCoordinate = (value: unknown, limit: number) =>
      (typeof value === 'number' || (typeof value === 'string' && value.trim() !== ''))
      && Number.isFinite(Number(value)) && Math.abs(Number(value)) <= limit;
    // Validate before mergeRestaurants can replace missing coordinates with zero.
    if (!validCoordinate(r.lat, 90) || !validCoordinate(r.lng, 180) || (Number(r.lat) === 0 && Number(r.lng) === 0)) {
      throw new Error('popularity_source_coordinates_invalid');
    }
    const name = r.approved_name ?? r.name;
    if (typeof name !== 'string' || name.trim() === '') throw new Error('popularity_source_name_invalid');
    return { ...r, name, approved_name: name, lat: Number(r.lat), lng: Number(r.lng) };
  }) as unknown as Tables<'restaurants'>[];
  const countries = [...new Set(Object.values(OVERSEAS_REGIONS).map((r) => r.country))];
  const groups = mergeRestaurants(rows, () => 'standard').map((r) => {
    const members = r.mergedRestaurants?.length ? r.mergedRestaurants : [r];
    const ids = [...new Set(members.map((m) => m.id))].sort();
    const videos = [...new Set(members.map((m) => extractCanonicalYouTubeVideoId(m.youtube_link ?? '')).filter((v): v is string => !!v))];
    const observed = videos.flatMap((id) => {
      const metric = byVideo.get(id); const count = safeCount(metric?.view_count, Number.MAX_SAFE_INTEGER);
      return metric && count !== null && count > 0 ? [{ videoId: id, count, observedAt: metric.fetched_at || metric.bucket_started_at }] : [];
    });
    const overseas = countries.some((country) => restaurantMatchesOverseasCountry(r, country)) || Number(r.lat) < 33 || Number(r.lat) > 39 || Number(r.lng) < 124 || Number(r.lng) > 132;
    return { restaurantId: ids[0], memberRestaurantIds: ids, name: r.name, cohort: overseas ? 'overseas' : 'domestic', viewCount: observed.length ? Math.max(...observed.map((m) => m.count)) : null, observed };
  });
  const thresholds = ['domestic', 'overseas'].map((cohort) => {
    const counts = groups.filter((g) => g.cohort === cohort && g.viewCount !== null).map((g) => g.viewCount!).sort((a, b) => a - b);
    const percentile = (p: number) => counts.length ? counts[Math.max(0, Math.ceil(counts.length * p) - 1)] : null;
    return { cohort, knownGroups: counts.length, fireAt: percentile(0.98), emberAt: percentile(0.95), rainbowAt: percentile(0.85) };
  });
  const entries = groups.map((group) => {
    const cut = thresholds.find((c) => c.cohort === group.cohort)!;
    const tier = group.viewCount === null || cut.fireAt === null ? 'standard' : group.viewCount >= cut.fireAt ? 'fire' : group.viewCount >= cut.emberAt! ? 'ember' : group.viewCount >= cut.rainbowAt! ? 'rainbow' : 'standard';
    return { restaurantId: group.restaurantId, memberRestaurantIds: group.memberRestaurantIds, tier };
  }).sort((a, b) => a.restaurantId.localeCompare(b.restaurantId));
  const publication = parsePublicPopularityPublication({ schemaVersion: 2, publicationVersion: 'video-views-20261023-v2', sourceRevision: revision, entries });
  const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');
  return { publication, evidence: { policy: 'map-cohort-max-linked-video-views-nearest-rank-p98-p95-p85-v2', definition: 'Most-viewed linked video per merged restaurant, ranked separately within domestic and overseas approved restaurant cohorts. This measures video reach, not food quality.', sourceSha256: sha(sourceBytes), metricsSha256: sha(metricBytes), thresholds, groups } };
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const result = await buildPublicPopularity(args[0], args[1], args[2]);
  await writeFile(args[3], JSON.stringify(result.publication, null, 2) + '\n');
  await writeFile(args[4], JSON.stringify(result.evidence, null, 2) + '\n');
  console.log(JSON.stringify({ groups: result.publication.entries.length, tiers: result.publication.entries.reduce((a, e) => ({ ...a, [e.tier]: (a[e.tier] ?? 0) + 1 }), {} as Record<string, number>), thresholds: result.evidence.thresholds }));
}
