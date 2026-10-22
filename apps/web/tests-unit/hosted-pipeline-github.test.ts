import { createHash } from 'node:crypto';
import { describe, expect, test } from 'bun:test';
import { readHostedPipelineGithub } from '../lib/admin/hosted-pipeline-github';

const runId = 39337448241;
const attempt = 2;
const sha = 'a'.repeat(40);
const signedUrl = 'https://productionresultssa1.blob.core.windows.net/actions-results/signed?sig=private';
const latestRun = {
  id: runId, workflow_id: 227106272, run_attempt: attempt, head_sha: sha, head_branch: 'main',
  path: '.github/workflows/daily-crawler.yml', name: 'Crawler · main', status: 'completed',
};
const receipt = {
  schemaVersion: 1,
  executionId: '22222222-2222-4222-8222-222222222222',
  runnerSha256: 'b'.repeat(64),
  source: 'github_actions',
  githubMetadataStatus: 'metadata_available',
  github: { runId: String(runId), runAttempt: String(attempt),
    headSha: sha, workflow: 'Crawler', ref: 'refs/heads/main' },
  startedAt: '2026-10-20T00:01:00Z',
  finishedAt: '2026-10-20T00:03:00Z',
  generatedAt: '2026-10-20T00:03:01Z',
  elapsedMs: 120000,
  limit: 3, newVideoLimit: 3,
  dryRun: false, reviewRequested: false, reviewConfirmed: false,
  stage: 'finished', state: 'execution_completed', exitCode: 0,
  evaluateExit: 0, applyExit: 0, publicationVerified: false,
};

function crc32(bytes: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function zipReceipt(value: unknown): Buffer {
  const name = Buffer.from('hosted-run.json');
  const data = Buffer.from(JSON.stringify(value));
  const crc = crc32(data);
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt32LE(crc, 14);
  local.writeUInt32LE(data.length, 18);
  local.writeUInt32LE(data.length, 22);
  local.writeUInt16LE(name.length, 26);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 4);
  central.writeUInt16LE(20, 6);
  central.writeUInt32LE(crc, 16);
  central.writeUInt32LE(data.length, 20);
  central.writeUInt32LE(data.length, 24);
  central.writeUInt16LE(name.length, 28);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(1, 8);
  eocd.writeUInt16LE(1, 10);
  eocd.writeUInt32LE(central.length + name.length, 12);
  eocd.writeUInt32LE(local.length + name.length + data.length, 16);
  return Buffer.concat([local, name, data, central, name, eocd]);
}

function fixture(options: {
  run?: Record<string, unknown>;
  jobs?: Record<string, unknown>;
  artifacts?: Record<string, unknown>;
  receipt?: Record<string, unknown>;
  zip?: Buffer;
  redirect?: string;
  failAt?: number;
  failStatus?: number;
  failResponse?: Response;
  delayMs?: number;
  jobsLink?: string;
  artifactsLink?: string;
} = {}) {
  const zip = options.zip ?? zipReceipt(options.receipt ?? receipt);
  const jobs = options.jobs ?? { total_count: 2, jobs: [
    { id: 11, run_id: runId, run_attempt: attempt, head_sha: sha, name: 'daily-compute',
      status: 'completed', started_at: '2026-10-20T00:00:00Z', completed_at: '2026-10-20T00:04:00Z' },
    { id: 12, run_id: runId, run_attempt: attempt, head_sha: sha, name: 'hosted-pending-apply',
      status: 'completed', started_at: '2026-10-20T00:00:30Z', completed_at: '2026-10-20T00:05:00Z' },
  ] };
  const artifacts = options.artifacts ?? { total_count: 1, artifacts: [{
    id: 42, name: `hosted-pipeline-execution-${runId}-${attempt}`,
    size_in_bytes: zip.length, digest: `sha256:${createHash('sha256').update(zip).digest('hex')}`,
    expired: false, expires_at: '2026-10-21T00:00:00Z',
    workflow_run: { id: runId, head_sha: sha, head_branch: 'main' },
  }] };
  const calls: { url: string; init: RequestInit }[] = [];
  const fetchImpl: typeof fetch = async (url, init) => {
    calls.push({ url: String(url), init: init ?? {} });
    if (options.delayMs) await new Promise(resolve => setTimeout(resolve, options.delayMs));
    if (options.failAt === calls.length) return options.failResponse
      ?? new Response(null, { status: options.failStatus ?? 403 });
    if (calls.length === 1) return Response.json(options.run ?? { ...latestRun, updated_at: '2026-10-20T23:59:00Z' });
    if (calls.length === 2) return Response.json(jobs, { headers: options.jobsLink ? { link: options.jobsLink } : undefined });
    if (calls.length === 3) return Response.json(artifacts, { headers: options.artifactsLink ? { link: options.artifactsLink } : undefined });
    if (calls.length === 4) return new Response(null, { status: 302, headers: { location: options.redirect ?? signedUrl } });
    if (calls.length === 5) return new Response(zip);
    throw new Error('unexpected request');
  };
  return {
    calls,
    input: {
      repository: 'owner/tzudong', token: 'configured-token', latestRun, fetchImpl,
      now: '2026-10-20T00:10:00Z',
    },
  };
}

