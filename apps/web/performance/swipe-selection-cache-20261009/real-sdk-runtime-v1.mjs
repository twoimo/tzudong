import {spawn, execFileSync} from 'node:child_process';
import {chromium} from '@playwright/test';
export {chromium};
export const origin = 'http://localhost:3000';

export function catalog(count = 735) {
  return Array.from({length:count}, (_, i) => ({id:`00000000-0000-4000-8000-${String(i).padStart(12,'0')}`,name:`실험맛집${String(i).padStart(4,'0')}`,approved_name:`실험맛집${String(i).padStart(4,'0')}`,lat:37.5+(i%40)*.003,lng:126.96+Math.floor(i/40)*.003,road_address:`서울특별시 중구 실험로 ${i+1}`,categories:[i%2?'한식':'분식'],status:'approved',created_at:'2026-09-01T00:00:00Z',review_count:0,weekly_search_count:count-i,youtube_link:null,youtube_meta:null}));
}
export async function serve(receipt) {
  if (Number(process.versions.node.split('.')[0]) !== 24) throw Error('pinned_node_required');
  let occupied = false;
  try { occupied=!!execFileSync('lsof',['-tiTCP:3000','-sTCP:LISTEN'],{encoding:'utf8',stdio:['ignore','pipe','ignore']}).trim(); } catch {}
  if (occupied) throw Error('owned_port_unavailable');
  const child = spawn(process.execPath,[`${receipt.root}/node_modules/next/dist/bin/next`,'start','--hostname','127.0.0.1','--port','3000'],{cwd:receipt.root,env:{PATH:process.env.PATH,HOME:process.env.HOME,NODE_ENV:'production',TZUDONG_NEXT_DIST_DIR:receipt.distDir},stdio:'ignore'});
  const close = async () => { if(child.exitCode!==null)return; const done=new Promise(resolve=>child.once('exit',resolve)); child.kill('SIGTERM'); await done; };
  for(let i=0;i<150;i+=1){
    if(child.exitCode!==null) throw Error('owned_server_stopped');
    try { if((await fetch(origin)).ok) return {close}; } catch {}
    await new Promise(resolve=>setTimeout(resolve,100));
  }
  await close(); throw Error('owned_server_readiness_failed');
}
export async function pageSetup(browser) {
  const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,deviceScaleFactor:1,locale:'ko-KR',serviceWorkers:'block'});
  const page=await context.newPage();
  // Preserve production CSP. Only upgraded OWNED loopback GET assets are
  // fulfilled from the same HTTP build. Remote SDK and tiles stay untouched.
  await page.route('https://localhost:3000/**',async route=>{
    if(route.request().method()!=='GET')return route.abort();
    const url=new URL(route.request().url());url.protocol='http:';
    const response=await fetch(url),headers=Object.fromEntries(response.headers);
    delete headers['content-encoding'];delete headers['content-length'];
    await route.fulfill({status:response.status,headers,body:Buffer.from(await response.arrayBuffer())});
  });
  const cdp=await context.newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.setBypassServiceWorker',{bypass:true});
  await cdp.send('Network.setCacheDisabled',{cacheDisabled:true});
  await cdp.send('Emulation.setCPUThrottlingRate',{rate:4});
  await page.route('**/_vercel/**',route=>route.abort());
  const rows=catalog(),requests={restaurant:0,otherFixture:0,failedAppAsset:0,failedRemoteProvider:0};
  await page.route('**/rest/v1/**',async route=>{
    const url=new URL(route.request().url()),isRestaurants=url.pathname.endsWith('/restaurants');
    let data=isRestaurants?rows:[];
    if(isRestaurants){
      requests.restaurant+=1;
      for(const dim of ['lat','lng'])for(const filter of url.searchParams.getAll(dim)){const op=filter.split('.')[0],value=Number(filter.slice(op.length+1));data=data.filter(row=>op==='gte'?row[dim]>=value:op==='lte'?row[dim]<=value:true);}
      const name=url.searchParams.get('approved_name');if(name){const term=name.replace(/^ilike\.%|%$/g,'').replace(/^eq\./,'');data=data.filter(row=>row.name.includes(term));}
      const ids=url.searchParams.get('id');if(ids)data=data.filter(row=>ids.includes(row.id));
      const category=url.searchParams.get('categories');if(category)data=data.filter(row=>category.includes(row.categories[0]));
      const limit=Number(url.searchParams.get('limit')||data.length),offset=Number(url.searchParams.get('offset')||0);data=data.slice(offset,offset+limit);
    }else requests.otherFixture+=1;
    await route.fulfill({status:route.request().method()==='OPTIONS'?204:200,contentType:'application/json',body:route.request().method()==='OPTIONS'?'':JSON.stringify(data),headers:{'access-control-allow-origin':origin,'access-control-allow-headers':'*'}});
  });
  await page.route('**/auth/v1/user',route=>route.fulfill({status:401,contentType:'application/json',body:'{"message":"Auth session missing!"}',headers:{'access-control-allow-origin':origin}}));
  const errors={page:0,console:0};page.on('pageerror',()=>errors.page+=1);page.on('console',message=>{if(message.type()==='error')errors.console+=1;});
  page.on('requestfailed',request=>{const url=request.url();if(url.includes('/_next/'))requests.failedAppAsset+=1;else if(/naver|pstatic/.test(url))requests.failedRemoteProvider+=1;});
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
  return {page,context,cdp,requests,errors,close:async()=>{await page.close();await context.close();}};
}
