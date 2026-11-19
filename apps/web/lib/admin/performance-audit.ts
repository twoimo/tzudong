import snapshot from './performance-audit-snapshot.json';

export type AuditMode = 'legacy' | 'rpc';
export type AuditMetric = 'external' | 'handler' | 'request' | 'database';
export type AuditPhase = {
  mode: string;
  startedAtUtc: string;
  completedAtUtc: string;
  receiptSha256: string;
  metricsMs: Record<string, number[] | undefined>;
};

/** A versioned, sanitized observation, never a live service-health assertion. */
export const performanceAuditSnapshot = snapshot;

export function summarizeAuditValues(values: readonly number[]) {
  if (!values.length || values.some(value => !Number.isFinite(value) || value < 0)) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
  return { count: values.length, median, min: sorted[0], max: sorted[sorted.length - 1] };
}

export function getAuditValues(phase: AuditPhase, metric: AuditMetric): number[] | null {
  if (metric === 'external') return phase.metricsMs.externalTotal ?? null;
  if (metric === 'handler') return phase.metricsMs['kpi-handler'] ?? null;
  if (metric === 'database') return phase.metricsMs['kpi-db-total'] ?? null;
  if (phase.mode === 'rpc') return phase.metricsMs['kpi-rpc-request'] ?? null;
  const bucket = phase.metricsMs['kpi-bucket-request'];
  const rows = phase.metricsMs['kpi-rows-request'];
  if (!bucket || !rows || bucket.length !== rows.length) return null;
  // Add spans from the same request before summarizing. Adding medians is invalid.
  return bucket.map((value, index) => Math.round((value + rows[index]) * 1000) / 1000);
}

export function getAuditResidual(phase: AuditPhase): number[] | null {
  const request = getAuditValues(phase, 'request');
  const database = getAuditValues(phase, 'database');
  if (!request || !database || request.length !== database.length) return null;
  return request.map((value, index) => Math.round((value - database[index]) * 1000) / 1000);
}

export function getAuditComparison(metric: AuditMetric) {
  const legacy = snapshot.phases.find(phase => phase.mode === 'legacy');
  const rpc = snapshot.phases.find(phase => phase.mode === 'rpc');
  const beforeValues = legacy && getAuditValues(legacy, metric);
  const afterValues = rpc && getAuditValues(rpc, metric);
  const before = beforeValues ? summarizeAuditValues(beforeValues) : null;
  const after = afterValues ? summarizeAuditValues(afterValues) : null;
  return {
    before,
    after,
    differenceMs: before && after ? before.median - after.median : null,
    percentLower: before && after && before.median > 0
      ? (before.median - after.median) / before.median * 100 : null,
  };
}

export const AUDIT_METRIC_LABELS: Record<AuditMetric, string> = {
  external: '요청 전체', handler: '서버 처리', request: '데이터 요청 대기', database: 'DB 내부 처리',
};

export function formatAuditMs(value: number | null | undefined) {
  return value == null ? '미측정' : new Intl.NumberFormat('ko-KR', { maximumFractionDigits: 3 }).format(value);
}

export function formatAuditDate(value: string) {
  return new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).format(new Date(value));
}
