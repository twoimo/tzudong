export type WorkflowStepStatus =
  | 'queued'
  | 'running'
  | 'success'
  | 'failed'
  | 'timeout'
  | 'partial'
  | 'skipped';

export type WorkflowCorrelationState =
  | 'pending_dispatch'
  | 'dispatched_unmatched'
  | 'matched'
  | 'reconciled_timeout'
  | 'reconciled_error'
  | 'completed';

export interface AdminWorkflowRunRecord {
  run_id: string;
  dispatch_request_id: string;
  correlation_state: WorkflowCorrelationState;
  trigger_source: string;
  requested_by_user_id: string | null;
  channel_url_raw: string;
  channel_url_normalized: string;
  channel_slug: string;
  channel_id: string | null;
  workflow_file: string;
  workflow_ref: string;
  github_run_id: number | null;
  github_run_number: number | null;
  github_run_attempt: number | null;
  github_status: string | null;
  github_conclusion: string | null;
  requested_at: string | null;
  dispatched_at: string | null;
  matched_at: string | null;
  completed_at: string | null;
  error_code: string | null;
  error_message: string | null;
  updated_at: string | null;
}

export interface AdminWorkflowStepRecord {
  id: string;
  run_id: string;
  canonical_step_no: number;
  canonical_step_key: string;
  script_step_label: string | null;
  status: WorkflowStepStatus;
  started_at: string | null;
  ended_at: string | null;
  duration_ms: number | null;
  message: string | null;
  row_delta: Record<string, unknown> | null;
  attempt: number | null;
}

export interface CanonicalWorkflowStepDefinition {
  canonical_step_no: number;
  canonical_step_key: string;
  name: string;
  script_step_label: string;
}

export const CANONICAL_WORKFLOW_STEPS: CanonicalWorkflowStepDefinition[] = [
  { canonical_step_no: 1, canonical_step_key: 'url_collection', name: 'URL 수집', script_step_label: 'Step 1' },
  { canonical_step_no: 2, canonical_step_key: 'metadata_collection', name: '메타데이터 수집', script_step_label: 'Step 2' },
  { canonical_step_no: 3, canonical_step_key: 'meta_sync_orphan_cleanup', name: '메타 동기화 + 고아 정리', script_step_label: 'Step 2.1+2.5' },
  { canonical_step_no: 4, canonical_step_key: 'transcript_collection', name: '자막 수집', script_step_label: 'Step 3' },
  { canonical_step_no: 5, canonical_step_key: 'context_generation', name: '문맥 생성', script_step_label: 'Step 3.1' },
  { canonical_step_no: 6, canonical_step_key: 'frames_heatmap', name: '프레임 + 히트맵', script_step_label: 'Step 4' },
  { canonical_step_no: 7, canonical_step_key: 'transcript_enrichment', name: '자막 보강', script_step_label: 'Step 6.1' },
  { canonical_step_no: 8, canonical_step_key: 'gemini_data_analysis', name: 'Gemini 데이터 분석', script_step_label: 'Step 7' },
  { canonical_step_no: 9, canonical_step_key: 'target_selection', name: '대상 선정', script_step_label: 'Step 08' },
  { canonical_step_no: 10, canonical_step_key: 'rule_evaluation', name: '규칙 평가', script_step_label: 'Step 09' },
  { canonical_step_no: 11, canonical_step_key: 'laaj_evaluation', name: 'LAAJ 평가', script_step_label: 'Step 10' },
  { canonical_step_no: 12, canonical_step_key: 'publish_results', name: '결과 발행', script_step_label: 'Step 11+12' },
];

export interface CanonicalWorkflowStepView extends AdminWorkflowStepRecord {
  name: string;
}

