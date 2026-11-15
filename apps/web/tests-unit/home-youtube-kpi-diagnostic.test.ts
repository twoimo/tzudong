import { describe, expect, test } from 'bun:test';
import {
  COHORT_SIZE, MAX_RESPONSE_BYTES, parseServerTiming, runDiagnostic, validateCohort, validateProvenance,
} from '../performance/kpi-rpc-20261115/diagnose.mjs';
import { createHomeKpiServerTiming } from '../lib/performance/home-kpi-server-timing';

const ids = Array.from({ length: COHORT_SIZE }, (_, index) => 'video_' + String(index).padStart(3, '0'));
const PRIVATE = 'SYNTHETIC_PRIVATE_DETAIL';
const provenance = {
  schemaVersion: 1, mode: 'rpc', sourceSha: 'a'.repeat(40), deploymentId: 'dpl_12345678',
  origin: 'https://diagnostic.fixture.invalid', observedAtUtc: '2026-11-15T06:30:00.000Z',
  providerReadbackSha256: 'b'.repeat(64),
};
function validResponse(mode: 'legacy' | 'rpc' = 'rpc') {
  const timing = createHomeKpiServerTiming(() => 0);
  timing.beginBody()();
  if (mode === 'legacy') {
    timing.observe({ name: 'bucketRequest', durationMs: 0 });
    timing.observe({ name: 'rowsRequest', durationMs: 0 });
  } else {
    timing.observe({ name: 'rpcRequest', durationMs: 0 });
    timing.observe({ name: 'dbBucket', durationMs: 0 });
    timing.observe({ name: 'dbRows', durationMs: 0 });
    timing.observe({ name: 'dbTotal', durationMs: 0 });
  }
  return Response.json({
    metrics: ids.map(videoId => ({
      videoId, title: PRIVATE, publishedAt: null, duration: 0, viewCount: 0, likeCount: 0,
      commentCount: 0, bucketStartedAt: '2026-11-15T06:30:00Z', fetchedAt: null,
    })),
  }, { headers: { 'Server-Timing': timing.header(mode), 'x-vercel-cache': 'MISS' } });
}

