import test from 'node:test';
import assert from 'node:assert/strict';
import {inspectExistingBatch} from './batch-state-v2.mjs';

test('failed/cancelled/expired jobs stop instead of remaining pending or ingesting available-looking content', async () => {
  for (const state of ['JOB_STATE_FAILED', 'JOB_STATE_CANCELLED', 'JOB_STATE_EXPIRED']) {
    let reads = 0, ingests = 0;
    const r = await inspectExistingBatch({name: 'batches/fixture',
      get: async () => { reads++; return {name: 'batches/fixture', state, dest: {inlinedResponses: [{}]}}; },
      ingest: async () => { ingests++; }});
    assert.equal(reads, 1); assert.equal(ingests, 0);
    assert.equal(r.status, 'terminal_failure'); assert.equal(r.action, 'stop');
  }
});
test('running and cancellation-in-progress wait; paused/unknown require attention without a remote mutation', async () => {
  for (const state of ['JOB_STATE_PENDING', 'JOB_STATE_RUNNING', 'JOB_STATE_CANCELLING', 'JOB_STATE_UPDATING', 'JOB_STATE_PAUSED', 'JOB_STATE_UNSPECIFIED']) {
    let ingests = 0;
    const r = await inspectExistingBatch({name: 'batches/fixture', get: async () => ({name: 'batches/fixture', state}),
      ingest: async () => { ingests++; }});
    assert.equal(ingests, 0);
    assert.equal(r.action, ['JOB_STATE_PAUSED', 'JOB_STATE_UNSPECIFIED'].includes(state) ? 'stop' : 'wait');
  }
});
test('partial completion dispatches validation once and never claims the complete corpus', async () => {
  let ingests = 0;
  const r = await inspectExistingBatch({name: 'batches/fixture',
    get: async () => ({name: 'batches/fixture', state: 'JOB_STATE_PARTIALLY_SUCCEEDED'}),
    ingest: async () => { ingests++; return {admittedRows: 2, incomplete: [{index: 1}]}; }});
  assert.equal(ingests, 1); assert.equal(r.partial, true); assert.equal(r.result.admittedRows, 2);
  assert.equal(r.result.incomplete.length, 1);
});
test('a returned different job never reaches the ingestor', async () => {
  let ingests = 0;
  await assert.rejects(inspectExistingBatch({name: 'batches/fixture',
    get: async () => ({name: 'batches/other', state: 'JOB_STATE_SUCCEEDED'}),
    ingest: async () => { ingests++; }}), /BATCH_NAME_DRIFT/);
  assert.equal(ingests, 0);
});
