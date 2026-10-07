import { buildCanonicalAdminModuleHref, type AdminConsoleRouteModuleId } from './admin-module-routing';
import { isRecord } from './normalize-evaluation-record';
import { ADMIN_PENDING_COUNT_DOMAIN_IDS } from './pending-counts';
import { parseReviewAutomationSnapshot } from './restaurant-review-automation';

export const OPERATIONS_SOURCES = ['pending', 'pipeline', 'automation'] as const;
export type OperationsSourceId = (typeof OPERATIONS_SOURCES)[number];
export type OperationsReadState = 'loading' | 'ready' | 'partial' | 'limited' | 'invalid' | 'unavailable' | 'forbidden';
export type OperationsPriority = 'failure' | 'attention' | 'waiting' | 'running' | 'idle';
export type OperationsMetric = { id: string; label: string; value: number | null };
export type OperationsRow = {
  id: string;
  sourceId: OperationsSourceId;
  title: string;
  href: string;
  state: OperationsReadState;
  priority: OperationsPriority;
  summary: string;
  metrics: OperationsMetric[];
  details: Array<{ label: string; value: string }>;
};
export type OperationsSnapshot = { sourceId: OperationsSourceId; state: OperationsReadState; rows: OperationsRow[] };

const SOURCE_ROWS: Record<OperationsSourceId, Array<{ id: string; title: string; module: AdminConsoleRouteModuleId }>> = {
  pending: [
    { id: 'restaurant_submissions', title: '맛집 제보', module: 'submissions' },
    { id: 'restaurant_recommendation_requests', title: '맛집 추천 요청', module: 'submissions' },
    { id: 'reviews', title: '리뷰 검수', module: 'reviews' },
  ],
  pipeline: [{ id: 'pipeline', title: '수집 파이프라인', module: 'pipeline' }],
  automation: [{ id: 'automation', title: '맛집 자동 검수', module: 'restaurants' }],
};
export const OPERATIONS_STATE_LABELS: Record<OperationsReadState, string> = {
  loading: '조회 중', ready: '조회 완료', partial: '일부 미확인', limited: '제한된 조회',
  invalid: '응답 확인 필요', unavailable: '조회 불가', forbidden: '권한 확인 필요',
};
const PRIORITY_RANK: Record<OperationsPriority, number> = { failure: 0, attention: 1, waiting: 2, running: 3, idle: 4 };
const count = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const formatCount = (value: number) => new Intl.NumberFormat('ko-KR').format(value);
const time = (value: unknown): string | null => typeof value === 'string' && value.length <= 40 && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null;
const metric = (id: string, label: string, value: number | null): OperationsMetric => ({ id, label, value });

export function operationsUnavailable(sourceId: OperationsSourceId, state: 'loading' | 'invalid' | 'unavailable' | 'forbidden'): OperationsSnapshot {
  return {
    sourceId, state,
    rows: SOURCE_ROWS[sourceId].map(row => ({
      id: row.id, sourceId, title: row.title, href: buildCanonicalAdminModuleHref(row.module), state,
      priority: state === 'loading' ? 'idle' : 'attention',
      summary: state === 'loading' ? '상태를 확인하고 있습니다.' : state === 'forbidden' ? '관리자 로그인과 접근 권한을 확인하세요.' : state === 'invalid' ? '응답 형식이 달라 수치를 확인할 수 없습니다.' : '새로고침하거나 해당 화면에서 상태를 확인하세요.',
      metrics: [], details: [],
    })),
  };
}

