import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {chromium,serve,pageSetup,origin,catalog} from './runtime-v2.mjs';
import {createHash,X509Certificate} from 'node:crypto';
const kind=process.argv[2],label=process.argv[3],queries=Number(process.argv[4]||8),passes=Number(process.argv[5]||1);
assert.ok(['baseline','candidate'].includes(kind));assert.match(label,/^[a-z0-9-]+$/);assert.ok(queries>=1&&queries<=128&&passes>=1&&passes<=2);
const here=new URL('./',import.meta.url),out=new URL(`ui-${label}/`,here);await mkdir(out);
const receipts=JSON.parse(await readFile(new URL('build-receipts-v1.json',here)));const receipt=receipts.find(row=>row.kind===kind);
assert.equal(process.versions.node,'24.21.0');
assert.equal(JSON.parse(await readFile(receipt.root+'/node_modules/next/package.json')).version,'16.3.8');
assert.equal((await readFile(receipt.root+'/'+receipt.distDir+'/BUILD_ID','utf8')).trim(),receipt.buildId);
assert.equal(createHash('sha256').update(await readFile(receipt.root+'/package-lock.json')).digest('hex'),receipt.lockSha256);
const {execFileSync}=await import('node:child_process');
for (const [file,field] of [['lib/marker-pool.ts','markerPoolSourceSha256'],['lib/mobile-home-search-selection.ts','helperSourceSha256'],['components/restaurant/RestaurantDetailPanel.tsx','detailComponentSha256']]) assert.equal(createHash('sha256').update(execFileSync('git',['show',receipt.sourceCommit+':apps/web/'+file],{cwd:receipt.root})).digest('hex'),receipt[field]);

