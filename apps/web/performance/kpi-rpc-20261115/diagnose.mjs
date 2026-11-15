#!/usr/bin/env node
// Five unauthenticated application requests; importing this file performs no I/O.
import { createHash } from 'node:crypto';
import { mkdir, open, readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const REQUEST_COUNT = 5;
export const COHORT_SIZE = 100;
export const REQUEST_TIMEOUT_MS = 15_000;
export const MAX_RESPONSE_BYTES = 256 * 1024;
const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '../../../..');
const RECEIPTS = path.join(HERE, 'receipts');
const hash = value => createHash('sha256').update(value).digest('hex');
const fail = code => { throw new Error(code); };
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const finite = value => typeof value === 'number' && Number.isFinite(value)
  && value >= 0 && value <= Number.MAX_SAFE_INTEGER;
const DURATIONS = new Set([
  'kpi-body', 'kpi-handler', 'kpi-bucket-request', 'kpi-rows-request',
  'kpi-rpc-request', 'kpi-db-bucket', 'kpi-db-rows', 'kpi-db-total',
]);
const ROW_KEYS = [
  'videoId', 'title', 'publishedAt', 'duration', 'viewCount', 'likeCount',
  'commentCount', 'bucketStartedAt', 'fetchedAt',
];

export function validateCohort(value) {
  if (!Array.isArray(value) || value.length !== COHORT_SIZE
    || value.some(id => typeof id !== 'string' || !/^[A-Za-z0-9_-]{6,64}$/.test(id))
    || new Set(value).size !== COHORT_SIZE) fail('INVALID_COHORT');
  return [...value];
}

export function validateProvenance(value, now = Date.now()) {
  const keys = ['schemaVersion', 'mode', 'sourceSha', 'deploymentId', 'origin',
    'observedAtUtc', 'providerReadbackSha256'];
  if (!record(value) || Object.keys(value).length !== keys.length
    || !keys.every(key => Object.hasOwn(value, key)) || value.schemaVersion !== 1
    || !keys.filter(key => key !== 'schemaVersion').every(key => typeof value[key] === 'string')
    || !['legacy', 'rpc'].includes(value.mode)
    || !/^[a-f0-9]{40}$/.test(value.sourceSha)
    || !/^dpl_[A-Za-z0-9]{8,80}$/.test(value.deploymentId)
    || !/^[a-f0-9]{64}$/.test(value.providerReadbackSha256)
    || typeof value.observedAtUtc !== 'string') fail('INVALID_PROVENANCE');
  let origin;
  try { origin = new URL(value.origin); } catch { fail('INVALID_PROVENANCE'); }
  if (origin.protocol !== 'https:' || origin.username || origin.password
    || origin.origin !== value.origin || origin.port) fail('INVALID_PROVENANCE');
  const observedAt = Date.parse(value.observedAtUtc);
  if (!Number.isFinite(observedAt) || new Date(observedAt).toISOString() !== value.observedAtUtc
    || observedAt > now || now - observedAt > 30 * 60 * 1000) fail('STALE_PROVENANCE');
  return Object.fromEntries(keys.map(key => [key, value[key]]));
}

export function parseServerTiming(value) {
  if (typeof value !== 'string' || value.length > 2048) return null;
  const tokens = value.split(',').map(token => token.trim());
  const names = new Set();
  const durations = {};
  let mode = null;
  let invalidDatabase = false;
  for (const token of tokens) {
    const duration = /^(kpi-[a-z-]+);dur=((?:0|[1-9][0-9]*)(?:\.[0-9]{1,3})?)$/.exec(token);
    const modeMatch = /^kpi-mode;desc="(legacy|rpc)"$/.exec(token);
    const name = duration?.[1] ?? (modeMatch ? 'kpi-mode' : token);
    if (names.has(name)) return null;
    names.add(name);
    if (duration && DURATIONS.has(name) && finite(Number(duration[2]))) {
      durations[name] = Number(duration[2]);
    } else if (modeMatch) mode = modeMatch[1];
    else if (token === 'kpi-db-invalid') invalidDatabase = true;
    else if (token !== 'kpi-mode-invalid') return null;
  }
  if ((names.has('kpi-mode-invalid') && mode !== null)
    || (invalidDatabase && [...names].some(name => name.startsWith('kpi-db-') && name !== 'kpi-db-invalid'))) return null;
  return { header: tokens.join(', '), mode, durations, invalidDatabase };
}

function responseCount(value, ids) {
  if (!record(value) || Object.keys(value).join() !== 'metrics'
    || !Array.isArray(value.metrics) || value.metrics.length > COHORT_SIZE) fail('INVALID_RESPONSE');
  let previous = -1;
  let bucket = null;
  for (const row of value.metrics) {
    if (!record(row) || Object.keys(row).length !== ROW_KEYS.length
      || !ROW_KEYS.every(key => Object.hasOwn(row, key))) fail('INVALID_RESPONSE');
    const index = ids.indexOf(row.videoId);
    if (index <= previous) fail('INVALID_RESPONSE');
    previous = index;
    for (const key of ['title', 'publishedAt', 'fetchedAt']) {
      if (row[key] !== null && typeof row[key] !== 'string') fail('INVALID_RESPONSE');
    }
    if (typeof row.bucketStartedAt !== 'string' || !row.bucketStartedAt
      || (bucket !== null && bucket !== row.bucketStartedAt)
      || !['duration', 'viewCount', 'likeCount', 'commentCount'].every(key => finite(row[key]))) fail('INVALID_RESPONSE');
    bucket = row.bucketStartedAt;
  }
  return value.metrics.length;
}

