import { createHash } from 'node:crypto';
import { lstatSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { isDeepStrictEqual } from 'node:util';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { MAX_ARTIFACT_BYTES, validateReceipt, validBranch } from '../cloudflare/worker.mjs';
import { childEnvironment, GENERATED_ENTRY_SOURCE, GovernanceError, identifyCheckout, runCommand } from './run-cloudflare-governance.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const DEPLOYMENT_BUDGET_MS = 420_000;
const READBACK_BUDGET_MS = 45_000;
const READBACK_REQUEST_TIMEOUT_MS = 8_000;
const READBACK_ATTEMPTS = 3;
const GOVERNANCE_ORIGIN = 'https://tzudong-ci-governance.twoimo.workers.dev';
const MAX_RECEIPT_AGE_MS = 30 * 60_000;
const fail = (code) => { throw new GovernanceError(code); };

// Neither the CLI nor environment variables can select a different origin or
// send deployment credentials to the public readback endpoints.
async function readPublishedBytes(path, maximumBytes, contentType, { fetchImpl, signal, deadline }) {
  if (signal?.aborted) fail('DEPLOY_READBACK_INTERRUPTED');
  const available = Math.min(READBACK_REQUEST_TIMEOUT_MS, deadline - performance.now());
  if (!(available > 0)) fail('DEPLOY_READBACK_TIMEOUT');
  const controller = new AbortController();
  let reader;
  let response;
  let rejectStopped;
  let stopCode;
  const stopped = new Promise((_, reject) => { rejectStopped = reject; });
  const stop = (code) => { stopCode ??= code; controller.abort(); rejectStopped(new GovernanceError(stopCode)); };
  const abort = () => stop('DEPLOY_READBACK_INTERRUPTED');
  const timer = setTimeout(() => stop('DEPLOY_READBACK_TIMEOUT'), available);
  signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) abort();
  try {
    return await Promise.race([stopped, (async () => {
      response = await fetchImpl(`${GOVERNANCE_ORIGIN}${path}`, {
        method: 'GET', credentials: 'omit', redirect: 'error', cache: 'no-store',
        headers: { accept: contentType, 'accept-encoding': 'identity', 'cache-control': 'no-cache' }, signal: controller.signal,
      });
      if (controller.signal.aborted) {
        try { void response.body?.cancel()?.catch(() => {}); } catch { /* Already closed. */ }
        fail(stopCode ?? 'DEPLOY_READBACK_INTERRUPTED');
      }
      if ([404, 408, 409, 425, 429].includes(response.status) || response.status >= 500) fail('DEPLOY_READBACK_UNAVAILABLE');
      if (response.status !== 200) fail('DEPLOY_READBACK_HTTP_INVALID');
      if (!response.headers.get('cache-control')?.split(',').some((part) => part.trim().toLowerCase() === 'no-store')
        || response.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== contentType
        || ![null, 'identity'].includes(response.headers.get('content-encoding'))) fail('DEPLOY_READBACK_HEADERS_INVALID');
      const length = response.headers.get('content-length');
      if (length !== null && (!/^[0-9]+$/.test(length) || !Number.isSafeInteger(Number(length)) || Number(length) < 1)) fail('DEPLOY_READBACK_BODY_INVALID');
      if (length !== null && Number(length) > maximumBytes) fail('DEPLOY_READBACK_TOO_LARGE');
      reader = response.body?.getReader();
      if (!reader) fail('DEPLOY_READBACK_BODY_INVALID');
      const chunks = [];
      let bytes = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!(value instanceof Uint8Array) || value.byteLength === 0) fail('DEPLOY_READBACK_BODY_INVALID');
        bytes += value.byteLength;
        if (bytes > maximumBytes) fail('DEPLOY_READBACK_TOO_LARGE');
        chunks.push(Buffer.from(value));
      }
      if (bytes === 0 || (length !== null && bytes !== Number(length))) fail('DEPLOY_READBACK_BODY_INVALID');
      return Buffer.concat(chunks, bytes);
    })()]);
  } catch (error) {
    if (stopCode) throw new GovernanceError(stopCode);
    throw error instanceof GovernanceError ? error : new GovernanceError('DEPLOY_READBACK_NETWORK_FAILED');
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
    controller.abort();
    // A failed or oversized stream must not keep reading in the background.
    // Never wait indefinitely for a custom or stalled stream's cancellation.
    try { void (reader ? reader.cancel() : response?.body?.cancel())?.catch(() => {}); } catch { /* Already closed. */ }
  }
}

