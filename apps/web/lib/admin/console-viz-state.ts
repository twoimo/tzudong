import type { ConsoleVizBinding } from "@/lib/admin/console-visualization-map";

export type ConsoleVizRequestStatus = "loading" | "error" | "settled";

export type ConsoleVizSeries = {
  readonly label: string;
  readonly points: readonly number[];
  readonly unit: string;
  readonly fractionDigits: number;
};

export type ConsoleVizState =
  | { readonly kind: "loading" }
  | { readonly kind: "error" }
  | { readonly kind: "empty" }
  | { readonly kind: "insufficient"; readonly series: readonly ConsoleVizSeries[] }
  | {
      readonly kind: "ready";
      readonly series: readonly ConsoleVizSeries[];
      readonly sparseSeriesLabels: readonly string[];
    };

export type ReviewThroughputTarget =
  | {
      readonly approved: true;
      readonly value: number;
      readonly approvalSource: string;
    }
  | { readonly approved: false };

export const REVIEW_THROUGHPUT_TARGET: ReviewThroughputTarget = {
  approved: false,
};

export const CONSOLE_VIZ_STATE_KINDS = [
  "loading",
  "error",
  "empty",
  "insufficient",
  "ready",
] as const;

export function countableConsoleVizPoints(
  series: ConsoleVizSeries,
): readonly number[] {
  return series.points.filter(
    (point) => typeof point === "number" && Number.isFinite(point),
  );
}

export function resolveConsoleVizState(input: {
  requestStatus: ConsoleVizRequestStatus;
  series: readonly ConsoleVizSeries[];
  minimumPoints: 1 | 2;
}): ConsoleVizState {
  if (input.requestStatus === "loading") {
    return { kind: "loading" };
  }
  if (input.requestStatus === "error") {
    return { kind: "error" };
  }

  const counted = input.series.map((series) => ({
    series,
    points: countableConsoleVizPoints(series),
  }));
  const totalPoints = counted.reduce((sum, item) => sum + item.points.length, 0);
  if (totalPoints === 0) {
    return { kind: "empty" };
  }

  const renderable = counted.filter(
    (item) => item.points.length >= input.minimumPoints,
  );
  if (renderable.length === 0) {
    return { kind: "insufficient", series: input.series };
  }

  return {
    kind: "ready",
    series: input.series,
    sparseSeriesLabels: counted
      .filter((item) => item.points.length === 0)
      .map((item) => item.series.label),
  };
}

export function getRenderableConsoleVizSeries(
  state: ConsoleVizState,
  minimumPoints: 1 | 2,
): readonly ConsoleVizSeries[] {
  if (state.kind !== "ready") {
    return [];
  }
  return state.series.filter(
    (series) => countableConsoleVizPoints(series).length >= minimumPoints,
  );
}

export function formatConsoleVizSeriesValue(series: ConsoleVizSeries): string {
  const points = countableConsoleVizPoints(series);
  const last = points.at(-1);
  if (last == null) {
    return "—";
  }
  const digits = Number.isInteger(series.fractionDigits)
    ? Math.max(0, series.fractionDigits)
    : 0;
  return `${last.toFixed(digits)}${series.unit}`;
}

export function truncateConsoleMetaText(value: string, maxChars = 24): string {
  const chars = Array.from(value.trim());
  if (chars.length <= maxChars) {
    return chars.join("");
  }
  return chars.slice(0, maxChars).join("");
}

export function resolveConsoleVizFormState(
  binding: ConsoleVizBinding,
  requestStatus: ConsoleVizRequestStatus,
  series: readonly ConsoleVizSeries[],
): ConsoleVizState {
  return resolveConsoleVizState({
    requestStatus,
    series,
    minimumPoints: binding.minimumPoints,
  });
}
