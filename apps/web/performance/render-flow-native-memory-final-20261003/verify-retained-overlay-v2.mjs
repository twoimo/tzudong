import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {chromium} from '@playwright/test';
import {serve,pageSetup,origin} from './real-sdk-runtime-retain-v2.mjs';
import {catalog} from './catalog.mjs';

const here=new URL('./',import.meta.url),out=new URL('retained-overlay-v2/',here);
await mkdir(out);
process.env.SDK_CANDIDATE_BUILD_LABEL='ret-overlay-v1';
const sourceApp='/Users/twoimo/.codex/worktrees/marker-memory-release-20261002/tzudong/apps/web';
const bubbleSource=await readFile(sourceApp+'/lib/visible-marker-review-bubbles.ts');
const bubble=JSON.parse(execFileSync('/Users/twoimo/.bun/bin/bun',['--eval',
 `import {buildVisibleMarkerReviewBubbleHtml as html} from './lib/visible-marker-review-bubbles.ts'; console.log(JSON.stringify(html({restaurantId:'synthetic',reviewId:'synthetic',userName:'AX0000',content:'합성 리뷰',photoUrl:null},{isMobile:true})));`
],{cwd:sourceApp,encoding:'utf8'}));
const server=await serve('candidate');let browser,t;
const result={buildId:server.receipt.buildId,inputs:server.receipt.inputs,
 scope:'actual Naver SDK with owned constructor/setIcon fixture using the production review HTML generator and sibling anchor shape; synthetic735; no physical-device, field or timing admission',
 bubbleGeneratorSha256:createHash('sha256').update(bubbleSource).digest('hex'),fieldAdmitted:0,performanceAdmitted:0,cases:[],passed:false};
