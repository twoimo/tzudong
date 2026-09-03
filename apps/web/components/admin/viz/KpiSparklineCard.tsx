"use client";

import {
  Line,
  LineChart,
  ResponsiveContainer,
} from "recharts";

import { useConsoleToneScale } from "@/hooks/use-console-tone-scale";
import {
  getRenderableConsoleVizSeries,
  resolveConsoleVizFormState,
} from "@/lib/admin/console-viz-state";

import { ConsoleVizCard } from "./ConsoleVizCard";
import { buildConsoleVizChartRows, type ConsoleVizFormProps } from "./viz-form-props";
import { paintConsoleSeries } from "./viz-paint";

export function KpiSparklineCard({
  binding,
  requestStatus,
  series,
  metaLeft,
  metaRight,
}: ConsoleVizFormProps) {
  const state = resolveConsoleVizFormState(binding, requestStatus, series);
  const scale = useConsoleToneScale();
  const renderable = getRenderableConsoleVizSeries(state, binding.minimumPoints);
  const rows = buildConsoleVizChartRows(renderable);
  const { paints } = paintConsoleSeries(
    renderable.length,
    scale.tones,
    scale.resolved,
  );

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
            <LineChart data={rows} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
              {renderable.map((item, index) => (
                <Line
                  key={item.label}
                  type="monotone"
                  dataKey={item.label}
                  stroke={paints[index]?.stroke}
                  strokeWidth={2}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  dot={false}
                  isAnimationActive={false}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
      ) : null}
    </ConsoleVizCard>
  );
}
