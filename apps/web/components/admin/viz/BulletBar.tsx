"use client";

import { Bar, BarChart, ReferenceLine, ResponsiveContainer, XAxis, YAxis } from "recharts";

import { useConsoleToneScale } from "@/hooks/use-console-tone-scale";
import { CONSOLE_FIXED_MESSAGES } from "@/lib/admin/console-messages";
import { getBarEndRadius } from "@/lib/admin/console-tone-scale";
import {
  countableConsoleVizPoints,
  getRenderableConsoleVizSeries,
  resolveConsoleVizFormState,
  REVIEW_THROUGHPUT_TARGET,
} from "@/lib/admin/console-viz-state";

import { ConsoleVizCard } from "./ConsoleVizCard";
import type { ConsoleVizFormProps } from "./viz-form-props";
import { paintConsoleSeries } from "./viz-paint";

const BAR_THICKNESS_PX = 18;

export function BulletBar({
  binding,
  requestStatus,
  series,
  metaLeft,
  metaRight,
  target = REVIEW_THROUGHPUT_TARGET,
}: ConsoleVizFormProps) {
  const state = resolveConsoleVizFormState(binding, requestStatus, series);
  const scale = useConsoleToneScale();
  const renderable = getRenderableConsoleVizSeries(state, binding.minimumPoints);
  const { paints } = paintConsoleSeries(
    renderable.length,
    scale.tones,
    scale.resolved,
  );
  const rows = renderable.map((item) => ({
    label: item.label,
    value: countableConsoleVizPoints(item).at(-1) ?? 0,
  }));
  const radius = getBarEndRadius(BAR_THICKNESS_PX);
  const showTarget = target.approved === true;

  return (
    <ConsoleVizCard
      binding={binding}
      state={state}
      metaLeft={metaLeft}
      metaRight={metaRight}
      extraMessage={
        showTarget ? undefined : CONSOLE_FIXED_MESSAGES.reviewTargetUnapproved
      }
    >
      {scale.resolved && rows.length > 0 ? (
        <div className="h-28 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={rows}
              layout="vertical"
              margin={{ top: 4, right: 8, bottom: 0, left: 8 }}
            >
              <XAxis type="number" hide />
              <YAxis type="category" dataKey="label" hide />
              <Bar
                dataKey="value"
                fill={paints[0]?.fill}
                stroke={paints[0]?.stroke}
                strokeWidth={paints[0]?.strokeWidth}
                barSize={BAR_THICKNESS_PX}
                radius={[radius, radius, radius, radius]}
                isAnimationActive={false}
              />
              {showTarget ? (
                <ReferenceLine
                  x={target.value}
                  stroke={scale.hairline}
                  strokeDasharray="3 3"
                />
              ) : null}
            </BarChart>
          </ResponsiveContainer>
        </div>
      ) : null}
    </ConsoleVizCard>
  );
}
