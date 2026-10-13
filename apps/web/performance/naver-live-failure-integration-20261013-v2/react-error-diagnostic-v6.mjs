import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {chromium,serve,pageSetup,origin,catalog} from './real-sdk-runtime-v14.mjs';
const here=new URL('./',import.meta.url);
const plan=JSON.parse(await readFile(new URL('production-plan-v1.json',here)));
const receipt=JSON.parse(await readFile(new URL('build-receipts-v8.json',here))).find(r=>r.kind==='candidate');
assert.equal((await readFile(receipt.root+'/'+receipt.distDir+'/BUILD_ID','utf8')).trim(),plan.buildId);
const out=new URL('react-error-diagnostic-v6/',here);await mkdir(out);
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
      try{result.boundedErrorEvents=await t.page.evaluate(()=>window.__boundedErrorEvents??[]);result.boundedConsoleErrors=await t.page.evaluate(()=>window.__boundedConsoleErrors??[]);result.boundedCreatedErrors=await t.page.evaluate(()=>window.__boundedCreatedErrors??[]);result.initialDom=await t.page.evaluate(()=>({
        reactErrorKinds:(()=>{
          const heading=Array.from(document.querySelectorAll('h2')).find(x=>x.textContent==='지도를 불러오지 못했어요');
          const key=heading&&Object.keys(heading).find(x=>x.startsWith('__reactFiber$'));let fiber=key?heading[key]:null;const errors=[];
          const classify=value=>{
            const text=typeof value==='string'?value:value?.message;
            const known={'네이버 지도 Client ID가 설정되지 않았습니다.':'sdk_config_missing','네이버 지도 API 초기화 실패':'sdk_api_missing','네이버 지도 API 스크립트 로드 실패 - Client ID 또는 웹 서비스 URL을 확인해주세요.':'sdk_load_failed','supabase_rest_config_missing':'db_config_missing','supabase_rest_config_invalid':'db_config_invalid'};
            if(typeof text!=='string')return null;
            return {category:known[text]??(/supabase_rest_(rows|count|rpc)_failed:\d+/.test(text)?'db_read_failed':'other'),length:text.length,name:['Error','TypeError','ReferenceError','SyntaxError'].includes(value?.name)?value.name:null};
          };
          for(let depth=0;fiber&&depth<35;depth++,fiber=fiber.return){
            for(const field of ['message','error']){const error=classify(fiber.memoizedProps?.[field]);if(error)errors.push({depth,from:'prop-'+field,...error});}
            let hook=fiber.memoizedState;
            for(let n=0;hook&&n<80;n++,hook=hook.next){if(hook.memoizedState instanceof Error){const error=classify(hook.memoizedState);if(error)errors.push({depth,from:'hook-error',...error});}}
          }
          return errors.slice(0,10);
        })(),scriptSources:Array.from(document.scripts).map(script=>{if(!script.src)return {inline:true};const url=new URL(script.src);return {group:url.hostname==='localhost'?'owned-loopback':url.hostname==='oapi.map.naver.com'?'sdk':/naver|pstatic/.test(url.hostname)?'naver-family':'other',protocol:url.protocol,isSdk:url.pathname.endsWith('/maps.js'),localStub:script.dataset.localNaverMaps==='true',parameterKeys:[...url.searchParams.keys()]};}),
        hasNaver:!!window.naver,hasMap:!!window.naver?.maps?.Map,hasLatLng:!!window.naver?.maps?.LatLng,mapCreates:window.__swipeCacheUiProbe?.mapCreates,
        errorNotice:document.body.innerText.includes('지도를 불러오지 못했어요'),retryButtons:Array.from(document.querySelectorAll('button')).filter(x=>x.innerText==='다시 시도').length,
        markerCount:document.querySelectorAll('[data-testid=marker]').length
      }));await t.page.screenshot({path:new URL(`case-${i}-diagnostic.png`,out).pathname});}catch{}
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
