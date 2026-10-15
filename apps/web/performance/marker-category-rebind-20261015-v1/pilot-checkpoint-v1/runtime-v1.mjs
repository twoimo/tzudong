import https from 'node:https';
import http from 'node:http';
import {spawn, execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
const authority=JSON.parse(readFileSync(new URL('./build-receipts-v1.json',import.meta.url)))[0].root;
const {chromium}=createRequire(authority+'/package.json')('@playwright/test');
import {fixtureQuery, reviewFixtureQuery} from './fixture-query-v3.mjs';
export {chromium};
export const origin = 'https://localhost:3000';

export function catalog(count = 735) {
  return Array.from({length:count}, (_, i) => ({id:`00000000-0000-4000-8000-${String(i).padStart(12,'0')}`,name:`실험맛집${String(i).padStart(4,'0')}`,approved_name:`실험맛집${String(i).padStart(4,'0')}`,lat:37.5+(i%40)*.003,lng:126.96+Math.floor(i/40)*.003,road_address:`서울특별시 중구 실험로 ${i+1}`,categories:[i%2?'한식':'분식'],status:'approved',created_at:'2026-09-01T00:00:00Z',review_count:0,weekly_search_count:count-i,youtube_link:null,youtube_meta:null}));
}
export async function serve(receipt) {
  if (Number(process.versions.node.split('.')[0]) !== 24) throw Error('pinned_node_required');
  let occupied = false;
  try { occupied=!!execFileSync('lsof',['-tiTCP:3000','-sTCP:LISTEN'],{encoding:'utf8',stdio:['ignore','pipe','ignore']}).trim(); } catch {}
  if (occupied) throw Error('owned_port_unavailable');
  try {if(execFileSync('lsof',['-tiTCP:3003','-sTCP:LISTEN'],{encoding:'utf8',stdio:['ignore','pipe','ignore']}).trim())throw Error('owned_upstream_port_unavailable');}catch(error){if(error?.message==='owned_upstream_port_unavailable')throw error;}
  const runtimeRequire=createRequire(receipt.root+'/package.json');
  const values=runtimeRequire('dotenv').parse(readFileSync('/Users/twoimo/Documents/projects/tzudong/apps/web/.env.local'));
  const publicRuntime=Object.fromEntries(['NEXT_PUBLIC_SUPABASE_URL','NEXT_PUBLIC_SUPABASE_ANON_KEY','NEXT_PUBLIC_NAVER_CLIENT_ID','NEXT_PUBLIC_SITE_URL'].map(key=>[key,values[key]]).filter(([,value])=>typeof value==='string'&&value));
  const child = spawn(process.execPath,[`${receipt.root}/node_modules/next/dist/bin/next`,'start','--hostname','127.0.0.1','--port','3003'],{cwd:receipt.root,env:{PATH:process.env.PATH,HOME:process.env.HOME,NODE_ENV:'production',TZUDONG_NEXT_DIST_DIR:receipt.distDir,...publicRuntime},stdio:'ignore'});
  const tls=https.createServer({key:readFileSync('/Users/twoimo/.codex/runtime-cache/naver-local-tls-marker-dom-20261014-v1/key.pem'),cert:readFileSync('/Users/twoimo/.codex/runtime-cache/naver-local-tls-marker-dom-20261014-v1/cert.pem')},(req,res)=>{const childRequest=http.request({hostname:'127.0.0.1',port:3003,path:req.url,method:req.method,headers:{...req.headers,host:'localhost:3000','x-forwarded-proto':'https'}},upstream=>{res.writeHead(upstream.statusCode,upstream.headers);upstream.pipe(res);});childRequest.on('error',()=>{res.writeHead(502);res.end();});req.pipe(childRequest);});
  await new Promise((resolve,reject)=>{tls.once('error',reject);tls.listen(3000,'127.0.0.1',resolve);});
  const close = async () => { await new Promise(resolve=>tls.close(resolve)); if(child.exitCode!==null)return; const done=new Promise(resolve=>child.once('exit',resolve)); child.kill('SIGTERM'); await done; };
  for(let i=0;i<150;i+=1){
    if(child.exitCode!==null) throw Error('owned_server_stopped');
    try { if((await fetch('http://127.0.0.1:3003')).ok) return {close}; } catch {}
    await new Promise(resolve=>setTimeout(resolve,100));
  }
  await close(); throw Error('owned_server_readiness_failed');
}
export async function pageSetup(browser) {
  const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,deviceScaleFactor:1,locale:'ko-KR',serviceWorkers:'block'});
  const page=await context.newPage();
  const diagnostics={failed:[],assetResponses:{},console:[],networkFailures:[],assetTimeline:[],navigations:[],documentNavigationCount:0,fixtureQueries:[]};
  const group=url=>url.hostname==='localhost'?'owned-loopback':/naver|pstatic|ntruss/.test(url.hostname)?'naver-family':'other-remote';
  page.on('requestfailed',request=>{if(diagnostics.failed.length>=32)return;const url=new URL(request.url());const code=request.failure()?.errorText??'';diagnostics.failed.push({group:group(url),protocol:url.protocol,type:request.resourceType(),appAsset:url.pathname.startsWith('/_next/'),localAsset:url.hostname==='localhost'&&url.pathname.startsWith('/_next/')?url.pathname:null,code:/^net::ERR_[A-Z_]+$/.test(code)?code:'other'});});
  page.on('response',response=>{const url=new URL(response.url());if(url.hostname!=='localhost'||!url.pathname.startsWith('/_next/'))return;const key=url.protocol+':'+response.status()+':'+response.request().resourceType();diagnostics.assetResponses[key]=(diagnostics.assetResponses[key]??0)+1;});
  page.on('console',message=>{if(message.type()!=='error'||diagnostics.console.length>=16)return;const text=message.text();diagnostics.console.push({at:Date.now(),networkCodes:[...new Set(text.match(/net::ERR_[A-Z_]+/g)??[])],reactCode:text.match(/Minified React error #(\d+)/)?.[1]??null,chunkFailure:/ChunkLoadError|Loading chunk|Failed to fetch dynamically imported module/.test(text),csp:/Content Security Policy|violates.*directive/i.test(text),messageLength:text.length, fixedCode:/^\[[A-Za-z]+Error\]$/.test(text)?text:null,chunkNumbers:[...text.matchAll(/Loading chunk (\d+)/g)].map(m=>m[1]),localAssetMatches:[...text.matchAll(/http:\/\/localhost:3000(\/_next\/static\/[a-zA-Z0-9_./-]+)/g)].map(m=>m[1])});});
  await page.addInitScript(()=>{
    const events=window.__boundedErrorEvents=[];
    const add=value=>{if(events.length<16)events.push({at:performance.now(),...value});};
    const shape=value=>{const names=['Error','TypeError','ReferenceError','SyntaxError','RangeError','DOMException','Event','ProgressEvent','ErrorEvent','XMLHttpRequest','PromiseRejectionEvent'];const name=value?.constructor?.name;return {type:typeof value,constructor:names.includes(name)?name:'other',eventType:['error','abort','timeout','load'].includes(value?.type)?value.type:null,isNull:value===null,messageLength:typeof value?.message==='string'?value.message.length:null,emptyMessage:value?.message==='',targetTag:['SCRIPT','LINK','IMG','VIDEO'].includes(value?.target?.tagName)?value.target.tagName:null,targetRel:['stylesheet','preload','prefetch','modulepreload'].includes(value?.target?.rel)?value.target.rel:null,targetConnected:value?.target?.isConnected??null,targetHasSheet:!!value?.target?.sheet,localTargetAsset:(()=>{try{const u=new URL(value?.target?.src??value?.target?.href);return u.hostname==='localhost'&&u.pathname.startsWith('/_next/')?u.pathname:null;}catch{return null;}})(),targetSourceGroup:(()=>{const source=value?.target?.src??value?.target?.href;if(!source)return null;try{const u=new URL(source);return u.hostname==='localhost'?(u.pathname.startsWith('/_next/')?'local-app-asset':'local-other'):/naver|pstatic|ntruss/.test(u.hostname)?'naver-family':'other-remote';}catch{return 'other';}})(),status:Number.isInteger(value?.target?.status)?value.target.status:null,readyState:Number.isInteger(value?.target?.readyState)?value.target.readyState:null};};
    addEventListener('unhandledrejection',event=>add({event:'unhandledrejection',shape:shape(event.reason)}));
    addEventListener('error',event=>add({event:'error',shape:shape(event.error),line:event.lineno,column:event.colno}));
    addEventListener('securitypolicyviolation',event=>{let host='other';try{const h=new URL(event.blockedURI).hostname;host=/naver|pstatic|ntruss/.test(h)?'naver-family':h==='localhost'?'owned-loopback':'other';}catch{}let vendorOrigin=null;try{const u=new URL(event.blockedURI);if(u.protocol==='https:'&&/(^|\.)(naver\.com|navercloudapi\.com|ntruss\.com|pstatic\.net)$/.test(u.hostname))vendorOrigin=u.origin;}catch{}add({event:'csp',directive:event.effectiveDirective,host,vendorOrigin});});
  });
  // Preserve production CSP. Only upgraded OWNED loopback GET assets are
  // fulfilled from the same HTTP build. Remote SDK and tiles stay untouched.
  const cdp=await context.newCDPSession(page);
  const assetIds=new Map();
  cdp.on('Page.frameNavigated',event=>{if(!event.frame.parentId)diagnostics.documentNavigationCount++;});
  cdp.on('Network.requestWillBeSent',event=>{const u=new URL(event.request.url);if(u.hostname==='localhost'&&u.pathname.startsWith('/_next/')){assetIds.set(event.requestId,u.pathname);if(diagnostics.assetTimeline.length<256)diagnostics.assetTimeline.push({event:'start',id:event.requestId,path:u.pathname,at:event.timestamp,type:event.type,initiator:event.initiator.type});}});
  cdp.on('Network.responseReceived',event=>{if(assetIds.has(event.requestId)&&diagnostics.assetTimeline.length<256)diagnostics.assetTimeline.push({event:'response',id:event.requestId,at:event.timestamp,status:event.response.status,mime:event.response.mimeType});});
  cdp.on('Network.loadingFailed',event=>{if(!assetIds.has(event.requestId)||diagnostics.networkFailures.length>=32)return;diagnostics.networkFailures.push({path:assetIds.get(event.requestId),at:event.timestamp,id:event.requestId,type:event.type,canceled:event.canceled??false,blockedReason:event.blockedReason??null,cors:event.corsErrorStatus?.corsError??null,error:/^net::ERR_[A-Z_]+$/.test(event.errorText)?event.errorText:'other'});});
  page.on('framenavigated',frame=>{if(frame===page.mainFrame())diagnostics.navigations.push({at:Date.now(),origin:new URL(frame.url()).origin});});
  await cdp.send('Page.enable');
  await cdp.send('Network.enable');
  await cdp.send('Network.setBypassServiceWorker',{bypass:true});
  await cdp.send('Network.setCacheDisabled',{cacheDisabled:true});
  await cdp.send('Emulation.setCPUThrottlingRate',{rate:4});
  await page.route('**/_vercel/**',route=>route.abort());
  const approved=catalog();
  const deleted=approved.map((r,i)=>({...r,id:`00000000-0000-4000-9000-${String(i).padStart(12,'0')}`,approved_name:r.name+' 중복',name:r.name+' 중복',origin_name:r.name,status:'deleted'}));
  const rows=[...approved,...deleted];
  const userId='00000000-0000-4000-8000-999999999999';
  const reviews=deleted.map((r,i)=>({id:`10000000-0000-4000-8000-${String(i).padStart(12,'0')}`,restaurant_id:r.id,user_id:userId,is_verified:true,is_pinned:false,created_at:'2026-09-01T00:00:00Z',visited_at:'2026-09-01',content:'회귀 검증 리뷰 '+i,food_photos:[],categories:['한식'],like_count:0,is_edited_by_admin:false,admin_note:null}));
  const requests={restaurant:0,otherFixture:0,failedAppAsset:0,failedRemoteProvider:0,remoteFailureKinds:{}};
  const sdkScript={status:null,sha256:null};
  let sdkReceiptPending=Promise.resolve();
  page.on('response',response=>{if(response.url().includes('oapi.map.naver.com/openapi/v3/maps.js')){sdkScript.status=response.status();sdkReceiptPending=response.body().then(bytes=>{sdkScript.sha256=createHash('sha256').update(bytes).digest('hex');}).catch(()=>undefined);}});
  await page.route('**/rest/v1/**',async route=>{
    const url=new URL(route.request().url()),isRestaurants=url.pathname.endsWith('/restaurants');
    let data=[],total=0;
    if(isRestaurants){
      requests.restaurant+=1;
      if(diagnostics.fixtureQueries.length<64)diagnostics.fixtureQueries.push({at:Date.now(),method:route.request().method(),keys:[...url.searchParams.keys()].sort(),operators:[...url.searchParams].filter(([k])=>!['select','order'].includes(k)).map(([k,v])=>[k,v.split('.')[0]]),selectedColumns:url.searchParams.get('select')?.split(',').map(x=>x.trim())??[],limit:url.searchParams.get('limit')});
      try{const result=fixtureQuery(rows,url.searchParams);data=result.data;total=result.total;}
      catch(error){requests.unsupportedFixtureQueries=(requests.unsupportedFixtureQueries??0)+1;requests.unsupportedCauses??={};const allowed=['fixture_predicate_unsupported','fixture_order_unsupported','fixture_select_unsupported','fixture_range_unsupported','fixture_column_unsupported','fixture_control_unsupported'];const code=allowed.includes(error.message)?error.message:'other-fixture-shape';requests.unsupportedCauses[code]=(requests.unsupportedCauses[code]??0)+1;requests.issuedOperatorShapes??={};for(const field of ['id','approved_name','status','lat','lng','review_count','categories'])for(const value of url.searchParams.getAll(field)){const words=value.split('.');const operator=words[0]==='not'?'not.'+words[1]:words[0];const known=['not.is','not.eq','is','eq','in','ilike','gt','lt','gte','lte','cs','ov'];const key=field+':'+(known.includes(operator)?operator:'other');requests.issuedOperatorShapes[key]=(requests.issuedOperatorShapes[key]??0)+1;}return route.fulfill({status:400,contentType:'application/json',body:'{"message":"fixture_query_unsupported"}',headers:{'access-control-allow-origin':origin,'access-control-allow-headers':'*'}});}
    }else if(url.pathname.endsWith('/reviews')){
      requests.otherFixture+=1;
      try{const result=reviewFixtureQuery(reviews,url.searchParams);data=result.data;total=result.total;}
      catch{requests.unsupportedFixtureQueries=(requests.unsupportedFixtureQueries??0)+1;requests.unsupportedReviewShape={keys:[...url.searchParams.keys()].sort(),select:url.searchParams.get('select'),order:url.searchParams.get('order')};return route.fulfill({status:400,contentType:'application/json',body:'{"message":"fixture_query_unsupported"}'});}
    }else if(url.pathname.endsWith('/rpc/read_public_profile_summaries')){
      requests.otherFixture+=1;const input=route.request().postDataJSON();
      data=(input?.p_user_ids??[]).filter(id=>id===userId).map(id=>({user_id:id,nickname:'실험 사용자',avatar_url:null}));
    }else requests.otherFixture+=1;
    await route.fulfill({status:route.request().method()==='OPTIONS'?204:200,contentType:'application/json',body:route.request().method()==='OPTIONS'?'':JSON.stringify(data),headers:{'access-control-allow-origin':origin,'access-control-allow-headers':'*','access-control-expose-headers':'content-range',...(route.request().headers().prefer?.includes('count=exact')?{'content-range':data.length?`0-${data.length-1}/${total}`:`*/${total}`}:{})}});
  });
  await page.route('**/auth/v1/user',route=>route.fulfill({status:401,contentType:'application/json',body:'{"message":"Auth session missing!"}',headers:{'access-control-allow-origin':origin}}));
  const errors={page:0,console:0,consoleCategories:{http401:0,blockedClient:0,provider:0,other:0}};
  page.on('pageerror',()=>errors.page+=1);
  page.on('console',message=>{if(message.type()!=='error')return;errors.console+=1;const value=message.text();const category=/Content Security Policy|violates.*directive/i.test(value)?'csp':/Authentication Failed|not.*authoriz|InvalidClient|허용.*도메인/i.test(value)?'sdkAuth':/CORS policy|Access-Control-Allow/i.test(value)?'cors':/ERR_BLOCKED_BY_ORB/.test(value)?'orb':/status of 401|401.*Unauthorized/i.test(value)?'http401':/ERR_BLOCKED_BY_CLIENT/.test(value)?'blockedClient':/naver|maps.*auth|client.*id/i.test(value)?'provider':'other';errors.consoleCategories[category]=(errors.consoleCategories[category]??0)+1;if(category==='csp'){errors.cspDirectives??={};const directive=['connect-src','img-src','script-src','frame-src','worker-src','style-src'].find(x=>value.includes(x))??'other';errors.cspDirectives[directive]=(errors.cspDirectives[directive]??0)+1;errors.cspResourceGroups??={};const match=value.match(/(https?:\/\/[^\s'"]+)/i);let group='unknown';if(match)try{const host=new URL(match[1]).hostname;group=host==='localhost'||host==='127.0.0.1'?'owned-loopback':host.endsWith('supabase.co')?'fixture-db':host.includes('naver')||host.includes('ntruss')?'naver-family':(host==='pstatic.net'||host.endsWith('.pstatic.net'))?'provider-static':'other-third-party';}catch{}errors.cspResourceGroups[group]=(errors.cspResourceGroups[group]??0)+1;}});
  page.on('requestfailed',request=>{const url=request.url();if(url.includes('/_next/'))requests.failedAppAsset+=1;else if(/naver|pstatic/.test(url)){requests.failedRemoteProvider+=1;const rawCode=request.failure()?.errorText;const allowed=['net::ERR_ABORTED','net::ERR_BLOCKED_BY_CLIENT','net::ERR_BLOCKED_BY_RESPONSE','net::ERR_BLOCKED_BY_CSP','net::ERR_FAILED','net::ERR_NAME_NOT_RESOLVED'];const code=allowed.includes(rawCode)?rawCode:'other-network-failure';requests.remoteFailureKinds[code]=(requests.remoteFailureKinds[code]??0)+1;}});
  await page.addInitScript(()=>{
    const probe=window.__swipeCacheUiProbe={mapRef:null,mapCreates:0,lastClick:0,lastInput:0,frames:[],tasks:[],shifts:[],on:true};
    document.addEventListener('load',event=>{
      if(event.target?.tagName!=='SCRIPT'||!event.target.src.includes('oapi.map.naver.com/openapi/v3/maps.js'))return;
      const maps=window.naver?.maps;if(!maps?.Map)return;
      maps.Map=new Proxy(maps.Map,{construct(target,args,newTarget){const map=Reflect.construct(target,args,newTarget);probe.mapRef=new WeakRef(map);probe.mapCreates+=1;return map;}});
    },true);
    document.addEventListener('click',()=>{probe.lastClick=performance.now();},true);
    document.addEventListener('input',()=>{probe.lastInput=performance.now();},true);
    new PerformanceObserver(list=>{for(const entry of list.getEntries())if(probe.tasks.length<512)probe.tasks.push({time:entry.startTime,duration:entry.duration});}).observe({type:'longtask',buffered:true});
    new PerformanceObserver(list=>{for(const entry of list.getEntries())if(probe.shifts.length<512)probe.shifts.push({time:entry.startTime,value:entry.value,recentInput:entry.hadRecentInput});}).observe({type:'layout-shift',buffered:true});
    let prior=0;
    function frame(time){if(!probe.on)return;if(prior&&probe.frames.length<4096)probe.frames.push({time,gap:time-prior});prior=time;requestAnimationFrame(frame);}
    requestAnimationFrame(frame);
  });
  return {page,context,cdp,requests,errors,diagnostics,sdkScript,awaitSdkReceipt:()=>sdkReceiptPending,close:async()=>{await page.close();await context.close();}};
}
