import { createHash } from 'node:crypto';
import {
  MAX_HOSTED_PIPELINE_ARCHIVE_BYTES,
  readHostedPipelineArchive,
} from '@/lib/admin/hosted-pipeline-archive';
import {
  MAX_HOSTED_RECEIPT_BYTES,
  parseHostedPipelineReceipt,
  type ExpectedHostedRun,
  type HostedPipelineReceiptView,
} from '@/lib/admin/hosted-pipeline-receipt';

const API_BYTE_LIMIT = 256 * 1024;
const MAX_RESPONSE_CHUNKS = 4_096;
const MAX_PAGE_ITEMS = 100;
const TOTAL_DEADLINE_MS = 8_000;
const WORKFLOW_PATH = '.github/workflows/daily-crawler.yml';
const WORKFLOW_NAME = 'Crawler';
const HEAD_SHA = /^[0-9a-f]{40}$/;
const SHA256_DIGEST = /^sha256:([0-9a-f]{64})$/;
const REPOSITORY = /^[A-Za-z0-9_.-]{1,100}[/][A-Za-z0-9_.-]{1,100}$/;
const UTC_TIMESTAMP = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.\d{1,6})?(?:Z|\+00:00)$/;

type Run = {
  id: number;
  workflow_id: number;
  run_attempt: number;
  head_sha: string;
  head_branch: 'main';
  path: typeof WORKFLOW_PATH;
  status: 'completed' | 'queued' | 'in_progress';
};

export type HostedPipelineGithubInput = {
  repository: string;
  token: string | undefined;
  latestRun: unknown;
  fetchImpl: typeof fetch;
  now: string;
  /** Shares an existing workflow-list deadline when the caller already started one. */
  signal?: AbortSignal;
  /** A lower limit is useful for deterministic timeout fixtures; never extends eight seconds. */
  deadlineMs?: number;
};

export type HostedPipelineGithubResult =
  | { status: 'artifact_bound'; view: HostedPipelineReceiptView }
  | { status: 'unavailable' | 'invalid' };

class InvalidMetadata extends Error {}
class Unavailable extends Error {}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function positiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

function utcTime(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  const match = UTC_TIMESTAMP.exec(value);
  if (!match) return null;
  const time = Date.parse(value);
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 19) === match[1]
    ? time : null;
}

function exactRun(value: unknown): Run | null {
  if (!record(value) || !positiveInteger(value.id) || !positiveInteger(value.workflow_id)
    || !positiveInteger(value.run_attempt)
    || typeof value.head_sha !== 'string' || !HEAD_SHA.test(value.head_sha)
    || value.head_branch !== 'main' || value.path !== WORKFLOW_PATH
    || !['completed', 'queued', 'in_progress'].includes(value.status as string)) return null;
  return value as Run;
}

function completePage(value: unknown, key: 'jobs' | 'artifacts'): Record<string, unknown>[] {
  if (!record(value) || !Number.isSafeInteger(value.total_count)
    || (value.total_count as number) < 1 || (value.total_count as number) > MAX_PAGE_ITEMS
    || !Array.isArray(value[key]) || value[key].length !== value.total_count) {
    throw new InvalidMetadata();
  }
  if (!value[key].every(record)) throw new InvalidMetadata();
  return value[key] as Record<string, unknown>[];
}

function jobWindow(value: unknown, run: Run): { started: number; completed: number } {
  const jobs = completePage(value, 'jobs');
  const ids = new Set<number>();
  let hosted: { started: number; completed: number } | null = null;
  for (const job of jobs) {
    const start = utcTime(job.started_at);
    const end = utcTime(job.completed_at);
    if (!positiveInteger(job.id) || ids.has(job.id) || job.run_id !== run.id
      || job.run_attempt !== run.run_attempt || job.head_sha !== run.head_sha
      || job.status !== 'completed') {
      throw new InvalidMetadata();
    }
    ids.add(job.id);
    const unstarted = job.started_at === null && job.completed_at === null
      && (job.conclusion === 'skipped' || job.conclusion === 'cancelled');
    if (job.name === 'hosted-pending-apply') {
      if (hosted || start === null || end === null || end < start || job.conclusion === 'skipped') {
        throw new InvalidMetadata();
      }
      hosted = { started: start, completed: end };
    } else if (!unstarted && (start === null || end === null || end < start)) {
      throw new InvalidMetadata();
    }
  }
  if (!hosted) throw new InvalidMetadata();
  return hosted;
}

