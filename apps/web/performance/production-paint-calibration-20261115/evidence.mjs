import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, existsSync, lstatSync, readdirSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';

export const VERSION = 'production-paint-calibration';
export const TOOL_FILES = ['protocol.json', 'README.md', 'snapshot.schema.json', 'evidence.mjs', 'record.mjs', 'analyze.mjs', 'validate.py', 'evidence.test.mjs'];
export const SOURCE_FILES = ['apps/web/lib/performance/paint-calibration-diagnostic.ts', 'apps/web/lib/performance/paint-calibration-request.ts', 'apps/web/lib/performance/paint-calibration-milestones.ts', 'apps/web/lib/performance/initial-load-milestones.ts'];
export const URL = 'https://www.tzudong.app/?__perf=paint-calibration';
export const OUTCOMES = ['captured', 'collector-unavailable', 'blocked-access', 'capture-unavailable', 'invalid-diagnostic-payload', 'not-executed-access-block'];
export const fail = (message) => { throw new Error(message); };
export const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
export const finite = (v) => typeof v === 'number' && Number.isFinite(v);
export const clone = (v) => JSON.parse(JSON.stringify(v));
export const hashPattern = /^[a-f0-9]{64}$/;
export const gitPattern = /^[a-f0-9]{40}$/;
export function filePath(root, path) {
  if (typeof path !== 'string' || path.includes('\\') || path.startsWith('/') || path.split('/').some((p) => !p || p === '.' || p === '..')) fail('Unsafe relative artifact path');
  const target = resolve(root, path);
  if (!target.startsWith(`${resolve(root)}${sep}`)) fail('Artifact path escapes root');
  let current = root;
  for (const part of path.split('/')) {
    current = join(current, part);
    if (existsSync(current) && lstatSync(current).isSymbolicLink()) fail('Artifact symlink is not accepted');
  }
  return target;
}
export function bytesAt(root, path) { return readFileSync(filePath(root, path)); }
export function parseJsonBytes(bytes) {
  const text = bytes.toString('utf8');
  const value = JSON.parse(text);
  const stack = [];
  for (let i = 0; i < text.length; i++) {
    const character = text[i];
    if (character === '"') {
      const start = i++;
      while (i < text.length) { if (text[i] === '\\') i += 2; else if (text[i] === '"') break; else i++; }
      const container = stack.at(-1);
      if (container?.object && container.expectsKey) {
        const key = JSON.parse(text.slice(start, i + 1));
        check(!container.keys.has(key), 'Duplicate JSON key rejected before persistence');
        container.keys.add(key); container.expectsKey = false;
      }
    } else if (character === '{' || character === '[') stack.push({ object: character === '{', expectsKey: character === '{', keys: new Set() });
    else if (character === '}' || character === ']') stack.pop();
    else if (character === ',' && stack.at(-1)?.object) stack.at(-1).expectsKey = true;
  }
  return value;
}
export function jsonAt(root, path) { return parseJsonBytes(bytesAt(root, path)); }
export function writeOnce(root, path, value) {
  const target = filePath(root, path);
  mkdirSync(dirname(target), { recursive: true });
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
  writeFileSync(target, bytes, { flag: 'wx' });
  return { path, sha256: sha(bytes), bytes: bytes.length };
}
export function descriptor(root, path) {
  const bytes = bytesAt(root, path);
  return { path, sha256: sha(bytes), bytes: bytes.length };
}
export function exactKeys(value, keys, label) {
  if (!value || Array.isArray(value) || typeof value !== 'object' || Object.keys(value).sort().join('|') !== [...keys].sort().join('|')) fail(`${label}: unexpected or missing keys`);
}
export function utc(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
}
export function check(condition, message) { if (!condition) fail(message); }
export function schemaProblems(value, schema, definitions = schema.$defs ?? {}, path = '$') {
  if (schema.$ref) return schemaProblems(value, definitions[schema.$ref.replace('#/$defs/', '')], definitions, path);
  if (schema.anyOf) return schema.anyOf.some((s) => schemaProblems(value, s, definitions, path).length === 0) ? [] : [`${path}: no allowed shape`];
  const problems = [];
  if (schema.const !== undefined && value !== schema.const) problems.push(`${path}: constant`);
  if (schema.enum && !schema.enum.includes(value)) problems.push(`${path}: enum`);
  if (schema.type === 'null' && value !== null) problems.push(`${path}: null`);
  if (schema.type === 'boolean' && typeof value !== 'boolean') problems.push(`${path}: boolean`);
  if (schema.type === 'number' || schema.type === 'integer') {
    if (!finite(value) || (schema.type === 'integer' && !Number.isInteger(value))) problems.push(`${path}: number`);
    else if (value < (schema.minimum ?? -Infinity) || value > (schema.maximum ?? Infinity)) problems.push(`${path}: number bounds`);
  }
  if (schema.type === 'string') {
    if (typeof value !== 'string') problems.push(`${path}: string`);
    else if ((schema.pattern && !new RegExp(schema.pattern).test(value)) || value.length > (schema.maxLength ?? Infinity)) problems.push(`${path}: string bounds`);
  }
  if (schema.type === 'array') {
    if (!Array.isArray(value)) problems.push(`${path}: array`);
    else {
      if (value.length > (schema.maxItems ?? Infinity) || value.length < (schema.minItems ?? 0)) problems.push(`${path}: array bounds`);
      value.forEach((v, i) => problems.push(...schemaProblems(v, schema.items, definitions, `${path}[${i}]`)));
    }
  }
  if (schema.type === 'object') {
    if (!value || typeof value !== 'object' || Array.isArray(value)) problems.push(`${path}: object`);
    else {
      for (const key of schema.required ?? []) if (!(key in value)) problems.push(`${path}.${key}: required`);
      for (const [key, v] of Object.entries(value)) {
        if (!Object.hasOwn(schema.properties, key)) problems.push(`${path}: unknown key`);
        else problems.push(...schemaProblems(v, schema.properties[key], definitions, `${path}.${key}`));
      }
    }
  }
  return problems;
}

