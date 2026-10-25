import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildOperation, runOperation } from '../admin-revision-safeupdate-operation.mjs';

const sourceSha = 'a'.repeat(40);
const databaseUrl = 'postgresql://postgres@db.aqlcofblfxdrjhhdmarw.supabase.co:5432/postgres?sslmode=require';
const {migration} = buildOperation();
const pending = {ledger_exists:false,ledger_equal:false,prior:migration.expectedPriorState.expected,terminal:null};
const committed = {ledger_exists:true,ledger_equal:true,prior:null,terminal:migration.terminalReadback.expected};
const emit = value => JSON.stringify(value)+'\n';

test('observe is read-only and rejects an unrelated ledger or target', () => {
  let count=0;
  const runner = (_url,sql,single) => {
    count++;assert.equal(single,true);assert.match(sql,/SET TRANSACTION READ ONLY/);
    return emit(pending);
  };
  assert.equal(runOperation('observe',{databaseUrl,sourceSha,runner}).state,'ready');
  assert.equal(count,1);
  assert.throws(()=>runOperation('observe',{databaseUrl:databaseUrl.replace('aqlcofblfxdrjhhdmarw','otherproject'),sourceSha,runner}));
  assert.throws(()=>runOperation('observe',{databaseUrl,sourceSha,runner:()=>emit({...pending,prior:{...pending.prior,ledgerCount:93}})}),/PREIMAGE_DRIFT/);
  assert.throws(()=>runOperation('observe',{databaseUrl,sourceSha,runner:()=>emit({...pending,prior:{...pending.prior,originalLedgerSha:'0'.repeat(64)}})}),/PREIMAGE_DRIFT/);
});

test('source digest and exact write confirmation are required', () => {
  assert.throws(()=>buildOperation(Buffer.from('SELECT 1;')),/FILE_DRIFT/);
  const previous=process.env.APPLY_CONFIRMATION;
  delete process.env.APPLY_CONFIRMATION;
  try { assert.throws(()=>runOperation('apply',{databaseUrl,sourceSha,runner:()=>emit(pending)}),/CONFIRMATION_INVALID/); }
  finally { if(previous===undefined)delete process.env.APPLY_CONFIRMATION;else process.env.APPLY_CONFIRMATION=previous; }
});

test('rehearsal rolls back and an uncertain commit is read back without resubmission', () => {
  const previous=process.env.APPLY_CONFIRMATION;
  process.env.APPLY_CONFIRMATION=`apply:${sourceSha}:${migration.sha256}`;
  const calls=[];
  const runner=(_url,sql,single) => {
    calls.push({sql,single});
    if(calls.length===1 || calls.length===3)return emit(pending);
    if(calls.length===2){
      assert.equal(single,false);assert.match(sql,/^BEGIN;/);assert.doesNotMatch(sql,/\bLOAD\s+'|SET\s+(?:LOCAL\s+)?safeupdate\.enabled/i);
      assert.match(sql,/WHERE false/);assert.match(sql,/ROLLBACK;$/);
      return emit(Object.fromEntries(Object.entries(migration.terminalReadback.expected).reverse()));
    }
    if(calls.length===4){assert.equal(single,true);throw Error('lost acknowledgement');}
    if(calls.length===5)return emit(committed);
    throw Error('unexpected retry');
  };
  try {
    const receipt=runOperation('apply',{databaseUrl,sourceSha,runner});
    assert.equal(receipt.state,'committed');assert.equal(receipt.transport,'unconfirmed');assert.equal(calls.length,5);
  } finally {if(previous===undefined)delete process.env.APPLY_CONFIRMATION;else process.env.APPLY_CONFIRMATION=previous;}
});

test('already committed performs no rehearsal or second write', () => {
  let count=0;
  const receipt=runOperation('apply',{databaseUrl,sourceSha,runner:()=>{count++;return emit(committed);}});
  assert.equal(receipt.state,'already_committed');assert.equal(count,1);
});

test('changed state after rehearsal aborts before the operating write', () => {
  const previous=process.env.APPLY_CONFIRMATION;
  process.env.APPLY_CONFIRMATION=`apply:${sourceSha}:${migration.sha256}`;
  let count=0;
  try {
    assert.throws(()=>runOperation('apply',{databaseUrl,sourceSha,runner:()=>{
      count++;if(count===1)return emit(pending);
      if(count===2)return emit(migration.terminalReadback.expected);
      if(count===3)return emit(committed);
      throw Error('write should not occur');
    }}),/REHEARSAL_ROLLBACK_INVALID/);
    assert.equal(count,3);
  } finally {if(previous===undefined)delete process.env.APPLY_CONFIRMATION;else process.env.APPLY_CONFIRMATION=previous;}
});
