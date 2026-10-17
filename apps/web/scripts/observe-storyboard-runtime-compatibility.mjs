#!/usr/bin/env node

import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import { createHash, timingSafeEqual } from 'node:crypto';
import { pathToFileURL } from 'node:url';

const ALIASES = new Set(['tzudong.app', 'www.tzudong.app']);
const ENDPOINT_PATH = '/api/runtime-compatibility/storyboard';
export const STORYBOARD_PRODUCTION_COMPATIBILITY_URLS = Object.freeze([
  `https://tzudong.app${ENDPOINT_PATH}`,
  `https://www.tzudong.app${ENDPOINT_PATH}`,
]);
const DEPLOYMENT_ID = /^dpl_[A-Za-z0-9]+$/;
const SHA256 = /^[0-9a-f]{64}$/;
const COMMIT = /^[0-9a-f]{40}$/;
const MAX_RESPONSE_BYTES = 2048;
const MAX_BUNDLE_BYTES = 128 * 1024;
const REQUEST_TIMEOUT_MS = 5000;

export class StoryboardRuntimeObserverError extends Error {
  constructor(code) { super(code); this.name = 'StoryboardRuntimeObserverError'; this.code = code; }
}

function fail(code) { throw new StoryboardRuntimeObserverError(code); }
function exactObject(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function exactKeys(value, keys, code) {
  if (!exactObject(value) || JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...keys].sort())) fail(code);
}

function equalDigest(expected, actual) {
  if (!SHA256.test(expected ?? '') || !SHA256.test(actual ?? '')) return false;
  return timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(actual, 'hex'));
}

export function validateProductionCompatibilityUrl(value) {
  let url;
  try { url = new URL(value); } catch { fail('STORYBOARD_RUNTIME_OBSERVER_URL_INVALID'); }
  if (url.protocol !== 'https:'
    || !ALIASES.has(url.hostname)
    || url.username
    || url.password
    || url.port
    || url.pathname !== ENDPOINT_PATH
    || url.search
    || url.hash) fail('STORYBOARD_RUNTIME_OBSERVER_URL_INVALID');
  return url;
}

function parseJson(bytes, code) {
  try {
    const value = JSON.parse(Buffer.from(bytes).toString('utf8'));
    if (!exactObject(value)) fail(code);
    return value;
  } catch (error) {
    if (error instanceof StoryboardRuntimeObserverError) throw error;
    fail(code);
  }
}

async function readBoundedBody(response) {
  const declaredLength = response.headers.get('content-length');
  if (declaredLength !== null
    && (!/^(?:0|[1-9][0-9]*)$/.test(declaredLength) || Number(declaredLength) > MAX_RESPONSE_BYTES)) {
    fail('STORYBOARD_RUNTIME_OBSERVER_RESPONSE_INVALID');
  }
  if (!response.body) fail('STORYBOARD_RUNTIME_OBSERVER_RESPONSE_INVALID');
  const reader = response.body.getReader();
  const chunks = [];
  let bytesRead = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytesRead += value.byteLength;
      if (bytesRead > MAX_RESPONSE_BYTES) fail('STORYBOARD_RUNTIME_OBSERVER_RESPONSE_INVALID');
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }
  if (bytesRead === 0) fail('STORYBOARD_RUNTIME_OBSERVER_RESPONSE_INVALID');
  return Buffer.concat(chunks, bytesRead);
}

export function expectedCompatibilityFromBundle(bundle) {
  if (!exactObject(bundle)
    || bundle.schemaVersion !== 1
    || bundle.kind !== 'review-media-successor-vercel-operating-bundle') {
    fail('STORYBOARD_RUNTIME_OBSERVER_BUNDLE_INVALID');
  }
  const hold = bundle.adminRecordMutationsHold;
  const storyboardPolicy = bundle.storyboardPolicy;
  if (!exactObject(hold) || !exactObject(storyboardPolicy)) fail('STORYBOARD_RUNTIME_OBSERVER_BUNDLE_INVALID');
  const deployment = storyboardPolicy.deployment;
  const policy = storyboardPolicy.policy;
  if (!exactObject(deployment) || !exactObject(policy)
    || storyboardPolicy.schemaVersion !== 1
    || !DEPLOYMENT_ID.test(hold.deploymentId ?? '')
    || !COMMIT.test(hold.commit ?? '')
    || deployment.deploymentId !== hold.deploymentId
    || deployment.sourceCommit !== hold.commit
    || deployment.branch !== 'main'
    || !SHA256.test(policy.canonicalPolicySha256 ?? '')) {
    fail('STORYBOARD_RUNTIME_OBSERVER_BUNDLE_INVALID');
  }
  return Object.freeze({
    canonicalPolicySha256: policy.canonicalPolicySha256,
    commit: hold.commit,
    deploymentId: hold.deploymentId,
  });
}

