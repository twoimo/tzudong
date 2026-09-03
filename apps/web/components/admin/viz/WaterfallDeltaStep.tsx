"use client";

import { Bar, BarChart, ResponsiveContainer, XAxis, YAxis } from "recharts";

import { useConsoleToneScale } from "@/hooks/use-console-tone-scale";
import { getBarEndRadius } from "@/lib/admin/console-tone-scale";
import {
  countableConsoleVizPoints,
  getRenderableConsoleVizSeries,
  resolveConsoleVizFormState,
} from "@/lib/admin/console-viz-state";

import { ConsoleVizCard } from "./ConsoleVizCard";
import type { ConsoleVizFormProps } from "./viz-form-props";
import { paintConsoleSeries } from "./viz-paint";

const BAR_THICKNESS_PX = 20;

export function WaterfallDeltaStep({
  binding,
  requestStatus,
  series,
  metaLeft,
  metaRight,
}: ConsoleVizFormProps) {
  const state = resolveConsoleVizFormState(binding, requestStatus, series);
  const scale = useConsoleToneScale();
  const renderable = getRenderableConsoleVizSeries(state, binding.minimumPoints);
  const { paints } = paintConsoleSeries(2, scale.tones, scale.resolved);
  let cursor = 0;
  const rows = renderable.map((item) => {
    const delta = countableConsoleVizPoints(item).at(-1) ?? 0;
    const base = delta >= 0 ? cursor : cursor + delta;
    cursor += delta;
    return {
      label: item.label,
      base: Math.max(0, base),
      value: Math.abs(delta),
    };
  });
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
              <XAxis dataKey="label" hide />
              <YAxis hide />
              <Bar
                dataKey="base"
                stackId="waterfall"
                fill="transparent"
                isAnimationActive={false}
              />
              <Bar
                dataKey="value"
                stackId="waterfall"
                fill={paints[0]?.fill}
                stroke={paints[0]?.stroke}
                strokeWidth={paints[0]?.strokeWidth}
                barSize={BAR_THICKNESS_PX}
                radius={[radius, radius, 0, 0]}
                isAnimationActive={false}
              />
            </BarChart>
          </ResponsiveContainer>
        </div>
      ) : null}
    </ConsoleVizCard>
  );
}
