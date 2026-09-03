import type { ConsoleVizBinding } from "@/lib/admin/console-visualization-map";
import type {
  ConsoleVizRequestStatus,
  ConsoleVizSeries,
  ReviewThroughputTarget,
} from "@/lib/admin/console-viz-state";

export type ConsoleVizFormProps = {
  readonly binding: ConsoleVizBinding;
  readonly requestStatus: ConsoleVizRequestStatus;
  readonly series: readonly ConsoleVizSeries[];
  readonly metaLeft: string;
  readonly metaRight: string;
  readonly target?: ReviewThroughputTarget;
  readonly columnLabels?: readonly string[];
};

export function buildConsoleVizChartRows(
  series: readonly ConsoleVizSeries[],
): Array<Record<string, number | string>> {
  const length = series.reduce(
    (max, item) => Math.max(max, item.points.length),
    0,
  );
  return Array.from({ length }, (_, index) => {
    const row: Record<string, number | string> = { index: String(index + 1) };
    for (const item of series) {
      const point = item.points[index];
      if (typeof point === "number" && Number.isFinite(point)) {
        row[item.label] = point;
      }
    }
    return row;
  });
}
