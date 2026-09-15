import { describe, expect, test } from 'bun:test';
import { buildDashboardEvidence, buildDashboardMonthlyPerformance, dashboardVideoMetrics } from '../lib/admin/dashboard-visualization-data';
import type { InsightTreemapVideoRow } from '../lib/public-insights/treemap';

const video = (id: string, views: number, engagement: number, publishedAt = '2026-01-02T00:00:00Z'): InsightTreemapVideoRow => ({
  id, title: id, publishedAt, category: 'food', duration: 600,
  viewCount: views, likeCount: engagement, commentCount: 0,
  previousViewCount: null, previousLikeCount: null, previousCommentCount: null, previousDuration: null,
});

describe('dashboard visualization evidence', () => {
  test('groups upload months, averages per video and retains the weighted reaction denominator', () => {
    const result = buildDashboardMonthlyPerformance([
      video('a', 100, 10), video('b', 900, 18), video('c', 200, 4, '2026-02-01T00:00:00Z'),
    ], 'current');
    expect(result).toEqual([
      { label: '2026.01', videoCount: 2, value: 14, secondaryValue: 500, totalViews: 1000, totalEngagement: 28 },
      { label: '2026.02', videoCount: 1, value: 4, secondaryValue: 200, totalViews: 200, totalEngagement: 4 },
    ]);
    expect(result[0].value / result[0].secondaryValue * 100).toBeCloseTo(2.8);
  });
  test('does not treat absent comparison as zero; true new uploads and negative corrections are retained', () => {
    const old = video('old', 100, 10);
    expect(dashboardVideoMetrics(old, 'delta').views).toBeNull();
    const fresh = { ...video('new', 40, 2), comparisonStatus: 'new' as const };
    const corrected = { ...old, previousViewCount: 150, previousLikeCount: 12, previousCommentCount: 0, comparisonStatus: 'compared' as const };
    expect(buildDashboardMonthlyPerformance([old, fresh, corrected], 'delta')[0]).toMatchObject({ videoCount: 1, secondaryValue: 40 });
    expect(buildDashboardMonthlyPerformance([fresh, corrected], 'delta')[0]).toMatchObject({ videoCount: 2, secondaryValue: -5, value: 0 });
  });
  test('ignores duplicate IDs and unknown upload dates for monthly cohorts', () => {
    const known = video('a', 100, 5);
    expect(buildDashboardMonthlyPerformance([known, known, video('unknown', 90, 2, 'invalid')], 'current')).toHaveLength(1);
    expect(buildDashboardMonthlyPerformance([known, known], 'current')[0].videoCount).toBe(1);
  });
  test('reports concentration against all videos, not only the displayed five', () => {
    const rows = Array.from({ length: 10 }, (_, i) => video(String(i), 100, 5));
    expect(buildDashboardEvidence(rows, 'current')).toMatchObject({ count: 10, medianViews: 100, meanViews: 100, topCount: 5, topShare: 50 });
  });
  test('uses a median view floor for engagement selection and a robust central value', () => {
    const result = buildDashboardEvidence([video('tiny', 1, 1), video('a', 100, 10), video('b', 200, 30), video('viral', 10000, 100)], 'current');
    expect(result.medianViews).toBe(150);
    expect(result.strongestEngagement?.video.id).toBe('b');
    expect(result.engagementCandidateCount).toBe(2);
  });
  test('empty/zero/missing evidence has no invented winner or percentage', () => {
    expect(buildDashboardEvidence([], 'current')).toMatchObject({ count: 0, medianViews: null, topShare: null, strongestEngagement: null, latestVideo: null });
    expect(buildDashboardEvidence([video('zero', 0, 0)], 'current')).toMatchObject({ topShare: null, strongestEngagement: null });
    expect(buildDashboardEvidence([video('no-baseline', 900, 5)], 'delta').count).toBe(0);
  });
});
