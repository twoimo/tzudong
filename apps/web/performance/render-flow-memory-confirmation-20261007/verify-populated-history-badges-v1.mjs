import assert from 'node:assert/strict';
import {chromium} from '@playwright/test';
import {mkdir,writeFile} from 'node:fs/promises';
import {serve,pageSetup,origin} from './token-runtime-v2.mjs';
import {catalog} from '../repository-quality-20261004/catalog.mjs';
const here=new URL('./',import.meta.url),out=new URL('badge-history-browser-v1/',here);await mkdir(out);
const result={fieldAdmitted:0,physicalDevice:false,sourceCommit:null,checks:[],passed:false};
const server=await serve('candidate');let browser,t;
try{
 browser=await chromium.launch({channel:'chrome',headless:true});result.browser=await browser.version();result.sourceCommit=server.receipt.sourceCommit;t=await pageSetup(browser,{mobile:true,count:3,cpu:4,captureFrames:false});
 const rows=catalog(3).map((r,i)=>({...r,mergedYoutubeLinks:Array.from({length:i+1},(_,j)=>`synthetic-video-${j}`)}));
 await t.page.route('**/rest/v1/restaurants*',async route=>{
  const u=new URL(route.request().url());let data=rows;
  for(const dim of ['lat','lng'])for(const f of u.searchParams.getAll(dim)){const op=f.split('.')[0],v=Number(f.slice(op.length+1));data=data.filter(x=>op==='gte'?x[dim]>=v:op==='lte'?x[dim]<=v:true);}
  const ids=u.searchParams.get('id');if(ids)data=data.filter(x=>ids.includes(x.id));
  const n=Number(u.searchParams.get('limit')||data.length),offset=Number(u.searchParams.get('offset')||0);data=data.slice(offset,offset+n);
  await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(data),headers:{'access-control-allow-origin':origin,'access-control-allow-headers':'*'}});
 });
 await t.page.goto(origin+'/?__qa=badge-history',{waitUntil:'domcontentloaded'});const cluster=t.page.locator('.cluster-marker-container').filter({hasText:'3'});await cluster.waitFor({state:'visible',timeout:45000});await t.page.waitForTimeout(1000);await cluster.click();await t.page.waitForFunction(()=>window.__actualSdkProbe.first>0);await t.page.waitForTimeout(1000);
 const data=await t.page.evaluate(ids=>ids.map(id=>{const e=document.querySelector('[data-testid="marker"][data-restaurant-id="'+id+'"]'),b=e?.querySelector('.tzuyang-visit-count-badge');return {idFound:!!e,visitBadge:b?.textContent?.trim()??null,label:b?.getAttribute('aria-label')??null};}),rows.map(r=>r.id));
 assert.deepEqual(data.map(x=>x.visitBadge),[null,'2','3']);assert.ok(data.every(x=>x.idFound));result.checks.push({name:'populated unique histories1/2/3 rendered with exact badges',passed:true,data});
 result.actualSDK=await t.page.evaluate(()=>({loaded:!!window.naver?.maps?.Map,remote:!!document.querySelector('script[src*="oapi.map.naver.com/openapi/v3/maps.js"]'),mapCreates:window.__actualSdkProbe.sdkMapCreates}));assert.ok(result.actualSDK.loaded&&result.actualSDK.remote&&result.actualSDK.mapCreates===1);
 result.errors=t.errors;result.passed=true;
}catch{result.failure='bounded_populated_history_badge_invariant';}
finally{if(t)await t.close();if(browser)await browser.close();await server.close();await writeFile(new URL('raw.json',out),JSON.stringify(result,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(result));}
if(!result.passed)process.exitCode=1;
