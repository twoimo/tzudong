import assert from 'node:assert/strict';
import {summarizeQueryReachability} from './query-reachability-v1.mjs';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {chromium,serve,pageSetup,origin,catalog} from './real-sdk-runtime-https-v18.mjs';
import {createHash,X509Certificate} from 'node:crypto';
const kind=process.argv[2],label=process.argv[3],queries=Number(process.argv[4]||8),passes=Number(process.argv[5]||1);
assert.ok(['baseline','candidate'].includes(kind));assert.match(label,/^[a-z0-9-]+$/);assert.ok(queries>=1&&queries<=128&&passes>=1&&passes<=2);
const here=new URL('./',import.meta.url),out=new URL(`ui-${label}/`,here);await mkdir(out);
const receipts=JSON.parse(await readFile(new URL('build-receipts-v8.json',here)));const receipt=receipts.find(row=>row.kind===kind);
assert.equal(process.versions.node,'24.21.0');
assert.equal(JSON.parse(await readFile(receipt.root+'/node_modules/next/package.json')).version,'16.3.8');
assert.equal((await readFile(receipt.root+'/'+receipt.distDir+'/BUILD_ID','utf8')).trim(),receipt.buildId);
assert.equal(createHash('sha256').update(await readFile(receipt.root+'/package-lock.json')).digest('hex'),receipt.lockSha256);
assert.equal(createHash('sha256').update(await readFile(receipt.root+'/lib/mobile-home-search-selection.ts')).digest('hex'),receipt.helperSourceSha256);
const plan=JSON.parse(await readFile(new URL('browser-confirm-plan-v8.json',here)));
assert.equal(createHash('sha256').update(await readFile(new URL('fixture-query-v7.mjs',here))).digest('hex'),plan.fixtureSha256);
const result={kind,sourceCommit:receipt.sourceCommit,buildId:receipt.buildId,startedAtUtc:new Date().toISOString(),environment:{cpuRate:4,network:'unthrottled real remote SDK/tiles; synthetic REST735/Auth401',cache:'disabled and SW bypassed',viewport:'390x844/dpr1/touch emulation',productionBuild:true,forcedGC:false},queries,passes,cycles:[],fieldAdmission:0,performanceAdmission:0,physicalDevice:false,pilotOnly:false,diagnosticOnly:true,measurementProtocol:'https128x2-query-reachability-diagnostic-v4',reactFiberInspectionDiagnosticOnly:true,independentExecutionLabel:label};
let browser,t,server;

async function inspectHeap(){
  let chunks=[],bytes=0,overflow=false;const cap=128*1024*1024;
  const append=event=>{bytes+=Buffer.byteLength(event.chunk);if(bytes>cap){overflow=true;chunks=[];}if(!overflow)chunks.push(event.chunk);};
  await t.cdp.send('HeapProfiler.enable');t.cdp.on('HeapProfiler.addHeapSnapshotChunk',append);
  try{
    await t.cdp.send('HeapProfiler.takeHeapSnapshot',{reportProgress:false});
    if(overflow)return {available:false,reason:'snapshot_size_cap',rawBytes:bytes,rawPersisted:false};
    const snapshot=JSON.parse(chunks.join(''));chunks=[];
    const value=summarizeQueryReachability(snapshot);return {available:true,rawBytes:bytes,rawPersisted:false,primaryGuardUse:false,snapshotMayTriggerGC:true,...value};
  }catch{return {available:false,reason:'bounded_heap_inspection_unavailable',rawBytes:bytes,rawPersisted:false};}
  finally{chunks=[];t.cdp.off('HeapProfiler.addHeapSnapshotChunk',append);await t.cdp.send('HeapProfiler.disable').catch(()=>{});}
}


