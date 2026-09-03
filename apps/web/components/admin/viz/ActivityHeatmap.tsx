"use client";

import {
  countableConsoleVizPoints,
  getRenderableConsoleVizSeries,
  resolveConsoleVizFormState,
} from "@/lib/admin/console-viz-state";
import { CONSOLE_TONE_STEP_IDS } from "@/lib/admin/console-tone-scale";

import { ConsoleVizCard } from "./ConsoleVizCard";
import type { ConsoleVizFormProps } from "./viz-form-props";

function toneForIntensity(ratio: number): `--admin-tone-${(typeof CONSOLE_TONE_STEP_IDS)[number]}` {
  if (ratio <= 0) return "--admin-tone-6";
  if (ratio < 0.25) return "--admin-tone-5";
  if (ratio < 0.5) return "--admin-tone-4";
  if (ratio < 0.75) return "--admin-tone-3";
  if (ratio < 0.9) return "--admin-tone-2";
  return "--admin-tone-1";
}

export function ActivityHeatmap({
  binding,
  requestStatus,
  series,
  metaLeft,
  metaRight,
  columnLabels,
}: ConsoleVizFormProps) {
  const state = resolveConsoleVizFormState(binding, requestStatus, series);
  const renderable = getRenderableConsoleVizSeries(state, binding.minimumPoints);
  const columnCount = Math.max(
    columnLabels?.length ?? 0,
    ...renderable.map((item) => item.points.length),
    0,
  );
  const labels =
    columnLabels && columnLabels.length === columnCount
      ? columnLabels
      : Array.from({ length: columnCount }, (_, index) => String(index + 1));
  const max = Math.max(
    1,
    ...renderable.flatMap((item) => countableConsoleVizPoints(item)),
  );

  return (
    <ConsoleVizCard
      binding={binding}
      state={state}
      metaLeft={metaLeft}
      metaRight={metaRight}
    >
      <div className="min-w-0 overflow-x-auto">
        <div
          className="grid gap-1"
          style={{
            gridTemplateColumns: `minmax(3.5rem,auto) repeat(${Math.max(columnCount, 1)}, minmax(0.75rem,1fr))`,
          }}
        >
          <span />
          {labels.map((label) => (
            <span
              key={label}
              className="truncate text-center text-[10px] text-[var(--admin-tone-2)]"
            >
              {label}
            </span>
          ))}
          {renderable.map((item) => (
            <div key={item.label} className="contents">
              <span className="truncate text-[10px] text-[var(--admin-tone-1)]">
                {item.label}
              </span>
              {labels.map((label, index) => {
                const value = item.points[index];
                const safe =
                  typeof value === "number" && Number.isFinite(value)
                    ? value
                    : 0;
                const token = toneForIntensity(safe / max);
                return (
                  <div
                    key={`${item.label}-${label}`}
                    className="h-4 min-w-3 rounded-[2px] border border-[var(--admin-tone-2)]"
                    style={{ background: `var(${token})` }}
                    title={`${item.label} ${label} ${safe}${item.unit}`}
                  />
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </ConsoleVizCard>
  );
}
