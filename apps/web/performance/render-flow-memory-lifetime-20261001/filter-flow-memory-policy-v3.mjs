import {chromium} from '@playwright/test';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resourceSnapshot} from '../render-flow-20260930/resources.mjs';
import {serve,pageSetup,ready} from './real-sdk-runtime.mjs';
const label=process.argv[2];if(!label||!/^[a-z0-9-]+$/.test(label))throw Error('newlabel required');
const aa=process.argv.includes('--aa'),bytes=await readFile(new URL('filter-flow-memory-policy-v3-plan.json',import.meta.url)),plan=JSON.parse(bytes);
const out=new URL('filter-flow-'+label+'/',import.meta.url);await mkdir(out);const result={scope:plan.scope,aa,planSha256:createHash('sha256').update(bytes).digest('hex'),startedAt:new Date().toISOString(),runs:[],fieldAdmitted:0,canonicalTimingAdmitted:0};
for(let pair=0;pair<(aa?plan.aaPairs:plan.abPairs);pair++)for(let position=0;position<2;position++){
 const kind=aa?'baseline':(pair%2===0?['baseline','candidate']:['candidate','baseline'])[position];
 const server=await serve(kind),browser=await chromium.launch({headless:true}),row={pair,position,kind,resourceBefore:resourceSnapshot(),buildId:server.receipt.buildId,inputs:server.receipt.inputs,cycles:[],passed:false};let t;
 try{
  t=await pageSetup(browser,{count:735,cpu:4});const p=t.page;row.sdk=await ready(t);await p.locator('.cluster-marker-container').filter({hasText:'735'}).click();await p.waitForFunction(()=>window.__actualSdkProbe.first>0);await p.waitForTimeout(600);
  row.initial=await p.evaluate(()=>({markers:document.querySelectorAll('[data-testid="marker"]').length,clusters:document.querySelectorAll('.cluster-marker-container').length,zoom:window.__actualSdkProbe.mapRef.deref().getZoom()}));
  await p.evaluate(()=>{window.__filterPilot={armed:false,start:0,end:0,stable:0,trusted:null,target:0};document.addEventListener('click',e=>{const b=e.target.closest('button');if(window.__filterPilot.armed&&b&&/초기화/.test((b.textContent??'')+' '+(b.getAttribute('aria-label')??''))){const q=window.__filterPilot;q.start=performance.now();q.trusted=e.isTrusted;q.end=0;q.stable=0;}},true);const frame=()=>{const q=window.__filterPilot;if(q.start&&!q.end){const nodes=document.querySelectorAll('[data-testid="marker"],.cluster-marker-container');if(nodes.length===q.target&&Array.from(nodes).some(e=>{const b=e.getBoundingClientRect();return b.width>0&&b.height>0&&b.right>0&&b.left<innerWidth&&b.bottom>0&&b.top<innerHeight;})){if(++q.stable>=2)q.end=performance.now();}else q.stable=0;}requestAnimationFrame(frame);};requestAnimationFrame(frame);});
  let target=plan.expectedCounts[kind];const expectedCount=plan.expectedCounts[kind];if(row.initial.markers+row.initial.clusters!==plan.initialExpectedCounts[kind])throw Error('initial expected membership mismatch');const expectedIds=await p.evaluate(rows=>{const b=window.__actualSdkProbe.mapRef.deref().getBounds(),sw=b.getSW(),ne=b.getNE(),dy=(ne.lat()-sw.lat())*.25,dx=(ne.lng()-sw.lng())*.25;return rows.filter(r=>r.lat>=sw.lat()-dy&&r.lat<=ne.lat()+dy&&r.lng>=sw.lng()-dx&&r.lng<=ne.lng()+dx).map(r=>r.id);},Array.from({length:735},(_,i)=>({id:`00000000-0000-4000-8000-${String(i).padStart(12,'0')}`,lat:37.5+(i%40)*.003,lng:126.96+Math.floor(i/40)*.003})));if(expectedIds.length!==expectedCount)throw Error('fixture padded membership mismatch');row.expectedIds=expectedIds;
  for(let cycle=0;cycle<plan.cyclesPerProcess;cycle++){
   await p.getByLabel('카테고리 필터').first().click();await p.getByRole('option',{name:/중식/}).first().click();await p.waitForFunction(()=>document.querySelectorAll('[data-testid="marker"],.cluster-marker-container').length===0,null,{timeout:10000});
   await p.evaluate(target=>{window.__filterPilot={armed:true,start:0,end:0,stable:0,trusted:null,target};},target);
   await p.getByRole('button',{name:/초기화/}).first().click();await p.waitForFunction(()=>document.querySelectorAll('[data-testid="marker"],.cluster-marker-container').length>0,null,{timeout:12000});await p.waitForTimeout(1000);
   const heap=await t.cdp.send('Runtime.getHeapUsage'),observed=await p.evaluate(()=>({probe:window.__filterPilot,markers:document.querySelectorAll('[data-testid="marker"]').length,clusters:document.querySelectorAll('.cluster-marker-container').length,ids:Array.from(document.querySelectorAll('[data-testid="marker"]'),e=>e.getAttribute('data-restaurant-id')),mapCreates:window.__actualSdkProbe.sdkMapCreates,zoom:window.__actualSdkProbe.mapRef.deref().getZoom(),overflow:Math.max(0,document.documentElement.scrollWidth-innerWidth)}));target=observed.markers+observed.clusters;
   row.cycles.push({cycle,warmup:cycle===0,heap,observed,latencyMs:observed.probe.end?observed.probe.end-observed.probe.start:null});await p.keyboard.press('Escape');
  }
  row.passed=row.cycles.every(c=>c.observed.probe.trusted===true&&c.observed.mapCreates===1&&c.observed.overflow===0&&c.latencyMs>0&&c.observed.ids.length===expectedCount&&new Set(c.observed.ids).size===expectedCount&&expectedIds.every(id=>c.observed.ids.includes(id))); row.errors=t.errors;row.resourceAfter=resourceSnapshot();
 }catch{row.failure='pilot native input/readiness or state failed';}
 finally{if(t)await t.close();await browser.close();await server.close();}
 await writeFile(new URL(`pair-${pair}-${position}-${kind}.json`,out),JSON.stringify(row,null,2)+'\n',{flag:'wx'});result.runs.push(row);console.log(JSON.stringify({pair,position,kind,passed:row.passed,initial:row.initial,cycles:row.cycles.map(c=>({latencyMs:c.latencyMs,markers:c.observed.markers,clusters:c.observed.clusters,trusted:c.observed.probe.trusted}))}));
}
result.passed=result.runs.every(r=>r.passed);result.endedAt=new Date().toISOString();await writeFile(new URL('raw.json',out),JSON.stringify(result,null,2)+'\n',{flag:'wx'});if(!result.passed)process.exitCode=1;
