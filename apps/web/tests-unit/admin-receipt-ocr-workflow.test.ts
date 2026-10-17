import { describe, expect, mock, test } from 'bun:test';
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  runAdminReceiptOcrBatch,
  type ReceiptOcrBatchDependencies,
  type ReceiptOcrReviewState,
} from '@/lib/ocr/admin-receipt-batch';
import {
  parseReceiptOcrWorkflowPolicy,
} from '@/lib/ocr/workflow-policy';
import { getOcrModelPolicy } from '@/lib/ocr/runtime-config';
import { createClient } from '@supabase/supabase-js';

mock.module('server-only', () => ({}));
const { dispatchReceiptOcrWorkflow } = await import('@/lib/ocr/workflow-dispatch');
const {
  RECEIPT_OCR_RESET_STATE,
  hasExactReceiptOcrState,
  resetReceiptOcrRowsWithCas,
  resetReceiptOcrRowWithCas,
} = await import('@/lib/ocr/admin-receipt-reset');

const policy = parseReceiptOcrWorkflowPolicy(
  '["gemini-3.8-flash","models/gemini-3.6-flash"]',
  'HIGH',
);

function uuid(index: number, prefix = '10000000') {
  return `${prefix}-0000-4000-8000-${index.toString().padStart(12, '0')}`;
}

function pending(index: number): ReceiptOcrReviewState {
  return {
    id: uuid(index),
    user_id: uuid(index, '20000000'),
    ocr_processed_at: null,
    receipt_status: null,
  };
}

function terminal(row: ReceiptOcrReviewState): ReceiptOcrReviewState {
  return {
    ...row,
    ocr_processed_at: '2026-10-15T00:00:00.000Z',
    receipt_status: 'processed',
  };
}

function dependencies(
  rows: ReceiptOcrReviewState[],
  overrides: Partial<ReceiptOcrBatchDependencies> = {},
): ReceiptOcrBatchDependencies {
  const states = new Map(rows.map((row) => [row.id, row]));
  return {
    select: async () => rows,
    read: async (reviewId) => states.get(reviewId) ?? null,
    isReady: async () => true,
    process: async ({ reviewId }) => {
      states.set(reviewId, terminal(states.get(reviewId)!));
      return Response.json({ success: true });
    },
    ...overrides,
  };
}

