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

export function StageFunnel({
  binding,
  requestStatus,
  series,
  metaLeft,
  metaRight,
}: ConsoleVizFormProps) {
  const state = resolveConsoleVizFormState(binding, requestStatus, series);
  const scale = useConsoleToneScale();
  const renderable = getRenderableConsoleVizSeries(state, binding.minimumPoints);
  const { paints, requiresNonToneChannel } = paintConsoleSeries(
    renderable.length,
    scale.tones,
    scale.resolved,
  );
  const values = renderable.map(
    (item) => countableConsoleVizPoints(item).at(-1) ?? 0,
  );
  const max = Math.max(...values, 1);
  const height = 28;
  const gap = 6;
  const width = 240;

  return (
    <ConsoleVizCard
      binding={binding}
      state={state}
      metaLeft={metaLeft}
      metaRight={metaRight}
    >
      <svg
        viewBox={`0 0 ${width} ${renderable.length * (height + gap)}`}
        className="w-full"
        focusable="false"
      >
        {renderable.map((item, index) => {
          const ratio = Math.max(0.18, values[index] / max);
          const bandWidth = width * ratio;
          const x = (width - bandWidth) / 2;
          const y = index * (height + gap);
          const nextRatio =
            index < renderable.length - 1
              ? Math.max(0.18, values[index + 1] / max)
              : ratio * 0.72;
          const nextWidth = width * nextRatio;
          const nextX = (width - nextWidth) / 2;
          const points = [
            `${x},${y}`,
            `${x + bandWidth},${y}`,
            `${nextX + nextWidth},${y + height}`,
            `${nextX},${y + height}`,
          ].join(" ");
          return (
            <g key={item.label}>
              <polygon
                points={points}
                fill={paints[index]?.fill}
                stroke={paints[index]?.stroke}
                strokeWidth={paints[index]?.strokeWidth}
              />
              {requiresNonToneChannel ? (
                <text
                  x={width / 2}
                  y={y + height / 2 + 4}
                  textAnchor="middle"
                  className="fill-[var(--admin-tone-1)]"
                  fontSize="10"
                >
                  {item.label}
                </text>
              ) : null}
            </g>
          );
        })}
      </svg>
    </ConsoleVizCard>
  );
}
