#!/usr/bin/env node

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 25;
const DEFAULT_DEADLINE_MS = 10_000;
const MIN_DEADLINE_MS = 3_001;
const MAX_DEADLINE_MS = 25_000;
const MAX_RESPONSE_BYTES = 2_048;
const WORKER_PATH = '/api/internal/account-deletion';
const WORKER_STATUSES = new Set(['completed', 'partial', 'busy', 'held', 'retry']);
const WORKER_PHASES = new Set(['session', 'storage', 'auth']);
const REQUEST_HASH_RE = /^[0-9a-f]{64}$/;
const exactKeys = (value, expected) => (
  Object.keys(value).length === expected.length
  && expected.every((key) => Object.hasOwn(value, key))
);

const boundedInteger = (value, minimum, maximum) => (
  typeof value === 'number' && Number.isSafeInteger(value) && value >= minimum && value <= maximum
    ? value
    : null
);

const emptySummary = () => ({
  attempted: 0,
  completed: 0,
  partial: 0,
  failed: 0,
  unknown: 0,
  empty: 0,
  diagnostic: 'not_run',
});

export function parseArgs(argv) {
  const options = { limit: DEFAULT_LIMIT, deadlineMs: DEFAULT_DEADLINE_MS };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const value = argv[index + 1];
    if ((argument !== '--limit' && argument !== '--deadline-ms') || value === undefined) return null;
    const numeric = Number(value);
    if (!Number.isSafeInteger(numeric)) return null;
    if (argument === '--limit') {
      if (boundedInteger(numeric, 1, MAX_LIMIT) === null) return null;
      options.limit = numeric;
    } else {
      if (boundedInteger(numeric, MIN_DEADLINE_MS, MAX_DEADLINE_MS) === null) return null;
      options.deadlineMs = numeric;
    }
    index += 1;
  }
  return options;
}

export function schedulerConfiguration(env) {
  const workerUrl = env.ACCOUNT_DELETION_WORKER_URL;
  const capability = env.ACCOUNT_DELETION_WORKER_CAPABILITY;
  if (typeof workerUrl !== 'string' || typeof capability !== 'string' || Buffer.byteLength(capability, 'utf8') < 32) {
    return null;
  }
  try {
    const parsed = new URL(workerUrl);
    return parsed.protocol === 'https:'
      && !parsed.username
      && !parsed.password
      && parsed.pathname === WORKER_PATH
      && !parsed.search
      && !parsed.hash
      ? { workerUrl: parsed, capability }
      : null;
  } catch {
    return null;
  }
}

async function boundedResponseText(stream, maxBytes) {
  if (!stream) return null;
  const reader = stream.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
    return new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks));
  } catch {
    return null;
  } finally {
    reader.releaseLock();
  }
}

const SCHEDULER_DIAGNOSTICS = new Set([
  'config_invalid',
  'queue_empty',
  'completed',
  'partial',
  'http_401',
  'http_403',
  'http_4xx',
  'http_5xx',
  'http_other',
  'redirected',
  'content_type_invalid',
  'response_body_invalid',
  'response_json_invalid',
  'response_shape_invalid',
  'transport_error',
]);

const responseDiagnostic = (response) => {
  if (response.redirected === true) return 'redirected';
  if (response.status === 401) return 'http_401';
  if (response.status === 403) return 'http_403';
  if (response.status >= 500) return 'http_5xx';
  if (response.status >= 400) return 'http_4xx';
  if (response.status !== 200 && response.status !== 409 && response.status !== 423) return 'http_other';
  return response.headers.get('content-type')?.toLowerCase().startsWith('application/json')
    ? null
    : 'content_type_invalid';
};

