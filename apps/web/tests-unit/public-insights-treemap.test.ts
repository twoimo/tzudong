import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  parseTreemapMetricMode,
  parseTreemapPeriod,
  type InsightTreemapPeriod,
} from '@/lib/public-insights/treemap';
import { buildTreemapApiCacheControl } from '@/app/api/insights/treemap/route';

const source = (relativePath: string) => readFileSync(join(import.meta.dir, '..', relativePath), 'utf8');

describe('public insights treemap route support', () => {
  test('normalizes period values for the public treemap API', () => {
    expect(parseTreemapPeriod('1D')).toBe('1D');
    expect(parseTreemapPeriod('6M')).toBe('6M');
    expect(parseTreemapPeriod('invalid')).toBe('ALL');
    expect(parseTreemapPeriod(null)).toBe('ALL');
  });

  test('keeps the public period union independent of admin insight UI', () => {
    const period: InsightTreemapPeriod = 'ALL';
    expect(period).toBe('ALL');
  });

  test('normalizes metric mode values for the public treemap API', () => {
    expect(parseTreemapMetricMode('views')).toBe('views');
    expect(parseTreemapMetricMode('likes')).toBe('likes');
    expect(parseTreemapMetricMode('comments')).toBe('comments');
    expect(parseTreemapMetricMode('duration')).toBe('duration');
    expect(parseTreemapMetricMode('other')).toBe('views');
  });

  test('keeps meta_history out of current-period public queries and isolates history caches', () => {
    const treemapSource = source('lib/public-insights/treemap.ts');

    expect(treemapSource).toContain("const selectColumns = options.includeHistory");
    expect(treemapSource).toContain(": 'id,title,published_at,duration,view_count,like_count,comment_count,category';");
    expect(treemapSource).toContain("const rows = await cacheOrFetchVideos(filterByPeriod ? period : 'ALL', {");
    expect(treemapSource).toContain('includeHistory: !filterByPeriod');
    expect(treemapSource).toContain("includeHistory: options.includeHistory === true");
  });

  test('keeps public treemap cache keys and CDN freshness explicit', () => {
    const treemapSource = source('lib/public-insights/treemap.ts');
    const routeSource = source('app/api/insights/treemap/route.ts');

    for (const dimension of [
      'period',
      'filterMode',
      'viewMode',
      'metricMode',
      'source',
      'scope',
      'fallbackSource',
      'fallbackReasonCode',
      'rowCap',
    ]) {
      expect(treemapSource).toContain(dimension);
    }

    expect(routeSource).toContain('TREEMAP_API_BROWSER_MAX_AGE_SECONDS = 0');
    expect(routeSource).toContain('TREEMAP_API_CDN_FRESH_SECONDS = 60');
    expect(routeSource).toContain('TREEMAP_API_CDN_STALE_SECONDS = 5 * 60');
    expect(routeSource).toContain('s-maxage=${TREEMAP_API_CDN_FRESH_SECONDS}');
    expect(routeSource).toContain("'Cache-Control': buildTreemapApiCacheControl()");
  });

  test('renders dense public insights treemap context and small-cell guidance', () => {
    const insightsSource = source('app/insights/insights-client.tsx');

    expect(insightsSource).toContain('data-insights-treemap-context="true"');
    expect(insightsSource).toContain('트리맵 기준: ${metricLabel} · ${periodLabel} · ${selectedCount.toLocaleString()}개 영상 · ${modeLabel} · ${clusterContextText}');
    expect(insightsSource).toContain('색상 범례: 전체 ${metricLabel} 비중이 높을수록 밝은 초록색입니다.');
    expect(insightsSource).toContain('작은 칸 안내: 공간이 좁으면 지표나 …만 표시되고');
  });

  test('builds the exact public treemap CDN cache header', () => {
    expect(buildTreemapApiCacheControl()).toBe('public, max-age=0, s-maxage=60, stale-while-revalidate=300, must-revalidate');
  });
});