export function validateIdentity(identity, sourceSha) {
  exactKeys(identity, ['providerIdentity', 'healthIdentity'], 'identity');
  const p = identity.providerIdentity;
  const h = identity.healthIdentity;
  exactKeys(p, ['observedAtUtc', 'observedVia', 'gitSha', 'deploymentId', 'projectId', 'target', 'state'], 'provider identity');
  exactKeys(h, ['observedAtUtc', 'observedVia', 'gitSha', 'deploymentId', 'ok'], 'health identity');
  check(utc(p.observedAtUtc) && utc(h.observedAtUtc), 'Actual identity timestamps required');
  check(['vercel-dashboard', 'vercel-tool', 'vercel-cli'].includes(p.observedVia) && h.observedVia === 'cua-public-health', 'Identity observation method');
  check(p.gitSha === sourceSha && h.gitSha === sourceSha && gitPattern.test(sourceSha), 'Source identity mismatch');
  check(/^dpl_[A-Za-z0-9]+$/.test(p.deploymentId) && p.deploymentId === h.deploymentId && /^prj_[A-Za-z0-9]+$/.test(p.projectId), 'Deployment identity mismatch');
  check(p.target === 'production' && p.state === 'READY' && h.ok === true, 'Production identity incomplete');
}
export function validatePlan(plan, root, repository, expectedProtocolSha) {
  exactKeys(plan, ['schemaVersion', 'frozenAtUtc', 'sourceSha', 'sourceTree', 'protocolSha256', 'browserSurface', 'browserVersion', 'plannedOrdinals', 'identity', 'sourceFiles', 'toolFiles'], 'plan');
  check(plan.schemaVersion === `${VERSION}.plan.v1` && utc(plan.frozenAtUtc), 'Plan version/time');
  check(gitPattern.test(plan.sourceSha) && gitPattern.test(plan.sourceTree), 'Full source SHA/tree required');
  check(hashPattern.test(expectedProtocolSha) && plan.protocolSha256 === expectedProtocolSha && sha(bytesAt(root, 'protocol.json')) === expectedProtocolSha, 'Frozen protocol mismatch');
  check(plan.browserSurface === 'cua-cloud-cdp' && plan.browserVersion === null && JSON.stringify(plan.plannedOrdinals) === '[1,2,3]', 'Planned conditions changed');
  validateIdentity(plan.identity, plan.sourceSha);
  check(Date.parse(plan.frozenAtUtc) >= Math.max(Date.parse(plan.identity.providerIdentity.observedAtUtc), Date.parse(plan.identity.healthIdentity.observedAtUtc)), 'Plan precedes identity readback');
  for (const [entries, paths, base] of [[plan.sourceFiles, SOURCE_FILES, repository], [plan.toolFiles, TOOL_FILES, root]]) {
    check(Array.isArray(entries) && entries.length === paths.length, 'Frozen file inventory mismatch');
    for (let i = 0; i < paths.length; i++) {
      exactKeys(entries[i], ['path', 'sha256', 'bytes'], 'file descriptor');
      check(JSON.stringify(entries[i]) === JSON.stringify(descriptor(base, paths[i])), 'Frozen source/tool bytes changed');
    }
  }
}

