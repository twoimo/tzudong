import type { InsightTreemapVideoRow } from '@/lib/public-insights/treemap';

export type DashboardMetricMode = 'current' | 'delta';

export function dashboardVideoMetrics(video: InsightTreemapVideoRow, mode: DashboardMetricMode) {
  const read = (current: number, previous: number | null) => {
    if (!Number.isFinite(current)) return null;
    if (mode === 'current') return current;
    if (video.comparisonStatus === 'new') return current;
    return typeof previous === 'number' && Number.isFinite(previous) ? current - previous : null;
  };
  const views = read(video.viewCount, video.previousViewCount);
  const likes = read(video.likeCount, video.previousLikeCount);
  const comments = read(video.commentCount, video.previousCommentCount);
  return { views, likes, comments, engagement: likes === null || comments === null ? null : likes + comments };
}

export type DashboardMonthlyPerformance = {
  label: string;
  videoCount: number;
  value: number;
  secondaryValue: number;
  totalViews: number;
  totalEngagement: number;
};

/** Upload cohorts, not historical channel traffic. Averages remove upload-volume bias. */
export function buildDashboardMonthlyPerformance(videos: InsightTreemapVideoRow[], mode: DashboardMetricMode): DashboardMonthlyPerformance[] {
  const months = new Map<string, { count: number; views: number; engagement: number }>();
  const seen = new Set<string>();
  for (const video of videos) {
    if (seen.has(video.id)) continue;
    seen.add(video.id);
    const timestamp = video.publishedAt ? Date.parse(video.publishedAt) : NaN;
    if (!Number.isFinite(timestamp)) continue;
    const metrics = dashboardVideoMetrics(video, mode);
    if (metrics.views === null || metrics.engagement === null) continue;
    const month = new Date(timestamp).toISOString().slice(0, 7);
    const bucket = months.get(month) ?? { count: 0, views: 0, engagement: 0 };
    bucket.count += 1;
    bucket.views += metrics.views;
    bucket.engagement += metrics.engagement;
    months.set(month, bucket);
  }
  return [...months.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([month, bucket]) => ({
    label: month.replace('-', '.'),
    videoCount: bucket.count,
    value: bucket.engagement / bucket.count,
    secondaryValue: bucket.views / bucket.count,
    totalViews: bucket.views,
    totalEngagement: bucket.engagement,
  }));
}

function median(values: number[]) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

/** Descriptive evidence only: no attribution of subscriber gains or invented forecasts. */
export function buildDashboardEvidence(videos: InsightTreemapVideoRow[], mode: DashboardMetricMode) {
  const seen = new Set<string>();
  const uniqueVideos = videos.filter(video => {
    if (seen.has(video.id)) return false;
    seen.add(video.id);
    return true;
  });
  const rows = uniqueVideos.map(video => ({ video, ...dashboardVideoMetrics(video, mode) }))
    .filter((row): row is typeof row & { views: number; engagement: number } => row.views !== null && row.engagement !== null);
  const medianViews = median(rows.map(row => row.views));
  const positiveRows = rows.filter(row => row.views > 0);
  const totalPositiveViews = positiveRows.reduce((sum, row) => sum + row.views, 0);
  const ranked = [...positiveRows].sort((a, b) => b.views - a.views);
  const topCount = Math.min(5, ranked.length);
  const topShare = totalPositiveViews > 0
    ? ranked.slice(0, topCount).reduce((sum, row) => sum + row.views, 0) / totalPositiveViews * 100 : null;
  // A tiny-view video cannot win solely because one reaction makes a large percentage.
  const engagementCandidates = positiveRows.filter(row => row.views >= (medianViews ?? 0) && row.engagement >= 0);
  const strongestEngagement = [...engagementCandidates].sort((a, b) => b.engagement / b.views - a.engagement / a.views)[0] ?? null;
  const latestVideo = uniqueVideos.filter(video => video.publishedAt && Number.isFinite(Date.parse(video.publishedAt)))
    .sort((a, b) => Date.parse(b.publishedAt!) - Date.parse(a.publishedAt!))[0] ?? null;
  return {
    count: rows.length,
    medianViews,
    meanViews: rows.length ? rows.reduce((sum, row) => sum + row.views, 0) / rows.length : null,
    topShare,
    topCount,
    topVideo: ranked[0]?.video ?? null,
    strongestEngagement,
    engagementCandidateCount: engagementCandidates.length,
    latestVideo,
    negativeCount: rows.filter(row => row.views < 0 || row.engagement < 0).length,
  };
}
