import {chromium} from '@playwright/test';
import {mkdir,writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {serve,origin} from './real-sdk-runtime.mjs';
import {parseFieldVitalSample} from '../../lib/performance/field-vitals.ts';

const label=process.argv[2];if(!/^[a-z0-9-]+$/.test(label??''))throw Error('newlabel required');
const out=new URL(`field-browser-${label}/`,import.meta.url);await mkdir(out);
const node='/opt/homebrew/opt/node@24/bin/node';
const agent='/Users/twoimo/.npm/_npx/6de2aa2fded2970c/node_modules/agent-browser/bin/agent-browser.js';
const session='tzudong-field-lab-20261001';
process.env.SDK_BASELINE_BUILD_LABEL='field-control-v2';
const result={startedAt:new Date().toISOString(),fieldAdmitted:0,canonicalTimingAdmitted:0,
  actualUserSamples:0,requestsToProductionCollector:0,syntheticInput:true,metricReceipts:[],qaReceipts:[],passed:false};
let server,browser,agentOpened=false;
try {
 server=await serve('baseline');result.buildId=server.receipt.buildId;result.inputs=server.receipt.inputs;result.sourceCommit=server.receipt.sourceCommit;
 // Session-owned CLI renderer check, separate from metric fixtures and timing claims.
 execFileSync(node,[agent,'--session',session,'open',origin+'/?__qa=field-gut-check'],{stdio:'ignore',timeout:30000});agentOpened=true;
 const snapshot=execFileSync(node,[agent,'--session',session,'snapshot','-i'],{encoding:'utf8',stdio:['ignore','pipe','ignore'],timeout:15000});
 result.agentBrowser={version:'0.38.1',interactiveSnapshotNonempty:snapshot.length>0};
 execFileSync(node,[agent,'--session',session,'screenshot',new URL('renderer.png',out).pathname],{stdio:'ignore',timeout:15000});
 execFileSync(node,[agent,'--session',session,'close'],{stdio:'ignore',timeout:15000});agentOpened=false;
 browser=await chromium.launch({headless:false});
 for(const qa of [false,true]) {
  const context=await browser.newContext({viewport:{width:1440,height:900},locale:'ko-KR',serviceWorkers:'block'});
  // Force a headful-equivalent eligibility signal ONLY inside these intercepted
  // synthetic fixtures. Nothing reaches a production collector or database.
  await context.addInitScript(()=>{
   Object.defineProperty(navigator,'webdriver',{get:()=>false});window.__fieldObserverKinds=[];
   const Original=PerformanceObserver;window.PerformanceObserver=new Proxy(Original,{construct(target,args,newTarget){
    const observer=Reflect.construct(target,args,newTarget),observe=observer.observe.bind(observer);observer.observe=options=>{window.__fieldObserverKinds.push(options.type??(options.entryTypes??[]).join(','));return observe(options);};return observer;
   }});
  });
  const receipts=qa?result.qaReceipts:result.metricReceipts;
  await context.route('**/*',async route=>{
   const request=route.request(),u=new URL(request.url());
   if(u.hostname==='www.tzudong.app'&&u.pathname==='/api/performance/web-vitals'){
    const payload=parseFieldVitalSample(request.postDataJSON());if(!payload)throw Error('nonallowlisted collector payload');
    const headers=await request.allHeaders();receipts.push({metricName:payload.metric,schemaValidated:true,buildReleaseMatched:payload.release===result.sourceCommit,cookieAbsent:!headers.cookie,
      authorizationAbsent:!headers.authorization,refererAbsent:!headers.referer,productionWriteIntercepted:true});
    await route.fulfill({status:204,body:''});return;
   }
   if(u.hostname==='www.tzudong.app'&&request.method()==='GET') {
    const local=new URL(u.pathname+u.search,origin),response=await fetch(local);
    await route.fulfill({status:response.status,headers:Object.fromEntries([...response.headers].filter(([k])=>!['content-encoding','content-length'].includes(k))),body:Buffer.from(await response.arrayBuffer())});return;
   }
   if(u.pathname.startsWith('/rest/v1/')) {await route.fulfill({status:200,contentType:'application/json',body:'[]',headers:{'Access-Control-Allow-Origin':'https://www.tzudong.app'}});return;}
   if(u.pathname==='/auth/v1/user') {await route.fulfill({status:401,contentType:'application/json',body:'{"message":"Auth session missing!"}'});return;}
   if(u.pathname.startsWith('/_vercel/')) {await route.fulfill({status:204,body:''});return;}
   await route.continue();
  });
  const page=await context.newPage();let pageErrors=0;page.on('pageerror',()=>pageErrors++);
  await page.goto('https://www.tzudong.app/'+(qa?'?__qa=field-collector':''),{waitUntil:'domcontentloaded',timeout:30000});
  await page.waitForFunction(()=>!!document.querySelector('input,button'),null,{timeout:15000});
  if(!qa){try{await page.waitForFunction(()=>window.__fieldObserverKinds.includes('largest-contentful-paint'),null,{timeout:15000});}catch{}}
  result[qa?'qaReadiness':'positiveReadiness']=await page.evaluate(()=>({visible:document.visibilityState,webdriver:navigator.webdriver,productionHost:location.hostname==='www.tzudong.app',rootPath:location.pathname==='/',observerKinds:window.__fieldObserverKinds,supportedTypes:PerformanceObserver.supportedEntryTypes}));
  // Instrumentation correctness scenario, not a user-performance sample.
  await page.evaluate(()=>{const b=document.createElement('button');b.id='field-synthetic-input';b.textContent='계측 검증(합성)';b.style.cssText='position:fixed;left:20px;bottom:20px;z-index:99999;background:white;color:black;padding:12px';b.onclick=()=>{const end=performance.now()+80;while(performance.now()<end){}};document.body.appendChild(b);});
  await page.locator('#field-synthetic-input').click();
  await page.waitForTimeout(300);
  const peer=await context.newPage();await peer.goto('about:blank');await peer.bringToFront();await page.waitForFunction(()=>document.visibilityState==='hidden',null,{timeout:5000});result[qa?'qaHidden':'positiveHidden']=await page.evaluate(()=>document.visibilityState);await page.waitForTimeout(300);
  result[qa?'qaPageErrors':'positivePageErrors']=pageErrors;
  await context.close();
 }
 result.names=result.metricReceipts.map(x=>x.metricName).sort();
 result.passed=result.qaReceipts.length===0&&['CLS','INP','LCP'].every(n=>result.names.includes(n))
  &&result.metricReceipts.every(r=>r.buildReleaseMatched&&r.cookieAbsent&&r.authorizationAbsent&&r.refererAbsent);
}catch{result.failure='owned collector browser fixture or invariant unavailable';}
finally{
 if(agentOpened){try{execFileSync(node,[agent,'--session',session,'close'],{stdio:'ignore',timeout:10000});}catch{}}
 if(browser)await browser.close();if(server)await server.close();
}
result.endedAt=new Date().toISOString();await writeFile(new URL('raw.json',out),JSON.stringify(result,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({passed:result.passed,names:result.names,qaReceipts:result.qaReceipts.length,fieldAdmitted:0,failure:result.failure}));
if(!result.passed)process.exitCode=1;
