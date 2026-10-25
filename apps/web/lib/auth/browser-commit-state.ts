import { isChunkLike, parseCookieHeader } from '@supabase/ssr';

type Contract = { key: string; marker: string };
const revisionKey = ({ key }: Pick<Contract, 'key'>) => `tz-auth-commit:${key}`;

export function advanceBrowserAuthRevision(contract: Pick<Contract, 'key'>) {
  try {
    const revision = crypto.randomUUID();
    localStorage.setItem(revisionKey(contract), revision);
    if (localStorage.getItem(revisionKey(contract)) !== revision) throw new Error();
    return revision;
  } catch { throw new Error('AUTH_COMMIT_STATE_UNAVAILABLE'); }
}

// Credentials stay in memory/cookies. Only the opaque revision is persisted;
// OAuth carries a SHA-256 digest of this snapshot across document navigation.
export function captureBrowserAuthState(contract: Contract) {
  let revision: string | null;
  try { revision = localStorage.getItem(revisionKey(contract)); }
  catch { throw new Error('AUTH_COMMIT_STATE_UNAVAILABLE'); }
  return JSON.stringify([revision, parseCookieHeader(document.cookie)
    .filter(cookie => cookie.name === contract.marker || isChunkLike(cookie.name, contract.key))
    .map(({ name, value }) => [name, value]).sort(([a], [b]) => a.localeCompare(b))]);
}
