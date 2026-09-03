import { describe, expect, test } from "bun:test";

import {
  CONSOLE_VIZ_STATE_KINDS,
  formatConsoleVizSeriesValue,
  getRenderableConsoleVizSeries,
  resolveConsoleVizState,
  REVIEW_THROUGHPUT_TARGET,
  type ConsoleVizRequestStatus,
  type ConsoleVizSeries,
} from "../lib/admin/console-viz-state";
import { mulberry32 } from "./helpers/deterministic-generator";

const REQUEST_STATUSES: readonly ConsoleVizRequestStatus[] = [
  "loading",
  "error",
  "settled",
];

function seriesOf(
  label: string,
  points: readonly number[],
): ConsoleVizSeries {
  return { label, points, unit: "건", fractionDigits: 0 };
}

function generateVizStateCases(count: number) {
  const random = mulberry32(0x10c015);
  const cases: Array<{
    requestStatus: ConsoleVizRequestStatus;
    minimumPoints: 1 | 2;
    series: ConsoleVizSeries[];
  }> = [
    { requestStatus: "loading", minimumPoints: 2, series: [] },
    { requestStatus: "error", minimumPoints: 1, series: [seriesOf("조회수", [3])] },
    { requestStatus: "settled", minimumPoints: 2, series: [] },
    { requestStatus: "settled", minimumPoints: 2, series: [seriesOf("조회수", [])] },
    {
      requestStatus: "settled",
      minimumPoints: 2,
      series: [seriesOf("조회수", [1])],
    },
    {
      requestStatus: "settled",
      minimumPoints: 2,
      series: [seriesOf("조회수", [2, 4]), seriesOf("좋아요", [])],
    },
    {
      requestStatus: "settled",
      minimumPoints: 1,
      series: [seriesOf("제보", [0]), seriesOf("리뷰", [2])],
    },
  ];

  while (cases.length < count) {
    const requestStatus =
      REQUEST_STATUSES[Math.floor(random() * REQUEST_STATUSES.length)] ??
      "settled";
    const minimumPoints: 1 | 2 = random() < 0.5 ? 1 : 2;
    const seriesCount = Math.floor(random() * 5);
    const series = Array.from({ length: seriesCount }, (_, index) => {
      const pointCount = Math.floor(random() * 4);
      return seriesOf(
        `계열${index + 1}`,
        Array.from({ length: pointCount }, () => Math.floor(random() * 12)),
      );
    });
    cases.push({ requestStatus, minimumPoints, series });
  }

  return cases;
}

const VIZ_CASES = generateVizStateCases(120);

describe("admin console visualization state", () => {
  // Property 15: 시각화 상태 배타성
  // Validates: Requirements 3.11, 10.5, 10.6, 10.11, 10.12
  test("resolves exactly one visualization state and renders shapes only when ready", () => {
    expect(VIZ_CASES.length).toBeGreaterThanOrEqual(100);

    for (const input of VIZ_CASES) {
      const state = resolveConsoleVizState(input);
      const kinds = CONSOLE_VIZ_STATE_KINDS.filter((kind) => state.kind === kind);
      expect(kinds).toHaveLength(1);

      const renderable = getRenderableConsoleVizSeries(
        state,
        input.minimumPoints,
      );
      if (state.kind === "ready") {
        expect(renderable.length).toBeGreaterThan(0);
        for (const item of renderable) {
          expect(item.points.filter(Number.isFinite).length).toBeGreaterThanOrEqual(
            input.minimumPoints,
          );
        }
        const zeroPointLabels = input.series
          .filter((item) => item.points.filter(Number.isFinite).length === 0)
          .map((item) => item.label);
        expect([...state.sparseSeriesLabels]).toEqual(zeroPointLabels);
        const summary = [
          ...state.series.map((item) => item.label),
          ...state.sparseSeriesLabels,
        ].join(" ");
        for (const label of zeroPointLabels) {
          expect(summary).toContain(label);
        }
      } else {
        expect(renderable).toEqual([]);
      }

      if (input.requestStatus === "loading") {
        expect(state.kind).toBe("loading");
      }
      if (input.requestStatus === "error") {
        expect(state.kind).toBe("error");
      }
      if (input.requestStatus === "settled") {
        const totalPoints = input.series.reduce(
          (sum, item) => sum + item.points.filter(Number.isFinite).length,
          0,
        );
        const readyCount = input.series.filter(
          (item) => item.points.filter(Number.isFinite).length >= input.minimumPoints,
        ).length;
        if (totalPoints === 0) {
          expect(state.kind).toBe("empty");
        } else if (readyCount === 0) {
          expect(state.kind).toBe("insufficient");
        } else {
          expect(state.kind).toBe("ready");
        }
      }
    }
  });

  test("keeps mixed ready and zero-point series out of the empty branch", () => {
    const state = resolveConsoleVizState({
      requestStatus: "settled",
      minimumPoints: 2,
      series: [seriesOf("조회수", [4, 8]), seriesOf("댓글", [])],
    });
    expect(state.kind).toBe("ready");
    if (state.kind !== "ready") return;
    expect(state.sparseSeriesLabels).toEqual(["댓글"]);
    expect(
      getRenderableConsoleVizSeries(state, 2).map((item) => item.label),
    ).toEqual(["조회수"]);
    expect(formatConsoleVizSeriesValue(seriesOf("조회수", [4, 8]))).toBe("8건");
  });

  test("does not invent an approved review throughput target value", () => {
    expect(REVIEW_THROUGHPUT_TARGET).toEqual({ approved: false });
    expect("value" in REVIEW_THROUGHPUT_TARGET).toBe(false);
  });
});