function exactArtifact(value: unknown, run: Run, now: number): { id: number; digest: string } {
  const artifacts = completePage(value, 'artifacts');
  const expectedName = `hosted-pipeline-execution-${run.id}-${run.run_attempt}`;
  const matches = artifacts.filter(artifact => artifact.name === expectedName);
  if (matches.length !== 1) throw new Unavailable();
  const artifact = matches[0];
  const owner = artifact.workflow_run;
  const digest = typeof artifact.digest === 'string' ? SHA256_DIGEST.exec(artifact.digest) : null;
  const expiresAt = utcTime(artifact.expires_at);
  if (!positiveInteger(artifact.id) || artifact.expired !== false
    || expiresAt === null || expiresAt <= now
    || !Number.isSafeInteger(artifact.size_in_bytes) || (artifact.size_in_bytes as number) <= 0
    || (artifact.size_in_bytes as number) > MAX_HOSTED_PIPELINE_ARCHIVE_BYTES
    || !record(owner) || owner.id !== run.id || owner.head_sha !== run.head_sha
    || owner.head_branch !== 'main' || !digest) throw new InvalidMetadata();
  return { id: artifact.id, digest: digest[1] };
}

function signedArtifactUrl(location: string | null): string | null {
  if (!location) return null;
  try {
    const url = new URL(location);
    const host = url.hostname.toLowerCase();
    if (url.protocol !== 'https:' || url.username || url.password || url.port
      || url.hash || url.pathname === '/'
      || !(host.endsWith('.actions.githubusercontent.com')
        || /^productionresultssa[0-9]+\.blob\.core\.windows\.net$/.test(host))) return null;
    return url.toString();
  } catch {
    return null;
  }
}

async function beforeDeadline<T>(work: () => Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) throw new Unavailable();
  return new Promise<T>((resolve, reject) => {
    const abort = () => { signal.removeEventListener('abort', abort); reject(new Unavailable()); };
    signal.addEventListener('abort', abort, { once: true });
    Promise.resolve().then(work).then(
      value => { signal.removeEventListener('abort', abort); resolve(value); },
      error => { signal.removeEventListener('abort', abort); reject(error); },
    );
  });
}

function discardResponseBody(response: Response): void {
  try {
    // Do not wait for a remote stream's cancel handler beyond the shared deadline.
    void response.body?.cancel().catch(() => undefined);
  } catch {
    // The original HTTP or integrity failure remains the only public result.
  }
}

async function readBoundedBytes(response: Response, limit: number, signal: AbortSignal): Promise<Uint8Array> {
  const advertised = response.headers.get('content-length');
  if (advertised !== null && (!/^[0-9]+$/.test(advertised) || Number(advertised) > limit)) {
    discardResponseBody(response);
    throw new InvalidMetadata();
  }
  if (!response.body) throw new InvalidMetadata();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const next = await beforeDeadline(() => reader.read(), signal);
      if (signal.aborted) throw new Unavailable();
      if (next.done) break;
      if (!(next.value instanceof Uint8Array) || next.value.byteLength === 0
        || chunks.length >= MAX_RESPONSE_CHUNKS) throw new InvalidMetadata();
      length += next.value.byteLength;
      if (length > limit) throw new InvalidMetadata();
      chunks.push(next.value);
    }
    if (length === 0) throw new InvalidMetadata();
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return bytes;
  } catch (error) {
    try { void reader.cancel().catch(() => undefined); } catch { /* Keep the original failure. */ }
    throw error;
  } finally {
    reader.releaseLock();
  }
}

/** Reusable 256 KiB Actions API JSON read; caller owns HTTP status and error handling. */
export async function readBoundedGithubJson(response: Response, signal: AbortSignal): Promise<unknown> {
  const bytes = await readBoundedBytes(response, API_BYTE_LIMIT, signal);
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch {
    throw new InvalidMetadata();
  }
}

