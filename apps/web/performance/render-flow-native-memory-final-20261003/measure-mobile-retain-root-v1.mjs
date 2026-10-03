import assert from 'node:assert/strict';
import {chromium} from '@playwright/test';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {serve,pageSetup,origin} from './real-sdk-runtime-retain-v2.mjs';
import {catalog} from './catalog.mjs';
import {resourceSnapshot} from '../render-flow-20260930/resources.mjs';

const label=process.argv[2],mode=process.argv[3];
assert.match(label,/^[a-z0-9-]+$/);assert.ok(['aa','ab'].includes(mode));
const here=new URL('./',import.meta.url),out=new URL(`mobile-retain-ui-${label}-${mode}/`,here);
await mkdir(out);
const planBytes=await readFile(new URL('mobile-retain-root-plan-v1.json',here));
const plan=JSON.parse(planBytes),planSha256=createHash('sha256').update(planBytes).digest('hex');
process.env.SDK_BASELINE_BUILD_LABEL=plan.baselineBuild;
process.env.SDK_CANDIDATE_BUILD_LABEL=plan.candidateBuild;
const result={mode,planSha256,startedAt:new Date().toISOString(),raw:[],fieldAdmitted:0,canonicalTimingAdmitted:0};
for(const count of mode==='aa'?plan.aaCounts:plan.abCounts){
 for(let pair=-plan.warmupPairs;pair<plan.processPairs;pair++)for(const position of [0,1]){
  const kind=mode==='aa'?'baseline':(pair%2===0?['baseline','candidate']:['candidate','baseline'])[position];
  const server=await serve(kind),browser=await chromium.launch({channel:'chrome',headless:true});let t;
  const row={count,pair,position,kind,warmup:pair<0,buildId:server.receipt.buildId,inputs:server.receipt.inputs,valid:false};
  try{
   t=await pageSetup(browser,{mobile:true,count,cpu:plan.cpuRate,captureFrames:false});
   await t.page.goto(origin+'/?__qa=bounded-retention-lab',{waitUntil:'domcontentloaded',timeout:30000});
   const cluster=t.page.locator('.cluster-marker-container').filter({hasText:count>=1000?'999+':String(count)});
   await cluster.waitFor({state:'visible',timeout:45000});await t.page.waitForTimeout(1000);
   row.sdk=await t.page.evaluate(()=>({browser:navigator.userAgent,loaded:!!window.naver?.maps?.Map,stub:!!document.querySelector('script[data-local-naver-maps="true"]'),remoteScript:!!document.querySelector('script[src*="oapi.map.naver.com/openapi/v3/maps.js"]'),mapCaptured:!!window.__actualSdkProbe.mapRef?.deref(),viewport:{width:innerWidth,height:innerHeight,dpr:devicePixelRatio},tiles:performance.getEntriesByType('resource').filter(r=>/map\.naver|pstatic/.test(r.name)).length}));
   assert.ok(row.sdk.loaded&&row.sdk.remoteScript&&row.sdk.mapCaptured&&!row.sdk.stub);
   row.resourceBefore=resourceSnapshot();
   await cluster.click();await t.page.waitForFunction(()=>window.__actualSdkProbe.first>0,null,{timeout:30000});
   await t.page.waitForTimeout(plan.heapEndpointAfterVisibleMs);
   row.heap=await t.cdp.send('Runtime.getHeapUsage');
   row.state=await t.page.evaluate(rows=>{
    const q=window.__actualSdkProbe,m=q.mapRef.deref(),b=m.getBounds(),sw=b.getSW(),ne=b.getNE(),dy=(ne.lat()-sw.lat())*.25,dx=(ne.lng()-sw.lng())*.25;
    const expected=rows.filter(r=>r.lat>=sw.lat()-dy&&r.lat<=ne.lat()+dy&&r.lng>=sw.lng()-dx&&r.lng<=ne.lng()+dx).map(r=>r.id);
    const ids=Array.from(document.querySelectorAll('[data-testid="marker"][data-restaurant-id]'),e=>e.dataset.restaurantId),set=new Set(ids),validIds=new Set(rows.map(r=>r.id));
    const tasks=q.longTasks.filter(x=>x.start+x.duration>=q.click);
    return {clickMs:q.first-q.click,click:q.click,observedAt:performance.now(),expectedViewport:expected.length,markers:ids.length,missingViewport:expected.filter(id=>!set.has(id)).length,unexpectedIds:ids.filter(id=>!validIds.has(id)).length,duplicates:ids.length-set.size,mapCreates:q.sdkMapCreates,zoom:m.getZoom(),visibility:document.visibilityState,overflow:Math.max(0,document.documentElement.scrollWidth-innerWidth),longTaskCount:tasks.length,longTaskMs:tasks.reduce((s,x)=>s+x.duration,0),shifts:q.shifts,domNodes:document.querySelectorAll('*').length};
   },catalog(count));
   row.resourceAfter=resourceSnapshot();row.errors=t.errors;row.requests=t.requests;
   row.valid=row.state.clickMs>0&&row.state.zoom===14&&row.state.markers>0&&row.state.missingViewport===0&&row.state.unexpectedIds===0&&row.state.duplicates===0&&row.state.mapCreates===1&&row.state.visibility==='visible'&&row.state.overflow===0;
   if(kind==='baseline'||count>plan.retentionMax)row.valid&&=row.state.markers===row.state.expectedViewport;
   else row.valid&&=row.state.markers<=count;
   if(pair===0)await t.page.screenshot({path:new URL(`${count}-${kind}-${position}.png`,out).pathname});
  }catch {row.failure='bounded_browser_invariant_unavailable';}
  finally {if(t)await t.close();await browser.close();await server.close();}
  result.raw.push(row);
  await writeFile(new URL(`${count}-pair-${pair+plan.warmupPairs}-${position}-${kind}.json`,out),JSON.stringify(row,null,2)+'\n',{flag:'wx'});
  console.log(JSON.stringify({mode,count,pair,position,kind,valid:row.valid,clickMs:row.state?.clickMs,heap:row.heap?.usedSize,markers:row.state?.markers,expectedViewport:row.state?.expectedViewport}));
 }
}
result.endedAt=new Date().toISOString();result.passed=result.raw.every(r=>r.valid);
await writeFile(new URL('raw.json',out),JSON.stringify(result,null,2)+'\n',{flag:'wx'});
if(!result.passed)process.exitCode=1;
