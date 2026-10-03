import { isRecord } from './normalize-evaluation-record';

export type ReviewRun = { id: string; started_at: string; scanned: number; approved: number; held: number; recheck: number; protected: number };
export type ReviewItem = { id: string; restaurant_id: string; restaurant_name?: string; reason: string; state: string };
export type ReviewAutomationSnapshot = { policy: { version: number; enabled: boolean; batch_size: number; daily_limit: number; last_run_at: string | null }; runs: ReviewRun[]; items: ReviewItem[]; queue: { queued: number; running: number; failed: number } };
export type ReviewAutomationPreview = { version: string; previewHash: string; counts: Record<string, number>; batchSize: number; dailyLimit: number };
const count = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const limit = (value: unknown): value is number => count(value) && value >= 1 && value <= 200;
const id = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
const timestamp = (value: unknown): value is string => typeof value === 'string' && value.length <= 40 && Number.isFinite(Date.parse(value));

export function parseReviewAutomationSnapshot(value: unknown): ReviewAutomationSnapshot {
  if (!isRecord(value) || !isRecord(value.policy) || !isRecord(value.queue) || !Array.isArray(value.runs) || !Array.isArray(value.items)) throw new Error('AUTOMATION_RESPONSE_INVALID');
  const p = value.policy;
  if (!count(p.version) || typeof p.enabled !== 'boolean' || !limit(p.batch_size) || !limit(p.daily_limit) || (p.last_run_at !== null && !timestamp(p.last_run_at))
    || !['queued','running','failed'].every(key => count((value.queue as Record<string, unknown>)[key])) || value.runs.length > 10 || value.items.length > 20) throw new Error('AUTOMATION_RESPONSE_INVALID');
  if (!value.runs.every(run => isRecord(run) && id(run.id) && timestamp(run.started_at) && ['scanned','approved','held','recheck','protected'].every(key => count(run[key])))
    || !value.items.every(item => isRecord(item) && id(item.id) && id(item.restaurant_id) && (item.restaurant_name === undefined || (typeof item.restaurant_name === 'string' && item.restaurant_name.length <= 160)) && typeof item.reason === 'string' && /^[a-z_]{1,64}$/.test(item.reason)
      && ['applied','queued','running','succeeded','failed','cancelled'].includes(String(item.state)))) throw new Error('AUTOMATION_RESPONSE_INVALID');
  return value as ReviewAutomationSnapshot;
}

export function parseReviewAutomationPreview(value: unknown): ReviewAutomationPreview {
  if (!isRecord(value) || typeof value.version !== 'string' || !/^\d{1,19}$/.test(value.version) || typeof value.previewHash !== 'string' || !/^[0-9a-f]{32}$/.test(value.previewHash)
    || !limit(value.batchSize) || !limit(value.dailyLimit) || !isRecord(value.counts)
    || Object.entries(value.counts).some(([key, value]) => !['approve','recheck','hold','protected'].includes(key) || !count(value))) throw new Error('AUTOMATION_RESPONSE_INVALID');
  return value as ReviewAutomationPreview;
}
