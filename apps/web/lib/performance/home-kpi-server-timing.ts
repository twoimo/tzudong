export type HomeKpiQueryMode = 'legacy' | 'rpc';

export type HomeYouTubeKpiObservation =
  | {
    name: 'bucketRequest' | 'rowsRequest' | 'rpcRequest' | 'dbBucket' | 'dbRows' | 'dbTotal';
    durationMs: number;
  }
  | { name: 'dbTimingInvalid' };

type DurationName = Exclude<HomeYouTubeKpiObservation['name'], 'dbTimingInvalid'>;
type Clock = () => number;

const DURATION_HEADERS: Readonly<Record<DurationName, string>> = {
  // Legacy request spans include SDK, transport and database work. They are
  // not database-only durations and must not be compared as such.
  bucketRequest: 'kpi-bucket-request',
  rowsRequest: 'kpi-rows-request',
  rpcRequest: 'kpi-rpc-request',
  dbBucket: 'kpi-db-bucket',
  dbRows: 'kpi-db-rows',
  dbTotal: 'kpi-db-total',
};
const DURATION_NAMES = Object.keys(DURATION_HEADERS) as DurationName[];
const DATABASE_NAMES = new Set<DurationName>(['dbBucket', 'dbRows', 'dbTotal']);

export function resolveHomeKpiQueryMode(value: unknown): HomeKpiQueryMode | null {
  if (value === undefined) return 'rpc';
  return value === 'legacy' || value === 'rpc' ? value : null;
}

function validDuration(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
    && value >= 0 && value <= Number.MAX_SAFE_INTEGER;
}

function readClock(clock: Clock): number | null {
  try {
    const value = clock();
    return validDuration(value) ? value : null;
  } catch {
    return null;
  }
}

function elapsed(start: number | null, end: number | null): number | null {
  if (start === null || end === null) return null;
  const duration = end - start;
  return validDuration(duration) ? duration : null;
}

function formatDuration(value: number): string {
  // Fixed precision and a representable finite range keep numeric output
  // bounded; no caller-controlled names, descriptions or source data survive.
  return value.toFixed(3).replace(/\.?0+$/, '') || '0';
}

export function createHomeKpiServerTiming(clock: Clock = () => performance.now()) {
  const handlerStartedAt = readClock(clock);
  const durations = new Map<DurationName, number>();
  let bodyDuration: number | null = null;
  let databaseTimingInvalid = false;

  const invalidateDatabaseTiming = () => {
    databaseTimingInvalid = true;
    for (const name of DATABASE_NAMES) durations.delete(name);
  };

  const observe = (event: HomeYouTubeKpiObservation): void => {
    // Observation is subordinate to the data result, including malformed
    // instrumentation values or throwing accessors. Never log the event.
    let databaseEvent = false;
    let observedName: DurationName | null = null;
    try {
      const name = event?.name;
      if (name === 'dbTimingInvalid') {
        invalidateDatabaseTiming();
        return;
      }
      if (!DURATION_NAMES.includes(name as DurationName)) return;
      const durationName = name as DurationName;
      observedName = durationName;
      databaseEvent = DATABASE_NAMES.has(durationName);
      if (databaseEvent && databaseTimingInvalid) return;
      const duration = (event as { durationMs?: unknown }).durationMs;
      if (!validDuration(duration)) {
        if (databaseEvent) invalidateDatabaseTiming();
        else durations.delete(durationName);
        return;
      }
      durations.set(durationName, duration);
    } catch {
      if (databaseEvent) invalidateDatabaseTiming();
      else if (observedName !== null) durations.delete(observedName);
    }
  };

  const beginBody = (): (() => void) => {
    // Includes bounded stream-read/parse time after handler entry, which can
    // include waiting for incoming body bytes. It is not upload-only timing.
    const startedAt = readClock(clock);
    let finished = false;
    return () => {
      if (finished) return;
      finished = true;
      bodyDuration = elapsed(startedAt, readClock(clock));
    };
  };

  const header = (mode: HomeKpiQueryMode | null): string => {
    const values = [mode === 'legacy' || mode === 'rpc'
      ? `kpi-mode;desc="${mode}"` : 'kpi-mode-invalid'];
    // Header creation precedes Response.json: this span excludes serialization,
    // response flush, client roundtrip and upload/cold-start work before POST.
    const handlerDuration = elapsed(handlerStartedAt, readClock(clock));
    if (bodyDuration !== null) values.push(`kpi-body;dur=${formatDuration(bodyDuration)}`);
    if (handlerDuration !== null) values.push(`kpi-handler;dur=${formatDuration(handlerDuration)}`);
    for (const name of DURATION_NAMES) {
      const duration = durations.get(name);
      if (duration !== undefined) values.push(`${DURATION_HEADERS[name]};dur=${formatDuration(duration)}`);
    }
    // A marker has no duration. Zero remains a measured duration, not an alias
    // for missing or invalid database wall-clock observations.
    if (databaseTimingInvalid) values.push('kpi-db-invalid');
    return values.join(', ');
  };

  return { observe, beginBody, header };
}
