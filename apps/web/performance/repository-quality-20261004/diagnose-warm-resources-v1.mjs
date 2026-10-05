import assert from 'node:assert/strict';
import {chromium} from '@playwright/test';
import {mkdir,writeFile} from 'node:fs/promises';
import {serve,pageSetup,origin} from './real-sdk-resource-diagnostic-v1.mjs';
const here=new URL('./',import.meta.url),out=new URL('integrated-warm-resource-diagnostic-v1/',here);await mkdir(out);
process.env.SDK_CANDIDATE_BUILD_LABEL='integrated-v2';
const result={purpose:'separate live retention from transient allocation; not a primary performance trial or budget waiver',freshProcesses:1,dependentCycles:6,cpuRate:4,viewport:[390,844],fieldAdmitted:0,canonicalTimingAdmitted:0,forcedGC:true,samples:[],passed:false};
const server=await serve('candidate');let browser,t;
async function sample(stage){
 const heap=await t.cdp.send('Runtime.getHeapUsage');
 const metrics=(await t.cdp.send('Performance.getMetrics')).metrics.filter(x=>['Nodes','Documents','JSEventListeners'].includes(x.name));
 const state=await t.page.evaluate(()=>{const q=window.__actualSdkProbe,ids=Array.from(document.querySelectorAll('[data-testid="marker"][data-restaurant-id]'),e=>e.dataset.restaurantId);return {activeDomNodes:document.querySelectorAll('*').length,markers:ids.length,duplicates:ids.length-new Set(ids).size,mapCreates:q.sdkMapCreates,mapAlive:!!q.mapRef?.deref(),visibility:document.visibilityState,longTaskRecords:q.longTasks.length,shiftRecords:q.shifts.length};});
 result.samples.push({stage,heap,metrics,state,requests:{...t.requests}});
 assert.equal(state.markers,735);assert.equal(state.duplicates,0);assert.equal(state.mapCreates,1);assert.ok(state.mapAlive);assert.equal(state.visibility,'visible');
}
try{
 browser=await chromium.launch({channel:'chrome',headless:true});result.browser=await browser.version();t=await pageSetup(browser,{mobile:true,count:735,cpu:4,captureFrames:false});result.buildId=server.receipt.buildId;result.inputs=server.receipt.inputs;
 await t.page.goto(origin+'/?__qa=retention-diagnostic',{waitUntil:'domcontentloaded'});const cluster=t.page.locator('.cluster-marker-container').filter({hasText:'735'});await cluster.waitFor({state:'visible',timeout:45000});await t.page.waitForTimeout(1000);await cluster.click();await t.page.waitForFunction(()=>window.__actualSdkProbe.first>0);await t.page.waitForTimeout(1000);await t.cdp.send('Performance.enable');
 await sample('initial-natural');await t.cdp.send('HeapProfiler.collectGarbage');await t.cdp.send('HeapProfiler.collectGarbage');await sample('initial-after-diagnostic-gc');
 const center=await t.page.evaluate(()=>{const m=window.__actualSdkProbe.mapRef.deref(),c=m.getCenter();return {lat:c.lat(),lng:c.lng(),zoom:m.getZoom()};});
 for(let cycle=0;cycle<6;cycle++){
  await t.page.evaluate(()=>window.__actualSdkProbe.mapRef.deref().setCenter(new window.naver.maps.LatLng(35,129)));await t.page.waitForTimeout(350);
  await t.page.evaluate(c=>{const m=window.__actualSdkProbe.mapRef.deref();m.setCenter(new window.naver.maps.LatLng(c.lat,c.lng));m.setZoom(c.zoom);},center);await t.page.waitForTimeout(1000);
  if(cycle===5){await sample('return-'+(cycle+1));console.log(JSON.stringify({cycle:cycle+1,heapMB:result.samples.at(-1).heap.usedSize/1e6,requests:t.requests.restaurant}));}
 }
 await sample('end-natural');await t.cdp.send('HeapProfiler.collectGarbage');await t.cdp.send('HeapProfiler.collectGarbage');await sample('end-after-diagnostic-gc');result.errors=t.errors;result.passed=true;
}catch{result.failure='bounded_retention_diagnostic_invariant_unavailable';}
finally{if(t)await t.close();if(browser)await browser.close();await server.close();await writeFile(new URL('raw.json',out),JSON.stringify(result,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({passed:result.passed,samples:result.samples.map(x=>({stage:x.stage,heapMB:x.heap.usedSize/1e6,nodes:x.metrics.find(y=>y.name==='Nodes')?.value,activeDom:x.state.activeDomNodes,requests:x.requests.restaurant}))}));}
if(!result.passed)process.exitCode=1;
