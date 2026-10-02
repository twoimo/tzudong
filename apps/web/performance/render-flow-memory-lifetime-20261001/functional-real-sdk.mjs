import {chromium} from '@playwright/test';
import {mkdir,writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {serve,physicalBrowser,pageSetup,ready,usbSerial} from './real-sdk-runtime.mjs';
import {catalog} from './catalog.mjs';
const mode=process.argv[2]||'desktop',physical=mode==='physical'||mode==='samsung',kind=process.argv[3]||'candidate';
const out=new URL(`functional-${mode}-${kind}-${process.env.FLOW_LABEL||'v1'}/`,import.meta.url);await mkdir(out);
if(physical)execFileSync('adb',['-s',usbSerial(),'reverse','tcp:3000','tcp:3000'],{stdio:'ignore'});
const rows=catalog(735),names=rows.map(r=>r.name),result={mode,kind,physical,sdk:'real remote Naver',data:'735 synthetic public rows',checks:[],cycles:[],touch:[],frames:[],filmstrip:[],failures:[],scope:'one driver, two fresh pages; five return trials within each page; no field cohort'};
const server=await serve(kind),browser=physical?await physicalBrowser():await chromium.launch({headless:true});
async function closeDetail(page){
 for(let i=0;i<6;i++){
  const d=page.getByTestId('restaurant-detail-panel').first();if(!await d.count()||!await d.isVisible())return;
  await page.getByRole('button',{name:/^(이전 목록으로 돌아가기|이전 화면으로 돌아가기)$/}).first().click();await page.waitForTimeout(250);
 }
 throw Error('detail remained visible');
}
async function check(name,fn){try{const observed=await fn();if(observed===false)throw Error('invariant false');result.checks.push({name,passed:true,observed});}catch(e){result.failures.push({name,message:'functional_invariant_unavailable'});result.checks.push({name,passed:false});}}
try{for(let pageRun=0;pageRun<2;pageRun++){
 const t=await pageSetup(browser,{physical,count:735,cpu:physical?1:4});const p=t.page;
 try{
  const sdk=await ready(t);result.sdkProof=sdk;result.buildId=server.receipt.buildId;result.inputs=server.receipt.inputs;
  await p.addInitScript(()=>{});
  await p.evaluate(()=>{
   window.__flowTouch=[];const probe=window.__actualSdkProbe;probe.idles=[];window.naver.maps.Event.addListener(probe.mapRef.deref(),'idle',()=>{const c=probe.mapRef.deref().getCenter();probe.idles.push({t:performance.now(),lat:c.lat(),lng:c.lng(),zoom:probe.mapRef.deref().getZoom()});});for(const type of ['touchstart','touchmove','touchend','touchcancel'])document.addEventListener(type,e=>{if(e.target.closest('[data-restaurant-detail-swipe-area]'))window.__flowTouch.push({type,trusted:e.isTrusted,t:performance.now()});},true);
  });
  await p.locator('.cluster-marker-container').filter({hasText:'735'}).click();await p.waitForFunction(()=>window.__actualSdkProbe.first>0);await p.waitForTimeout(600);
  const center=await p.evaluate(()=>{const m=window.__actualSdkProbe.mapRef.deref(),c=m.getCenter();return {lat:c.lat(),lng:c.lng(),zoom:m.getZoom()};});
  const heapStart=await t.cdp.send('Runtime.getHeapUsage');
  let lastFrame=0,frameN=0;const writes=[];
  t.cdp.on('Page.screencastFrame',event=>{
   t.cdp.send('Page.screencastFrameAck',{sessionId:event.sessionId}).catch(()=>{});
   const time=event.metadata.timestamp;if(!time||time-lastFrame<.18||frameN>=180)return;lastFrame=time;
   const path=`page-${pageRun}-frame-${String(frameN++).padStart(3,'0')}.jpg`;
   result.filmstrip.push({path,timestamp:time,pageRun,metadata:{pageScaleFactor:event.metadata.pageScaleFactor,deviceWidth:event.metadata.deviceWidth,deviceHeight:event.metadata.deviceHeight}});
   writes.push(writeFile(new URL(path,out),Buffer.from(event.data,'base64'),{flag:'wx'}));
  });
  await t.cdp.send('Page.startScreencast',{format:'jpeg',quality:65,maxWidth:900,maxHeight:900,everyNthFrame:1});
  for(let cycle=0;cycle<5;cycle++){
   const start=await p.evaluate(()=>performance.now());
   // Native provider API fixture setup. Gestures are tested separately below.
   await p.evaluate(()=>{const m=window.__actualSdkProbe.mapRef.deref();m.setCenter(new window.naver.maps.LatLng(35,129));});await p.waitForTimeout(350);
   const returnedAt=await p.evaluate(c=>{const returnedAt=performance.now(),m=window.__actualSdkProbe.mapRef.deref();m.setCenter(new window.naver.maps.LatLng(c.lat,c.lng));m.setZoom(c.zoom);return returnedAt;},center);
   let settled=true;try{await p.waitForFunction(()=>document.querySelectorAll('[data-testid="marker"]').length>0,null,{timeout:12000});}catch{settled=false;}
   await p.waitForTimeout(1000);
   const observation=await p.evaluate(({start,rows,returnedAt})=>{
    const q=window.__actualSdkProbe,m=q.mapRef.deref(),b=m.getBounds(),sw=b.getSW(),ne=b.getNE(),dy=(ne.lat()-sw.lat())*.25,dx=(ne.lng()-sw.lng())*.25;
    const expected=rows.filter(r=>r.lat>=sw.lat()-dy&&r.lat<=ne.lat()+dy&&r.lng>=sw.lng()-dx&&r.lng<=ne.lng()+dx).map(r=>r.id);
    const ids=Array.from(document.querySelectorAll('[data-testid="marker"][data-restaurant-id]')).map(e=>e.dataset.restaurantId);
    return {start,returnedAt,idles:q.idles.filter(i=>i.t>=returnedAt),end:performance.now(),timeOrigin:performance.timeOrigin,expectedIds:expected,actualIds:ids,frames:q.frames.filter(f=>f.t>=start),mapCreates:q.sdkMapCreates,zoom:m.getZoom(),overflow:Math.max(0,document.documentElement.scrollWidth-innerWidth)};
   },{start,rows,returnedAt});
   const ok=settled&&observation.expectedIds.every(id=>observation.actualIds.includes(id))&&new Set(observation.actualIds).size===observation.actualIds.length&&observation.mapCreates===1&&observation.overflow===0;
   result.cycles.push({pageRun,cycle,settled,ok,...observation});if(!ok)result.failures.push({name:`return-${pageRun}-${cycle}`,message:'missing/duplicate markers, map recreation or overflow'});
  }
  await t.cdp.send('Page.stopScreencast');await Promise.all(writes);
  const heapEnd=await t.cdp.send('Runtime.getHeapUsage');result.cyclesHeap??=[];result.cyclesHeap.push({pageRun,before:heapStart,after:heapEnd,growth:heapEnd.usedSize-heapStart.usedSize});
  if(mode==='samsung'){
   const point=await p.evaluate(()=>{for(let y=130;y<350;y+=35)for(let x=90;x<innerWidth-80;x+=35){const e=document.elementFromPoint(x,y);if(e?.closest('[data-testid="map-container"]')&&!e.closest('button,[role="button"],[data-testid="marker"],input'))return {x,y};}return null;});
   await check(`native-map-pan-${pageRun}`,async()=>{
    if(!point)throw Error('no unobstructed native map touch point');
    const before=await p.evaluate(()=>{const c=window.__actualSdkProbe.mapRef.deref().getCenter();return {lat:c.lat(),lng:c.lng()};});
    await t.cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[point]});
    for(let i=1;i<=7;i++){await t.cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:point.x+60*i/7,y:point.y+50*i/7}]});await p.waitForTimeout(16);}
    await t.cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await p.waitForTimeout(700);
    const after=await p.evaluate(()=>{const c=window.__actualSdkProbe.mapRef.deref().getCenter();return {lat:c.lat(),lng:c.lng()};});
    const changed=Math.abs(after.lat-before.lat)+Math.abs(after.lng-before.lng)>1e-5;
    await p.evaluate(c=>window.__actualSdkProbe.mapRef.deref().setCenter(new window.naver.maps.LatLng(c.lat,c.lng)),center);await p.waitForTimeout(350);return changed;
   });
   await check(`native-map-pinch-${pageRun}`,async()=>{
    if(!point)throw Error('no native map touch point');const z=await p.evaluate(()=>window.__actualSdkProbe.mapRef.deref().getZoom());
    const points=d=>[{id:1,x:point.x,y:point.y-d},{id:2,x:point.x,y:point.y+d}];
    await t.cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:points(25)});
    for(let i=1;i<=7;i++){await t.cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:points(25+40*i/7)});await p.waitForTimeout(24);}
    await t.cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await p.waitForTimeout(800);
    const after=await p.evaluate(()=>window.__actualSdkProbe.mapRef.deref().getZoom());await p.evaluate(c=>{const m=window.__actualSdkProbe.mapRef.deref();m.setZoom(c.zoom);m.setCenter(new window.naver.maps.LatLng(c.lat,c.lng));},center);await p.waitForTimeout(400);return after>z;
   });
  }
  await check(`list-${pageRun}`,async()=>{
   const badge=p.getByLabel('맛집 목록 735곳').first();if(physical){await badge.waitFor({state:'visible'});const sheet=p.locator('[data-mobile-visible-marker-restaurants-sheet="true"]');if(!await sheet.isVisible())await p.getByRole('button',{name:/맛집 목록/}).first().click();await sheet.waitFor({state:'visible'});const cards=sheet.getByRole('button').filter({hasText:/실험맛집\d{4}/});const n=await cards.count();await cards.first().click();await p.getByTestId('restaurant-detail-panel').waitFor({state:'visible'});return n===20;}
   const id=await p.locator('[data-testid="marker"][data-restaurant-id]').evaluateAll(es=>es.find(e=>{const r=e.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2,h=document.elementFromPoint(x,y);return x>450&&y>100&&y<innerHeight-100&&h&&e.contains(h);})?.getAttribute('data-restaurant-id'));
   if(!id)throw Error('no hit-tested marker');await p.locator(`[data-restaurant-id="${id}"]`).first().click();await p.getByTestId('restaurant-detail-panel').waitFor({state:'visible'});return {selectedMarker:id};
  });
  if(physical)for(let swipe=0;swipe<5;swipe++)await check(`touch-${pageRun}-${swipe}`,async()=>{
   const selector='[data-restaurant-detail-swipe-area="content"]';await p.locator(selector).waitFor({state:'visible'});
   const before=await p.evaluate(ns=>ns.find(n=>document.querySelector('[data-testid="restaurant-detail-panel"]')?.textContent.includes(n)),names);
   const r=await p.locator(selector).boundingBox();if(!r)throw Error('no touch surface');const sx=r.x+r.width*.8,ex=r.x+r.width*.2,y=Math.min(r.y+r.height*.5,700);
   await t.cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:sx,y}],modifiers:0});
   for(let i=1;i<=7;i++){await t.cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:sx+(ex-sx)*i/7,y}],modifiers:0});await p.waitForTimeout(16);}
   await t.cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[],modifiers:0});
   await p.waitForFunction(({ns,before})=>{const text=document.querySelector('[data-testid="restaurant-detail-panel"]')?.textContent;return ns.some(n=>n!==before&&text?.includes(n));},{ns:names,before},{timeout:8000});
   const events=await p.evaluate(()=>window.__flowTouch.splice(0));result.touch.push({pageRun,swipe,events});return events.length>=3&&events.every(e=>e.trusted)&&events.at(-1).type==='touchend';
  });
  await check(`detail-close-${pageRun}`,async()=>{await closeDetail(p);return await p.getByTestId('restaurant-detail-panel').count()===0;});
  const sheetClose=p.getByLabel('맛집 목록 닫기').first();if(await sheetClose.count()&&await sheetClose.isVisible())await sheetClose.click();
  await check(`filter-${pageRun}`,async()=>{
   await (physical?p.getByLabel(/카테고리 필터 열기/):p.getByLabel('카테고리 필터')).first().click();await p.getByRole(physical?'button':'option',{name:/중식/}).first().click();
   await p.waitForFunction(()=>document.querySelectorAll('[data-testid="marker"],.cluster-marker-container').length===0,null,{timeout:8000});
   await p.getByRole('button',{name:/초기화/}).first().click();await p.waitForFunction(()=>document.querySelectorAll('[data-testid="marker"],.cluster-marker-container').length>0,null,{timeout:8000});await p.keyboard.press('Escape');return true;
  });
  await check(`search-empty-${pageRun}`,async()=>{
   let input=p.getByLabel('맛집 검색어 입력').first();if(!await input.count()||!await input.isVisible())await p.getByLabel('맛집 검색 열기').first().click();await input.fill('없는결과999');await p.getByText('검색 결과가 없습니다.',{exact:true}).waitFor({state:'visible',timeout:8000});return true;
  });
  await check(`search-select-${pageRun}`,async()=>{
   const input=p.getByLabel('맛집 검색어 입력').first();await input.fill(names[5]);const button=p.locator('button.w-full.text-left.p-3.border-b').filter({hasText:names[5]}).first();await button.waitFor({state:'visible',timeout:8000});await button.click();await p.getByTestId('restaurant-detail-panel').waitFor({state:'visible'});const valid=(await p.getByTestId('restaurant-detail-panel').textContent()).includes(names[5]);await closeDetail(p);return valid;
  });
  await p.screenshot({path:new URL(`page-${pageRun}-final.png`,out).pathname});result.errors??=[];result.errors.push(t.errors);
 }finally{await t.close();}
}}finally{await browser.close();await server.close();}
result.passed=result.failures.length===0;await writeFile(new URL('raw.json',out),JSON.stringify(result,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({passed:result.passed,checks:result.checks.length,returnTrials:result.cycles.length,swipes:result.touch.length,failures:result.failures}));if(!result.passed)process.exitCode=1;
