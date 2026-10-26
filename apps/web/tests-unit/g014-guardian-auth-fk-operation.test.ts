import { describe, expect, test } from 'bun:test';
import { constants, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { assertBoundExpectations, atomicSuccessorSql, buildOperation, disposition, executeOperation, guardianGuards, operationIdentity, OriginalJournal, ORIGINAL_JOURNAL_PATH, validateAdmission, parseReadback, pendingFields, runOperation, successorReconciliationSql } from '../scripts/g014-guardian-auth-fk-operation.mjs';
import { statementSpans } from '../scripts/supabase-migration-transaction.mjs';

const root=resolve(import.meta.dir,'../../..');
const original=buildOperation();
const sha='a'.repeat(40);
const operationId='fixture/guardian97-original';
const emit=(v:unknown)=>JSON.stringify(v)+'\n';
const options=(o:any,runner:any,journal:any)=>({sourceSha:sha,operationId,confirmation:`apply:${sha}:${o.plan.sourceSha256}`,runner,journal});

// Synthetic expected states only: these are NEVER written into the source contract.
function boundFixture() {
  const o=structuredClone(original);
  o.contract.executionEnabled=true;
  Object.assign(o.contract.bindingEvidence,{actualPG17SuccessorVerified:true,hostedExpectedVerified:true,officialParserVerified:true,priorManifestAfter96Verified:true,pendingFields:[]});
  const terminal=structuredClone(o.migration.expectedPriorState.expected);
  terminal.predecessor.legacy.ledgerCount=97;
  terminal.predecessor.legacy.ledgerPrefix='1'.repeat(64);
  terminal.predecessor.legacy.oldRelations='2'.repeat(64);
  const guardian=terminal.guardian.find((r:any)=>r.name==='privacy_guardian_verifications');
  guardian.ownerUpdate=true;guardian.acl='{privacy_workflow_owner=rwd/privacy_workflow_owner}';
  Object.assign(terminal.manifest,{manifestCount:1964,actualCount:1964,targetCount:1,targetValues:[{grantable:false}],manifestSha256:'3'.repeat(64)});
  o.migration.terminalReadback.expected=terminal;
  return o;
}
function states(o:any) {
  return {absent:{ledger_exists:false,ledger_equal:false,prior:o.migration.expectedPriorState.expected,terminal:null},
    committed:{ledger_exists:true,ledger_equal:true,prior:null,terminal:o.migration.terminalReadback.expected}};
}
class MemoryJournal {
  identity:any;phase='prepared';sends=0;reservations=0;records:any[]=[];
  constructor(o:any){this.identity=operationIdentity(o,sha,operationId);}
  assertIdentity(i:any){if(!isDeepStrictEqual(i,this.identity))throw Error('identity drift');}
  assertAdmission(i:any){this.assertIdentity(i);}
  reserve(i:any){this.assertIdentity(i);if(this.phase!=='prepared')throw Error('spent');this.phase='rehearsing';this.reservations++;}
  spend(i:any){this.assertIdentity(i);if(this.phase!=='rehearsing')throw Error('spent');this.phase='send_spent';this.sends++;}
  record(r:any){this.assertIdentity(Object.fromEntries(Object.keys(this.identity).map(k=>[k,r[k]])));this.phase=r.state;this.records.push(structuredClone(r));}
}
function sequence(o:any,{lost=false,after=states(o).committed,rollback=states(o).absent,rehearsal=o.migration.terminalReadback.expected}:{lost?:boolean,after?:any,rollback?:any,rehearsal?:any}={}) {
  const calls:{sql:string,single:boolean}[]=[];const journal=new MemoryJournal(o);
  const runner=(sql:string,single:boolean)=>{
    calls.push({sql,single});
    switch(calls.length){
      case 1:return emit(states(o).absent);
      case 2:expect(single).toBe(false);expect(sql.startsWith('BEGIN;')).toBe(true);expect(sql.endsWith('ROLLBACK;')).toBe(true);return emit(rehearsal);
      case 3:return emit(rollback);
      case 4:expect(journal.phase).toBe('send_spent');expect(journal.sends).toBe(1);if(lost)throw Error('synthetic lost ACK');return '';
      case 5:if(after instanceof Error)throw after;return emit(after);
      default:throw Error('unexpected transport replay');
    }
  };return {calls,journal,runner};
}

describe('pinned disabled authoring',()=>{
  test('unknown97 is explicit and apply stops before transport or journal access',()=>{
    expect(original.contract.executionEnabled).toBe(false);
    expect(original.migration.terminalReadback.expected).toBeNull();
    expect(pendingFields(original).length).toBeGreaterThan(0);
    let calls=0;
    expect(()=>executeOperation('apply',original,options(original,()=>{calls++;},null))).toThrow('EXECUTION_DISABLED_OR_UNBOUND');
    expect(()=>runOperation('apply',{databaseUrl:'invalid'})).toThrow('EXECUTION_DISABLED_OR_UNBOUND');
    expect(calls).toBe(0);
  });
  test('changed source and contract bytes are rejected',()=>{
    const contract=readFileSync(resolve(root,'.github/g014-guardian-auth-fk-install.v1.json'));
    const source=readFileSync(resolve(root,original.migration.path));
    expect(()=>buildOperation({contractBytes:Buffer.concat([contract,Buffer.from('\n')])})).toThrow('CONTRACT_DRIFT');
    expect(()=>buildOperation({sourceBytes:Buffer.concat([source,Buffer.from('\n')])})).toThrow('SOURCE_DRIFT');
  });
  test('official source identity keeps all11 original statements and removes only outer envelope',()=>{
    expect(original.plan.originalVector.length).toBe(11);
    expect(original.plan.originalVector[0].endsWith('BEGIN')).toBe(true);
    expect(original.plan.originalVector.at(-1)).toBe('COMMIT');
    expect(original.plan.execution).not.toEqual(readFileSync(resolve(root,original.migration.path),'utf8'));
    expect(createHash('sha256').update(JSON.stringify(original.plan.originalVector)).digest('hex')).toBe(original.contract.statementVectorSha256);
  });
  test('unknown observe reports unbound without claiming completion',()=>{
    const v=executeOperation('observe',original,options(original,()=>emit({state:'predecessor_not_ready'}),null));
    expect(v.state).toBe('unbound');expect(v.pendingFields.length).toBeGreaterThan(0);
  });
  test('reader branches absent predecessor before planning nonexistent96 relations',()=>{
    const sql=successorReconciliationSql(original);
    expect(sql.startsWith("SET LOCAL search_path=''; SET TRANSACTION READ ONLY;")).toBe(true);
    expect(sql.indexOf('\\if :predecessor_ready')).toBeLessThan(sql.indexOf('WITH cut AS MATERIALIZED'));
    expect(sql).toContain('predecessor_not_ready');
    expect(sql.match(/SET TRANSACTION READ ONLY/g)?.length).toBe(1);
    expect(sql).toContain('row_security_active');
    expect(original.contract.projections.manifestQuery.includes('PERFORM privacy_retention.')).toBe(false);
  });
  test('original v194 sourcebody hash pins and empty display context are preserved',()=>{
    expect(original.contract.projections.functionBodyPins).toHaveLength(10);
    expect(original.contract.projections.manifestQuery).not.toContain('clock_timestamp');
    expect(original.migration.expectedPriorState.expected.manifest.restSha256).toBe('24def9503a2e787e2dc5c79ae290c2d0be9272f3f2b44ee7a810c80be0506542');
    expect(original.migration.expectedPriorState.expected.manifest.rowSecurityActive).toBe(false);
  });
});

describe('caller SQL and exact acceptance',()=>{
  test('same serializer and compiler retain a single outer transaction, exact source and ledger',()=>{
    const o=boundFixture();const sql=atomicSuccessorSql(o);const spans=statementSpans(sql);
    expect(spans.filter((s:any)=>/^(BEGIN|COMMIT|ROLLBACK)$/i.test(s.token))).toHaveLength(0);
    expect(sql).toContain(o.plan.execution);
    expect(spans.filter((s:any)=>/^INSERT INTO supabase_migrations.schema_migrations/.test(s.token))).toHaveLength(1);
    expect(sql.indexOf('pg_advisory_xact_lock')).toBeLessThan(sql.indexOf('LOCK TABLE supabase_migrations'));
    expect(sql.indexOf('guardian97_pre$')).toBeLessThan(sql.indexOf(o.plan.execution));
    expect(sql.indexOf('guardian97_post$')).toBeGreaterThan(sql.indexOf(o.plan.execution));
    expect(sql.indexOf('guardian97_post$')).toBeLessThan(sql.indexOf('INSERT INTO supabase_migrations.schema_migrations'));
  });
  test('four real owner checks run after lease restoration; exact manifest symmetric difference guarded',()=>{
    const {before,after}=guardianGuards(boundFixture());
    for(const name of ['workflow_owner','public_rpc_allowlist','definer','catalog'])expect(before).toContain(`PERFORM privacy_retention.assert_g014_${name}_contract`.replace('public_rpc_allowlist_contract','public_rpc_allowlist') );
    expect(before.indexOf('REVOKE privacy_workflow_owner FROM postgres GRANTED BY postgres')).toBeLessThan(before.indexOf("PERFORM pg_temp.guardian97_g014_check('pre')"));
    expect(after).toContain('EXCEPT');expect(after).toContain("'grantable'".replaceAll("'",'"'));
    expect(after).toContain('GUARDIAN_SUCCESSOR_PRESERVATION_DRIFT');
  });
  test('partial ledger or ACL/manifest without ledger is never admitted',()=>{
    const o=boundFixture();for(const value of [{state:'partial'}, {...states(o).committed,ledger_equal:false}, {...states(o).absent,prior:states(o).committed.terminal}])expect(disposition(value,o)).toBe('drift');
  });
  test('wrong grant value, rest hash, counts, guardian API ACL and membership fields fail exact readback',()=>{
    const o=boundFixture();const edits=[
      (x:any)=>x.manifest.targetValues[0].grantable=true,
      (x:any)=>x.manifest.restSha256='0'.repeat(64),
      (x:any)=>x.manifest.targetCount=0,
      (x:any)=>x.manifest.manifestCount++,
      (x:any)=>x.guardian.find((r:any)=>r.name==='privacy_guardian_verifications').apiUpdate.service_role=true,
      (x:any)=>x.predecessor.legacy.members='0'.repeat(64),
      (x:any)=>x.predecessorLedgersEqual=false,
      (x:any)=>x.predecessor.legacy.ledgerCount=98,
    ];for(const edit of edits){const value=structuredClone(states(o).committed);edit(value.terminal);expect(disposition(value,o)).toBe('drift');}
  });
  test('binding cannot broaden97 to another ledger, API grant, registry or manifest rest',()=>{
    const changes=[(x:any)=>x.predecessor.legacy.ledgerCount=98,(x:any)=>x.predecessor.legacy.members='0'.repeat(64),
      (x:any)=>x.manifest.targetValues=[{grantable:true}],(x:any)=>x.manifest.restSha256='0'.repeat(64),
      (x:any)=>x.guardian[1].apiUpdate.service_role=true];
    for(const change of changes){const o=boundFixture();change(o.migration.terminalReadback.expected);expect(()=>assertBoundExpectations(o)).toThrow('BOUND_EXPECTATIONS_INVALID');}
  });
  test('duplicate output lines, noise, arrays and oversized JSON are rejected',()=>{
    for(const output of ['{}\n{}\n','notice\n{}','[]','null','{"state":0,"state":1}','{"nested":{"a":0,"a":1}}','x'.repeat(256*1024+1)])expect(()=>parseReadback(output)).toThrow('READBACK_INVALID');
    expect(parseReadback(' \n{}\n')).toEqual({});
  });
});

describe('one-shot original journal state machine',()=>{
  test('normal result is independently read and one operating send follows durable spent',()=>{
    const o=boundFixture();const s=sequence(o);const result=executeOperation('apply',o,options(o,s.runner,s.journal));
    expect(result.state).toBe('committed');expect(s.calls).toHaveLength(5);expect(s.journal.sends).toBe(1);expect(s.journal.phase).toBe('committed');
    expect(result.after).toEqual(o.migration.terminalReadback.expected);
  });
  test('lost ACK reads the original result with no second send or identity',()=>{
    const o=boundFixture();const s=sequence(o,{lost:true});const result=executeOperation('apply',o,options(o,s.runner,s.journal));
    expect(result.transport).toBe('unconfirmed');expect(result.operationId).toBe(operationId);expect(s.calls).toHaveLength(5);expect(s.journal.sends).toBe(1);
  });
  test('post-send partial, absent or readback failure retains original unconfirmed journal',()=>{
    for(const after of [{state:'partial'},new Error('readback lost'),states(boundFixture()).absent]){
      const o=boundFixture();const s=sequence(o,{after});expect(()=>executeOperation('apply',o,options(o,s.runner,s.journal))).toThrow('RECONCILE_ORIGINAL');
      expect(s.calls).toHaveLength(5);expect(s.journal.sends).toBe(1);expect(s.journal.phase).toBe('unconfirmed_reconcile_original');expect(s.journal.identity.operationId).toBe(operationId);
    }
  });
  test('rollback readback or rehearsal drift prevents operating send',()=>{
    for(const change of [{rollback:{state:'partial'}},{rehearsal:{ok:true}}]){
      const o=boundFixture();const s=sequence(o,change);expect(()=>executeOperation('apply',o,options(o,s.runner,s.journal))).toThrow('RECONCILE_ORIGINAL');
      expect(s.journal.sends).toBe(0);expect(s.calls.length).toBeLessThan(4);
    }
  });
  test('spent original journal cannot replay a not-applied DB',()=>{
    const o=boundFixture();const journal=new MemoryJournal(o);journal.phase='send_spent';let calls=0;
    expect(()=>executeOperation('apply',o,options(o,()=>{calls++;return emit(states(o).absent);},journal))).toThrow('spent');
    expect(calls).toBe(1);expect(journal.sends).toBe(0);expect(journal.phase).toBe('send_spent');
  });
  test('different original ID or source fails before transport',()=>{
    const o=boundFixture();for(const override of [{operationId:'new-id'},{sourceSha:'b'.repeat(40)}]){
      const journal=new MemoryJournal(o);let calls=0;
      expect(()=>executeOperation('apply',o,{...options(o,()=>{calls++;},journal),...override})).toThrow('identity drift');expect(calls).toBe(0);
    }
  });
  test('already committed requires exact metadata but performs only SELECT',()=>{
    const o=boundFixture();const journal=new MemoryJournal(o);journal.phase='send_spent';let calls=0;
    const result=executeOperation('apply',o,options(o,()=>{calls++;return emit(states(o).committed);},journal));
    expect(result.state).toBe('already_committed');expect(calls).toBe(1);expect(journal.reservations).toBe(0);
  });
  test('confirmation requires same source/migration and original journal',()=>{
    const o=boundFixture();const s=sequence(o);
    expect(()=>executeOperation('apply',o,{...options(o,s.runner,s.journal),confirmation:'wrong'})).toThrow('CONFIRMATION_INVALID');expect(s.calls).toHaveLength(0);
    expect(()=>executeOperation('apply',o,options(o,s.runner,null))).toThrow('ORIGINAL_JOURNAL_REQUIRED');
  });
  test('reconcile is read-only even for a spent journal and never invokes reserve',()=>{
    const o=boundFixture();const journal=new MemoryJournal(o);journal.phase='send_spent';let calls=0;
    const result=executeOperation('reconcile',o,options(o,(sql:string,single:boolean)=>{calls++;expect(single).toBe(true);expect(sql).toContain('SET TRANSACTION READ ONLY');return emit(states(o).committed);},journal));
    expect(result.state).toBe('committed');expect(calls).toBe(1);expect(journal.reservations).toBe(0);
  });
});

const fixedNow=new Date('2026-10-26T14:00:00Z');
function admission(identity:any) {
  return {authority:'authenticated-repository-owner-local-cli',sourceSha:identity.sourceSha,operationId:identity.operationId,
    observedAt:'2026-10-26T13:59:00Z',expiresAt:'2026-10-26T14:01:00Z',
    protectedMain:{repository:'twoimo/tzudong',sha:identity.sourceSha,protected:true,ownerVerified:true},
    fences:{githubDisabled:true,githubDrained:true,macIdle:true,generalFreeze:'active',dataPlaneApproved:'1'}};
}
// Exercise the real filesystem adapter control flow entirely against in-memory spies.
function journalFixture(o:any) {
  const identity=operationIdentity(o,sha,operationId);
  const directory=ORIGINAL_JOURNAL_PATH.slice(0,ORIGINAL_JOURNAL_PATH.lastIndexOf('/'));
  const files=new Map([[ORIGINAL_JOURNAL_PATH,emit({schemaVersion:1,kind:'g014_guardian_original_operation',identity,phase:'prepared',admission:admission(identity)})]]);
  const fds=new Map<number,string>();const events:string[]=[];let next=1;let now=fixedNow;
  const io={
    realpathSync:(p:string)=>p,
    lstatSync:(_p:string)=>({isDirectory:()=>true,isSymbolicLink:()=>false,uid:process.getuid(),mode:0o700}),
    openSync:(p:string,flags:number)=>{if((flags&constants.O_EXCL)!==0 && files.has(p))throw Error('exclusive lock exists');if((flags&constants.O_CREAT)!==0)files.set(p,'');if(!files.has(p)&&p!==directory)throw Error('not found');const fd=next++;fds.set(fd,p);events.push('open:'+p);return fd;},
    fstatSync:(fd:number)=>({isFile:()=>true,nlink:1,size:Buffer.byteLength(files.get(fds.get(fd)!)!),uid:process.getuid(),mode:0o600}),
    readFileSync:(fd:number)=>files.get(fds.get(fd)!),
    writeFileSync:(fd:number,value:string)=>{files.set(fds.get(fd)!,value);events.push('write:'+fds.get(fd));},
    fsyncSync:(fd:number)=>{events.push('fsync:'+fds.get(fd));},
    closeSync:(fd:number)=>{fds.delete(fd);},
    renameSync:(a:string,b:string)=>{files.set(b,files.get(a)!);files.delete(a);events.push('rename:'+b);},
  };
  const create=()=>new OriginalJournal(ORIGINAL_JOURNAL_PATH,{io,now:()=>now,verifySource:()=>{events.push('source-verified');}});
  return {identity,files,events,create,setNow:(v:Date)=>{now=v;}};
}

describe('real original-journal adapter with fake filesystem',()=>{
  test('exclusive reservation, durable spent and final result preserve one original identity',()=>{
    const o=boundFixture();const f=journalFixture(o);const journal=f.create();
    journal.assertAdmission(f.identity);journal.reserve(f.identity);journal.spend(f.identity);
    const stored=JSON.parse(f.files.get(ORIGINAL_JOURNAL_PATH)!);
    expect(stored.phase).toBe('send_spent');expect(stored.identity).toEqual(f.identity);
    expect(f.events.filter(e=>e==='fsync:'+ORIGINAL_JOURNAL_PATH+'.tmp').length).toBe(2);
    const result={...f.identity,state:'committed'};journal.record(result);
    expect(JSON.parse(f.files.get(ORIGINAL_JOURNAL_PATH)!).identity).toEqual(f.identity);
    expect(f.files.has(ORIGINAL_JOURNAL_PATH+'.apply.lock')).toBe(true);
  });
  test('a second adapter cannot reserve a spent original journal',()=>{
    const f=journalFixture(boundFixture());f.create().reserve(f.identity);
    expect(()=>f.create().reserve(f.identity)).toThrow('ORIGINAL_ATTEMPT_SPENT');
  });
  test('crash lock prevents retry even if the journal still says prepared',()=>{
    const f=journalFixture(boundFixture());f.files.set(ORIGINAL_JOURNAL_PATH+'.apply.lock','original intent');
    const originalBytes=f.files.get(ORIGINAL_JOURNAL_PATH);
    expect(()=>f.create().reserve(f.identity)).toThrow('exclusive lock exists');
    expect(f.files.get(ORIGINAL_JOURNAL_PATH)).toBe(originalBytes);
  });
  test('expiry after rehearsal blocks spend while original reconciliation remains possible',()=>{
    const f=journalFixture(boundFixture());const journal=f.create();journal.reserve(f.identity);
    f.setNow(new Date('2026-10-26T14:01:00Z'));
    expect(()=>journal.spend(f.identity)).toThrow('OWNER_ADMISSION_INVALID_OR_EXPIRED');
    expect(()=>journal.assertIdentity(f.identity)).not.toThrow();
    expect(JSON.parse(f.files.get(ORIGINAL_JOURNAL_PATH)!).phase).toBe('rehearsing');
  });
  test('admission rejects missing fence, different protected source and expiry',()=>{
    const o=boundFixture();const identity=operationIdentity(o,sha,operationId);
    for(const edit of [(a:any)=>a.fences.macIdle=false,(a:any)=>a.protectedMain.sha='b'.repeat(40),(a:any)=>a.operationId='new',(a:any)=>a.expiresAt=fixedNow.toISOString()]){
      const a=admission(identity);edit(a);expect(()=>validateAdmission(a,identity,fixedNow)).toThrow('OWNER_ADMISSION_INVALID_OR_EXPIRED');
    }
    expect(()=>validateAdmission(admission(identity),identity,fixedNow)).not.toThrow();
  });
  test('owner CLI cannot substitute another journal path',()=>{
    expect(()=>new OriginalJournal('/different/original.json')).toThrow('JOURNAL_PATH_INVALID');
  });
});