/** Binds an exact completed Actions attempt to its bounded artifact and producer receipt. */
export async function readHostedPipelineGithub(
  input: HostedPipelineGithubInput,
): Promise<HostedPipelineGithubResult> {
  if (!input || typeof input.repository !== 'string' || !REPOSITORY.test(input.repository)
    || input.repository.split('/').some(part => part === '.' || part === '..')
    || typeof input.token !== 'string' || !input.token.trim()
    || typeof input.fetchImpl !== 'function') return { status: 'unavailable' };
  const suppliedRun = input.latestRun;
  if (!record(suppliedRun) || ['id', 'workflow_id', 'run_attempt', 'head_sha', 'head_branch',
    'path', 'status'].some(key => !(key in suppliedRun))) {
    return { status: 'unavailable' };
  }
  const latest = exactRun(input.latestRun);
  const now = utcTime(input.now);
  if (!latest || now === null) return { status: 'invalid' };
  if (latest.status !== 'completed') return { status: 'unavailable' };
  if (input.signal?.aborted) return { status: 'unavailable' };
  const controller = new AbortController();
  const abortWithCaller = () => controller.abort();
  input.signal?.addEventListener('abort', abortWithCaller, { once: true });
  if (input.signal?.aborted) controller.abort();
  const deadline = Number.isInteger(input.deadlineMs) && input.deadlineMs! > 0
    ? Math.min(input.deadlineMs!, TOTAL_DEADLINE_MS) : TOTAL_DEADLINE_MS;
  const timer = setTimeout(() => controller.abort(), deadline);
  const apiRoot = `https://api.github.com/repos/${input.repository}`;
  const runRoot = `${apiRoot}/actions/runs/${latest.id}`;
  const apiHeaders = {
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${input.token}`,
    'X-GitHub-Api-Version': '2026-03-10',
  };
  const apiGet = async (url: string): Promise<Response> => {
    const response = await beforeDeadline(() => input.fetchImpl(url, {
      method: 'GET', headers: apiHeaders, redirect: 'manual', credentials: 'omit',
      cache: 'no-store', signal: controller.signal,
    }), controller.signal);
    if (response.status !== 200 || response.redirected) {
      discardResponseBody(response);
      throw new Unavailable();
    }
    return response;
  };
  const apiJson = async (url: string, singlePage = false): Promise<unknown> => {
    const response = await apiGet(url);
    if (singlePage && response.headers.has('link')) {
      discardResponseBody(response);
      throw new InvalidMetadata();
    }
    return readBoundedGithubJson(response, controller.signal);
  };

  try {
    const actual = exactRun(await apiJson(runRoot));
    if (actual && actual.status !== 'completed') throw new Unavailable();
    if (!actual || actual.id !== latest.id || actual.workflow_id !== latest.workflow_id
      || actual.run_attempt !== latest.run_attempt
      || actual.head_sha !== latest.head_sha) throw new InvalidMetadata();
    const window = jobWindow(await apiJson(
      `${runRoot}/attempts/${actual.run_attempt}/jobs?per_page=${MAX_PAGE_ITEMS}&page=1`,
      true,
    ), actual);
    const artifactName = `hosted-pipeline-execution-${actual.id}-${actual.run_attempt}`;
    const artifact = exactArtifact(await apiJson(
      `${runRoot}/artifacts?per_page=${MAX_PAGE_ITEMS}&page=1&name=${encodeURIComponent(artifactName)}`,
      true,
    ), actual, now);
    const redirect = await beforeDeadline(() => input.fetchImpl(
      `${apiRoot}/actions/artifacts/${artifact.id}/zip`,
      { method: 'GET', headers: apiHeaders, redirect: 'manual', credentials: 'omit',
        cache: 'no-store', signal: controller.signal },
    ), controller.signal);
    if (redirect.status !== 302 || redirect.redirected) {
      discardResponseBody(redirect);
      throw new Unavailable();
    }
    const signedUrl = signedArtifactUrl(redirect.headers.get('location'));
    discardResponseBody(redirect);
    if (!signedUrl) throw new InvalidMetadata();
    const archiveResponse = await beforeDeadline(() => input.fetchImpl(signedUrl, {
      method: 'GET', redirect: 'manual', credentials: 'omit', cache: 'no-store',
      signal: controller.signal,
    }), controller.signal);
    if (archiveResponse.status !== 200 || archiveResponse.redirected) {
      discardResponseBody(archiveResponse);
      throw new Unavailable();
    }
    const zip = await readBoundedBytes(archiveResponse, MAX_HOSTED_PIPELINE_ARCHIVE_BYTES, controller.signal);
    if (createHash('sha256').update(zip).digest('hex') !== artifact.digest) {
      throw new InvalidMetadata();
    }
    const archive = readHostedPipelineArchive(zip);
    if (!archive.ok || archive.bytes.byteLength > MAX_HOSTED_RECEIPT_BYTES) {
      throw new InvalidMetadata();
    }
    const expected: ExpectedHostedRun = {
      runId: String(actual.id),
      runAttempt: String(actual.run_attempt),
      headSha: actual.head_sha,
      workflow: WORKFLOW_NAME,
      ref: 'refs/heads/main',
      workflowStartedAt: new Date(window.started).toISOString(),
      workflowCompletedAt: new Date(window.completed).toISOString(),
      now: new Date(now).toISOString(),
    };
    const parsed = parseHostedPipelineReceipt(archive.bytes, expected);
    return parsed.status === 'metadata_matched'
      ? { status: 'artifact_bound', view: parsed.view }
      : parsed;
  } catch (error) {
    controller.abort();
    return { status: error instanceof InvalidMetadata ? 'invalid' : 'unavailable' };
  } finally {
    clearTimeout(timer);
    input.signal?.removeEventListener('abort', abortWithCaller);
  }
}
