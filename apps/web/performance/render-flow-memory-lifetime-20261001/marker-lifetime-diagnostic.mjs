import {chromium} from '@playwright/test';
import {mkdir,writeFile} from 'node:fs/promises';
import {serve,pageSetup,ready} from './real-sdk-runtime.mjs';
const label=process.argv[2],candidate=process.argv[3];if(!/^[a-z0-9-]+$/.test(label??''))throw Error('newlabel required');
const out=new URL(`marker-lifetime-${label}/`,import.meta.url);await mkdir(out);
process.env.SDK_BASELINE_BUILD_LABEL='field-control-v3';process.env.SDK_CANDIDATE_BUILD_LABEL=candidate;
const result={intrusive:true,fieldAdmitted:0,canonicalTimingAdmitted:0,forcedGCWaivesBudget:false,runs:[]};
for(const kind of ['baseline','candidate']){
 const server=await serve(kind),browser=await chromium.launch({headless:true});let t;
 const row={kind,buildId:server.receipt.buildId,samples:[]};
 try{
  t=await pageSetup(browser,{count:735,cpu:4});const p=t.page;
  await p.addInitScript(()=>{window.__ownedMarkerRefs=[];document.addEventListener('load',e=>{
   if(e.target?.tagName!=='SCRIPT'||!e.target.src.includes('oapi.map.naver.com/openapi/v3/maps.js'))return;
   const m=window.naver.maps;m.Marker=new Proxy(m.Marker,{construct(target,args,newTarget){const marker=Reflect.construct(target,args,newTarget);window.__ownedMarkerRefs.push(new WeakRef(marker));return marker;}});
  },true);});
  row.sdk=await ready(t);await p.locator('.cluster-marker-container').filter({hasText:'735'}).click();await p.waitForFunction(()=>window.__actualSdkProbe.first>0);await p.waitForTimeout(600);
  const center=await p.evaluate(()=>{const m=window.__actualSdkProbe.mapRef.deref(),c=m.getCenter();return {lat:c.lat(),lng:c.lng()};});
  for(let i=0;i<6;i++){
   await p.evaluate(()=>window.__actualSdkProbe.mapRef.deref().setCenter(new window.naver.maps.LatLng(35,129)));await p.waitForTimeout(350);
   await p.evaluate(c=>window.__actualSdkProbe.mapRef.deref().setCenter(new window.naver.maps.LatLng(c.lat,c.lng)),center);await p.waitForTimeout(1000);
   row.samples.push({i,naturalHeap:await t.cdp.send('Runtime.getHeapUsage')});
  }
  // Explicit collector is diagnostic ONLY, after all natural observations.
  await t.cdp.send('HeapProfiler.collectGarbage');row.gcDiagnosticHeap=await t.cdp.send('Runtime.getHeapUsage');
  row.liveness=await p.evaluate(()=>{const live=window.__ownedMarkerRefs.map(x=>x.deref()).filter(Boolean);return {created:window.__ownedMarkerRefs.length,liveAfterDiagnosticGC:live.length,active:live.filter(m=>!!m.getMap()).length,detached:live.filter(m=>!m.getMap()).length,detachedWithAppCallbacks:live.filter(m=>!m.getMap()&&!!m.__onClick).length};});
 }finally{if(t)await t.close();await browser.close();await server.close();}
 result.runs.push(row);
}
await writeFile(new URL('raw.json',out),JSON.stringify(result,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(result.runs.map(r=>({kind:r.kind,liveness:r.liveness,gcDiagnosticHeap:r.gcDiagnosticHeap.usedSize,naturalLast:r.samples.at(-1).naturalHeap.usedSize}))));
