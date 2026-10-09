import { readFileSync,writeFileSync,mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { dirname,resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyMigrationWithTerminalReadback } from '/Users/twoimo/.codex/worktrees/pipeline-admin-integration-20261007/tzudong/apps/web/scripts/apply-supabase-migration.mjs';
import { migrationEnvelope,atomicMigrationSql,reconciliationSql } from '/Users/twoimo/.codex/worktrees/pipeline-admin-integration-20261007/tzudong/apps/web/scripts/supabase-migration-transaction.mjs';
const out=dirname(fileURLToPath(import.meta.url)), repo='/Users/twoimo/.codex/worktrees/pipeline-admin-integration-20261007/tzudong';
const kind=process.argv[2];const resource=JSON.parse(readFileSync(resolve(out,kind==='pg15'?'pg15-resource.json':'resource-plan.json')));
const cid=kind==='pg15'?resource.containerId:readFileSync(resolve(out,'owned-container-id.txt'),'utf8').trim();
const docker='/opt/homebrew/bin/docker',ctx='colima-tzudong-catalog-20261007';const db=`atomic_runtime_${kind}_${Date.now()}`;
const sha=v=>createHash('sha256').update(v).digest('hex');let calls=0;let lost=false;let owned=false;
function sql(text,database=db,single=false){
 const args=['--context',ctx,'exec','-i','-e','PGPASSWORD=fixture-only',cid,'psql','-X','-qAt','-v','ON_ERROR_STOP=1','-v','VERBOSITY=verbose','-h','127.0.0.1','-U','postgres','-d',database];if(single)args.push('--single-transaction');
 const r=spawnSync(docker,args,{input:text,encoding:'utf8',timeout:30000,maxBuffer:10*1024*1024});
 if(r.error||r.status!==0){const state=/ERROR:\s+([A-Z0-9]{5})/.exec(r.stderr)?.[1];const error=new Error(`MIGRATION_PSQL_FAILED_${state??'UNKNOWN'}`);error.code=error.message;error.fixedSqlCode=/ERROR:\s+(?:[A-Z0-9]{5}:\s*)?(MIGRATION_[A-Z0-9_]+)\b/.exec(r.stderr)?.[1];throw error;}return r.stdout;
}
const r={status:'unconfirmed',engine:kind,operatingWrites:false,actualCaller:'applyMigrationWithTerminalReadback',cases:[]};mkdirSync(resolve(out,'source-fixtures'),{recursive:true});
let ordinal=0;
function fixture(name,mode='valid'){
 ordinal++;const version=`20261009${String(130000+ordinal).padStart(6,'0')}`;const table=`fixture_${name}`;
 const source=`-- owned runtime fixture only\nBEGIN;\nCREATE TABLE public.${table}(id int);\n${mode==='ddl'?'SELECT * FROM public.fixture_nonexistent;\n':''}COMMIT;\n`;
 const path=resolve(out,'source-fixtures',`${version}_${name}.sql`);writeFileSync(path,source);
 const m={id:name,path:`backend/supabase/migrations/${version}_${name}.sql`,sha256:sha(source),expectedPriorState:{query:`SELECT json_build_object('absent',to_regclass('public.${table}') IS NULL)::text;`,expected:{absent:true}},terminalReadback:{query:`SELECT json_build_object('ready',to_regclass('public.${table}') IS NOT NULL)::text;`,expected:{ready:mode!=='mismatch'}}};
 const readVectorImpl=()=>{const a=spawnSync(process.execPath,[resolve(repo,'backend/supabase/scripts/g037_supabase_statement_vector.mjs'),'--source',path,'--version',version,'--sha256',m.sha256,'--size',String(Buffer.byteLength(source))],{encoding:'utf8'});if(a.status)throw Error('VECTOR_INVALID');return JSON.parse(a.stdout).statements;};
 const runPsqlImpl=(_url,q,single)=>{calls++;const result=sql(q,db,single);if(lost&&calls===1){const e=new Error('MIGRATION_PSQL_EXECUTION_FAILED');e.code=e.message;throw e;}return result;};
 return {m,source,version,table,readVectorImpl,runPsqlImpl};
}
function observe(f){return JSON.parse(sql(`SELECT json_build_object('table',to_regclass('public.${f.table}') IS NOT NULL,'ledger',EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE version='${f.version}'))::text;`).trim());}
try{
 const info=JSON.parse(spawnSync(docker,['--context',ctx,'inspect',cid],{encoding:'utf8'}).stdout)[0];if(info.Config.Labels['tzudong.phased-run']!==resource.name||info.HostConfig.NetworkMode!=='none')throw Error('RESOURCE_DENIED');
 sql(`CREATE DATABASE ${db} OWNER postgres;`,'postgres');owned=true;
 sql('CREATE SCHEMA supabase_migrations;CREATE TABLE supabase_migrations.schema_migrations(version text PRIMARY KEY,name text,statements text[]);');
 r.version=sql("SELECT current_setting('server_version');").trim();
 for(const mode of ['valid','mismatch','ddl']){
  const f=fixture(mode,mode);calls=0;lost=false;let code=null;
  try{const value=applyMigrationWithTerminalReadback('fixture',f.m,f.source,f);if(JSON.stringify(value)!==JSON.stringify(f.m.terminalReadback.expected))throw Error('OUTPUT_SHAPE');}catch(e){code=e.code??e.message;}
  const state=observe(f);if(mode==='valid'){if(code||!state.table||!state.ledger)throw Error('VALID_FAILED');const original=f.readVectorImpl();const actual=JSON.parse(sql(`SELECT json_build_object('statements',statements)::text FROM supabase_migrations.schema_migrations WHERE version='${f.version}';`).trim()).statements;if(JSON.stringify(actual)!==JSON.stringify(original))throw Error('LEDGER_VECTOR_DRIFT');}
  else if(!code||state.table||state.ledger)throw Error('ROLLBACK_FAILED');
  r.cases.push({mode,code,state,driverCalls:calls});
 }
 const f=fixture('lost');calls=0;lost=true;const value=applyMigrationWithTerminalReadback('fixture',f.m,f.source,f);if(calls!==2||JSON.stringify(value)!=='{"ready":true}')throw Error('RECONCILIATION_SHAPE_OR_RESEND');r.cases.push({mode:'lost_ack',state:observe(f),driverCalls:calls,terminal:value});
 const p=migrationEnvelope(Buffer.from(f.source),f.m,f.readVectorImpl());const decoded=JSON.parse(sql(reconciliationSql(p,f.m),db,true).trim());if(JSON.stringify(decoded.terminal)!=='{"ready":true}'||JSON.stringify(decoded.prior)!=='{"absent":false}')throw Error('COMPOSITE_ROW_LEAK');r.reconciliationShape=decoded;
 // Multicolumn and multirow readbacks fail in the database before commit.
 for(const type of ['multirow','invalidjson']){const z=fixture(type);z.m.terminalReadback.query=type==='multirow'?"SELECT '{\"ready\":true}'::text UNION ALL SELECT '{\"ready\":true}'::text;":"SELECT 'not-json'::text;";calls=0;lost=false;let failed=false;try{applyMigrationWithTerminalReadback('fixture',z.m,z.source,z);}catch{failed=true;}const a=observe(z);if(!failed||a.table||a.ledger)throw Error('MALFORMED_READBACK_COMMITTED');r.cases.push({mode:type,state:a});}
 const conflict=fixture('conflict');sql(`INSERT INTO supabase_migrations.schema_migrations VALUES('${conflict.version}','conflict',ARRAY['different fixture content']);`);calls=0;lost=false;let denied=null;try{applyMigrationWithTerminalReadback('fixture',conflict.m,conflict.source,conflict);}catch(e){denied=e.code;}if(denied!=='MIGRATION_RECONCILIATION_CONFLICT'||observe(conflict).table)throw Error('LEDGER_CONFLICT_NOT_BOUNDED');r.cases.push({mode:'ledger_conflict',code:denied,noDdl:true});
 const insufficient=fixture('insufficient');sql('ALTER TABLE supabase_migrations.schema_migrations ADD COLUMN fixture_extra int;');calls=0;lost=false;denied=null;try{applyMigrationWithTerminalReadback('fixture',insufficient.m,insufficient.source,insufficient);}catch(e){denied=e.code;}if(denied!=='MIGRATION_LEDGER_CONTRACT_INSUFFICIENT'||observe(insufficient).table||observe(insufficient).ledger)throw Error('LEDGER_SHAPE_NOT_DENIED');sql('ALTER TABLE supabase_migrations.schema_migrations DROP COLUMN fixture_extra;');r.cases.push({mode:'insufficient_ledger_shape',code:denied,noDdl:true});
 const z=fixture('prior_drift');z.m.expectedPriorState.expected={absent:false};calls=0;lost=false;denied=null;try{applyMigrationWithTerminalReadback('fixture',z.m,z.source,z);}catch(e){denied=e.code;}if(denied!=='MIGRATION_OUTCOME_UNCONFIRMED'&&denied!=='MIGRATION_RECONCILIATION_CONFLICT'&&denied!=='MIGRATION_PRIOR_STATE_MISMATCH')throw Error('PRIOR_NOT_DENIED');if(observe(z).table||observe(z).ledger)throw Error('PRIOR_WROTE');r.cases.push({mode:'prior_mismatch',code:denied,noDdl:true});
 r.status='passed';
}catch(e){r.failure={code:e.code??e.message};}
finally{if(owned){sql(`DROP DATABASE ${db};`,'postgres');r.ownedDbDropped=true;}writeFileSync(resolve(out,`${kind}-caller-runtime.json`),JSON.stringify(r,null,2)+'\n');console.log(JSON.stringify(r));if(r.status!=='passed')process.exitCode=1;}
