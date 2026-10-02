import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, cp, mkdtemp, rm } from 'node:fs/promises';
import { constants } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { redactCliText } from '../../scripts/privacy-safe-cli-log.mjs';
const role=process.argv[2],label=process.argv[3];
assert.ok(['baseline','candidate'].includes(role));assert.match(label,/^[a-z0-9-]+$/);
assert.equal(Number(process.versions.node.split('.')[0]),24);
const here=new URL('./',import.meta.url),app=new URL('../../',here);
const delivery=process.env.TZUDONG_PERF_SOURCE_WORKTREE||'/Users/twoimo/.codex/worktrees/marker-memory-release-20261002/tzudong';
const sourceCommit=process.env.PERF_BUILD_SOURCE_COMMIT||'835d702452ab0039b830b97a674aff03a905821c';assert.match(sourceCommit,/^[a-f0-9]{40}$/);
const paths=['components/map/NaverMapView.tsx','components/map/marker-icons.css','lib/cluster-marker.ts','lib/marker-pool.ts','lib/deferred-marker-renders.ts','tests-unit/marker-pool.test.ts','tests-unit/deferred-marker-renders.test.ts','tests-unit/expanded-cluster-flow-invariants.test.ts','components/admin/AdminOverviewDashboard.tsx'];
const hash=x=>createHash('sha256').update(x).digest('hex');
const distDir=`.next-real-sdk-${role}-${label}-20260930`,output=new URL(`build-${role}-${label}/`,here);
await mkdir(output);
const scratch=await mkdtemp(join(tmpdir(),'tzudong-memory-recovery-')),root=join(scratch,'source'),copyApp=join(root,'apps/web');
try {
 await mkdir(root);
 const archive=join(scratch,'source.tar');
 execFileSync('git',['archive','--format=tar',`--output=${archive}`,sourceCommit,'apps/web'],{cwd:delivery});
 execFileSync('tar',['-xf',archive,'-C',root,'--exclude=apps/web/performance']);
 const patch=role==='candidate'?execFileSync('git',['diff',sourceCommit,'--',...paths.map(x=>'apps/web/'+x)],{cwd:delivery}):Buffer.alloc(0);
 await writeFile(new URL('source.patch',output),patch,{flag:'wx'});
 if(patch.length)execFileSync('git',['apply','--unsafe-paths','-'],{cwd:root,input:patch});
 await cp(new URL('node_modules/',app),join(copyApp,'node_modules'),{recursive:true,mode:constants.COPYFILE_FICLONE});
 const config={};
 for(const line of (await readFile(new URL('.env.production.local',app),'utf8')).split('\n')) {
  const i=line.indexOf('=');if(i<1)continue;const key=line.slice(0,i);
  if(['NEXT_PUBLIC_SUPABASE_URL','NEXT_PUBLIC_SUPABASE_ANON_KEY','NEXT_PUBLIC_NAVER_CLIENT_ID'].includes(key))config[key]=JSON.parse(line.slice(i+1));
 }
 assert.equal(Object.keys(config).length,3);assert.ok(!Object.values(config).some(x=>x==='[SENSITIVE]'));
 const inputPaths=['components/map/NaverMapView.tsx','lib/naver-map-render-plan.ts','lib/marker-pool.ts','package-lock.json','lib/web-vitals.tsx','lib/performance/field-vitals.ts','next.config.mjs','lib/cluster-marker.ts','components/legal/PrivacyPolicyContent.tsx','components/legal/HydratedContactEmail.tsx','components/admin/AdminOverviewDashboard.tsx'];
 if(role==='candidate')inputPaths.push('components/map/marker-icons.css','lib/deferred-marker-renders.ts');
 const inputs=[];for(const original of inputPaths){try{inputs.push({original,sha256:hash(await readFile(join(copyApp,original)))});}catch(e){if(role==='baseline'&&sourceCommit==='da805ea2602f4ed83e6e77e52e9da0b74ba2f8c5'&&e.code==='ENOENT'&&['lib/performance/field-vitals.ts','components/legal/HydratedContactEmail.tsx'].includes(original))continue;throw e;}}
 let log='';
 const child=spawn(process.execPath,['node_modules/next/dist/bin/next','build','--webpack'],{cwd:copyApp,env:{PATH:process.env.PATH,HOME:process.env.HOME,TMPDIR:process.env.TMPDIR,NODE_ENV:'production',NODE_OPTIONS:process.env.PERF_BUILD_NODE_OPTIONS||'',VERCEL_GIT_COMMIT_SHA:sourceCommit,NEXT_TELEMETRY_DISABLED:'1',TZUDONG_NEXT_DIST_DIR:distDir,...config},stdio:['ignore','pipe','pipe']});
 for(const stream of [child.stdout,child.stderr])stream.on('data',b=>{const safe=redactCliText(b.toString(),16384);log+=safe;process.stdout.write(safe);});
 const code=await new Promise((resolve,reject)=>{child.on('error',reject);child.on('exit',resolve);});
 await writeFile(new URL('build.log',output),log,{flag:'wx'});assert.equal(code,0);
 const built=join(copyApp,distDir),standalone=join(built,'standalone/apps/web');
 await cp(join(built,'static'),join(standalone,distDir,'static'),{recursive:true,errorOnExist:true,force:false});
 await cp(join(copyApp,'public'),join(standalone,'public'),{recursive:true});
 const buildId=(await readFile(join(built,'BUILD_ID'),'utf8')).trim();
 await cp(built,new URL(distDir,app),{recursive:true,errorOnExist:true,force:false,mode:constants.COPYFILE_FICLONE});
 await writeFile(new URL('receipt.json',output),JSON.stringify({kind:role,sourceCommit,distDir,buildId,patchSha256:hash(patch),inputs,node:process.version,next:JSON.parse(await readFile(new URL('node_modules/next/package.json',app),'utf8')).version,configurationNames:Object.keys(config),sdk:'actual remote Naver SDK, not local stub',privateConfigurationInArtifacts:false,rebuildAfterArchivedIgnoredRuntime:true,oldRawMeasurementsNotOverwritten:true},null,2)+'\n',{flag:'wx'});
} finally {await rm(scratch,{recursive:true,force:true});}