function responseStatus(responseStatus, body) {
  if (responseStatus === 409 || responseStatus === 423) return 'partial';
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return responseStatus >= 500 ? 'unknown' : 'failed';
  }
  const status = body.status;
  const counts = body.counts;
  const validCounts = counts
    && typeof counts === 'object'
    && !Array.isArray(counts)
    && boundedInteger(counts.workItems, 0, 10_000) !== null
    && boundedInteger(counts.providerProofs, 0, 10_000) !== null;
  if (status === 'empty') {
    return responseStatus === 200
      && exactKeys(body, ['status', 'code', 'counts'])
      && body.code === 'account_deletion_queue_empty'
      && validCounts
      ? 'empty'
      : 'unknown';
  }
  if (!WORKER_STATUSES.has(status)
    || !exactKeys(body, ['status', 'phase', 'requestHash', 'counts'])
    || !WORKER_PHASES.has(body.phase)
    || !REQUEST_HASH_RE.test(body.requestHash)
    || !validCounts) {
    return responseStatus >= 500 ? 'unknown' : 'failed';
  }
  return status === 'completed' && responseStatus === 200 ? 'completed' : 'partial';
}

async function claimAndRun(configuration, deadlineMs, fetchImpl) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), deadlineMs + 5_000);
  try {
    const response = await fetchImpl(configuration.workerUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Account-Deletion-Worker-Capability': configuration.capability,
        'Cache-Control': 'no-store',
      },
      body: JSON.stringify({ mode: 'claim_next', deadlineMs }),
      cache: 'no-store',
      redirect: 'error',
      signal: controller.signal,
    });
    const diagnostic = responseDiagnostic(response);
    if (diagnostic) {
      return { status: response.status >= 500 ? 'unknown' : 'failed', diagnostic };
    }
    const text = await boundedResponseText(response.body, MAX_RESPONSE_BYTES);
    if (!text) return { status: 'failed', diagnostic: 'response_body_invalid' };
    try {
      const status = responseStatus(response.status, JSON.parse(text));
      return {
        status,
        diagnostic: status === 'empty' ? 'queue_empty' : status === 'completed' ? 'completed' : status === 'partial' ? 'partial' : 'response_shape_invalid',
      };
    } catch {
      return { status: 'failed', diagnostic: 'response_json_invalid' };
    }
  } catch {
    return { status: 'unknown', diagnostic: 'transport_error' };
  } finally {
    clearTimeout(timeout);
  }
}

export function summaryCode(summary) {
  if (summary.unknown > 0) return 'unknown';
  if (summary.failed > 0) return 'failed';
  if (summary.partial > 0) return 'partial';
  if (summary.completed > 0) return 'completed';
  return 'empty';
}

export function formatSummary(summary) {
  const diagnostic = SCHEDULER_DIAGNOSTICS.has(summary.diagnostic) ? summary.diagnostic : 'transport_error';
  return `code=${summaryCode(summary)} diagnostic=${diagnostic} attempted=${summary.attempted} completed=${summary.completed} partial=${summary.partial} failed=${summary.failed} unknown=${summary.unknown} empty=${summary.empty}\n`;
}

export async function runAccountDeletionWorkerScheduler({
  argv = process.argv.slice(2),
  env = process.env,
  fetchImpl = fetch,
  write = (line) => process.stdout.write(line),
} = {}) {
  const summary = emptySummary();
  const options = parseArgs(argv);
  const configuration = schedulerConfiguration(env);
  if (!options || !configuration || typeof fetchImpl !== 'function') {
    summary.failed = 1;
    summary.diagnostic = 'config_invalid';
    write(formatSummary(summary));
    return summary;
  }

  for (let index = 0; index < options.limit; index += 1) {
    const result = await claimAndRun(configuration, options.deadlineMs, fetchImpl);
    summary.diagnostic = result.diagnostic;
    if (result.status === 'empty') {
      summary.empty += 1;
      break;
    }
    summary.attempted += 1;
    summary[result.status] += 1;
    if (result.status !== 'completed') break;
  }

  write(formatSummary(summary));
  return summary;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const summary = await runAccountDeletionWorkerScheduler();
  if (summaryCode(summary) !== 'completed' && summaryCode(summary) !== 'empty') process.exitCode = 1;
}