function parsePending(value: unknown): OperationsSnapshot {
  if (!isRecord(value) || !isRecord(value.domains)) return operationsUnavailable('pending', 'invalid');
  const result = operationsUnavailable('pending', 'invalid');
  const asOf = time(value.asOf);
  for (const [index, id] of ADMIN_PENDING_COUNT_DOMAIN_IDS.entries()) {
    const domain = value.domains[id];
    const row = result.rows[index];
    // Do not use the legacy normalizer: missing/invalid counts become zero there.
    if (!isRecord(domain) || domain.id !== id || !count(domain.count) || typeof domain.ready !== 'boolean'
      || domain.status !== (domain.ready ? 'ready' : 'degraded')) continue;
    const lifecycleReady = id !== 'restaurant_recommendation_requests' || (domain.ready
      && value.recommendationRequestsLifecycleReady === true && isRecord(value.readiness)
      && value.readiness.recommendationRequestsLifecycleReady === true);
    const ready = domain.ready && lifecycleReady;
    row.state = ready && asOf ? 'ready' : 'partial';
    row.priority = !ready || !asOf ? 'attention' : domain.count > 0 ? 'waiting' : 'idle';
    row.metrics = [metric('pending', '검수 대기', ready ? domain.count : null)];
    row.summary = !ready ? '대기 건수를 확정할 수 없습니다. 처리 상태 구분을 확인하세요.'
      : domain.count > 0 ? `${formatCount(domain.count)}건이 검수를 기다리고 있습니다.` : '조회 시점의 검수 대기가 없습니다.';
    row.details = [{ label: '데이터 기준 시각', value: asOf ?? '확인 불가' }];
    if (!ready) row.details.push({ label: '집계 범위', value: '추천 요청의 처리 상태 구분이 준비되지 않았거나 일치하지 않습니다. 전체 요청 수를 대기 수로 사용하지 않습니다.' });
  }
  result.state = result.rows.every(row => row.state === 'ready') ? 'ready' : result.rows.every(row => row.state === 'invalid') ? 'invalid' : 'partial';
  return result;
}

const JOB_STATUSES = new Set(['Queued', 'Fetching', 'Inserting', 'Paused', 'Cancelled', 'Failed', 'Succeeded']);
const validJob = (value: unknown): value is Record<string, unknown> => isRecord(value)
  && typeof value.id === 'string' && value.id.length > 0 && value.id.length <= 128
  && typeof value.status === 'string' && JOB_STATUSES.has(value.status);

const GITHUB_STATUS_LABELS = {
  completed: '완료', in_progress: '진행 중', queued: '대기', requested: '실행 요청',
  waiting: '승인 대기', pending: '동시 실행 대기', expected: '상태 보고 대기',
  failure: '실패', startup_failure: '시작 실패',
} as const;
const GITHUB_CONCLUSION_LABELS = {
  success: '성공', failure: '실패', cancelled: '취소', skipped: '건너뜀', neutral: '중립',
  timed_out: '시간 초과', action_required: '조치 필요', stale: '기한 경과', startup_failure: '시작 실패',
} as const;

/** Preserve GitHub's status/conclusion distinction; neither unknown nor non-success means failure.
 * https://docs.github.com/en/rest/guides/using-the-rest-api-to-interact-with-checks
 */
export function parseGithubWorkflowState(value: unknown) {
  const status = isRecord(value) && typeof value.status === 'string' && Object.hasOwn(GITHUB_STATUS_LABELS, value.status)
    ? value.status as keyof typeof GITHUB_STATUS_LABELS : 'unknown';
  const conclusion = isRecord(value) && value.conclusion === null ? null
    : isRecord(value) && typeof value.conclusion === 'string' && Object.hasOwn(GITHUB_CONCLUSION_LABELS, value.conclusion)
      ? value.conclusion as keyof typeof GITHUB_CONCLUSION_LABELS : 'unknown';
  const statusFailure = status === 'failure' || status === 'startup_failure';
  const valid = status !== 'unknown' && (status === 'completed' ? conclusion !== null && conclusion !== 'unknown'
    : statusFailure ? conclusion === null || conclusion === status : conclusion === null);
  const failed = !valid ? null : statusFailure || (status === 'completed' && ['failure', 'timed_out', 'startup_failure'].includes(conclusion!));
  const jobStatus = !valid ? 'Unknown' : failed ? 'Failed'
    : status === 'in_progress' ? 'Fetching' : ['queued', 'requested', 'waiting', 'pending'].includes(status) ? 'Queued'
      : conclusion === 'success' ? 'Succeeded' : conclusion === 'cancelled' ? 'Cancelled' : 'Unknown';
  const label = !valid ? '미확인' : status === 'completed' ? GITHUB_CONCLUSION_LABELS[conclusion as keyof typeof GITHUB_CONCLUSION_LABELS]
    : GITHUB_STATUS_LABELS[status as keyof typeof GITHUB_STATUS_LABELS];
  return { status, conclusion, jobStatus, failed, label };
}

