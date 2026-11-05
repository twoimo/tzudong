import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { buildOperation, runOperation } from '../hosted-pending-custody-operation.mjs';

const sourceSha = 'a'.repeat(40);
const databaseUrl = 'postgresql://postgres@db.aqlcofblfxdrjhhdmarw.supabase.co:5432/postgres?sslmode=require';
const { migration } = buildOperation();
const pending = { ledger_exists: false, ledger_equal: false, prior: migration.expectedPriorState.expected, terminal: null };
const committed = { ledger_exists: true, ledger_equal: true, prior: null, terminal: migration.terminalReadback.expected };
const confirmation = `apply:${sourceSha}:${migration.sha256}`;
const emit = value => JSON.stringify(value) + '\n';
const options = runner => ({ databaseUrl, sourceSha, confirmation, runner });

test('different SQL or contract bytes are denied without changing shared files', () => {
  assert.throws(() => buildOperation({ bytes: Buffer.from('SELECT 1;') }), /FILE_DRIFT/);
  const bytes = readFileSync(new URL('../../../../.github/hosted-pending-custody-install.v1.json', import.meta.url));
  assert.throws(() => buildOperation({ contractBytes: Buffer.concat([bytes, Buffer.from('\n')]) }), /CONTRACT_DRIFT/);
});

test('observe uses one read-only transaction with fixed deparser context', () => {
  let calls = 0;
  const result = runOperation('observe', options((_url, sql, single) => {
    calls++; assert.equal(single, true);
    assert.match(sql, /^SET LOCAL search_path='';/);
    assert.match(sql, /SET TRANSACTION READ ONLY/);
    return emit(pending);
  }));
  assert.equal(result.state, 'ready'); assert.equal(calls, 1);
});

test('wrong target and malformed source never reach the transport', () => {
  const runner = () => assert.fail('transport must not run');
  assert.throws(() => runOperation('observe', { ...options(runner), databaseUrl: databaseUrl.replace('aqlcofblfxdrjhhdmarw', 'otherproject') }));
  assert.throws(() => runOperation('observe', { ...options(runner), sourceSha: 'invalid' }), /ARGUMENT_INVALID/);
});

test('ledger, old catalog and column-ACL drift fail before any write', () => {
  for (const mutate of [
    state => { state.ledgerCount++; },
    state => { state.ledgerPrefix = '0'.repeat(64); },
    state => { state.oldRelations = '0'.repeat(64); },
    state => { state.restaurantColumnACL[0][2] = '{service_role=a/postgres}'; },
  ]) {
    const changed = structuredClone(pending); mutate(changed.prior);
    let calls = 0;
    assert.throws(() => runOperation('apply', options((_url, sql) => {
      calls++; assert.match(sql, /SET TRANSACTION READ ONLY/); return emit(changed);
    })), /PREIMAGE_DRIFT/);
    assert.equal(calls, 1);
  }
});

test('missing exact confirmation permits only the initial read', () => {
  let calls = 0;
  assert.throws(() => runOperation('apply', { ...options(() => { calls++; return emit(pending); }), confirmation: '' }), /CONFIRMATION_INVALID/);
  assert.equal(calls, 1);
});

test('already committed performs no rehearsal or write', () => {
  let calls = 0;
  assert.equal(runOperation('apply', options((_url, sql) => {
    calls++; assert.match(sql, /SET TRANSACTION READ ONLY/); return emit(committed);
  })).state, 'already_committed');
  assert.equal(calls, 1);
});

function sequence(after, { changedAfterRehearsal = false } = {}) {
  const calls = [];
  const runner = (_url, sql, single) => {
    calls.push({ sql, single });
    if (calls.length === 1) return emit(pending);
    if (calls.length === 2) {
      assert.equal(single, false); assert.match(sql, /^BEGIN;/); assert.match(sql, /ROLLBACK;$/);
      assert.ok(sql.indexOf('pg_advisory_xact_lock') < sql.indexOf('LOCK TABLE supabase_migrations'));
      return emit(migration.terminalReadback.expected);
    }
    if (calls.length === 3) return emit(changedAfterRehearsal ? committed : pending);
    if (calls.length === 4) { assert.equal(single, true); throw new Error('fixture lost acknowledgement'); }
    if (calls.length === 5) { assert.match(sql, /SET TRANSACTION READ ONLY/); return emit(after); }
    assert.fail('unexpected resubmission');
  };
  return { calls, runner };
}

test('lost acknowledgement followed by committed readback sends apply once', () => {
  const { calls, runner } = sequence(committed);
  const result = runOperation('apply', options(runner));
  assert.equal(result.state, 'committed'); assert.equal(result.transport, 'unconfirmed');
  assert.equal(calls.length, 5);
  assert.equal(calls.filter(call => call.single && !call.sql.includes('SET TRANSACTION READ ONLY')).length, 1);
});

test('an unconfirmed result never retries apply within the original invocation', () => {
  const { calls, runner } = sequence(pending);
  assert.throws(() => runOperation('apply', options(runner)), /APPLY_UNCONFIRMED/);
  assert.equal(calls.length, 5);
  assert.equal(calls.filter(call => call.single && !call.sql.includes('SET TRANSACTION READ ONLY')).length, 1);
});

test('a changed state after rehearsal stops before the operating send', () => {
  const { calls, runner } = sequence(committed, { changedAfterRehearsal: true });
  assert.throws(() => runOperation('apply', options(runner)), /REHEARSAL_ROLLBACK_INVALID/);
  assert.equal(calls.length, 3);
});
