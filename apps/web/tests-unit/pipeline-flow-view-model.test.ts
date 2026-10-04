import { describe, expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildPipelineStages, canControlPipelineJob, parsePipelineManifest, parsePipelineStatus, pipelineJobsForDisplay, PIPELINE_FLOW_DOCUMENT, PIPELINE_FLOW_EDGES, PIPELINE_FLOW_STAGES } from '../lib/admin/pipeline-flow-view-model';
import { parsePipelineActionPreview, pipelineApplyBody, type PipelineActionInput } from '../lib/admin/pipeline-action-preview';
import { assertPipelineGuardedBody, buildPipelinePreviewHash, PIPELINE_CONTROL_CONFIRMATION_TEXT, PIPELINE_LIVE_ENQUEUE_CONFIRMATION } from '../lib/admin/pipeline-control';
const id = '22222222-2222-4222-8222-222222222222';
const job = { id, target: 'tzuyang', profile: 'heavy_local', status: 'Fetching', dry_run: true, adapter_index: 0 };
const status = (overrides: Record<string, unknown> = {}) => ({ source: 'job_api', jobs: [job], targets: [{ id: 'tzuyang', status: 'Fetching' }], failures: [], ...overrides });
const events = PIPELINE_FLOW_STAGES.flatMap(stage => stage.steps.map(name => ({ name, status: 'completed', durationSeconds: 1.5 })));
const manifest = (steps: unknown = events, overrides: Record<string, unknown> = {}) => parsePipelineManifest({ runDaily: { manifestStatus: 'available', stepEvents: steps, checkedAt: '2026-10-04T00:00:00Z', stale: false, ...overrides } });
const stage = (id: string, steps: unknown) => buildPipelineStages(manifest(steps)).find(stage => stage.id === id)!;

