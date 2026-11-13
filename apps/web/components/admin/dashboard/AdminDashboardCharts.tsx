"use client";

import type { ReactNode } from "react";
import { buildAdminDashboardOpsChartData } from "@/lib/admin/dashboard-ops-chart-data";
import {
  AreaChart,
  BarChart,
  BubbleChart,
  LineChart,
  ThemeProvider,
  type ChartEvent,
} from "ztd-charts";

type ChartDatum = Record<string, string | number | null>;

const adminChartTheme = {
  bg: "hsl(var(--background))",
  panel: "hsl(var(--card))",
  ink: "hsl(var(--foreground))",
  muted: "hsl(var(--muted-foreground))",
  dim: "hsl(var(--muted-foreground) / 0.62)",
  accent: "hsl(var(--primary))",
  accentText: "hsl(var(--primary))",
  onAccent: "hsl(var(--primary-foreground))",
  accent2: "hsl(var(--muted-foreground))",
  accent3: "hsl(var(--primary) / 0.62)",
  onInk: "hsl(var(--foreground))",
  line: "hsl(var(--border))",
  line2: "hsl(var(--border) / 0.62)",
  neutral: "hsl(var(--muted-foreground) / 0.32)",
  neutralStrong: "hsl(var(--muted-foreground) / 0.52)",
  onNeutralStrong: "hsl(var(--foreground))",
  neutralSoft: "hsl(var(--muted) / 0.78)",
  lift: "hsl(var(--muted))",
  tint: "hsl(var(--primary) / 0.12)",
  radius: 0,
  radiusCode: 0,
  radiusMark: 0,
};

function Theme({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider theme={adminChartTheme} base="light" locale="ko-KR" cssVars={false}>
      {children}
    </ThemeProvider>
  );
}

function tooltip(title: string, label: string, value: string, note: string) {
  return (
    <div className="max-w-64 border border-border bg-background px-3 py-2 text-xs text-foreground shadow-none">
      <p className="font-semibold">{title}</p>
      <p className="mt-1 tabular-nums">{label}: {value}</p>
      <p className="mt-1 text-muted-foreground">{note}</p>
    </div>
  );
}

function formatCount(value: unknown) {
  return typeof value === "number" && Number.isFinite(value)
    ? new Intl.NumberFormat("ko-KR").format(value)
    : "확인 불가";
}

export function DashboardSparkline({
  data,
  label,
}: {
  data: readonly { label: string; value: number }[];
  label: string;
}) {
  return (
    <Theme>
      <AreaChart
        data={data}
        x="label"
        y="value"
        height={44}
        showXAxis={false}
        showYAxis={false}
        showLabels={false}
        tooltip={false}
        animate={false}
        ariaLabel={`${label} 최근 추이`}
        description={`${label} 실제 조회 데이터의 최근 변화입니다.`}
        className="h-full w-full"
      />
    </Theme>
  );
}

export function DashboardTrendChart({
  data,
  visibleSeries,
  totalPointCount,
}: {
  data: readonly ChartDatum[];
  visibleSeries: readonly string[];
  totalPointCount: number;
}) {
  if (!data.length || !visibleSeries.length) return null;
  return (
    <Theme>
      <LineChart
        data={data}
        x="label"
        y={[...visibleSeries]}
        height={208}
        showLabels={false}
        showXAxis
        showYAxis
        format="integer"
        animate={false}
        tooltip={(event: ChartEvent<ChartDatum>) => tooltip(
          event.label,
          event.key,
          formatCount(event.value),
          "선택 기간의 실제 영상 성과를 게시일 순서로 정규화한 값입니다."
        )}
        ariaLabel="조회수, 참여, 참여율 정규화 비교 추이"
        description={`실제 데이터 ${data.length}개 표시, 전체 대상 ${totalPointCount}개. 숨김 처리된 지표는 표시하지 않습니다.`}
        className="w-full"
      />
    </Theme>
  );
}

export function DashboardBubbleChart({
  data,
}: {
  data: readonly ChartDatum[];
}) {
  if (!data.length) return null;
  return (
    <Theme>
      <BubbleChart
        data={data}
        x="조회수"
        y="참여"
        size="규모"
        label="title"
        height={224}
        format="compact"
        showLabels
        animate={false}
        tooltip={(event: ChartEvent<ChartDatum>) => {
          const row = event.datum;
          return tooltip(
            String(row?.title ?? event.label),
            event.key,
            formatCount(event.value),
            "조회수는 가로 위치, 참여(좋아요+댓글)는 세로 위치와 원 크기로 표시합니다."
          );
        }}
        ariaLabel="영상별 조회수와 참여 규모 분산"
        description="점 하나가 실제 영상 하나입니다. 가로축은 조회수, 세로축은 좋아요와 댓글의 합, 원 크기는 참여 수입니다."
        className="w-full"
      />
    </Theme>
  );
}

