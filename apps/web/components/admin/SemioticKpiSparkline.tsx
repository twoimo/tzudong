"use client";

import { useMemo } from "react";
import { LineChart } from "semiotic/line";

/** One bounded canvas per KPI; the visible card remains the accessible summary. */
export default function SemioticKpiSparkline({ points, color, title }: {
  points: { label: string; value: number }[];
  color: string;
  title: string;
}) {
  const data = useMemo(() => points.map((point, index) => ({ ...point, x: index }))
    .filter(point => Number.isFinite(point.value)), [points]);
  const values = data.map(point => point.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const padding = Math.max((max - min) * 0.3, Math.max(Math.abs(min), Math.abs(max)) * 0.08, 1);
  if (data.length < 2) return null;
  return <LineChart
    data={data}
    mode="sparkline"
    accessibleTable={false}
    xAccessor="x"
    yAccessor="value"
    colorScheme={[color]}
    stroke={color}
    curve="monotoneX"
    lineWidth={2}
    width={96}
    height={44}
    responsiveWidth
    responsiveHeight
    maxDevicePixelRatio={2}
    margin={4}
    yExtent={[min - padding, max + padding]}
    showLegend={false}
    showGrid={false}
    enableHover
    tooltip={(point) => <div className="rounded-lg border bg-popover p-2 text-[13px] text-popover-foreground shadow-md">
      <p>{title} · {String(point.label ?? "기간")}</p>
      <p className="font-semibold tabular-nums">{Number(point.value).toLocaleString("ko-KR")}</p>
    </div>}
  />;
}
