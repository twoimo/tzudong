export const DEFAULT_INTERVAL_MS = 20;
export const MAX_GAP_MS = 60;

export function createSamplerState() {
  return { samples: 0, peakRssBytes: 0, maximumGapMs: 0, lastMonotonicMs: null, invalidReasons: [], identities: new Map(), rootEstablished: false };
}

export function nextDeadlineDelayMs(deadlineMs, elapsedMs) {
  if (!Number.isFinite(deadlineMs) || !Number.isFinite(elapsedMs)) throw new Error('Sampling deadline values must be finite');
  return Math.max(0, Math.floor(deadlineMs - elapsedMs));
}

export function enrichSample(sample, state, configuration, samplerIdentity = String(process.pid)) {
  const errors = Array.isArray(sample.errors) && sample.errors.every((error) => typeof error === 'string') ? [...sample.errors] : ['malformed-sample-errors'];
  const rows = Array.isArray(sample.processes) ? sample.processes : [];
  const processes = rows.filter((row) => Number.isInteger(row?.pid) && row.pid > 0 && Number.isInteger(row.parentPid) && row.parentPid >= 0 && typeof row.startIdentity === 'string' && /^\d+$/.test(row.startIdentity) && typeof row.rssBytes === 'number' && Number.isSafeInteger(row.rssBytes) && row.rssBytes >= 0);
  if (processes.length !== rows.length) errors.push('malformed-process-identity');
  const root = processes.find((row) => row.pid === configuration.rootPid);
  if (!root) errors.push('missing-root-identity');
  if (!configuration.rootStartIdentity) {
    if (root) {
      configuration.rootStartIdentity = root.startIdentity;
      state.rootEstablished = true;
    } else {
      errors.push('root-identity-not-established');
    }
  }
  if (root && root.startIdentity !== configuration.rootStartIdentity) errors.push('root-identity-reused');
  for (const row of processes) {
    const priorIdentity = state.identities.get(row.pid);
    if (priorIdentity && priorIdentity !== row.startIdentity) errors.push(row.pid === configuration.rootPid ? 'root-identity-reused' : 'process-identity-reused');
    state.identities.set(row.pid, row.startIdentity);
  }

  const monotonicMs = sample.monotonicMs;
  const observedGapMs = state.lastMonotonicMs === null ? 0 : monotonicMs - state.lastMonotonicMs;
  if (typeof monotonicMs !== 'number' || !Number.isFinite(monotonicMs) || monotonicMs < 0 || !Number.isFinite(observedGapMs) || observedGapMs < 0 || observedGapMs > MAX_GAP_MS) errors.push('sampling-gap-exceeded');
  state.lastMonotonicMs = monotonicMs;
  const total = sample.totalPhysicalBytes; const available = sample.availablePhysicalBytes;
  const hostPressurePercent = typeof total === 'number' && typeof available === 'number' && Number.isSafeInteger(total) && Number.isSafeInteger(available) && total > 0 && available >= 0 && available <= total ? ((total - available) * 100) / total : Number.NaN;
  if (!Number.isFinite(hostPressurePercent) || hostPressurePercent > 80.000) errors.push('host-memory-pressure');
  let rootStart = 0n;
  try { rootStart = configuration.rootStartIdentity ? BigInt(configuration.rootStartIdentity) : 0n; } catch { errors.push('malformed-root-identity'); }
  const included = processes.filter((row) => BigInt(row.startIdentity) >= rootStart);
  const includedRssBytes = included.reduce((sum, row) => sum + row.rssBytes, 0);
  if (!Number.isSafeInteger(includedRssBytes) || !Number.isFinite(includedRssBytes)) errors.push('invalid-included-rss');
  state.samples += 1;
  state.peakRssBytes = Math.max(state.peakRssBytes, includedRssBytes);
  state.maximumGapMs = Math.max(state.maximumGapMs, observedGapMs);
  state.invalidReasons.push(...errors);
  return { ...sample, rootIdentity: configuration.rootStartIdentity ?? null, samplerIdentity, processes, included: included.map((row) => `${row.pid}:${row.startIdentity}`), includedRssBytes, hostPressurePercent, observedGapMs, errors };
}

export function createTerminalSummary(state, configuration, requestedIntervalMs, output, terminalObserved) {
  const invalidReasons = [...new Set(state.invalidReasons)].sort();
  return { schemaVersion: 2, rootPid: configuration.rootPid, rootStartIdentity: configuration.rootStartIdentity ?? null, requestedIntervalMs, maximumAllowedGapMs: MAX_GAP_MS, samples: state.samples, peakRssBytes: state.peakRssBytes, maximumGapMs: state.maximumGapMs, terminalObserved: terminalObserved === true, valid: terminalObserved === true && state.samples >= 3 && invalidReasons.length === 0, invalidReasons, output };
}