function validateLiveCompatibility(value) {
  exactKeys(value, [
    'canonicalPolicySha256', 'commit', 'deploymentId', 'kind', 'schemaVersion',
  ], 'STORYBOARD_RUNTIME_OBSERVER_RESPONSE_INVALID');
  if (value.schemaVersion !== 1
    || value.kind !== 'storyboard-runtime-compatibility'
    || !DEPLOYMENT_ID.test(value.deploymentId ?? '')
    || !COMMIT.test(value.commit ?? '')
    || !SHA256.test(value.canonicalPolicySha256 ?? '')) {
    fail('STORYBOARD_RUNTIME_OBSERVER_RESPONSE_INVALID');
  }
  return value;
}

export async function fetchLiveStoryboardCompatibility({
  fetchImpl = fetch,
  timeoutMs = REQUEST_TIMEOUT_MS,
  url,
} = {}) {
  const target = validateProductionCompatibilityUrl(url);
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > REQUEST_TIMEOUT_MS) {
    fail('STORYBOARD_RUNTIME_OBSERVER_ARGUMENT_INVALID');
  }
  let response;
  try {
    response = await fetchImpl(target, {
      cache: 'no-store',
      headers: { Accept: 'application/json' },
      method: 'GET',
      redirect: 'error',
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    fail('STORYBOARD_RUNTIME_OBSERVER_FETCH_FAILED');
  }
  if (response.status !== 200 || response.redirected
    || !/^application\/json(?:\s*;|$)/i.test(response.headers.get('content-type') ?? '')) {
    fail('STORYBOARD_RUNTIME_OBSERVER_RESPONSE_INVALID');
  }
  return validateLiveCompatibility(parseJson(
    await readBoundedBody(response),
    'STORYBOARD_RUNTIME_OBSERVER_RESPONSE_INVALID',
  ));
}

async function fetchProductionAliasRoute({ fetchImpl, timeoutMs, url }) {
  const target = validateProductionCompatibilityUrl(url);
  let response;
  try {
    response = await fetchImpl(target, {
      cache: 'no-store',
      headers: { Accept: 'application/json' },
      method: 'GET',
      redirect: 'manual',
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    fail('STORYBOARD_RUNTIME_OBSERVER_FETCH_FAILED');
  }
  if ([301, 302, 307, 308].includes(response.status)) {
    const redirectTarget = response.headers.get('location') ?? '';
    if (target.hostname !== 'tzudong.app'
      || response.redirected
      || redirectTarget !== STORYBOARD_PRODUCTION_COMPATIBILITY_URLS[1]) {
      fail('STORYBOARD_RUNTIME_OBSERVER_RESPONSE_INVALID');
    }
    return Object.freeze({
      productionAlias: target.hostname,
      route: 'redirect',
      redirectTarget,
      value: null,
    });
  }
  if (response.status !== 200 || response.redirected
    || !/^application\/json(?:\s*;|$)/i.test(response.headers.get('content-type') ?? '')) {
    fail('STORYBOARD_RUNTIME_OBSERVER_RESPONSE_INVALID');
  }
  const value = validateLiveCompatibility(parseJson(
    await readBoundedBody(response),
    'STORYBOARD_RUNTIME_OBSERVER_RESPONSE_INVALID',
  ));
  return Object.freeze({
    productionAlias: target.hostname,
    route: 'direct',
    redirectTarget: null,
    value,
  });
}

function validateAliasSet(urls) {
  if (!Array.isArray(urls)
    || urls.length !== STORYBOARD_PRODUCTION_COMPATIBILITY_URLS.length
    || urls.some((url, index) => url !== STORYBOARD_PRODUCTION_COMPATIBILITY_URLS[index])) {
    fail('STORYBOARD_RUNTIME_OBSERVER_ARGUMENT_INVALID');
  }
  return urls;
}

export async function fetchLiveStoryboardCompatibilityAliases({
  fetchImpl = fetch,
  timeoutMs = REQUEST_TIMEOUT_MS,
  urls = STORYBOARD_PRODUCTION_COMPATIBILITY_URLS,
} = {}) {
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > REQUEST_TIMEOUT_MS) {
    fail('STORYBOARD_RUNTIME_OBSERVER_ARGUMENT_INVALID');
  }
  const observations = [];
  for (const url of validateAliasSet(urls)) {
    observations.push(await fetchProductionAliasRoute({ fetchImpl, timeoutMs, url }));
  }
  const apex = observations[0];
  const canonical = observations[1];
  if (!apex || !canonical || canonical.route !== 'direct' || !canonical.value
    || (apex.route === 'direct' && (!apex.value
      || apex.value.deploymentId !== canonical.value.deploymentId
      || apex.value.commit !== canonical.value.commit
      || !equalDigest(apex.value.canonicalPolicySha256, canonical.value.canonicalPolicySha256)))) {
    fail('STORYBOARD_RUNTIME_OBSERVER_ALIAS_SET_MISMATCH');
  }
  return Object.freeze({
    schemaVersion: 1,
    kind: 'storyboard-runtime-compatibility-alias-set-readback',
    aliasRoutes: Object.freeze(observations.map(({ productionAlias, route, redirectTarget }) =>
      Object.freeze({ productionAlias, redirectTarget, route }))),
    deploymentId: canonical.value.deploymentId,
    commit: canonical.value.commit,
    canonicalPolicySha256: canonical.value.canonicalPolicySha256,
  });
}

export async function observeStoryboardRuntimeCompatibility({
  bundle,
  bundleSha256,
  fetchImpl = fetch,
  timeoutMs = REQUEST_TIMEOUT_MS,
  url,
} = {}) {
  if (!SHA256.test(bundleSha256 ?? '')) fail('STORYBOARD_RUNTIME_OBSERVER_ARGUMENT_INVALID');
  const expected = expectedCompatibilityFromBundle(bundle);
  const live = await fetchLiveStoryboardCompatibility({ fetchImpl, timeoutMs, url });
  if (live.deploymentId !== expected.deploymentId || live.commit !== expected.commit) {
    fail('STORYBOARD_RUNTIME_OBSERVER_IDENTITY_MISMATCH');
  }
  if (!equalDigest(live.canonicalPolicySha256, expected.canonicalPolicySha256)) {
    fail('STORYBOARD_RUNTIME_OBSERVER_POLICY_MISMATCH');
  }
  return Object.freeze({
    schemaVersion: 1,
    kind: 'storyboard-runtime-compatibility-observation',
    productionAlias: validateProductionCompatibilityUrl(url).hostname,
    bundleSha256,
    deploymentId: live.deploymentId,
    commit: live.commit,
    canonicalPolicySha256: live.canonicalPolicySha256,
  });
}

export async function observeStoryboardRuntimeCompatibilityAliases({
  bundle,
  bundleSha256,
  fetchImpl = fetch,
  timeoutMs = REQUEST_TIMEOUT_MS,
  urls = STORYBOARD_PRODUCTION_COMPATIBILITY_URLS,
} = {}) {
  if (!SHA256.test(bundleSha256 ?? '')) fail('STORYBOARD_RUNTIME_OBSERVER_ARGUMENT_INVALID');
  const expected = expectedCompatibilityFromBundle(bundle);
  const live = await fetchLiveStoryboardCompatibilityAliases({ fetchImpl, timeoutMs, urls });
  if (live.deploymentId !== expected.deploymentId || live.commit !== expected.commit) {
    fail('STORYBOARD_RUNTIME_OBSERVER_IDENTITY_MISMATCH');
  }
  if (!equalDigest(live.canonicalPolicySha256, expected.canonicalPolicySha256)) {
    fail('STORYBOARD_RUNTIME_OBSERVER_POLICY_MISMATCH');
  }
  return Object.freeze({
    schemaVersion: 1,
    kind: 'storyboard-runtime-compatibility-alias-set-observation',
    aliasRoutes: live.aliasRoutes,
    bundleSha256,
    deploymentId: live.deploymentId,
    commit: live.commit,
    canonicalPolicySha256: live.canonicalPolicySha256,
  });
}

export async function loadPinnedCompatibilityBundle({ bundlePath, bundleSha256 } = {}) {
  if (typeof bundlePath !== 'string' || !bundlePath || !SHA256.test(bundleSha256 ?? '')) {
    fail('STORYBOARD_RUNTIME_OBSERVER_ARGUMENT_INVALID');
  }
  let handle;
  try {
    handle = await open(bundlePath, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size < 2 || stat.size > MAX_BUNDLE_BYTES) fail('STORYBOARD_RUNTIME_OBSERVER_BUNDLE_INVALID');
    const bytes = await handle.readFile();
    if (bytes.length !== stat.size
      || !equalDigest(bundleSha256, createHash('sha256').update(bytes).digest('hex'))) {
      fail('STORYBOARD_RUNTIME_OBSERVER_BUNDLE_INVALID');
    }
    return parseJson(bytes, 'STORYBOARD_RUNTIME_OBSERVER_BUNDLE_INVALID');
  } catch (error) {
    if (error instanceof StoryboardRuntimeObserverError) throw error;
    fail('STORYBOARD_RUNTIME_OBSERVER_BUNDLE_INVALID');
  } finally {
    await handle?.close();
  }
}

function cliArguments(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!['--bundle', '--bundle-sha256'].includes(key) || value === undefined || Object.hasOwn(values, key)) {
      fail('STORYBOARD_RUNTIME_OBSERVER_ARGUMENT_INVALID');
    }
    values[key] = value;
  }
  if (Object.keys(values).length !== 2) fail('STORYBOARD_RUNTIME_OBSERVER_ARGUMENT_INVALID');
  return values;
}

async function main() {
  try {
    const args = cliArguments(process.argv.slice(2));
    const bundle = await loadPinnedCompatibilityBundle({
      bundlePath: args['--bundle'],
      bundleSha256: args['--bundle-sha256'],
    });
    const observation = await observeStoryboardRuntimeCompatibilityAliases({
      bundle,
      bundleSha256: args['--bundle-sha256'],
    });
    process.stdout.write(`${JSON.stringify(observation)}\n`);
  } catch (error) {
    const code = error instanceof StoryboardRuntimeObserverError
      ? error.code : 'STORYBOARD_RUNTIME_OBSERVER_FAILED';
    process.stderr.write(`${code}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
