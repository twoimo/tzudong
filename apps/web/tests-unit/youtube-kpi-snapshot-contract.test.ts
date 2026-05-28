import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

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
    expect(route).toContain("process.env.YOUTUBE_API_KEY || null");
    expect(route).toContain("YouTube KPI fallback data is unavailable");
    expect(route).toContain('dataSource: "youtube-live"');
    expect(route).toContain('fallbackReasonCode: "youtube-api-key-missing"');
    expect(route).toContain('fallbackReasonCode: "youtube-live-fetch-failed"');
    expect(readRepoFile("lib/admin/youtube-kpi-snapshots.ts")).toContain(
      "buildSnapshotComparisonCoverage",
    );
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
