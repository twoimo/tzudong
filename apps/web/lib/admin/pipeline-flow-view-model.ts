import { isRecord } from './normalize-evaluation-record';
import { PIPELINE_GAUGE_KEYS, type PipelineGaugeKey } from './pipeline-control';
import { parseGithubWorkflowState } from './operations-view-model';

export const PIPELINE_FLOW_DOCUMENT = 'docs/architecture/admin-crawler-console-20261004.dataflow.json';
export const PIPELINE_FLOW_STAGES = [
  { id: 'collect', label: '수집 대상', input: '채널과 영상 URL', output: '영상 메타데이터', steps: ['Step 1 (URL Collection)', 'Step 2 (Metadata)', 'Step 2.1+2.5 (Migration+Cleanup)'], source: 'backend/pipeline_control/graph.py', contract: '영상 URL과 메타데이터를 수집합니다.' },
  { id: 'media', label: '영상 처리', input: '영상과 위치 단서', output: '프레임·지도·캡션 근거', steps: ['Step 3.2 (Visual Location)', 'Step 4 (Heatmap & Frames)', 'Step 5 (Map URL Crawling)', 'Step 6 (Frame Caption)'], source: 'backend/restaurant-crawling/scripts/06-frame-caption.py', contract: '경량 실행에서 생략될 수 있는 미디어 경로입니다. 생략은 성공과 다릅니다.' },
  { id: 'transcript', label: '자막 수집', input: '영상 URL', output: '시간 정보가 있는 자막', steps: ['Step 3 (Transcript)', 'Step 3.1 (Context Generation)'], source: 'backend/restaurant-crawling/scripts/03-collect-transcript.js', contract: '영상 식별자와 비어 있지 않은 transcript가 필요합니다. start·duration은 음수가 될 수 없습니다.' },
  { id: 'extract', label: '식당 추출', input: '영상·자막 근거', output: '식당 후보와 원본 식별자', steps: ['Step 6.1 (Enrich)', 'Step 08 (Chunk Multimodal)'], source: 'backend/restaurant-crawling/scripts/08-chunk-multimodal-crawling.sh', contract: 'youtube_link와 restaurants[].origin_name을 다음 단계까지 보존합니다.' },
  { id: 'select', label: '선정 · 주소', input: '식당 후보', output: '평가 대상·위치 검증', steps: ['Step 09 (Target)', 'Step 10 (Rule Eval)'], source: 'backend/restaurant-evaluation/scripts/10-rule-evaluation.py', contract: '선정 키는 origin_name과 일치해야 합니다. 위치 일치에는 독립 근거가 필요합니다.' },
  { id: 'evaluate', label: 'Gemini 평가', input: '선정·규칙 평가 결과', output: '방문·근거·리뷰 평가', steps: ['Step 11 (LAAJ Evaluation)'], source: 'backend/restaurant-evaluation/scripts/11-laaj-evaluation.sh', contract: '방문 진위·근거·리뷰 충실도·카테고리 평가를 검증합니다.' },
  { id: 'persist', label: '변환 · 저장', input: '평가 결과', output: '검수 가능한 식당 데이터', steps: ['Step 12 (Transform)', 'Step 13 (Supabase)', 'Step 13.1 (Admin Data Quality Gate)'], source: 'backend/restaurant-evaluation/scripts/13-supabase-insert.py', contract: 'trace_id는 배치 안에서 유일해야 합니다. 관리자 수정 필드와 보호 상태를 덮어쓰지 않습니다.' },
  { id: 'review', label: '관리자 검수', input: '저장된 후보와 평가 근거', output: '승인·보류·반려 결정', steps: [], source: 'apps/web/components/admin/RestaurantManagementWorkspace.tsx', contract: '사람의 승인 단계입니다. 배치 완료나 품질 검사 통과를 관리자 승인으로 간주하지 않습니다.' },
] as const;
export type PipelineStageId = (typeof PIPELINE_FLOW_STAGES)[number]['id'];
export const PIPELINE_FLOW_EDGES: Array<{ from: PipelineStageId; to: PipelineStageId; label: string }> = [
  { from: 'collect', to: 'media', label: '영상' }, { from: 'collect', to: 'transcript', label: '자막' },
  { from: 'media', to: 'extract', label: '시각 근거' }, { from: 'transcript', to: 'extract', label: '발화 근거' },
  { from: 'extract', to: 'select', label: '식당 후보' }, { from: 'select', to: 'evaluate', label: '평가 대상' },
  { from: 'evaluate', to: 'persist', label: '평가 결과' }, { from: 'persist', to: 'review', label: '검수 데이터' },
];
export type PipelineStageState = 'completed' | 'failed' | 'skipped' | 'blocked' | 'partial' | 'unknown' | 'manual';
export const PIPELINE_STAGE_LABELS: Record<PipelineStageState, string> = { completed: '완료 기록', failed: '실패 기록', skipped: '선택 단계 생략', blocked: '선행 단계로 생략', partial: '일부 기록', unknown: '기록 미확인', manual: '관리자 확인' };
const eventStates = ['completed', 'failed', 'optional_skipped', 'downstream_skipped'] as const;
type StepEvent = { name: string; status: (typeof eventStates)[number]; durationSeconds: number | null };
const canonicalNames = new Set<string>(PIPELINE_FLOW_STAGES.flatMap(stage => [...stage.steps]));
const count = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const duration = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= Number.MAX_SAFE_INTEGER;
const timestamp = (value: unknown) => typeof value === 'string' && value.length < 48 && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null;
const token = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);
export type PipelineManifestView = { availability: 'available' | 'missing' | 'unreadable' | 'unknown'; checkedAt: string | null; stale: boolean | null; invalidEvents: number; events: StepEvent[]; github: { id: string; status: string; conclusion: string | null } | null };

