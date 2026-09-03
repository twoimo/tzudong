"use client";

import { Area, AreaChart, Line, ResponsiveContainer } from "recharts";

import { useConsoleToneScale } from "@/hooks/use-console-tone-scale";
import {
  getRenderableConsoleVizSeries,
  resolveConsoleVizFormState,
} from "@/lib/admin/console-viz-state";

import { ConsoleVizCard } from "./ConsoleVizCard";
import type { ConsoleVizFormProps } from "./viz-form-props";
import { paintConsoleSeries } from "./viz-paint";

export function RangeBandArea({
  binding,
  requestStatus,
  series,
  metaLeft,
  metaRight,
}: ConsoleVizFormProps) {
  const state = resolveConsoleVizFormState(binding, requestStatus, series);
  const scale = useConsoleToneScale();
  const renderable = getRenderableConsoleVizSeries(state, binding.minimumPoints);
  const { paints } = paintConsoleSeries(3, scale.tones, scale.resolved);
  const mid = renderable[0];
  const low = renderable[1] ?? mid;
  const high = renderable[2] ?? mid;
  const length = Math.max(
    mid?.points.length ?? 0,
    low?.points.length ?? 0,
    high?.points.length ?? 0,
  );
  const rows = Array.from({ length }, (_, index) => ({
    index: String(index + 1),
    mid: mid?.points[index] ?? 0,
    low: low?.points[index] ?? mid?.points[index] ?? 0,
    high: high?.points[index] ?? mid?.points[index] ?? 0,
  }));

  return (
    <ConsoleVizCard
      binding={binding}
      state={state}
      metaLeft={metaLeft}
      metaRight={metaRight}
    >
      {scale.resolved && rows.length > 0 ? (
        <div className="h-28 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={rows} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
              <Area
                type="monotone"
                dataKey="high"
                stroke="none"
                fill={paints[2]?.fill}
                fillOpacity={0.28}
                isAnimationActive={false}
              />
              <Area
                type="monotone"
                dataKey="low"
                stroke="none"
                fill="var(--card)"
                fillOpacity={1}
                isAnimationActive={false}
              />
              <Line
                type="monotone"
                dataKey="mid"
                stroke={paints[0]?.stroke}
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
                dot={false}
                isAnimationActive={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      ) : null}
    </ConsoleVizCard>
  );
}
