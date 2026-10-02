import {chromium} from '@playwright/test';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {serve,pageSetup,ready} from './real-sdk-runtime.mjs';
import {catalog} from './catalog.mjs';
const label=process.env.MEMORY_REPEAT_LABEL||'v1';if(!/^[a-z0-9-]+$/.test(label))throw Error('new label required');
const out=new URL(`memory-repeat-${label}/`,import.meta.url);await mkdir(out);
const planBytes=await readFile(new URL(process.env.MEMORY_REPEAT_PLAN||'memory-repeat-plan-v1.json',import.meta.url)),plan=JSON.parse(planBytes),rows=catalog(735);
const result={planSha256:createHash('sha256').update(planBytes).digest('hex'),startedAt:new Date().toISOString(),runs:[],originalSingleEndpointBudgetWaived:false,fieldAdmitted:0,canonicalTimingAdmitted:0};
for(let run=0;run<plan.order.length;run++){
 const kind=plan.order[run],buildRole=plan.buildRoles?.[kind]||kind;if(plan.buildLabels?.[kind])process.env[`SDK_${buildRole.toUpperCase()}_BUILD_LABEL`]=plan.buildLabels[kind];
 const server=await serve(buildRole),browser=await chromium.launch({headless:true}),row={run,kind,buildRole,buildId:server.receipt.buildId,inputs:server.receipt.inputs,cycles:[],passed:false};let t;
 try{
  t=await pageSetup(browser,{count:735,cpu:4});const page=t.page;row.sdk=await ready(t);
  await t.cdp.send('Performance.enable');
  await page.locator('.cluster-marker-container').filter({hasText:'735'}).click();await page.waitForFunction(()=>window.__actualSdkProbe.first>0);await page.waitForTimeout(600);
  const center=await page.evaluate(()=>{const m=window.__actualSdkProbe.mapRef.deref(),c=m.getCenter();return {lat:c.lat(),lng:c.lng(),zoom:m.getZoom()};});
  row.initialHeap=await t.cdp.send('Runtime.getHeapUsage');
  for(let cycle=0;cycle<plan.cyclesPerFreshBrowserProcess;cycle++){
   await page.evaluate(()=>window.__actualSdkProbe.mapRef.deref().setCenter(new window.naver.maps.LatLng(35,129)));await page.waitForTimeout(plan.awayMs);
   await page.evaluate(c=>{const m=window.__actualSdkProbe.mapRef.deref();m.setCenter(new window.naver.maps.LatLng(c.lat,c.lng));m.setZoom(c.zoom);},center);
   await page.waitForFunction(()=>document.querySelectorAll('[data-testid="marker"]').length>0,null,{timeout:12000});await page.waitForTimeout(plan.returnSettleMs);
   const heap=await t.cdp.send('Runtime.getHeapUsage'),metrics=(await t.cdp.send('Performance.getMetrics')).metrics.filter(x=>['Nodes','Documents','JSEventListeners','JSHeapUsedSize','JSHeapTotalSize'].includes(x.name));
   const state=await page.evaluate(({rows,retainAll})=>{const q=window.__actualSdkProbe,m=q.mapRef.deref(),b=m.getBounds(),sw=b.getSW(),ne=b.getNE(),dy=(ne.lat()-sw.lat())*.25,dx=(ne.lng()-sw.lng())*.25,expected=(retainAll?rows:rows.filter(r=>r.lat>=sw.lat()-dy&&r.lat<=ne.lat()+dy&&r.lng>=sw.lng()-dx&&r.lng<=ne.lng()+dx)).map(r=>r.id),ids=Array.from(document.querySelectorAll('[data-testid="marker"][data-restaurant-id]'),e=>e.dataset.restaurantId),set=new Set(ids);return {t:performance.now(),missing:expected.filter(id=>!set.has(id)).length,expected:expected.length,markers:ids.length,duplicates:ids.length-set.size,mapCreates:q.sdkMapCreates,overflow:Math.max(0,document.documentElement.scrollWidth-innerWidth)};},{rows,retainAll:kind==='candidate'&&!!plan.candidateRetainsSmallDesktop});
   row.cycles.push({cycle,heap,metrics,state});
   if(cycle%10===9)console.log(JSON.stringify({run,kind,cycle:cycle+1,heapBytes:heap.usedSize,missing:state.missing}));
  }
  row.errors=t.errors;row.passed=row.cycles.length===plan.cyclesPerFreshBrowserProcess&&row.cycles.every(c=>c.state.missing===0&&c.state.expected===c.state.markers&&c.state.duplicates===0&&c.state.mapCreates===1&&c.state.overflow===0);
 }catch{row.failure='repeat diagnostic setup or invariant failed';}
 finally{if(t)await t.close();await browser.close();await server.close();}
 await writeFile(new URL(`run-${run}.json`,out),JSON.stringify(row,null,2)+'\n',{flag:'wx'});result.runs.push(row);
}
result.endedAt=new Date().toISOString();result.passed=result.runs.every(r=>r.passed);await writeFile(new URL('raw.json',out),JSON.stringify(result,null,2)+'\n',{flag:'wx'});if(!result.passed)process.exitCode=1;
