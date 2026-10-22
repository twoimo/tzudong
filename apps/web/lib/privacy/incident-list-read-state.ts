export type IncidentListReadState = 'pending' | 'ready' | 'refreshing' | 'failed' | 'stale';
export type IncidentListReadEvent = 'start' | 'success' | 'failure';

export function nextIncidentListReadState(
  current: IncidentListReadState,
  event: IncidentListReadEvent,
): IncidentListReadState {
  if (event === 'success') return 'ready';
  if (event === 'start') {
    if (current === 'failed') return 'failed';
    return current === 'ready' || current === 'refreshing' || current === 'stale'
      ? 'refreshing'
      : 'pending';
  }
  return current === 'refreshing' ? 'stale' : 'failed';
}

export function getIncidentListPresentation(
  state: IncidentListReadState,
  count: number,
  deadlineRiskCount: number,
) {
  if (state === 'pending') {
    return Object.freeze({
      emptyMessage: null,
      hasKnownData: false,
      statusMessage: '사고 목록을 불러오는 중입니다.',
      summary: '사고 현황 조회 중',
    });
  }
  if (state === 'failed') {
    return Object.freeze({
      emptyMessage: null,
      hasKnownData: false,
      statusMessage: '사고 목록을 불러오지 못했습니다. 새로고침하여 다시 확인하세요.',
      summary: '사고 현황 미확인',
    });
  }

  const riskSummary = deadlineRiskCount > 0 ? ` · 기한 위험 ${deadlineRiskCount}건` : '';
  const stateSummary = state === 'refreshing' ? ' · 갱신 중' : state === 'stale' ? ' · 갱신 실패' : '';
  const lastKnown = state === 'refreshing' || state === 'stale';
  return Object.freeze({
    emptyMessage: count === 0
      ? lastKnown
        ? '마지막 확인 기준 표시할 사고가 없습니다.'
        : '표시할 사고가 없습니다. 위 탐지 등록으로 첫 사고를 기록한 뒤 상태 전환을 진행하세요.'
      : null,
    hasKnownData: true,
    statusMessage: state === 'refreshing'
      ? '사고 목록을 갱신하는 동안 마지막 확인 결과를 표시합니다.'
      : state === 'stale'
        ? '새로고침에 실패해 마지막 확인 결과를 표시합니다.'
        : null,
    summary: `${count}건${riskSummary}${stateSummary}`,
  });
}
