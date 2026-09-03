"use client";

import { Bar, BarChart, ResponsiveContainer, XAxis, YAxis } from "recharts";

import { useConsoleToneScale } from "@/hooks/use-console-tone-scale";
import { getBarEndRadius } from "@/lib/admin/console-tone-scale";
import {
  getRenderableConsoleVizSeries,
  resolveConsoleVizFormState,
} from "@/lib/admin/console-viz-state";

import { ConsoleVizCard } from "./ConsoleVizCard";
import { buildConsoleVizChartRows, type ConsoleVizFormProps } from "./viz-form-props";
import { paintConsoleSeries } from "./viz-paint";

const BAR_THICKNESS_PX = 22;

export function ToneStackedBar({
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
  const rows = buildConsoleVizChartRows(renderable);
  const radius = getBarEndRadius(BAR_THICKNESS_PX);

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
            <BarChart data={rows} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
              <XAxis dataKey="index" hide />
              <YAxis hide />
              {renderable.map((item, index) => (
                <Bar
                  key={item.label}
                  dataKey={item.label}
                  stackId="tone"
                  fill={paints[index]?.fill}
                  stroke={paints[index]?.stroke}
                  strokeWidth={paints[index]?.strokeWidth}
                  barSize={BAR_THICKNESS_PX}
                  radius={
                    index === renderable.length - 1
                      ? [radius, radius, 0, 0]
                      : [0, 0, 0, 0]
                  }
                  isAnimationActive={false}
                />
              ))}
            </BarChart>
          </ResponsiveContainer>
        </div>
      ) : null}
    </ConsoleVizCard>
  );
}
