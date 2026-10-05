import assert from 'node:assert/strict';
import {chromium} from '@playwright/test';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
const here=new URL('./',import.meta.url),out=new URL('live-quality-production-v1/',here);await mkdir(out);
const delivery=JSON.parse(await readFile(new URL('quality-production-ready-status-v1.json',here)));
assert.equal(delivery.deployment.state,'READY');assert.ok(delivery.independentAlias.matches);
assert.equal(delivery.deployment.gitSha,'b90154e22e6b4ba089275c7ae6d53e7274feae98');
const browser=await chromium.launch({channel:'chrome',headless:true});
const result={sourceSha:delivery.deployment.gitSha,browser:await browser.version(),transport:'real public HTTPS; no SDK/data/asset interception',scope:'anonymous actual WWW flows; emulated viewports, no physical-device or performance claim',fieldAdmitted:0,cases:[],passed:false};
try{
 for(const [name,width,height,mobile] of [['desktop',1440,900,false],['mobile',384,824,true],['tablet',768,1024,true]]){
  const context=await browser.newContext({viewport:{width,height},isMobile:mobile,hasTouch:mobile,locale:'ko-KR',serviceWorkers:'block'}),page=await context.newPage();
  const row={name,viewport:{width,height},checks:[],errors:{page:0,console:0},captures:[],passed:false};let stage='setup';
  page.on('pageerror',()=>row.errors.page++);page.on('console',m=>{if(m.type()==='error')row.errors.console++;});
  await page.addInitScript(()=>document.addEventListener('load',e=>{if(e.target?.tagName!=='SCRIPT'||!e.target.src.includes('oapi.map.naver.com/openapi/v3/maps.js'))return;const maps=window.naver.maps,Original=maps.Map;window.__ownedLiveMapProbe={ref:null,creates:0};maps.Map=new Proxy(Original,{construct(f,args,t){const map=Reflect.construct(f,args,t);window.__ownedLiveMapProbe.ref=new WeakRef(map);window.__ownedLiveMapProbe.creates++;return map;}});},true));
  async function check(name,fn){stage=name;const observed=await fn();assert.notEqual(observed,false);row.checks.push({name,passed:true,observed});}
  async function closeDetail(){for(let i=0;i<6;i++){const panel=page.getByTestId('restaurant-detail-panel').first();if(!await panel.isVisible())return;await page.getByRole('button',{name:/^(이전 목록으로 돌아가기|이전 화면으로 돌아가기|맛집 상세 닫기)$/}).first().click();await page.waitForTimeout(250);}throw Error('bounded detail close');}
  async function closeList(){const b=page.getByRole('button',{name:'맛집 목록 닫기',exact:true});if(await b.isVisible())await b.click();}
  try{
   await page.goto('https://www.tzudong.app/?__qa=memory-release-verification',{waitUntil:'domcontentloaded',timeout:45000});
   await page.waitForFunction(()=>!!window.naver?.maps?.Map&&window.__ownedLiveMapProbe?.ref?.deref()&&document.querySelectorAll('.cluster-marker-container,[data-testid="marker"]').length>0,null,{timeout:60000});
   await check('actual SDK readiness',()=>page.evaluate(()=>({loaded:!!window.naver?.maps?.Map,remote:!!document.querySelector('script[src*="oapi.map.naver.com/openapi/v3/maps.js"]'),stub:!!document.querySelector('script[data-local-naver-maps="true"]')})));
   assert.ok(row.checks.at(-1).observed.loaded&&row.checks.at(-1).observed.remote&&!row.checks.at(-1).observed.stub);
   await check('transparent PNG and filter geometry',()=>page.evaluate(async()=>{
    const asset='/logo-png-129-8d374bb80346.png';const image=Array.from(document.images).find(i=>i.getAttribute('src')===asset&&i.getBoundingClientRect().width>0);await image.decode();
    const c=document.createElement('canvas');c.width=image.naturalWidth;c.height=image.naturalHeight;const x=c.getContext('2d');x.drawImage(image,0,0);
    const alpha=[[0,0],[128,0],[0,128],[128,128],[64,64],[64,51]].map(([a,b])=>x.getImageData(a,b,1,1).data[3]);
    const g=Array.from(document.querySelectorAll('[data-desktop-map-floating-filters="true"],[aria-label="지도 필터 제어"]')).find(e=>e.getBoundingClientRect().width>0),b=g.getBoundingClientRect(),counts=Array.from(g.querySelectorAll('[data-map-filter-count]'),e=>e.getBoundingClientRect().right);
    return {alpha,pngDirect:!image.currentSrc.includes('/_next/image'),width:b.width,height:b.height,countRights:counts,overflow:Math.max(0,document.documentElement.scrollWidth-innerWidth)};
   }));
   const g=row.checks.at(-1).observed;assert.ok(g.alpha.every(x=>x===0)&&g.pngDirect);assert.equal(g.overflow,0);assert.ok(Math.abs(g.height-114)<1);if(!mobile){assert.equal(g.countRights.length,2);assert.ok(Math.abs(g.countRights[0]-g.countRights[1])<=1);}
   await check('cluster expansion',async()=>{
    const candidates=page.locator('.cluster-marker-container');const index=await candidates.evaluateAll(es=>es.reduce((best,e,i)=>{const n=parseInt(e.textContent.replace(/,/g,''),10),b=e.getBoundingClientRect();return b.width>0&&b.x>0&&b.right<innerWidth&&b.y>120&&b.bottom<innerHeight-180&&n>best.n?{i,n}:best;},{i:-1,n:0}).i);
    assert.ok(index>=0);await candidates.nth(index).click();await page.waitForFunction(()=>document.querySelectorAll('[data-testid="marker"]').length>0,null,{timeout:20000});await page.waitForTimeout(700);return {individualMarkers:await page.locator('[data-testid="marker"]').count()};
   });
   await check('marker detail and close',async()=>{
    const id=await page.locator('[data-testid="marker"]').evaluateAll(es=>es.find(e=>{const b=e.getBoundingClientRect(),x=b.x+b.width/2,y=b.y+b.height/2,h=document.elementFromPoint(x,y);return x>(innerWidth>1024?420:30)&&x<innerWidth-90&&y>150&&y<innerHeight-230&&h&&e.contains(h);})?.getAttribute('data-restaurant-id'));
    assert.ok(id);await page.locator('[data-testid="marker"][data-restaurant-id="'+id+'"]').first().click();await page.getByTestId('restaurant-detail-panel').waitFor({state:'visible',timeout:15000});await closeDetail();await closeList();return !await page.getByTestId('restaurant-detail-panel').isVisible();
   });
   await check('empty search and return',async()=>{
    const input=page.getByLabel('맛집 검색어 입력').first();if(!await input.isVisible())await page.getByRole('button',{name:'맛집 검색 열기',exact:true}).click();await input.fill('없는결과검증ZZ9004');await page.getByText('검색 결과가 없습니다.',{exact:true}).waitFor({state:'visible',timeout:15000});await input.fill('');await page.keyboard.press('Escape');await closeList();return true;
   });
   await check('provider pan and return',async()=>{
    const center=await page.evaluate(()=>{const c=window.__ownedLiveMapProbe.ref.deref().getCenter();return {lat:c.lat(),lng:c.lng()};});
    await page.evaluate(()=>window.__ownedLiveMapProbe.ref.deref().setCenter(new window.naver.maps.LatLng(35,129)));await page.waitForTimeout(350);
    await page.evaluate(c=>window.__ownedLiveMapProbe.ref.deref().setCenter(new window.naver.maps.LatLng(c.lat,c.lng)),center);await page.waitForTimeout(1200);
    return page.evaluate(()=>({markers:document.querySelectorAll('[data-testid="marker"],.cluster-marker-container').length,mapCreates:window.__ownedLiveMapProbe.creates}));
   });
   const pan=row.checks.at(-1).observed;assert.ok(pan.markers>0&&pan.mapCreates===1);
   if(mobile){
    await check('ready bottom navigation reservation',async()=>{
     await page.getByTestId('bottom-nav').waitFor({state:'visible',timeout:10000});
     return page.evaluate(()=>{const nav=document.querySelector('[data-testid="bottom-nav"]'),map=document.querySelector('[data-testid="map-container"]');return {navTop:nav.getBoundingClientRect().top,mapBottom:map.getBoundingClientRect().bottom,skeletons:document.querySelectorAll('[data-mobile-bottom-control-skeleton]').length};});
    });
    const n=row.checks.at(-1).observed;assert.equal(n.skeletons,0);assert.ok(n.mapBottom<=n.navTop+1);
    for(let i=0;i<4;i++){const filename=name+'-navigation-'+i+'.png';const box=await page.getByTestId('bottom-nav').boundingBox();assert.ok(box);await page.screenshot({path:new URL(filename,out).pathname,clip:box});row.captures.push(filename);await page.waitForTimeout(150);}
   }
   row.captureLimit='navigation crop only,4 snapshots/~150ms spacing; no private review/profile screenshots, no physical flicker absence claim';row.passed=true;console.log(JSON.stringify({name,passed:true,checks:row.checks.length,errors:row.errors}));
  }catch(e){row.failure=e.name==='TimeoutError'?'bounded_action_readiness_timeout':'bounded_live_invariant_failure';row.stage=stage;console.log(JSON.stringify({name,passed:false,stage}));}
  finally{result.cases.push(row);await context.close();}
 }
 result.passed=result.cases.length===3&&result.cases.every(x=>x.passed);
}finally{await browser.close();await writeFile(new URL('raw.json',out),JSON.stringify(result,null,2)+'\n',{flag:'wx'});}
if(!result.passed)process.exitCode=1;
