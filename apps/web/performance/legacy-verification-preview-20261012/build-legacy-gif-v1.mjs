import {readFileSync, writeFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
const app = '/Users/twoimo/.codex/worktrees/sync-data-motion-20261012/tzudong/apps/web';
const requiredSha = 'b143ba4fc5747d4b26ddaea690861dcf82be3324';
const req = createRequire(app + '/package.json');
if (process.versions.node !== '24.21.0' || req('next/package.json').version !== '16.3.8') throw Error('RUNTIME_BINDING_DENIED');
const sha = spawnSync('git', ['rev-parse', 'HEAD'], {cwd:app, encoding:'utf8'}).stdout.trim();
if (sha !== requiredSha) throw Error('SOURCE_BINDING_DENIED');
const parsed = req('dotenv').parse(readFileSync('/Users/twoimo/Documents/projects/tzudong/apps/web/.env.local'));
const env = {...process.env, NODE_ENV:'production', TZUDONG_NEXT_DIST_DIR:'.next-legacy-gif-review-v1', VERCEL_GIT_COMMIT_SHA:sha};
for (const key of ['NEXT_PUBLIC_SUPABASE_URL','NEXT_PUBLIC_SUPABASE_ANON_KEY','NEXT_PUBLIC_NAVER_CLIENT_ID','NEXT_PUBLIC_GOOGLE_MAPS_API_KEY']) {
  if (parsed[key]) env[key] = parsed[key];
}
const result = spawnSync(process.execPath,[app+'/node_modules/next/dist/bin/next','build'],{cwd:app,env,stdio:'inherit'});
const receipt = {sourceSha:sha,node:process.versions.node,next:'16.3.8',distDir:env.TZUDONG_NEXT_DIST_DIR,
  exit:result.status,publicConfigOnly:true,serverKeyRead:false,operatingWrites:0,
  packageLockSha256:createHash('sha256').update(readFileSync(app+'/package-lock.json')).digest('hex')};
if (result.status === 0) receipt.buildId = readFileSync(app+'/'+env.TZUDONG_NEXT_DIST_DIR+'/BUILD_ID','utf8').trim();
writeFileSync(new URL('legacy-gif-build-v1.json',import.meta.url),JSON.stringify(receipt,null,2)+'\n',{flag:'wx'});
if(result.status !== 0) process.exitCode=1;
