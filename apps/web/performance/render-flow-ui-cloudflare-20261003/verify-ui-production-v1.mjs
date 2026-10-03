import {chromium} from '@playwright/test';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const here=new URL('./',import.meta.url),out=new URL('live-ui-production-v1/',here);await mkdir(out);
const receipt=JSON.parse(await readFile(new URL('ui-production-ready-status-20261004-v1.json',here)));
assert.equal(receipt.deployment.state,'READY');assert.equal(receipt.independentAlias.matches,true);
assert.equal(receipt.deployment.gitSha,'3aebb1c6f446250fd49fceac5f1a4ccac2f5d8f0');
const origin='https://www.tzudong.app',asset='/logo-png-129-8d374bb80346.png';
const browser=await chromium.launch({channel:'chrome',headless:true});
const result={observedAt:new Date().toISOString(),productionReceipt:'ui-production-ready-status-20261004-v1.json',sourceSha:receipt.deployment.gitSha,browser:await browser.version(),transport:'actual public HTTPS; remote SDK, data and images unmodified',physicalDevice:false,fieldAdmitted:0,cases:[],http:[],passed:false};
try{
 const response=await fetch(origin+asset,{redirect:'manual'}),body=Buffer.from(await response.arrayBuffer());
 const sha=createHash('sha256').update(body).digest('hex');
 result.http.push({resource:'public PNG',status:response.status,bytes:body.length,contentType:response.headers.get('content-type'),cacheControl:response.headers.get('cache-control'),sha256:sha});
 assert.equal(response.status,200);assert.equal(body.length,24213);assert.equal(sha,'8d374bb803469959cb37a2f6193f177d063265d077f717de0dc6dcc64bc3a646');
 assert.ok(response.headers.get('content-type')?.includes('image/png'));assert.ok(response.headers.get('cache-control')?.includes('immutable'));
 const font=await fetch(origin+'/fonts/ChosunCentennial_otf.otf',{redirect:'manual'});
 const destination='https://assets.tzudong.app/sha256-8c2eeb55898708b108032eb0baddabfbf7c98a78c3411a2f2601c7bdeff1cfb7--ChosunCentennial_otf.otf';
 result.http.push({resource:'legacy font route',status:font.status,location:font.headers.get('location'),cacheControl:font.headers.get('cache-control'),bodyBytes:(await font.arrayBuffer()).byteLength});
 assert.equal(font.status,307);assert.equal(font.headers.get('location'),destination);assert.ok(font.headers.get('cache-control')?.includes('no-store'));
 for(const [name,width,height,mobile] of [['desktop',1440,900,false],['mobile',384,824,true],['tablet',768,1024,true],['landscape',1024,768,true]])for(const theme of ['light','dark']){
  const context=await browser.newContext({viewport:{width,height},isMobile:mobile,hasTouch:mobile,locale:'ko-KR',serviceWorkers:'block'}),page=await context.newPage();
  const row={name,theme,viewport:{width,height},emulatedMobile:mobile,manualCssDarkNotDeviceForced:true,errors:{page:0,console:0},passed:false};
  page.on('pageerror',()=>row.errors.page++);page.on('console',m=>{if(m.type()==='error')row.errors.console++;});
  try{
   await page.goto(origin+'/?__qa=transparent-png-release',{waitUntil:'domcontentloaded',timeout:45000});
   await page.waitForFunction(()=>!!window.naver?.maps?.Map&&document.querySelectorAll('.cluster-marker-container,[data-testid="marker"]').length>0,null,{timeout:60000});
   const logo=page.locator('img[src="'+asset+'"]').first();await logo.waitFor({state:'visible'});
   await page.waitForFunction(path=>Array.from(document.querySelectorAll('img')).some(i=>i.getAttribute('src')===path&&i.complete&&i.naturalWidth===129),asset);
   await page.evaluate(t=>document.documentElement.classList.toggle('dark',t==='dark'),theme);
   row.geometry=await page.evaluate(path=>{
    const groups=Array.from(document.querySelectorAll('[data-desktop-map-floating-filters="true"],[aria-label="지도 필터 제어"]')),group=groups.find(g=>g.getBoundingClientRect().width>0);
    if(!group)throw Error('missing group');
    const box=group.getBoundingClientRect(),buttons=Array.from(group.querySelectorAll('button')).map(b=>({width:b.getBoundingClientRect().width,height:b.getBoundingClientRect().height}));
    const counts=Array.from(group.querySelectorAll('[data-map-filter-count]')).map(c=>({right:c.getBoundingClientRect().right}));
    const image=Array.from(document.querySelectorAll('img')).find(i=>i.getAttribute('src')===path&&i.getBoundingClientRect().width>0),canvas=document.createElement('canvas');canvas.width=image.naturalWidth;canvas.height=image.naturalHeight;const c=canvas.getContext('2d');c.drawImage(image,0,0);
    const alpha=[[0,0],[128,0],[0,128],[128,128],[64,64],[64,51]].map(([x,y])=>c.getImageData(x,y,1,1).data[3]);
    const nav=document.querySelector('nav[aria-label="하단 탐색 메뉴"]')||document.querySelector('[data-mobile-bottom-nav="true"]'),map=document.querySelector('[data-testid="map-container"]');
    return {rootDark:document.documentElement.classList.contains('dark'),bodyBackground:getComputedStyle(document.body).backgroundColor,filter:{width:box.width,height:box.height,buttons,counts},logo:{naturalWidth:image.naturalWidth,alpha,background:getComputedStyle(image).backgroundColor,originalPngPath:image.getAttribute('src')===path,optimizerBypassed:!image.currentSrc.includes('/_next/image')},sdk:{remoteScript:!!document.querySelector('script[src*="oapi.map.naver.com/openapi/v3/maps.js"]'),loaded:!!window.naver?.maps?.Map,stub:!!document.querySelector('script[data-local-naver-maps="true"]')},overflow:Math.max(0,document.documentElement.scrollWidth-innerWidth),navTop:nav?.getBoundingClientRect().top??null,mapBottom:map?.getBoundingClientRect().bottom??null,staleReadySkeletons:document.querySelectorAll('[data-mobile-bottom-control-skeleton]').length};
   },asset);
   const g=row.geometry;assert.equal(g.rootDark,theme==='dark');assert.ok(g.logo.alpha.every(a=>a===0));assert.ok(g.logo.originalPngPath&&g.logo.optimizerBypassed);assert.equal(g.overflow,0);assert.ok(g.sdk.loaded&&g.sdk.remoteScript&&!g.sdk.stub);assert.ok(g.filter.buttons.every(b=>b.height>=24&&b.height<=32.1));
   assert.ok(Math.abs(g.filter.height-114)<1);
   if(!mobile){assert.ok(Math.abs(g.filter.width-152)<1);assert.equal(g.filter.counts.length,2);assert.ok(Math.abs(g.filter.counts[0].right-g.filter.counts[1].right)<=1);}
   else assert.ok(g.filter.width>=110&&g.filter.width<=128.1);
   if(name==='desktop'&&theme==='light'){
    row.liveFont=await page.evaluate(async url=>{const face=new FontFace('TzudongPublicFontReleaseProbe',`url("${url}")`);await face.load();document.fonts.add(face);const loaded=document.fonts.check('16px TzudongPublicFontReleaseProbe');document.fonts.delete(face);return {status:face.status,documentFontsCheck:loaded,realAssetOrigin:new URL(url).origin,usedProductFontChanged:false};},destination);
    assert.equal(row.liveFont.status,'loaded');assert.equal(row.liveFont.documentFontsCheck,true);
   }
   // Capture only the anonymous search logo/placeholder, excluding review,
   // presence/profile content and other page areas from saved pixels.
   const box=await logo.boundingBox();assert.ok(box);
   const clip={x:Math.max(0,box.x-6),y:Math.max(0,box.y-6),width:Math.min(210,width-Math.max(0,box.x-6)),height:Math.min(52,height-Math.max(0,box.y-6))};
   row.screenshot=`${name}-${theme}-logo.png`;await page.screenshot({path:new URL(row.screenshot,out).pathname,clip});
   row.passed=true;console.log(JSON.stringify({name,theme,passed:true,alpha:g.logo.alpha,filterWidth:g.filter.width}));
  }catch{row.failure='bounded_live_ui_invariant_unavailable';}
  finally {result.cases.push(row);await context.close();}
 }
 result.passed=result.cases.length===8&&result.cases.every(r=>r.passed);
}catch{result.failure='bounded_live_delivery_invariant_unavailable';}
finally{await browser.close();await writeFile(new URL('raw.json',out),JSON.stringify(result,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({passed:result.passed,cases:result.cases.length}));}
if(!result.passed)process.exitCode=1;
