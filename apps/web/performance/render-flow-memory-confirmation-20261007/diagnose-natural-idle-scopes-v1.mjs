import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {chromium} from '@playwright/test';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {serve,pageSetup,origin} from './token-runtime-v3.mjs';
import {catalog} from '../repository-quality-20261004/catalog.mjs';
import {resourceSnapshot} from '../render-flow-20260930/resources.mjs';

const here=new URL('./',import.meta.url),label=process.argv[2];assert.match(label,/^[a-z0-9-]+$/);
const bytes=await readFile(new URL(`idle-${label}-plan.json`,here)),plan=JSON.parse(bytes);
const out=new URL(`idle-${label}/`,here);await mkdir(out);
process.env.SDK_BASELINE_RECEIPT_PATH=plan.baselineReceiptPath;process.env.SDK_CANDIDATE_RECEIPT_PATH=plan.candidateReceiptPath;process.env.SDK_BASELINE_BUILD_LABEL=plan.baselineBuild;process.env.SDK_CANDIDATE_BUILD_LABEL=plan.candidateBuild;
const result={planSha256:createHash('sha256').update(bytes).digest('hex'),startedAt:new Date().toISOString(),runs:[],fieldAdmitted:0,canonicalTimingAdmitted:0};
for(let run=0;run<plan.order.length;run++){
 const probe="minimal",kind=plan.order[run],server=await serve(kind);let browser,t;
 const row={run,kind,probe,buildId:server.receipt.buildId,inputs:server.receipt.inputs,cycles:[],passed:false};
 try{
  browser=await chromium.launch({channel:'chrome',headless:true});const browserCDP=await browser.newBrowserCDPSession();
  async function processScope(){try{const v=await browserCDP.send('SystemInfo.getProcessInfo'),roles={};for(const p of v.processInfo){if(!Number.isSafeInteger(p.id)||p.id<=0)continue;let kb;try{kb=Number(execFileSync('ps',['-o','rss=','-p',String(p.id)],{encoding:'utf8',stdio:['ignore','pipe','ignore']}).trim());}catch{continue;}if(!Number.isFinite(kb))continue;const kind=/^[A-Za-z_-]{1,30}$/.test(p.type)?p.type:'other';const role=roles[kind]??={processes:0,residentMB:0};role.processes++;role.residentMB+=kb*1024/1e6;}return{supported:true,roles,scope:'owned browser process RSS; shared pages may be counted multiple times; not JS heap or unique PSS',processIdentifiersStored:false};}catch{return{supported:false,roles:null};}}row.browser=await browser.version();row.sourceCommit=server.receipt.sourceCommit;assert.equal(row.sourceCommit,kind==='baseline'?plan.baselineUnchanged:plan.candidateSource);assert.equal(row.browser,plan.expectedBrowserVersion);
  t=await pageSetup(browser,{mobile:true,count:plan.count,cpu:plan.cpuRate,captureFrames:false});
  await t.page.goto(origin+'/?__qa=bounded-retention-warm',{waitUntil:'domcontentloaded',timeout:30000});
  const cluster=t.page.locator('.cluster-marker-container').filter({hasText:String(plan.count)});
  await cluster.waitFor({state:'visible',timeout:45000});await t.page.waitForTimeout(1000);
  row.sdk=await t.page.evaluate(()=>({loaded:!!window.naver?.maps?.Map,stub:!!document.querySelector('script[data-local-naver-maps="true"]'),remote:!!document.querySelector('script[src*="oapi.map.naver.com/openapi/v3/maps.js"]'),captured:!!window.__actualSdkProbe.mapRef?.deref(),viewport:{width:innerWidth,height:innerHeight,dpr:devicePixelRatio}}));
  assert.ok(row.sdk.loaded&&row.sdk.remote&&row.sdk.captured&&!row.sdk.stub);
  await cluster.click();await t.page.waitForFunction(()=>window.__actualSdkProbe.first>0);await t.page.waitForTimeout(1000);
  const center=await t.page.evaluate(()=>{const m=window.__actualSdkProbe.mapRef.deref(),c=m.getCenter();return {lat:c.lat(),lng:c.lng(),zoom:m.getZoom()};});
  await t.page.evaluate(rows=>{window.__warmCanonicalRows=rows;},catalog(plan.count).map(({id,lat,lng})=>({id,lat,lng})));
  row.initialHeap=await t.cdp.send('Runtime.getHeapUsage');row.initialProcessScope=await processScope();
  await t.cdp.send('Performance.enable');
  row.resourceBefore=resourceSnapshot();
  await t.page.evaluate(()=>{
   window.__passiveWarmFrames={on:true,last:0,frames:[]};
   function sample(time){const p=window.__passiveWarmFrames;if(!p.on)return;if(p.last&&p.frames.length<10000)p.frames.push({time,gap:time-p.last});p.last=time;requestAnimationFrame(sample);}requestAnimationFrame(sample);
  });
  for(let cycle=0;cycle<plan.cyclesPerFreshProcess;cycle++){
   const start=await t.page.evaluate(()=>{const time=performance.now();window.__actualSdkProbe.mapRef.deref().setCenter(new window.naver.maps.LatLng(35,129));return time;});
   await t.page.waitForTimeout(plan.awayMs);
   const returnedAt=await t.page.evaluate(c=>{const time=performance.now(),m=window.__actualSdkProbe.mapRef.deref();m.setCenter(new window.naver.maps.LatLng(c.lat,c.lng));m.setZoom(c.zoom);return time;},center);
   await t.page.waitForTimeout(plan.returnSettleMs);
   const heap=await t.cdp.send('Runtime.getHeapUsage');
   const metrics=(await t.cdp.send('Performance.getMetrics')).metrics.filter(x=>['Nodes','Documents','JSEventListeners','JSHeapUsedSize','JSHeapTotalSize'].includes(x.name));
   const state=await t.page.evaluate(({rows,retainAll,start,returnedAt})=>{
    rows ||= window.__warmCanonicalRows;
    const q=window.__actualSdkProbe,m=q.mapRef.deref(),b=m.getBounds(),sw=b.getSW(),ne=b.getNE(),dy=(ne.lat()-sw.lat())*.25,dx=(ne.lng()-sw.lng())*.25;
    const viewport=rows.filter(r=>r.lat>=sw.lat()-dy&&r.lat<=ne.lat()+dy&&r.lng>=sw.lng()-dx&&r.lng<=ne.lng()+dx).map(r=>r.id),expected=retainAll?rows.map(r=>r.id):viewport;
    const ids=Array.from(document.querySelectorAll('[data-testid="marker"][data-restaurant-id]'),e=>e.dataset.restaurantId),set=new Set(ids),end=performance.now();
    const frames=window.__passiveWarmFrames.frames.filter(x=>x.time>=start&&x.time<=end),tasks=q.longTasks.filter(x=>x.start>=start&&x.start<end);
    window.__passiveWarmFrames.frames=[];
    return {start,returnedAt,end,expected:expected.length,viewportExpected:viewport.length,markers:ids.length,missing:expected.filter(id=>!set.has(id)).length,missingViewport:viewport.filter(id=>!set.has(id)).length,duplicates:ids.length-set.size,mapCreates:q.sdkMapCreates,visibility:document.visibilityState,overflow:Math.max(0,document.documentElement.scrollWidth-innerWidth),frames,longTaskCount:tasks.length,longTaskMs:tasks.reduce((s,x)=>s+x.duration,0)};
   },{rows:probe==="full"?catalog(plan.count):null,retainAll:true,start,returnedAt});
   row.cycles.push({cycle,heap,metrics,state});
   if(cycle%10===9)console.log(JSON.stringify({run,probe,cycle:cycle+1,heapMB:heap.usedSize/1e6,markers:state.markers,missing:state.missing}));
  }
  await t.page.evaluate(()=>{window.__passiveWarmFrames.on=false;});
  row.resourceAfter=resourceSnapshot();row.errors=t.errors;row.requests={...t.requests};row.endpointProcessScope=await processScope();row.naturalIdle=[];let last=0;for(const seconds of plan.idleSampleSeconds){await t.page.waitForTimeout((seconds-last)*1000);last=seconds;const heap=await t.cdp.send('Runtime.getHeapUsage'),metrics=(await t.cdp.send('Performance.getMetrics')).metrics.filter(x=>['Nodes','Documents','JSEventListeners','JSHeapUsedSize'].includes(x.name));row.naturalIdle.push({seconds,heap,metrics,processScope:await processScope(),document:await t.page.evaluate(()=>({visible:document.visibilityState==='visible',markerDOM:document.querySelectorAll('[data-testid=\"marker\"]').length,mapCreates:window.__actualSdkProbe.sdkMapCreates}))});}
  await t.cdp.send('HeapProfiler.collectGarbage');await t.cdp.send('HeapProfiler.collectGarbage');row.diagnosticAfterGC=await t.cdp.send('Runtime.getHeapUsage');
  row.passed=row.cycles.length===plan.cyclesPerFreshProcess&&row.cycles.every(c=>c.state.missing===0&&c.state.missingViewport===0&&c.state.markers===c.state.expected&&c.state.duplicates===0&&c.state.mapCreates===1&&c.state.visibility==='visible'&&c.state.overflow===0);
 }catch{row.failure='bounded_warm_browser_invariant_unavailable';}
 finally {if(t)await t.close();if(browser)await browser.close();await server.close();}
 result.runs.push(row);await writeFile(new URL(`run-${run}.json`,out),JSON.stringify(row,null,2)+'\n',{flag:'wx'});
}
result.endedAt=new Date().toISOString();result.passed=result.runs.every(r=>r.passed);
await writeFile(new URL('raw.json',out),JSON.stringify(result,null,2)+'\n',{flag:'wx'});
if(!result.passed)process.exitCode=1;
