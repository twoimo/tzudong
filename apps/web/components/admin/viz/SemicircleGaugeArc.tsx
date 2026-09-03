"use client";

import {
  countableConsoleVizPoints,
  getRenderableConsoleVizSeries,
  resolveConsoleVizFormState,
} from "@/lib/admin/console-viz-state";

import { ConsoleVizCard } from "./ConsoleVizCard";
import type { ConsoleVizFormProps } from "./viz-form-props";
import { paintConsoleSeries } from "./viz-paint";
import { useConsoleToneScale } from "@/hooks/use-console-tone-scale";

function polar(cx: number, cy: number, radius: number, angle: number) {
  const radians = (Math.PI * angle) / 180;
  return {
    x: cx + radius * Math.cos(radians),
    y: cy - radius * Math.sin(radians),
  };
}

function describeArc(
  cx: number,
  cy: number,
  radius: number,
  startAngle: number,
  endAngle: number,
) {
  const start = polar(cx, cy, radius, startAngle);
  const end = polar(cx, cy, radius, endAngle);
  const sweep = startAngle - endAngle;
  const largeArc = sweep > 180 ? 1 : 0;
  return `M ${start.x} ${start.y} A ${radius} ${radius} 0 ${largeArc} 1 ${end.x} ${end.y}`;
}

function buildGaugeArcs({
  values,
  labels,
  paints,
  cx,
  cy,
  radius,
}: {
  values: readonly number[];
  labels: readonly string[];
  paints: ReturnType<typeof paintConsoleSeries>["paints"];
  cx: number;
  cy: number;
  radius: number;
}) {
  const total = values.reduce((sum, value) => sum + value, 0);
  if (total <= 0) {
    return [];
  }
  return values
    .reduce<
      Array<{
        key: string;
        path: string;
        paint: (typeof paints)[number];
        cursor: number;
      }>
    >((arcs, value, index) => {
      const cursor = arcs.at(-1)?.cursor ?? 180;
      const sweep = (value / total) * 180;
      const end = cursor - sweep;
      return [
        ...arcs,
        {
          key: labels[index] ?? String(index),
          path: describeArc(cx, cy, radius, cursor, end),
          paint: paints[index],
          cursor: end,
        },
      ];
    }, [])
    .map(({ key, path, paint }) => ({ key, path, paint }));
}

export function SemicircleGaugeArc({
  binding,
  requestStatus,
  series,
  metaLeft,
  metaRight,
}: ConsoleVizFormProps) {
  const state = resolveConsoleVizFormState(binding, requestStatus, series);
  const scale = useConsoleToneScale();
  const renderable = getRenderableConsoleVizSeries(state, binding.minimumPoints);
  const { paints } = paintConsoleSeries(
    renderable.length,
    scale.tones,
    scale.resolved,
  );
  const values = renderable.map((item) => {
    const last = countableConsoleVizPoints(item).at(-1) ?? 0;
    return Math.max(0, last);
  });
  const cx = 120;
  const cy = 110;
  const radius = 78;
  const arcs = buildGaugeArcs({
    values,
    labels: renderable.map((item) => item.label),
    paints,
    cx,
    cy,
    radius,
  });

  return (
    <ConsoleVizCard
      binding={binding}
      state={state}
      metaLeft={metaLeft}
      metaRight={metaRight}
    >
      <svg
        viewBox="0 0 240 130"
        className="h-32 w-full"
        focusable="false"
      >
        <path
          d={describeArc(cx, cy, radius, 180, 0)}
          fill="none"
          stroke="var(--admin-tone-6)"
          strokeWidth={14}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {arcs.map((arc) => (
          <path
            key={arc.key}
            d={arc.path}
            fill="none"
            stroke={arc.paint?.stroke}
            strokeWidth={14}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ))}
      </svg>
    </ConsoleVizCard>
  );
}
