import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {spawn} from 'node:child_process';import {createServer,request} from 'node:http';import {fileURLToPath} from 'node:url';import os from 'node:os';
import {resourceSnapshot} from './resources.mjs';
import {chromium} from '@playwright/test';import {clusterSample} from './sample.mjs';
const here=new URL('./',import.meta.url),app=new URL('../../',here),label=process.argv[2]||'paired-v6',root=new URL(label+'/',here);await mkdir(root);
for(const name of ['runtime.mjs','sample.mjs','paired.mjs','resources.mjs','plan-v6.json','resources-plan.json'])await writeFile(new URL(name+'.txt',root),await readFile(new URL(name,here)),{flag:'wx'});
const plan=JSON.parse(await readFile(new URL('plan-v6.json',here)));const builds={},children=[];let active='baseline',proxy,browser;
const raw={scope:plan.scope,plan,environment:{node:process.version,harness:Bun.version,os:os.platform(),release:os.release(),arch:os.arch(),logicalCores:os.cpus().length,cpuModel:os.cpus()[0].model,cache:'Fresh browser context and empty app/query storage every sample; HTTP cache disabled by interception; same warmed Node servers and browser process, alternating order.',networkFence:'Fresh context, serviceWorkers blocked, redirected loopback HTTPS fenced by CDP; anonymous auth boundaries preserved and unverified.',network:'120ms simulated fixture service latency; external traffic blocked. Extra CDP 150ms RTT / 1.6Mbps downstream for throttle secondary cell.'},builds,pairs:[],warmups:[]};
const ports={baseline:3311,candidate:3312};
try{
 for(const kind of ['baseline','candidate']){
  const receipt=JSON.parse(await readFile(new URL(`build-${kind}-${kind==='candidate'?'v7':'v1'}/receipt.json`,here)));builds[kind]=receipt;
  const child=spawn('/opt/homebrew/opt/node@24/bin/node',[fileURLToPath(new URL(`${receipt.distDir}/standalone/apps/web/server.js`,app))],{cwd:fileURLToPath(app),env:{PATH:process.env.PATH,HOME:process.env.HOME,NODE_ENV:'production',HOSTNAME:'127.0.0.1',PORT:String(ports[kind])},stdio:'ignore'});children.push(child);
  let ready=false;for(let i=0;i<150;i++){if(child.exitCode!==null)throw Error('owned server stopped');try{if((await fetch(`http://localhost:${ports[kind]}`)).ok){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,100));}if(!ready)throw Error('server not ready');
 }
 proxy=createServer((incoming,out)=>{const q=request({hostname:'localhost',port:ports[active],path:incoming.url,method:incoming.method,headers:incoming.headers},r=>{out.writeHead(r.statusCode,r.headers);r.pipe(out);});q.on('error',()=>{out.writeHead(502);out.end();});incoming.pipe(q);});await new Promise(r=>proxy.listen(3310,'localhost',r));
 browser=await chromium.launch({headless:true});raw.environment.browser=browser.version();
 const cells=process.argv.includes('--secondary')?plan.secondaryCells:plan.cells;
 const n=process.argv.includes('--secondary')?9:plan.pairsPerPrimaryCell;
 for(let cell=0;cell<cells.length;cell++)for(let i=-plan.warmupPairs;i<n;i++){
  const options=cells[cell],order=(i+cell)%2===0?['baseline','candidate']:['candidate','baseline'];const pair={cell,options,index:i,order};
  for(const kind of order){active=kind;const resourceBefore=resourceSnapshot();pair[kind]=await clusterSample(browser,options,i===0?fileURLToPath(new URL(`${kind}-cell-${cell}.png`,root)):null);pair[kind].resourceBefore=resourceBefore;pair[kind].resourceAfter=resourceSnapshot();await writeFile(new URL(`sample-${cell}-${i}-${kind}.json`,root),JSON.stringify(pair[kind],null,2)+'\n',{flag:'wx'});}
  const snapshots=order.flatMap(kind=>[pair[kind].resourceBefore,pair[kind].resourceAfter]);pair.loadClass=snapshots.some(x=>x.saturated)?'saturated':snapshots.some(x=>x.heavyOverlap)?'heavy_overlap':'quiet';pair.unequalLoad=Math.max(...snapshots.map(x=>x.otherCpuPercent))-Math.min(...snapshots.map(x=>x.otherCpuPercent))>200;
  (i<0?raw.warmups:raw.pairs).push(pair);
  await writeFile(new URL(`pair-${cell}-${i<0?'warm'+(-i):String(i).padStart(2,'0')}.json`,root),JSON.stringify(pair,null,2)+'\n',{flag:'wx'});
  console.log(JSON.stringify({cell,index:i,before:pair.baseline.summary.clickToExpandedMs,after:pair.candidate.summary.clickToExpandedMs,markers:[pair.baseline.summary.markerCount,pair.candidate.summary.markerCount]}));
 }
 await writeFile(new URL('raw.json',root),JSON.stringify(raw,null,2)+'\n',{flag:'wx'});
}catch(error){await writeFile(new URL('rejected.json',root),JSON.stringify({...raw,failure:error.name,safeState:error.safeState||null},null,2)+'\n',{flag:'wx'});throw error;}
finally{if(browser)await browser.close();if(proxy)await new Promise(r=>proxy.close(r));for(const child of children)if(child.exitCode===null)child.kill('SIGTERM');}
