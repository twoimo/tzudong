export const FIELD_VITAL_NAMES = ['CLS', 'INP', 'LCP'] as const;
export type FieldVitalName = typeof FIELD_VITAL_NAMES[number];
export type FieldDevice = 'mobile' | 'desktop';
// web-vitals6.1.1 BFCache CLS reporting needs separate validation before admission.
export const FIELD_NAVIGATIONS = ['navigate', 'reload', 'back-forward', 'prerender', 'restore'] as const;
export type FieldNavigation = typeof FIELD_NAVIGATIONS[number];
export type FieldVitalSample = {
  version: 1;
  device: FieldDevice;
  metric: FieldVitalName;
  navigation: FieldNavigation;
  bucket: number;
  release: string;
};

// Fixed histograms keep distributions without retaining individual measurements.
// Overflow buckets are open ended; quantile reports must return interval bounds.
export const FIELD_BUCKETS = {
  CLS: { width: 0.01, overflow: 100 },
  INP: { width: 16, overflow: 200 },
  LCP: { width: 100, overflow: 120 },
} as const;

export function fieldVitalBucket(name: FieldVitalName, value: number): number | null {
  if (!Number.isFinite(value) || value < 0) return null;
  const spec = FIELD_BUCKETS[name];
  return Math.min(spec.overflow, Math.floor(value / spec.width));
}

export function parseFieldVitalSample(value: unknown): FieldVitalSample | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const data = value as Record<string, unknown>;
  if (Object.keys(data).sort().join(',') !== 'bucket,device,metric,navigation,release,version') return null;
  if (typeof data.release !== 'string' || !/^[a-f0-9]{40}$/.test(data.release)) return null;
  if (data.version !== 1 || typeof data.device !== 'string' || !['mobile', 'desktop'].includes(data.device)) return null;
  if (!FIELD_VITAL_NAMES.includes(data.metric as FieldVitalName)) return null;
  if (!FIELD_NAVIGATIONS.includes(data.navigation as FieldNavigation)) return null;
  const metric = data.metric as FieldVitalName;
  if (!Number.isSafeInteger(data.bucket) || (data.bucket as number) < 0
    || (data.bucket as number) > FIELD_BUCKETS[metric].overflow) return null;
  return data as FieldVitalSample;
}

export function shouldCollectFieldVitals(input: {
  production: boolean;
  hostname: string;
  pathname: string;
  search: string;
  webdriver: boolean;
}): boolean {
  if (!input.production || input.webdriver || input.pathname !== '/') return false;
  if (!['tzudong.app', 'www.tzudong.app'].includes(input.hostname)) return false;
  // Explicit QA query values remain in the browser and are never transmitted.
  return ![...new URLSearchParams(input.search).keys()].some(key => key.startsWith('__perf') || key === '__qa');
}

export function fieldQuantileInterval(
  name: FieldVitalName,
  histogram: ReadonlyArray<{ bucket: number; count: number }>,
  quantile: number,
): { n: number; lower: number; upper: number | null } | null {
  if (!(quantile > 0 && quantile <= 1) || histogram.length === 0) return null;
  const spec = FIELD_BUCKETS[name];
  if (histogram.some(x => !Number.isSafeInteger(x.count) || x.count <= 0
    || !Number.isSafeInteger(x.bucket) || x.bucket < 0 || x.bucket > spec.overflow)) return null;
  const n = histogram.reduce((sum, x) => sum + x.count, 0);
  if (!Number.isSafeInteger(n)) return null;
  const target = Math.ceil(n * quantile);
  let cumulative = 0;
  for (const row of [...histogram].sort((a, b) => a.bucket - b.bucket)) {
    cumulative += row.count;
    if (cumulative >= target) return {
      n,
      lower: row.bucket * spec.width,
      upper: row.bucket === spec.overflow ? null : (row.bucket + 1) * spec.width,
    };
  }
  return null;
}
