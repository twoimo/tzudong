import {readFile,writeFile} from 'node:fs/promises';
import {chromium,serve,pageSetup,origin} from './real-sdk-runtime-v12.mjs';
const plan=JSON.parse(await readFile(new URL('plan.json',import.meta.url)));const builds=JSON.parse(await readFile(new URL('build-receipts-v8.json',import.meta.url)));const rows=[];
for(let i=0;i<plan.order.length;i++){
 const kind=plan.order[i],receipt=builds.find(x=>x.kind===kind);const r={i,kind,source:receipt.sourceCommit,buildId:receipt.buildId,startedAtUtc:new Date().toISOString(),remoteSdkRequests:0,realSDK:false};
 const server=await serve(receipt);const browser=await chromium.launch({channel:'chrome',headless:true});r.browserVersion=await browser.version();const t=await pageSetup(browser);
 try{
  await t.page.route('https://oapi.map.naver.com/openapi/v3/maps.js*',route=>{r.remoteSdkRequests++;return route.abort('failed');});
  const request=t.page.waitForRequest(req=>req.url().startsWith('https://oapi.map.naver.com/openapi/v3/maps.js'),{timeout:10000}).then(()=>true,()=>false);
  await t.page.goto(origin+'/?__qa=swipe-cache-20261009',{waitUntil:'domcontentloaded',timeout:20000});r.reachedSdk=await request;
  await t.page.waitForTimeout(250);
  r.boundedErrorEvents=await t.page.evaluate(()=>window.__boundedErrorEvents??[]);r.errors=structuredClone(t.errors);r.diagnostics=structuredClone(t.diagnostics);r.requests=structuredClone(t.requests);
 }catch{r.failed='bounded_browser_setup_failure';r.reachedSdk=false;}
 finally{await t.close();await browser.close();await server.close();}
 r.endedAtUtc=new Date().toISOString();rows.push(r);await writeFile(new URL(`run-${i}-${kind}.json`,import.meta.url),JSON.stringify(r,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({i,kind,reachedSdk:r.reachedSdk,pageErrors:r.errors?.page??null,canceledAssets:r.requests?.failedAppAsset??null}));
}
await writeFile(new URL('summary.json',import.meta.url),JSON.stringify({rows,performanceAdmission:0,realSDK:false},null,2)+'\n',{flag:'wx'});
