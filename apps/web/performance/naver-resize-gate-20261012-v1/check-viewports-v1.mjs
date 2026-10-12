import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {chromium,serve,pageSetup,origin,catalog} from './real-sdk-runtime-v8.mjs';
const kind=process.argv[2];assert.ok(['baseline','candidate'].includes(kind));
const receipt=JSON.parse(await readFile(new URL('build-receipts-v8.json',import.meta.url))).find(r=>r.kind===kind);
const out=new URL(`viewports-${kind}-v1/`,import.meta.url);await mkdir(out);
const result={kind,sourceCommit:receipt.sourceCommit,buildId:receipt.buildId,cases:[],physicalDevice:false,fieldAdmission:0,performanceAdmission:0,existingPostTransitionWaitMs:350,keyboardAndAddressBarPhysical:false};
let server,browser,t;
try {
  server=await serve(receipt);browser=await chromium.launch({channel:'chrome',headless:true});t=await pageSetup(browser);
  await t.page.goto(origin+'/?__qa=swipe-cache-20261009',{waitUntil:'domcontentloaded',timeout:30000});
  await t.page.locator('.cluster-marker-container').filter({hasText:'735'}).waitFor({state:'visible',timeout:45000});
  const restaurant=catalog()[1];
  await t.page.getByLabel('맛집 검색 열기',{exact:true}).click();
  await t.page.getByLabel('맛집 검색어 입력',{exact:true}).fill(restaurant.name);
  await t.page.getByRole('button',{name:new RegExp(restaurant.name)}).first().click();
  await t.page.getByTestId('restaurant-detail-panel').filter({hasText:restaurant.name}).waitFor({state:'visible',timeout:15000});
  for(const [width,height]of [[390,844],[390,540],[844,390],[768,1024],[1440,900],[390,844]]) {
    await t.page.setViewportSize({width,height});
    // Observe the existing320ms post-transition contract; no product delay is added.
    await t.page.waitForTimeout(350);
    const state=await t.page.evaluate(async({id,lat,lng})=>{
      await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
      const probe=window.__swipeCacheUiProbe,map=probe.mapRef.deref(),element=map.getElement();
      const point=map.getProjection().fromCoordToOffset(new window.naver.maps.LatLng(lat,lng));
      const rect=element.getBoundingClientRect();
      const marker=document.querySelector(`[data-testid="marker"][data-restaurant-id="${id}"]`);
      return {mapCreates:probe.mapCreates,zoom:map.getZoom(),center:{lat:map.getCenter().lat(),lng:map.getCenter().lng()},
        sdkSize:{width:map.getSize().width,height:map.getSize().height},domSize:{width:rect.width,height:rect.height},
        selectedMarkerPresent:!!marker,selectedPoint:{x:point.x,y:point.y},
        viewport:{width:innerWidth,height:visualViewport?.height??innerHeight},
        overflow:Math.max(0,document.documentElement.scrollWidth-innerWidth)};
    },{id:restaurant.id,lat:restaurant.lat,lng:restaurant.lng});
    assert.ok(state.mapCreates===1&&state.selectedMarkerPresent&&state.overflow===0);
    assert.ok(Math.abs(state.sdkSize.width-state.domSize.width)<=1&&Math.abs(state.sdkSize.height-state.domSize.height)<=1);
    result.cases.push({width,height,state});
    await t.page.screenshot({path:new URL(`case-${result.cases.length}-${width}x${height}.png`,out).pathname});
  }
  result.passed=true;
}catch{result.passed=false;result.failure='bounded_viewport_invariant_unavailable';}
finally{if(t){result.errors={...t.errors};result.requests={...t.requests};await t.close();}if(browser)await browser.close();if(server)await server.close();}
await writeFile(new URL('raw.json',out),JSON.stringify(result,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({kind,passed:result.passed,cases:result.cases.length,errors:result.errors}));if(!result.passed)process.exitCode=1;