export function parsePipelineManifest(value: unknown): PipelineManifestView {
  const root = isRecord(value) ? value : {};
  const run = isRecord(root.runDaily) ? root.runDaily : {};
  const availability = ['available', 'missing', 'unreadable'].includes(String(run.manifestStatus)) ? run.manifestStatus as PipelineManifestView['availability'] : 'unknown';
  const events: StepEvent[] = [];
  let invalidEvents = 0;
  if (availability === 'available' && Array.isArray(run.stepEvents) && run.stepEvents.length <= 100) {
    for (const item of run.stepEvents) {
      if (!isRecord(item) || typeof item.name !== 'string') { invalidEvents++; continue; }
      if (!canonicalNames.has(item.name)) continue; // Never render free-form event names/reasons.
      if (!eventStates.includes(item.status as StepEvent['status'])) { invalidEvents++; continue; }
      events.push({ name: item.name, status: item.status as StepEvent['status'], durationSeconds: duration(item.durationSeconds) ? item.durationSeconds : null });
    }
  } else if (availability === 'available') invalidEvents++;
  const gha = isRecord(root.githubActions) ? root.githubActions : {};
  const githubState = parseGithubWorkflowState({ status: gha.latestRunStatus, conclusion: gha.latestRunConclusion });
  const github = gha.enabled === true && gha.configured === true && gha.reachable === true && count(gha.latestRunId) && gha.latestRunId > 0 && githubState.failed !== null
    ? { id: String(gha.latestRunId), status: githubState.status, conclusion: githubState.conclusion } : null;
  return { availability, checkedAt: timestamp(run.checkedAt), stale: typeof run.stale === 'boolean' ? run.stale : null, invalidEvents, events, github };
}

export function buildPipelineStages(manifest: PipelineManifestView | undefined) {
  return PIPELINE_FLOW_STAGES.map(stage => {
    const details = stage.steps.map(name => {
      const matches = manifest?.events.filter(event => event.name === name) ?? [];
      // Multiple observations without a run identity cannot be silently merged.
      return { name, event: matches.length === 1 ? matches[0] : null };
    });
    const observed = details.flatMap(item => item.event ? [item.event] : []);
    let state: PipelineStageState = 'unknown';
    if (stage.id === 'review') state = 'manual';
    else if (observed.some(event => event.status === 'failed')) state = 'failed';
    else if (observed.some(event => event.status === 'downstream_skipped')) state = 'blocked';
    else if (observed.length < details.length) state = observed.length ? 'partial' : 'unknown';
    else if (observed.every(event => event.status === 'completed')) state = 'completed';
    else state = 'skipped';
    const knownTime = details.length > 0 && observed.length === details.length && observed.every(event => event.durationSeconds !== null);
    const duration = knownTime ? observed.reduce((sum, event) => sum + event.durationSeconds!, 0) : null;
    return { ...stage, state, details, durationSeconds: duration !== null && Number.isFinite(duration) && duration <= Number.MAX_SAFE_INTEGER ? duration : null };
  });
}
export type PipelineStageView = ReturnType<typeof buildPipelineStages>[number];
export const PIPELINE_JOB_LABELS: Record<string, string> = { Queued: '대기', Fetching: '수집 중', Inserting: '저장 중', Paused: '일시 정지', Cancelled: '취소', Failed: '실패', Succeeded: '완료', Unknown: '미확인' };
export type PipelineJobView = { id: string; target: string; profile: 'heavy_local' | 'lite_gha' | 'unknown'; status: string; dry_run?: boolean; adapter_index: number | null; hasError: boolean };
export type PipelineStatusView = { source: 'job_api' | 'github_actions' | 'unknown'; partial: boolean; jobs: PipelineJobView[]; failures: PipelineJobView[]; targets: Array<{ id: string; status: string }>; gauges: Partial<Record<PipelineGaugeKey, number>>; environment: string; hardware: string };