describe('pipeline manifest projection', () => {
  test('canonical steps and evidence paths exist; app and document share an acyclic DAG', () => {
    const root = resolve(process.cwd(), '../..');
    const graph = readFileSync(resolve(root, 'backend/pipeline_control/graph.py'), 'utf8');
    for (const s of PIPELINE_FLOW_STAGES) { expect(existsSync(resolve(root, s.source))).toBe(true); for (const name of s.steps) expect(graph.includes(`"${name}"`)).toBe(true); }
    const doc = JSON.parse(readFileSync(resolve(root, PIPELINE_FLOW_DOCUMENT), 'utf8'));
    expect(doc.nodes.map((n: { id: string }) => n.id).sort()).toEqual(PIPELINE_FLOW_STAGES.map(s => s.id).sort());
    expect(doc.flows.map((e: { from: string; to: string }) => `${e.from}:${e.to}`).sort()).toEqual(PIPELINE_FLOW_EDGES.map(e => `${e.from}:${e.to}`).sort());
    const degrees = new Map(PIPELINE_FLOW_STAGES.map(s => [s.id, 0]));
    for (const edge of PIPELINE_FLOW_EDGES) degrees.set(edge.to, degrees.get(edge.to)! + 1);
    const queue = [...degrees.keys()].filter(id => degrees.get(id) === 0), visited: string[] = [];
    while (queue.length) { const id = queue.shift()!; visited.push(id); for (const edge of PIPELINE_FLOW_EDGES.filter(e => e.from === id)) { degrees.set(edge.to, degrees.get(edge.to)! - 1); if (degrees.get(edge.to) === 0) queue.push(edge.to); } }
    expect(visited).toHaveLength(8);
  });
  test('complete records retain fractional times; batch completion never approves manual review', () => {
    const stages = buildPipelineStages(manifest());
    expect(stages.filter(s => s.state === 'completed')).toHaveLength(7);
    expect(stages[0].durationSeconds).toBe(4.5);
    expect(stages.at(-1)).toMatchObject({ state: 'manual', durationSeconds: null });
  });
  test('missing, unreadable, empty, over-limit and changed schemas cannot become completed', () => {
    for (const input of [undefined, {}, { runDaily: { manifestStatus: 'missing', stepEvents: events } }, { runDaily: { manifestStatus: 'unreadable', stepEvents: events } }, { runDaily: { manifestStatus: 'available', stepEvents: [] } }, { runDaily: { manifestStatus: 'future', stepEvents: events } }]) expect(buildPipelineStages(parsePipelineManifest(input)).slice(0, 7).every(s => s.state === 'unknown')).toBe(true);
    expect(manifest({}).invalidEvents).toBe(1);
    expect(manifest(Array(101).fill(events[0])).events).toHaveLength(0);
  });
  test('failure, upstream skip, optional skip and partial observations stay distinct', () => {
    const e = events.find(e => e.name === 'Step 11 (LAAJ Evaluation)')!;
    for (const [status, state] of [['failed', 'failed'], ['optional_skipped', 'skipped'], ['downstream_skipped', 'blocked']]) expect(stage('evaluate', [{ ...e, status }]).state).toBe(state);
    expect(stage('collect', [events[0]])).toMatchObject({ state: 'partial', durationSeconds: null });
    expect(stage('collect', [{ ...events[0], status: 'failed' }]).state).toBe('failed');
    expect(stage('collect', events.filter(e => e.name.startsWith('Step 2')))).toMatchObject({ state: 'partial', durationSeconds: null });
  });
  test('duplicates, invalid times and summed overflow never fabricate completion or timing', () => {
    expect(stage('evaluate', [...events, ...events.filter(e => e.name === 'Step 11 (LAAJ Evaluation)')])).toMatchObject({ state: 'unknown', durationSeconds: null });
    for (const durationSeconds of [-1, NaN, Infinity, null, '2', Number.MAX_SAFE_INTEGER + 1]) expect(stage('evaluate', events.map(e => ({ ...e, durationSeconds }))).durationSeconds).toBeNull();
    expect(stage('collect', events.map(e => ({ ...e, durationSeconds: Number.MAX_SAFE_INTEGER }))).durationSeconds).toBeNull();
    expect(stage('evaluate', events.map(e => ({ ...e, durationSeconds: 0 }))).durationSeconds).toBe(0);
  });
  test('raw event names, reasons, errors and paths never enter the projection', () => {
    const result = manifest([...events.map(e => ({ ...e, reason: 'private@example.test', upstreamStep: 'provider raw' })), { name: 'private@example.test', status: 'failed' }, { name: events[0].name, status: 'new-status' }], { manifestPath: '/secret/path' });
    expect(result.invalidEvents).toBe(1);
    for (const raw of ['private', 'provider', 'secret']) expect(JSON.stringify(result)).not.toContain(raw);
  });
});
describe('pipeline execution read model', () => {
  test('missing arrays, schema changes and bounds fail closed; valid empty remains empty', () => {
    for (const value of [null, {}, { jobs: [] }, status({ failures: null }), status({ jobs: Array(1001).fill(job) }), status({ failures: Array(21).fill(job) }), status({ targets: Array(1001).fill({ id: 'x' }) })]) expect(() => parsePipelineStatus(value)).toThrow();
    expect(parsePipelineStatus(status({ jobs: [], targets: [] }))).toMatchObject({ jobs: [], failures: [], targets: [], partial: false });
  });
  test('unknown source/status, malformed entries and incomplete mode stay unknown', () => {
    const result = parsePipelineStatus(status({ source: 'future', jobs: [{ ...job, status: 'future', dry_run: undefined, adapter_index: -1 }, { ...job, id: 'private@example.test' }] }));
    expect(result).toMatchObject({ source: 'unknown', partial: true });
    expect(result.jobs).toHaveLength(1);
    expect(result.jobs[0]).toMatchObject({ status: 'Unknown', dry_run: undefined, adapter_index: null });
    expect(JSON.stringify(result)).not.toContain('private');
    expect(canControlPipelineJob(result.source, result.jobs[0], 'pause')).toBe(false);
    expect(pipelineJobsForDisplay(parsePipelineStatus(status({ source: 'future', jobs: [{ ...job, status: 'Succeeded', dry_run: false }] })), undefined)[0]).toMatchObject({ status: 'Unknown', hasError: false, dry_run: undefined, adapter_index: null });
  });
  test('valid zero gauges survive; negative, nonfinite and extra properties do not', () => {
    const result = parsePipelineStatus(status({ gauges: { tzudong_pipeline_kafka_lag: 0, tzudong_pipeline_es_rows_per_sec: -1, tzudong_pipeline_process_rss_bytes: Infinity, arbitrary: 44 }, hardware: 'private@example.test', dataEnv: 'secret-path' }));
    expect(result.gauges).toEqual({ tzudong_pipeline_kafka_lag: 0 });
    for (const raw of ['private', 'secret']) expect(JSON.stringify(result)).not.toContain(raw);
  });
  test('GHA needs identical identity; normalized fallback live/failure defaults are not observations', () => {
    const s = parsePipelineStatus(status({ source: 'github_actions', jobs: [{ ...job, id: '99', profile: 'lite_gha', status: 'Failed', error_code: 'github_crawler', dry_run: false }], failures: [{ error_code: 'failure' }] }));
    const gha = (id: number, status: string, conclusion: string | null) => parsePipelineManifest({ githubActions: { enabled: true, configured: true, reachable: true, latestRunId: id, latestRunStatus: status, latestRunConclusion: conclusion } });
    expect(pipelineJobsForDisplay(s, undefined)[0]).toMatchObject({ status: 'Unknown', dry_run: undefined, adapter_index: null });
    expect(pipelineJobsForDisplay(s, parsePipelineManifest({ githubActions: { enabled: true, configured: false, reachable: false, latestRunId: 99, latestRunStatus: 'completed', latestRunConclusion: 'success' } }))[0].status).toBe('Unknown');
    expect(pipelineJobsForDisplay(s, gha(98, 'completed', 'success'))[0].status).toBe('Unknown');
    const cases: [string, string | null, string][] = [['in_progress', null, 'Fetching'], ['queued', null, 'Queued'], ['completed', 'success', 'Succeeded'], ['completed', 'failure', 'Failed'], ['completed', 'cancelled', 'Cancelled'], ['completed', null, 'Unknown'], ['completed', 'neutral', 'Unknown']];
    for (const [status, conclusion, expected] of cases) expect(pipelineJobsForDisplay(s, gha(99, status, conclusion))[0].status).toBe(expected);
    expect(pipelineJobsForDisplay(s, gha(99, 'in_progress', null))[0].hasError).toBe(false);
    expect(pipelineJobsForDisplay(s, gha(99, 'completed', 'failure'))[0].hasError).toBe(true);
    expect(canControlPipelineJob(s.source, pipelineJobsForDisplay(s, gha(99, 'in_progress', null))[0], 'pause')).toBe(false);
  });
  test('controls require API, UUID, known profile and a valid transition', () => {
    const j = parsePipelineStatus(status()).jobs[0];
    expect(canControlPipelineJob('job_api', j, 'pause')).toBe(true);
    expect(canControlPipelineJob('job_api', j, 'cancel')).toBe(true);
    expect(canControlPipelineJob('job_api', j, 'resume')).toBe(false);
    expect(canControlPipelineJob('job_api', { ...j, status: 'Paused' }, 'resume')).toBe(true);
    for (const modified of [{ ...j, id: '123' }, { ...j, profile: 'unknown' as const }, { ...j, status: 'Succeeded' }]) expect(canControlPipelineJob('job_api', modified, 'pause')).toBe(false);
  });
});
describe('pipeline preview and confirmation', () => {
  const now = Date.parse('2026-10-04T00:00:00Z');
  const identity = { correlationId: '11111111-1111-4111-8111-111111111111', idempotencyKey: 'pipe-fixture-identity' };
  const response = (input: PipelineActionInput) => ({ phase: 'preview', requiredConfirmation: true, previewHash: buildPipelinePreviewHash({ ...input, dryRun: !input.live }), operationId: 'signed-fixture-ticket', revision: 'a'.repeat(64), expiresAt: new Date(now + 60_000).toISOString() });
  test('dry/live and controls preserve ticket, request identity and guarded contract', () => {
    const inputs: PipelineActionInput[] = [{ action: 'enqueue', target: 'tzuyang', profile: 'heavy_local' }, { action: 'enqueue', target: 'tzuyang', profile: 'lite_gha', live: true }, ...(['pause', 'resume', 'cancel'] as const).map(action => ({ action, target: 'tzuyang', profile: 'heavy_local' as const, runId: id }))];
    for (const input of inputs) {
      const p = parsePipelineActionPreview(response(input), input, identity, now);
      const body = pipelineApplyBody(p, PIPELINE_CONTROL_CONFIRMATION_TEXT, PIPELINE_LIVE_ENQUEUE_CONFIRMATION, now + 1);
      expect(assertPipelineGuardedBody(body)).toMatchObject({ action: input.action, idempotencyKey: identity.idempotencyKey, correlationId: identity.correlationId });
      expect(body).toMatchObject({ operationId: 'signed-fixture-ticket', revision: 'a'.repeat(64), phase: 'apply' });
      if (input.action !== 'enqueue') expect(body).not.toHaveProperty('dryRun');
    }
  });
  test('changed target/mode/schema, missing tickets, expiration and confirmation fail closed', () => {
    const input: PipelineActionInput = { action: 'enqueue', target: 'tzuyang', profile: 'heavy_local', live: true };
    for (const overrides of [{ phase: 'apply' }, { requiredConfirmation: false }, { operationId: '' }, { revision: 'invalid' }, { previewHash: '0'.repeat(64) }, { expiresAt: 'invalid' }, { expiresAt: new Date(now).toISOString() }]) expect(() => parsePipelineActionPreview({ ...response(input), ...overrides }, input, identity, now)).toThrow();
    expect(() => parsePipelineActionPreview(response(input), { ...input, live: false }, identity, now)).toThrow();
    expect(() => parsePipelineActionPreview(response(input), { ...input, target: 'other' }, identity, now)).toThrow();
    const p = parsePipelineActionPreview(response(input), input, identity, now);
    expect(() => pipelineApplyBody(p, '', '', now)).toThrow();
    expect(() => pipelineApplyBody(p, PIPELINE_CONTROL_CONFIRMATION_TEXT, '', now)).toThrow();
    expect(() => pipelineApplyBody(p, PIPELINE_CONTROL_CONFIRMATION_TEXT, PIPELINE_LIVE_ENQUEUE_CONFIRMATION, now + 60_000)).toThrow();
  });
});