export function visitPaths(ordinal) {
  check(Number.isInteger(ordinal) && ordinal >= 1 && ordinal <= 3, 'Only planned ordinals 1, 2, 3 are allowed');
  const prefix = `inputs/${String(ordinal).padStart(2, '0')}`;
  return { raw: `${prefix}.snapshot.json`, receipt: `${prefix}.receipt.json` };
}
export function checkReceipt(receipt, ordinal, root, plan, snapshotSchema) {
  exactKeys(receipt, ['schemaVersion', 'ordinal', 'startedAtUtc', 'observedAtUtc', 'observedUrl', 'outcome', 'snapshot'], 'receipt');
  check(receipt.schemaVersion === `${VERSION}.receipt.v1` && receipt.ordinal === ordinal && OUTCOMES.includes(receipt.outcome), 'Receipt version/ordinal/outcome');
  const unattempted = receipt.outcome === 'not-executed-access-block';
  check(utc(receipt.observedAtUtc) && (unattempted ? receipt.startedAtUtc === null : utc(receipt.startedAtUtc)), 'Actual receipt times required');
  check(Date.parse(receipt.observedAtUtc) >= Date.parse(plan.frozenAtUtc), 'Receipt precedes plan');
  if (!unattempted) check(Date.parse(receipt.startedAtUtc) >= Date.parse(plan.frozenAtUtc) && Date.parse(receipt.observedAtUtc) >= Date.parse(receipt.startedAtUtc), 'Receipt clock order');
  check([URL, 'other', 'not-navigated'].includes(receipt.observedUrl) && (!unattempted || receipt.observedUrl === 'not-navigated'), 'Observed URL category');
  const paths = visitPaths(ordinal);
  if (receipt.outcome === 'captured') {
    exactKeys(receipt.snapshot, ['path', 'sha256', 'bytes'], 'snapshot descriptor');
    check(receipt.snapshot.path === paths.raw && JSON.stringify(receipt.snapshot) === JSON.stringify(descriptor(root, paths.raw)), 'Snapshot bytes changed after receipt');
    const raw = bytesAt(root, paths.raw);
    check(raw.length <= 262144, 'Snapshot exceeds bounded payload size');
    const snapshot = parseJsonBytes(raw);
    check(schemaProblems(snapshot, snapshotSchema).length === 0, 'Snapshot violates privacy/shape boundary');
    return snapshot;
  }
  check(receipt.snapshot === null && !existsSync(filePath(root, paths.raw)), 'Unavailable attempt cannot carry a fabricated snapshot');
  return null;
}

