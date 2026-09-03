"use client";

import { useQuery } from "@tanstack/react-query";

import { ConsoleVizFormRenderer } from "@/components/admin/viz/console-viz-forms";
import { getConsoleVizBindings } from "@/lib/admin/console-visualization-map";
import type {
  ConsoleVizRequestStatus,
  ConsoleVizSeries,
} from "@/lib/admin/console-viz-state";
import type { InsightTreemapResponse } from "@/lib/public-insights/treemap";

type OverviewVizStats = {
  pendingRestaurantSubmissions: number | null;
  pendingRecommendationRequests: number | null;
  pendingReviews: number | null;
  pendingTotal: number | null;
};

function pendingRequestStatus(
  stats: OverviewVizStats,
  isLoading: boolean,
  hasError: boolean,
): ConsoleVizRequestStatus {
  const hasAnyValue =
    stats.pendingRestaurantSubmissions != null ||
    stats.pendingRecommendationRequests != null ||
    stats.pendingReviews != null;
  if (hasError && !hasAnyValue) return "error";
  if (isLoading && !hasAnyValue) return "loading";
  return "settled";
}

function buildGaugeSeries(stats: OverviewVizStats): ConsoleVizSeries[] {
  if (
    stats.pendingRestaurantSubmissions == null &&
    stats.pendingRecommendationRequests == null &&
    stats.pendingReviews == null
  ) {
    return [];
  }
  return [
    {
      label: "맛집 제보",
      points: [stats.pendingRestaurantSubmissions ?? 0],
      unit: "건",
      fractionDigits: 0,
    },
    {
      label: "추천 요청",
      points: [stats.pendingRecommendationRequests ?? 0],
      unit: "건",
      fractionDigits: 0,
    },
    {
      label: "리뷰",
      points: [stats.pendingReviews ?? 0],
      unit: "건",
      fractionDigits: 0,
    },
  ];
}

async function fetchOverviewKpiSeries(): Promise<InsightTreemapResponse> {
  const params = new URLSearchParams({
    period: "1M",
    viewMode: "all",
    metricMode: "views",
  });
  const response = await fetch(`/api/admin/youtube-kpis?${params.toString()}`, {
    headers: { Accept: "application/json" },
  });
  if (!response.ok) {
    throw new Error("admin-overview-viz-kpis-failed");
  }
  return response.json() as Promise<InsightTreemapResponse>;
}

function buildKpiSeries(payload: InsightTreemapResponse | undefined): ConsoleVizSeries[] {
  const videos = [...(payload?.videos ?? [])].sort((left, right) => {
    const leftTime = left.publishedAt ? Date.parse(left.publishedAt) : 0;
    const rightTime = right.publishedAt ? Date.parse(right.publishedAt) : 0;
    return leftTime - rightTime;
  });
  if (videos.length === 0) {
    return [];
  }
  return [
    {
      label: "조회수",
      points: videos.map((video) => video.viewCount),
      unit: "회",
      fractionDigits: 0,
    },
    {
      label: "좋아요",
      points: videos.map((video) => video.likeCount),
      unit: "개",
      fractionDigits: 0,
    },
    {
      label: "댓글",
      points: videos.map((video) => video.commentCount),
      unit: "개",
      fractionDigits: 0,
    },
  ];
}

export function AdminConsoleOverviewVisualizations({
  stats,
  isLoading,
  hasError,
}: {
  stats: OverviewVizStats;
  isLoading: boolean;
  hasError: boolean;
}) {
  const kpiQuery = useQuery({
    queryKey: ["admin-dashboard-management", "insights", "cohort", "1M"],
    queryFn: fetchOverviewKpiSeries,
    staleTime: 60 * 1000,
    refetchOnWindowFocus: false,
  });
  const bindings = getConsoleVizBindings("overview");
  const gaugeBinding = bindings.find((item) => item.form === "semicircle-gauge-arc");
  const sparklineBinding = bindings.find((item) => item.form === "kpi-sparkline-card");
  const gaugeSeries = buildGaugeSeries(stats);
  const kpiSeries = buildKpiSeries(kpiQuery.data);
  const kpiStatus: ConsoleVizRequestStatus = kpiQuery.isError
    ? "error"
    : kpiQuery.isLoading
      ? "loading"
      : "settled";

  return (
    <div
      className="mt-3 grid min-w-0 grid-cols-1 gap-3 lg:grid-cols-2"
      data-admin-overview-visualizations="true"
    >
      {sparklineBinding ? (
        <ConsoleVizFormRenderer
          binding={sparklineBinding}
          requestStatus={kpiStatus}
          series={kpiSeries}
          metaLeft="최근 구간 지표"
          metaRight={`${kpiSeries[0]?.points.at(-1) ?? 0}회`}
        />
      ) : null}
      {gaugeBinding ? (
        <ConsoleVizFormRenderer
          binding={gaugeBinding}
          requestStatus={pendingRequestStatus(stats, isLoading, hasError)}
          series={gaugeSeries}
          metaLeft="대기 업무 구성"
          metaRight={`${stats.pendingTotal ?? 0}건`}
        />
      ) : null}
    </div>
  );
}
