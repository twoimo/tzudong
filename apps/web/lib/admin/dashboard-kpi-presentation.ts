type DashboardKpiPresentationInput = {
  isAllPeriod: boolean;
  selectedPeriodLabel: string;
  hasPeriodGrowthComparison: boolean;
  videoPeriodDeltasAreFlat: boolean;
  hasPeriodCohortVideos: boolean;
  channelViewDelta: number | null;
  viewDenominatorLabel: string;
};

/** Labels for the existing three-card calculations; no values or ratios change here. */
export function getDashboardKpiPresentation({
  isAllPeriod,
  selectedPeriodLabel,
  hasPeriodGrowthComparison,
  videoPeriodDeltasAreFlat,
  hasPeriodCohortVideos,
  channelViewDelta,
  viewDenominatorLabel,
}: DashboardKpiPresentationInput) {
  const usesChannelViewDelta =
    videoPeriodDeltasAreFlat && channelViewDelta != null;
  const usesPublishedCohort = !isAllPeriod && hasPeriodCohortVideos;
  const currentTitle = usesPublishedCohort ? "기간 영상" : "전체 영상";
  const currentScope = usesPublishedCohort
    ? `${selectedPeriodLabel} 동안 게시된 영상`
    : "전체 집계 영상";
  const currentCaption = usesPublishedCohort
    ? `${selectedPeriodLabel} 게시 영상 · 현재 누적`
    : "전체 영상 · 현재 누적";
  const reactionScope = hasPeriodGrowthComparison
    ? "period-delta"
    : usesPublishedCohort
      ? "published-cohort-current"
      : "all-videos-current";
  const periodViewCardTitle = hasPeriodGrowthComparison
    ? "기간 조회 증가"
    : `${currentTitle} 조회 누적`;
  const currentInfo = (metric: string) => [
    `기준: ${currentScope}의 현재 ${metric} 누적 합계입니다.`,
    "집계: 현재 스냅샷의 합계이며 선택 기간에 새로 발생한 반응 수가 아닙니다.",
  ];

  return {
    viewScope: usesChannelViewDelta ? "channel-period-delta" : reactionScope,
    reactionScope,
    viewCardTitle: usesChannelViewDelta ? "채널 조회 순증" : periodViewCardTitle,
    periodViewCardTitle,
    likeCardTitle: hasPeriodGrowthComparison
      ? "기간 좋아요 증가"
      : `${currentTitle} 좋아요 누적`,
    commentCardTitle: hasPeriodGrowthComparison
      ? "기간 댓글 증가"
      : `${currentTitle} 댓글 누적`,
    currentCaption: hasPeriodGrowthComparison ? null : currentCaption,
    viewCaption: usesChannelViewDelta
      ? `${selectedPeriodLabel} · 채널 전체 조회 순증`
      : hasPeriodGrowthComparison ? null : currentCaption,
    ratioCaptionPrefix: hasPeriodGrowthComparison
      ? "조회 증가 대비"
      : `${currentTitle} 현재 조회 대비`,
    viewInfoLines: usesChannelViewDelta
      ? [
          `기준: 채널 전체의 ${selectedPeriodLabel} 조회 순증입니다. 과거 게시 영상도 포함합니다.`,
          "계산식: 현재 채널 조회수 - 비교 시점 채널 조회수.",
          "범위: 좋아요·댓글 카드의 현재 영상 누적값과 집계 기준이 다릅니다.",
        ]
      : hasPeriodGrowthComparison ? null : currentInfo("조회수"),
    likeInfoLines: hasPeriodGrowthComparison ? null : currentInfo("좋아요"),
    commentInfoLines: hasPeriodGrowthComparison ? null : currentInfo("댓글"),
    ratioInfoLines: [
      `분모: ${hasPeriodGrowthComparison ? "전체 집계 영상의 기간 조회 증가 합계" : `${currentScope}의 현재 조회수 합계`} ${viewDenominatorLabel}회.`,
      ...(usesChannelViewDelta
        ? ["비교 범위: 이 비율의 분모는 조회 카드의 채널 전체 순증과 다릅니다."]
        : []),
    ],
  };
}
