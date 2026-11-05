import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { getDashboardKpiPresentation } from "../lib/admin/dashboard-kpi-presentation";

const source = readFileSync(new URL("../components/admin/AdminConsoleOverview.tsx", import.meta.url), "utf8");
const parsed = ts.createSourceFile("overview.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

// Exercise the actual existing arithmetic without mounting the unrelated admin shell.
const functionNames = ["hasDashboardSnapshotComparison", "getDashboardPeriodMetricValue", "getDashboardRatio", "formatDashboardPercent"];
const valueNames = [
  "periodViewValue", "periodLikeValue", "periodCommentValue", "videoSnapshotComparisonAvailable",
  "videoPeriodDeltasAreFlat", "hasPeriodGrowthComparison", "periodCohortViewValue", "periodCohortLikeValue",
  "periodCohortCommentValue", "periodViewDisplayValue", "periodLikeDisplayValue", "periodCommentDisplayValue",
  "likeRate", "commentRate", "channelViewDelta", "viewCardValue",
];
const statements = new Map<string, string>();
function collect(node: ts.Node) {
  if (ts.isFunctionDeclaration(node) && node.name && functionNames.includes(node.name.text)) {
    statements.set(node.name.text, node.getText(parsed));
  }
  if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && valueNames.includes(node.name.text)) {
    statements.set(node.name.text, `const ${node.getText(parsed)};`);
  }
  ts.forEachChild(node, collect);
}
collect(parsed);
const names = [...functionNames, ...valueNames];
if (names.some((name) => !statements.has(name))) throw new Error("KPI calculation source changed");
const arithmetic = ts.transpileModule(
  names.map((name) => statements.get(name)).join("\n") + `\nreturn { videoPeriodDeltasAreFlat, hasPeriodGrowthComparison, channelViewDelta, periodViewDisplayValue, periodLikeDisplayValue, periodCommentDisplayValue, viewCardValue, likeRate, commentRate, likeLabel: formatDashboardPercent(likeRate), commentLabel: formatDashboardPercent(commentRate) };`,
  { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } },
).outputText;
const evaluate = new Function("videos", "growthVideos", "period", "channelStats", arithmetic) as (
  videos: object[], growthVideos: object[], period: string, channelStats: object,
) => {
  videoPeriodDeltasAreFlat: boolean;
  hasPeriodGrowthComparison: boolean;
  channelViewDelta: number | null;
  periodViewDisplayValue: number;
  periodLikeDisplayValue: number;
  periodCommentDisplayValue: number;
  viewCardValue: number;
  likeRate: number;
  commentRate: number;
  likeLabel: string;
  commentLabel: string;
};

const normal = {
  isAllPeriod: false,
  selectedPeriodLabel: "1개월",
  hasPeriodGrowthComparison: true,
  videoPeriodDeltasAreFlat: false,
  hasPeriodCohortVideos: true,
  channelViewDelta: 267_340_664,
  viewDenominatorLabel: "1,000",
};

