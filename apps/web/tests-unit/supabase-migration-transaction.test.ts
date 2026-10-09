import { expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { migrationEnvelope, statementSpans, atomicMigrationSql, reconciliationSql, reconciliationOutcome } from '../scripts/supabase-migration-transaction.mjs';
import { applyMigrationWithTerminalReadback, readOriginalStatementVector, main, RELEASE_MIGRATION_MANIFEST_PATH } from '../scripts/apply-supabase-migration.mjs';
const sha=(value:string)=>createHash('sha256').update(value).digest('hex');
const source='-- fixture\nBEGIN;\nCREATE TABLE fixture_atomic(id int);\nCOMMIT;\n';
const migration={id:'fixture_atomic',path:'backend/supabase/migrations/20261009120000_fixture_atomic.sql',sha256:sha(source),expectedPriorState:{query:"SELECT '{\"absent\":true}'::text;",expected:{absent:true}},terminalReadback:{query:"SELECT '{\"ready\":true}'::text;",expected:{ready:true}}};
const vector=(sql:string)=>statementSpans(sql).map((s:{token:string})=>s.token);
const plan=()=>migrationEnvelope(Buffer.from(source),migration,vector(source));
const pinnedVector=(sql:string,version='20261009123000')=>{
  const directory=mkdtempSync(join(tmpdir(),'tzudong-begin-atomic-'));
  const path=join(directory,`${version}_begin_atomic_fixture.sql`);
  try{
    writeFileSync(path,sql);
    const result=spawnSync(process.execPath,[
      fileURLToPath(new URL('../../../backend/supabase/scripts/g037_supabase_statement_vector.mjs',import.meta.url)),
      '--source',path,'--version',version,'--sha256',sha(sql),'--size',String(Buffer.byteLength(sql)),
    ],{encoding:'utf8'});
    expect(result.status).toBe(0);
    return JSON.parse(result.stdout).statements as string[];
  }finally{rmSync(directory,{force:true,recursive:true});}
};

test('four exact source envelopes agree with pinned provider-source parser and preserve body bytes',()=>{
  for(const name of ['20261004190259_admin_record_guarded_actions.sql','20261004192657_admin_evaluation_raw_warning_groups.sql','20261004194715_admin_evaluation_raw_warning_invoker_contract.sql','20261009022915_restaurant_review_manual_preview_eligibility.sql']){
    const path=`backend/supabase/migrations/${name}`;const bytes=readFileSync(new URL(`../../../${path}`,import.meta.url));
    const m={...migration,path,sha256:createHash('sha256').update(bytes).digest('hex')};
    const v=readOriginalStatementVector(m,bytes);const p=migrationEnvelope(bytes,m,v);
    expect(p.originalVector).toEqual(v);expect(p.execution).not.toBe(bytes.toString());expect(p.sourceSha256).toBe(m.sha256);
  }
});
test('hash/vector drift and all intermediate control aliases are rejected before a call',()=>{
  expect(()=>migrationEnvelope(Buffer.from(source+' '),migration,vector(source))).toThrow('DIGEST_MISMATCH');
  expect(()=>migrationEnvelope(Buffer.from(source),migration,['BEGIN'])).toThrow('VECTOR_MISMATCH');
  for(const control of ['COMMIT','END','ROLLBACK','ABORT','START TRANSACTION','SAVEPOINT a','RELEASE a','PREPARE TRANSACTION \'x\'']){
    const sql=source.replace('CREATE TABLE',`${control};\nCREATE TABLE`);const m={...migration,sha256:sha(sql)};
    expect(()=>migrationEnvelope(Buffer.from(sql),m,vector(sql))).toThrow('TRANSACTION_CONTROL_DENIED');
  }
});
test('quoted/dollar/comment control text remains untouched; unsupported meta commands reject',()=>{
  const sql="BEGIN;DO $body$ BEGIN PERFORM 'COMMIT;'; /* ROLLBACK; */ END $body$;COMMIT;";
  const p=migrationEnvelope(Buffer.from(sql),{...migration,sha256:sha(sql)},vector(sql));
  expect(p.execution).toContain("PERFORM 'COMMIT;'");expect(p.execution).toContain('/* ROLLBACK; */');
  expect(()=>statementSpans('\\include arbitrary.sql')).toThrow('META_COMMAND_DENIED');
});
test('BEGIN ATOMIC and parenthesis nesting match the pinned G037 statement vector',()=>{
  const sql=`CREATE FUNCTION public.plus_one(x integer) RETURNS integer LANGUAGE SQL IMMUTABLE
BEGIN ATOMIC
  SELECT (x + (1));
END;
SELECT (2 + (3));
`;
  const pinned=pinnedVector(sql);
  const observed=vector(sql);
  expect(observed).toEqual(pinned);
  expect(observed).toHaveLength(2);
  expect(observed[0]).toContain('SELECT (x + (1));');
});
test('CASE nesting and END identifier suffixes cannot terminate a BEGIN ATOMIC body',()=>{
  for(const body of [
    `CREATE FUNCTION public.case_fixture(x integer) RETURNS integer LANGUAGE SQL\nBEGIN ATOMIC\n  SELECT CASE WHEN x > 0 THEN x ELSE 0 END;\nEND;`,
    `CREATE FUNCTION public.nested_case_fixture(x integer) RETURNS integer LANGUAGE SQL\nBEGIN ATOMIC\n  SELECT CASE WHEN x > 0 THEN CASE WHEN x > 1 THEN 2 ELSE 1 END ELSE 0 END;\nEND;`,
    `CREATE FUNCTION public.identifier_fixture(weekend text) RETURNS text LANGUAGE SQL\nBEGIN ATOMIC\n  SELECT weekend;\n  SELECT weekend;\nEND;`,
  ]){
    const sql=`${body}\nSELECT 2;`;
    const observed=vector(sql);
    expect(observed).toEqual([body.slice(0,-1),'SELECT 2']);
    expect(sql.slice(0,statementSpans(sql)[0].end-1)).toBe(body.slice(0,-1));
  }
});
test('comments between BEGIN and ATOMIC are whitespace to PostgreSQL but exceed the pinned provider vector',()=>{
  const body=`CREATE FUNCTION public.comment_fixture() RETURNS integer LANGUAGE SQL\nBEGIN /* reviewed gap */ ATOMIC\n  SELECT 1;\nEND;`;
  const sql=`${body}\nSELECT 2;`;
  const observed=vector(sql);
  const pinned=pinnedVector(sql,'20261009123001');
  expect(observed).toEqual([body.slice(0,-1),'SELECT 2']);
  expect(pinned).toEqual([
    body.slice(0,body.indexOf(';')),
    'END',
    'SELECT 2',
  ]);
  expect(observed).not.toEqual(pinned);
  const pinnedMigration={...migration,path:'backend/supabase/migrations/20261009123001_begin_atomic_fixture.sql',sha256:sha(sql)};
  expect(()=>migrationEnvelope(Buffer.from(sql),pinnedMigration,pinned)).toThrow('MIGRATION_VECTOR_MISMATCH');
});
test('standard strings keep backslashes literal while escape strings may quote with backslashes',()=>{
  const ordinary=String.raw`SELECT 'C:\';`;
  const escaped=String.raw`SELECT E'quoted \'';`;
  expect(statementSpans(ordinary).map((entry:{token:string})=>entry.token)).toEqual([ordinary.slice(0,-1)]);
  expect(statementSpans(escaped).map((entry:{token:string})=>entry.token)).toEqual([escaped.slice(0,-1)]);
});
test('comment-separated prepared transactions remain denied',()=>{
  const sql="BEGIN;PREPARE/* reviewed comment */TRANSACTION 'fixture';COMMIT;";
  expect(()=>migrationEnvelope(Buffer.from(sql),{...migration,sha256:sha(sql)},vector(sql))).toThrow('TRANSACTION_CONTROL_DENIED');
});
test('terminal state is checked after exact ledger insertion and no source transaction boundary reaches payload',()=>{
  const sql=atomicMigrationSql(plan(),migration);
  expect(sql).toContain('INTO STRICT');expect(sql).toContain('IS DISTINCT FROM');expect(sql).toContain('MIGRATION_PRIOR_STATE_MISMATCH');
  expect(sql.indexOf('INSERT INTO supabase_migrations.schema_migrations')).toBeLessThan(sql.indexOf('MIGRATION_LEDGER_READBACK_FAILED'));
  expect(sql.indexOf('MIGRATION_LEDGER_READBACK_FAILED')).toBeLessThan(sql.indexOf('MIGRATION_TERMINAL_READBACK_FAILED'));
  expect(sql).toContain(JSON.stringify(vector(source)).replaceAll("'","''"));
  expect(statementSpans(sql).some((s:{token:string})=>/^(BEGIN|COMMIT)\b/i.test(s.token))).toBe(false);
});
test('insufficient query contracts deny before connection; no forged expected default',()=>{
  for(const query of ['UPDATE secret SET x=1','SELECT 1; SELECT 2','WITH x AS (DELETE FROM x RETURNING *) SELECT * FROM x','\\echo bad']){
    let calls=0;const m={...migration,expectedPriorState:{...migration.expectedPriorState,query}};
    expect(()=>applyMigrationWithTerminalReadback('fixture',m,source,{readVectorImpl:()=>vector(source),runPsqlImpl:()=>{calls++;return '';}})).toThrow();expect(calls).toBe(0);
  }
});
test('long escaped readback literals compile while mutation outside literals remains denied',()=>{
  const escaped='\\&'.repeat(15000);
  const query=`SELECT '${escaped} INSERT UPDATE DELETE'::text;`;
  const m={...migration,expectedPriorState:{...migration.expectedPriorState,query}};
  expect(atomicMigrationSql(plan(),m)).toContain(escaped);
  for(const mutation of ['INSERT','UPDATE','DELETE']){
    const bad={...m,expectedPriorState:{...m.expectedPriorState,query:`SELECT '${escaped}'::text ${mutation} forbidden;`}};
    expect(()=>atomicMigrationSql(plan(),bad)).toThrow('MIGRATION_READBACK_CONTRACT_INSUFFICIENT');
  }
});
test('dollar literals and nested comments are ignored by readback mutation admission',()=>{
  const query="SELECT jsonb_build_object('definition',$body$UPDATE hidden SET value=1$body$) /* outer /* DELETE */ INSERT */;";
  const m={...migration,expectedPriorState:{...migration.expectedPriorState,query}};
  expect(()=>atomicMigrationSql(plan(),m)).not.toThrow();
});
test('ledger state selects one valid readback and the lock precedes catalog validation',()=>{
  const sql=atomicMigrationSql(plan(),migration);
  const prior=sql.indexOf('absent');
  const ledgerBranch=sql.indexOf("IF EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE version='20261009120000')");
  expect(ledgerBranch).toBeGreaterThan(-1);expect(ledgerBranch).toBeLessThan(prior);
  expect(sql.indexOf('LOCK TABLE supabase_migrations.schema_migrations IN EXCLUSIVE MODE')).toBeLessThan(sql.indexOf("FROM pg_attribute WHERE attrelid='supabase_migrations.schema_migrations'::regclass"));
  expect(sql).toContain("has_table_privilege(current_user,'supabase_migrations.schema_migrations','UPDATE')");
  expect(sql).toContain("has_table_privilege(current_user,'supabase_migrations.schema_migrations','DELETE')");
  expect(sql).toContain("has_table_privilege(current_user,'supabase_migrations.schema_migrations','TRUNCATE')");
  const reconcile=reconciliationSql(plan(),migration);
  expect(reconcile).toStartWith("SET TRANSACTION READ ONLY; SET LOCAL standard_conforming_strings=on;");
  expect(reconcile).toContain('AS ledger_exists \\gset');
  expect(reconcile).toContain('\\if :ledger_exists');
  expect(reconcile).toContain('\\else');
});
test('ambiguous lost ACK reconciles once without resend and remains unconfirmed',()=>{
  const calls:string[]=[];
  expect(()=>applyMigrationWithTerminalReadback('fixture',migration,source,{readVectorImpl:()=>vector(source),runPsqlImpl:(_url:string,sql:string)=>{
    calls.push(sql);if(calls.length===1)throw new Error('lost acknowledgement');
    return JSON.stringify({ledger_exists:true,ledger_equal:true,prior:null,terminal:{ready:true}});
  }})).toThrow('MIGRATION_OUTCOME_UNCONFIRMED');
  expect(calls).toHaveLength(2);expect(calls[1]).toContain('SET TRANSACTION READ ONLY');expect(calls[1]).not.toContain('INSERT INTO');
});
test('server terminal guard rollback stays unconfirmed when another runner later commits',()=>{
  const calls:string[]=[];
  const guard=Object.assign(new Error('private server detail'),{fixedSqlCode:'MIGRATION_TERMINAL_READBACK_FAILED'});
  expect(()=>applyMigrationWithTerminalReadback('fixture',migration,source,{readVectorImpl:()=>vector(source),runPsqlImpl:(_url:string,sql:string)=>{
    calls.push(sql);if(calls.length===1)throw guard;
    return JSON.stringify({ledger_exists:true,ledger_equal:true,prior:null,terminal:{ready:true}});
  }})).toThrow('MIGRATION_OUTCOME_UNCONFIRMED');
  expect(calls).toHaveLength(2);
  expect(calls.filter(sql=>sql.includes('INSERT INTO supabase_migrations.schema_migrations'))).toHaveLength(1);
});
test('not-applied reconciliation returns only bounded error codes',()=>{
  const hostile={};
  Object.defineProperty(hostile,'fixedSqlCode',{get(){throw new Error('private fixed-code getter detail');}});
  Object.defineProperty(hostile,'code',{get(){throw new Error('private code getter detail');}});
  for(const {first,expected} of [
    {first:Object.assign(new Error('private transport message'),{cause:new Error('private cause'),marker:'private marker'}),expected:'MIGRATION_PSQL_FAILED'},
    {first:Object.assign(new Error('malformed JSON detail'),{code:'MIGRATION_READBACK_INVALID',cause:'private cause'}),expected:'MIGRATION_READBACK_INVALID'},
    {first:{code:'MIGRATION_PSQL_FAILED_P0001_PRIVATE_DETAIL',fixedSqlCode:'MIGRATION_PRIVATE_PROVIDER_DETAIL'},expected:'MIGRATION_PSQL_FAILED_P0001'},
    {first:hostile,expected:'MIGRATION_PSQL_FAILED'},
  ]){
    let calls=0;let caught:unknown;
    try{
      applyMigrationWithTerminalReadback('fixture',migration,source,{readVectorImpl:()=>vector(source),runPsqlImpl:()=>{
        calls++;if(calls===1)throw first;
        return JSON.stringify({ledger_exists:false,ledger_equal:false,prior:{absent:true},terminal:null});
      }});
    }catch(error){caught=error;}
    const bounded=caught as Error&Record<string,unknown>;
    expect(bounded.code).toBe(expected);
    expect(bounded.message).toBe(bounded.code);expect(bounded.cause).toBeUndefined();expect(bounded.marker).toBeUndefined();expect(calls).toBe(2);
  }
});
test('conflict/unknown are fixed outcomes and not-applied retains bounded failure',()=>{
  expect(reconciliationOutcome({ledger_exists:true,ledger_equal:false,prior:null,terminal:{ready:true}},migration)).toBe('partial_conflict');
  expect(reconciliationOutcome({ledger_exists:false,ledger_equal:false,prior:{absent:true},terminal:null},migration)).toBe('not_applied');
  expect(reconciliationSql(plan(),migration)).toContain('FROM jsonb_each');
  expect(reconciliationSql(plan(),migration)).not.toContain('SELECT value FROM (');
});
test('existing caller preserves pinned dry-run and valid provider-owned verify-only shape',async()=>{
  const manifest=JSON.parse(readFileSync(RELEASE_MIGRATION_MANIFEST_PATH,'utf8'));const pin='515743d094b4b431a29df772a363837bdad8f7541aa3acf4a923efb79f460c0d';
  for(const m of manifest.migrations.filter((x:{id:string})=>x.id.startsWith('g016_'))){
    const receipt={version:1,provider:'supabase',migration_id:m.id,migration_sha256:m.sha256,manifest_sha256:pin,receipt_id:'fixture-provider-123'};
    let calls=0;const result=await main(['--migration-id',m.id,'--verify-terminal-state','--provider-receipt',JSON.stringify(receipt)],{environment:{RELEASE_MIGRATION_MANIFEST_SHA256:pin,PROVIDER_MIGRATION_RECEIPT_SHA256:sha(JSON.stringify(receipt)+'\n'),SUPABASE_DB_URL:'fixture'},runPsqlImpl:()=>{calls++;return JSON.stringify(m.terminalReadback.expected);},readVectorImpl:()=>{throw Error('must not build apply envelope');}});
    expect(result.terminal_readback).toEqual(m.terminalReadback.expected);expect(result.migration_applied).toBe(false);expect(calls).toBe(1);
  }
});

test('exit0 truncated/contaminated/mismatched stdout reconciles once after committed state',()=>{
  for(const bad of ['', '{"ready":', 'untrusted extra stdout', '{"ready":false}']){
    let calls=0;const result=applyMigrationWithTerminalReadback('fixture',migration,source,{readVectorImpl:()=>vector(source),runPsqlImpl:()=>{calls++;return calls===1?bad:JSON.stringify({ledger_exists:true,ledger_equal:true,prior:null,terminal:{ready:true}});}});
    expect(result).toEqual({ready:true});expect(calls).toBe(2);
  }
});
test('local psql startup and raw diagnostics stay outside the executor contract',()=>{
  const text=readFileSync(new URL('../scripts/apply-supabase-migration.mjs',import.meta.url),'utf8');
  expect(text).toContain('--no-psqlrc');expect(text).not.toContain('result.stderr.trim()');
});