const queryCacheSnapshot=()=>t.page.evaluate(()=>{
  const main=document.querySelector('main');
  const key=main&&Object.keys(main).find(key=>key.startsWith('__reactFiber$'));
  if(!key)return {available:false,reason:'react_host_fiber_unavailable'};
  let client=null,fiber=main[key];
  for(let depth=0;fiber&&depth<128;depth++,fiber=fiber.return){
    for(const value of [fiber.memoizedProps?.client,fiber.memoizedProps?.value]){
      if(typeof value?.getQueryCache==='function'){client=value;break;}
    }
    if(client)break;
  }
  if(!client)return {available:false,reason:'query_client_not_observed'};
  const allowed=new Set(['restaurants','restaurant','restaurant-detail','restaurant-reviews','restaurant-tzuyang-review-siblings','restaurant-search','search-restaurants','restaurants-list','reviews','popular-searches','user','auth','profile']);
  const rows=client.getQueryCache().getAll();const groups={};
  for(const query of rows){
    const raw=query.queryKey?.[0];const family=allowed.has(raw)?raw:'other';
    const group=groups[family]??={queries:0,active:0,inactive:0,dataArrayItems:0,pageArrayItems:0,gcMs:[]};group.queries++;
    if(query.getObserversCount()>0)group.active++;else group.inactive++;
    const data=query.state?.data;
    if(Array.isArray(data))group.dataArrayItems+=data.length;
    if(Array.isArray(data?.pages))for(const page of data.pages)if(Array.isArray(page))group.pageArrayItems+=page.length;
    if(Number.isFinite(query.gcTime)&&!group.gcMs.includes(query.gcTime))group.gcMs.push(query.gcTime);
  }
  return {available:true,queries:rows.length,groups,rawKeysOrDataPersisted:false};
});

