import assert from 'node:assert/strict';
import {chromium} from '@playwright/test';
import {readFile,writeFile} from 'node:fs/promises';
import {parseFieldVitalSample} from '/Users/twoimo/.codex/worktrees/marker-memory-release-20261002/tzudong/apps/web/lib/performance/field-vitals.ts';
const here=new URL('./',import.meta.url),current=JSON.parse(await readFile(new URL('current-production-v1.json',here)));
assert.equal(current.deployment.state,'READY');const sourceSha=current.deployment.gitSha;
const browser=await chromium.launch({channel:'chrome',headless:true});
const result={sourceSha,browser:await browser.version(),scope:'actual public compiled client; intercepted synthetic metric delivery and synthetic visibility/input; not field or physical lifecycle evidence',fieldAdmitted:0,metricReceipts:[],qaReceipts:[],readiness:[],passed:false};
try{
 for(const qa of [false,true]){
  const context=await browser.newContext({viewport:{width:1440,height:900},locale:'ko-KR',serviceWorkers:'block'});
  const receipts=qa?result.qaReceipts:result.metricReceipts;
  // Eligibility override is confined to an owned fixture whose metric POSTs
  // are all intercepted before network. No metric enters the real collector.
  await context.route('**/api/performance/web-vitals',async route=>{
   const request=route.request();if(request.method()!=='POST'){await route.abort();return;}
   const payload=parseFieldVitalSample(request.postDataJSON()),headers=await request.allHeaders();
   receipts.push({metricName:payload?.metric??'invalid',schemaValidated:!!payload,releaseMatched:payload?.release===sourceSha,cookieAbsent:!headers.cookie,authorizationAbsent:!headers.authorization,refererAbsent:!headers.referer,productionWriteIntercepted:true});
   await route.fulfill({status:204,body:''});
  });
  await context.addInitScript(()=>{
   Object.defineProperty(navigator,'webdriver',{get:()=>false});window.__ownedFieldObserverKinds=[];
   const Original=PerformanceObserver;
   window.PerformanceObserver=new Proxy(Original,{construct(target,args,newTarget){const observer=Reflect.construct(target,args,newTarget),observe=observer.observe.bind(observer);observer.observe=options=>{window.__ownedFieldObserverKinds.push(options.type??(options.entryTypes??[]).join(','));return observe(options);};return observer;}});
  });
  const page=await context.newPage();let pageErrors=0;page.on('pageerror',()=>pageErrors++);
  await page.goto('https://www.tzudong.app/'+(qa?'?__qa=current-collector-fixture':'?__collection_fixture=current'),{waitUntil:'domcontentloaded',timeout:45000});
  await page.waitForFunction(()=>window.__ownedFieldObserverKinds?.includes('largest-contentful-paint'),null,{timeout:20000});
  await page.waitForFunction(()=>!!window.naver?.maps?.Map&&document.querySelectorAll('.cluster-marker-container,[data-testid="marker"]').length>0,null,{timeout:45000});
  result.readiness.push({qa,observerKinds:await page.evaluate(()=>window.__ownedFieldObserverKinds),realSdkReady:true,pageErrors});
  await page.evaluate(()=>{const button=document.createElement('button');button.id='owned-field-input';button.textContent='계측 검증(합성)';button.style.cssText='position:fixed;left:20px;top:200px;z-index:99999;background:white;color:black;padding:12px';button.onclick=()=>{const until=performance.now()+80;while(performance.now()<until){}};document.body.appendChild(button);});
  await page.locator('#owned-field-input').click();await page.waitForTimeout(300);
  await page.evaluate(()=>{Object.defineProperty(document,'visibilityState',{configurable:true,get:()=> 'hidden'});document.dispatchEvent(new Event('visibilitychange'));});
  await page.waitForTimeout(500);await context.close();
 }
 result.names=result.metricReceipts.map(r=>r.metricName).sort();
 result.passed=['CLS','INP','LCP'].every(n=>result.names.includes(n))&&result.metricReceipts.length===3&&result.qaReceipts.length===0&&result.metricReceipts.every(r=>r.schemaValidated&&r.releaseMatched&&r.cookieAbsent&&r.authorizationAbsent&&r.refererAbsent);
 // Separate normal automation/QA context. Only an intentionally stale sample
 // reaches the server; the source route rejects it before DB/RPC admission.
 const context=await browser.newContext({viewport:{width:384,height:824},isMobile:true,hasTouch:true,locale:'ko-KR',serviceWorkers:'block'}),page=await context.newPage();
 await page.goto('https://www.tzudong.app/?__qa=current-stale-negative',{waitUntil:'domcontentloaded',timeout:45000});
 result.staleNegative=await page.evaluate(async()=>{
  const response=await fetch('/api/performance/web-vitals',{method:'POST',credentials:'omit',referrerPolicy:'no-referrer',headers:{'Content-Type':'application/json'},body:JSON.stringify({version:1,device:'desktop',metric:'CLS',navigation:'navigate',bucket:0,release:'0'.repeat(40)})});
  const value=await response.json();return {status:response.status,fixedCode:value?.code==='field_release_stale'?'field_release_stale':'unclassified_fixed_response',rawBodyRetained:false};
 });
 await context.close();result.passed&&=result.staleNegative.status===409&&result.staleNegative.fixedCode==='field_release_stale';
}catch(e){result.failure=e.name==='TimeoutError'?'bounded_readiness_timeout':'bounded_collector_fixture_unavailable';}
finally{await browser.close();await writeFile(new URL('current-field-producer-fixture-v1.json',here),JSON.stringify(result,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({passed:result.passed,names:result.names,qaReceipts:result.qaReceipts.length,staleNegative:result.staleNegative,fieldAdmitted:0}));}
if(!result.passed)process.exitCode=1;
