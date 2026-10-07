import { describe, expect, test } from 'bun:test';
import { buildAdminPendingCountsResponse } from '../lib/admin/pending-counts';
import {
  OPERATIONS_SOURCES,
  buildOperationsViewModel,
  filterOperationsRows,
  operationsUnavailable,
  parseOperationsSnapshot,
  parseGithubWorkflowState,
  type OperationsSnapshot,
} from '../lib/admin/operations-view-model';

const timestamp = '2026-10-04T00:00:00.000Z';
const uuid = '00000000-0000-4000-8000-000000000001';
const pending = () => buildAdminPendingCountsResponse({ restaurantSubmissions: 2, restaurantRecommendationRequests: 3, reviews: 4, recommendationRequestsLifecycleReady: true, asOf: timestamp });
const automation = () => ({ policy: { enabled: false, version: 1, batch_size: 50, daily_limit: 100, last_run_at: null as string | null }, queue: { queued: 0, running: 0, failed: 0 }, runs: [] as Array<{ id: string; started_at: string; scanned: number; approved: number; held: number; recheck: number; protected: number }>, items: [] });
const job = (id: string, status: string) => ({ id, status, target: 'tzuyang', profile: 'heavy_local' });
const pipeline = () => ({ source: 'job_api', jobs: [job(uuid, 'Queued')], failures: [] as ReturnType<typeof job>[] });
const getMetric = (snapshot: OperationsSnapshot, row: number, id: string) => snapshot.rows[row].metrics.find(item => item.id === id)?.value;

