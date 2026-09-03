"use client";

import { useQuery } from "@tanstack/react-query";

import { ConsoleVizFormRenderer } from "@/components/admin/viz/console-viz-forms";
import { getConsoleVizBindings } from "@/lib/admin/console-visualization-map";
import type {
  ConsoleVizRequestStatus,
  ConsoleVizSeries,
} from "@/lib/admin/console-viz-state";
import type {
  InsightTreemapResponse,
  InsightTreemapVideoRow,
} from "@/lib/public-insights/treemap";

function untitledVideoLabel(index: number): string {
  return `영상 ${index + 1}`;
}

function videoSeriesLabel(
  video: InsightTreemapVideoRow,
  index: number,
  videos: readonly InsightTreemapVideoRow[],
): string {
  const trimmed = video.title.trim();
  const base = trimmed.length > 0 ? trimmed : untitledVideoLabel(index);
  const sameLabelCount = videos.filter((item, itemIndex) => {
    const itemTrimmed = item.title.trim();
    const itemBase =
      itemTrimmed.length > 0 ? itemTrimmed : untitledVideoLabel(itemIndex);
    return itemBase === base;
  }).length;
  return sameLabelCount > 1 ? `${base} (${index + 1})` : base;
}

function sortVideosByPublishedAt(
  videos: readonly InsightTreemapVideoRow[],
): InsightTreemapVideoRow[] {
  return [...videos].sort((left, right) => {
    const leftTime = left.publishedAt ? Date.parse(left.publishedAt) : 0;
    const rightTime = right.publishedAt ? Date.parse(right.publishedAt) : 0;
    return leftTime - rightTime;
  });
}

async function fetchInsightKpiSeries(): Promise<InsightTreemapResponse> {
  const params = new URLSearchParams({
    period: "1M",
    viewMode: "all",
    metricMode: "views",
  });
  const response = await fetch(`/api/admin/youtube-kpis?${params.toString()}`, {
    headers: { Accept: "application/json" },
  });
  if (!response.ok) {
    throw new Error("admin-insights-viz-kpis-failed");
  }
  return response.json() as Promise<InsightTreemapResponse>;
}

function buildTreemapSeries(
  videos: readonly InsightTreemapVideoRow[],
): ConsoleVizSeries[] {
  return videos.map((video, index) => ({
    label: videoSeriesLabel(video, index, videos),
    points: [video.viewCount],
    unit: "회",
    fractionDigits: 0,
  }));
}

function buildRangeBandSeries(
  videos: readonly InsightTreemapVideoRow[],
): ConsoleVizSeries[] {
  if (videos.length === 0) {
    return [];
  }
  const mid = videos.map((video) => video.viewCount);
  const low = videos.map((video) => video.previousViewCount ?? 0);
  const high = videos.map((video, index) => Math.max(mid[index] ?? 0, low[index] ?? 0));
  if (videos.length === 1) {
    return [
      {
        label: "조회수",
        points: [low[0] ?? 0, mid[0] ?? 0],
        unit: "회",
        fractionDigits: 0,
      },
      {
        label: "이전 조회수",
        points: [low[0] ?? 0, low[0] ?? 0],
        unit: "회",
        fractionDigits: 0,
      },
      {
        label: "상한",
        points: [high[0] ?? 0, high[0] ?? 0],
        unit: "회",
        fractionDigits: 0,
      },
    ];
  }
  return [
    {
      label: "조회수",
      points: mid,
      unit: "회",
      fractionDigits: 0,
    },
    {
      label: "이전 조회수",
      points: low,
      unit: "회",
      fractionDigits: 0,
    },
    {
      label: "상한",
      points: high,
      unit: "회",
      fractionDigits: 0,
    },
  ];
}

export function AdminInsightsVisualizations() {
  const kpiQuery = useQuery({
    queryKey: ["admin-insights-visualizations", "kpis", "1M"],
    queryFn: fetchInsightKpiSeries,
    staleTime: 60 * 1000,
    refetchOnWindowFocus: false,
  });
  const bindings = getConsoleVizBindings("insights");
  const treemapBinding = bindings.find((item) => item.form === "treemap-tile");
  const rangeBandBinding = bindings.find((item) => item.form === "range-band-area");
  const videos = sortVideosByPublishedAt(kpiQuery.data?.videos ?? []);
  const treemapSeries = buildTreemapSeries(videos);
  const rangeBandSeries = buildRangeBandSeries(videos);
  const requestStatus: ConsoleVizRequestStatus = kpiQuery.isError
    ? "error"
    : kpiQuery.isLoading
      ? "loading"
      : "settled";
  const latestViews = videos.at(-1)?.viewCount ?? 0;

  return (
    <div
      className="grid min-w-0 grid-cols-1 gap-3 lg:grid-cols-2"
      data-admin-insights-visualizations="true"
    >
      {treemapBinding ? (
        <ConsoleVizFormRenderer
          binding={treemapBinding}
          requestStatus={requestStatus}
          series={treemapSeries}
          metaLeft="영상별 기여도"
          metaRight={`${videos.length}개`}
        />
      ) : null}
      {rangeBandBinding ? (
        <ConsoleVizFormRenderer
          binding={rangeBandBinding}
          requestStatus={requestStatus}
          series={rangeBandSeries}
          metaLeft="변동 폭 구간"
          metaRight={`${latestViews}회`}
        />
      ) : null}
    </div>
  );
}
