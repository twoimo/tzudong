import {chromium} from '@playwright/test';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {serve,physicalBrowser,pageSetup,ready,usbSerial} from './real-sdk-runtime.mjs';
import {catalog} from './catalog.mjs';
import {resourceSnapshot} from './dependencies/render-flow-resources.mjs';
const mode=process.argv[2]||'desktop',physical=mode==='physical'||mode==='samsung',aa=process.argv.includes('--aa');
const here=new URL('./',import.meta.url),out=new URL(`${mode}-${aa?'aa':'ab'}-${process.env.MEASURE_LABEL||'v2'}/`,here);
await mkdir(out);const plan=await readFile(new URL(process.env.MEASURE_PLAN||'real-sdk-plan-memory-v1.json',here)),planSha256=createHash('sha256').update(plan).digest('hex'),planData=JSON.parse(plan);
if(physical)execFileSync('adb',['-s',usbSerial(),'reverse','tcp:3000','tcp:3000'],{stdio:'ignore'});
const buildLabels={baseline:process.env.SDK_BASELINE_BUILD_LABEL,candidate:process.env.SDK_CANDIDATE_BUILD_LABEL};
const raw=[],counts=process.env.MEASURE_COUNTS?process.env.MEASURE_COUNTS.split(',').map(Number):aa?[735]:physical?[735]:[735,2000];
for(const count of counts)for(let pair=-2;pair<9;pair++)for(const position of [0,1]){
 const kind=aa?'baseline':(pair%2===0?['baseline','candidate']:['candidate','baseline'])[position];
 process.env.SDK_CANDIDATE_BUILD_LABEL=buildLabels[kind];const server=await serve('candidate'),browser=physical?await physicalBrowser():await chromium.launch({headless:true});let t;
 try{
  t=await pageSetup(browser,{physical,mobile:true,count,cpu:physical?1:4});const sdk=await ready(t);
  const initialHeap=await t.cdp.send('Runtime.getHeapUsage'),resourceBefore=resourceSnapshot();
  await t.page.locator('.cluster-marker-container').filter({hasText:count>=1000?'999+':String(count)}).click();
  await t.page.waitForFunction(()=>window.__actualSdkProbe.first>0,null,{timeout:30000});
  await t.page.waitForTimeout(600);
  const heap=await t.cdp.send('Runtime.getHeapUsage');
  const state=await t.page.evaluate(rows=>{
   const p=window.__actualSdkProbe,m=p.mapRef.deref(),b=m.getBounds(),sw=b.getSW(),ne=b.getNE(),dy=(ne.lat()-sw.lat())*.25,dx=(ne.lng()-sw.lng())*.25;
   const expected=rows.filter(r=>r.lat>=sw.lat()-dy&&r.lat<=ne.lat()+dy&&r.lng>=sw.lng()-dx&&r.lng<=ne.lng()+dx).map(r=>r.id);
   const ids=Array.from(document.querySelectorAll('[data-testid="marker"][data-restaurant-id]')).map(e=>e.getAttribute('data-restaurant-id'));
   const frames=p.frames.filter(f=>f.t>=p.click),tasks=p.longTasks.filter(x=>x.start+x.duration>=p.click);
   return {clickMs:p.first-p.click,now:performance.now(),click:p.click,zoom:m.getZoom(),center:{lat:m.getCenter().lat(),lng:m.getCenter().lng()},bounds:{south:sw.lat(),west:sw.lng(),north:ne.lat(),east:ne.lng()},markerCount:ids.length,expectedIds:expected,actualIds:ids,missingIds:expected.filter(id=>!ids.includes(id)),unexpectedIds:ids.filter(id=>!rows.some(r=>r.id===id)),frames,maxFrameGapMs:Math.max(...frames.map(f=>f.gap)),longTaskCount:tasks.length,longTaskMs:tasks.reduce((s,x)=>s+x.duration,0),shifts:p.shifts,reportedHeap:performance.memory?.usedJSHeapSize,dom:document.querySelectorAll('*').length,sdkMapCreates:p.sdkMapCreates,visibility:document.visibilityState,overflow:Math.max(0,document.documentElement.scrollWidth-innerWidth)};
  },catalog(count));
  state.paddedViewportIds=state.expectedIds;
  const retainsAll=kind==='baseline'?!planData.baselineCullsExpanded:(!physical&&count<=1000&&planData.candidateRetainsSmallDesktop);
  state.membershipMode=retainsAll?'full-expanded':'padded-viewport';
  state.expectedIds=retainsAll?catalog(count).map(r=>r.id):state.paddedViewportIds;
  state.missingIds=state.expectedIds.filter(id=>!state.actualIds.includes(id));
  const valid=state.clickMs>0&&state.zoom===14&&state.markerCount>0&&state.missingIds.length===0&&state.unexpectedIds.length===0&&new Set(state.actualIds).size===state.actualIds.length&&state.sdkMapCreates===1&&state.visibility==='visible'&&state.markerCount===state.expectedIds.length;
  if(pair===0)await t.page.screenshot({path:new URL(`${count}-${kind}-${position}.png`,out).pathname});
  // Explicit GC comes after every natural metric and is reported separately.
  await t.cdp.send('HeapProfiler.collectGarbage');const gc=await t.cdp.send('Runtime.getHeapUsage');
  const resourceAfter=resourceSnapshot();
  const row={resourceBefore,resourceAfter,count,pair,position,kind,warmup:pair<0,planSha256,buildId:server.receipt.buildId,inputs:server.receipt.inputs,sdk,valid,errors:t.errors,requests:t.requests,state,initialHeap,heap,gc};raw.push(row);
  await writeFile(new URL(`${count}-pair-${pair+2}-${position}-${kind}.json`,out),JSON.stringify(row,null,2)+'\n',{flag:'wx'});
  console.log(JSON.stringify({mode,count,pair,position,kind,valid,clickMs:state.clickMs,markers:state.markerCount,expected:state.expectedIds.length,heap:heap.usedSize,gc:gc.usedSize,errors:t.errors}));
 }finally{if(t)await t.close();await browser.close();await server.close();}
}
await writeFile(new URL('raw.json',out),JSON.stringify({mode,aa,planSha256,independentDriverExecutions:1,pagePairsPerCell:9,warmupPairsPerCell:2,raw},null,2)+'\n',{flag:'wx'});
if(!raw.every(r=>r.valid))process.exitCode=1;