describe('bounded homepage KPI API diagnostic', () => {
  test('freezes 100 unique valid IDs and rejects short, duplicate or malformed cohorts', () => {
    expect(validateCohort(ids)).toEqual(ids);
    expect(validateCohort(ids)).not.toBe(ids);
    for (const bad of [[], ids.slice(1), [...ids.slice(1), ids[1]], [...ids.slice(1), 'bad/id']]) {
      expect(() => validateCohort(bad)).toThrow('INVALID_COHORT');
    }
  });

  test('requires exact recent operator provenance with no credentials or arbitrary extra fields', () => {
    const now = Date.parse('2026-11-15T06:45:00.000Z');
    expect(validateProvenance(provenance, now)).toEqual(provenance);
    for (const patch of [
      { sourceSha: 'main' }, { sourceSha: ['a'.repeat(40)] }, { mode: 'RPC' },
      { providerReadbackSha256: undefined }, { secret: PRIVATE },
      { origin: 'https://user:password@diagnostic.fixture.invalid' },
      { origin: provenance.origin + '/path' }, { observedAtUtc: '2026-11-15T05:00:00.000Z' },
      { observedAtUtc: '2026-11-15T07:00:00.000Z' },
    ]) expect(() => validateProvenance({ ...provenance, ...patch }, now)).toThrow();
  });

  test('accepts real allowlisted timing with zero and suppresses arbitrary or ambiguous headers', () => {
    const parsed = parseServerTiming(validResponse().headers.get('server-timing'));
    expect(parsed?.mode).toBe('rpc');
    expect(parsed?.durations['kpi-db-total']).toBe(0);
    for (const bad of [
      'kpi-mode;desc="' + PRIVATE + '"', 'kpi-handler;dur=NaN',
      'kpi-handler;dur=1,kpi-handler;dur=2', 'kpi-handler;dur=-1',
      'kpi-handler;dur=1;desc="' + PRIVATE + '"',
      'kpi-db-invalid,kpi-db-total;dur=0', 'kpi-mode-invalid,kpi-mode;desc="rpc"',
      'x'.repeat(2049),
    ]) expect(parseServerTiming(bad)).toBeNull();
  });

  test('uses exactly five fixed POST slots without retries and retains no IDs or response data', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const emitted: unknown[] = [];
    const samples = await runDiagnostic({
      ids, provenance, emit: (sample: unknown) => { emitted.push(sample); },
      fetchImpl: async (url: string, init: RequestInit) => {
        calls.push({ url, init });
        if (calls.length === 2) throw new Error(PRIVATE);
        return validResponse();
      },
    });
    expect(calls).toHaveLength(5);
    expect(emitted).toHaveLength(5);
    expect(samples.map((sample: { admitted: boolean }) => sample.admitted)).toEqual([true, false, true, true, true]);
    expect(samples[1].failure).toBe('REQUEST_FAILED');
    expect(samples[0].responseCount).toBe(100);
    expect(samples[0].responseSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(samples[0].serverTiming).toContain('kpi-db-total;dur=0');
    for (const { url, init } of calls) {
      expect(url).toBe(provenance.origin + '/api/home/youtube-kpi');
      expect(init.method).toBe('POST');
      expect(init.redirect).toBe('manual');
      expect(init.credentials).toBe('omit');
      expect(JSON.parse(init.body as string)).toEqual({ videoIds: ids });
      expect(init.headers).toEqual({ 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' });
    }
    const retained = JSON.stringify(samples);
    expect(retained).not.toContain(PRIVATE);
    for (const id of ids) expect(retained).not.toContain(id);
  });

  test('oversize, cache replay, wrong mode and untrusted timing remain failed original slots', async () => {
    let calls = 0;
    const samples = await runDiagnostic({
      ids, provenance, emit: () => {},
      fetchImpl: async () => {
        calls++;
        if (calls === 1) return new Response('x'.repeat(MAX_RESPONSE_BYTES + 1));
        const response = validResponse();
        if (calls === 2) response.headers.set('x-vercel-cache', 'HIT');
        if (calls === 3) response.headers.set('server-timing', 'kpi-mode;desc="legacy"');
        if (calls === 4) response.headers.set('server-timing', PRIVATE);
        if (calls === 5) response.headers.delete('x-vercel-cache');
        return response;
      },
    });
    expect(calls).toBe(5);
    expect(samples.map((sample: { failure: string }) => sample.failure)).toEqual([
      'RESPONSE_TOO_LARGE', 'CACHE_UNPROVEN', 'TIMING_MODE_MISMATCH', 'TIMING_MODE_MISMATCH', 'CACHE_UNPROVEN',
    ]);
    expect(samples[0].responseSha256).toBeNull();
    expect(samples[3].serverTiming).toBeNull();
    expect(JSON.stringify(samples)).not.toContain(PRIVATE);
  });

  test('the legacy baseline admits only its aggregate request spans without requiring invented DB timings', async () => {
    const samples = await runDiagnostic({
      ids, provenance: { ...provenance, mode: 'legacy' }, emit: () => {},
      fetchImpl: async () => validResponse('legacy'),
    });
    expect(samples).toHaveLength(5);
    expect(samples.every((sample: { admitted: boolean }) => sample.admitted)).toBe(true);
    expect(samples[0].serverTiming).toContain('kpi-bucket-request;dur=0');
    expect(samples[0].serverTiming).toContain('kpi-rows-request;dur=0');
    expect(samples[0].serverTiming).not.toContain('kpi-db-');
  });

  test('unexpected, duplicate, reordered or mixed-bucket rows do not become valid workload samples', async () => {
    let calls = 0;
    const samples = await runDiagnostic({
      ids, provenance, emit: () => {},
      fetchImpl: async () => {
        const response = validResponse();
        const body = await response.json();
        if (calls === 0) body.metrics[0].videoId = 'unexpected_video';
        if (calls === 1) body.metrics[1].videoId = body.metrics[0].videoId;
        if (calls === 2) body.metrics.reverse();
        if (calls === 3) body.metrics[1].bucketStartedAt = '2026-11-15T06:15:00Z';
        if (calls === 4) body.metrics.pop();
        calls++;
        return Response.json(body, { headers: response.headers });
      },
    });
    expect(calls).toBe(5);
    expect(samples.map((sample: { failure: string }) => sample.failure)).toEqual([
      'INVALID_RESPONSE', 'INVALID_RESPONSE', 'INVALID_RESPONSE', 'INVALID_RESPONSE', 'COHORT_INCOMPLETE',
    ]);
  });

  test('a receipt persistence failure stops subsequent requests with no replacement run', async () => {
    let calls = 0;
    await expect(runDiagnostic({
      ids, provenance, fetchImpl: async () => { calls++; return validResponse(); },
      emit: () => { throw new Error('FIXED_WRITE_FAILURE'); },
    })).rejects.toThrow('FIXED_WRITE_FAILURE');
    expect(calls).toBe(1);
  });
});
