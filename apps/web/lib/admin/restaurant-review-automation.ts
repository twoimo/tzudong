import { isRecord } from './normalize-evaluation-record';

export type ReviewRun = { id: string; started_at: string; scanned: number; approved: number; held: number; recheck: number; protected: number };
export const REVIEW_EVIDENCE_CODES = ['visit_supported','identity_supported','review_grounded','category_supported','location_corroborated','source_consistent','insufficient_evidence','identity_conflict','location_conflict','review_unfaithful','category_conflict','source_conflict'] as const;
export type ReviewEvidenceCode = typeof REVIEW_EVIDENCE_CODES[number];
export type ReviewGeminiDecision = { schemaVersion: 1; model: 'gemini-3.8-flash'; modelVersion: 'gemini-3.8-flash'; promptVersion: 'restaurant-review-v1'; inputSha256: string; promptSha256: string; recommendation: 'approve' | 'hold' | 'recheck'; evidenceCodes: ReviewEvidenceCode[]; outcome?: 'approve' | 'hold' | 'recheck' | 'protected' | 'blocked' | 'deferred'; decidedAt?: string };
export type ReviewJudgmentEngine = { provider: 'gemini'; model: 'gemini-3.8-flash'; promptVersion: 'restaurant-review-v1'; requiredForApproval: true; maxCallsPerClaim: 1 };
export type ReviewItem = { id: string; restaurant_id: string; restaurant_name?: string; reason: string; state: string; geminiDecision?: ReviewGeminiDecision | null };
export type ReviewAutomationSnapshot = { policy: { version: number; enabled: boolean; batch_size: number; daily_limit: number; last_run_at: string | null }; runs: ReviewRun[]; items: ReviewItem[]; queue: { queued: number; running: number; failed: number }; judgmentEngine?: ReviewJudgmentEngine };
export type ReviewAutomationPreview = { version: string; previewHash: string; counts: Record<string, number>; batchSize: number; dailyLimit: number; action?: 'run' | 'stop'; queue?: { queued: number; running: number }; remainingApprovals?: number };
const count = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const limit = (value: unknown): value is number => count(value) && value >= 1 && value <= 200;
const id = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
const timestamp = (value: unknown): value is string => typeof value === 'string' && value.length <= 40 && Number.isFinite(Date.parse(value));
const sha = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);

export function isReviewGeminiDecision(value: unknown): value is ReviewGeminiDecision {
  if (!isRecord(value) || value.schemaVersion !== 1 || value.model !== 'gemini-3.8-flash' || value.modelVersion !== value.model
    || value.promptVersion !== 'restaurant-review-v1' || !sha(value.inputSha256) || !sha(value.promptSha256)
    || !['approve','hold','recheck'].includes(String(value.recommendation)) || !Array.isArray(value.evidenceCodes)
    || value.evidenceCodes.length < 1 || value.evidenceCodes.length > 12 || new Set(value.evidenceCodes).size !== value.evidenceCodes.length
    || value.evidenceCodes.some(code => !REVIEW_EVIDENCE_CODES.includes(code as ReviewEvidenceCode))
    || Object.keys(value).some(key => !['schemaVersion','model','modelVersion','promptVersion','inputSha256','promptSha256','recommendation','evidenceCodes','outcome','decidedAt'].includes(key))
    || (value.outcome !== undefined && !['approve','hold','recheck','protected','blocked','deferred'].includes(String(value.outcome)))
    || (value.decidedAt !== undefined && !timestamp(value.decidedAt))) return false;
  const positive = REVIEW_EVIDENCE_CODES.slice(0, 6);
  const codes = value.evidenceCodes;
  return value.recommendation === 'approve'
    ? codes.length === positive.length && positive.every(code => codes.includes(code))
    : codes.some(code => !positive.includes(code as typeof positive[number]));
}

function isJudgmentEngine(value: unknown): value is ReviewJudgmentEngine {
  return isRecord(value) && value.provider === 'gemini' && value.model === 'gemini-3.8-flash'
    && value.promptVersion === 'restaurant-review-v1' && value.requiredForApproval === true && value.maxCallsPerClaim === 1;
}

export function parseReviewAutomationSnapshot(value: unknown): ReviewAutomationSnapshot {
  if (!isRecord(value) || !isRecord(value.policy) || !isRecord(value.queue) || !Array.isArray(value.runs) || !Array.isArray(value.items)) throw new Error('AUTOMATION_RESPONSE_INVALID');
  const p = value.policy;
  if (!count(p.version) || typeof p.enabled !== 'boolean' || !limit(p.batch_size) || !limit(p.daily_limit) || (p.last_run_at !== null && !timestamp(p.last_run_at))
    || !['queued','running','failed'].every(key => count((value.queue as Record<string, unknown>)[key])) || value.runs.length > 10 || value.items.length > 20) throw new Error('AUTOMATION_RESPONSE_INVALID');
  if (!value.runs.every(run => isRecord(run) && id(run.id) && timestamp(run.started_at) && ['scanned','approved','held','recheck','protected'].every(key => count(run[key])))
    || !value.items.every(item => isRecord(item) && id(item.id) && id(item.restaurant_id) && (item.restaurant_name === undefined || (typeof item.restaurant_name === 'string' && item.restaurant_name.length <= 160)) && typeof item.reason === 'string' && /^[a-z_]{1,64}$/.test(item.reason)
      && ['applied','queued','running','succeeded','failed','cancelled'].includes(String(item.state))
      && (item.geminiDecision == null || isReviewGeminiDecision(item.geminiDecision)))
    || (value.judgmentEngine !== undefined && !isJudgmentEngine(value.judgmentEngine))) throw new Error('AUTOMATION_RESPONSE_INVALID');
  return value as ReviewAutomationSnapshot;
}

export function parseReviewAutomationPreview(value: unknown): ReviewAutomationPreview {
  if (!isRecord(value) || typeof value.version !== 'string' || !/^\d{1,19}$/.test(value.version) || typeof value.previewHash !== 'string' || !/^[0-9a-f]{32}$/.test(value.previewHash)
    || !limit(value.batchSize) || !limit(value.dailyLimit) || !isRecord(value.counts)
    || Object.entries(value.counts).some(([key, value]) => !['approve','recheck','hold','protected'].includes(key) || !count(value))
    || (value.action !== undefined && (!['run','stop'].includes(String(value.action)) || !isRecord(value.queue)
      || !count(value.queue.queued) || !count(value.queue.running) || !count(value.remainingApprovals)))) throw new Error('AUTOMATION_RESPONSE_INVALID');
  return value as ReviewAutomationPreview;
}
