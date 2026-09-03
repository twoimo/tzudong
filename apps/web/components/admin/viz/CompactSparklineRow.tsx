"use client";

import { Line, LineChart, ResponsiveContainer } from "recharts";

import { useConsoleToneScale } from "@/hooks/use-console-tone-scale";
import {
  getRenderableConsoleVizSeries,
  resolveConsoleVizFormState,
} from "@/lib/admin/console-viz-state";

import { ConsoleVizCard } from "./ConsoleVizCard";
import { buildConsoleVizChartRows, type ConsoleVizFormProps } from "./viz-form-props";
import { paintConsoleSeries } from "./viz-paint";

export function CompactSparklineRow({
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

  return (
    <ConsoleVizCard
      binding={binding}
      state={state}
      metaLeft={metaLeft}
      metaRight={metaRight}
    >
      <div className="grid gap-2">
        {renderable.map((item, index) => {
          const rows = buildConsoleVizChartRows([item]);
          return (
            <div key={item.label} className="grid grid-cols-[minmax(0,5.5rem)_1fr] items-center gap-2">
              <span className="truncate text-[11px] text-[var(--admin-tone-1)]">
                {item.label}
              </span>
              {scale.resolved && rows.length > 0 ? (
                <div className="h-6 min-w-0">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={rows} margin={{ top: 2, right: 2, bottom: 2, left: 2 }}>
                      <Line
                        type="monotone"
                        dataKey={item.label}
                        stroke={paints[index]?.stroke}
                        strokeWidth={1.8}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        dot={false}
                        isAnimationActive={false}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </ConsoleVizCard>
  );
}
