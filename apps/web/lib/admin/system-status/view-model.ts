import {
  normalizeAdminPendingCountsResponse,
  type AdminPendingCountDomain,
  type AdminPendingCountDomainId,
  type AdminPendingCountsResponse,
} from '@/lib/admin/pending-counts';
import type {
  AdminNightlyRegressionStatus,
  AdminNightlyWorkflowStatus,
  AdminSystemRunDailyStatus,
  AdminSystemStatusChecklistItem,
  AdminSystemStatusResponse,
} from '@/types/admin-system-status';

export type AdminStatusCenterState = 'healthy' | 'partial' | 'degraded' | 'unknown';

export type AdminStatusCenterPendingCounts =
  | AdminPendingCountsResponse
  | {
      submissions: number | null;
      recommendationRequests?: number | null;
      reviews: number | null;
      total?: number | null;
      recommendationRequestsLifecycleReady?: boolean | null;
      domains?: Partial<Record<AdminPendingCountDomainId, Partial<AdminPendingCountDomain>>>;
      readiness?: {
        status?: 'ready' | 'degraded';
        recommendationRequestsLifecycleReady?: boolean;
      };
    };

export type AdminStatusCenterMetric = {
  id: 'run_daily' | 'nightly' | 'artifacts' | 'gdrive' | 'pending';
  label: string;
  value: string;
  detail: string;
  state: AdminStatusCenterState;
};

export type AdminStatusCenterViewModel = {
  overallState: AdminStatusCenterState;
  overallLabel: string;
  summary: string;
  metrics: AdminStatusCenterMetric[];
  checklist: AdminSystemStatusChecklistItem[];
};

const STATE_PRIORITY: Record<AdminStatusCenterState, number> = {
  degraded: 4,
  unknown: 3,
  partial: 2,
  healthy: 1,
};

function pickWorseState(...states: AdminStatusCenterState[]) {
  return states.reduce<AdminStatusCenterState>((worst, current) =>
    STATE_PRIORITY[current] > STATE_PRIORITY[worst] ? current : worst,
  'healthy');
}

function formatCount(value: number | null) {
  return typeof value === 'number' && Number.isFinite(value)
    ? new Intl.NumberFormat('ko-KR').format(value)
    : '—';
}

function isPendingCountUnavailable(pending: AdminStatusCenterPendingCounts): boolean {
  return pending.submissions === null || pending.reviews === null;
}

function normalizePendingCountsForMetric(
  pending: AdminStatusCenterPendingCounts,
): AdminPendingCountsResponse | null {
  if (isPendingCountUnavailable(pending)) return null;
  return normalizeAdminPendingCountsResponse(pending);
}

function isPendingCountsDegraded(pending: AdminPendingCountsResponse): boolean {
  return (
    pending.readiness.status !== 'ready'
    || pending.domains.restaurant_recommendation_requests.ready !== true
    || pending.recommendationRequestsLifecycleReady !== true
  );
}

function hasPendingLifecycleDegradation(pending: AdminStatusCenterPendingCounts): boolean {
  return (
    pending.recommendationRequestsLifecycleReady === false
    || pending.recommendationRequestsLifecycleReady === null
    || pending.readiness?.status === 'degraded'
    || pending.readiness?.recommendationRequestsLifecycleReady === false
  );
}

