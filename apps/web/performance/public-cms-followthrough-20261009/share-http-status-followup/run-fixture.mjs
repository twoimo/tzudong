import {createServer} from 'node:http';
import {spawn} from 'node:child_process';
import {resolve} from 'node:path';
import {writeFileSync,openSync,closeSync} from 'node:fs';
const root=process.cwd(),out=resolve('performance/public-cms-followthrough-20261009/share-http-status-followup'),fixture=resolve(out,'fixture');
const mode=process.argv[2]??'dev',port=mode==='dev'?20370:20371;
const db=createServer((request,response)=>{
 const url=new URL(request.url,'http://127.0.0.1');
 const code=url.searchParams.get('code')?.replace(/^eq\./,'');
 response.setHeader('Content-Type','application/json');
 if(url.pathname!=='/rest/v1/short_urls'){response.statusCode=503;response.end(JSON.stringify({code:'FIXTURE_UNAVAILABLE'}));return;}
 if(code==='FAIL00'){response.statusCode=500;response.end(JSON.stringify({code:'FIXTURE_UNAVAILABLE',message:'owned fixture read failure'}));return;}
 const target=code==='VALID1'?'/?review=00000000-0000-4000-8000-000000000009':code==='BADURL'?'https://external.invalid/?review=00000000-0000-4000-8000-000000000009':code==='CTRL00'?'/\r\n?review=00000000-0000-4000-8000-000000000009':null;
 response.end(JSON.stringify(target?[{target_url:target}]:[]));
});
await new Promise(resolve=>db.listen(0,'127.0.0.1',resolve));const databasePort=db.address().port;
const env={...process.env,NEXT_PUBLIC_SUPABASE_URL:`http://127.0.0.1:${databasePort}`,NEXT_PUBLIC_SUPABASE_ANON_KEY:'owned-fixture-no-authority',NEXT_PUBLIC_SITE_URL:`http://127.0.0.1:${port}`,NEXT_PUBLIC_TZUDONG_LOCAL_RUNTIME:'1',NEXT_TELEMETRY_DISABLED:'1',FIXTURE_NEXT_DIST_DIR:mode==='dev'?'.next-dev':'.next-production'};
const log=openSync(resolve(out,`fixture-${mode}-final-rebuild.log`),'w');
let child;
const run=(args)=>new Promise(resolveRun=>{const command=spawn(process.execPath,[resolve(root,'node_modules/next/dist/bin/next'),...args],{cwd:fixture,env,stdio:['ignore',log,log]});command.on('exit',code=>resolveRun(code));});
if(mode==='production') {const code=await run(['build','--webpack']);if(code!==0){db.close();closeSync(log);process.exit(code??1);}}
child=spawn(process.execPath,[resolve(root,'node_modules/next/dist/bin/next'),mode==='dev'?'dev':'start',...(mode==='dev'?['--webpack']:[]),'--hostname','127.0.0.1','--port',String(port)],{cwd:fixture,env,stdio:['ignore',log,log]});
writeFileSync(resolve(out,`fixture-${mode}-ownership.json`),JSON.stringify({mode,port,childPid:child.pid,controllerPid:process.pid,databasePort,scope:'owned synthetic local fixture; no operating credentials or data'},null,2)+'\n');
const cleanup=()=>{child?.kill('SIGTERM');db.close();};process.on('SIGTERM',cleanup);process.on('SIGINT',cleanup);child.on('exit',()=>{db.close();closeSync(log);});
console.log(`owned ${mode} fixture launched on ${port}`);
await new Promise(resolveWait=>child.on('exit',resolveWait));
