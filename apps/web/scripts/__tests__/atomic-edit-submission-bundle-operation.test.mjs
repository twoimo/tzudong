import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { buildOperation, runOperation, atomicBundleSql, bundleReconciliationSql, bundleDisposition } from '../atomic-edit-submission-bundle-operation.mjs';
import { statementSpans } from '../supabase-migration-transaction.mjs';

const operation = buildOperation();
const { contract, members } = operation;
const sourceSha = 'a'.repeat(40);
const databaseUrl = 'postgresql://postgres@db.aqlcofblfxdrjhhdmarw.supabase.co:5432/postgres?sslmode=require';
const confirmation = `apply:${sourceSha}:${contract.bundleSha256}`;
const absent = { state: 'absent', prior: contract.expectedPriorState.expected, terminal: null };
const committed = { state: 'installed', originalLedgerEqual: true, correctionLedgerEqual: true,
  prior: null, terminal: contract.terminalReadback.expected };
const emit = value => JSON.stringify(value) + '\n';
const options = runner => ({ databaseUrl, sourceSha, confirmation, runner });

test('pins both original sources and denies changed SQL or contract bytes', () => {
  const bytes = readFileSync(new URL('../../../../.github/atomic-edit-submission-install.v2.json', import.meta.url));
  assert.throws(() => buildOperation({ contractBytes: Buffer.concat([bytes, Buffer.from('\n')]) }), /CONTRACT_DRIFT/);
  for (const index of [0, 1]) {
    const changed = members.map(m => Buffer.from(m.plan.execution));
    changed[index] = Buffer.concat([changed[index], Buffer.from('\n')]);
    assert.throws(() => buildOperation({ sourceBytes: changed }), /FILE_DRIFT/);
  }
});

test('keeps original24 plus correction5 intact, two original ledger rows and no intermediate transaction control', () => {
  assert.deepEqual(members.map(m => m.plan.originalVector.length), [24, 5]);
  const sql = atomicBundleSql(operation);
  for (const member of members) assert.ok(sql.includes(member.plan.execution), 'whole admitted source must be preserved');
  const spans = statementSpans(sql);
  assert.equal(spans.filter(s => /^(BEGIN|COMMIT|ROLLBACK)$/i.test(s.token)).length, 0);
  assert.equal(spans.filter(s => /^INSERT INTO supabase_migrations\.schema_migrations\(version,name,statements\)/.test(s.token)).length, 2);
  assert.ok(sql.indexOf('pg_advisory_xact_lock') < sql.indexOf('LOCK TABLE supabase_migrations'));
  assert.ok(sql.indexOf(members[0].plan.execution) < sql.indexOf(members[1].plan.execution));
  assert.equal(contract.expectedPriorState.expected.custodyOriginalTerminal.ledgerCount, 94);
  assert.equal(contract.terminalReadback.expected.legacy.ledgerCount, 96);
});

test('observe is one actual psql read-only program with empty search_path and both ledger identities', () => {
  let calls = 0;
  const result = runOperation('observe', options((_url, sql, single) => {
    calls++; assert.equal(single, true);
    assert.ok(sql.startsWith("SET LOCAL search_path='';\nSET TRANSACTION READ ONLY;"));
    assert.ok(sql.includes('\\gset') && sql.includes('\\if :bundle_first') && sql.includes('\\endif'));
    assert.ok(sql.includes("version='20261026120000'") && sql.includes("version='20261026130000'"));
    return emit(absent);
  }));
  assert.equal(result.state, 'ready'); assert.equal(calls, 1);
});

test('wrong target and malformed source cannot reach transport', () => {
  const runner = () => assert.fail('no transport');
  assert.throws(() => runOperation('observe', { ...options(runner), databaseUrl: databaseUrl.replace('aqlcofblfxdrjhhdmarw', 'otherproject') }));
  assert.throws(() => runOperation('observe', { ...options(runner), sourceSha: 'invalid' }), /ARGUMENT_INVALID/);
});