export function parsePipelineStatus(value: unknown): PipelineStatusView {
  if (!isRecord(value) || !Array.isArray(value.jobs) || !Array.isArray(value.failures) || !Array.isArray(value.targets) || value.jobs.length > 1000 || value.failures.length > 20 || value.targets.length > 1000) throw new Error('pipeline_response_invalid');
  let partial = false;
  const source = value.source === 'job_api' || value.source === 'github_actions' ? value.source : 'unknown';
  const parseJobs = (items: unknown[]) => items.flatMap(item => {
    if (!isRecord(item) || !token(item.id) || !token(item.target)) { partial = true; return []; }
    const status = typeof item.status === 'string' && Object.hasOwn(PIPELINE_JOB_LABELS, item.status) ? item.status : 'Unknown';
    if (status === 'Unknown') partial = true;
    return [{ id: item.id, target: item.target, profile: item.profile === 'heavy_local' || item.profile === 'lite_gha' ? item.profile : 'unknown', status, dry_run: typeof item.dry_run === 'boolean' ? item.dry_run : undefined, adapter_index: count(item.adapter_index) ? item.adapter_index : null, hasError: Boolean(item.error_code) } satisfies PipelineJobView];
  });
  const jobs = parseJobs(value.jobs), failures = source === 'github_actions' ? [] : parseJobs(value.failures);
  const targets = value.targets.flatMap(item => {
    if (!isRecord(item) || !token(item.id)) { partial = true; return []; }
    const status = typeof item.status === 'string' && (item.status === 'Idle' || Object.hasOwn(PIPELINE_JOB_LABELS, item.status)) ? item.status : 'Unknown';
    if (status === 'Unknown') partial = true;
    return [{ id: item.id, status }];
  });
  const gauges: Partial<Record<PipelineGaugeKey, number>> = {};
  if (isRecord(value.gauges)) for (const key of PIPELINE_GAUGE_KEYS) { const n = value.gauges[key]; if (typeof n === 'number' && Number.isFinite(n) && n >= 0) gauges[key] = n; }
  return { source, partial: partial || source === 'unknown', jobs, failures, targets, gauges,
    environment: value.dataEnv === 'local_db' ? '로컬 DB' : value.dataEnv === 'hosted_read' ? '호스팅 조회' : '미확인',
    hardware: value.hardware === 'macbook_m5_max' ? 'MacBook M5 Max' : value.hardware === 'github_actions' ? 'GitHub Actions' : '미확인' };
}

export function pipelineJobsForDisplay(snapshot: PipelineStatusView | undefined, manifest: PipelineManifestView | undefined): PipelineJobView[] {
  if (!snapshot) return [];
  if (snapshot.source === 'unknown') return snapshot.jobs.map(job => ({ ...job, status: 'Unknown', hasError: false, dry_run: undefined, adapter_index: null }));
  if (snapshot.source === 'job_api') return snapshot.jobs;
  return snapshot.jobs.map(job => {
    const gha = manifest?.github?.id === job.id ? manifest.github : null;
    const state = parseGithubWorkflowState(gha);
    return { ...job, status: state.jobStatus, hasError: state.failed === true, dry_run: undefined, adapter_index: null };
  });
}

export function canControlPipelineJob(source: PipelineStatusView['source'] | undefined, job: PipelineJobView, action: 'pause' | 'resume' | 'cancel') {
  const statuses = action === 'pause' ? ['Queued', 'Fetching', 'Inserting'] : action === 'resume' ? ['Paused'] : ['Queued', 'Fetching', 'Inserting', 'Paused'];
  return source === 'job_api' && job.profile !== 'unknown' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(job.id) && statuses.includes(job.status);
}