function cacheObservation(headers) {
  const allowed = new Set(['MISS', 'BYPASS', 'DYNAMIC', 'HIT', 'STALE', 'REVALIDATED', 'UPDATING', 'EXPIRED']);
  const pick = name => {
    const value = headers.get(name);
    return value === null ? null : allowed.has(value) ? value : 'UNKNOWN';
  };
  const rawAge = headers.get('age');
  const age = rawAge === null ? null
    : /^\d{1,10}$/.test(rawAge) ? Number(rawAge) : 'INVALID';
  const vercel = pick('x-vercel-cache');
  const cloudflare = pick('cf-cache-status');
  const knownUncached = [vercel, cloudflare].some(value => ['MISS', 'BYPASS', 'DYNAMIC', 'EXPIRED'].includes(value));
  const replayOrUnknown = [vercel, cloudflare].some(value => ['HIT', 'STALE', 'REVALIDATED', 'UPDATING', 'UNKNOWN'].includes(value));
  return { age, vercel, cloudflare, freshEvidence: knownUncached && !replayOrUnknown && (age === null || age === 0) };
}

async function readResponse(response, controller) {
  const declared = response.headers.get('content-length');
  if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > MAX_RESPONSE_BYTES)) {
    controller.abort();
    fail('RESPONSE_TOO_LARGE');
  }
  if (!response.body) return Buffer.alloc(0);
  const reader = response.body.getReader();
  const chunks = [];
  let length = 0;
  while (true) {
    const next = await reader.read();
    if (next.done) break;
    length += next.value.byteLength;
    if (length > MAX_RESPONSE_BYTES) {
      controller.abort();
      fail('RESPONSE_TOO_LARGE');
    }
    chunks.push(Buffer.from(next.value));
  }
  return Buffer.concat(chunks, length);
}

export async function runDiagnostic({ ids, provenance, emit, fetchImpl = fetch }) {
  // Five fixed slots; errors remain in their original positions. No warmup,
  // retry, alternate mode, cookie, authentication or redirect request exists.
  const cohort = validateCohort(ids);
  const samples = [];
  for (let index = 1; index <= REQUEST_COUNT; index++) {
    const sample = {
      kind: 'sample', index, mode: provenance.mode, startedAtUtc: new Date().toISOString(),
      finishedAtUtc: null, status: null, serverTiming: null, externalTotalMs: null,
      responseBytes: null, responseCount: null, responseSha256: null,
      cache: null, admitted: false, failure: null,
    };
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    const startedAt = performance.now();
    try {
      const response = await fetchImpl(provenance.origin + '/api/home/youtube-kpi', {
        method: 'POST', redirect: 'manual', credentials: 'omit', cache: 'no-store',
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' },
        body: JSON.stringify({ videoIds: cohort }), signal: controller.signal,
      });
      sample.status = response.status;
      sample.cache = cacheObservation(response.headers);
      const timing = parseServerTiming(response.headers.get('server-timing'));
      sample.serverTiming = timing?.header ?? null;
      const body = await readResponse(response, controller);
      // End at the final body byte; JSON validation and receipt I/O are excluded.
      sample.externalTotalMs = Number((performance.now() - startedAt).toFixed(3));
      sample.responseBytes = body.length;
      sample.responseSha256 = hash(body);
      if (response.status !== 200) fail('HTTP_STATUS');
      if (!/^application\/json(?:\s*;|$)/i.test(response.headers.get('content-type') ?? '')) fail('INVALID_RESPONSE');
      let parsed;
      try { parsed = JSON.parse(body.toString('utf8')); } catch { fail('INVALID_RESPONSE'); }
      sample.responseCount = responseCount(parsed, cohort);
      if (!timing || timing.mode !== provenance.mode) fail('TIMING_MODE_MISMATCH');
      const required = ['kpi-body', 'kpi-handler', ...(provenance.mode === 'legacy'
        ? ['kpi-bucket-request', 'kpi-rows-request']
        : ['kpi-rpc-request', 'kpi-db-bucket', 'kpi-db-rows', 'kpi-db-total'])];
      const forbidden = provenance.mode === 'legacy'
        ? ['kpi-rpc-request', 'kpi-db-bucket', 'kpi-db-rows', 'kpi-db-total']
        : ['kpi-bucket-request', 'kpi-rows-request'];
      if (timing.invalidDatabase || required.some(name => !Object.hasOwn(timing.durations, name))
        || forbidden.some(name => Object.hasOwn(timing.durations, name))) fail('TIMING_INCOMPLETE');
      if (sample.responseCount !== COHORT_SIZE) fail('COHORT_INCOMPLETE');
      if (!sample.cache.freshEvidence) fail('CACHE_UNPROVEN');
      sample.admitted = true;
    } catch (error) {
      const allowed = ['RESPONSE_TOO_LARGE', 'HTTP_STATUS', 'INVALID_RESPONSE',
        'TIMING_MODE_MISMATCH', 'TIMING_INCOMPLETE', 'COHORT_INCOMPLETE', 'CACHE_UNPROVEN'];
      sample.failure = allowed.includes(error?.message) ? error.message
        : controller.signal.aborted ? 'REQUEST_TIMEOUT' : 'REQUEST_FAILED';
    } finally {
      clearTimeout(timeout);
      sample.externalTotalMs ??= Number((performance.now() - startedAt).toFixed(3));
      sample.finishedAtUtc = new Date().toISOString();
    }
    // A receipt write failure stops the remaining slots; never collect results
    // that cannot be retained or run replacements for the missing slots.
    await emit(sample);
    samples.push(sample);
  }
  return samples;
}

