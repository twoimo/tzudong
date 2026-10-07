import assert from 'node:assert/strict';
import {chromium} from '@playwright/test';
import {mkdir,writeFile} from 'node:fs/promises';
import {serve,pageSetup,origin} from './token-runtime-v3.mjs';
import {catalog} from '../repository-quality-20261004/catalog.mjs';
const here=new URL('./',import.meta.url),out=new URL('review-history-refresh-browser-v1/',here);await mkdir(out);
const result={fieldAdmitted:0,physicalDevice:false,runs:[]};
for(const kind of ['baseline','candidate']){
 const server=await serve(kind),row={kind,source:server.receipt.sourceCommit,passed:false};let browser,t,stage='setup';
 try{
  browser=await chromium.launch({channel:'chrome',headless:true});row.browser=await browser.version();t=await pageSetup(browser,{mobile:true,count:3,cpu:4,captureFrames:false});
  const places=catalog(3);let edited=false,requests=0;
  await t.page.route('**/rest/v1/restaurants*',async route=>{
   requests++;const u=new URL(route.request().url());let data=places.flatMap((r,i)=>Array.from({length:i+1},(_,j)=>({...r,id:j===0?r.id:`10000000-0000-4000-8000-${String(i*10+j).padStart(12,'0')}`,youtube_link:null,tzuyang_review:`synthetic-review-${i}-${edited&&i===1?0:j}`})));
   for(const dim of ['lat','lng'])for(const f of u.searchParams.getAll(dim)){const op=f.split('.')[0],v=Number(f.slice(op.length+1));data=data.filter(x=>op==='gte'?x[dim]>=v:op==='lte'?x[dim]<=v:true);}
   const category=u.searchParams.get('categories');if(category)data=data.filter(x=>category.includes(x.categories[0]));
   const ids=u.searchParams.get('id');if(ids)data=data.filter(x=>ids.includes(x.id));
   const n=Number(u.searchParams.get('limit')||data.length),offset=Number(u.searchParams.get('offset')||0);data=data.slice(offset,offset+n);
   await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(data),headers:{'access-control-allow-origin':origin,'access-control-allow-headers':'*'}});
  });
  const p=t.page;stage='initial-map';await p.goto(origin+'/?__qa=review-history-refresh',{waitUntil:'domcontentloaded'});const cluster=p.locator('.cluster-marker-container').filter({hasText:'3'});await cluster.waitFor({state:'visible',timeout:45000});await p.waitForTimeout(1000);await cluster.click();await p.waitForFunction(()=>window.__actualSdkProbe.first>0);await p.waitForTimeout(1000);
  const marker=p.locator('[data-testid="marker"][data-restaurant-id="'+places[1].id+'"]').first();row.initialBadge=await marker.locator('.tzuyang-visit-count-badge').textContent();assert.equal(row.initialBadge.trim(),'2');
  edited=true;stage='category-refetch';await p.getByRole('button',{name:'카테고리 필터 열기',exact:true}).click();await p.getByRole('button',{name:/한식/}).first().click();await p.waitForFunction(()=>document.querySelectorAll('[data-testid="marker"]').length===1,null,{timeout:10000});await p.waitForTimeout(1000);
  row.updatedBadge=await marker.evaluate(e=>e.querySelector('.tzuyang-visit-count-badge')?.textContent?.trim()??null);row.expectedUpdatedBadge=null;row.syntheticRestaurantRequests=requests;row.actualSDK=await p.evaluate(()=>({loaded:!!window.naver?.maps?.Map,remote:!!document.querySelector('script[src*="oapi.map.naver.com/openapi/v3/maps.js"]'),mapCreates:window.__actualSdkProbe.sdkMapCreates}));row.errors=t.errors;row.passed=row.updatedBadge===null&&requests>=2&&row.actualSDK.loaded&&row.actualSDK.remote&&row.actualSDK.mapCreates===1;
 }catch{row.failure='bounded_review_history_refresh_unavailable';row.stage=stage;}
 finally{if(t)await t.close();if(browser)await browser.close();await server.close();result.runs.push(row);}
}
result.candidatePassed=result.runs.find(x=>x.kind==='candidate')?.passed===true;result.baselineStaleBadgeObserved=result.runs.find(x=>x.kind==='baseline')?.updatedBadge==='2';await writeFile(new URL('raw.json',out),JSON.stringify(result,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(result));if(!result.candidatePassed)process.exitCode=1;
