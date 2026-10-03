import assert from 'node:assert/strict';
import {chromium} from '@playwright/test';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {serve,pageSetup,origin} from './real-sdk-runtime-retain-v2.mjs';
import {catalog} from './catalog.mjs';
const here=new URL('./',import.meta.url),kind=process.argv[2],label=process.argv[3];
assert.ok(['baseline','candidate'].includes(kind));assert.match(label,/^[a-z0-9-]+$/);
const planBytes=await readFile(new URL('retention-diagnostic-plan-v1.json',here)),plan=JSON.parse(planBytes);
process.env.SDK_BASELINE_BUILD_LABEL=plan.baselineBuild;process.env.SDK_CANDIDATE_BUILD_LABEL=plan.candidateBuild;
const out=new URL(`retained-heap-${kind}-${label}/`,here);await mkdir(out);
const server=await serve(kind);let browser,t;
const result={kind,planSha256:createHash('sha256').update(planBytes).digest('hex'),startedAt:new Date().toISOString(),buildId:server.receipt.buildId,inputs:server.receipt.inputs,checkpoints:[],cycles:[],diagnosticOnly:true,forcedGC:true,primaryBudgetWaived:false,fieldAdmitted:0,canonicalTimingAdmitted:0,passed:false};
async function checkpoint(cycle){
 const natural=await t.cdp.send('Runtime.getHeapUsage');
 await t.cdp.send('HeapProfiler.collectGarbage');
 // Observe WeakRefs in a later protocol task, outside the collector's job.
 const gc=await t.cdp.send('Runtime.getHeapUsage');
 const ownership=await t.page.evaluate(()=>{
  const d=window.__markerOwnershipDiagnostic,m=window.__actualSdkProbe.mapRef.deref();let live=0,attached=0,detached=0,detachedWithAppClick=0,otherMap=0;
  for(const weak of d.refs){const marker=weak.deref();if(!marker)continue;live++;const owner=marker.getMap?.();if(owner===m)attached++;else if(!owner){detached++;if(marker.__onClick)detachedWithAppClick++;}else otherMap++;}
  return {created:d.refs.length,live,attached,detached,detachedWithAppClick,otherMap,setters:{...d.setters},mapCreates:window.__actualSdkProbe.sdkMapCreates};
 });
 const metrics=(await t.cdp.send('Performance.getMetrics')).metrics.filter(x=>['Nodes','Documents','JSEventListeners','JSHeapUsedSize','JSHeapTotalSize'].includes(x.name));
 let chunks=[];const onChunk=e=>chunks.push(e.chunk);t.cdp.on('HeapProfiler.addHeapSnapshotChunk',onChunk);
 try{
  await t.cdp.send('HeapProfiler.takeHeapSnapshot',{reportProgress:false});
  const snapshot=JSON.parse(chunks.join(''));chunks=[];
  const fields=snapshot.snapshot.meta.node_fields,types=snapshot.snapshot.meta.node_types[fields.indexOf('type')],stride=fields.length,typeAt=fields.indexOf('type'),sizeAt=fields.indexOf('self_size'),nameAt=fields.indexOf('name');
  const totals={};const dom={};let detachedDom=0;
  for(let at=0;at<snapshot.nodes.length;at+=stride){
   const type=types[snapshot.nodes[at+typeAt]],size=snapshot.nodes[at+sizeAt];
   const bucket=totals[type]??=( {count:0,selfBytes:0} );bucket.count++;bucket.selfBytes+=size;
   if(type!=='native')continue;
   // Only fixed DOM type labels are retained. Snapshot strings, script source,
   // arbitrary names/values and provider contents remain in RAM and are dropped.
   const name=snapshot.strings[snapshot.nodes[at+nameAt]];
   const match=/^(Detached )?(HTMLDivElement|HTMLImageElement|HTMLSpanElement|HTMLDocument|SVGSVGElement|Text|Document)$/.exec(name);
   if(match){const key=(match[1]?'Detached ':'')+match[2];const item=dom[key]??={count:0,selfBytes:0};item.count++;item.selfBytes+=size;if(match[1])detachedDom++;}
  }
  result.checkpoints.push({cycle,natural,gc,ownership,metrics,heapTypeTotals:totals,domTypeTotals:dom,detachedDomNamedNodes:detachedDom,snapshotStringsOrGraphNotRetained:true});
 }finally{chunks=[];t.cdp.off('HeapProfiler.addHeapSnapshotChunk',onChunk);}
 console.log(JSON.stringify({kind,cycle,naturalMB:natural.usedSize/1e6,gcMB:gc.usedSize/1e6,ownership}));
}
function safeProfile(profile){
 const allowed=new Set(['(root)','(program)','(idle)','(garbage collector)','(anonymous)']);
 return {startTime:profile.startTime,endTime:profile.endTime,samples:profile.samples,timeDeltas:profile.timeDeltas,nodes:profile.nodes.map(n=>({id:n.id,hitCount:n.hitCount,children:n.children,callFrame:{functionName:allowed.has(n.callFrame.functionName)||/^[a-zA-Z_$][a-zA-Z0-9_$]{0,63}$/.test(n.callFrame.functionName)?n.callFrame.functionName:'redacted_function',source:/oapi\.map\.naver\.com/.test(n.callFrame.url)?'naver_sdk':/localhost/.test(n.callFrame.url)?'compiled_owned_app':n.callFrame.url?'other_runtime':'runtime',scriptId:n.callFrame.scriptId,lineNumber:n.callFrame.lineNumber,columnNumber:n.callFrame.columnNumber}}))};
}
try{
 browser=await chromium.launch({channel:'chrome',headless:true});result.browser=await browser.version();
 t=await pageSetup(browser,{mobile:true,count:plan.count,cpu:plan.cpuRate,captureFrames:false});
 await t.page.addInitScript(()=>{
  window.__markerOwnershipDiagnostic={refs:[],setters:{setMap:0,setIcon:0,setPosition:0}};
  document.addEventListener('load',e=>{
   if(e.target?.tagName!=='SCRIPT'||!e.target.src.includes('oapi.map.naver.com/openapi/v3/maps.js'))return;
   const maps=window.naver?.maps;if(!maps?.Marker)return;const original=maps.Marker;
   for(const key of ['setMap','setIcon','setPosition']){const method=original.prototype[key];if(typeof method!=='function')continue;original.prototype[key]=function(...args){window.__markerOwnershipDiagnostic.setters[key]++;return method.apply(this,args);};}
   maps.Marker=new Proxy(original,{construct(fn,args,target){const marker=Reflect.construct(fn,args,target);window.__markerOwnershipDiagnostic.refs.push(new WeakRef(marker));return marker;}});
  },true);
 });
 await t.page.goto(origin+'/?__qa=retention-diagnostic',{waitUntil:'domcontentloaded',timeout:30000});
 const cluster=t.page.locator('.cluster-marker-container').filter({hasText:String(plan.count)});await cluster.waitFor({state:'visible',timeout:45000});await t.page.waitForTimeout(1000);
 await cluster.click();await t.page.waitForFunction(()=>window.__actualSdkProbe.first>0);await t.page.waitForTimeout(1000);
 const center=await t.page.evaluate(()=>{const m=window.__actualSdkProbe.mapRef.deref(),c=m.getCenter();return {lat:c.lat(),lng:c.lng(),zoom:m.getZoom()};});
 await t.cdp.send('Performance.enable');await t.cdp.send('Profiler.enable');await t.cdp.send('HeapProfiler.enable');
 await checkpoint(0);
 for(let cycle=1;cycle<=plan.cycles;cycle++){
  if(cycle===plan.profileCycles[0])await t.cdp.send('Profiler.start');
  await t.page.evaluate(()=>window.__actualSdkProbe.mapRef.deref().setCenter(new window.naver.maps.LatLng(35,129)));await t.page.waitForTimeout(plan.awayMs);
  await t.page.evaluate(c=>{const m=window.__actualSdkProbe.mapRef.deref();m.setCenter(new window.naver.maps.LatLng(c.lat,c.lng));m.setZoom(c.zoom);},center);await t.page.waitForTimeout(plan.returnSettleMs);
  const heap=await t.cdp.send('Runtime.getHeapUsage');
  const state=await t.page.evaluate(({rows,retainAll})=>{const q=window.__actualSdkProbe,m=q.mapRef.deref(),b=m.getBounds(),sw=b.getSW(),ne=b.getNE(),dy=(ne.lat()-sw.lat())*.25,dx=(ne.lng()-sw.lng())*.25,expected=(retainAll?rows:rows.filter(r=>r.lat>=sw.lat()-dy&&r.lat<=ne.lat()+dy&&r.lng>=sw.lng()-dx&&r.lng<=ne.lng()+dx)).map(r=>r.id),ids=Array.from(document.querySelectorAll('[data-testid="marker"][data-restaurant-id]'),e=>e.dataset.restaurantId),set=new Set(ids);return {expected:expected.length,markers:ids.length,missing:expected.filter(id=>!set.has(id)).length,duplicates:ids.length-set.size,mapCreates:q.sdkMapCreates,visibility:document.visibilityState};},{rows:catalog(plan.count),retainAll:kind==='candidate'});
  result.cycles.push({cycle,heap,state});
  if(cycle===plan.profileCycles[1]){const {profile}=await t.cdp.send('Profiler.stop');await writeFile(new URL('sanitized-cpu-profile.json',out),JSON.stringify(safeProfile(profile))+'\n',{flag:'wx'});}
  if(plan.gcCheckpoints.includes(cycle))await checkpoint(cycle);
 }
 result.errors=t.errors;result.requests=t.requests;
 result.passed=result.cycles.length===plan.cycles&&result.cycles.every(c=>c.state.missing===0&&c.state.expected===c.state.markers&&c.state.duplicates===0&&c.state.mapCreates===1&&c.state.visibility==='visible');
}catch{result.failure='bounded_retainer_diagnostic_unavailable';}
finally{if(t)await t.close();if(browser)await browser.close();await server.close();result.endedAt=new Date().toISOString();await writeFile(new URL('raw.json',out),JSON.stringify(result,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({kind,passed:result.passed,checkpoints:result.checkpoints.length,cycles:result.cycles.length}));}
if(!result.passed)process.exitCode=1;
