import {spawn,execFileSync} from 'node:child_process';
import {createWriteStream} from 'node:fs';
import {writeFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
const mode=process.argv[2];
const root='/Users/twoimo/.codex/worktrees/mobile-nav-read-20261012/tzudong/apps/web';
const sourceCommit=execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim();
assert.equal(sourceCommit,'0437dd27dd3bfaecd9b7d296743ec8b98c7bf57b');
assert.equal(process.versions.node,'24.21.0');
assert.match(execFileSync('/Users/twoimo/.bun/bin/bun',['--version'],{encoding:'utf8'}).trim(),/^1\.4\.0$/);
const args=mode==='unit'?['scripts/run-unit-tests.mjs']:
  mode==='focused'?['/Users/twoimo/.bun/bin/bun','test','tests-unit/marker-pool.test.ts','tests-unit/retained-marker-accessibility.test.ts','tests-unit/naver-map-marker-visuals.test.ts']:
  mode==='parity'?['/Users/twoimo/.codex/runtime-cache/memory-retainers-runtime-20261012/node_modules/npm/bin/npm-cli.js','run','typecheck:parity']:
  mode==='lint'?['node_modules/eslint/bin/eslint.js','lib/marker-pool.ts','tests-unit/marker-pool.test.ts']:null;
assert.ok(args);
const {redactCliText}=await import(pathToFileURL(root+'/scripts/privacy-safe-cli-log.mjs'));
const log=createWriteStream(new URL(`${mode}-v1.log`,import.meta.url),{flags:'wx'});
const startedAtUtc=new Date().toISOString();
const executable=mode==='focused'?args.shift():process.execPath;
const child=spawn(executable,args,{cwd:root,env:{PATH:'/Users/twoimo/.codex/runtime-cache/mobile-nav-read-runtime-20261012/bin:/opt/homebrew/opt/node@24/bin:/Users/twoimo/.bun/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin',HOME:process.env.HOME},stdio:['ignore','pipe','pipe']});
let summaries=[];
const capture=chunk=>{
  const text=chunk.toString();
  log.write(redactCliText(text,32768));
  for(const match of text.matchAll(/(?:^|\n)\s*(\d+) (pass|skip|fail)\b/g))summaries.push({count:Number(match[1]),kind:match[2]});
};
child.stdout.on('data',capture);child.stderr.on('data',capture);
const exit=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',resolve);});
log.end();await new Promise(resolve=>log.once('close',resolve));
const counts=Object.fromEntries(['pass','skip','fail'].map(kind=>[kind,summaries.filter(r=>r.kind===kind).reduce((sum,r)=>sum+r.count,0)]));
const receipt={mode,sourceCommit,startedAtUtc,endedAtUtc:new Date().toISOString(),node:process.versions.node,exit,counts,logRedacted:true,perChunkOutputLimit:32768};
await writeFile(new URL(`${mode}-v1.json`,import.meta.url),JSON.stringify(receipt,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify(receipt));if(exit!==0)process.exitCode=1;