function classifyRunDailyMetric(runDaily: AdminSystemRunDailyStatus | undefined): AdminStatusCenterMetric {
  if (!runDaily) {
    return {
      id: 'run_daily',
      label: 'run_daily',
      value: '상태 없음',
      detail: 'run_daily 상태 응답을 만들지 못했습니다.',
      state: 'unknown',
    };
  }

  const failedRequiredSteps = runDaily.failedRequiredSteps ?? [];
  const optionalSkips = runDaily.optionalSkips ?? [];
  const downstreamSkips = runDaily.downstreamSkips ?? [];
  const failedRequired =
    failedRequiredSteps.length > 0 || runDaily.finalStatus === 'ERROR';
  const partial =
    runDaily.finalStatus === 'WARN'
    || optionalSkips.length > 0
    || downstreamSkips.length > 0;

  if (runDaily.manifestStatus === 'missing') {
    return {
      id: 'run_daily',
      label: 'run_daily',
      value: 'UNKNOWN',
      detail: 'current-summary manifest가 없어 현재 run_daily 상태를 알 수 없습니다.',
      state: 'unknown',
    };
  }

  if (runDaily.manifestStatus === 'unreadable') {
    return {
      id: 'run_daily',
      label: 'run_daily',
      value: 'UNKNOWN',
      detail: 'current-summary manifest를 읽지 못해 현재 run_daily 상태를 알 수 없습니다.',
      state: 'unknown',
    };
  }

  if (runDaily.detail) {
    return {
      id: 'run_daily',
      label: 'run_daily',
      value: '읽기 실패',
      detail: 'manifest 또는 로그를 정상적으로 읽지 못했습니다.',
      state: 'unknown',
    };
  }

  if (!runDaily.latestManifestPath) {
    return {
      id: 'run_daily',
      label: 'run_daily',
      value: 'manifest 없음',
      detail: '현재 summary/manifest 증거가 없어 건강 상태로 간주하지 않습니다.',
      state: 'degraded',
    };
  }

  if (runDaily.stale) {
    return {
      id: 'run_daily',
      label: 'run_daily',
      value: 'stale',
      detail: '최신 run_daily 증거가 오래되어 현재 상태를 신뢰할 수 없습니다.',
      state: 'degraded',
    };
  }

  if (failedRequired) {
    return {
      id: 'run_daily',
      label: 'run_daily',
      value: runDaily.finalStatus ?? 'ERROR',
      detail: '필수 단계 실패가 있어 즉시 점검이 필요합니다.',
      state: 'degraded',
    };
  }

  if (partial || !runDaily.finalStatus) {
    return {
      id: 'run_daily',
      label: 'run_daily',
      value: runDaily.finalStatus ?? '부분 상태',
      detail: '선택 단계 skip 또는 부분 상태가 있어 완전한 건강 상태로 보지 않습니다.',
      state: 'partial',
    };
  }
  if (runDaily.finalStatus !== 'OK') {
    return {
      id: 'run_daily',
      label: 'run_daily',
      value: runDaily.finalStatus ?? 'UNKNOWN',
      detail: '최종 상태가 OK로 확인되지 않아 건강 상태로 보지 않습니다.',
      state: 'unknown',
    };
  }

  return {
    id: 'run_daily',
    label: 'run_daily',
    value: runDaily.finalStatus,
    detail: '현재 manifest 기준 필수 단계 실패 없이 읽혔습니다.',
    state: 'healthy',
  };
}

function classifyArtifactMetric(runDaily: AdminSystemRunDailyStatus | undefined): AdminStatusCenterMetric {
  if (!runDaily?.latestManifestPath && !runDaily?.latestLogPath) {
    return {
      id: 'artifacts',
      label: '아티팩트',
      value: '증거 없음',
      detail: 'manifest/log 둘 다 없어 상태를 healthy로 표시하지 않습니다.',
      state: 'degraded',
    };
  }

  if (runDaily?.detail) {
    return {
      id: 'artifacts',
      label: '아티팩트',
      value: '파싱 실패',
      detail: 'manifest 또는 로그 읽기 실패가 감지되었습니다.',
      state: 'unknown',
    };
  }

  if (runDaily?.manifestStatus === 'missing') {
    return {
      id: 'artifacts',
      label: '아티팩트',
      value: 'manifest 없음',
      detail: 'current-summary manifest가 없어 상태 증거가 불완전합니다.',
      state: 'unknown',
    };
  }

  if (runDaily?.manifestStatus === 'unreadable') {
    return {
      id: 'artifacts',
      label: '아티팩트',
      value: '파싱 실패',
      detail: 'current-summary manifest를 파싱하지 못했습니다.',
      state: 'unknown',
    };
  }

  if (runDaily?.stale) {
    return {
      id: 'artifacts',
      label: '아티팩트',
      value: '오래됨',
      detail: '최신 증거가 stale 상태라 현재 운영 상태를 보수적으로 봐야 합니다.',
      state: 'degraded',
    };
  }

  if (!runDaily?.latestManifestPath) {
    return {
      id: 'artifacts',
      label: '아티팩트',
      value: 'manifest 없음',
      detail: '로그만 있고 summary manifest가 없어 health 증거가 불완전합니다.',
      state: 'degraded',
    };
  }

  if (!runDaily.latestLogPath) {
    return {
      id: 'artifacts',
      label: '아티팩트',
      value: '로그 없음',
      detail: 'manifest만 있고 최신 로그 경로가 없어 부분 증거 상태입니다.',
      state: 'degraded',
    };
  }

  return {
    id: 'artifacts',
    label: '아티팩트',
    value: '정상 읽기',
    detail: '최신 manifest와 로그 경로가 모두 확인되었습니다.',
    state: 'healthy',
  };
}

