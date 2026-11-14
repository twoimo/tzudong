import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, lstatSync, realpathSync, readdirSync, existsSync } from 'node:fs';
import { dirname, resolve, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = dirname(fileURLToPath(import.meta.url));
export const PROTOCOL_SHA256 = 'c3652812b384d0f949b001dfe059882fe2adeae11c94403b5cdec91cf2097822';
export const URL = 'https://www.tzudong.app/?__perf=initial-load';
export const SHA = /^[a-f0-9]{64}$/;
export const COMMIT = /^[a-f0-9]{40}$/;
export const OBSERVER_PATHS = ['apps/web/lib/performance/initial-load-diagnostic.ts', 'apps/web/lib/performance/initial-load-milestones.ts'];
export const TOOL_PATHS = ['protocol.json', 'snapshot.schema.json', 'evidence.mjs', 'record.mjs', 'score.mjs', 'validate.py'];
export const check = (condition, message) => { if (!condition) throw new Error(message); };
export const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
export const finite = (value) => typeof value === 'number' && Number.isFinite(value) && value >= 0;
export const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
export const timestamp = (value) => typeof value === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/.test(value) && Number.isFinite(Date.parse(value)) ? Date.parse(value) : null;
export const near = (a, b) => finite(a) && finite(b) && Math.abs(a - b) <= 0.01;
export const parse = (bytes) => JSON.parse(bytes.toString('utf8'));

export function safePath(path) {
  check(typeof path === 'string' && /^[A-Za-z0-9._/-]+$/.test(path) && !isAbsolute(path)
    && !path.endsWith('/') && !path.includes('//') && !path.split('/').some((p) => p === '.' || p === '..'), 'unsafe relative evidence path');
  return path;
}
export function read(root, path) {
  const absolute = resolve(root, safePath(path));
  const realRoot = realpathSync(root);
  const actual = realpathSync(absolute);
  check(actual === absolute && !relative(realRoot, actual).startsWith('..') && !isAbsolute(relative(realRoot, actual)), 'symlink or outside evidence root');
  const stat = lstatSync(absolute);
  check(stat.isFile() && !stat.isSymbolicLink() && stat.size <= 2 * 1024 * 1024, 'non-file or excessive evidence size');
  return readFileSync(absolute);
}
export function writeNew(root, path, bytes) {
  const absolute = resolve(root, safePath(path));
  mkdirSync(dirname(absolute), { recursive: true });
  check(realpathSync(dirname(absolute)) === dirname(absolute), 'symlink output directory');
  writeFileSync(absolute, bytes, { flag: 'wx' });
}
export const writeJson = (root, path, data) => writeNew(root, path, `${JSON.stringify(data, null, 2)}\n`);

/** Strict finite whitelist; the JSON Schema uses only this deliberately small subset. */
export function conforms(value, schema) {
  if (schema.anyOf) return schema.anyOf.some((branch) => conforms(value, branch));
  if (Object.hasOwn(schema, 'const') && !same(value, schema.const)) return false;
  if (schema.enum && !schema.enum.some((candidate) => same(value, candidate))) return false;
  const types = schema.type ? [].concat(schema.type) : [];
  const kind = value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value;
  if (types.length && !types.some((type) => type === kind || type === 'integer' && Number.isInteger(value))) return false;
  if (typeof value === 'number') return Number.isFinite(value) && (schema.minimum === undefined || value >= schema.minimum) && (schema.maximum === undefined || value <= schema.maximum);
  if (typeof value === 'string' && schema.pattern && !new RegExp(schema.pattern).test(value)) return false;
  if (Array.isArray(value)) return (schema.maxItems === undefined || value.length <= schema.maxItems)
    && (!schema.uniqueItems || new Set(value.map((v) => JSON.stringify(v))).size === value.length)
    && (!schema.items || value.every((v) => conforms(v, schema.items)));
  if (value !== null && typeof value === 'object') {
    if ((schema.required ?? []).some((key) => !Object.hasOwn(value, key))) return false;
    if (schema.additionalProperties === false && Object.keys(value).some((key) => !Object.hasOwn(schema.properties ?? {}, key))) return false;
    return Object.entries(value).every(([key, child]) => !schema.properties?.[key] || conforms(child, schema.properties[key]));
  }
  return true;
}

export function snapshotProblems(snapshot, cohort, sourceSha, schema) {
  if (!conforms(snapshot, schema)) return ['SNAPSHOT_SCHEMA'];
  const s = snapshot, c = s.capture, n = s.navigation, p = s.paints, l = p.windowLcp, m = s.milestones, r = s.completeness;
  const problems = [];
  const require = (condition, name) => { if (!condition) problems.push(name); };
  const within = (value) => finite(value) && value > 0 && value <= 20000;
  require(s.binding.gitSha === sourceSha && s.binding.hostname === 'www.tzudong.app' && s.binding.pathname === '/', 'SOURCE_BINDING');
  require(c.contextUnchanged === true, 'NAVIGATION_CONTEXT_CHANGED');
  require(finite(c.observerSetupMs) && c.observerSetupMs <= 20000 && finite(c.frozenAtMs) && c.frozenAtMs >= 20000, 'CAPTURE_WINDOW');
  require(c.visibilityAtStart === 'visible' && c.firstHiddenAtMs === null, 'HIDDEN_DOCUMENT');
  require(c.trustedInputCount === 0 && c.firstTrustedInputAtMs === null, 'TRUSTED_INPUT');
  require(c.resizeCount === 0 && c.firstResizeAtMs === null, 'VIEWPORT_RESIZE');
  require(same(s.viewport.initial, cohort.viewport) && same(s.viewport.final, cohort.viewport), 'VIEWPORT_BINDING');
  require(s.support.navigation && s.support.paint && s.support.largestContentfulPaint, 'REQUIRED_API_UNAVAILABLE');
  require(n && n.type === 'navigate' && n.startTime === 0 && n.activationStart === 0 && n.redirectCount === 0, 'NAVIGATION_KIND');
  require(n && within(n.responseStart) && within(n.responseEnd) && n.responseEnd >= n.responseStart, 'NAVIGATION_TIMING');
  require(within(p.fcpMs) && l && within(l.startTimeMs) && n && p.fcpMs >= n.responseStart && l.startTimeMs >= p.fcpMs, 'PAINT_TIMING');
  if (p.fpMs !== null) require(p.fpMs <= p.fcpMs, 'PAINT_ORDER');
  require(r.controlsReady && r.dataReady && r.mapConstructed && r.mapVisible && r.desktopPanelReady
    && r.visibleTileCount > 0 && r.visibleMarkerCount > 0 && !r.initialSkeletonVisible
    && r.desktopPanelAlertCount === 0 && r.desktopPopularItemCount > 0 && r.desktopLatestItemCount > 0 && within(r.observedAtMs), 'INCOMPLETE_CONTENT');
  for (const key of ['controlsReady', 'dataReady', 'mapConstructed', 'mapVisible', 'desktopPanelReady', 'initialSkeletonHidden']) {
    require(within(m[key]) && m[key] <= r.observedAtMs, `MILESTONE_${key}`);
  }
  require(s.milestoneCounts.restaurantCount > 0 && s.milestoneCounts.clusterInputCount > 0, 'CONTENT_COUNTS');
  require(m.dataError === null && m.naverSdkError === null && m.mapConstructionError === null && r.diagnosticErrors.length === 0, 'DIAGNOSTIC_ERROR');
  require(!c.resourceBufferOverflow && !c.entryCapReached && !s.resources.overflow, 'COLLECTOR_OVERFLOW');
  require(c.readinessSamples > 0 && c.readinessSamplingIntervalMs === 500, 'READINESS_SAMPLING');
  if (l) {
    require(near(l.ttfbMs, n?.responseStart), 'LCP_TTFB_BASIS');
    if (l.resourceApplicable && !l.timingDetailAvailable) {
      require(l.resourceRequestStartMs === null && l.resourceResponseEndMs === null
        && l.resourceLoadDelayMs === null && l.resourceLoadDurationMs === null && l.elementRenderDelayMs === null, 'LCP_UNKNOWN_AS_ZERO');
    } else {
      const req = l.resourceApplicable ? l.resourceRequestStartMs : n?.responseStart;
      const end = l.resourceApplicable ? l.resourceResponseEndMs : n?.responseStart;
      require(n && finite(n.responseStart) && finite(req) && finite(end) && end >= req && end <= l.startTimeMs
        && near(l.resourceLoadDelayMs, Math.max(0, req - n.responseStart))
        && near(l.resourceLoadDurationMs, Math.max(0, end - Math.max(req, n.responseStart)))
        && near(l.elementRenderDelayMs, Math.max(0, l.startTimeMs - Math.max(end, n.responseStart))), 'LCP_PART_ARITHMETIC');
    }
  }
  require(s.support.longTask === (s.longTasks !== null), 'LONGTASK_SUPPORT');
  if (s.longTasks) {
    const entries = s.longTasks.completedEntries;
    require(entries.every((entry) => entry.startTimeMs + entry.durationMs <= 20000.001), 'LONGTASK_AFTER_CUTOFF');
    require(s.longTasks.count === entries.length
      && near(s.longTasks.totalDurationMs, entries.reduce((a, v) => a + v.durationMs, 0))
      && near(s.longTasks.longTaskBlockingSumMs, entries.reduce((a, v) => a + Math.max(v.durationMs - 50, 0), 0))
      && near(s.longTasks.maxDurationMs, Math.max(0, ...entries.map((v) => v.durationMs))), 'LONGTASK_ARITHMETIC');
  }
  require(s.support.resource === (s.resources.byCategory !== null), 'RESOURCE_SUPPORT');
  const resources = s.resources.byCategory ?? [];
  require(new Set(resources.map((a) => a.category)).size === resources.length
    && resources.reduce((a, v) => a + v.count, 0) <= 2000, 'RESOURCE_COUNTS');
  for (const a of resources) {
    require(a.count === a.completedCount && a.knownTimingCount + a.unknownTimingCount === a.count
      && a.zeroTransferKnownCount + a.networkTransferKnownCount === a.knownTimingCount
      && finite(a.firstStartMs) && finite(a.lastResponseEndMs) && a.firstStartMs <= a.lastResponseEndMs
      && (a.networkTransferKnownCount > 0 || a.transferBytesKnown === 0), 'RESOURCE_ARITHMETIC');
  }
  return [...new Set(problems)].sort();
}

export function scalarValues(s) {
  return {
    ttfbMs: s?.navigation && finite(s.navigation.responseStart) && finite(s.navigation.startTime) ? s.navigation.responseStart - s.navigation.startTime : null,
    fcpMs: s?.paints?.fcpMs ?? null,
    windowLcpMs: s?.paints?.windowLcp?.startTimeMs ?? null,
    controlsReadyMs: s?.milestones?.controlsReady ?? null,
    mapVisibleMs: s?.milestones?.mapVisible ?? null,
    completedWindowLongTaskExcessMs: s?.longTasks?.crossingCutoffCount === 0 ? s.longTasks.longTaskBlockingSumMs : null,
  };
}

export function attribution(s) {
  const diff = (end, start) => finite(end) && finite(start) && end >= start ? end - start : null;
  const n = s.navigation ?? {}, m = s.milestones;
  const totals = (s.resources.byCategory ?? []).reduce((a, v) => {
    for (const key of Object.keys(a)) a[key] += v[key];
    return a;
  }, { knownTimingCount: 0, unknownTimingCount: 0, zeroTransferKnownCount: 0, networkTransferKnownCount: 0, transferBytesKnown: 0 });
  return {
    navigation: { dnsMs: diff(n.domainLookupEnd, n.domainLookupStart), connectionMs: diff(n.connectEnd, n.connectStart),
      tlsMs: n.secureConnectionStart > 0 ? diff(n.connectEnd, n.secureConnectionStart) : null,
      requestToFirstByteMs: diff(n.responseStart, n.requestStart), responseTransferMs: diff(n.responseEnd, n.responseStart), firstByteToFcpMs: diff(s.paints.fcpMs, n.responseStart) },
    lcp: s.paints.windowLcp,
    application: { dataFetchMs: diff(m.dataFetchCompleted, m.dataQueryStarted), dataMergeMs: diff(m.dataMergeCompleted, m.dataFetchCompleted),
      naverSdkMs: diff(m.naverSdkReady, m.naverSdkRequested), mapConstructionMs: diff(m.mapConstructed, m.mapConstructionStarted), clusterIndexMs: diff(m.clusterIndexReady, m.clusterIndexStarted) },
    cacheObservation: { control: 'unavailable', coverage: s.resources.byCategory === null ? 'unavailable' : 'completed-resources-only', ...totals, incompleteRequestCount: null },
    collector: { observerSetupMs: s.capture.observerSetupMs, observerWorkMs: s.capture.observerWorkMs, readinessWorkMs: s.capture.readinessWorkMs, readinessSamples: s.capture.readinessSamples, readinessSamplingIntervalMs: 500, frozenAtMs: s.capture.frozenAtMs },
    longTaskMetricUnavailableReason: !s.support.longTask ? 'unsupported' : !s.longTasks ? 'unavailable' : s.longTasks.crossingCutoffCount > 0 ? 'crossing-cutoff' : null,
  };
}

function walk(root, prefix) {
  if (!existsSync(resolve(root, prefix))) return [];
  const paths = [];
  for (const name of readdirSync(resolve(root, prefix)).sort()) {
    const path = `${prefix}/${name}`;
    safePath(path);
    const stat = lstatSync(resolve(root, path));
    check(!stat.isSymbolicLink(), 'input symlink');
    if (stat.isDirectory()) paths.push(...walk(root, path));
    else { check(stat.isFile(), 'non-file input'); paths.push(path); }
  }
  return paths;
}
export function createMap({ root = ROOT, stage, baselineMapSha256 }) {
  check(['before', 'final'].includes(stage), 'map stage must be before or final');
  const inputs = walk(root, 'inputs');
  const files = [...TOOL_PATHS, ...inputs.filter((path) => stage === 'final' || !path.startsWith('inputs/after/') && path !== 'inputs/phases/after.json')];
  let baseline = null;
  if (stage === 'final') {
    baseline = verifiedMap(root, 'baseline-artifact-map.json', baselineMapSha256);
    check(baseline.map.stage === 'before', 'baseline map stage');
    files.push('baseline-artifact-map.json');
  }
  const map = { schemaVersion: 'production-attribution.artifact-map.v1', stage, baselineMapSha256: stage === 'final' ? baselineMapSha256 : null,
    files: [...new Set(files)].sort().map((path) => { const bytes = read(root, path); return { path, sha256: hash(bytes), sizeBytes: bytes.length }; }) };
  if (baseline) for (const original of baseline.map.files) check(map.files.some((next) => same(next, original)), 'baseline evidence changed');
  const name = stage === 'before' ? 'baseline-artifact-map.json' : 'artifact-map.json';
  writeJson(root, name, map);
  return { artifactMap: name, artifactMapSha256: hash(read(root, name)), retainedFiles: map.files.length };
}
export function verifiedMap(root, name, expectedHash) {
  check(SHA.test(expectedHash ?? ''), 'detached expected artifact-map hash required');
  const bytes = read(root, name);
  check(hash(bytes) === expectedHash, 'artifact-map hash mismatch');
  const map = parse(bytes);
  check(map.schemaVersion === 'production-attribution.artifact-map.v1' && ['before', 'final'].includes(map.stage) && Array.isArray(map.files), 'artifact-map schema');
  const contents = new Map();
  for (const item of map.files) {
    check(!contents.has(item.path) && SHA.test(item.sha256) && Number.isSafeInteger(item.sizeBytes), 'artifact-map entry');
    const value = read(root, item.path);
    check(value.length === item.sizeBytes && hash(value) === item.sha256, 'mapped artifact changed');
    contents.set(item.path, value);
  }
  check(contents.has('protocol.json') && hash(contents.get('protocol.json')) === PROTOCOL_SHA256, 'frozen protocol changed');
  for (const path of TOOL_PATHS) check(contents.has(path), 'unmapped canonical tool');
  for (const path of contents.keys()) if (path.startsWith('inputs/')) check(/^inputs\/(?:cohort\.json|phases\/(?:before|after)\.json|(?:before|after)\/0[0-5]\.(?:receipt|snapshot)\.json)$/.test(path), 'unplanned input or replacement attempt');
  const expectedInputs = walk(root, 'inputs').filter((path) => map.stage === 'final' || !path.startsWith('inputs/after/') && path !== 'inputs/phases/after.json');
  check(expectedInputs.every((path) => contents.has(path)), 'unmapped retained attempt');
  return { map, contents, get: (path) => { check(contents.has(path), `unmapped input: ${path}`); return parse(contents.get(path)); } };
}

export function phaseProblems(frozen, phase, repository, protocol) {
  const issues = [];
  const require = (condition, name) => { if (!condition) issues.push(name); };
  const keys = ['schemaVersion', 'phase', 'frozenAtUtc', 'sourceSha', 'sourceTreeSha', 'deploymentId', 'projectId', 'canonicalHost', 'observerFiles', 'providerIdentity', 'healthIdentity'];
  require(frozen && Object.keys(frozen).length === keys.length && keys.every((key) => Object.hasOwn(frozen, key)), 'PHASE_SCHEMA');
  if (!frozen) return issues;
  require(frozen.schemaVersion === 'production-attribution.phase.v1' && frozen.phase === phase && frozen.canonicalHost === 'www.tzudong.app', 'PHASE_BINDING');
  require(COMMIT.test(frozen.sourceSha ?? '') && COMMIT.test(frozen.sourceTreeSha ?? ''), 'PHASE_SOURCE');
  require(/^dpl_[A-Za-z0-9]+$/.test(frozen.deploymentId ?? '') && /^prj_[A-Za-z0-9]+$/.test(frozen.projectId ?? ''), 'PHASE_DEPLOYMENT');
  require(timestamp(frozen.frozenAtUtc) !== null && timestamp(frozen.frozenAtUtc) >= timestamp(protocol.declaredAtUtc), 'PHASE_TIME');
  try {
    const tree = execFileSync('git', ['-C', repository, 'rev-parse', `${frozen.sourceSha}^{tree}`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
    require(tree === frozen.sourceTreeSha, 'GIT_TREE');
    require(Array.isArray(frozen.observerFiles) && same(frozen.observerFiles.map((v) => v.path), OBSERVER_PATHS), 'OBSERVER_FILES');
    for (const file of frozen.observerFiles ?? []) {
      require(OBSERVER_PATHS.includes(file.path) && SHA.test(file.sha256 ?? '') && Object.keys(file).length === 2, 'OBSERVER_FILE_SCHEMA');
      if (OBSERVER_PATHS.includes(file.path)) {
        const source = execFileSync('git', ['-C', repository, 'show', `${frozen.sourceSha}:${file.path}`], { stdio: ['ignore', 'pipe', 'pipe'] });
        require(hash(source) === file.sha256, 'OBSERVER_SOURCE_HASH');
      }
    }
  } catch { issues.push('GIT_OBJECT_UNAVAILABLE'); }
  for (const kind of ['providerIdentity', 'healthIdentity']) {
    const i = frozen[kind];
    const expectedKeys = kind === 'providerIdentity'
      ? ['observedAtUtc', 'observedVia', 'gitSha', 'deploymentId', 'projectId', 'target', 'state']
      : ['observedAtUtc', 'observedVia', 'gitSha', 'deploymentId', 'ok'];
    require(i && Object.keys(i).length === expectedKeys.length && expectedKeys.every((k) => Object.hasOwn(i, k)), 'IDENTITY_SCHEMA');
    require(i?.gitSha === frozen.sourceSha && i?.deploymentId === frozen.deploymentId, 'IDENTITY_SOURCE');
    require(timestamp(i?.observedAtUtc) !== null && timestamp(i?.observedAtUtc) <= timestamp(frozen.frozenAtUtc), 'IDENTITY_TIME');
    require(kind === 'providerIdentity' ? i?.projectId === frozen.projectId && i?.target === 'production' && i?.state === 'READY'
      && ['vercel-dashboard', 'vercel-tool', 'vercel-cli'].includes(i?.observedVia)
      : i?.ok === true && i?.observedVia === 'cua-public-health', 'IDENTITY_READBACK');
  }
  return [...new Set(issues)].sort();
}

export function argumentsOf(argv, flags) {
  const args = {};
  check(argv.length % 2 === 0, 'expected --name value pairs');
  for (let i = 0; i < argv.length; i += 2) {
    check(flags.includes(argv[i]) && !Object.hasOwn(args, argv[i]) && argv[i + 1] !== undefined, 'unknown or duplicate argument');
    args[argv[i]] = argv[i + 1];
  }
  return args;
}