export function DashboardEngagementChart({
  data,
}: {
  data: readonly ChartDatum[];
}) {
  if (!data.length) return null;
  return (
    <Theme>
      <AreaChart
        data={data}
        x="label"
        y="참여율"
        height={208}
        format="decimal"
        unit="%"
        showLabels={false}
        animate={false}
        tooltip={(event: ChartEvent<ChartDatum>) => tooltip(
          event.label,
          "참여율",
          `${Number(event.value ?? 0).toFixed(2)}%`,
          "참여 ÷ 조회수 × 100"
        )}
        ariaLabel="영상별 참여율 추이"
        description="선택 기간의 실제 참여율입니다. 참여율은 좋아요와 댓글을 조회수로 나눈 값입니다."
        className="w-full"
      />
    </Theme>
  );
}

export function DashboardOpsBars({
  sections,
}: {
  sections: readonly {
    title: string;
    rows: readonly { label: string; value: string; rawValue: number | null }[];
  }[];
}) {
  return (
    <Theme>
      <div className="grid gap-3" aria-label="운영 및 검수 현황">
        {sections.map((section) => {
          const { data, unavailableLabels } = buildAdminDashboardOpsChartData(section.rows);
          return (
            <section key={section.title} className="min-w-0" aria-label={section.title}>
              <h3 className="mb-1 text-xs font-semibold text-muted-foreground">{section.title}</h3>
              {data.length ? (
              <BarChart
                data={data}
                x="label"
                y="value"
                orientation="horizontal"
                height={Math.max(88, data.length * 24)}
                yDomain={[0, 100]}
                showLabels={false}
                animate={false}
                tooltip={(event: ChartEvent<{ label: string; value: number; rawValue: number | null; displayValue: string }>) => {
                  const row = event.datum;
                  return tooltip(
                    event.label,
                    section.title,
                    String(row?.displayValue ?? "확인 불가"),
                    "막대 길이는 같은 구분 안에서 최댓값 대비 비율입니다."
                  );
                }}
                ariaLabel={`${section.title} 상대 크기 비교`}
                description={`${data.map((row) => `${row.label} ${row.displayValue}`).join("; ")}. 막대 길이는 같은 구분 안에서 최댓값 대비 비율입니다.`}
                className="w-full"
              />
              ) : (
                <p className="text-xs text-muted-foreground">확인 가능한 수치가 없습니다.</p>
              )}
              {unavailableLabels.length ? (
                <p className="mt-1 text-2xs text-muted-foreground" aria-label={`${section.title} 확인 불가 항목`}>
                  확인 불가: {unavailableLabels.join(", ")}
                </p>
              ) : null}
            </section>
          );
        })}
      </div>
    </Theme>
  );
}

export function DashboardRankBars({
  metrics,
}: {
  metrics: readonly {
    label: string;
    rows: readonly { label: string; value: number }[];
  }[];
}) {
  const visible = metrics.filter((metric) => metric.rows.length > 0);
  if (!visible.length) return null;
  return (
    <Theme>
      <div className="grid gap-3" aria-label="상위 영상 성과 순위">
        {visible.map((metric) => (
          <section key={metric.label} className="min-w-0" aria-label={`${metric.label} 순위`}>
            <h3 className="mb-1 text-xs font-semibold text-muted-foreground">{metric.label}</h3>
            <BarChart
              data={metric.rows}
              x="label"
              y="value"
              orientation="horizontal"
              height={Math.max(104, metric.rows.length * 24)}
              format="compact"
              sort={false}
              showLabels
              animate={false}
              tooltip={(event: ChartEvent<ChartDatum>) => tooltip(
                event.label,
                metric.label,
                formatCount(event.value),
                "선택 기간의 실제 집계값입니다."
              )}
              ariaLabel={`${metric.label} 상위 ${metric.rows.length}개 영상`}
              description={`${metric.rows.map((row, index) => `${index + 1}위 ${row.label} ${formatCount(row.value)}`).join("; ")}`}
              className="w-full"
            />
          </section>
        ))}
      </div>
    </Theme>
  );
}
