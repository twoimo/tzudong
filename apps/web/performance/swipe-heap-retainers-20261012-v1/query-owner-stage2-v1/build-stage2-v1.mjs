import {readFile,writeFile} from 'node:fs/promises';
import {createWriteStream} from 'node:fs';
import {spawn,execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';

assert.equal(process.versions.node,'24.21.0');
const here=new URL('./',import.meta.url),kind=process.argv[2];
assert.ok(['before','after'].includes(kind));
const root='/Users/twoimo/.codex/worktrees/review-query-lifetime-20261012/tzudong/apps/web';
const sourceCommit=execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim();
if(kind==='before')assert.equal(sourceCommit,'056a86600f412eb42df4304e3206841679012f3e');
const require=createRequire(root+'/package.json');
assert.equal(require('next/package.json').version,'16.3.8');
assert.equal(require('@playwright/test/package.json').version,'1.63.0');
const npm='/Users/twoimo/.codex/runtime-cache/memory-retainers-runtime-20261012/node_modules/npm/bin/npm-cli.js';
assert.equal(execFileSync(process.execPath,[npm,'--version'],{encoding:'utf8'}).trim(),'11.6.2');
// Existing file is parsed only in RAM. Only the four public settings are forwarded.
const envValues=require('dotenv').parse(await readFile('/Users/twoimo/Documents/projects/tzudong/apps/web/.env.local'));
const allowed=['NEXT_PUBLIC_SUPABASE_URL','NEXT_PUBLIC_SUPABASE_ANON_KEY','NEXT_PUBLIC_NAVER_CLIENT_ID','NEXT_PUBLIC_SITE_URL'];
const publicEnv=Object.fromEntries(allowed.map(key=>[key,envValues[key]]).filter(([,value])=>typeof value==='string'&&value));
for(const key of allowed.slice(0,3))assert.ok(publicEnv[key]);
const distDir='.next-query-owner-stage2-'+kind+'-v1';
const env={PATH:'/opt/homebrew/opt/node@24/bin:/usr/bin:/bin:/usr/sbin:/sbin',HOME:process.env.HOME,
  NODE_ENV:'production',NEXT_TELEMETRY_DISABLED:'1',TZUDONG_NEXT_DIST_DIR:distDir,...publicEnv};
const {redactCliText}=await import(pathToFileURL(root+'/scripts/privacy-safe-cli-log.mjs'));
const output=createWriteStream(new URL('build-'+kind+'-v1.log',here),{flags:'wx'});
const child=spawn(process.execPath,['scripts/clean-next.mjs','--','node','node_modules/next/dist/bin/next','build','--webpack'],{cwd:root,env,stdio:['ignore','pipe','pipe']});
const forward=chunk=>{
  let text=chunk.toString();
  for(const value of Object.values(publicEnv))text=text.split(value).join('<public-build-setting>');
  output.write(redactCliText(text,32768));
};
child.stdout.on('data',forward);child.stderr.on('data',forward);
const code=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',resolve);});
output.end();await new Promise(resolve=>output.once('close',resolve));
const result={kind,root,sourceCommit,distDir,node:process.versions.node,npm:'11.6.2',next:'16.3.8',
  compileExit:code,canonicalWebpackCompile:true,wholeExistingEnvFileParsedInRam:true,
  publicSettingsForwarded:allowed.filter(key=>publicEnv[key]),serverSettingsForwarded:false,envValuesPersisted:false};
if(code===0) {
  result.buildId=(await readFile(root+'/'+distDir+'/BUILD_ID','utf8')).trim();
  const {verifyBuildRouteCssBoundaries}=await import(pathToFileURL(root+'/scripts/verify-route-css-boundaries.mjs'));
  try {result.css=verifyBuildRouteCssBoundaries({nextDirectory:root+'/'+distDir});result.cssActualDirectoryValidated=true;}
  catch {result.cssActualDirectoryValidated=false;result.cssFailure='actual_named_dist_css_rejected';}
  const hash=async file=>createHash('sha256').update(await readFile(file)).digest('hex');
  result.lockSha256=await hash(root+'/package-lock.json');
  result.helperSourceSha256=await hash(root+'/lib/mobile-home-search-selection.ts');
  result.pageManifestSha256=await hash(root+'/'+distDir+'/server/app/page_client-reference-manifest.js');
}
await writeFile(new URL('build-'+kind+'-v1.json',here),JSON.stringify(result,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({kind,sourceCommit,compileExit:code,cssActualDirectoryValidated:result.cssActualDirectoryValidated??false,buildId:result.buildId??null}));
if(code!==0||!result.cssActualDirectoryValidated)process.exitCode=1;
