import assert from 'node:assert/strict';
import {chromium} from '@playwright/test';
import {mkdir,writeFile} from 'node:fs/promises';
import {serve,pageSetup,origin} from './real-sdk-runtime-retain-v2.mjs';
import {catalog} from './catalog.mjs';
const here=new URL('./',import.meta.url),label=process.argv[2];assert.match(label,/^[a-z0-9-]+$/);
const out=new URL(`marker-accessibility-${label}/`,here);await mkdir(out);
process.env.SDK_BASELINE_BUILD_LABEL='control-ui-v2';process.env.SDK_CANDIDATE_BUILD_LABEL='ret-ui-v2';
const result={scope:'owned mobile-emulation page, actual SDK, synthetic735; no full AX/DOM/provider strings stored',checks:[],fieldAdmitted:0,performanceAdmitted:0};
for(const kind of ['baseline','candidate']){
 const server=await serve(kind);let browser,t;
 const row={kind,buildId:server.receipt.buildId,passed:false};
 try{
  browser=await chromium.launch({channel:'chrome',headless:true});t=await pageSetup(browser,{mobile:true,count:735,cpu:4,captureFrames:false});
  await t.page.goto(origin+'/?__qa=retained-marker-a11y',{waitUntil:'domcontentloaded'});
  const cluster=t.page.locator('.cluster-marker-container').filter({hasText:'735'});await cluster.waitFor({state:'visible',timeout:45000});await t.page.waitForTimeout(1000);await cluster.click();await t.page.waitForFunction(()=>window.__actualSdkProbe.first>0);await t.page.waitForTimeout(1000);
  row.geometry=await t.page.evaluate(rows=>{
   const m=window.__actualSdkProbe.mapRef.deref(),bounds=m.getBounds(),sw=bounds.getSW(),ne=bounds.getNE(),dy=(ne.lat()-sw.lat())*.25,dx=(ne.lng()-sw.lng())*.25;
   const padded=new Set(rows.filter(r=>r.lat>=sw.lat()-dy&&r.lat<=ne.lat()+dy&&r.lng>=sw.lng()-dx&&r.lng<=ne.lng()+dx).map(r=>r.id));
   const markers=Array.from(document.querySelectorAll('[data-testid="marker"][data-restaurant-id]')).map(e=>{const b=e.getBoundingClientRect();let hidden=false,parent=e;for(let i=0;i<12&&parent;i++,parent=parent.parentElement){const s=getComputedStyle(parent);if(s.display==='none'||s.visibility==='hidden'||parent.getAttribute('aria-hidden')==='true')hidden=true;}return {id:e.dataset.restaurantId,padded:padded.has(e.dataset.restaurantId),hidden,tabIndex:e.tabIndex,onScreen:b.width>0&&b.height>0&&b.bottom>0&&b.top<innerHeight&&b.right>0&&b.left<innerWidth};});
   return {markers:markers.length,paddedExpected:padded.size,outsidePadded:markers.filter(r=>!r.padded).length,hiddenOutsidePadded:markers.filter(r=>!r.padded&&r.hidden).length,tabbableOutsidePadded:markers.filter(r=>!r.padded&&r.tabIndex>=0&&!r.hidden).length,ids:markers.map(r=>({id:r.id,padded:r.padded}))};
  },catalog(735));
  await t.cdp.send('DOM.enable');await t.cdp.send('Accessibility.enable');
  const flat=await t.cdp.send('DOM.getFlattenedDocument',{depth:-1,pierce:false}),ax=await t.cdp.send('Accessibility.getFullAXTree');
  const byBackend=new Map();
  for(const n of flat.nodes){const attrs=n.attributes??[];const at=attrs.indexOf('data-testid');if(at<0||attrs[at+1]!=='marker')continue;const idAt=attrs.indexOf('data-restaurant-id');if(idAt>=0)byBackend.set(n.backendNodeId,attrs[idAt+1]);}
  const paddedById=new Map(row.geometry.ids.map(x=>[x.id,x.padded]));
  const exposed=ax.nodes.filter(n=>byBackend.has(n.backendDOMNodeId)&&!n.ignored);
  row.accessibility={matchedMarkerBackendNodes:byBackend.size,exposedMarkerNodes:exposed.length,exposedOutsidePadded:exposed.filter(n=>!paddedById.get(byBackend.get(n.backendDOMNodeId))).length,ignoredMarkerNodes:ax.nodes.filter(n=>byBackend.has(n.backendDOMNodeId)&&n.ignored).length,rawAxOrDomRetained:false};
  delete row.geometry.ids;
  row.queryClientFixtureAvailable=await t.page.evaluate(()=>{
   const el=document.querySelector('[data-testid="map-container"]'),key=el&&Object.keys(el).find(k=>k.startsWith('__reactFiber$'));let fiber=key?el[key]:null;
   for(let i=0;i<300&&fiber;i++,fiber=fiber.return){const props=fiber.memoizedProps;for(const client of [props?.client,props?.value])if(client&&typeof client.getQueryCache==='function'&&typeof client.setQueryData==='function'){window.__ownedQueryFixture=client;return true;}}
   return false;
  });
  row.passed=true;row.errors=t.errors;
 }catch{row.failure='bounded_accessibility_inspection_unavailable';}
 finally {if(t)await t.close();if(browser)await browser.close();await server.close();result.checks.push(row);console.log(JSON.stringify(row));}
}
await writeFile(new URL('raw.json',out),JSON.stringify(result,null,2)+'\n',{flag:'wx'});
if(!result.checks.every(r=>r.passed))process.exitCode=1;