function publishedJson(bytes) {
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
  catch { fail('DEPLOY_READBACK_JSON_INVALID'); }
}

function waitForPropagation(milliseconds, signal) {
  return new Promise((resolveWait, rejectWait) => {
    const abort = () => { clearTimeout(timer); signal?.removeEventListener('abort', abort); rejectWait(new GovernanceError('DEPLOY_READBACK_INTERRUPTED')); };
    const timer = setTimeout(() => { signal?.removeEventListener('abort', abort); resolveWait(); }, milliseconds);
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
  });
}

// Tests may inject HTTP transport and the propagation pause, but validation,
// endpoint paths, byte limits, retry count and credential omission stay fixed.
export async function verifyPublishedGovernance({ receipt, signal, deadline = performance.now() + READBACK_BUDGET_MS,
  fetchImpl = globalThis.fetch, pause = waitForPropagation } = {}) {
  if (!validateReceipt(receipt, { allowLocal: false })) fail('DEPLOY_READBACK_RECEIPT_INVALID');
  const context = { fetchImpl, signal, deadline: Math.min(deadline, performance.now() + READBACK_BUDGET_MS) };
  const retryable = new Set(['DEPLOY_READBACK_UNAVAILABLE', 'DEPLOY_READBACK_NETWORK_FAILED', 'DEPLOY_READBACK_TIMEOUT', 'DEPLOY_READBACK_SOURCE_MISMATCH']);
  for (let attempt = 1; attempt <= READBACK_ATTEMPTS; attempt += 1) {
    try {
      const remote = publishedJson(await readPublishedBytes('/receipt', 16 * 1024, 'application/json', context));
      if (!validateReceipt(remote, { allowLocal: false })) fail('DEPLOY_READBACK_RECEIPT_INVALID');
      for (const field of ['provider', 'commit', 'tree', 'branch', 'buildId']) {
        if (remote[field] !== receipt[field]) fail('DEPLOY_READBACK_SOURCE_MISMATCH');
      }
      if (!isDeepStrictEqual(remote, receipt)) fail('DEPLOY_READBACK_RECEIPT_MISMATCH');
      const health = publishedJson(await readPublishedBytes('/health', 2048, 'application/json', context));
      if (!isDeepStrictEqual(health, { profile: receipt.profile, scope: receipt.scope, status: 'passed',
        commit: receipt.commit, tree: receipt.tree, buildId: receipt.buildId })) fail('DEPLOY_READBACK_SOURCE_MISMATCH');
      const artifact = await readPublishedBytes('/artifacts/backlog.scored.json', MAX_ARTIFACT_BYTES, 'application/json', context);
      if (artifact.byteLength !== receipt.evidence.bytes || createHash('sha256').update(artifact).digest('hex') !== receipt.evidence.sha256) fail('DEPLOY_READBACK_ARTIFACT_MISMATCH');
      const checksum = await readPublishedBytes('/artifacts/backlog.scored.json.sha256', 128, 'text/plain', context);
      if (!checksum.equals(Buffer.from(`${receipt.evidence.sha256}\n`))) fail('DEPLOY_READBACK_CHECKSUM_MISMATCH');
      if (signal?.aborted) fail('DEPLOY_READBACK_INTERRUPTED');
      if (performance.now() >= context.deadline) fail('DEPLOY_READBACK_TIMEOUT');
      return { attempts: attempt, endpoints: 4 };
    } catch (error) {
      const failure = error instanceof GovernanceError ? error : new GovernanceError('DEPLOY_READBACK_FAILED');
      if (!retryable.has(failure.code) || attempt === READBACK_ATTEMPTS || signal?.aborted) throw failure;
      const remaining = context.deadline - performance.now();
      if (remaining <= 5_000) throw failure;
      await pause(5_000, signal);
    }
  }
  fail('DEPLOY_READBACK_FAILED');
}