try {
  server=await serve(receipt);const cert=new X509Certificate(await readFile('/Users/twoimo/.codex/runtime-cache/naver-local-tls-20261013-v1/cert.pem')); assert.ok(Date.now()<Date.parse(cert.validTo)); const spki=createHash('sha256').update(cert.publicKey.export({type:'spki',format:'der'})).digest('base64'); browser=await chromium.launch({channel:'chrome',headless:true,args:['--ignore-certificate-errors-spki-list='+spki]});result.browserVersion=await browser.version();
  t=await pageSetup(browser);await t.page.goto(origin+'/?__qa=swipe-cache-20261009',{waitUntil:'domcontentloaded',timeout:30000});
  await t.page.locator('.cluster-marker-container').filter({hasText:'735'}).waitFor({state:'visible',timeout:45000});
  result.sdk=await t.page.evaluate(()=>({loaded:!!window.naver?.maps?.Map,remoteScript:!!document.querySelector('script[src*="oapi.map.naver.com/openapi/v3/maps.js"]'),stub:!!document.querySelector('script[data-local-naver-maps="true"]'),captured:!!window.__swipeCacheUiProbe.mapRef?.deref(),reportedVersion:window.naver?.maps?.VERSION??null}));
  assert.ok(result.sdk.loaded&&result.sdk.remoteScript&&!result.sdk.stub&&result.sdk.captured);
  await t.awaitSdkReceipt();result.sdkScript={...t.sdkScript};result.initialRestaurantRequests=t.requests.restaurant;
  result.initialHeap=await t.cdp.send('Runtime.getHeapUsage');await t.cdp.send('Performance.enable');result.initialResources=(await t.cdp.send('Performance.getMetrics')).metrics.filter(metric=>['Nodes','Documents','JSEventListeners','JSHeapUsedSize'].includes(metric.name));result.initialDomCounters=await t.cdp.send('Memory.getDOMCounters');result.initialQueryCache=await queryCacheSnapshot();
  const fixture=catalog();
  for(let pass=0;pass<passes;pass+=1)for(let query=0;query<queries;query+=1){
    const restaurant=fixture[(query*37+1)%fixture.length];
    const requestsBefore=t.requests.restaurant;
    await t.page.getByLabel('맛집 검색 열기',{exact:true}).click();
    await t.page.getByLabel('맛집 검색어 입력',{exact:true}).fill(restaurant.name);
    await t.page.getByRole('button',{name:new RegExp(restaurant.name)}).first().click();
    await t.page.getByTestId('restaurant-detail-panel').filter({hasText:restaurant.name}).waitFor({state:'visible',timeout:15000});
    const state=await t.page.evaluate(async({id,name})=>{
      await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
      const probe=window.__swipeCacheUiProbe,map=probe.mapRef.deref(),now=performance.now();
      const panel=document.querySelector('[data-testid="restaurant-detail-panel"]');
      const ids=Array.from(document.querySelectorAll('[data-testid="marker"][data-restaurant-id]'),element=>element.dataset.restaurantId);
      const state={observedAt:now,inputToObservedMs:now-probe.lastClick,panelMatches:!!panel?.textContent?.includes(name),selectedMarkerPresent:ids.includes(id),markerCount:ids.length,duplicateMarkers:ids.length-new Set(ids).size,mapCreates:probe.mapCreates,center:{lat:map.getCenter().lat(),lng:map.getCenter().lng()},zoom:map.getZoom(),visibility:document.visibilityState,overflow:Math.max(0,document.documentElement.scrollWidth-innerWidth),frameCount:probe.frames.length,maxFrameGapMs:Math.max(0,...probe.frames.map(frame=>frame.gap)),longTaskCount:probe.tasks.length,longTaskMs:probe.tasks.reduce((sum,entry)=>sum+entry.duration,0),layoutShiftWithoutInput:probe.shifts.filter(entry=>!entry.recentInput).reduce((sum,entry)=>sum+entry.value,0)};
      probe.frames.length=0;probe.tasks.length=0;probe.shifts.length=0;return state;
    },{id:restaurant.id,name:restaurant.name});
    const row={pass,query,state,restaurantRequestsAtSample:t.requests.restaurant,restaurantRequestsSinceQueryStart:t.requests.restaurant-requestsBefore};
    if(query%16===15||query===queries-1){row.heap=await t.cdp.send('Runtime.getHeapUsage');row.resources=(await t.cdp.send('Performance.getMetrics')).metrics.filter(metric=>['Nodes','Documents','JSEventListeners','JSHeapUsedSize'].includes(metric.name));}
    if(query%16===15)row.queryCache=await queryCacheSnapshot();result.cycles.push(row);
    assert.ok(state.panelMatches&&state.selectedMarkerPresent&&state.duplicateMarkers===0&&state.mapCreates===1&&state.visibility==='visible'&&state.overflow===0);
    if(query===0||query===queries-1)await t.page.screenshot({path:new URL(`pass-${pass}-query-${query}.png`,out).pathname});
    if(query%16===15)console.log(JSON.stringify({kind,pass,completedQueries:query+1}));
  }
  result.endHeap=await t.cdp.send('Runtime.getHeapUsage');result.endDomCounters=await t.cdp.send('Memory.getDOMCounters');
  await t.page.evaluate(()=>{window.__swipeCacheUiProbe.on=false;});await t.page.waitForTimeout(5000);result.idleHeap=await t.cdp.send('Runtime.getHeapUsage');result.idleDomCounters=await t.cdp.send('Memory.getDOMCounters');result.idleQueryCache=await queryCacheSnapshot();result.idleResources=(await t.cdp.send('Performance.getMetrics')).metrics.filter(metric=>['Nodes','Documents','JSEventListeners','JSHeapUsedSize'].includes(metric.name));
  assert.equal(t.requests.unsupportedFixtureQueries??0,0);
  assert.equal(result.sdkScript.sha256,plan.sdkScriptSha256);
  result.heapQueryReachability=await inspectHeap();result.passed=true;
}catch(error){result.passed=false;result.failure='bounded_browser_flow_invariant_unavailable';result.boundedFailureType=['AssertionError','TimeoutError','Error'].includes(error?.name)?error.name:'other';}
finally{if(t){result.errors={...t.errors};result.requests={...t.requests};await t.close();}if(browser)await browser.close();if(server)await server.close();}
result.endedAtUtc=new Date().toISOString();await writeFile(new URL('raw.json',out),JSON.stringify(result,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({kind,label,passed:result.passed,cycles:result.cycles.length,sdk:result.sdk??null,errors:result.errors??null}));if(!result.passed)process.exitCode=1;