function listInputs(root, path = 'inputs') {
  return readdirSync(filePath(root, path), { withFileTypes: true }).flatMap((entry) => {
    const child = `${path}/${entry.name}`;
    if (entry.isDirectory()) return listInputs(root, child);
    check(entry.isFile() && !entry.isSymbolicLink(), 'Inputs must be ordinary files');
    return [child];
  }).sort();
}
export function expectedArtifacts(root) {
  const entries = ['inputs/plan.json'];
  for (const ordinal of [1, 2, 3]) {
    const paths = visitPaths(ordinal);
    entries.push(paths.receipt);
    if (jsonAt(root, paths.receipt).outcome === 'captured') entries.push(paths.raw);
  }
  check(JSON.stringify(listInputs(root)) === JSON.stringify([...entries].sort()), 'Unexpected or missing inputs; all planned attempts must be retained');
  return [...TOOL_FILES, ...entries].sort();
}
export function readSealed(root, repository, expectedMapSha, expectedProtocolSha) {
  check(hashPattern.test(expectedMapSha), 'Detached artifact map hash required');
  const bytes = bytesAt(root, 'artifact-map.json');
  check(sha(bytes) === expectedMapSha, 'Detached artifact map mismatch');
  const map = parseJsonBytes(bytes);
  exactKeys(map, ['schemaVersion', 'protocolSha256', 'items'], 'artifact map');
  check(map.schemaVersion === `${VERSION}.artifact-map.v1` && map.protocolSha256 === expectedProtocolSha, 'Map protocol/version mismatch');
  const expected = expectedArtifacts(root).map((path) => descriptor(root, path));
  check(JSON.stringify(map.items) === JSON.stringify(expected), 'Artifact inventory or bytes changed');
  const plan = jsonAt(root, 'inputs/plan.json');
  validatePlan(plan, root, repository, expectedProtocolSha);
  const schema = jsonAt(root, 'snapshot.schema.json');
  const visits = [1, 2, 3].map((ordinal) => {
    const receipt = jsonAt(root, visitPaths(ordinal).receipt);
    return { ordinal, receipt, snapshot: checkReceipt(receipt, ordinal, root, plan, schema) };
  });
  for (let i = 1; i < visits.length; i++) {
    const previous = visits[i - 1].receipt;
    const current = visits[i].receipt;
    check(Date.parse(current.observedAtUtc) >= Date.parse(previous.observedAtUtc), 'Receipts are out of planned order');
    if (current.startedAtUtc !== null) check(Date.parse(current.startedAtUtc) >= Date.parse(previous.observedAtUtc), 'Visits overlap or are out of planned order');
    if (current.outcome === 'not-executed-access-block') check(visits.slice(0, i).some((v) => v.receipt.outcome === 'blocked-access'), 'Unexecuted visit lacks prior access block');
  }
  return { map, plan, visits };
}