test('a partial95 or partial96 installation is drift and never resumed', () => {
  let calls = 0;
  assert.throws(() => runOperation('apply', options(() => { calls++; return emit({ state: 'partial' }); })), /PREIMAGE_DRIFT/);
  assert.equal(calls, 1);
  assert.equal(bundleDisposition({ state: 'partial' }, contract), 'drift');
  const ro = bundleReconciliationSql(operation);
  assert.equal((ro.match(/jsonb_build_object\('state','partial'\)/g) ?? []).length, 2);
});

test('each individual original ledger vector must match even after terminal96', () => {
  for (const key of ['originalLedgerEqual', 'correctionLedgerEqual']) {
    const changed = { ...committed, [key]: false };
    assert.equal(bundleDisposition(changed, contract), 'drift');
    assert.throws(() => runOperation('apply', options(() => emit(changed))), /PREIMAGE_DRIFT/);
  }
});

test('legacy preimage, ACL and corrected body metadata drift fail closed', () => {
  for (const mutate of [
    x => { x.prior.custodyOriginalTerminal.ledgerCount++; },
    x => { x.prior.custodyOriginalTerminal.oldFunctions = '0'.repeat(64); },
    x => { x.prior.editAbsent = false; },
  ]) {
    const changed = structuredClone(absent); mutate(changed);
    assert.throws(() => runOperation('apply', options(() => emit(changed))), /PREIMAGE_DRIFT/);
  }
  const changed = structuredClone(committed);
  changed.terminal.edit.functions[0][18] = '0'.repeat(64);
  assert.equal(bundleDisposition(changed, contract), 'drift');
});

test('the confirmation binds final source and the complete two-member bundle', () => {
  let calls = 0;
  assert.throws(() => runOperation('apply', { ...options(() => { calls++; return emit(absent); }), confirmation: `apply:${sourceSha}:${members[0].migration.sha256}` }), /CONFIRMATION_INVALID/);
  assert.equal(calls, 1);
});

test('both committed ledger rows return without rehearsal or send', () => {
  let calls = 0;
  assert.equal(runOperation('apply', options(() => { calls++; return emit(committed); })).state, 'already_committed');
  assert.equal(calls, 1);
});

function sequence(after, rollbackState = absent) {
  const calls = [];
  return { calls, runner: (_url, sql, single) => {
    calls.push({ sql, single });
    if (calls.length === 1) return emit(absent);
    if (calls.length === 2) {
      assert.equal(single, false);
      assert.ok(sql.startsWith('BEGIN;\n') && sql.endsWith('ROLLBACK;'));
      return emit(contract.terminalReadback.expected);
    }
    if (calls.length === 3) return emit(rollbackState);
    if (calls.length === 4) { assert.equal(single, true); throw Error('fixture lost acknowledgement'); }
    if (calls.length === 5) {
      if (after instanceof Error) throw after;
      return emit(after);
    }
    assert.fail('unexpected replay');
  } };
}

test('lost acknowledgement reconciles both rows with one operating send', () => {
  const { calls, runner } = sequence(committed);
  const result = runOperation('apply', options(runner));
  assert.equal(result.state, 'committed'); assert.equal(result.transport, 'unconfirmed');
  assert.equal(calls.length, 5);
  assert.equal(calls.filter(x => x.single && !x.sql.includes('SET TRANSACTION READ ONLY')).length, 1);
});

test('partial or missing result after send remains unconfirmed without replay', () => {
  for (const after of [absent, { state: 'partial' }, new Error('fixture readback transport lost')]) {
    const { calls, runner } = sequence(after);
    assert.throws(() => runOperation('apply', options(runner)), /APPLY_UNCONFIRMED/);
    assert.equal(calls.length, 5);
  }
});

test('drift after rollback rehearsal stops before the operating send', () => {
  const { calls, runner } = sequence(committed, { state: 'partial' });
  assert.throws(() => runOperation('apply', options(runner)), /REHEARSAL_ROLLBACK_INVALID/);
  assert.equal(calls.length, 3);
});