function classifyGdriveMetric(runDaily: AdminSystemRunDailyStatus | undefined): AdminStatusCenterMetric {
  const upload = runDaily?.gdriveUpload;
  if (!upload) {
    return {
      id: 'gdrive',
      label: 'GDrive',
      value: '정보 없음',
      detail: 'GDrive upload 정보가 없어서 완전한 성공으로 간주하지 않습니다.',
      state: 'unknown',
    };
  }

  if (upload.status === 'failed') {
    return {
      id: 'gdrive',
      label: 'GDrive',
      value: 'failed',
      detail: upload.operatorMessage?.action ?? '업로드 실패가 감지되었습니다.',
      state: 'degraded',
    };
  }

  if (
    upload.terminalIncomplete
    || upload.status === 'partial'
    || upload.status === 'backfill_required'
    || upload.completionProof === 'rclone_exit_zero'
  ) {
    return {
      id: 'gdrive',
      label: 'GDrive',
      value: upload.status ?? 'partial',
      detail: upload.operatorMessage?.action ?? '원격 proof가 불완전해 후속 조치가 필요합니다.',
      state: 'partial',
    };
  }

  if (upload.status === 'complete' || upload.status === 'backfill_complete') {
    return {
      id: 'gdrive',
      label: 'GDrive',
      value: upload.status,
      detail: upload.operatorMessage?.summary ?? '원격 업로드 proof가 terminal success입니다.',
      state: 'healthy',
    };
  }

  return {
    id: 'gdrive',
    label: 'GDrive',
    value: upload.status ?? 'unknown',
    detail: '해석하기 어려운 업로드 상태입니다.',
    state: 'unknown',
  };
}

function describeNightlyWorkflow(
  label: string,
  workflow: AdminNightlyWorkflowStatus,
): string {
  if (!workflow.reachable) return `${label}: 실행 이력 조회 실패`;
  if (!workflow.latestRunId) return `${label}: 실행 이력 없음`;

  const current = workflow.latestRunConclusion ?? workflow.latestRunStatus ?? 'unknown';
  const lastSuccess = workflow.lastSuccessfulRunId
    ? `마지막 성공 #${workflow.lastSuccessfulRunId}${workflow.lastSuccessfulRunCreatedAt ? ` (${workflow.lastSuccessfulRunCreatedAt})` : ''}`
    : workflow.historyWindowTruncated
      ? `최근 ${workflow.examinedRuns}회 내 성공 없음`
      : '성공 이력 없음';
  return `${label}: 최신 #${workflow.latestRunId} ${current} · 연속 실패 ${workflow.consecutiveFailures}회 · ${lastSuccess}`;
}

function classifyNightlyMetric(
  nightly: AdminNightlyRegressionStatus,
): AdminStatusCenterMetric {
  const local = nightly.localCanonical;
  const hosted = nightly.hostedManualFallback;
  const detail = [
    describeNightlyWorkflow('로컬 canonical', local),
    describeNightlyWorkflow('호스티드 수동 fallback', hosted),
  ].join(' / ');

  if (!nightly.enabled || !nightly.configured) {
    return {
      id: 'nightly',
      label: '나이틀리 회귀',
      value: nightly.enabled ? '설정 필요' : '조회 꺼짐',
      detail: nightly.enabled
        ? 'read-only GitHub 저장소/토큰 설정이 없어 실행 상태를 확인할 수 없습니다.'
        : '나이틀리 운영 상태 조회가 비활성화되어 실행 상태를 확인할 수 없습니다.',
      state: 'unknown',
    };
  }

  if (!local.reachable || !local.latestRunId) {
    return {
      id: 'nightly',
      label: '나이틀리 회귀',
      value: !local.reachable ? '조회 실패' : '실행 없음',
      detail,
      state: 'degraded',
    };
  }

  const current = local.latestRunConclusion ?? local.latestRunStatus ?? 'unknown';
  const value = `${current} · 실패 ${local.consecutiveFailures}회`;
  if (
    local.consecutiveFailures > 0
    || (local.latestRunStatus === 'completed' && local.latestRunConclusion !== 'success')
  ) {
    return {
      id: 'nightly',
      label: '나이틀리 회귀',
      value,
      detail,
      state: 'degraded',
    };
  }

  if (local.latestRunStatus !== 'completed' || local.latestRunConclusion !== 'success') {
    return {
      id: 'nightly',
      label: '나이틀리 회귀',
      value,
      detail,
      state: local.latestRunStatus === 'in_progress' || local.latestRunStatus === 'queued'
        ? 'partial'
        : 'unknown',
    };
  }

  const hostedFallbackNeedsAttention = !hosted.reachable || (
    hosted.latestRunStatus === 'completed'
    && hosted.latestRunConclusion !== 'success'
  );
  return {
    id: 'nightly',
    label: '나이틀리 회귀',
    value,
    detail,
    state: hostedFallbackNeedsAttention ? 'partial' : 'healthy',
  };
}