async function readSmallJson(filename) {
  const file = await open(filename, 'r');
  try {
    if (!(await file.stat()).isFile()) fail('INVALID_INPUT_FILE');
    const buffer = Buffer.alloc(8193);
    let length = 0;
    while (length < buffer.length) {
      const { bytesRead } = await file.read(buffer, length, buffer.length - length, length);
      if (bytesRead === 0) break;
      length += bytesRead;
    }
    if (length > 8192) fail('INVALID_INPUT_FILE');
    try { return JSON.parse(buffer.subarray(0, length).toString('utf8')); }
    catch { fail('INVALID_INPUT_FILE'); }
  } finally { await file.close(); }
}

async function main(args) {
  if (args.length !== 7 || args[0] !== '--run') fail('INVALID_ARGUMENTS');
  const flags = {};
  for (let index = 1; index < args.length; index += 2) {
    if (!['--cohort-file', '--provenance-file', '--out'].includes(args[index])
      || Object.hasOwn(flags, args[index]) || !args[index + 1]) fail('INVALID_ARGUMENTS');
    flags[args[index]] = args[index + 1];
  }
  const cohortPath = await realpath(flags['--cohort-file']);
  const repository = await realpath(REPO);
  if (cohortPath === repository || cohortPath.startsWith(repository + path.sep)) fail('COHORT_MUST_STAY_OUTSIDE_REPOSITORY');
  const cohortInput = await readSmallJson(cohortPath);
  if (!record(cohortInput) || Object.keys(cohortInput).join() !== 'videoIds') fail('INVALID_COHORT');
  const ids = validateCohort(cohortInput.videoIds);
  const provenance = validateProvenance(await readSmallJson(flags['--provenance-file']));
  const output = path.resolve(flags['--out']);
  if (path.dirname(output) !== RECEIPTS
    || !new RegExp('^' + provenance.mode + '-[a-z0-9-]+\\.ndjson$').test(path.basename(output))) fail('INVALID_OUTPUT_PATH');
  await mkdir(RECEIPTS, { recursive: true });
  if (await realpath(RECEIPTS) !== RECEIPTS) fail('INVALID_OUTPUT_PATH');
  const receipt = await open(output, 'wx', 0o600);
  let samples;
  try {
    await receipt.write(JSON.stringify({
      kind: 'provenance', schemaVersion: 1, recordedAtUtc: new Date().toISOString(),
      provenanceAuthority: 'operator-supplied-provider-readback', ...provenance,
      scriptSha256: hash(await readFile(fileURLToPath(import.meta.url))),
      runtime: { node: process.version, platform: process.platform, arch: process.arch },
      cohortCount: ids.length, cohortSha256: hash(JSON.stringify(ids)),
      policy: { requestCount: REQUEST_COUNT, timeoutMs: REQUEST_TIMEOUT_MS, maxResponseBytes: MAX_RESPONSE_BYTES,
        warmups: 0, retries: 0, failureReplacements: 0, concurrency: 1 },
    }) + '\n');
    samples = await runDiagnostic({ ids, provenance, emit: sample => receipt.write(JSON.stringify(sample) + '\n') });
    await receipt.write(JSON.stringify({
      kind: 'complete', completedAtUtc: new Date().toISOString(),
      attempted: samples.length, admitted: samples.filter(sample => sample.admitted).length,
    }) + '\n');
    await receipt.sync();
  } finally { await receipt.close(); }
  const admitted = samples.filter(sample => sample.admitted).length;
  process.stdout.write(JSON.stringify({
    status: admitted === REQUEST_COUNT ? 'diagnostics-retained' : 'diagnostics-incomplete',
    attempted: samples.length, admitted, receiptSha256: hash(await readFile(output)),
  }) + '\n');
  if (admitted !== REQUEST_COUNT) process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch(() => {
    // No input path, ID, body, origin credentials or provider error is echoed.
    process.stderr.write('KPI_DIAGNOSTIC_STOPPED\n');
    process.exitCode = 1;
  });
}