describe('bounded GitHub hosted pipeline receipt reader', () => {
  test('binds five exact GETs to one completed attempt and returns only the receipt view', async () => {
    const { calls, input } = fixture();
    const result = await readHostedPipelineGithub(input);
    expect(result.status).toBe('artifact_bound');
    if (result.status === 'artifact_bound') {
      expect(result.view).toMatchObject({
        runId: String(runId), runAttempt: String(attempt), state: 'execution_completed',
        workflow: 'Crawler', publicationVerified: false,
      });
      expect(JSON.stringify(result)).not.toContain('configured-token');
      expect(JSON.stringify(result)).not.toContain('signed?sig');
    }
    expect(calls).toHaveLength(5);
    expect(calls.map(call => new URL(call.url).pathname)).toEqual([
      `/repos/owner/tzudong/actions/runs/${runId}`,
      `/repos/owner/tzudong/actions/runs/${runId}/attempts/${attempt}/jobs`,
      `/repos/owner/tzudong/actions/runs/${runId}/artifacts`,
      '/repos/owner/tzudong/actions/artifacts/42/zip',
      '/actions-results/signed',
    ]);
    expect(calls[1].url).toContain('per_page=100&page=1');
    expect(calls[2].url).toContain('per_page=100&page=1');
    expect(new URL(calls[2].url).searchParams.get('name'))
      .toBe(`hosted-pipeline-execution-${runId}-${attempt}`);
    expect(new Headers(calls[0].init.headers).get('x-github-api-version')).toBe('2026-03-10');
    expect(calls.slice(0, 4).every(call => new Headers(call.init.headers).get('authorization') === 'Bearer configured-token')).toBe(true);
    expect(new Headers(calls[4].init.headers).has('authorization')).toBe(false);
    expect(calls.every(call => call.init.redirect === 'manual' && call.init.credentials === 'omit'
      && call.init.signal === calls[0].init.signal)).toBe(true);
  });

  test('rejects run identity, incomplete attempt jobs, and receipt outside actual job times', async () => {
    for (const status of ['queued', 'in_progress']) {
      const waiting = fixture();
      expect(await readHostedPipelineGithub({ ...waiting.input, latestRun: { ...latestRun, status } }))
        .toEqual({ status: 'unavailable' });
      expect(waiting.calls).toHaveLength(0);
    }
    const wrongRun = fixture({ run: { ...latestRun, path: '.github/workflows/other.yml' } });
    expect(await readHostedPipelineGithub(wrongRun.input)).toEqual({ status: 'invalid' });
    expect(wrongRun.calls).toHaveLength(1);
    const wrongWorkflow = fixture({ run: { ...latestRun, workflow_id: latestRun.workflow_id + 1 } });
    expect(await readHostedPipelineGithub(wrongWorkflow.input)).toEqual({ status: 'invalid' });
    expect(wrongWorkflow.calls).toHaveLength(1);

    const missingPage = fixture({ jobs: { total_count: 3, jobs: [
      { id: 12, run_id: runId, run_attempt: attempt, head_sha: sha, name: 'hosted-pending-apply',
        status: 'completed', started_at: '2026-10-20T00:00:00Z', completed_at: '2026-10-20T00:05:00Z' },
    ] } });
    expect(await readHostedPipelineGithub(missingPage.input)).toEqual({ status: 'invalid' });
    expect(missingPage.calls).toHaveLength(2);

    const linkedJobs = fixture({ jobsLink: '<https://api.github.com/next>; rel="next"' });
    expect(await readHostedPipelineGithub(linkedJobs.input)).toEqual({ status: 'invalid' });
    expect(linkedJobs.calls).toHaveLength(2);

    const wrongAttempt = fixture({ jobs: { total_count: 1, jobs: [
      { id: 12, run_id: runId, run_attempt: attempt + 1, head_sha: sha, name: 'hosted-pending-apply',
        status: 'completed', started_at: '2026-10-20T00:00:00Z', completed_at: '2026-10-20T00:05:00Z' },
    ] } });
    expect(await readHostedPipelineGithub(wrongAttempt.input)).toEqual({ status: 'invalid' });
    const bounded = fixture({ jobs: { total_count: 2, jobs: [
      { id: 11, run_id: runId, run_attempt: attempt, head_sha: sha, name: 'daily-compute',
        status: 'completed', started_at: '2026-10-20T00:00:00Z', completed_at: '2026-10-20T00:05:00Z' },
      { id: 12, run_id: runId, run_attempt: attempt, head_sha: sha, name: 'hosted-pending-apply',
        status: 'completed', started_at: '2026-10-20T00:02:00Z', completed_at: '2026-10-20T00:04:00Z' },
    ] } });
    expect(await readHostedPipelineGithub(bounded.input)).toEqual({ status: 'invalid' });
  });

  test('accepts terminal unstarted sibling jobs without widening the hosted job window', async () => {
    const current = fixture({ jobs: { total_count: 3, jobs: [
      { id: 11, run_id: runId, run_attempt: attempt, head_sha: sha, name: 'daily-compute',
        status: 'completed', conclusion: 'skipped', started_at: null, completed_at: null },
      { id: 12, run_id: runId, run_attempt: attempt, head_sha: sha, name: 'hosted-pending-apply',
        status: 'completed', conclusion: 'success', started_at: '2026-10-20T00:00:30Z',
        completed_at: '2026-10-20T00:04:00Z' },
      { id: 13, run_id: runId, run_attempt: attempt, head_sha: sha, name: 'daily-publish',
        status: 'completed', conclusion: 'cancelled', started_at: null, completed_at: null },
    ] } });
    expect((await readHostedPipelineGithub(current.input)).status).toBe('artifact_bound');
    const malformed = fixture({ jobs: { total_count: 2, jobs: [
      { id: 11, run_id: runId, run_attempt: attempt, head_sha: sha, name: 'daily-compute',
        status: 'completed', conclusion: 'success', started_at: null, completed_at: null },
      { id: 12, run_id: runId, run_attempt: attempt, head_sha: sha, name: 'hosted-pending-apply',
        status: 'completed', conclusion: 'success', started_at: '2026-10-20T00:00:30Z',
        completed_at: '2026-10-20T00:04:00Z' },
    ] } });
    expect(await readHostedPipelineGithub(malformed.input)).toEqual({ status: 'invalid' });
  });

  test('does not admit duplicate, expired, wrong-owner, oversized, or wrong-digest artifact', async () => {
    const linkedArtifacts = fixture({ artifactsLink: '<https://api.github.com/next>; rel="next"' });
    expect(await readHostedPipelineGithub(linkedArtifacts.input)).toEqual({ status: 'invalid' });
    expect(linkedArtifacts.calls).toHaveLength(3);
    const baseZip = zipReceipt(receipt);
    const artifact = {
      id: 42, name: `hosted-pipeline-execution-${runId}-${attempt}`,
      size_in_bytes: baseZip.length, digest: `sha256:${createHash('sha256').update(baseZip).digest('hex')}`,
      expired: false, expires_at: '2026-10-21T00:00:00Z',
      workflow_run: { id: runId, head_sha: sha, head_branch: 'main' },
    };
    for (const [value, expected] of [
      [{ total_count: 2, artifacts: [artifact, { ...artifact, id: 43 }] }, 'unavailable'],
      [{ total_count: 1, artifacts: [{ ...artifact, expired: true }] }, 'invalid'],
      [{ total_count: 1, artifacts: [{ ...artifact, workflow_run: { ...artifact.workflow_run, id: runId + 1 } }] }, 'invalid'],
      [{ total_count: 1, artifacts: [{ ...artifact, size_in_bytes: 256 * 1024 + 1 }] }, 'invalid'],
      [{ total_count: 1, artifacts: [{ ...artifact, digest: `sha256:${'0'.repeat(64)}` }] }, 'invalid'],
    ] as const) {
      const current = fixture({ artifacts: value });
      expect((await readHostedPipelineGithub(current.input)).status).toBe(expected);
    }
  });

  test('rejects hostile redirect and never retries configured-token HTTP errors anonymously', async () => {
    const denied = fixture({ failAt: 1, failStatus: 403 });
    expect(await readHostedPipelineGithub(denied.input)).toEqual({ status: 'unavailable' });
    expect(denied.calls).toHaveLength(1);
    const hostile = fixture({ redirect: 'https://attacker.example/artifact?token=private' });
    expect(await readHostedPipelineGithub(hostile.input)).toEqual({ status: 'invalid' });
    expect(hostile.calls).toHaveLength(4);
  });

  test('cancels an HTTP error body without waiting on its remote cancel handler', async () => {
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      cancel() { cancelled = true; return new Promise<void>(() => undefined); },
    });
    const current = fixture({ failAt: 1, failResponse: new Response(stream, { status: 403 }) });
    const result = await Promise.race([
      readHostedPipelineGithub({ ...current.input, deadlineMs: 40 }),
      new Promise<'timed_out'>(resolve => setTimeout(() => resolve('timed_out'), 100)),
    ]);
    expect(result).toEqual({ status: 'unavailable' });
    expect(cancelled).toBe(true);
    expect(current.calls).toHaveLength(1);
    expect(current.calls[0].init.signal?.aborted).toBe(true);
  });

  test('enforces actual stream and receipt bytes plus one total timeout across GETs', async () => {
    const oversizedReceipt = fixture({ receipt: { ...receipt, padding: 'x'.repeat(4_100) } });
    expect(await readHostedPipelineGithub(oversizedReceipt.input)).toEqual({ status: 'invalid' });
    const oversizedZip = fixture({ zip: Buffer.alloc(256 * 1024 + 1), artifacts: {
      total_count: 1, artifacts: [{
        id: 42, name: `hosted-pipeline-execution-${runId}-${attempt}`,
        size_in_bytes: 100, digest: `sha256:${'0'.repeat(64)}`,
        expired: false, expires_at: '2026-10-21T00:00:00Z',
        workflow_run: { id: runId, head_sha: sha, head_branch: 'main' },
      }],
    } });
    expect(await readHostedPipelineGithub(oversizedZip.input)).toEqual({ status: 'invalid' });
    expect(oversizedZip.calls).toHaveLength(5);
    const oversizedApi = fixture({ run: { ...latestRun, padding: 'x'.repeat(256 * 1024) } });
    expect(await readHostedPipelineGithub(oversizedApi.input)).toEqual({ status: 'invalid' });
    expect(oversizedApi.calls).toHaveLength(1);
    const slow = fixture({ delayMs: 15 });
    expect(await readHostedPipelineGithub({ ...slow.input, deadlineMs: 35 })).toEqual({ status: 'unavailable' });
    expect(slow.calls.length).toBeLessThan(5);
  });

  test('rejects empty chunks and excessive small chunks, cancelling both streams', async () => {
    let emptyCancelled = false;
    const empty = new ReadableStream<Uint8Array>({
      pull(stream) { stream.enqueue(new Uint8Array()); },
      cancel() { emptyCancelled = true; },
    });
    const emptyFixture = fixture();
    expect(await readHostedPipelineGithub({ ...emptyFixture.input,
      fetchImpl: async () => new Response(empty),
    })).toEqual({ status: 'invalid' });
    expect(emptyCancelled).toBe(true);

    let chunks = 0;
    let chunkLimitCancelled = false;
    const tiny = new ReadableStream<Uint8Array>({
      pull(stream) { chunks += 1; stream.enqueue(new Uint8Array([32])); },
      cancel() { chunkLimitCancelled = true; },
    });
    const tinyFixture = fixture();
    expect(await readHostedPipelineGithub({ ...tinyFixture.input,
      fetchImpl: async () => new Response(tiny),
    })).toEqual({ status: 'invalid' });
    expect(chunks).toBeGreaterThan(4_096);
    expect(chunkLimitCancelled).toBe(true);
  });

  test('accepts a bounded signed ZIP delivered in small nonempty chunks', async () => {
    const zip = zipReceipt(receipt);
    const current = fixture({ zip });
    const originalFetch = current.input.fetchImpl;
    const fetchImpl: typeof fetch = async (url, init) => {
      const response = await originalFetch(url, init);
      if (current.calls.length !== 5) return response;
      return new Response(new ReadableStream<Uint8Array>({
        start(stream) {
          for (let offset = 0; offset < zip.length; offset += 13) {
            stream.enqueue(zip.subarray(offset, offset + 13));
          }
          stream.close();
        },
      }));
    };
    expect((await readHostedPipelineGithub({ ...current.input, fetchImpl })).status).toBe('artifact_bound');
    expect(current.calls).toHaveLength(5);
  });

  test('reuses the caller deadline and leaves absent legacy metadata unavailable', async () => {
    const tokenless = fixture();
    expect(await readHostedPipelineGithub({ ...tokenless.input, token: undefined }))
      .toEqual({ status: 'unavailable' });
    expect(tokenless.calls).toHaveLength(0);
    const legacy = fixture();
    expect(await readHostedPipelineGithub({ ...legacy.input, latestRun: { id: runId, status: 'completed' } }))
      .toEqual({ status: 'unavailable' });
    expect(legacy.calls).toHaveLength(0);
    const controller = new AbortController();
    const slow = fixture({ delayMs: 15 });
    setTimeout(() => controller.abort(), 20);
    expect(await readHostedPipelineGithub({ ...slow.input, signal: controller.signal }))
      .toEqual({ status: 'unavailable' });
    expect(slow.calls.length).toBeLessThan(5);
  });

  test('stops a stalled signed ZIP stream when the shared caller signal aborts', async () => {
    const current = fixture();
    const originalFetch = current.input.fetchImpl;
    const controller = new AbortController();
    let cancelled = false;
    const fetchImpl: typeof fetch = async (url, init) => {
      const response = await originalFetch(url, init);
      if (current.calls.length !== 5) return response;
      return new Response(new ReadableStream<Uint8Array>({
        start(stream) { stream.enqueue(new Uint8Array([1])); },
        cancel() { cancelled = true; },
      }));
    };
    setTimeout(() => controller.abort(), 20);
    expect(await readHostedPipelineGithub({ ...current.input, fetchImpl, signal: controller.signal }))
      .toEqual({ status: 'unavailable' });
    expect(current.calls).toHaveLength(5);
    expect(cancelled).toBe(true);
  });
});
