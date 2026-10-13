import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {chromium,serve,pageSetup,origin,catalog} from './real-sdk-runtime-v14.mjs';
const here=new URL('./',import.meta.url);
const plan=JSON.parse(await readFile(new URL('production-plan-v1.json',here)));
const receipt=JSON.parse(await readFile(new URL('build-receipts-v8.json',here))).find(r=>r.kind==='candidate');
assert.equal((await readFile(receipt.root+'/'+receipt.distDir+'/BUILD_ID','utf8')).trim(),plan.buildId);
const out=new URL('render-error-diagnostic-v3/',here);await mkdir(out);
const report={sourceCommit:receipt.sourceCommit,buildId:receipt.buildId,startedAtUtc:new Date().toISOString(),cases:[],physicalDevice:false,performanceAdmission:0,fieldAdmission:0};
const server=await serve(receipt);
try {
  for(let i=1;i<2;i++){
    const scenario=plan.cases[i],result={...scenario,index:i,startedAtUtc:new Date().toISOString(),attempts:0,stubRequests:0};
    const browser=await chromium.launch({channel:'chrome',headless:true});result.browserVersion=await browser.version();
    const t=await pageSetup(browser);let stage='startup';
    try {
      await t.page.setViewportSize({width:scenario.width,height:scenario.height});
      t.page.on('request',request=>{if(new URL(request.url()).pathname==='/__local/naver-maps.js')result.stubRequests++;});
      await t.page.route('https://oapi.map.naver.com/openapi/v3/maps.js*',route=>{
        result.attempts++;
        if(result.attempts!==1)return route.continue();
        return scenario.failure==='network'?route.abort('failed'):route.fulfill({contentType:'application/javascript',body:'/* controlled missing API response */'});
      });
      await t.page.goto(origin+'/?__qa=swipe-cache-20261009',{waitUntil:'domcontentloaded',timeout:30000});
      stage='visible-error';
      await t.page.getByRole('heading',{name:'지도를 불러오지 못했어요',exact:true}).waitFor({state:'visible',timeout:20000});
      await t.page.waitForTimeout(250);
      assert.equal(result.attempts,1);assert.equal(result.stubRequests,0);
      result.errorVisible=true;result.automaticRetriesObserved=0;
      await t.page.screenshot({path:new URL(`case-${i}-error.png`,out).pathname});
      stage='explicit-retry';
      await t.page.getByRole('button',{name:'다시 시도',exact:true}).click();
      await t.page.locator('.cluster-marker-container').filter({hasText:'735'}).waitFor({state:'visible',timeout:30000});
      await t.awaitSdkReceipt();result.sdkScript={...t.sdkScript};
      result.sdk=await t.page.evaluate(()=>({loaded:!!window.naver?.maps?.Map,stub:!!document.querySelector('script[data-local-naver-maps="true"]'),mapCreates:window.__swipeCacheUiProbe.mapCreates,captured:!!window.__swipeCacheUiProbe.mapRef?.deref()}));
      assert.equal(result.attempts,2);assert.equal(result.stubRequests,0);assert.equal(result.sdkScript.sha256,plan.realSdkPinnedSha256);
      assert.ok(result.sdk.loaded&&!result.sdk.stub&&result.sdk.mapCreates===1&&result.sdk.captured);
      result.recovered=true;
      await t.page.screenshot({path:new URL(`case-${i}-recovered.png`,out).pathname});
      result.passed=true;
    }catch(error){result.passed=false;result.failureStage=stage;result.failureKind=error?.name==='TimeoutError'?'timeout':error?.name==='AssertionError'?'assertion':'other';}
    finally{
      result.errors=structuredClone(t.errors);result.requests=structuredClone(t.requests);result.diagnostics=structuredClone(t.diagnostics);
      try{result.boundedErrorEvents=await t.page.evaluate(()=>window.__boundedErrorEvents??[]);result.boundedConsoleErrors=await t.page.evaluate(()=>window.__boundedConsoleErrors??[]);result.boundedCreatedErrors=await t.page.evaluate(()=>window.__boundedCreatedErrors??[]);}catch{}
      result.endedAtUtc=new Date().toISOString();await t.close();await browser.close();
    }
    report.cases.push(result);
    await writeFile(new URL(`case-${i}.json`,out),JSON.stringify(result,null,2)+'\n',{flag:'wx'});
    console.log(JSON.stringify({index:i,passed:result.passed,errorVisible:result.errorVisible??false,recovered:result.recovered??false,attempts:result.attempts,stubRequests:result.stubRequests,failureStage:result.failureStage??null}));
  }
}finally{await server.close();}
report.endedAtUtc=new Date().toISOString();report.passed=report.cases.length===plan.cases.length&&report.cases.every(r=>r.passed);
await writeFile(new URL('summary.json',out),JSON.stringify(report,null,2)+'\n',{flag:'wx'});
if(!report.passed)process.exitCode=1;
