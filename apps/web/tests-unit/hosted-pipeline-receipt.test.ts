import { describe, expect, test } from 'bun:test';
import {
  MAX_HOSTED_RECEIPT_BYTES,
  parseHostedPipelineReceipt,
  type ExpectedHostedRun,
} from '../lib/admin/hosted-pipeline-receipt';

const expected: ExpectedHostedRun = {
  runId: '39337448241', runAttempt: '2', headSha: 'a'.repeat(40),
  workflow: 'Crawler', ref: 'refs/heads/main',
  workflowStartedAt: '2026-10-20T00:00:00Z',
  workflowCompletedAt: '2026-10-20T00:05:00Z',
  now: '2026-10-20T00:10:00Z',
};

const receipt = {
  schemaVersion: 1,
  executionId: '22222222-2222-4222-8222-222222222222',
  runnerSha256: 'b'.repeat(64),
  source: 'github_actions',
  githubMetadataStatus: 'metadata_available',
  github: { runId: expected.runId, runAttempt: expected.runAttempt,
    headSha: expected.headSha, workflow: expected.workflow, ref: expected.ref },
  startedAt: '2026-10-20T00:01:00+00:00',
  finishedAt: '2026-10-20T00:03:00.000001+00:00',
  generatedAt: '2026-10-20T00:03:01.000001+00:00',
  elapsedMs: 120000,
  limit: 3, newVideoLimit: 3,
  dryRun: false, reviewRequested: false, reviewConfirmed: false,
  stage: 'finished', state: 'execution_completed', exitCode: 0,
  evaluateExit: 0, applyExit: 0, publicationVerified: false,
};

function bytes(value: unknown): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(value));
}

function parse(changes: Record<string, unknown> = {}, run = expected) {
  return parseHostedPipelineReceipt(bytes({ ...receipt, ...changes }), run);
}