describe("dashboard KPI presentation scopes", () => {
  test("actual period-delta arithmetic stays paired with period-delta labels", () => {
    const video = {
      viewCount: 2_000, previousViewCount: 1_000,
      likeCount: 70, previousLikeCount: 20,
      commentCount: 5, previousCommentCount: 2,
      comparisonStatus: "compared",
    };
    const values = evaluate([video], [video], "1M", { viewCount: 10_000, previousViewCount: 1_000 });
    const result = getDashboardKpiPresentation({
      ...normal, ...values, viewDenominatorLabel: values.periodViewDisplayValue.toLocaleString("ko-KR"),
    });
    expect([values.viewCardValue, values.periodLikeDisplayValue, values.periodCommentDisplayValue]).toEqual([1_000, 50, 3]);
    expect([values.likeRate, values.commentRate, values.likeLabel, values.commentLabel]).toEqual([5, 0.3, "5.0%", "0.3%"]);
    expect(result.viewScope).toBe(result.reactionScope);
    expect(result.viewCardTitle).toBe("기간 조회 증가");
    expect(result.ratioInfoLines[0]).toBe("분모: 전체 집계 영상의 기간 조회 증가 합계 1,000회.");
  });

  test("actual flat arithmetic retains the cohort denominator behind the 0.9% illustration", () => {
    const video = {
      viewCount: 50_000_000, previousViewCount: 50_000_000,
      likeCount: 437_492, previousLikeCount: 437_492,
      commentCount: 12_017, previousCommentCount: 12_017,
      comparisonStatus: "compared",
    };
    const values = evaluate([video], [video], "1M", { viewCount: 4_030_039_789, previousViewCount: 3_762_699_125 });
    const result = getDashboardKpiPresentation({
      ...normal, ...values, viewDenominatorLabel: values.periodViewDisplayValue.toLocaleString("ko-KR"),
    });
    expect(values.videoPeriodDeltasAreFlat).toBe(true);
    expect(values.hasPeriodGrowthComparison).toBe(false);
    expect([values.viewCardValue, values.periodViewDisplayValue, values.periodLikeDisplayValue, values.periodCommentDisplayValue]).toEqual([267_340_664, 50_000_000, 437_492, 12_017]);
    expect(values.likeRate).toBeCloseTo(0.874984, 6);
    expect(values.commentRate).toBeCloseTo(0.024034, 6);
    expect([values.likeLabel, values.commentLabel]).toEqual(["0.9%", "0.0%"]);
    expect(result.viewScope).not.toBe(result.reactionScope);
    expect(result.viewCardTitle).toBe("채널 조회 순증");
    expect(result.likeCardTitle).toBe("기간 영상 좋아요 누적");
    expect(result.ratioInfoLines[0]).toBe("분모: 1개월 동안 게시된 영상의 현재 조회수 합계 50,000,000회.");
  });

  test("normal period deltas retain their titles and denominator scope", () => {
    const result = getDashboardKpiPresentation(normal);
    expect(result.viewScope).toBe("period-delta");
    expect(result.reactionScope).toBe("period-delta");
    expect([result.viewCardTitle, result.likeCardTitle, result.commentCardTitle])
      .toEqual(["기간 조회 증가", "기간 좋아요 증가", "기간 댓글 증가"]);
    expect(result.ratioCaptionPrefix).toBe("조회 증가 대비");
    expect(result.ratioInfoLines).toEqual([
      "분모: 전체 집계 영상의 기간 조회 증가 합계 1,000회.",
    ]);
    expect(result.viewInfoLines).toBeNull();
    expect(result.likeInfoLines).toBeNull();
    expect(result.commentInfoLines).toBeNull();
    expect(result.currentCaption).toBeNull();
  });

  test("flat video deltas distinguish channel growth from synthetic cohort totals", () => {
    // Illustration only: 50M is not an observed operating denominator.
    const result = getDashboardKpiPresentation({
      ...normal,
      hasPeriodGrowthComparison: false,
      videoPeriodDeltasAreFlat: true,
      viewDenominatorLabel: "50,000,000",
    });
    expect(result.viewScope).toBe("channel-period-delta");
    expect(result.reactionScope).toBe("published-cohort-current");
    expect(result.viewCardTitle).toBe("채널 조회 순증");
    expect(result.periodViewCardTitle).toBe("기간 영상 조회 누적");
    expect(result.likeCardTitle).toBe("기간 영상 좋아요 누적");
    expect(result.commentCardTitle).toBe("기간 영상 댓글 누적");
    expect(result.currentCaption).toBe("1개월 게시 영상 · 현재 누적");
    expect(result.ratioCaptionPrefix).toBe("기간 영상 현재 조회 대비");
    expect(result.ratioInfoLines).toEqual([
      "분모: 1개월 동안 게시된 영상의 현재 조회수 합계 50,000,000회.",
      "비교 범위: 이 비율의 분모는 조회 카드의 채널 전체 순증과 다릅니다.",
    ]);
    expect(result.ratioInfoLines.join(" ")).not.toContain("267,340,664");
    expect(result.viewInfoLines?.[0]).toContain("채널 전체");
    for (const info of [result.likeInfoLines, result.commentInfoLines]) {
      expect(info?.[0]).toContain("1개월 동안 게시된 영상");
      expect(info?.[1]).toContain("새로 발생한 반응 수가 아닙니다");
    }
  });

  test("missing channel comparison never labels cohort values as channel growth", () => {
    const result = getDashboardKpiPresentation({
      ...normal,
      hasPeriodGrowthComparison: false,
      videoPeriodDeltasAreFlat: true,
      channelViewDelta: null,
    });
    expect(result.viewScope).toBe(result.reactionScope);
    expect(result.viewCardTitle).toBe(result.periodViewCardTitle);
    expect(result.viewCaption).toBe(result.currentCaption);
    expect(result.viewInfoLines?.join(" ")).not.toContain("채널 전체");
    expect(result.ratioInfoLines).toHaveLength(1);
  });

  test("zero channel growth is an available value, not a missing comparison", () => {
    const result = getDashboardKpiPresentation({
      ...normal,
      hasPeriodGrowthComparison: false,
      videoPeriodDeltasAreFlat: true,
      channelViewDelta: 0,
    });
    expect(result.viewScope).toBe("channel-period-delta");
    expect(result.reactionScope).toBe("published-cohort-current");
    expect(result.ratioInfoLines[0]).toContain("1,000회");
  });

  test("current values without snapshots still identify the published cohort", () => {
    const result = getDashboardKpiPresentation({
      ...normal,
      hasPeriodGrowthComparison: false,
    });
    expect(result.viewScope).toBe("published-cohort-current");
    expect(result.viewCardTitle).toBe("기간 영상 조회 누적");
    expect(result.viewCaption).toBe("1개월 게시 영상 · 현재 누적");
    expect(result.likeInfoLines?.[0]).toContain("현재 좋아요 누적 합계");
  });

  test("ALL and an empty cohort fallback label the actual all-video input", () => {
    for (const change of [{ isAllPeriod: true }, { hasPeriodCohortVideos: false }]) {
      const result = getDashboardKpiPresentation({
        ...normal,
        hasPeriodGrowthComparison: false,
        channelViewDelta: null,
        ...change,
      });
      expect(result.viewScope).toBe("all-videos-current");
      expect(result.reactionScope).toBe("all-videos-current");
      expect(result.likeCardTitle).toBe("전체 영상 좋아요 누적");
      expect(result.ratioInfoLines[0]).toBe("분모: 전체 집계 영상의 현재 조회수 합계 1,000회.");
      expect(result.currentCaption).toBe("전체 영상 · 현재 누적");
    }
  });

  test("a hidden metric uses its existing masked denominator in the tooltip", () => {
    const result = getDashboardKpiPresentation({ ...normal, viewDenominatorLabel: "—" });
    expect(result.ratioInfoLines[0]).toContain("—회");
    expect(result.ratioInfoLines[0]).not.toContain("1,000");
  });

  test("the caller retains ratio inputs and wires the distinct PDF value scope", () => {
    expect(source).toMatch(/const likeRate = getDashboardRatio\(\s*periodLikeDisplayValue,\s*periodViewDisplayValue,/);
    expect(source).toMatch(/const commentRate = getDashboardRatio\(\s*periodCommentDisplayValue,\s*periodViewDisplayValue,/);
    expect(source).toContain("viewDenominatorLabel: formatMetricNumber(periodViewDisplayValue)");
    expect(source).toMatch(/label: periodViewCardTitle,\s*value: isMetricValueHidden \? "—" : formatNumber\(periodViewDisplayValue\)/);
    expect(source).toContain("...kpiPresentation.ratioInfoLines");
  });
});