const rounded = (n) => Math.round(n * 1000) / 1000;
const firstTime = (entries) => entries.length ? Math.min(...entries.map((e) => e.startTimeMs)) : null;
const latest = (entries) => entries.reduce((last, current) => !last || current.startTimeMs >= last.startTimeMs ? current : last, null);
const windowFor = (t) => !finite(t) ? 'invalid' : t <= 20000 ? 'primary' : t <= 30000 ? 'tail' : 'outside';
const sameViewport = (a, b) => ['width', 'height', 'dpr'].every((key) => a[key] === b[key]);
export function snapshotConsistencyProblems(s) {
  const problems = [];
  const add = (bad, label) => { if (bad) problems.push(label); };
  add(!finite(s.capture.observerSetupMs) || s.capture.observerSetupMs > 20000, 'OBSERVER_SETUP_NOT_PRIMARY');
  add(!finite(s.capture.primaryCheckpointAtMs) || s.capture.primaryCheckpointAtMs < 20000 || !finite(s.capture.finalizedAtMs) || s.capture.finalizedAtMs < 30000, 'BOUNDARY_EARLY_OR_UNKNOWN');
  add(s.primary.observedAtMs !== s.capture.primaryCheckpointAtMs || !finite(s.late.observedAtMs) || s.late.observedAtMs < 30000 || !finite(s.capture.finalizedAtMs) || s.late.observedAtMs > s.capture.finalizedAtMs, 'BOUNDARY_TIMESTAMP_MISMATCH');
  for (const [segmentName, cutoff] of [['primary', 20000], ['late', 30000]]) {
    const segment = s[segmentName];
    for (const [type, key] of [['paint', 'paintEntries'], ['largest-contentful-paint', 'lcpEntries'], ['longtask', 'longTasks']]) {
      const stats = segment.observerStats[type];
      add(stats.callbackEntryCount + stats.drainedEntryCount !== stats.receivedEntryCount || stats.acceptedEntryCount > stats.receivedEntryCount || segment[key].length > stats.receivedEntryCount, `${segmentName}:${type}:COUNTERS`);
      add(stats.droppedByCapCount > 0 && !segment.entryCapReached, `${segmentName}:${type}:CAP_FLAG`);
      for (const e of segment[key]) {
        const accepted = e.startTimeMs <= cutoff && (type !== 'paint' || e.name !== 'other') && (type !== 'longtask' || e.endTimeMs <= cutoff);
        add(e.entryWindow !== windowFor(e.startTimeMs) || e.accepted !== accepted || !finite(e.receivedAtMs) || e.receivedAtMs + 1 < e.startTimeMs, `${segmentName}:${type}:ENTRY_BOUNDARY`);
        if (type === 'longtask') add(Math.abs(e.endTimeMs - e.startTimeMs - e.durationMs) > 0.01, `${segmentName}:LONG_TASK_ARITHMETIC`);
      }
    }
    for (const e of segment.paintTimeline.entries) add(e.entryWindow !== windowFor(e.startTimeMs), `${segmentName}:TIMELINE_BOUNDARY`);
    const c = segment.context;
    add(c.focusSampleCount !== c.focusTrueSampleCount + c.focusFalseSampleCount + c.focusUnknownSampleCount, `${segmentName}:FOCUS_COUNTERS`);
  }
  const f = s.primary.frames;
  add(f.requestedCount > 40 || f.completedCount !== f.samples.length || f.completedCount + Number(f.pendingAtPrimaryEnd) > f.requestedCount, 'FRAME_COUNTERS');
  for (const e of f.samples) add(!finite(e.callbackAtMs) || e.callbackAtMs + 1 < e.requestedAtMs || e.withinPrimary !== (e.callbackAtMs <= 20000), 'FRAME_SAMPLE');
  if (f.samples.length) add(!finite(f.maxDelayMs) || f.samples.some((e) => !finite(e.callbackAtMs)) || Math.abs(f.maxDelayMs - Math.max(...f.samples.map((e) => Math.max(0, e.callbackAtMs - e.requestedAtMs)))) > 0.01, 'FRAME_MAX_DELAY');
  for (const values of Object.values(s.primary.milestones)) add(Object.values(values).some((v) => finite(v) && v > 20000), 'MILESTONE_OUTSIDE_PRIMARY');
  return [...new Set(problems)].sort();
}
function paintSignals(s, name) {
  const primary = s.primary.paintEntries.filter((e) => e.name === name);
  const late = s.late.paintEntries.filter((e) => e.name === name);
  const all = [...primary, ...late];
  const primaryAccepted = primary.filter((e) => e.accepted && e.entryWindow === 'primary');
  const delayed = late.filter((e) => e.accepted && e.entryWindow === 'primary');
  const tail = all.filter((e) => e.entryWindow === 'tail');
  const timeline = ['primary', 'late'].flatMap((segment) => s[segment].paintTimeline.entries.filter((e) => e.name === name && finite(e.startTimeMs)));
  const timelineOnly = timeline.filter((e) => !all.some((o) => Math.abs(o.startTimeMs - e.startTimeMs) <= 1));
  const classifications = [];
  if (primaryAccepted.length) classifications.push('observed-by-primary-checkpoint');
  if (all.some((e) => e.entryWindow === 'primary' && finite(e.receivedAtMs) && e.receivedAtMs > 20000)) classifications.push('primary-window-entry-delivered-after-nominal-cutoff');
  if (delayed.length) classifications.push('primary-window-entry-delivered-after-checkpoint');
  if (tail.length) classifications.push('tail-window-entry-observed');
  if (timelineOnly.length) classifications.push('paint-timeline-without-corresponding-observer-entry');
  if (!all.length && !timeline.length) classifications.push('no-entry-observed-in-either-source');
  if (all.length && !primaryAccepted.length && !delayed.length && !tail.length) classifications.push('only-outside-window-observer-entry');
  return {
    primaryObserverMs: firstTime(primaryAccepted), delayedPrimaryObserverMs: firstTime(delayed), tailObserverMs: firstTime(tail),
    deliveredByNominalCutoffMs: firstTime(all.filter((e) => e.entryWindow === 'primary' && finite(e.receivedAtMs) && e.receivedAtMs <= 20000)),
    primaryTimelineMs: firstTime(s.primary.paintTimeline.entries.filter((e) => e.name === name && finite(e.startTimeMs))),
    finalTimelineMs: firstTime(s.late.paintTimeline.entries.filter((e) => e.name === name && finite(e.startTimeMs))),
    primaryWindowDeliveriesAfterNominalCutoffCount: all.filter((e) => e.entryWindow === 'primary' && finite(e.receivedAtMs) && e.receivedAtMs > 20000).length,
    timelineOnlyEventTimesMs: [...new Set(timelineOnly.map((e) => e.startTimeMs))].sort((a, b) => a - b),
    classifications,
  };
}
function lcpSignals(s) {
  const all = [...s.primary.lcpEntries, ...s.late.lcpEntries];
  const primary = s.primary.lcpEntries.filter((e) => e.accepted && e.entryWindow === 'primary');
  const delayed = s.late.lcpEntries.filter((e) => e.accepted && e.entryWindow === 'primary');
  const tail = all.filter((e) => e.entryWindow === 'tail');
  const classifications = [];
  if (primary.length) classifications.push('observed-by-primary-checkpoint');
  if (all.some((e) => e.entryWindow === 'primary' && finite(e.receivedAtMs) && e.receivedAtMs > 20000)) classifications.push('primary-window-entry-delivered-after-nominal-cutoff');
  if (delayed.length) classifications.push('primary-window-entry-delivered-after-checkpoint');
  if (tail.length) classifications.push('tail-window-entry-observed');
  if (!all.length) classifications.push('no-observer-candidate');
  if (all.length && !primary.length && !delayed.length && !tail.length) classifications.push('only-outside-window-observer-entry');
  return {
    primaryCandidate: latest(primary), delayedPrimaryCandidate: latest(delayed), tailCandidate: latest(tail),
    deliveredByNominalCutoffCandidate: latest(all.filter((e) => e.entryWindow === 'primary' && finite(e.receivedAtMs) && e.receivedAtMs <= 20000)),
    primaryLatestCardCandidateCount: primary.filter((e) => e.region === 'desktop-latest-card').length,
    lateDeliveredLatestCardCandidateCount: s.late.lcpEntries.filter((e) => e.region === 'desktop-latest-card').length,
    primaryWindowDeliveriesAfterNominalCutoffCount: all.filter((e) => e.entryWindow === 'primary' && finite(e.receivedAtMs) && e.receivedAtMs > 20000).length,
    classifications,
  };
}
export function classifySnapshot(s, plan, receipt, viewportReference) {
  const contextProblems = [];
  if (s.binding.gitSha !== plan.sourceSha || s.binding.hostname !== 'www.tzudong.app' || receipt.observedUrl !== URL) contextProblems.push('SOURCE_OR_URL_BINDING');
  if (!s.navigation || s.navigation.type !== 'navigate' || s.navigation.redirectCount !== 0 || (s.navigation.activationStartMs !== null && s.navigation.activationStartMs !== 0)) contextProblems.push('NAVIGATION_CONTEXT');
  if (Object.values(s.viewport.initial).some((v) => !finite(v) || v <= 0)) contextProblems.push('VIEWPORT_UNAVAILABLE');
  if (!sameViewport(s.viewport.initial, s.viewport.primary) || !sameViewport(s.viewport.initial, s.viewport.final)) contextProblems.push('VIEWPORT_CHANGED_WITHIN_VISIT');
  if (viewportReference && !sameViewport(s.viewport.initial, viewportReference)) contextProblems.push('VIEWPORT_DIFFERS_FROM_REFERENCE');
  for (const segment of ['primary', 'late']) {
    const c = s[segment].context;
    if (!c.contextUnchanged) contextProblems.push('URL_CONTEXT_CHANGED');
    if (c.visibilityAtSetup !== 'visible' || c.visibilityAtRead !== 'visible' || c.firstHiddenAtMs !== null) contextProblems.push('VISIBILITY_CHANGED_OR_HIDDEN');
    if (c.trustedInputCount > 0 || c.firstTrustedInputAtMs !== null) contextProblems.push('TRUSTED_INPUT_OBSERVED');
    if (c.resizeCount > 0 || c.firstResizeAtMs !== null) contextProblems.push('RESIZE_OBSERVED');
    if (c.prerenderingAtSetup || c.wasDiscarded) contextProblems.push('PRERENDERED_OR_DISCARDED_CONTEXT');
  }
  const limitations = [];
  for (const [key, supported] of Object.entries(s.support)) if (!supported) limitations.push(`UNSUPPORTED:${key}`);
  for (const segmentName of ['primary', 'late']) {
    const segment = s[segmentName];
    if (segment.entryCapReached) limitations.push(`${segmentName}:ENTRY_CAP`);
    if (segment.paintTimeline.capReached || segment.paintTimeline.readError) limitations.push(`${segmentName}:TIMELINE_INCOMPLETE`);
    limitations.push(...segment.errors.map((error) => `${segmentName}:${error}`));
    for (const [type, stats] of Object.entries(segment.observerStats)) {
      if (!stats.registered) limitations.push(`${segmentName}:${type}:NOT_REGISTERED`);
      if (stats.invalidEntryCount || stats.handlerErrorCount) limitations.push(`${segmentName}:${type}:ENTRY_OR_HANDLER_ERRORS`);
    }
  }
  const f = s.primary.frames;
  const withinPrimaryCompletedCount = f.samples.filter((e) => e.withinPrimary && finite(e.callbackAtMs) && e.callbackAtMs <= 20000).length;
  const frameClassification = !s.support.animationFrame ? 'unsupported' : f.requestedCount === 0 ? 'no-request-observed'
    : f.completedCount === 0 ? (f.pendingAtPrimaryEnd ? 'pending-with-no-completion' : 'requested-with-no-completion')
      : withinPrimaryCompletedCount === 0 ? 'frame-callbacks-only-after-nominal-cutoff'
        : f.pendingAtPrimaryEnd ? 'primary-progress-with-pending-at-checkpoint' : 'primary-frame-callback-progress-observed';
  const phaseDurationsMs = {};
  const pairs = {
    desktopImplementation: ['criticalPath', 'desktopImplementationLoadStarted', 'desktopImplementationLoadReady'],
    mobileImplementation: ['criticalPath', 'mobileImplementationLoadStarted', 'mobileImplementationLoadReady'],
    latestRows: ['criticalPath', 'latestQueryStarted', 'latestRestaurantRowsReady'],
    latestBeforeKpi: ['criticalPath', 'latestRestaurantRowsReady', 'latestKpiStarted'],
    latestKpi: ['criticalPath', 'latestKpiStarted', 'latestKpiReady'],
    latestSort: ['criticalPath', 'latestKpiReady', 'latestSortReady'],
    latestCardCommitAfterSort: ['criticalPath', 'latestSortReady', 'latestFirstCardCommitted'],
    homeDataFetch: ['initialLoad', 'dataQueryStarted', 'dataFetchCompleted'],
    homeDataMerge: ['initialLoad', 'dataFetchCompleted', 'dataMergeCompleted'],
    homeFirstIndexQueue: ['initialLoad', 'dataReady', 'clusterIndexStarted'],
  };
  for (const [name, [group, start, end]] of Object.entries(pairs)) {
    const a = s.primary.milestones[group][start]; const b = s.primary.milestones[group][end];
    phaseDurationsMs[name] = finite(a) && finite(b) && b >= a ? rounded(b - a) : null;
    if (finite(a) && finite(b) && b < a) limitations.push(`MILESTONE_ORDER:${name}`);
  }
  return {
    actualViewport: s.viewport, contextProblems: [...new Set(contextProblems)].sort(),
    consistencyProblems: snapshotConsistencyProblems(s), limitations: [...new Set(limitations)].sort(),
    boundaries: { observerSetupMs: s.capture.observerSetupMs, primaryCheckpointAtMs: s.capture.primaryCheckpointAtMs, finalizedAtMs: s.capture.finalizedAtMs },
    fp: paintSignals(s, 'first-paint'), fcp: paintSignals(s, 'first-contentful-paint'), lcp: lcpSignals(s),
    frame: { classification: frameClassification, requestedCount: f.requestedCount, completedCount: f.completedCount, withinPrimaryCompletedCount, afterNominalCutoffCompletedCount: f.samples.filter((e) => finite(e.callbackAtMs) && e.callbackAtMs > 20000).length, skippedPendingCount: f.skippedPendingCount, pendingAtPrimaryEnd: f.pendingAtPrimaryEnd, maxDelayMs: f.maxDelayMs,
      pendingDurationAtCheckpointMs: f.pendingAtPrimaryEnd && finite(f.pendingRequestedAtMs) && finite(s.capture.primaryCheckpointAtMs) ? rounded(s.capture.primaryCheckpointAtMs - f.pendingRequestedAtMs) : null },
    focusAndVisibility: { primary: s.primary.context, final: s.late.context },
    phaseDurationsMs, primaryReadiness: s.primary.readiness,
    costMs: { primaryObserver: s.primary.observerWorkMs, lateObserver: s.late.observerWorkMs, frameProbe: f.workMs, checkpointReadback: s.primary.readbackWorkMs },
  };
}
export function analyzeVisits(bundle, mapSha, protocolSha) {
  const reference = bundle.visits.find((v) => v.snapshot)?.snapshot.viewport.initial ?? null;
  const visits = bundle.visits.map(({ ordinal, receipt, snapshot }) => ({
    ordinal, outcome: receipt.outcome, snapshotSha256: receipt.snapshot?.sha256 ?? null,
    observation: snapshot ? classifySnapshot(snapshot, bundle.plan, receipt, reference) : null,
  }));
  return {
    schemaVersion: `${VERSION}.analysis.v1`, status: 'diagnostic-only-no-performance-admission',
    artifactMapSha256: mapSha, protocolSha256: protocolSha, sourceSha: bundle.plan.sourceSha,
    plannedVisitCount: 3, retainedReceiptCount: visits.length, retainedSnapshotCount: visits.filter((v) => v.observation).length,
    viewportReference: reference, visits,
    admission: { performanceComparisonCount: 0, fieldAdmissionCount: 0, g003AdmissionCount: 0, lighthouseAdmissionCount: 0, legacyTtiMs: null },
    unknowns: ['No causal attribution from focus/frame correlation alone.', 'Paint timeline does not replace observer FCP.', 'Region is bounded delivery-time context, not a stable DOM identity.', 'No controlled cold-cache, CPU, network, mobile or human-population inference.', 'Critical paths can overlap; their durations must not be summed.', 'Earlier series remain unchanged.'],
  };
}
