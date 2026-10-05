import {spawn,execFileSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {chromium} from '@playwright/test';
import {catalog} from './catalog.mjs';
export const origin='http://localhost:3000';
const here=new URL('./',import.meta.url),app=new URL('../../',here);
export async function serve(kind){
 let occupied=false;try{occupied=!!execFileSync('lsof',['-tiTCP:3000','-sTCP:LISTEN'],{encoding:'utf8',stdio:['ignore','pipe','ignore']}).trim();}catch{}if(occupied)throw Error('test port3000 already occupied; existing server is never reused');
 const receipt=JSON.parse(await readFile(new URL(`build-${kind}-${(kind==='candidate'?process.env.SDK_CANDIDATE_BUILD_LABEL:process.env.SDK_BASELINE_BUILD_LABEL)||process.env.SDK_BUILD_LABEL||'v2'}/receipt.json`,here)));
 const server=spawn('/opt/homebrew/opt/node@24/bin/node',[fileURLToPath(new URL(`${receipt.distDir}/standalone/apps/web/server.js`,app))],{cwd:fileURLToPath(app),env:{PATH:process.env.PATH,HOME:process.env.HOME,NODE_ENV:'production',HOSTNAME:'127.0.0.1',PORT:'3000'},stdio:'ignore'});
 for(let i=0;i<150;i++){if(server.exitCode!==null)throw Error('server stopped');try{if((await fetch(origin)).ok)return {receipt,close:async()=>{if(server.exitCode!==null)return;const done=new Promise(r=>server.once('exit',r));server.kill('SIGTERM');await done;}};}catch{}await new Promise(r=>setTimeout(r,100));}
 server.kill('SIGTERM');throw Error('server unavailable');
}
export function usbSerial(){
 const rows=execFileSync('adb',['devices','-l'],{encoding:'utf8'}).split('\n').slice(1);
 const ready=rows.filter(l=>/\sdevice\s/.test(l));
 let row=ready.find(l=>/\susb:/.test(l))||ready.find(l=>{const id=l.split(/\s+/)[0];return !id.includes(':')&&!id.includes('_adb-tls')&&!id.startsWith('adb-');});
 if(!row&&ready.length){
  // Multiple ADB network transports can refer to the same physical Galaxy.
  // Compare identity only in memory; never save an identifier or its hash.
  const identities=ready.map(l=>execFileSync('adb',['-s',l.split(/\s+/)[0],'shell','getprop','ro.serialno'],{encoding:'utf8',timeout:5000}).trim());
  const models=ready.map(l=>execFileSync('adb',['-s',l.split(/\s+/)[0],'shell','getprop','ro.product.model'],{encoding:'utf8',timeout:5000}).trim());
  if(identities.every(Boolean)&&new Set(identities).size===1&&models.every(x=>x==='SM-S928N'))row=ready.find(l=>l.split(/\s+/)[0].includes(':'))||ready[0];
 }
 if(!row)throw Error('unambiguous physical device unavailable');return row.split(/\s+/)[0];
}
export async function physicalBrowser(){
 const serial=usbSerial(),port=Number(execFileSync('adb',['-s',serial,'forward','tcp:0',process.env.SDK_DEVICE_BROWSER==='samsung'?'localabstract:Terrace_devtools_remote':'localabstract:chrome_devtools_remote'],{encoding:'utf8'}).trim());
 const cleanup=()=>{try{execFileSync('adb',['-s',serial,'forward','--remove',`tcp:${port}`],{stdio:'ignore'});}catch{}};
 try{
 // Native VIEW returns before a cold browser's DevTools socket is ready.
 // Poll readiness only; this is outside every measured user-flow interval.
 let version;const deadline=Date.now()+10000;
 while(!version&&Date.now()<deadline){
  try{const response=await fetch(`http://127.0.0.1:${port}/json/version`,{signal:AbortSignal.timeout(1000)});if(response.ok){const candidate=await response.json();if(candidate.webSocketDebuggerUrl)version=candidate;}}catch{}
  if(!version)await new Promise(resolve=>setTimeout(resolve,100));
 }
 if(!version)throw Error('native DevTools endpoint not ready within10s');
 const endpoint=new URL(version.webSocketDebuggerUrl);
 endpoint.hostname='127.0.0.1';endpoint.port=String(port);
 const browser=await chromium.connectOverCDP(endpoint.href,{timeout:10000,noDefaults:true});browser.once('disconnected',cleanup);return browser;
 }catch(e){cleanup();throw e;}
}
const stage=x=>{if(process.env.SDK_DIAGNOSTIC_STAGE)console.log(JSON.stringify({setupStage:x}));};
export async function pageSetup(browser,{physical=false,mobile=false,count=735,cpu=1,captureFrames=true}={}){
 const context=physical?browser.contexts()[0]:await browser.newContext({viewport:mobile?{width:390,height:844}:{width:1440,height:900},isMobile:mobile,hasTouch:mobile,deviceScaleFactor:1,locale:'ko-KR',serviceWorkers:'block'});
 stage('context-available');let page;
 if(physical&&process.env.SDK_DEVICE_BROWSER==='samsung'){
  const boot=origin+'/__perf_bootstrap_render_flow_'+randomUUID();
  execFileSync('adb',['-s',usbSerial(),'shell','am','start','-a','android.intent.action.VIEW','-d',boot,'-p','com.sec.android.app.sbrowser'],{stdio:'ignore'});
  for(let i=0;i<200&&!page;i++){page=context.pages().find(p=>p.url()===boot);if(!page)await new Promise(r=>setTimeout(r,100));}
  if(!page)throw Error('owned native Samsung test tab not observed');
 }else page=await context.newPage();stage('page-created');
 if(physical)await page.bringToFront();stage('foregrounded');
 if(physical&&process.env.SDK_DEVICE_BROWSER==='samsung'){const v=await page.evaluate(()=>({width:innerWidth,height:innerHeight,visibility:document.visibilityState}));if(v.width<=0||v.height<=0||v.visibility!=='visible')throw Error('Samsung test tab has no native visible viewport');}
 // Chrome 154 upgrades production-CSP loopback subresources to HTTPS.
 // Fulfil only owned loopback assets from the same production server; retain
 // its CSP and other security headers. Remote SDK/tiles are never intercepted.
 // This is a laboratory asset transport, not evidence of production HTTPS.
 await page.route('https://localhost:3000/**',async route=>{
  if(route.request().method()!=='GET')return route.abort();
  const u=new URL(route.request().url());u.protocol='http:';
  const response=await fetch(u),headers=Object.fromEntries(response.headers);
  delete headers['content-encoding'];delete headers['content-length'];
  await route.fulfill({status:response.status,headers,body:Buffer.from(await response.arrayBuffer())});
 });
 stage('asset-route-installed');const cdp=await context.newCDPSession(page);stage('cdp-created');await cdp.send('Network.enable');stage('network-enabled');
 await cdp.send('Network.setBypassServiceWorker',{bypass:true});
 await cdp.send('Network.setCacheDisabled',{cacheDisabled:true});stage('cache-disabled');
 if(!physical)await cdp.send('Emulation.setCPUThrottlingRate',{rate:cpu});
 await page.route('**/_vercel/**',r=>r.abort());

 const rows=catalog(count),requests={restaurant:0,otherFixture:0};
 await page.route('**/rest/v1/**',async r=>{
  const u=new URL(r.request().url()),isRestaurants=u.pathname.endsWith('/restaurants');
  let data=isRestaurants?rows:[];
  if(isRestaurants){
   requests.restaurant++;
   for(const dim of ['lat','lng'])for(const f of u.searchParams.getAll(dim)){const op=f.split('.')[0],v=Number(f.slice(op.length+1));data=data.filter(x=>op==='gte'?x[dim]>=v:op==='lte'?x[dim]<=v:true);}
   const name=u.searchParams.get('approved_name');if(name){const term=name.replace(/^ilike\.%|%$/g,'').replace(/^eq\./,'');data=data.filter(x=>x.name.includes(term));}
   const ids=u.searchParams.get('id');if(ids)data=data.filter(x=>ids.includes(x.id));
   const category=u.searchParams.get('categories');if(category)data=data.filter(x=>category.includes(x.categories[0]));
   const n=Number(u.searchParams.get('limit')||data.length),offset=Number(u.searchParams.get('offset')||0);data=data.slice(offset,offset+n);
  }else requests.otherFixture++;
  await r.fulfill({status:r.request().method()==='OPTIONS'?204:200,contentType:'application/json',body:r.request().method()==='OPTIONS'?'':JSON.stringify(data),headers:{'access-control-allow-origin':origin,'access-control-allow-headers':'*'}});
 });
 await page.route('**/auth/v1/user',r=>r.fulfill({status:401,contentType:'application/json',body:'{"message":"Auth session missing!"}',headers:{'access-control-allow-origin':origin}}));
 const errors={page:0,console:0};page.on('pageerror',()=>errors.page++);page.on('console',m=>{if(m.type()==='error')errors.console++;});
 await page.addInitScript(({captureFrames})=>{
  window.__actualSdkProbe={mapRef:null,sdkMapCreates:0,frames:[],longTasks:[],shifts:[],click:0,first:0,stable:0,maxFrames:7200};
  document.addEventListener('load',event=>{
   if(event.target?.tagName!=='SCRIPT'||!event.target.src.includes('oapi.map.naver.com/openapi/v3/maps.js'))return;
   const maps=window.naver?.maps;if(!maps?.Map)return;
   const original=maps.Map;
   maps.Map=new Proxy(original,{construct(target,args,newTarget){const map=Reflect.construct(target,args,newTarget);window.__actualSdkProbe.mapRef=new WeakRef(map);window.__actualSdkProbe.sdkMapCreates++;return map;}});
  },true);
  new PerformanceObserver(l=>{for(const e of l.getEntries())window.__actualSdkProbe.longTasks.push({start:e.startTime,duration:e.duration});}).observe({type:'longtask',buffered:true});
  new PerformanceObserver(l=>{for(const e of l.getEntries())window.__actualSdkProbe.shifts.push({start:e.startTime,value:e.value,recentInput:e.hadRecentInput});}).observe({type:'layout-shift',buffered:true});
  document.addEventListener('click',e=>{if(e.target.closest('.cluster-marker-container')){const p=window.__actualSdkProbe;p.click=performance.now();p.first=0;p.stable=0;p.frames=[];}},true);
  let prev=0;
  function frame(t){const p=window.__actualSdkProbe,m=p.mapRef?.deref();if(!captureFrames&&p.first)return;let visible=0;
   for(const el of document.querySelectorAll('[data-testid="marker"]')){const b=el.getBoundingClientRect();if(b.bottom>0&&b.top<innerHeight&&b.left<innerWidth&&b.right>0){visible++;break;}}
   if(p.click&&m?.getZoom()===14&&visible){p.stable++;if(p.stable===1)p.pending=performance.now();if(p.stable>=2&&!p.first)p.first=p.pending;}else p.stable=0;
   if(p.frames.length<p.maxFrames)p.frames.push({t,gap:prev?t-prev:0,count:document.querySelectorAll('[data-testid="marker"],.cluster-marker-container').length,visible});prev=t;requestAnimationFrame(frame);
  }requestAnimationFrame(frame);
 },{captureFrames});
 stage('instrumentation-installed');return {page,context,cdp,requests,errors,count,close:async()=>{await page.close();if(!physical)await context.close();}};
}
export async function ready(t){
 stage('navigation-start');await t.page.goto(origin,{waitUntil:'domcontentloaded',timeout:30000});stage('dom-content-loaded');
 await t.page.locator('.cluster-marker-container').filter({hasText:t.count>=1000?'999+':String(t.count)}).waitFor({state:'visible',timeout:45000});
 const sdk=await t.page.evaluate(()=>({userAgent:navigator.userAgent,loaded:Boolean(window.naver?.maps?.Map),stub:Boolean(document.querySelector('script[data-local-naver-maps="true"]')),remoteScript:!!document.querySelector('script[src*="oapi.map.naver.com/openapi/v3/maps.js"]'),mapCaptured:Boolean(window.__actualSdkProbe.mapRef?.deref()),viewport:{width:innerWidth,height:innerHeight,dpr:devicePixelRatio},tiles:performance.getEntriesByType('resource').filter(r=>/map\.naver|pstatic/.test(r.name)).length}));
 if(!sdk.loaded||sdk.stub||!sdk.remoteScript||!sdk.mapCaptured)throw Error('actual SDK proof missing');
 await t.page.waitForTimeout(1000);return sdk;
}