const plan=JSON.parse(await readFile(new URL('browser-plan-v3.json',here)));
assert.equal(createHash('sha256').update(await readFile(new URL('fixture-query-v3.mjs',here))).digest('hex'),plan.fixtureSha256);
const result={kind,sourceCommit:receipt.sourceCommit,buildId:receipt.buildId,startedAtUtc:new Date().toISOString(),environment:{cpuRate:4,network:'unthrottled real remote SDK/tiles; synthetic REST735/Auth401',cache:'disabled and SW bypassed',viewport:'390x844/dpr1/touch emulation',productionBuild:true,forcedGC:false},queries,passes,cycles:[],fieldAdmission:0,performanceAdmission:0,physicalDevice:false,pilotOnly:queries!==128||passes!==2,diagnosticOnly:true,measurementProtocol:'marker-category-sdk-boundary-diagnostic-v1',approvedRows:735,deletedAliasRows:735,verifiedReviews:735,independentExecutionLabel:label};
let browser,t,server;
try {
  server=await serve(receipt);const cert=new X509Certificate(await readFile('/Users/twoimo/.codex/runtime-cache/naver-local-tls-marker-dom-20261014-v1/cert.pem')); assert.ok(Date.now()<Date.parse(cert.validTo)); const spki=createHash('sha256').update(cert.publicKey.export({type:'spki',format:'der'})).digest('base64'); browser=await chromium.launch({channel:'chrome',headless:true,args:['--ignore-certificate-errors-spki-list='+spki]});result.browserVersion=await browser.version();
  t=await pageSetup(browser);
  await t.page.addInitScript(()=>{
    window.__markerRetainerProbe={created:0,setIcon:0,setMap:0,detach:0,reattach:0,foreignRestaurantIcon:0,sameRestaurantIcon:0,clusterOrUnidentifiedIcon:0,sameContentIcon:0,gateCounts:{},rootAttributeDifferences:{},sdkStyleProperties:{}};
    document.addEventListener('load',event=>{
      if(event.target?.tagName!=='SCRIPT'||!event.target.src.includes('oapi.map.naver.com/openapi/v3/maps.js'))return;
      const maps=window.naver?.maps;if(!maps?.Marker)return;
      maps.Marker=new Proxy(maps.Marker,{construct(target,args,newTarget){
        const marker=Reflect.construct(target,args,newTarget),p=window.__markerRetainerProbe;p.created++;
        const icon=marker.setIcon,map=marker.setMap;
        marker.setIcon=function(...args){
          p.setIcon++;
          const before=this.getIcon()?.content,after=args[0]?.content;
          if(before===after)p.sameContentIcon++;
          const id=x=>typeof x==='string'?x.match(/data-restaurant-id="([^"]+)"/)?.[1]:null;
          const a=id(before),b=id(after);
          if(a&&b&&a!==b){
            const g=p.gateCounts,inc=k=>g[k]=(g[k]??0)+1;
            const el=this.getElement(),current=el?.querySelector('[data-testid="marker"]');
            const template=document.createElement('template');template.innerHTML=after;
            const next=template.content.querySelector('[data-testid="marker"]');
            const attribute=' data-restaurant-id="'+a+'"',replacement=' data-restaurant-id="'+b+'"';
            if(before.replace(attribute,replacement)===after)inc('rawIdentityOnly');
            if(current&&next){
              if(current.getAttribute('style')===next.getAttribute('style'))inc('markerStyleEqual');
              const kind=current.closest('[data-restaurant-marker-kind]');
              if(kind?.getAttribute('data-restaurant-marker-kind')==='category')inc('categoryKind');
              const selector='[data-visible-marker-review-bubble-anchor="true"]';
              const root=current.closest(selector)??kind??current;
              const desired=next.closest(selector)??next.closest('[data-restaurant-marker-kind]')??next;
              if(root===el)inc('appRootIsSdkRoot');
              if(current.outerHTML.replace(attribute,replacement)===next.outerHTML)inc('innerMarkerEqualExceptId');
              if(root.outerHTML.replace(attribute,replacement)===desired.outerHTML)inc('fullRootEqualExceptId');
              if(root.innerHTML.replace(attribute,replacement)===desired.innerHTML)inc('rootChildrenEqualExceptId');
              const names=new Set([...root.attributes,...desired.attributes].map(a=>a.name));
              for(const name of names)if(root.getAttribute(name)!==desired.getAttribute(name))p.rootAttributeDifferences[name]=(p.rootAttributeDifferences[name]??0)+1;
              for(const property of root.style) p.sdkStyleProperties[property]=(p.sdkStyleProperties[property]??0)+1;
            }else inc('nodeUnavailable');
          }
          if(a&&b){if(a===b)p.sameRestaurantIcon++;else p.foreignRestaurantIcon++;}
          else p.clusterOrUnidentifiedIcon++;
          return icon.apply(this,args);
        };
        marker.setMap=function(...args){p.setMap++;if(args[0]===null)p.detach++;else p.reattach++;return map.apply(this,args);};
        return marker;
      }});
    },true);
  });
  await t.page.goto(origin+'/?__qa=swipe-cache-20261009',{waitUntil:'domcontentloaded',timeout:30000});
  await t.page.locator('.cluster-marker-container').filter({hasText:'735'}).waitFor({state:'visible',timeout:45000});
  result.sdk=await t.page.evaluate(()=>({loaded:!!window.naver?.maps?.Map,remoteScript:!!document.querySelector('script[src*="oapi.map.naver.com/openapi/v3/maps.js"]'),stub:!!document.querySelector('script[data-local-naver-maps="true"]'),captured:!!window.__swipeCacheUiProbe.mapRef?.deref(),reportedVersion:window.naver?.maps?.VERSION??null}));
  assert.ok(result.sdk.loaded&&result.sdk.remoteScript&&!result.sdk.stub&&result.sdk.captured);
  await t.awaitSdkReceipt();result.sdkScript={...t.sdkScript};result.initialRestaurantRequests=t.requests.restaurant;
  result.initialHeap=await t.cdp.send('Runtime.getHeapUsage');await t.cdp.send('Performance.enable');result.initialResources=(await t.cdp.send('Performance.getMetrics')).metrics.filter(metric=>['Nodes','Documents','JSEventListeners','JSHeapUsedSize'].includes(metric.name));result.initialDomCounters=await t.cdp.send('Memory.getDOMCounters');
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
    const text='회귀 검증 리뷰 '+Number(restaurant.id.slice(-12));
    const review=t.page.getByTestId('restaurant-detail-panel').getByText(text,{exact:true});
    await review.waitFor({state:'visible',timeout:15000});await review.scrollIntoViewIfNeeded();
    await t.page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    row.reviewObservedMs=await t.page.evaluate(()=>performance.now()-window.__swipeCacheUiProbe.lastClick);
    const b=await review.boundingBox();assert.ok(b&&b.x>=-1&&b.y>=-1&&b.x+b.width<=391&&b.y+b.height<=845);
    row.relatedDeletedReviewObserved=true;
    result.cycles.push(row);
    assert.ok(state.panelMatches&&state.selectedMarkerPresent&&state.duplicateMarkers===0&&state.mapCreates===1&&state.visibility==='visible'&&state.overflow===0);
    if(query===0||query===queries-1)await t.page.screenshot({path:new URL(`pass-${pass}-query-${query}.png`,out).pathname});
    if(query%16===15)console.log(JSON.stringify({kind,pass,completedQueries:query+1}));
  }
  result.endHeap=await t.cdp.send('Runtime.getHeapUsage');result.endDomCounters=await t.cdp.send('Memory.getDOMCounters');
  await t.page.evaluate(()=>{window.__swipeCacheUiProbe.on=false;});await t.page.waitForTimeout(5000);result.idleHeap=await t.cdp.send('Runtime.getHeapUsage');result.idleDomCounters=await t.cdp.send('Memory.getDOMCounters');result.idleResources=(await t.cdp.send('Performance.getMetrics')).metrics.filter(metric=>['Nodes','Documents','JSEventListeners','JSHeapUsedSize'].includes(metric.name));
  assert.equal(t.requests.unsupportedFixtureQueries??0,0);
  assert.equal(result.sdkScript.sha256,plan.sdkScriptSha256);
  result.markerCalls=await t.page.evaluate(()=>({...window.__markerRetainerProbe}));
  result.cspRecords=await t.page.evaluate(()=>window.__boundedErrorEvents.filter(row=>row.event==='csp')); 
  result.connectedDocumentNodes=await t.page.evaluate(()=>{const w=document.createTreeWalker(document,NodeFilter.SHOW_ALL);let n=0;while(w.nextNode())n++;return n;});
  result.diagnosticForcedGC=true;
  result.primaryNaturalMemoryGuardReplaced=false;
  await t.cdp.send('HeapProfiler.enable');
  await t.cdp.send('HeapProfiler.collectGarbage');
  result.postForcedGCHeap=await t.cdp.send('Runtime.getHeapUsage');
  result.postForcedGCDomCounters=await t.cdp.send('Memory.getDOMCounters');
  const chunks=[];let snapshotBytes=0;
  const onChunk=event=>{snapshotBytes+=Buffer.byteLength(event.chunk);if(snapshotBytes<=256*1024*1024)chunks.push(event.chunk);};
  t.cdp.on('HeapProfiler.addHeapSnapshotChunk',onChunk);
  await t.cdp.send('HeapProfiler.takeHeapSnapshot',{reportProgress:false,captureNumericValue:false});
  t.cdp.off('HeapProfiler.addHeapSnapshotChunk',onChunk);
  assert.ok(snapshotBytes<=256*1024*1024,'DIAGNOSTIC_SNAPSHOT_BUDGET');
  const graph=JSON.parse(chunks.join(''));chunks.length=0;
  const fields=graph.snapshot.meta.node_fields,types=graph.snapshot.meta.node_types[fields.indexOf('type')];
  const names=['Array','Map','Set','WeakMap','Promise','AbortController','AbortSignal','XMLHttpRequest','HTMLDivElement','HTMLImageElement','HTMLButtonElement'];
  const typeCounts={},knownNameCounts={},detachednessCodes={};let totalSelfBytes=0;
  for(let offset=0;offset<graph.nodes.length;offset+=fields.length){
    const type=types[graph.nodes[offset+fields.indexOf('type')]];
    assert.ok(['hidden','array','string','object','code','closure','regexp','number','native','synthetic','concatenated string','sliced string','symbol','bigint','object shape'].includes(type),'UNSUPPORTED_HEAP_TYPE');
    typeCounts[type]=(typeCounts[type]??0)+1;
    const name=graph.strings[graph.nodes[offset+fields.indexOf('name')]];
    if(names.includes(name))knownNameCounts[name]=(knownNameCounts[name]??0)+1;
    const d=fields.indexOf('detachedness');if(d>=0){const flag=graph.nodes[offset+d];detachednessCodes[String(flag)]=(detachednessCodes[String(flag)]??0)+1;}
    totalSelfBytes+=graph.nodes[offset+fields.indexOf('self_size')];
  }
  result.sanitizedHeapStructure={snapshotBytes,rawSnapshotPersisted:false,rawStringsPersisted:false,
    types:typeCounts,knownNameCounts,detachednessCodes,totalSelfBytes,
    interpretation:'diagnostic structural counts after forced GC; not the natural guard or a retained-path proof'};
  result.passed=true;
}catch(error){result.passed=false;result.failure='bounded_browser_flow_invariant_unavailable';result.boundedFailureType=['AssertionError','TimeoutError','Error'].includes(error?.name)?error.name:'other';}
finally{if(t){result.errors={...t.errors};result.requests={...t.requests};await t.close();}if(browser)await browser.close();if(server)await server.close();}
result.endedAtUtc=new Date().toISOString();await writeFile(new URL('raw.json',out),JSON.stringify(result,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({kind,label,passed:result.passed,cycles:result.cycles.length,sdk:result.sdk??null,errors:result.errors??null}));if(!result.passed)process.exitCode=1;