describe('trusted administrator receipt OCR workflow', () => {
  test('executes at most fifty selected reviews strictly in order and serially', async () => {
    const rows = Array.from({ length: 50 }, (_, index) => pending(index + 1));
    const states = new Map(rows.map((row) => [row.id, row]));
    const calls: string[] = [];
    let active = 0;
    let maximumActive = 0;
    const summary = await runAdminReceiptOcrBatch(
      { batchLimit: 50, reviewIds: null, policy },
      dependencies(rows, {
        read: async (reviewId) => states.get(reviewId) ?? null,
        process: async ({ reviewId }) => {
          active += 1;
          maximumActive = Math.max(maximumActive, active);
          calls.push(reviewId);
          await Promise.resolve();
          states.set(reviewId, terminal(states.get(reviewId)!));
          active -= 1;
          return Response.json({ success: true });
        },
      }),
    );

    expect(calls).toEqual(rows.map((row) => row.id));
    expect(maximumActive).toBe(1);
    expect(summary).toEqual({
      selected: 50,
      processed: 50,
      preserved: 0,
      recovered: 0,
      failed: 0,
      indeterminate: 0,
      held: 0,
      unattempted: 0,
      terminalFailures: 0,
    });

    await expect(runAdminReceiptOcrBatch(
      { batchLimit: 51, reviewIds: null, policy },
      dependencies([]),
    )).rejects.toThrow('OCR_BATCH_INPUT_INVALID');
  });

  test('stops on a held owner before any readback or provider-capable processing', async () => {
    const rows = [pending(1), pending(2), pending(3)];
    let reads = 0;
    let processCalls = 0;
    const summary = await runAdminReceiptOcrBatch(
      { batchLimit: 3, reviewIds: null, policy },
      dependencies(rows, {
        isReady: async () => false,
        read: async () => { reads += 1; return rows[0]!; },
        process: async () => { processCalls += 1; return Response.json({ success: true }); },
      }),
    );

    expect(summary).toMatchObject({ held: 1, unattempted: 2, processed: 0 });
    expect(reads).toBe(0);
    expect(processCalls).toBe(0);
  });

  test('never resends after an uncertain call when post-call readback is lost', async () => {
    const rows = [pending(1), pending(2)];
    let reads = 0;
    const processCalls: string[] = [];
    const summary = await runAdminReceiptOcrBatch(
      { batchLimit: 2, reviewIds: null, policy },
      dependencies(rows, {
        read: async () => {
          reads += 1;
          if (reads === 1) return rows[0]!;
          throw new Error('synthetic readback loss');
        },
        process: async ({ reviewId }) => {
          processCalls.push(reviewId);
          throw new Error('synthetic uncertain response');
        },
      }),
    );

    expect(processCalls).toEqual([rows[0]!.id]);
    expect(summary).toMatchObject({ indeterminate: 1, unattempted: 1, processed: 0 });
  });

  test('requires both review and owner identity on before and after readback', async () => {
    const row = pending(1);
    await expect(runAdminReceiptOcrBatch(
      { batchLimit: 1, reviewIds: null, policy },
      dependencies([row], {
        read: async () => ({ ...row, id: uuid(99) }),
      }),
    )).rejects.toThrow('OCR_BATCH_READBACK_INVALID');

    let reads = 0;
    let processCalls = 0;
    const summary = await runAdminReceiptOcrBatch(
      { batchLimit: 1, reviewIds: null, policy },
      dependencies([row], {
        read: async () => {
          reads += 1;
          return reads === 1 ? row : terminal({ ...row, id: uuid(99) });
        },
        process: async () => {
          processCalls += 1;
          return Response.json({ success: true });
        },
      }),
    );

    expect(processCalls).toBe(1);
    expect(summary).toMatchObject({ indeterminate: 1, processed: 0 });
  });

  test('requires an exact bounded review-id set for scoped dispatches', async () => {
    const rows = [pending(1), pending(2)];
    const summary = await runAdminReceiptOcrBatch(
      { batchLimit: 2, reviewIds: [rows[1]!.id, rows[0]!.id], policy },
      dependencies(rows),
    );
    expect(summary.processed).toBe(2);

    await expect(runAdminReceiptOcrBatch(
      { batchLimit: 2, reviewIds: [rows[0]!.id, rows[1]!.id], policy },
      dependencies([rows[0]!]),
    )).rejects.toThrow('OCR_BATCH_REVIEW_NOT_FOUND');
    await expect(runAdminReceiptOcrBatch(
      { batchLimit: 2, reviewIds: [rows[0]!.id, rows[0]!.id], policy },
      dependencies(rows),
    )).rejects.toThrow('OCR_BATCH_INPUT_INVALID');
  });

  test('rejects malformed workflow policies and preserves the declared order', () => {
    expect(policy.modelPolicy).toEqual(['gemini-3.8-flash', 'models/gemini-3.6-flash']);
    expect(policy.inferenceConfig).toEqual({
      version: 'gemini-receipt-ocr-inference-v1',
      thinkingLevel: 'HIGH',
      responseMimeType: 'application/json',
      samplingPolicy: 'omit-modern-zero-legacy-v1',
    });
    for (const [models, thinking] of [
      ['not-json', 'HIGH'],
      ['[]', 'HIGH'],
      ['["gemini-3.8-flash","gemini-3.8-flash"]', 'HIGH'],
      ['["not-gemini"]', 'HIGH'],
      ['["gemini-3.8-flash"]', 'MAX'],
      [JSON.stringify(Array.from({ length: 9 }, (_, index) => `gemini-${index + 1}-flash`)), 'HIGH'],
    ]) {
      expect(() => parseReceiptOcrWorkflowPolicy(models, thinking)).toThrow('OCR_WORKFLOW_POLICY_INVALID');
    }
  });

  test('canonicalizes legacy manual Gemini aliases before snapshot and provider validation', () => {
    expect(getOcrModelPolicy({
      model: 'gemini-3.7-flash',
      models: ['gemini-3.7-flash', 'gemini-3.6-flash'],
    })).toEqual(['gemini-3.8-flash', 'gemini-3.6-flash']);
    expect(parseReceiptOcrWorkflowPolicy('["gemini-3.7-flash","gemini-3.6-flash"]', 'MEDIUM').modelPolicy)
      .toEqual(['gemini-3.8-flash', 'gemini-3.6-flash']);
    expect(() => parseReceiptOcrWorkflowPolicy(
      '["gemini-3.7-flash","gemini-3.8-flash"]',
      'MEDIUM',
    )).toThrow('OCR_WORKFLOW_POLICY_INVALID');
  });

  test('treats every non-204 or lost dispatch response as indeterminate without reading its body', async () => {
    let cancelled = false;
    const body = new ReadableStream({ cancel: () => { cancelled = true; } });
    const indeterminate = await dispatchReceiptOcrWorkflow({
      url: 'https://api.github.com/repos/example/project/actions/workflows/ocr-review-receipts.yml/dispatches',
      token: 'synthetic-token',
      inputs: { modelPolicy: '["gemini-3.8-flash"]', thinkingLevel: 'MEDIUM' },
      fetchImpl: async () => new Response(body, { status: 202 }),
    });
    expect(indeterminate).toEqual({ status: 'indeterminate', httpStatus: 202 });
    expect(cancelled).toBe(true);

    const lost = await dispatchReceiptOcrWorkflow({
      url: 'https://api.github.com/repos/example/project/actions/workflows/ocr-review-receipts.yml/dispatches',
      token: 'synthetic-token',
      inputs: {},
      fetchImpl: async () => { throw new TypeError('synthetic response loss'); },
    });
    expect(lost).toEqual({ status: 'indeterminate', httpStatus: null });

    const accepted = await dispatchReceiptOcrWorkflow({
      url: 'https://api.github.com/repos/example/project/actions/workflows/ocr-review-receipts.yml/dispatches',
      token: 'synthetic-token',
      inputs: {},
      fetchImpl: async () => new Response(null, { status: 204 }),
    });
    expect(accepted).toEqual({ status: 'accepted', httpStatus: 204 });
  });

  test('serializes JSONB snapshot CAS in the real PostgREST request URL', async () => {
    const reviewId = uuid(41);
    const receiptData = { schema_version: 'receipt_summary_v1', status: 'processed', item_count: 1 };
    let requestUrl = '';
    const client = createClient('https://fixture.supabase.co', 'synthetic-anon-key', {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      global: {
        fetch: async (input) => {
          requestUrl = String(input);
          return new Response(JSON.stringify({ id: reviewId, ...RECEIPT_OCR_RESET_STATE }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          });
        },
      },
    });
    const result = await resetReceiptOcrRowWithCas(client as never, {
      id: reviewId,
      ocr_processed_at: '2026-10-15T00:00:00.000Z',
      receipt_data: receiptData,
      receipt_hash: 'a'.repeat(64),
      is_duplicate: false,
    });

    const url = new URL(requestUrl);
    expect(result).toBe('applied');
    expect(url.searchParams.get('receipt_data')).toBe(`eq.${JSON.stringify(receiptData)}`);
    expect(requestUrl).not.toContain('[object+Object]');
    expect(requestUrl).not.toContain('%5Bobject%20Object%5D');
  });

  test('allows one concurrent reset winner and stops the loser before dispatch', async () => {
    const snapshots = [pending(51), pending(52)].map((row, index) => ({
      ...row,
      ocr_processed_at: '2026-10-15T00:00:00.000Z',
      receipt_data: { schema_version: 'receipt_summary_v1', status: 'processed', item_count: index },
      receipt_hash: String(index + 1).repeat(64),
      is_duplicate: false,
    }));
    const current = new Map(snapshots.map((snapshot) => [snapshot.id, snapshot]));
    const resetOne = async (snapshot: typeof snapshots[number]) => {
      const observed = current.get(snapshot.id) ?? null;
      if (!hasExactReceiptOcrState(observed, snapshot)) return 'conflict' as const;
      current.set(snapshot.id, { ...snapshot, ...RECEIPT_OCR_RESET_STATE });
      await Promise.resolve();
      return 'applied' as const;
    };

    const [first, second] = await Promise.all([
      resetReceiptOcrRowsWithCas(snapshots, resetOne),
      resetReceiptOcrRowsWithCas(snapshots, resetOne),
    ]);
    expect([first.status, second.status].sort()).toEqual(['complete', 'conflict']);
    const loser = first.status === 'conflict' ? first : second;
    expect(loser.appliedReviewIds).toEqual([]);
  });

  test('reports partial reset conflict, skips dispatch, and retries pending rows without another reset', async () => {
    const snapshots = [pending(61), pending(62)].map((row, index) => ({
      ...row,
      ocr_processed_at: '2026-10-15T00:00:00.000Z',
      receipt_data: { schema_version: 'receipt_summary_v1', status: 'processed', item_count: index },
      receipt_hash: String(index + 3).repeat(64),
      is_duplicate: false,
    }));
    let calls = 0;
    const partial = await resetReceiptOcrRowsWithCas(snapshots, async () => {
      calls += 1;
      return calls === 1 ? 'applied' : 'conflict';
    });
    let dispatchCalls = 0;
    if (partial.status === 'complete') dispatchCalls += 1;
    expect(partial).toEqual({
      status: 'conflict',
      appliedReviewIds: [snapshots[0]!.id],
      blockedReviewId: snapshots[1]!.id,
    });
    expect(dispatchCalls).toBe(0);

    const pendingSnapshots = snapshots.map((snapshot) => ({ ...snapshot, ...RECEIPT_OCR_RESET_STATE }));
    let retryResetCalls = 0;
    const retry = await resetReceiptOcrRowsWithCas(pendingSnapshots, async () => {
      retryResetCalls += 1;
      return 'applied';
    });
    expect(retry).toEqual({ status: 'complete', appliedReviewIds: [], blockedReviewId: null });
    expect(retryResetCalls).toBe(0);
  });

  test('keeps secrets and raw OCR/provider material outside workflow inputs and logs', () => {
    const root = join(import.meta.dir, '..');
    const script = readFileSync(join(root, 'scripts/run-admin-receipt-ocr-workflow.ts'), 'utf8');
    const workflow = readFileSync(join(root, '../../.github/workflows/ocr-review-receipts.yml'), 'utf8');
    const processor = readFileSync(join(root, 'lib/ocr/admin-receipt-processor.ts'), 'utf8');
    const dispatch = readFileSync(join(root, 'lib/ocr/workflow-dispatch.ts'), 'utf8');
    const combinedPublicInputs = `${workflow}\n${dispatch}`;

    for (const forbidden of ['password', 'cookie', 'session', 'ADMIN_EMAIL', 'ADMIN_PASSWORD']) {
      expect(combinedPublicInputs.toLowerCase()).not.toContain(forbidden.toLowerCase());
    }
    expect(script).toContain("event: 'receipt_ocr_batch_result'");
    expect(script).not.toContain('console.log(error');
    expect(script).not.toContain('console.error(error');
    expect(processor).not.toContain('raw: ocrData');
    expect(processor).not.toContain('error.message');
    expect(processor).toContain('buildOcrInputContextHash(imageHash, null, inferenceConfig)');
    expect(processor).toContain('inferenceConfig,\n                    signal: input.signal');
  });

  test('admits funded workflow execution only for the repository owner at protected main', () => {
    const root = join(import.meta.dir, '..');
    const workflow = readFileSync(join(root, '../../.github/workflows/ocr-review-receipts.yml'), 'utf8');
    for (const requiredGuard of [
      "github.event_name == 'workflow_dispatch'",
      "github.repository == 'twoimo/tzudong'",
      "github.event.repository.full_name == 'twoimo/tzudong'",
      "github.event.repository.default_branch == 'main'",
      'github.event.repository.owner.login == github.repository_owner',
      'github.repository_owner == github.actor',
      'github.triggering_actor == github.actor',
      'github.event.sender.login == github.actor',
      "github.ref == 'refs/heads/main'",
      "github.ref_name == 'main'",
      'github.ref_protected',
    ]) {
      expect(workflow).toContain(requiredGuard);
    }

    const marker = '      - name: Verify authenticated owner dispatch and protected main source\n';
    const stepStart = workflow.indexOf(marker);
    expect(stepStart).toBeGreaterThanOrEqual(0);
    const nextStep = workflow.indexOf('\n      - name: ', stepStart + marker.length);
    const step = workflow.slice(stepStart, nextStep);
    const runMarker = '\n        run: |\n';
    const runStart = step.indexOf(runMarker);
    expect(runStart).toBeGreaterThanOrEqual(0);
    const verify = step
      .slice(runStart + runMarker.length)
      .split('\n')
      .map((line) => line.startsWith('          ') ? line.slice(10) : line)
      .join('\n');

    const directory = mkdtempSync(join(tmpdir(), 'tzudong-ocr-workflow-'));
    try {
      for (const args of [
        ['init', '-q'],
        ['config', 'user.name', 'Workflow Contract'],
        ['config', 'user.email', 'workflow-contract@example.invalid'],
      ]) {
        expect(spawnSync('git', args, { cwd: directory }).status).toBe(0);
      }
      writeFileSync(join(directory, 'source.txt'), 'protected main source\n');
      expect(spawnSync('git', ['add', 'source.txt'], { cwd: directory }).status).toBe(0);
      expect(spawnSync('git', ['commit', '-qm', 'source'], { cwd: directory }).status).toBe(0);
      expect(spawnSync('git', ['checkout', '--detach', '-q'], { cwd: directory }).status).toBe(0);
      const revision = spawnSync('git', ['rev-parse', 'HEAD'], {
        cwd: directory,
        encoding: 'utf8',
      }).stdout.trim();
      const common = {
        ...process.env,
        DEFAULT_BRANCH: 'main',
        EVENT_REPOSITORY_FULL_NAME: 'twoimo/tzudong',
        EVENT_REPOSITORY_OWNER: 'twoimo',
        GITHUB_ACTOR: 'twoimo',
        GITHUB_EVENT_NAME: 'workflow_dispatch',
        GITHUB_REF: 'refs/heads/main',
        GITHUB_REF_NAME: 'main',
        GITHUB_REF_PROTECTED: 'true',
        GITHUB_REPOSITORY: 'twoimo/tzudong',
        GITHUB_SHA: revision,
        REPOSITORY_OWNER: 'twoimo',
        SENDER_LOGIN: 'twoimo',
        TRIGGERING_ACTOR: 'twoimo',
      };
      const run = (environment: Record<string, string | undefined>) => spawnSync(
        'bash',
        ['-c', verify],
        { cwd: directory, env: environment },
      );

      expect(run(common).status).toBe(0);
      for (const rejected of [
        { ...common, GITHUB_ACTOR: 'writer' },
        { ...common, SENDER_LOGIN: 'writer' },
        { ...common, TRIGGERING_ACTOR: 'writer' },
        { ...common, EVENT_REPOSITORY_FULL_NAME: 'fork/tzudong' },
        { ...common, GITHUB_REPOSITORY: 'fork/tzudong' },
        { ...common, GITHUB_REF: 'refs/heads/develop' },
        { ...common, GITHUB_REF_NAME: 'develop' },
        { ...common, GITHUB_REF_PROTECTED: 'false' },
        { ...common, GITHUB_SHA: '0'.repeat(40) },
      ]) {
        expect(run(rejected).status).not.toBe(0);
      }
    } finally {
      rmSync(directory, { force: true, recursive: true });
    }
  });

  test('preserves bounded reset state for indeterminate dispatch and scopes every worker batch', () => {
    const root = join(import.meta.dir, '..');
    const routes = [
      'app/api/admin/ocr-receipts/route.ts',
      'app/api/admin/ocr-receipts/rerun/route.ts',
      'app/api/admin/ocr-receipts/reset-all/route.ts',
    ].map((path) => readFileSync(join(root, path), 'utf8'));

    for (const route of routes) {
      expect(route).toContain('buildReceiptOcrWorkflowInputs(');
      expect(route).toContain('inputs: workflowInputs');
      expect(route).toContain("dispatch.status !== 'accepted'");
      expect(route).toContain('workflowDeliveryVerified: false');
    }
    expect(routes[1]).toContain('buildReceiptOcrWorkflowInputs([reviewId])');
    expect(routes[1]!.indexOf('buildReceiptOcrWorkflowInputs([reviewId])')).toBeLessThan(
      routes[1]!.indexOf('const previousOcrState'),
    );
    expect(routes[1]).toContain('resetAlreadyPending = isResetReceiptOcrState({ id: reviewId, ...previousOcrState })');
    expect(routes[1]).toContain('resetPreserved: true');
    expect(routes[1]).not.toContain('rollbackReadback');
    expect(routes[2]).toContain('.limit(MAX_OCR_RESET_BATCH)');
    expect(routes[2]).toContain('buildReceiptOcrWorkflowInputs(targetReviewIds)');
    expect(routes[2]!.indexOf('buildReceiptOcrWorkflowInputs(targetReviewIds)')).toBeLessThan(
      routes[2]!.indexOf('resetReceiptOcrRowsWithCas('),
    );
    expect(routes[1]).toContain('resetReceiptOcrRowWithCas(');
    expect(routes[2]).toContain('resetReceiptOcrRowsWithCas(');
    expect(routes[2]).toContain("if (resetOutcome.status !== 'complete')");
    expect(routes[2]).toContain('resetPreserved: true');
  });
});