function parsePipeline(value: unknown): OperationsSnapshot {
  if (!isRecord(value) || !['job_api', 'github_actions'].includes(String(value.source)) || !Array.isArray(value.jobs)
    || !Array.isArray(value.failures) || value.jobs.length > 10_000 || value.failures.length > 20) return operationsUnavailable('pipeline', 'invalid');
  const result = operationsUnavailable('pipeline', 'invalid');
  const row = result.rows[0];
  const github = value.source === 'github_actions';
  if (github && value.jobs.length !== 1) return result;
  if (github) {
    const job = value.jobs[0];
    const run = value.githubRun;
    const identityValid = isRecord(job) && typeof job.id === 'string' && /^[1-9]\d{0,15}$/.test(job.id)
      && Number.isSafeInteger(Number(job.id)) && typeof job.status === 'string' && (JOB_STATUSES.has(job.status) || job.status === 'Unknown')
      && isRecord(run) && run.id === job.id;
    const state = parseGithubWorkflowState(identityValid ? run : null);
    const failed = state.failed === null ? null : Number(state.failed);
    row.state = state.failed === null ? 'partial' : 'limited';
    row.priority = state.failed === true ? 'failure' : 'attention';
    row.summary = `GitHub 최근 실행: ${state.label}. 제어 서버 상태는 미확인입니다.`;
    row.metrics = [metric('failed', '최근 실행 실패 표시', failed), metric('queued', '목록 대기', null), metric('running', '목록 진행', null), metric('paused', '목록 정지', null)];
    row.details = [
      { label: '조회 출처', value: 'GitHub Actions 최근 실행' },
      { label: '최근 실행 상태', value: state.label },
      { label: '집계 범위', value: '최근 실행 한정입니다. 전체 작업 대기열이나 실행 중 여부를 보장하지 않습니다.' },
    ];
    result.state = row.state;
    return result;
  }
  const jobsValid = value.jobs.every(validJob) && new Set(value.jobs.map(job => isRecord(job) ? job.id : null)).size === value.jobs.length;
  const failuresValid = (value.failures.every(job => validJob(job) && job.status === 'Failed')
    && new Set(value.failures.map(job => isRecord(job) ? job.id : null)).size === value.failures.length);
  const jobs = jobsValid ? value.jobs as Record<string, unknown>[] : [];
  const queued = jobsValid ? jobs.filter(job => job.status === 'Queued').length : null;
  const running = jobsValid ? jobs.filter(job => job.status === 'Fetching' || job.status === 'Inserting').length : null;
  const paused = jobsValid ? jobs.filter(job => job.status === 'Paused').length : null;
  // job_api has a separate capped failure-history list; its live jobs omit terminal runs.
  const failures = failuresValid ? value.failures.length : null;
  const valid = jobsValid && failuresValid;
  row.state = !valid ? 'partial' : 'ready';
  row.priority = failures !== null && failures > 0 ? 'failure' : !valid ? 'attention'
    : paused !== null && paused > 0 ? 'attention' : queued !== null && queued > 0 ? 'waiting' : running !== null && running > 0 ? 'running' : 'idle';
  row.summary = !valid ? '일부 작업 상태를 해석할 수 없습니다.'
    : failures !== null && failures > 0 ? '실패 이력을 확인하고 재실행 여부를 검토하세요.'
      : paused !== null && paused > 0 ? '일시 정지된 작업을 확인하세요.' : '현재 작업 목록과 최근 실패 이력을 확인했습니다.';
  row.metrics = [metric('failed', '반환된 실패 이력', failures), metric('queued', '목록 대기', queued), metric('running', '목록 진행', running), metric('paused', '목록 정지', paused)];
  row.details = [
    { label: '조회 출처', value: '작업 제어 서버' },
    { label: '집계 범위', value: '실행 목록과 최근 실패 이력 최대 20건입니다. 누적 실패 총계가 아닙니다.' },
  ];
  if (value.failures.length === 20) row.details.push({ label: '조회 한도', value: '실패 이력이 20건 한도에 도달했습니다. 더 많은 이력이 있을 수 있습니다.' });
  result.state = row.state;
  return result;
}