export function normalizeChannelInput(channelUrlRaw: string): { channel_url_normalized: string; channel_slug: string } | null {
  const candidate = channelUrlRaw.trim();
  if (!candidate) return null;

  try {
    const parsed = new URL(candidate);
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return null;
    }

    const hostname = parsed.hostname.toLowerCase();
    const allowedYoutubeHosts = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com']);
    if (!allowedYoutubeHosts.has(hostname)) {
      return null;
    }

    parsed.hash = '';
    parsed.search = '';
    const normalized = parsed.toString().replace(/\/+$/, '');

    const pathParts = parsed.pathname
      .split('/')
      .map((part) => part.trim())
      .filter(Boolean);

    const firstPart = pathParts[0] ?? '';
    const secondPart = pathParts[1] ?? '';
    const firstPartLower = firstPart.toLowerCase();

    let rawSlug = '';
    let canonicalPath = parsed.pathname;

    if (firstPart.startsWith('@')) {
      rawSlug = firstPart.slice(1);
      canonicalPath = `/${firstPart}`;
    } else if (['channel', 'c', 'user'].includes(firstPartLower) && secondPart) {
      rawSlug = secondPart;
      canonicalPath = `/${firstPart}/${secondPart}`;
    } else if (['watch', 'results', 'playlist', 'shorts', 'feed'].includes(firstPartLower)) {
      return null;
    } else {
      rawSlug = pathParts[pathParts.length - 1] ?? '';
      canonicalPath = parsed.pathname;
    }

    const channelSlug = rawSlug.replace(/^@/, '').toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');

    if (!channelSlug) {
      return null;
    }

    const canonicalUrl = `${parsed.origin}${canonicalPath}`.replace(/\/+$/, '');

    return {
      channel_url_normalized: canonicalUrl || normalized,
      channel_slug: channelSlug,
    };
  } catch {
    return null;
  }
}

export function buildCanonicalWorkflowSteps(steps: AdminWorkflowStepRecord[]): CanonicalWorkflowStepView[] {
  const byStepNo = new Map<number, AdminWorkflowStepRecord>();
  for (const step of steps) {
    byStepNo.set(step.canonical_step_no, step);
  }

  return CANONICAL_WORKFLOW_STEPS.map((baseStep) => {
    const found = byStepNo.get(baseStep.canonical_step_no);
    if (found) {
      return {
        ...found,
        name: baseStep.name,
        canonical_step_key: found.canonical_step_key || baseStep.canonical_step_key,
        script_step_label: found.script_step_label || baseStep.script_step_label,
      };
    }

    return {
      id: `${baseStep.canonical_step_key}-virtual`,
      run_id: steps[0]?.run_id ?? '',
      canonical_step_no: baseStep.canonical_step_no,
      canonical_step_key: baseStep.canonical_step_key,
      script_step_label: baseStep.script_step_label,
      status: 'queued',
      started_at: null,
      ended_at: null,
      duration_ms: null,
      message: null,
      row_delta: null,
      attempt: null,
      name: baseStep.name,
    };
  });
}

const TERMINAL_STEP_STATUS: WorkflowStepStatus[] = ['success', 'failed', 'timeout', 'partial', 'skipped'];

export function calculateWorkflowProgressPercent(steps: CanonicalWorkflowStepView[]): number {
  if (steps.length === 0) return 0;

  const doneCount = steps.filter((step) => TERMINAL_STEP_STATUS.includes(step.status)).length;
  return Math.round((doneCount / CANONICAL_WORKFLOW_STEPS.length) * 100);
}

export function findWorkflowFailurePoint(steps: CanonicalWorkflowStepView[]): CanonicalWorkflowStepView | null {
  return steps.find((step) => step.status === 'failed' || step.status === 'timeout') ?? null;
}

export function summarizeRowSignals(rowDelta: Record<string, unknown> | null): string[] {
  if (!rowDelta || typeof rowDelta !== 'object') {
    return [];
  }

  return Object.entries(rowDelta)
    .slice(0, 4)
    .map(([key, value]) => `${key}: ${String(value)}`);
}