describe('bounded hosted pipeline receipt metadata', () => {
  test('returns only an allowlisted view without treating metadata or workflow success as publication', () => {
    const result = parse({ rawDiagnostics: 'secret private@example.test https://private.example',
      workflowConclusion: 'success', providerPayload: { authorization: 'secret' } });
    expect(result.status).toBe('metadata_matched');
    if (result.status !== 'metadata_matched') return;
    expect(result.view).toMatchObject({
      source: 'github_actions', runId: expected.runId, runAttempt: expected.runAttempt,
      state: 'execution_completed', stage: 'finished', exitCode: 0,
      evaluateExit: 0, applyExit: 0, reviewRequested: false,
      reviewConfirmed: false, publicationVerified: false,
      finishedAt: '2026-10-20T00:03:00.000Z',
      receiptGeneratedAt: '2026-10-20T00:03:01.000Z',
    });
    expect(JSON.stringify(result)).not.toContain('private.example');
    expect(JSON.stringify(result)).not.toContain('providerPayload');
    expect(result.view).not.toHaveProperty('workflowConclusion');
  });

  test('keeps failure stage, review flags, and optional exit fields separate', () => {
    const failed = parse({ stage: 'evaluation', state: 'failed', exitCode: 7,
      evaluateExit: 7, applyExit: undefined, reviewRequested: true,
      reviewConfirmed: true, newVideoLimit: 2 });
    expect(failed.status).toBe('metadata_matched');
    expect(parse({ stage: 'evaluation', state: 'failed', exitCode: 7,
      evaluateExit: 7, applyExit: undefined, reviewRequested: true,
      reviewConfirmed: false, newVideoLimit: 2 }).status).toBe('metadata_matched');
    if (failed.status === 'metadata_matched') {
      expect(failed.view).toMatchObject({ stage: 'evaluation', state: 'failed', exitCode: 7,
        evaluateExit: 7, reviewRequested: true, reviewConfirmed: true, newVideoLimit: 2 });
      expect(failed.view).not.toHaveProperty('applyExit');
    }
    const preflight = parse({ stage: 'preflight', state: 'failed', exitCode: 2,
      evaluateExit: undefined, applyExit: undefined, newVideoLimit: undefined });
    expect(preflight.status).toBe('metadata_matched');
    if (preflight.status === 'metadata_matched') expect(preflight.view).not.toHaveProperty('newVideoLimit');
    const held = parse({ stage: 'pending_apply', state: 'review_unconfirmed', exitCode: 1,
      reviewRequested: true, reviewConfirmed: false, evaluateExit: 0, applyExit: 0,
      newVideoLimit: 2 });
    expect(held.status).toBe('metadata_matched');
    for (const stage of ['pending_preview', 'pending_apply'] as const) {
      const partial = parse({ stage, state: 'failed', exitCode: 2, evaluateExit: 0,
        applyExit: undefined });
      expect(partial.status).toBe('metadata_matched');
      if (partial.status === 'metadata_matched') expect(partial.view).not.toHaveProperty('applyExit');
    }
    const reviewFailure = parse({ stage: 'review_followup', state: 'failed', exitCode: 2,
      reviewRequested: true, reviewConfirmed: true, newVideoLimit: 2 });
    expect(reviewFailure.status).toBe('metadata_matched');
    const dryRun = parse({ stage: 'pending_preview', state: 'dry_run', exitCode: 0,
      dryRun: true, reviewRequested: true, reviewConfirmed: false, evaluateExit: 0,
      applyExit: undefined });
    expect(dryRun.status).toBe('metadata_matched');
    expect(parse({ reviewRequested: true, reviewConfirmed: true, newVideoLimit: 2 }).status)
      .toBe('metadata_matched');
    expect(parse({ reviewRequested: true, reviewConfirmed: true, newVideoLimit: 3 }).status)
      .toBe('metadata_matched');
  });

  test('missing receipt and older schema-v1 receipts without metadata stay unavailable', () => {
    expect(parseHostedPipelineReceipt(null, expected)).toEqual({ status: 'unavailable' });
    expect(parse({ githubMetadataStatus: undefined, github: undefined })).toEqual({ status: 'unavailable' });
    expect(parse({ githubMetadataStatus: 'unavailable', github: undefined })).toEqual({ status: 'unavailable' });
    expect(parse({ githubMetadataStatus: 'unavailable' })).toEqual({ status: 'invalid' });
    expect(parse({ source: 'mac', githubMetadataStatus: undefined, github: undefined }))
      .toEqual({ status: 'invalid' });
  });

  test('rejects malformed bytes, oversized input, invalid UTF-8, and unknown schema', () => {
    expect(parseHostedPipelineReceipt(bytes('{bad'), expected)).toEqual({ status: 'invalid' });
    expect(parseHostedPipelineReceipt(new Uint8Array([0xff]), expected)).toEqual({ status: 'invalid' });
    expect(parseHostedPipelineReceipt(new Uint8Array(MAX_HOSTED_RECEIPT_BYTES + 1), expected)).toEqual({ status: 'invalid' });
    expect(parse({ schemaVersion: 2 })).toEqual({ status: 'invalid' });
  });

  test('rejects every expected identity mismatch and malformed producer identity', () => {
    for (const key of ['runId', 'runAttempt', 'headSha', 'workflow', 'ref'] as const) {
      const other = { ...expected, [key]: key === 'headSha' ? 'c'.repeat(40)
        : key === 'workflow' ? 'Different' : key === 'ref' ? 'refs/heads/other' : '8' };
      expect(parse({}, other)).toEqual({ status: key === 'workflow' ? 'unavailable' : 'invalid' });
    }
    for (const github of [null, {}, { ...receipt.github, runId: '0' },
      { ...receipt.github, ref: 'https://private.example' }, { ...receipt.github, headSha: 'secret' }]) {
      expect(parse({ github })).toEqual({ status: 'invalid' });
    }
    expect(parse({ source: 'mac' })).toEqual({ status: 'invalid' });
    expect(parse({}, { ...expected, runId: '0' })).toEqual({ status: 'unavailable' });
  });

  test('rejects time contradictions and ages out a completed workflow using supplied now', () => {
    for (const changes of [
      { startedAt: '2026-10-20T00:04:00Z' },
      { finishedAt: '2026-10-20T00:00:00Z' },
      { generatedAt: '2026-10-20T00:02:00Z' },
      { generatedAt: '2026-10-20T00:20:00Z' },
      { elapsedMs: Number.POSITIVE_INFINITY },
      { elapsedMs: 1 },
      { startedAt: '2026-02-30T00:01:00Z' },
      { generatedAt: '2100-01-01T00:03:00Z' },
      { finishedAt: '2026-10-20T00:06:00Z', generatedAt: '2026-10-20T00:06:01Z', elapsedMs: 300000 },
    ]) expect(parse(changes)).toEqual({ status: 'invalid' });
    expect(parse({}, { ...expected, workflowCompletedAt: '2026-10-19T23:59:00Z' }))
      .toEqual({ status: 'unavailable' });
    expect(parse({}, { ...expected, now: '2026-10-22T00:10:00Z' }))
      .toEqual({ status: 'unavailable' });
    expect(parse({}, { ...expected, now: '2026-10-20T00:04:00Z' }))
      .toEqual({ status: 'unavailable' });
  });

  test('rejects state, stage, exit, and publication contradictions', () => {
    for (const changes of [
      { publicationVerified: true }, { exitCode: 1 }, { applyExit: 1 },
      { evaluateExit: undefined }, { stage: 'preflight' }, { state: 'failed' },
      { dryRun: true }, { reviewConfirmed: true },
      { stage: 'review_followup', reviewRequested: false },
      { state: 'review_unconfirmed', reviewRequested: true },
      { state: 'dry_run', stage: 'pending_preview', dryRun: false },
      { stage: 'evaluation', state: 'failed', exitCode: 7, evaluateExit: 6, applyExit: undefined },
      { newVideoLimit: 4 },
      { reviewRequested: true, reviewConfirmed: true, newVideoLimit: 0 },
      { reviewRequested: true, reviewConfirmed: false, newVideoLimit: 3 },
      { reviewRequested: false, newVideoLimit: 2 },
      { stage: 'pending_apply', state: 'failed', exitCode: 2, applyExit: 1 },
      { stage: 'pending_apply', state: 'failed', exitCode: 2, applyExit: -9 },
      { dryRun: true, stage: 'pending_apply', state: 'failed', exitCode: 2, applyExit: undefined },
    ]) expect(parse(changes)).toEqual({ status: 'invalid' });
  });
});
