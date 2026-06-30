import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  buildInsightTreemapResponseQualityMeta,
  enrichInsightTreemapVideosWithQuality,
  normalizeInsightTreemapMetric,
  type InsightTreemapVideoRow,
} from "../lib/public-insights/treemap";

const repoRoot = resolve(import.meta.dir, "..");

function readRepoFile(path: string) {
  return readFileSync(resolve(repoRoot, path), "utf8");
}

describe("YouTube KPI snapshot collector contract", () => {
  test("schedules a lightweight snapshot workflow every 15 minutes", () => {
    const workflow = readRepoFile(
      "../../.github/workflows/youtube-kpi-snapshot.yml",
    );

    expect(workflow).toContain('cron: "7,22,37,52 * * * *"');
    expect(workflow).toContain("node scripts/capture-youtube-kpi-snapshot.mjs");
    expect(workflow).toContain("YOUTUBE_KPI_SNAPSHOT_INTERVAL_MINUTES");
    expect(workflow).toContain("persist-credentials: false");
    expect(workflow).toContain("npm ci --omit=dev --ignore-scripts");
    expect(workflow).toContain(
      "actions/checkout@de0fac2e4500dabe0009e67214ff5f5447ce83dd",
    );
    expect(workflow).toContain(
      "actions/setup-node@48b55a011bda9f5d6aeb4c2d9c7362e8dae4041e",
    );

    const collector = readRepoFile("scripts/capture-youtube-kpi-snapshot.mjs");
    expect(collector).toContain("YOUTUBE_FETCH_TIMEOUT_MS");
    expect(collector).toContain("YOUTUBE_FETCH_RETRY_COUNT");
    expect(collector).toContain("loadLocalEnvFile");
    expect(collector).not.toContain('import "dotenv/config"');
    expect(collector).toContain('requireEnv("YOUTUBE_API_KEY")');
    expect(collector).toContain("fetchPreviousChannelSnapshot");
    expect(collector).toContain("previous_bucket_started_at");
    expect(collector).toContain("subscriber_delta");
    expect(collector).toContain("subscriberDelta");
    expect(collector).not.toContain("NEXT_PUBLIC_YOUTUBE_API_KEY_BYEON");
    expect(workflow).not.toContain("NEXT_PUBLIC_YOUTUBE_API_KEY");
  });

  test("keeps snapshots service-role writable only", () => {
    const migration = readRepoFile(
      "supabase/migrations/20260525143908_create_youtube_kpi_snapshots.sql",
    );
    const growthMigration = readRepoFile(
      "supabase/migrations/20260526083932_add_youtube_channel_growth_snapshot_deltas.sql",
    );

    expect(migration).toContain("public.youtube_channel_kpi_snapshots");
    expect(migration).toContain("public.youtube_video_kpi_snapshots");
    expect(migration).toContain("enable row level security");
    expect(migration).toContain("grant select, insert, update, delete");
    expect(migration).toContain("youtube_video_kpi_snapshots_bucket_views_idx");
    expect(migration).not.toContain(
      "grant select on table public.youtube_video_kpi_snapshots to anon",
    );
    expect(growthMigration).toContain("subscriber_delta bigint");
    expect(growthMigration).toContain("previous_bucket_started_at timestamptz");
    expect(growthMigration).toContain(
      "youtube_channel_kpi_snapshots_previous_bucket_idx",
    );
    expect(growthMigration).not.toContain("grant select on table");
  });

  test("admin KPI route can fall back from snapshots/live API to Supabase data for ALL", () => {
    const route = readRepoFile("app/api/admin/youtube-kpis/route.ts");

    expect(route).toContain("getYouTubeKpiSnapshotData(period, {");
    expect(route).toContain("shouldUseHistoryComparisonFallback");
    expect(route).toContain('fallbackReasonCode: "snapshot-comparison-unavailable"');
    expect(route).toContain("getInsightTreemapData(period");
    expect(route).toContain('filterByPeriod: !isChannelGrowthScope && period !== "ALL"');
    expect(route).toContain("return process.env.YOUTUBE_API_KEY || null");
    expect(route).toContain("YouTube KPI fallback data is unavailable");
    expect(route).toContain('dataSource: "youtube-live"');
    expect(route).toContain('fallbackReasonCode: "youtube-api-key-missing"');
    expect(route).toContain('fallbackReasonCode: "youtube-live-fetch-failed"');
    expect(route).toContain("withYouTubeKpiQualityMeta");
    expect(route).toContain("liveNoComparison: true");
    expect(route).toContain("includeComparisonQuality: false");
    expect(readRepoFile("lib/admin/youtube-kpi-snapshots.ts")).toContain(
      "buildSnapshotComparisonCoverage",
    );
  });

  test("defines copy-free KPI data quality and anomaly metadata contract", () => {
    const treemap = readRepoFile("lib/public-insights/treemap.ts");
    const snapshots = readRepoFile("lib/admin/youtube-kpi-snapshots.ts");

    for (const reason of [
      "clamped_metric",
      "negative_delta",
      "extreme_spike",
      "dominates_total",
      "missing_previous",
      "low_comparison_coverage",
      "stale_snapshot",
      "fallback_source",
      "live_no_comparison",
      "row_cap",
      "delta_conflict",
    ]) {
      expect(treemap).toContain(`'${reason}'`);
    }

    expect(treemap).toContain("InsightTreemapDataQualitySummary");
    expect(treemap).toContain("InsightTreemapAnomalySummary");
    expect(treemap).toContain("normalizedMetricReasons?:");
    expect(treemap).toContain("YOUTUBE_KPI_DATA_QUALITY_THRESHOLDS");
    expect(treemap).toContain("dominantContributionRatio: 0.7");
    expect(treemap).toContain("extremeMedianMultiple: 20");
    expect(treemap).toContain("staleSnapshotHours: 2");
    expect(treemap).toContain("buildInsightTreemapResponseQualityMeta");
    expect(treemap).toContain("enrichInsightTreemapVideosWithQuality");
    expect(snapshots).toContain("buildSnapshotMetricNormalizationReasons");
    expect(snapshots).toContain("buildInsightTreemapResponseQualityMeta");
    expect(snapshots).toContain("enrichInsightTreemapVideosWithQuality");
  });
  test("builds machine-readable KPI quality metadata for clamps and outliers", () => {
    const normalized = normalizeInsightTreemapMetric("-15", "views");
    expect(normalized.value).toBe(0);
    expect(normalized.reasons).toEqual([
      {
        reason: "clamped_metric",
        metric: "views",
        rawValue: "-15",
        normalizedValue: 0,
      },
    ]);

    const baseVideo: InsightTreemapVideoRow = {
      id: "v-risk",
      title: "위험 신호 영상",
      publishedAt: "2026-06-30T00:00:00.000Z",
      category: "YouTube",
      viewCount: 10_000,
      likeCount: 100,
      commentCount: 10,
      duration: 600,
      previousViewCount: 20_000,
      previousLikeCount: 90,
      previousCommentCount: 5,
      previousDuration: null,
      comparisonStatus: "compared",
      normalizedMetricReasons: normalized.reasons,
    };
    const normalVideo: InsightTreemapVideoRow = {
      ...baseVideo,
      id: "v-normal",
      title: "보통 영상",
      viewCount: 100,
      previousViewCount: 80,
      normalizedMetricReasons: [],
    };
    const anotherNormalVideo: InsightTreemapVideoRow = {
      ...normalVideo,
      id: "v-normal-2",
    };


    const videos = enrichInsightTreemapVideosWithQuality(
      [baseVideo, normalVideo, anotherNormalVideo],
      "youtube-snapshot",
    );
    const riskyVideo = videos.find((video) => video.id === "v-risk");
    expect(riskyVideo?.qualityFlags?.map((flag) => flag.reason)).toContain(
      "clamped_metric",
    );
    expect(riskyVideo?.qualityFlags?.map((flag) => flag.reason)).toContain(
      "negative_delta",
    );
    expect(riskyVideo?.anomalyFlags?.map((flag) => flag.reason)).toContain(
      "dominates_total",
    );
    expect(riskyVideo?.anomalyFlags?.map((flag) => flag.reason)).toContain(
      "extreme_spike",
    );

    const qualityMeta = buildInsightTreemapResponseQualityMeta({
      videos,
      source: "youtube-snapshot",
      asOf: new Date().toISOString(),
      fallbackReasonCode: "unit-fallback",
      fallbackSource: "supabase-treemap",
      comparisonCoverage: {
        totalVideos: 10,
        comparedVideos: 4,
        newVideos: 1,
        missingPreviousVideos: 5,
        comparisonAvailable: true,
      },
    });

    const reasons = qualityMeta.dataQuality.reasonCounts.map(
      (item) => item.reason,
    );
    expect(reasons).toContain("low_comparison_coverage");
    expect(reasons).toContain("fallback_source");
    expect(reasons).toContain("missing_previous");
    expect(qualityMeta.dataQuality.status).toBe("risk");
    expect(qualityMeta.anomalySummary.totalFlags).toBeGreaterThan(0);
  });
  test("distinguishes live no-comparison from snapshot comparison gaps", () => {
    const video: InsightTreemapVideoRow = {
      id: "v-ok",
      title: "정상 영상",
      publishedAt: "2026-06-30T00:00:00.000Z",
      category: "YouTube",
      viewCount: 100,
      likeCount: 10,
      commentCount: 1,
      duration: 600,
      previousViewCount: null,
      previousLikeCount: null,
      previousCommentCount: null,
      previousDuration: null,
      comparisonStatus: "not_applicable",
    };

    const liveMeta = buildInsightTreemapResponseQualityMeta({
      videos: [video],
      source: "youtube-live",
      asOf: new Date().toISOString(),
      liveNoComparison: true,
      includeComparisonQuality: false,
      comparisonCoverage: {
        totalVideos: 1,
        comparedVideos: 0,
        newVideos: 1,
        missingPreviousVideos: 0,
        comparisonAvailable: false,
      },
    });
    const liveReasons = liveMeta.dataQuality.reasonCounts.map(
      (item) => item.reason,
    );
    expect(liveReasons).toContain("live_no_comparison");
    expect(liveReasons).not.toContain("low_comparison_coverage");

    const snapshotGapMeta = buildInsightTreemapResponseQualityMeta({
      videos: [video],
      source: "youtube-snapshot",
      asOf: new Date().toISOString(),
      comparisonCoverage: {
        totalVideos: 1,
        comparedVideos: 0,
        newVideos: 1,
        missingPreviousVideos: 0,
        comparisonAvailable: false,
      },
    });
    expect(
      snapshotGapMeta.dataQuality.reasonCounts.map((item) => item.reason),
    ).toContain("low_comparison_coverage");
  });
  test("admin channel KPI route exposes a single delta source for dashboard cards", () => {
    const route = readRepoFile("app/api/admin/youtube-channel/route.ts");
    const dashboard = readRepoFile("components/admin/AdminConsoleOverview.tsx");

    expect(route).toContain("getDerivedLiveDelta");
    expect(route).toContain('source: "derived-live-comparison"');
    expect(route).toContain("deltaSource:");
    expect(readRepoFile("lib/admin/youtube-kpi-snapshots.ts")).toContain(
      "preferStoredDelta: period === 'ALL'",
    );
    expect(readRepoFile("lib/admin/youtube-kpi-snapshots.ts")).toContain(
      "hasDeltaConflict",
    );
    expect(readRepoFile("lib/admin/youtube-kpi-snapshots.ts")).toContain(
      "createInsightTreemapQualityFlag('delta_conflict'",
    );
    expect(dashboard).toContain("channelStats?.subscriberDelta");
    expect(dashboard).toContain("channelStats?.videoDelta");
    expect(dashboard).toContain("getAdminDashboardDeltaSourceLabel");
  });

  test("admin KPI dashboard exposes GitHub Actions collection logs", () => {
    const route = readRepoFile(
      "app/api/admin/youtube-kpi-collection-logs/route.ts",
    );
    const dashboard = readRepoFile("components/admin/AdminConsoleOverview.tsx");

    expect(route).toContain("/actions/workflows/");
    expect(route).toContain("buildGitHubWorkflowRunJobsUrl");
    expect(route).toContain("REPOSITORY_PATTERN");
    expect(route).toContain("WORKFLOW_ID_PATTERN");
    expect(route).toContain("AbortSignal.timeout");
    expect(route).toContain("max-age=20");
    expect(route).toContain("youtube-kpi-snapshot.yml");
    expect(route).toContain("youtube_channel_kpi_snapshots");
    expect(route).toContain("subscriber_delta");
    expect(route).toContain("previousBucketStartedAt");
    expect(route).toContain("process.env.GITHUB_ACTIONS_TOKEN ||");
    expect(route.indexOf("process.env.GITHUB_ACTIONS_TOKEN")).toBeLessThan(
      route.indexOf("process.env.GITHUB_TOKEN"),
    );
    expect(dashboard).toContain("/api/admin/youtube-kpi-collection-logs");
    expect(dashboard).toContain("데이터 수집 상태");
    expect(dashboard).toContain("수집 정상");
    expect(dashboard).toContain("GITHUB_ACTIONS_TOKEN 또는 GH_TOKEN");
    expect(dashboard).toContain("formatSignedNumber(snapshot?.viewDelta)");
    expect(dashboard).toContain("enabled: isCollectionLogsOpen");
    expect(dashboard).toContain(
      "data-admin-dashboard-kpi-collection-log-trigger",
    );
  });
});
