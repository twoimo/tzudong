import {chromium} from '@playwright/test';
import {mkdir,writeFile} from 'node:fs/promises';
import {serve,pageSetup,origin} from './real-sdk-runtime-retain-v2.mjs';
const here=new URL('./',import.meta.url),out=new URL('delayed-sdk-root-v1/',here);await mkdir(out);process.env.SDK_CANDIDATE_BUILD_LABEL='ret-root-v1';
const server=await serve('candidate');let browser,t;const result={buildId:server.receipt.buildId,inputs:server.receipt.inputs,scope:'real SDK with owned delayed-map-attachment fixture; synthetic735; no production delay or performance claim',fieldAdmitted:0,passed:false};
try{
 browser=await chromium.launch({channel:'chrome',headless:true});t=await pageSetup(browser,{mobile:true,count:735,cpu:4,captureFrames:false});
 await t.page.addInitScript(()=>{
  window.__delayedRootFixture={created:0,attached:0,missingRootRequests:0,unmaskedPaintFrames:0,maxUnmaskedOutside:0,delays:[]};
  document.addEventListener('load',e=>{
   if(e.target?.tagName!=='SCRIPT'||!e.target.src.includes('oapi.map.naver.com/openapi/v3/maps.js'))return;
   const maps=window.naver.maps,Original=maps.Marker;
   maps.Marker=new Proxy(Original,{construct(fn,args,target){
    const opts=args[0];if(!opts?.map||typeof opts.icon?.content!=='string'||!opts.icon.content.includes('data-testid="marker"'))return Reflect.construct(fn,args,target);
    const b=opts.map.getBounds(),sw=b.getSW(),ne=b.getNE(),dy=(ne.lat()-sw.lat())*.25,dx=(ne.lng()-sw.lng())*.25,p=opts.position;
    if(p.lat()>=sw.lat()-dy&&p.lat()<=ne.lat()+dy&&p.lng()>=sw.lng()-dx&&p.lng()<=ne.lng()+dx)return Reflect.construct(fn,args,target);
    const marker=Reflect.construct(fn,[{...opts,map:null}],target),get=marker.getElement.bind(marker),set=marker.setMap.bind(marker);let pending=true,wanted=opts.map;const createdAt=performance.now();window.__delayedRootFixture.created++;
    marker.getElement=()=>{if(pending){window.__delayedRootFixture.missingRootRequests++;return null;}return get();};
    marker.setMap=map=>{wanted=map;if(!pending||!map)set(map);};
    setTimeout(()=>{pending=false;if(wanted){set(wanted);window.__delayedRootFixture.attached++;window.__delayedRootFixture.delays.push(performance.now()-createdAt);}},160);
    return marker;
   }});
  },true);
  function frame(){const q=window.__actualSdkProbe,m=q?.mapRef?.deref();if(m&&q.first){const b=m.getBounds(),sw=b.getSW(),ne=b.getNE(),dy=(ne.lat()-sw.lat())*.25,dx=(ne.lng()-sw.lng())*.25;let count=0;for(const e of document.querySelectorAll('[data-testid="marker"][data-restaurant-id]')){const index=Number(e.dataset.restaurantId.slice(-12)),lat=37.5+(index%40)*.003,lng=126.96+Math.floor(index/40)*.003,out=lat<sw.lat()-dy||lat>ne.lat()+dy||lng<sw.lng()-dx||lng>ne.lng()+dx;if(out&&e.getAttribute('aria-hidden')!=='true')count++;}if(count)window.__delayedRootFixture.unmaskedPaintFrames++;window.__delayedRootFixture.maxUnmaskedOutside=Math.max(window.__delayedRootFixture.maxUnmaskedOutside,count);}requestAnimationFrame(frame);}requestAnimationFrame(frame);
 });
 await t.page.goto(origin+'/?__qa=delayed-sdk-root',{waitUntil:'domcontentloaded'});const cluster=t.page.locator('.cluster-marker-container').filter({hasText:'735'});await cluster.waitFor({state:'visible',timeout:45000});await t.page.waitForTimeout(1000);await cluster.click();await t.page.waitForFunction(()=>window.__actualSdkProbe.first>0);await t.page.waitForTimeout(1500);
 result.fixture=await t.page.evaluate(()=>({...window.__delayedRootFixture,mapCreates:window.__actualSdkProbe.sdkMapCreates,markers:document.querySelectorAll('[data-testid="marker"]').length}));
 result.passed=result.fixture.created>0&&result.fixture.created===result.fixture.attached&&result.fixture.missingRootRequests>0&&result.fixture.unmaskedPaintFrames===0&&result.fixture.maxUnmaskedOutside===0&&result.fixture.markers===735&&result.fixture.mapCreates===1;
 result.errors=t.errors;
}catch{result.failure='bounded_delayed_sdk_root_fixture_unavailable';}
finally{if(t)await t.close();if(browser)await browser.close();await server.close();await writeFile(new URL('raw.json',out),JSON.stringify(result,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({passed:result.passed,fixture:result.fixture}));}
if(!result.passed)process.exitCode=1;
