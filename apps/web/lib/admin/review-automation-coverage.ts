export type ReviewAutomationCoverage =
  | { state: 'available'; pendingRows: number; heldRows: number; latestInputAt: string | null }
  | { state: 'unavailable' };

type CountResult = { count: number | null; error: unknown };
type LatestResult = { data: { created_at: unknown } | null; error: unknown };
type CoverageSource = {
  count: (status: 'pending' | 'hold') => PromiseLike<CountResult>;
  latest: () => PromiseLike<LatestResult>;
};

const validCount = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;

export function isReviewAutomationCoverage(value: unknown): value is ReviewAutomationCoverage {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  if (row.state === 'unavailable') return Object.keys(row).length === 1;
  return row.state === 'available' && Object.keys(row).length === 4
    && validCount(row.pendingRows) && validCount(row.heldRows)
    && (row.latestInputAt === null || (typeof row.latestInputAt === 'string' && row.latestInputAt.length <= 40 && Number.isFinite(Date.parse(row.latestInputAt))));
}

/** Counts describe stored review inputs, not the health of the video collector. */
export async function readReviewAutomationCoverage(source: CoverageSource): Promise<ReviewAutomationCoverage> {
  try {
    const [pending, held, latest] = await Promise.all([source.count('pending'), source.count('hold'), source.latest()]);
    if (pending.error !== null || held.error !== null || latest.error !== null || !validCount(pending.count) || !validCount(held.count)
      || (latest.data !== null && typeof latest.data.created_at !== 'string')) return { state: 'unavailable' };
    const value: unknown = { state: 'available', pendingRows: pending.count, heldRows: held.count, latestInputAt: latest.data === null ? null : latest.data.created_at };
    return isReviewAutomationCoverage(value) ? value : { state: 'unavailable' };
  } catch {
    return { state: 'unavailable' };
  }
}