export function readRegular(path, maximumBytes) {
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size < 1 || stat.size > maximumBytes) fail('DEPLOY_INPUT_INVALID');
  return readFileSync(path, 'utf8');
}

export function validateDeploymentReceipt(receipt, identity, now = Date.now()) {
  if (!validateReceipt(receipt, { allowLocal: false })) fail('DEPLOY_RECEIPT_INVALID');
  for (const field of ['provider', 'commit', 'tree', 'branch', 'buildId', 'trackedWorktreeClean']) {
    if (identity[field] !== receipt[field]) fail('DEPLOY_SOURCE_MISMATCH');
  }
  const age = now - Date.parse(receipt.completedAt);
  if (!Number.isFinite(now) || age < 0 || age > MAX_RECEIPT_AGE_MS) fail('DEPLOY_RECEIPT_EXPIRED');
  if (Date.parse(receipt.completedAt) - Date.parse(receipt.startedAt) > receipt.budgetMs + 5_000) fail('DEPLOY_RECEIPT_EXPIRED');
  return true;
}

export function deploymentEnvironment(source, identity, accountId) {
  const env = childEnvironment(source, identity);
  if (typeof source.CLOUDFLARE_API_TOKEN !== 'string' || !source.CLOUDFLARE_API_TOKEN.trim()) fail('DEPLOY_TOKEN_MISSING');
  if (source.CLOUDFLARE_ACCOUNT_ID && source.CLOUDFLARE_ACCOUNT_ID !== accountId) fail('DEPLOY_ACCOUNT_MISMATCH');
  return {
    ...env,
    CLOUDFLARE_API_TOKEN: source.CLOUDFLARE_API_TOKEN,
    CLOUDFLARE_ACCOUNT_ID: accountId,
    WRANGLER_SEND_METRICS: 'false',
    WRANGLER_LOG: 'warn',
  };
}

function verifyGenerated(root, identity) {
  const directory = join(root, '.github/cloudflare/generated');
  for (const path of [join(root, '.github'), join(root, '.github/cloudflare'), directory]) {
    const stat = lstatSync(path);
    if (!stat.isDirectory() || stat.isSymbolicLink()) fail('DEPLOY_INPUT_INVALID');
  }
  const receipt = JSON.parse(readRegular(join(directory, 'receipt.json'), 16 * 1024));
  validateDeploymentReceipt(receipt, identity);
  const artifact = readRegular(join(directory, 'backlog.scored.json'), MAX_ARTIFACT_BYTES);
  const digest = createHash('sha256').update(artifact).digest('hex');
  if (digest !== receipt.evidence.sha256 || Buffer.byteLength(artifact) !== receipt.evidence.bytes
    || readRegular(join(directory, 'backlog.scored.json.sha256'), 128) !== `${digest}\n`
    || readRegular(join(directory, 'worker.mjs'), 2048) !== GENERATED_ENTRY_SOURCE
    || readRegular(join(directory, 'artifact.mjs'), 2 * MAX_ARTIFACT_BYTES) !== `export default ${JSON.stringify(artifact)};\n`) fail('DEPLOY_ARTIFACT_MISMATCH');
  return receipt;
}

