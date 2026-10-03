import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile, cp, rm, unlink } from 'node:fs/promises';
import { constants } from 'node:fs';
import { spawn, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { redactCliText } from '../../scripts/privacy-safe-cli-log.mjs';

assert.equal(process.versions.node.split('.')[0], '24');
const here = new URL('./', import.meta.url), app = new URL('../../', here);
const source = '/Users/twoimo/.codex/worktrees/marker-memory-release-20261002/tzudong';
const label = process.argv[2]; assert.match(label, /^[a-z0-9-]{1,20}$/);
const output = new URL(`build-candidate-${label}/`, here), distDir = `.next-ui-${label}`;
await mkdir(output);
const hash = x => createHash('sha256').update(x).digest('hex');
const head = execFileSync('git', ['rev-parse', 'HEAD'], {cwd:source, encoding:'utf8'}).trim();
const scratch = await mkdtemp(join(tmpdir(), 'tzudong-ui-cf-build-')), root = join(scratch, 'source'), copyApp = join(root, 'apps/web');
try {
  await mkdir(root);
  const archive = join(scratch, 'source.tar');
  execFileSync('git', ['archive', '--format=tar', `--output=${archive}`, head, 'apps/web'], {cwd:source});
  execFileSync('tar', ['-xf', archive, '-C', root, '--exclude=apps/web/performance']);
  const names = execFileSync('git', ['diff', '--name-only', head, '--', 'apps/web'], {cwd:source, encoding:'utf8'}).trim().split('\n').filter(Boolean);
  const removed = 'apps/web/public/fonts/ChosunCentennial_otf.otf';
  assert.ok(names.includes(removed));
  const patch = execFileSync('git', ['diff', head, '--', ...names.filter(x=>x!==removed)], {cwd:source});
  await writeFile(new URL('source.patch', output), patch, {flag:'wx'});
  if (patch.length) execFileSync('git', ['apply','--unsafe-paths','-'], {cwd:root, input:patch});
  const oldFont = await readFile(join(root, removed));
  assert.equal(hash(oldFont), '8c2eeb55898708b108032eb0baddabfbf7c98a78c3411a2f2601c7bdeff1cfb7');
  assert.equal(hash(await readFile(join(source, 'assets/source-fonts/ChosunCentennial_otf.otf'))), hash(oldFont));
  await unlink(join(root, removed));
  const added = ['components/filters/MapFilterTriggerLabel.tsx','lib/public-large-assets.mjs'];
  for(const name of added) await cp(join(source,'apps/web',name),join(copyApp,name),{errorOnExist:true,force:false});
  await cp(new URL('node_modules/', app), join(copyApp,'node_modules'), {recursive:true,mode:constants.COPYFILE_FICLONE});
  const env = {};
  for(const line of (await readFile(new URL('.env.production.local',app),'utf8')).split('\n')) {
    const at=line.indexOf('='); if(at<1)continue; const key=line.slice(0,at);
    if(['NEXT_PUBLIC_SUPABASE_URL','NEXT_PUBLIC_SUPABASE_ANON_KEY','NEXT_PUBLIC_NAVER_CLIENT_ID'].includes(key))env[key]=JSON.parse(line.slice(at+1));
  }
  assert.equal(Object.keys(env).length,3);
  const inputs=[];
  for(const name of [...names.filter(x=>x!==removed).map(x=>x.slice('apps/web/'.length)),...added,'package-lock.json'])inputs.push({path:name,sha256:hash(await readFile(join(copyApp,name)))});
  let log='';
  const child=spawn(process.execPath,['node_modules/next/dist/bin/next','build','--webpack'],{cwd:copyApp,env:{PATH:process.env.PATH,HOME:process.env.HOME,TMPDIR:process.env.TMPDIR,NODE_ENV:'production',NEXT_TELEMETRY_DISABLED:'1',VERCEL_GIT_COMMIT_SHA:head,TZUDONG_NEXT_DIST_DIR:distDir,...env},stdio:['ignore','pipe','pipe']});
  for(const stream of [child.stdout,child.stderr])stream.on('data',b=>{const safe=redactCliText(b.toString(),16384);log+=safe;process.stdout.write(safe);});
  const exit=await new Promise((resolve,reject)=>{child.on('error',reject);child.on('exit',resolve);});
  await writeFile(new URL('build.log',output),log,{flag:'wx'});assert.equal(exit,0);
  const built=join(copyApp,distDir),standalone=join(built,'standalone/apps/web');
  await cp(join(built,'static'),join(standalone,distDir,'static'),{recursive:true,errorOnExist:true,force:false});
  await cp(join(copyApp,'public'),join(standalone,'public'),{recursive:true});
  const buildId=(await readFile(join(built,'BUILD_ID'),'utf8')).trim();
  await cp(built,new URL(distDir,app),{recursive:true,errorOnExist:true,force:false,mode:constants.COPYFILE_FICLONE});
  await writeFile(new URL('receipt.json',output),JSON.stringify({sourceCommit:head,patchSha256:hash(patch),inputs,removedPublicFont:{path:removed,bytes:oldFont.length,sha256:hash(oldFont),sourcePreserved:true},distDir,buildId,node:process.version,next:JSON.parse(await readFile(join(copyApp,'node_modules/next/package.json'),'utf8')).version,configurationNames:Object.keys(env),privateConfigurationInArtifacts:false,uiAndCloudflareSourceIncluded:true,poolOrderCandidateIncluded:true,deployed:false},null,2)+'\n',{flag:'wx'});
} finally { await rm(scratch,{recursive:true,force:true}); }
