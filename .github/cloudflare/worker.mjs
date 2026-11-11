// This Worker reports the bounded governance lane only. It is not a release gate.
export const RECEIPT_SCHEMA = 'cloudflare-governance.v1';
export const PROFILE = 'governance';
export const TOTAL_BUDGET_MS = 600_000;
export const MAX_ARTIFACT_BYTES = 128 * 1024;
export const EXPECTED_ARTIFACT_SHA256 = '1d93266a9f0663daac1589e6ab6934e9f54977751b5cc6ed8a1c30d96288138e';
export const CHECK_NAMES = Object.freeze([
  'performance-backlog-governance',
  'release-workflow-governance-source',
  'tracked-document-integrity',
  'ci-benchmark-classifier',
  'cloudflare-governance-tooling',
]);
const SHA = /^(?!0{40}$)[a-f0-9]{40}$/;
const UUID = /^(?!00000000-0000-0000-0000-000000000000$)[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const keys = (value, expected) => value !== null && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).length === expected.length && expected.every((key) => Object.hasOwn(value, key));
const integer = (value, maximum = TOTAL_BUDGET_MS) => Number.isSafeInteger(value) && value >= 0 && value <= maximum;
const version = (value) => typeof value === 'string' && /^[0-9][0-9A-Za-z.+-]{0,63}$/.test(value);

export function validBranch(branch) {
  return typeof branch === 'string' && /^[A-Za-z0-9][A-Za-z0-9._/-]{0,199}$/.test(branch)
    && !branch.includes('..') && !branch.includes('//') && !branch.includes('/.')
    && !branch.endsWith('.lock') && !/[/.]$/.test(branch);
}

export function validateReceipt(receipt, { allowLocal = true } = {}) {
  try {
    if (!keys(receipt, ['schemaVersion', 'profile', 'scope', 'status', 'provider', 'commit', 'tree', 'branch', 'branchBinding', 'trackedWorktreeClean', 'buildId', 'startedAt', 'completedAt', 'durationMs', 'budgetMs', 'toolVersions', 'checks', 'evidence'])) return false;
    if (receipt.schemaVersion !== RECEIPT_SCHEMA || receipt.profile !== PROFILE || receipt.scope !== 'governance-contracts-only' || receipt.status !== 'passed') return false;
    const remote = receipt.provider === 'cloudflare-workers-builds';
    if (!remote && !(allowLocal && receipt.provider === 'local')) return false;
    if (typeof receipt.commit !== 'string' || typeof receipt.tree !== 'string' || !SHA.test(receipt.commit) || !SHA.test(receipt.tree) || !validBranch(receipt.branch)) return false;
    if (typeof receipt.trackedWorktreeClean !== 'boolean' || (remote && !receipt.trackedWorktreeClean)) return false;
    if (remote ? !['git-ref', 'provider-event'].includes(receipt.branchBinding) || typeof receipt.buildId !== 'string' || !UUID.test(receipt.buildId)
      : receipt.branchBinding !== 'local' || typeof receipt.buildId !== 'string' || !receipt.buildId.startsWith('local-') || !UUID.test(receipt.buildId.slice(6))) return false;
    if (![receipt.startedAt, receipt.completedAt].every((value) => typeof value === 'string' && ISO_DATE.test(value) && Number.isFinite(Date.parse(value)))) return false;
    if (Date.parse(receipt.completedAt) < Date.parse(receipt.startedAt) || !integer(receipt.durationMs) || receipt.budgetMs !== TOTAL_BUDGET_MS) return false;
    if (!keys(receipt.toolVersions, ['node', 'bun', 'python', 'git']) || !Object.values(receipt.toolVersions).every(version)) return false;
    if (!/^24\./.test(receipt.toolVersions.node) || receipt.toolVersions.bun !== '1.4.0' || !/^3\./.test(receipt.toolVersions.python)) return false;
    if (!Array.isArray(receipt.checks) || receipt.checks.length !== CHECK_NAMES.length) return false;
    if (!receipt.checks.every((check, index) => keys(check, ['name', 'status', 'durationMs']) && check.name === CHECK_NAMES[index] && check.status === 'passed' && integer(check.durationMs))) return false;
    if (receipt.checks.reduce((sum, check) => sum + check.durationMs, 0) > receipt.durationMs) return false;
    if (!keys(receipt.evidence, ['kind', 'name', 'sha256', 'bytes']) || receipt.evidence.kind !== 'sanitized-governance-fixture' || receipt.evidence.name !== 'backlog.scored.json' || receipt.evidence.sha256 !== EXPECTED_ARTIFACT_SHA256 || !integer(receipt.evidence.bytes, MAX_ARTIFACT_BYTES) || receipt.evidence.bytes === 0) return false;
    return new TextEncoder().encode(JSON.stringify(receipt)).byteLength <= 16 * 1024;
  } catch { return false; }
}

export async function validateArtifact(receipt, artifact) {
  if (!validateReceipt(receipt) || typeof artifact !== 'string') return false;
  const bytes = new TextEncoder().encode(artifact);
  if (bytes.byteLength !== receipt.evidence.bytes || bytes.byteLength > MAX_ARTIFACT_BYTES) return false;
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('') === receipt.evidence.sha256;
}

const headers = (type = 'application/json; charset=utf-8') => ({
  'content-type': type,
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff',
  'content-security-policy': "default-src 'none'; frame-ancestors 'none'",
});
const json = (body, status) => new Response(`${JSON.stringify(body)}\n`, { status, headers: headers() });

export function createWorker(receipt = null, artifact = null) {
  // Validation happens before any supplied content can enter an HTTP response.
  const valid = validateReceipt(receipt);
  let artifactValid;
  return {
    async fetch(request) {
      if (request.method !== 'GET') return new Response(null, { status: 405, headers: { ...headers(), allow: 'GET' } });
      const path = new URL(request.url).pathname;
      if (!['/health', '/receipt', '/artifacts/backlog.scored.json', '/artifacts/backlog.scored.json.sha256'].includes(path)) return json({ profile: PROFILE, error: 'NOT_FOUND' }, 404);
      if (!valid) return json({ profile: PROFILE, scope: 'governance-contracts-only', status: 'unavailable', error: 'RECEIPT_UNAVAILABLE' }, 503);
      if (receipt.provider !== 'cloudflare-workers-builds') return json({ profile: PROFILE, scope: 'governance-contracts-only', provider: 'local', status: 'diagnostic-only', error: 'LOCAL_RECEIPT_NOT_PUBLISHABLE' }, 503);
      // Only the boolean is cached; no request-bound promise is shared across requests.
      artifactValid ??= await validateArtifact(receipt, artifact);
      if (!artifactValid) return json({ profile: PROFILE, scope: 'governance-contracts-only', status: 'unavailable', error: 'EVIDENCE_UNAVAILABLE' }, 503);
      if (path === '/receipt') return json(receipt, 200);
      if (path === '/artifacts/backlog.scored.json') return new Response(artifact, { status: 200, headers: headers() });
      if (path === '/artifacts/backlog.scored.json.sha256') return new Response(`${receipt.evidence.sha256}\n`, { status: 200, headers: headers('text/plain; charset=utf-8') });
      return json({ profile: PROFILE, scope: 'governance-contracts-only', status: 'passed', commit: receipt.commit, tree: receipt.tree, buildId: receipt.buildId }, 200);
    },
  };
}

// A source-only or incomplete deployment must never report a successful check.
export default createWorker();