// Focused tests may inject verification; the CLI and environment cannot replace
// the production receipt/artifact verifier or the deployment command.
export async function deployGovernance({ root = ROOT, env = process.env, expectedBranch, signal, execute = runCommand, verify = verifyGenerated,
  fetchImpl = globalThis.fetch, pause = waitForPropagation, log = () => {} } = {}) {
  const deadline = performance.now() + DEPLOYMENT_BUDGET_MS;
  // Keep the original seven-minute watchdog and reserve its last 45 seconds for
  // observing the deployed bytes. A successful CLI exit is not a readback.
  const deploymentDeadline = deadline - READBACK_BUDGET_MS;
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  const watchdog = setTimeout(abort, DEPLOYMENT_BUDGET_MS - 200);
  try {
    if (signal?.aborted || !validBranch(expectedBranch)) fail('DEPLOY_ARGUMENTS_INVALID');
    const context = { root, env, expectedBranch, execute, deadline: deploymentDeadline, signal: controller.signal };
    const identity = await identifyCheckout(context);
    const receipt = verify(root, identity);
    const directory = join(root, '.github/cloudflare');
    const manifest = JSON.parse(readRegular(join(directory, 'package.json'), 16 * 1024));
    const lock = JSON.parse(readRegular(join(directory, 'package-lock.json'), 1024 * 1024));
    const webManifest = JSON.parse(readRegular(join(root, 'apps/web/package.json'), 128 * 1024));
    const config = JSON.parse(readRegular(join(directory, 'wrangler.jsonc'), 16 * 1024));
    const version = manifest.devDependencies?.wrangler;
    if (manifest.packageManager !== webManifest.packageManager || manifest.packageManager !== 'npm@11.6.2'
      || manifest.engines?.node !== '24.x' || !/^24\./.test(process.versions.node)
      || !/^\d+\.\d+\.\d+$/.test(version ?? '') || lock.packages?.['node_modules/wrangler']?.version !== version
      || lock.packages?.['']?.devDependencies?.wrangler !== version) fail('DEPLOY_TOOLCHAIN_MISMATCH');
    if (config.name !== 'tzudong-ci-governance' || config.account_id !== '7bd4c42b9400babab532b604f48a86f0'
      || config.main !== 'generated/worker.mjs') fail('DEPLOY_TARGET_MISMATCH');
    const deployEnv = deploymentEnvironment(env, identity, config.account_id);
    // Registry/install subprocesses never receive the deploy token; lifecycle
    // scripts remain disabled even for newly updated transitive dependencies.
    const installEnv = childEnvironment(env, identity);
    const commandContext = { cwd: directory, env: installEnv, deadline: deploymentDeadline, signal: controller.signal };
    const npm = await execute({ ...commandContext, command: 'npm', args: ['--version'], timeoutMs: 10_000, capture: true });
    if (npm.stdout.trim() !== '11.6.2') fail('DEPLOY_NPM_VERSION_MISMATCH');
    log('installing locked deployment tools');
    await execute({ ...commandContext, command: 'npm', args: ['ci', '--ignore-scripts', '--no-audit', '--fund=false'], timeoutMs: 240_000 });
    const installed = JSON.parse(readRegular(join(directory, 'node_modules/wrangler/package.json'), 128 * 1024));
    if (installed.version !== version) fail('DEPLOY_WRANGLER_VERSION_MISMATCH');
    const finalIdentity = await identifyCheckout(context);
    verify(root, finalIdentity);
    validateDeploymentReceipt(receipt, finalIdentity);
    log('deploying the verified governance receipt');
    await execute({ cwd: directory, env: deployEnv, deadline: deploymentDeadline, signal: controller.signal,
      command: process.execPath, args: [join(directory, 'node_modules/wrangler/bin/wrangler.js'), 'deploy', '--config', join(directory, 'wrangler.jsonc')], timeoutMs: 180_000 });
    log('verifying the published governance receipt and evidence');
    await verifyPublishedGovernance({ receipt, signal: controller.signal, deadline, fetchImpl, pause });
    log('published governance receipt and evidence verified');
    return { profile: receipt.profile, scope: receipt.scope, commit: receipt.commit, buildId: receipt.buildId, status: 'deployed' };
  } finally {
    clearTimeout(watchdog);
    signal?.removeEventListener('abort', abort);
  }
}

async function main() {
  const controller = new AbortController();
  const abort = () => controller.abort();
  process.once('SIGTERM', abort);
  process.once('SIGINT', abort);
  try {
    const args = process.argv.slice(2);
    if (args.length !== 2 || args[0] !== '--branch' || !validBranch(args[1])) fail('DEPLOY_ARGUMENTS_INVALID');
    const result = await deployGovernance({ expectedBranch: args[1], signal: controller.signal,
      log: (line) => process.stdout.write(`governance: ${line}\n`) });
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch (error) {
    process.stderr.write(`${error instanceof GovernanceError ? error.message : 'cloudflare governance: DEPLOY_FAILED'}\n`);
    process.exitCode = 1;
  } finally {
    process.removeListener('SIGTERM', abort);
    process.removeListener('SIGINT', abort);
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main();
