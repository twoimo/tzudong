import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
const dir='/Users/twoimo/.codex/runtime-cache/pipeline-recovery-20261007/pg17-refresh-20261009/bound-snapshot-v3';
const image='supabase/postgres@sha256:fbe6c858a2ea9616aead3c39e132afcc0660decc5cb7dc656208ed145f5331ab';
const docker='/opt/homebrew/bin/docker',context='colima-tzudong-catalog-20261007',container='tzudong-record-fixes-20261009-a1390aca';
const fail=code=>{throw new Error(code)};
const sha=b=>createHash('sha256').update(b).digest('hex');
const ident=s=>{if(!/^[a-z_][a-z0-9_]*$/.test(s))fail('IDENTIFIER_DENIED');return '"'+s+'"';};
const literal=s=>"'"+s.replaceAll("'","''")+"'";
try {
 const info=spawnSync(docker,['--context',context,'inspect',container],{encoding:'utf8',timeout:10000});if(info.status!==0)fail('CONTAINER_UNAVAILABLE');
 const c=JSON.parse(info.stdout)[0];if(c.Config.Labels?.['tzudong.record-owner']!=='01a0f860-10d0-71b0-bb2a-95c2b52e025e'||c.Config.Image!==image||c.HostConfig.NetworkMode!=='none'||Object.keys(c.HostConfig.PortBindings??{}).length||c.State.Status!=='running')fail('CONTAINER_ADMISSION_DENIED');
 const run=(stage,sql)=>{const r=spawnSync(docker,['--context',context,'exec','-i','-e','PGPASSWORD=fixture-only',container,'psql','-X','-qAt','-v','ON_ERROR_STOP=1','-v','VERBOSITY=sqlstate','-h','127.0.0.1','-U','supabase_admin','-d','postgres'],{input:sql,encoding:'utf8',timeout:60000,maxBuffer:4*1024*1024});if(r.error||r.status!==0){const state=r.stderr?.match(/ERROR:\s+([A-Z0-9]{5})/);console.log(JSON.stringify({stage,status:'failed',sqlState:state?.[1]??null,timeout:r.error?.code==='ETIMEDOUT'}));fail('CLONE_STAGE_FAILED');}return r.stdout;};
 const meta=JSON.parse(readFileSync(dir+'/pg17-hosted-role-metadata-private.json'));
 const manifest=JSON.parse(readFileSync(dir+'/bound-snapshot-manifest.json')); const snapshot={schemaSha256:manifest.artifacts['pg17-hosted-schema-private.sql'].sha256,contractSha256:manifest.artifacts['pg17-hosted-contract-private.sql'].sha256}; for(const [name,info] of Object.entries(manifest.artifacts)){const bytes=readFileSync(dir+'/'+name);if(bytes.length!==info.bytes||sha(bytes)!==info.sha256)fail('BOUND_SNAPSHOT_DRIFT');}
 const schema=readFileSync(dir+'/pg17-hosted-schema-private.sql','utf8'),contract=readFileSync(dir+'/pg17-hosted-contract-private.sql','utf8');
 if(sha(schema)!==snapshot.schemaSha256||sha(contract)!==snapshot.contractSha256)fail('SNAPSHOT_DRIFT');
 let roles='BEGIN;\n';
 for(const role of meta.roles){const name=ident(role.name);
  if(role.name.startsWith('pg_')) {
   const config=role.config===null||role.config===undefined?'NULL':`ARRAY[${role.config.map(literal).join(',')}]::text[]`;
   roles+=`DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname=${literal(role.name)} AND rolsuper=${role.superuser} AND rolinherit=${role.inherit} AND rolcreaterole=${role.createRole} AND rolcreatedb=${role.createDb} AND rolcanlogin=${role.login} AND rolbypassrls=${role.bypassRls} AND rolreplication=${role.replication} AND rolconnlimit=${role.connectionLimit} AND rolconfig IS NOT DISTINCT FROM ${config}) THEN RAISE EXCEPTION 'ENGINE_ROLE_MISMATCH'; END IF; END $$;\n`;
   continue;
  }
  roles+=`DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname=${literal(role.name)}) THEN CREATE ROLE ${name}; END IF; END $$;\nALTER ROLE ${name} ${role.superuser?'SUPERUSER':'NOSUPERUSER'} ${role.inherit?'INHERIT':'NOINHERIT'} ${role.createRole?'CREATEROLE':'NOCREATEROLE'} ${role.createDb?'CREATEDB':'NOCREATEDB'} ${role.login?'LOGIN':'NOLOGIN'} ${role.bypassRls?'BYPASSRLS':'NOBYPASSRLS'} ${role.replication?'REPLICATION':'NOREPLICATION'} CONNECTION LIMIT ${role.connectionLimit};\nALTER ROLE ${name} RESET ALL;\n`;
  for(const config of role.config??[]){const index=config.indexOf('='),key=config.slice(0,index),value=config.slice(index+1);if(!/^[a-z_][a-z0-9_.]*$/.test(key))fail('ROLE_CONFIG_DENIED');roles+=key==='search_path'?`SELECT set_config(${literal(key)},${literal(value)},false); ALTER ROLE ${name} SET ${key} FROM CURRENT; RESET ${key};\n`:`ALTER ROLE ${name} SET ${key} TO ${literal(value)};\n`;}
 }
 for(const m of meta.members)roles+=`GRANT ${ident(m.role)} TO ${ident(m.member)} WITH ADMIN ${m.admin?'TRUE':'FALSE'}, INHERIT ${m.inherit?'TRUE':'FALSE'}, SET ${m.set?'TRUE':'FALSE'} GRANTED BY ${ident(m.grantor)};\n`;
 roles+='COMMIT;\n';run('roles',roles);

 const result={kind:'isolated-pg17-role-bootstrap',observedAt:new Date().toISOString(),image,serverVersion:run('version',"SELECT current_setting('server_version');").trim(),roleCount:meta.roles.length,membershipCount:meta.members.length,schemaSha256:snapshot.schemaSha256,contractSha256:snapshot.contractSha256,userRowsCopied:0,operatingWrites:false,containerNetwork:'none',publishedPorts:0};
 writeFileSync('/Users/twoimo/.codex/worktrees/pipeline-admin-integration-20261007/tzudong/apps/web/performance/record-review-fixes-20261009/role-bootstrap.json',JSON.stringify(result,null,2)+'\n',{mode:0o600,flag:'wx'});console.log(JSON.stringify(result));
}catch(e){console.error(/^[A-Z_]+$/.test(e.message)?e.message:'CLONE_UNCONFIRMED_NO_DIAGNOSTICS');process.exitCode=2;}
