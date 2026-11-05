// Only bounded presentation state belongs in history, never account fields or drafts.
const STATE_KEY = 'tzudongMyPageView';
export type MyPageReviewStatus = 'all' | 'approved' | 'pending' | 'rejected';
export function isMyPageReviewStatus(value: unknown): value is MyPageReviewStatus {
  return typeof value === 'string' && ['all', 'approved', 'pending', 'rejected'].includes(value);
}
export interface MyPageRouteState {
  path: string;
  scrollTop?: number;
  bookmarkLimit?: number;
}
const routes = new Set(['/mypage/profile', '/mypage/bookmarks', '/mypage/reviews', '/mypage/submissions/new', '/mypage/submissions/edit', '/mypage/submissions/recommend']);
function parse(path: string, value: unknown): MyPageRouteState {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { path };
  const row = value as Record<string, unknown>;
  if (row.path !== path) return { path };
  const state: MyPageRouteState = { path };
  if (typeof row.scrollTop === 'number' && Number.isFinite(row.scrollTop) && row.scrollTop >= 0 && row.scrollTop <= 10_000_000) state.scrollTop = row.scrollTop;
  if (typeof row.bookmarkLimit === 'number' && Number.isInteger(row.bookmarkLimit) && row.bookmarkLimit >= 15 && row.bookmarkLimit <= 100_000) state.bookmarkLimit = row.bookmarkLimit;
  return state;
}
export function readMyPageRouteState(path: string): MyPageRouteState {
  if (typeof window === 'undefined' || !routes.has(path)) return { path };
  return parse(path, window.history.state?.[STATE_KEY]);
}
export function writeMyPageRouteState(path: string, patch: Omit<Partial<MyPageRouteState>, 'path'>) {
  if (typeof window === 'undefined' || window.location.pathname !== path || !routes.has(path)) return;
  try {
    window.history.replaceState({ ...window.history.state, [STATE_KEY]: parse(path, { ...readMyPageRouteState(path), ...patch }) }, '', window.location.href);
  } catch { /* Navigation remains available when history writes are unavailable. */ }
}
