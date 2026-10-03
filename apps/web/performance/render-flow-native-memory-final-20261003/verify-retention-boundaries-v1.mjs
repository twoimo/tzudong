import {chromium} from '@playwright/test';
import {mkdir,writeFile} from 'node:fs/promises';
import {serve,pageSetup,origin} from './real-sdk-runtime-retain-v2.mjs';
import {catalog} from './catalog.mjs';
const here=new URL('./',import.meta.url),out=new URL('retention-boundaries-v1/',here);await mkdir(out);
process.env.SDK_CANDIDATE_BUILD_LABEL='ret-ax-v2';const result={scope:'actual SDK mobile emulation; synthetic count0/1000/1001; no performance or physical claim',fieldAdmitted:0,checks:[]};
for(const count of [0,1000,1001]){
 const server=await serve('candidate');let browser,t;const row={count,buildId:server.receipt.buildId,passed:false};
 try{
  browser=await chromium.launch({channel:'chrome',headless:true});t=await pageSetup(browser,{mobile:true,count,cpu:4,captureFrames:false});
  await t.page.goto(origin+'/?__qa=retention-boundary',{waitUntil:'domcontentloaded'});
  await t.page.waitForFunction(()=>!!window.__actualSdkProbe.mapRef?.deref(),null,{timeout:45000});
  if(count){const cluster=t.page.locator('.cluster-marker-container').filter({hasText:'999+'});await cluster.waitFor({state:'visible',timeout:45000});await t.page.waitForTimeout(1000);await cluster.click();await t.page.waitForFunction(()=>window.__actualSdkProbe.first>0);}
  await t.page.waitForTimeout(1500);
  row.state=await t.page.evaluate(({rows,count})=>{const q=window.__actualSdkProbe,m=q.mapRef.deref(),b=m.getBounds(),sw=b.getSW(),ne=b.getNE(),dy=(ne.lat()-sw.lat())*.25,dx=(ne.lng()-sw.lng())*.25,padded=new Set(rows.filter(r=>r.lat>=sw.lat()-dy&&r.lat<=ne.lat()+dy&&r.lng>=sw.lng()-dx&&r.lng<=ne.lng()+dx).map(r=>r.id)),els=Array.from(document.querySelectorAll('[data-testid="marker"][data-restaurant-id]')),ids=els.map(e=>e.dataset.restaurantId),set=new Set(ids);return {markers:ids.length,paddedExpected:padded.size,duplicates:ids.length-set.size,missingPadded:[...padded].filter(id=>!set.has(id)).length,unmaskedBeyondPadded:els.filter(e=>!padded.has(e.dataset.restaurantId)&&e.getAttribute('aria-hidden')!=='true').length,mapCreates:q.sdkMapCreates,clusterNodes:document.querySelectorAll('.cluster-marker-container').length,overflow:Math.max(0,document.documentElement.scrollWidth-innerWidth)};},{rows:catalog(count),count});
  const s=row.state;row.passed=s.duplicates===0&&s.missingPadded===0&&s.unmaskedBeyondPadded===0&&s.mapCreates===1&&s.overflow===0&&(count===0?s.markers===0&&s.clusterNodes===0:count===1000?s.markers===1000:s.markers===s.paddedExpected);
  row.errors=t.errors;
 }catch{row.failure='bounded_retention_boundary_unavailable';}
 finally {if(t)await t.close();if(browser)await browser.close();await server.close();result.checks.push(row);console.log(JSON.stringify(row));}
}
result.passed=result.checks.every(r=>r.passed);await writeFile(new URL('raw.json',out),JSON.stringify(result,null,2)+'\n',{flag:'wx'});if(!result.passed)process.exitCode=1;
