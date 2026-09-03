"use client";

import {
  formatConsoleVizSeriesValue,
  type ConsoleVizSeries,
} from "@/lib/admin/console-viz-state";
import { cn } from "@/lib/utils";

import type { ConsoleVizValueHint } from "./use-viz-value-hint";

export function ConsoleVizSummary({
  series,
  sparseSeriesLabels = [],
  activeKey,
  onShow,
  onHide,
}: {
  series: readonly ConsoleVizSeries[];
  sparseSeriesLabels?: readonly string[];
  activeKey: string | null;
  onShow: (hint: ConsoleVizValueHint) => void;
  onHide: (key?: string) => void;
}) {
  return (
    <div
      className="flex flex-wrap gap-1.5"
      data-admin-viz-summary="true"
    >
      {series.map((item) => {
        const key = item.label;
        const value = formatConsoleVizSeriesValue(item);
        return (
          <button
            key={key}
            type="button"
            className={cn(
              "rounded-[var(--admin-control-radius)] border border-[var(--admin-hairline)] px-2 py-0.5 text-left text-[11px] leading-4 text-[var(--admin-tone-1)]",
              activeKey === key && "bg-[var(--admin-tone-6)]",
            )}
            data-admin-viz-series-summary={key}
            onMouseEnter={() => onShow({ key, label: item.label, value })}
            onMouseLeave={() => onHide(key)}
            onFocus={() => onShow({ key, label: item.label, value })}
            onBlur={() => onHide(key)}
          >
            {item.label} {value}
          </button>
        );
      })}
      {sparseSeriesLabels.map((label) => (
        <span
          key={`sparse-${label}`}
          className="text-[11px] leading-4 text-[var(--admin-tone-2)]"
          data-admin-viz-sparse-series={label}
        >
          {label}
        </span>
      ))}
    </div>
  );
}