function parseAutomation(value: unknown): OperationsSnapshot {
  try {
    const snapshot = parseReviewAutomationSnapshot(value);
    const result = operationsUnavailable('automation', 'invalid');
    const row = result.rows[0];
    const { queue, policy } = snapshot;
    const latest = [...snapshot.runs].sort((a, b) => Date.parse(b.started_at) - Date.parse(a.started_at))[0];
    row.state = 'ready';
    row.priority = queue.failed > 0 ? 'failure' : queue.queued > 0 ? 'waiting' : queue.running > 0 ? 'running' : 'idle';
    row.summary = queue.failed > 0 ? `${formatCount(queue.failed)}건의 재검수 실패를 확인하세요.`
      : !policy.enabled && (queue.queued > 0 || queue.running > 0) ? '자동 정책은 중지 상태이며, 남아 있는 재검수 작업이 있습니다.'
        : policy.enabled ? '자동 검수 정책이 켜져 있습니다.' : '자동 검수 정책이 중지되어 있습니다.';
    row.metrics = [metric('failed', '재검수 실패', queue.failed), metric('queued', '재검수 대기', queue.queued), metric('running', '재검수 진행', queue.running)];
    row.details = [
      { label: '자동 정책', value: policy.enabled ? '켜짐' : '중지' },
      { label: '처리 한도', value: `배치 ${formatCount(policy.batch_size)}건 · 일일 승인 ${formatCount(policy.daily_limit)}건` },
      { label: '최근 정책 실행', value: time(policy.last_run_at) ?? '실행 이력 없음' },
      { label: '조회 범위', value: '대기열 전체 집계 · 실행 이력 최근 최대 10건' },
    ];
    if (latest) {
      row.details.push({ label: '가장 최근 실행 시작', value: time(latest.started_at)! });
      row.metrics.push(metric('scanned', '최근 실행 검토', latest.scanned), metric('approved', '최근 승인', latest.approved), metric('held', '최근 보류', latest.held), metric('recheck', '최근 재검수 분류', latest.recheck), metric('protected', '최근 보호', latest.protected));
    }
    result.state = row.state;
    return result;
  } catch {
    return operationsUnavailable('automation', 'invalid');
  }
}

/** Only aggregate counts, fixed labels, canonical links and validated times leave this boundary. */
export function parseOperationsSnapshot(sourceId: OperationsSourceId, value: unknown): OperationsSnapshot {
  if (sourceId === 'pending') return parsePending(value);
  if (sourceId === 'pipeline') return parsePipeline(value);
  return parseAutomation(value);
}

export function buildOperationsViewModel(snapshots: Partial<Record<OperationsSourceId, OperationsSnapshot>>) {
  const sources = OPERATIONS_SOURCES.map(source => snapshots[source] ?? operationsUnavailable(source, 'loading'));
  const rows = sources.flatMap(source => source.rows).sort((a, b) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority]);
  const pendingCounts = sources[0].rows.map(row => row.metrics.find(item => item.id === 'pending')?.value ?? null);
  const total = pendingCounts.every(count) ? pendingCounts.reduce((sum, value) => sum + value, 0) : null;
  return {
    rows,
    sources,
    attentionCount: rows.filter(row => row.priority === 'failure' || row.priority === 'attention').length,
    summaries: [
      metric('pending', '제보·추천·리뷰 검수 대기', total !== null && Number.isSafeInteger(total) ? total : null),
      metric('automation', '자동 재검수 실패', sources[2].rows[0].metrics.find(item => item.id === 'failed')?.value ?? null),
      metric('pipeline', sources[1].rows[0].metrics.find(item => item.id === 'failed')?.label === '최근 실행 실패 표시' ? '파이프라인 · 최근 실행 실패 표시' : '파이프라인 실패 이력 · 반환 목록', sources[1].rows[0].metrics.find(item => item.id === 'failed')?.value ?? null),
    ],
  };
}

export function filterOperationsRows(rows: OperationsRow[], search: string, attentionOnly: boolean): OperationsRow[] {
  const query = search.normalize('NFKC').trim().toLocaleLowerCase('ko-KR');
  return rows.filter(row => (!attentionOnly || row.priority === 'failure' || row.priority === 'attention')
    && (!query || `${row.title} ${row.summary}`.normalize('NFKC').toLocaleLowerCase('ko-KR').includes(query)));
}
