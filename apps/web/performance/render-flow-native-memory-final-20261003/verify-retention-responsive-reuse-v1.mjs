import {chromium} from '@playwright/test';
import {mkdir,writeFile} from 'node:fs/promises';
import {serve,pageSetup,origin} from './real-sdk-runtime-retain-v2.mjs';
import {catalog} from './catalog.mjs';
const here=new URL('./',import.meta.url),out=new URL('retention-responsive-reuse-v1/',here);await mkdir(out);process.env.SDK_CANDIDATE_BUILD_LABEL='ret-ax-v2';
const server=await serve('candidate');let browser,t;const result={buildId:server.receipt.buildId,scope:'actual SDK with synthetic735; owned viewport changes in one browser, no physical orientation or performance claim',fieldAdmitted:0,cases:[],passed:false};
try{
 browser=await chromium.launch({channel:'chrome',headless:true});t=await pageSetup(browser,{mobile:true,count:735,cpu:4,captureFrames:false});
 await t.page.goto(origin+'/?__qa=retention-responsive-reuse',{waitUntil:'domcontentloaded'});const cluster=t.page.locator('.cluster-marker-container').filter({hasText:'735'});await cluster.waitFor({state:'visible',timeout:45000});await t.page.waitForTimeout(1000);await cluster.click();await t.page.waitForFunction(()=>window.__actualSdkProbe.first>0);await t.page.waitForTimeout(1000);
 for(const [name,width,height,mobile] of [['portrait',390,844,true],['desktop',1440,900,false],['tablet',768,1024,true],['landscape',1024,768,true],['desktop-return',1440,900,false],['portrait-return',390,844,true]]){
  await t.page.setViewportSize({width,height});await t.page.waitForTimeout(1000);
  const state=await t.page.evaluate(({rows,mobile})=>{const q=window.__actualSdkProbe,m=q.mapRef.deref(),b=m.getBounds(),sw=b.getSW(),ne=b.getNE(),dy=(ne.lat()-sw.lat())*.25,dx=(ne.lng()-sw.lng())*.25,padded=new Set(rows.filter(r=>r.lat>=sw.lat()-dy&&r.lat<=ne.lat()+dy&&r.lng>=sw.lng()-dx&&r.lng<=ne.lng()+dx).map(r=>r.id)),els=Array.from(document.querySelectorAll('[data-testid="marker"][data-restaurant-id]')),ids=els.map(e=>e.dataset.restaurantId),set=new Set(ids);return {markers:ids.length,paddedExpected:padded.size,missingPadded:[...padded].filter(id=>!set.has(id)).length,duplicates:ids.length-set.size,maskedInside:els.filter(e=>padded.has(e.dataset.restaurantId)&&e.getAttribute('aria-hidden')==='true').length,unmaskedOutside:els.filter(e=>!padded.has(e.dataset.restaurantId)&&e.getAttribute('aria-hidden')!=='true').length,totalMasked:els.filter(e=>e.getAttribute('aria-hidden')==='true').length,mapCreates:q.sdkMapCreates,overflow:Math.max(0,document.documentElement.scrollWidth-innerWidth)};},{rows:catalog(735),mobile});
  const passed=state.markers===735&&state.missingPadded===0&&state.duplicates===0&&state.mapCreates===1&&state.overflow===0&&(mobile?state.unmaskedOutside===0&&state.maskedInside===0:state.totalMasked===0);
  result.cases.push({name,width,height,mobile,state,passed});console.log(JSON.stringify({name,passed,state}));
 }
 result.passed=result.cases.every(c=>c.passed);result.errors=t.errors;
}catch{result.failure='bounded_responsive_reuse_unavailable';}
finally{if(t)await t.close();if(browser)await browser.close();await server.close();await writeFile(new URL('raw.json',out),JSON.stringify(result,null,2)+'\n',{flag:'wx'});}
if(!result.passed)process.exitCode=1;