try{
 browser=await chromium.launch({channel:'chrome',headless:true});
 t=await pageSetup(browser,{mobile:true,count:735,cpu:4,captureFrames:false});
 await t.page.addInitScript(({bubble})=>{
  window.__overlayFixture={constructed:0,setIcon:0};
  const wrap=icon=>{
   if(typeof icon?.content!=='string'||!icon.content.includes('data-testid="marker"'))return icon;
   const id=icon.content.match(/data-restaurant-id="([^"]+)"/)?.[1];
   if(!id)return icon;
   const label='AX'+String(Number(id.slice(-12))).padStart(4,'0');
   return {...icon,content:`<div data-visible-marker-review-bubble-anchor="true" style="position:relative;width:28px;height:28px;">${bubble.replaceAll('AX0000',label)}${icon.content}</div>`};
  };
  document.addEventListener('load',event=>{
   if(event.target?.tagName!=='SCRIPT'||!event.target.src.includes('oapi.map.naver.com/openapi/v3/maps.js'))return;
   const maps=window.naver.maps,Original=maps.Marker;
   maps.Marker=new Proxy(Original,{construct(fn,args,target){
    const opts=args[0],marker=Reflect.construct(fn,[{...opts,icon:wrap(opts.icon)}],target);
    if(typeof opts.icon?.content==='string'&&opts.icon.content.includes('data-testid="marker"')){
     window.__overlayFixture.constructed++;
    }
    const setIcon=marker.setIcon.bind(marker);
    marker.setIcon=icon=>{window.__overlayFixture.setIcon++;return setIcon(wrap(icon));};
    return marker;
   }});
  },true);
 },{bubble});
 await t.page.goto(origin+'/?__qa=retained-overlay',{waitUntil:'domcontentloaded'});
 const cluster=t.page.locator('.cluster-marker-container').filter({hasText:'735'});
 await cluster.waitFor({state:'visible',timeout:45000});await t.page.waitForTimeout(1000);await cluster.click();
 await t.page.waitForFunction(()=>window.__actualSdkProbe.first>0);await t.page.waitForTimeout(1000);
 const center=await t.page.evaluate(()=>{const c=window.__actualSdkProbe.mapRef.deref().getCenter();return {lat:c.lat(),lng:c.lng()};});
 async function inspect(name,mobile){
  const geometry=await t.page.evaluate(({rows,mobile})=>{
   const q=window.__actualSdkProbe,m=q.mapRef.deref(),b=m.getBounds(),sw=b.getSW(),ne=b.getNE(),dy=(ne.lat()-sw.lat())*.25,dx=(ne.lng()-sw.lng())*.25;
   const padded=new Set(rows.filter(r=>r.lat>=sw.lat()-dy&&r.lat<=ne.lat()+dy&&r.lng>=sw.lng()-dx&&r.lng<=ne.lng()+dx).map(r=>r.id));
   const els=Array.from(document.querySelectorAll('[data-testid="marker"][data-restaurant-id]'));
   const ids=els.map(e=>e.dataset.restaurantId),set=new Set(ids);
   let unmaskedOutside=0,maskedInside=0,missingAnchors=0,bubbleSiblings=0,directMarkerMasks=0;
   const expectedLabels=[];
   for(const e of els){const id=e.dataset.restaurantId,a=e.closest('[data-visible-marker-review-bubble-anchor="true"]'),bubble=a?.querySelector('[data-visible-marker-review-bubble="true"]');
    if(!a)missingAnchors++;if(bubble&&bubble.parentElement===a&&!e.contains(bubble))bubbleSiblings++;
    const hidden=a?.getAttribute('aria-hidden')==='true';
    if(!padded.has(id)&&!hidden)unmaskedOutside++;if(padded.has(id)&&hidden)maskedInside++;
    if(e.getAttribute('aria-hidden')==='true')directMarkerMasks++;
    if(!mobile||padded.has(id))expectedLabels.push('AX'+String(Number(id.slice(-12))).padStart(4,'0')+'님의 최근 리뷰 보기');
   }
   return {markers:ids.length,duplicates:ids.length-set.size,padded:padded.size,missingPadded:[...padded].filter(id=>!set.has(id)).length,missingAnchors,bubbleSiblings,unmaskedOutside,maskedInside,directMarkerMasks,expectedLabels,mapCreates:q.sdkMapCreates,overflow:Math.max(0,document.documentElement.scrollWidth-innerWidth)};
  },{rows:catalog(735),mobile});
  const ax=await t.cdp.send('Accessibility.getFullAXTree');
  const exposed=new Set(ax.nodes.filter(n=>!n.ignored&&n.role?.value==='button'&&/^AX\d{4}님의 최근 리뷰 보기$/.test(n.name?.value??'')).map(n=>n.name.value));
  const expected=new Set(geometry.expectedLabels);delete geometry.expectedLabels;
  const accessibility={expectedBubbles:expected.size,exposedBubbles:exposed.size,extraBubbles:[...exposed].filter(x=>!expected.has(x)).length,missingBubbles:[...expected].filter(x=>!exposed.has(x)).length,rawTreeStored:false};
  const passed=geometry.markers===735&&geometry.duplicates===0&&geometry.missingPadded===0&&geometry.missingAnchors===0&&geometry.bubbleSiblings===735&&geometry.directMarkerMasks===0&&geometry.mapCreates===1&&geometry.overflow===0&&geometry.maskedInside===0&&(!mobile||geometry.unmaskedOutside===0)&&accessibility.extraBubbles===0&&accessibility.missingBubbles===0;
  result.cases.push({name,mobile,geometry,accessibility,passed});console.log(JSON.stringify({name,passed,geometry,accessibility}));assert.ok(passed);
 }
 await inspect('initial mobile',true);
 await t.page.screenshot({path:new URL('synthetic-mobile.png',out).pathname});
 for(let cycle=0;cycle<3;cycle++){
  await t.page.evaluate(()=>window.__actualSdkProbe.mapRef.deref().setCenter(new window.naver.maps.LatLng(35,129)));await t.page.waitForTimeout(450);
  await inspect('away '+cycle,true);
  await t.page.evaluate(c=>window.__actualSdkProbe.mapRef.deref().setCenter(new window.naver.maps.LatLng(c.lat,c.lng)),center);await t.page.waitForTimeout(1000);
  await inspect('return '+cycle,true);
 }
 // Public cache update is fixture setup only; no hosted writes or provider payloads.
 assert.ok(await t.page.evaluate(()=>{const el=document.querySelector('[data-testid="map-container"]'),key=Object.keys(el).find(k=>k.startsWith('__reactFiber$'));for(let f=el[key],i=0;f&&i<300;f=f.return,i++)for(const c of [f.memoizedProps?.client,f.memoizedProps?.value])if(c&&typeof c.getQueryCache==='function'&&typeof c.setQueryData==='function'){window.__ownedQueryFixture=c;return true;}return false;}));
 const before=await t.page.evaluate(()=>window.__overlayFixture.setIcon);
 await t.page.evaluate(()=>{const c=window.__ownedQueryFixture;for(const q of c.getQueryCache().getAll())if(Array.isArray(q.state.data)&&q.state.data.some(r=>r?.id))c.setQueryData(q.queryKey,prev=>prev.map(r=>({...r,mergedYoutubeLinks:['https://youtu.be/fixtureone','https://youtu.be/fixturetwo','https://youtu.be/fixturetri']})));});
 await t.page.waitForFunction(before=>window.__overlayFixture.setIcon>before,before);await t.page.waitForTimeout(1000);
 await inspect('icon replacement',true);
 await t.page.setViewportSize({width:1440,height:900});await t.page.waitForTimeout(1000);await inspect('desktop restoration',false);
 await t.page.setViewportSize({width:390,height:844});await t.page.waitForTimeout(1000);await inspect('mobile restoration',true);
 result.fixture=await t.page.evaluate(()=>window.__overlayFixture);result.errors=t.errors;result.passed=result.cases.every(c=>c.passed);
}catch(e){result.failure=e.name==='TimeoutError'?'bounded_readiness_timeout':'bounded_overlay_invariant_failure';}
finally{if(t)await t.close();if(browser)await browser.close();await server.close();await writeFile(new URL('raw.json',out),JSON.stringify(result,null,2)+'\n',{flag:'wx'});}
if(!result.passed)process.exitCode=1;