describe('operations read-model boundary', () => {
  test('canonical pending counts remain independent and are summed once', () => {
    const result = parseOperationsSnapshot('pending', pending());
    expect(result.state).toBe('ready');
    expect(result.rows.map(row => getMetric(result, result.rows.indexOf(row), 'pending'))).toEqual([2, 3, 4]);
    const auto = automation(); auto.queue.queued = 50;
    const model = buildOperationsViewModel({ pending: result, automation: parseOperationsSnapshot('automation', auto) });
    expect(model.summaries.find(item => item.id === 'pending')?.value).toBe(9);
    expect(result.rows.map(row => row.href)).toEqual(['/admin?module=submissions', '/admin?module=submissions', '/admin?module=reviews']);
  });

  test('lifecycle fallback is not advertised as scoped pending data', () => {
    const result = parseOperationsSnapshot('pending', buildAdminPendingCountsResponse({ restaurantSubmissions: 2, restaurantRecommendationRequests: 200, reviews: 4, recommendationRequestsLifecycleReady: false, asOf: timestamp }));
    expect(result.state).toBe('partial');
    expect(getMetric(result, 0, 'pending')).toBe(2);
    expect(getMetric(result, 1, 'pending')).toBeNull();
    expect(getMetric(result, 2, 'pending')).toBe(4);
    expect(result.rows[1].priority).toBe('attention');
    expect(buildOperationsViewModel({ pending: result }).summaries[0].value).toBeNull();
  });

  test('invalid numbers invalidate only their domain and never produce zero', () => {
    for (const invalid of [-1, 1.5, Infinity, NaN, Number.MAX_SAFE_INTEGER + 1, '3', null, undefined]) {
      const value = pending();
      Object.assign(value.domains.reviews, { count: invalid });
      const result = parseOperationsSnapshot('pending', value);
      expect(result.state).toBe('partial');
      expect(getMetric(result, 0, 'pending')).toBe(2);
      expect(result.rows[2].state).toBe('invalid');
      expect(getMetric(result, 2, 'pending')).toBeUndefined();
      expect(buildOperationsViewModel({ pending: result }).summaries[0].value).toBeNull();
    }
  });

  test('empty or changed schemas do not become ready zero snapshots', () => {
    for (const source of OPERATIONS_SOURCES) {
      for (const value of [null, [], {}, { configured: false }, { state: 'not_configured' }, { data: [] }]) {
        const result = parseOperationsSnapshot(source, value);
        expect(result.state).toBe('invalid');
        expect(result.rows.every(row => row.metrics.length === 0)).toBe(true);
      }
    }
    const result = parseOperationsSnapshot('pending', { submissions: 5, reviews: 4, domains: {} });
    expect(result.state).toBe('invalid');
    expect(buildOperationsViewModel({ pending: result }).summaries[0].value).toBeNull();
  });

  test('conflicting readiness, wrong domain identity and absent timestamp are visible', () => {
    const value = pending();
    value.recommendationRequestsLifecycleReady = false;
    Object.assign(value.domains.reviews, { id: 'renamed_reviews' });
    const result = parseOperationsSnapshot('pending', value);
    expect(getMetric(result, 1, 'pending')).toBeNull();
    expect(result.rows[2].state).toBe('invalid');
    expect(parseOperationsSnapshot('pending', { ...pending(), asOf: 'not-a-date' }).rows.every(row => row.state === 'partial')).toBe(true);
  });

  test('sum overflow remains unknown while safe individual maxima are preserved', () => {
    const value = pending(); value.domains.restaurant_submissions.count = Number.MAX_SAFE_INTEGER;
    const result = parseOperationsSnapshot('pending', value);
    expect(getMetric(result, 0, 'pending')).toBe(Number.MAX_SAFE_INTEGER);
    expect(buildOperationsViewModel({ pending: result }).summaries[0].value).toBeNull();
  });

  test('explicit empty canonical sources produce measured zeros', () => {
    const p = parseOperationsSnapshot('pending', buildAdminPendingCountsResponse({ restaurantSubmissions: 0, restaurantRecommendationRequests: 0, reviews: 0, recommendationRequestsLifecycleReady: true, asOf: timestamp }));
    const a = parseOperationsSnapshot('automation', automation());
    const pipe = parseOperationsSnapshot('pipeline', { source: 'job_api', jobs: [], failures: [] });
    const model = buildOperationsViewModel({ pending: p, automation: a, pipeline: pipe });
    expect(model.summaries.map(item => item.value)).toEqual([0, 0, 0]);
    expect(model.attentionCount).toBe(0);
    expect(a.rows[0].metrics.some(item => item.id === 'scanned')).toBe(false);
  });

  test('pipeline failure history is independent from active jobs and capped at 20', () => {
    const value = pipeline();
    value.jobs.push(job('running', 'Fetching'), job('inserting', 'Inserting'), job('paused', 'Paused'));
    value.failures = [job('failure', 'Failed')];
    let result = parseOperationsSnapshot('pipeline', value);
    expect(result.state).toBe('ready');
    expect(result.rows[0].priority).toBe('failure');
    expect(result.rows[0].metrics.map(item => item.value)).toEqual([1, 1, 2, 1]);
    value.failures = Array.from({ length: 20 }, (_, i) => job(`failed-${i}`, 'Failed'));
    result = parseOperationsSnapshot('pipeline', value);
    expect(getMetric(result, 0, 'failed')).toBe(20);
    expect(result.rows[0].details.length).toBe(3);
    value.failures.push(job('over-limit', 'Failed'));
    expect(parseOperationsSnapshot('pipeline', value).state).toBe('invalid');
  });

  test('unknown and duplicate jobs do not imply an empty active queue', () => {
    for (const jobs of [[job(uuid, 'Completed')], [null], [job(uuid, 'Queued'), job(uuid, 'Queued')]]) {
      const result = parseOperationsSnapshot('pipeline', { ...pipeline(), jobs });
      expect(result.state).toBe('partial');
      expect(getMetric(result, 0, 'queued')).toBeNull();
      expect(getMetric(result, 0, 'running')).toBeNull();
      expect(getMetric(result, 0, 'failed')).toBe(0);
    }
    for (const failures of [[job(uuid, 'Succeeded')], [null], [job(uuid, 'Failed'), job(uuid, 'Failed')]]) {
      const result = parseOperationsSnapshot('pipeline', { ...pipeline(), failures });
      expect(result.state).toBe('partial');
      expect(getMetric(result, 0, 'failed')).toBeNull();
      expect(getMetric(result, 0, 'queued')).toBe(1);
    }
  });

  test('GitHub fallback is limited and cannot assert global queue health', () => {
    const result = parseOperationsSnapshot('pipeline', { source: 'github_actions', jobs: [job('123', 'Failed')], failures: [{ errorCode: 'github_crawler', line: '1' }], githubRun: { id: '123', status: 'completed', conclusion: 'failure' } });
    expect(result.state).toBe('limited');
    expect(result.rows[0].priority).toBe('failure');
    expect(getMetric(result, 0, 'failed')).toBe(1);
    expect(getMetric(result, 0, 'queued')).toBeNull();
    expect(getMetric(result, 0, 'running')).toBeNull();
    expect(parseOperationsSnapshot('pipeline', { ...pipeline(), source: 'unknown' }).state).toBe('invalid');
    expect(parseOperationsSnapshot('pipeline', { source: 'github_actions', jobs: [], failures: [] }).state).toBe('invalid');
  });

  test('preserves GitHub conclusions while only confirmed failures raise the failure count', () => {
    for (const conclusion of ['success', 'failure', 'cancelled', 'skipped', 'neutral', 'timed_out', 'action_required', 'stale', 'startup_failure']) {
      const failed = ['failure', 'timed_out', 'startup_failure'].includes(conclusion);
      const state = parseGithubWorkflowState({ status: 'completed', conclusion });
      expect(state).toMatchObject({ status: 'completed', conclusion, failed });
      expect(state.jobStatus).toBe(failed ? 'Failed' : conclusion === 'success' ? 'Succeeded' : conclusion === 'cancelled' ? 'Cancelled' : 'Unknown');
      // Legacy normalized fields can be misleading: only the same run's raw status/conclusion is evidence.
      const result = parseOperationsSnapshot('pipeline', { source: 'github_actions', jobs: [job('123', 'Failed')], failures: [{ errorCode: 'github_crawler' }], githubRun: { id: '123', status: 'completed', conclusion } });
      expect(result.state).toBe('limited');
      expect(result.rows[0].priority).toBe(failed ? 'failure' : 'attention');
      expect(result.rows[0].metrics.map(item => item.value)).toEqual([Number(failed), null, null, null]);
      expect(buildOperationsViewModel({ pipeline: result }).summaries.find(item => item.id === 'pipeline')?.value).toBe(Number(failed));
    }
  });

  test('incomplete GitHub runs remain non-failures without asserting global progress', () => {
    for (const status of ['in_progress', 'queued', 'requested', 'waiting', 'pending', 'expected']) {
      const state = parseGithubWorkflowState({ status, conclusion: null });
      expect(state).toMatchObject({ status, conclusion: null, failed: false });
      expect(state.jobStatus).toBe(status === 'in_progress' ? 'Fetching' : status === 'expected' ? 'Unknown' : 'Queued');
      const result = parseOperationsSnapshot('pipeline', { source: 'github_actions', jobs: [job('123', 'Failed')], failures: [], githubRun: { id: '123', status, conclusion: null } });
      expect(result.state).toBe('limited');
      expect(result.rows[0].priority).toBe('attention');
      expect(result.rows[0].metrics.map(item => item.value)).toEqual([0, null, null, null]);
    }
    for (const status of ['failure', 'startup_failure']) {
      expect(parseGithubWorkflowState({ status, conclusion: null })).toMatchObject({ status, failed: true, jobStatus: 'Failed' });
    }
  });

  test('missing, future, contradictory or different-run evidence cannot manufacture failure or health', () => {
    const payload = { source: 'github_actions', jobs: [job('123', 'Failed')], failures: [{ errorCode: 'github_crawler' }] };
    for (const githubRun of [undefined, null, {}, { id: '124', status: 'completed', conclusion: 'failure' },
      ...[{ status: 'completed', conclusion: null }, { status: 'completed' }, { status: null, conclusion: 'failure' },
        { status: 'future', conclusion: 'failure' }, { status: 'in_progress', conclusion: 'success' },
        { status: 'queued', conclusion: 'failure' }, { status: 'startup_failure', conclusion: 'success' },
        { status: 'completed', conclusion: 'future' }, { status: 'constructor', conclusion: '__proto__' },
        { status: {}, conclusion: 'failure' }, { status: 'completed', conclusion: {} }].map(state => ({ id: '123', ...state }))]) {
      const result = parseOperationsSnapshot('pipeline', { ...payload, githubRun });
      expect(result.state).toBe('partial');
      expect(result.rows[0].priority).toBe('attention');
      expect(result.rows[0].metrics.map(item => item.value)).toEqual([null, null, null, null]);
    }
    const uncertain = parseOperationsSnapshot('pipeline', payload);
    expect(parseOperationsSnapshot('pipeline', { ...payload, githubRun: { id: '123', status: 'completed', conclusion: 'success' } }).rows[0].metrics[0].value).toBe(0);
    expect(uncertain.rows[0].metrics[0].value).toBeNull();
    for (const id of ['0', '-1', '1.2', '9007199254740992', 'private@example.test']) {
      expect(parseOperationsSnapshot('pipeline', { ...payload, jobs: [job(id, 'Failed')], githubRun: { id, status: 'completed', conclusion: 'failure' } }).rows[0].metrics[0].value).toBeNull();
    }
    for (const status of [undefined, null, 'FutureStatus', {}]) {
      expect(parseOperationsSnapshot('pipeline', { ...payload, jobs: [{ id: '123', status }], githubRun: { id: '123', status: 'completed', conclusion: 'failure' } }).state).toBe('partial');
    }
  });

  test('automation uses validated limits and picks the newest returned execution', () => {
    const value = automation();
    value.queue = { queued: 5, running: 2, failed: 1 };
    value.runs = [
      { id: uuid, started_at: '2026-10-02T00:00:00Z', scanned: 3, approved: 1, held: 2, recheck: 0, protected: 0 },
      { id: '00000000-0000-4000-8000-000000000002', started_at: timestamp, scanned: 10, approved: 4, held: 3, recheck: 2, protected: 1 },
    ];
    const result = parseOperationsSnapshot('automation', value);
    expect(result.state).toBe('ready');
    expect(result.rows[0].priority).toBe('failure');
    expect(result.rows[0].metrics.map(item => item.value)).toEqual([1, 5, 2, 10, 4, 3, 2, 1]);
    expect(result.rows[0].href).toBe('/admin?module=restaurants');
    for (const batch_size of [0, 201, -1, 1.5]) {
      expect(parseOperationsSnapshot('automation', { ...value, policy: { ...value.policy, batch_size } }).state).toBe('invalid');
    }
    expect(parseOperationsSnapshot('automation', { ...value, runs: Array(11).fill(value.runs[0]) }).state).toBe('invalid');
    expect(parseOperationsSnapshot('automation', { ...value, queue: { ...value.queue, failed: -1 } }).state).toBe('invalid');
  });

  test('source failures stay independent, sort before work queues, and refresh can recover', () => {
    const model = buildOperationsViewModel({ pending: parseOperationsSnapshot('pending', pending()), pipeline: operationsUnavailable('pipeline', 'unavailable'), automation: parseOperationsSnapshot('automation', { ...automation(), queue: { queued: 1, running: 0, failed: 2 } }) });
    expect(model.rows.map(row => row.id)).toEqual(['automation', 'pipeline', 'restaurant_submissions', 'restaurant_recommendation_requests', 'reviews']);
    expect(model.summaries.map(item => item.value)).toEqual([9, 2, null]);
    expect(model.attentionCount).toBe(2);
    const recovered = buildOperationsViewModel({ pipeline: parseOperationsSnapshot('pipeline', pipeline()) });
    expect(recovered.rows.find(row => row.id === 'pipeline')?.priority).toBe('waiting');
    for (const state of ['loading', 'forbidden', 'unavailable', 'invalid'] as const) {
      expect(buildOperationsViewModel({ pipeline: operationsUnavailable('pipeline', state) }).summaries[2].value).toBeNull();
    }
  });

  test('search and attention filters operate on the validated visible projection', () => {
    const rows = buildOperationsViewModel({ pending: parseOperationsSnapshot('pending', pending()), pipeline: operationsUnavailable('pipeline', 'forbidden') }).rows;
    expect(filterOperationsRows(rows, '  리뷰  ', false).map(row => row.id)).toEqual(['reviews']);
    expect(filterOperationsRows(rows, '', true).map(row => row.id)).toEqual(['pipeline']);
    expect(filterOperationsRows(rows, '리뷰', true)).toEqual([]);
  });

  test('raw diagnostics, arbitrary strings and identities are absent from the output', () => {
    const secret = 'RAW_DIAGNOSTIC_PRIVATE_SENTINEL';
    const values = {
      pending: { ...pending(), error: secret, diagnostics: secret },
      pipeline: { ...pipeline(), hardware: secret, dataEnv: secret, failureFrames: [{ module: secret }], jobs: [{ ...job(secret, 'Queued'), error_code: secret }] },
      automation: { ...automation(), error: secret, policyEvents: [{ operator_id: secret }], items: [{ id: uuid, restaurant_id: uuid, restaurant_name: secret, reason: 'source_unavailable', state: 'failed' }] },
    };
    for (const source of OPERATIONS_SOURCES) {
      const result = parseOperationsSnapshot(source, values[source]);
      expect(result.state).toBe('ready');
      expect(JSON.stringify(result)).not.toContain(secret);
      expect(JSON.stringify(result)).not.toContain(uuid);
    }
  });
});