function buildPendingMetric(
  pending: AdminStatusCenterPendingCounts,
): AdminStatusCenterMetric {
  const normalizedPending = normalizePendingCountsForMetric(pending);

  if (!normalizedPending) {
    return {
      id: 'pending',
      label: '검수 대기',
      value: '확인 필요',
      detail: 'pending-counts 응답을 읽지 못해 검수 대기 건수를 healthy로 표시하지 않습니다.',
      state: 'unknown',
    };
  }

  const restaurantSubmissions = normalizedPending.domains.restaurant_submissions.count;
  const recommendationRequests =
    normalizedPending.domains.restaurant_recommendation_requests.count;
  const reviews = normalizedPending.domains.reviews.count;
  const total = normalizedPending.total;
  const degraded =
    isPendingCountsDegraded(normalizedPending) || hasPendingLifecycleDegradation(pending);

  return {
    id: 'pending',
    label: '검수 대기',
    value: `${formatCount(total)}건`,
    detail: degraded
      ? `제보 ${formatCount(restaurantSubmissions)}건 · 추천 ${formatCount(recommendationRequests)}건 · 리뷰 ${formatCount(reviews)}건 · 추천 요청 lifecycle 확인 필요`
      : `제보 ${formatCount(restaurantSubmissions)}건 · 추천 ${formatCount(recommendationRequests)}건 · 리뷰 ${formatCount(reviews)}건`,
    state: degraded ? 'degraded' : total > 0 ? 'partial' : 'healthy',
  };
}

function buildOverallLabel(state: AdminStatusCenterState) {
  switch (state) {
    case 'healthy':
      return '정상';
    case 'partial':
      return '부분 경고';
    case 'degraded':
      return '점검 필요';
    default:
      return '확인 필요';
  }
}

export function buildAdminStatusCenterViewModel(
  status: AdminSystemStatusResponse | undefined,
  pending: AdminStatusCenterPendingCounts,
): AdminStatusCenterViewModel {
  const runDailyMetric = classifyRunDailyMetric(status?.runDaily);
  const artifactMetric = classifyArtifactMetric(status?.runDaily);
  const gdriveMetric = classifyGdriveMetric(status?.runDaily);
  const pendingMetric = buildPendingMetric(pending);
  const nightlyMetric = status?.nightlyRegression
    ? classifyNightlyMetric(status.nightlyRegression)
    : undefined;
  const overallState = pickWorseState(
    runDailyMetric.state,
    ...(nightlyMetric ? [nightlyMetric.state] : []),
    artifactMetric.state,
    gdriveMetric.state,
    pendingMetric.state,
  );

  return {
    overallState,
    overallLabel: buildOverallLabel(overallState),
    summary:
      overallState === 'healthy'
        ? '현재 확인 가능한 증거 기준으로 run_daily, 나이틀리 회귀, 운영 큐가 안정적입니다.'
        : overallState === 'partial'
          ? '일부 후속 조치가 남아 있어 운영 상태를 보수적으로 봐야 합니다.'
          : overallState === 'degraded'
            ? '현재 증거가 비어 있거나 오래되었거나 실패를 가리켜 즉시 점검이 필요합니다.'
            : '현재 증거를 완전히 읽지 못해 상태를 확정할 수 없습니다.',
    metrics: [
      runDailyMetric,
      ...(nightlyMetric ? [nightlyMetric] : []),
      artifactMetric,
      gdriveMetric,
      pendingMetric,
    ],
    checklist: [
      ...(status?.checklist ?? []).filter((item) => item.source === 'nightly-regression').slice(0, 2),
      ...(status?.checklist ?? []).filter((item) => item.source === 'run_daily'),
    ].slice(0, 3),
  };
}
