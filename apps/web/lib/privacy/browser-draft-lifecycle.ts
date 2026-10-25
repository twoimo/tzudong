// One bounded origin-wide marker containing only an account ID and random
// revision. Draft text, media and authentication credentials never enter it.
// Read it synchronously before IDB transactions and their conditional mutations:
// storage events may be delayed or absent in a suspended document.
export const BROWSER_DRAFT_AUTHORITY_KEY = 'tzudong-draft-authority-v3';
type Authority = { owner: string; revision: string; writable: boolean };
export type BrowserDraftEpoch = Readonly<{ writable: boolean; generation: number; authority?: string }>;
let generation = 0;
const owners = new Map<string, BrowserDraftEpoch>();

export function readBrowserDraftAuthority(): string | undefined {
  if (typeof window === 'undefined') return undefined;
  try { return window.localStorage.getItem(BROWSER_DRAFT_AUTHORITY_KEY) ?? undefined; }
  catch { return 'unavailable'; }
}
function parseAuthority(raw: string | undefined): Authority | null {
  if (raw === undefined) return null;
  try {
    if (raw.length > 512) return null;
    const value = JSON.parse(raw);
    return value && typeof value.owner === 'string' && value.owner.length <= 128
      && typeof value.revision === 'string' && value.revision.length <= 64
      && typeof value.writable === 'boolean' ? value : null;
  } catch { return null; }
}
function publishAuthority(userId: string, writable: boolean): string {
  const raw = JSON.stringify({ owner: userId, revision: crypto.randomUUID(), writable });
  try { window.localStorage.setItem(BROWSER_DRAFT_AUTHORITY_KEY, raw); }
  catch { return 'unavailable'; }
  return readBrowserDraftAuthority() === raw ? raw : 'unavailable';
}
export function isBrowserDraftOwnerActive(userId: string): boolean {
  const raw = readBrowserDraftAuthority();
  const value = parseAuthority(raw);
  return raw === undefined || Boolean(value?.writable && value.owner === userId);
}
// Resume has already re-read the current SDK session and checked eligibility.
// A's cleanup marker must not prevent that verified B session from activating.
// Keep A itself blocked until its actual sign-in event, including while logout
// is still in flight. Unreadable or malformed authority remains fail closed.
export function canResumeBrowserDraftOwner(userId: string): boolean {
  const raw = readBrowserDraftAuthority();
  const value = parseAuthority(raw);
  return raw === undefined || Boolean(value && (value.owner !== userId || value.writable));
}
export function captureBrowserDraftEpoch(userId: string): BrowserDraftEpoch {
  const authority = readBrowserDraftAuthority();
  let epoch = owners.get(userId);
  if (!epoch || epoch.authority !== authority) {
    // An existing composer cannot adopt another session just by saving again.
    const writable = !epoch && isBrowserDraftOwnerActive(userId);
    epoch = { writable, generation: ++generation, authority };
    owners.set(userId, epoch);
  }
  return epoch;
}
export function beginBrowserDraftCleanup(userId: string): BrowserDraftEpoch {
  const raw = readBrowserDraftAuthority();
  const current = owners.get(userId);
  if (current && !current.writable && current.authority === raw) return current;
  const shared = parseAuthority(raw);
  // A scoped cleanup of A must not revoke the already eligible account B.
  const authority = typeof window !== 'undefined' && (raw === undefined || (shared?.owner === userId && shared.writable))
    ? publishAuthority(userId, false) : raw;
  const epoch = { writable: false, generation: ++generation, authority };
  owners.set(userId, epoch);
  return epoch;
}
export function activateBrowserDraftOwner(userId: string) {
  const raw = readBrowserDraftAuthority();
  const shared = parseAuthority(raw);
  const authority = typeof window !== 'undefined' && !(shared?.owner === userId && shared.writable)
    ? publishAuthority(userId, true) : raw;
  const current = owners.get(userId);
  if (!current?.writable || current.authority !== authority) {
    owners.set(userId, { writable: authority !== 'unavailable' && isBrowserDraftOwnerActive(userId), generation: ++generation, authority });
  }
}
export function isBrowserDraftEpochCurrent(userId: string, epoch: BrowserDraftEpoch, writing = false) {
  return owners.get(userId) === epoch && epoch.authority === readBrowserDraftAuthority()
    && (!writing || (epoch.writable && isBrowserDraftOwnerActive(userId)));
}
export function assertBrowserDraftWrite(userId: string, epoch: BrowserDraftEpoch) {
  if (!isBrowserDraftEpochCurrent(userId, epoch, true)) throw new Error('DRAFT_SESSION_CHANGED');
}
