import {execFileSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {usbSerial,origin} from './real-sdk-runtime.mjs';
import {catalog} from './catalog.mjs';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
export async function ownedPage(mode){
 const serial=usbSerial(),pkg=mode==='samsung'?'com.sec.android.app.sbrowser':'com.android.chrome',socket=mode==='samsung'?'Terrace_devtools_remote':'chrome_devtools_remote',unique=randomUUID(),boot=origin+'/?__perf_mobile='+unique;
 execFileSync('adb',['-s',serial,'shell','am','start','-a','android.intent.action.MAIN','-c','android.intent.category.LAUNCHER','-p',pkg],{stdio:'ignore',timeout:10000});
 const port=execFileSync('adb',['-s',serial,'forward','tcp:0','localabstract:'+socket],{encoding:'utf8',stdio:['ignore','pipe','ignore'],timeout:5000}).trim();
 let target,ws,id=0;const pending=new Map(),listeners=new Map();
 const close=async()=>{if(target){try{await fetch(`http://127.0.0.1:${port}/json/close/${encodeURIComponent(target.id)}`,{signal:AbortSignal.timeout(2000)});}catch{}}if(ws)ws.close();try{execFileSync('adb',['-s',serial,'forward','--remove','tcp:'+port],{stdio:'ignore',timeout:5000});}catch{}};
 try{
 const deadline=Date.now()+15000;while(!target&&Date.now()<deadline){try{const response=await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent(boot)}`,{method:'PUT',signal:AbortSignal.timeout(1500)});if(response.ok){const candidate=await response.json();if(candidate.id&&candidate.webSocketDebuggerUrl)target=candidate;}}catch{}if(!target)await sleep(150);}
 if(!target)throw Error('owned target missing');const url=new URL(target.webSocketDebuggerUrl);url.hostname='127.0.0.1';url.port=port;ws=new WebSocket(url.href);
 await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('owned websocket timeout')),5000);ws.addEventListener('open',()=>{clearTimeout(timer);resolve();},{once:true});ws.addEventListener('error',()=>{clearTimeout(timer);reject(Error('owned websocket error'));},{once:true});});
 const send=(method,params={})=>new Promise((resolve,reject)=>{const n=++id,timer=setTimeout(()=>{pending.delete(n);reject(Error('owned command timeout'));},10000);pending.set(n,{resolve,reject,timer});ws.send(JSON.stringify({id:n,method,params}));});
 ws.addEventListener('message',e=>{const m=JSON.parse(e.data);if(m.id&&pending.has(m.id)){const p=pending.get(m.id);clearTimeout(p.timer);pending.delete(m.id);m.error?p.reject(Error('owned command rejected')):p.resolve(m.result);}else if(m.method)for(const fn of listeners.get(m.method)||[])fn(m.params);});
 const on=(method,fn)=>{const list=listeners.get(method)||[];list.push(fn);listeners.set(method,list);};
 const evaluate=async(fn,arg)=>{const r=await send('Runtime.evaluate',{expression:`(${fn.toString()})(${arg===undefined?'undefined':JSON.stringify(arg)})`,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error('owned evaluation failed');return r.result.value;};
 await send('Runtime.runIfWaitingForDebugger');return {send,on,evaluate,close,pkg,serial,boot};
 }catch(e){await close();throw e;}
}
export async function fixturePage(t,count=735){
 await t.send('Page.enable');const frame=await t.send('Page.getFrameTree');let labOrigin;try{labOrigin=new URL(frame.frameTree.frame.url).origin;}catch{labOrigin=origin;}const rows=catalog(count),errors={page:0,console:0},requests={restaurant:0,otherFixture:0};t.on('Runtime.exceptionThrown',()=>errors.page++);t.on('Runtime.consoleAPICalled',e=>{if(e.type==='error')errors.console++;});
 t.fixtureDiagnostics={errors,requests};await t.send('Runtime.enable');await t.send('Network.enable');await t.send('Network.setCacheDisabled',{cacheDisabled:true});await t.send('Network.setBypassServiceWorker',{bypass:true});await t.send('Network.setBlockedURLs',{urls:['*/_vercel/*']});
 t.on('Fetch.requestPaused',async event=>{try{
 const u=new URL(event.request.url);let data,status=200,headers=[{name:'Content-Type',value:'application/json'},{name:'Access-Control-Allow-Origin',value:(['http://localhost:3000','https://localhost:3000'].includes(event.request.headers?.Origin??event.request.headers?.origin)?(event.request.headers.Origin??event.request.headers.origin):labOrigin)},{name:'Access-Control-Allow-Headers',value:'*'}];
 if(u.hostname==='localhost'&&u.port==='3000'&&u.protocol==='https:'){u.protocol='http:';const r=await fetch(u);const body=Buffer.from(await r.arrayBuffer()).toString('base64');await t.send('Fetch.fulfillRequest',{requestId:event.requestId,responseCode:r.status,responseHeaders:Array.from(r.headers,([name,value])=>({name,value})).filter(h=>!['content-encoding','content-length'].includes(h.name)),body});return;}
 if(u.pathname.startsWith('/rest/v1/')){const isRestaurants=u.pathname.endsWith('/restaurants');data=isRestaurants?rows:[];if(isRestaurants){requests.restaurant++;for(const dim of ['lat','lng'])for(const f of u.searchParams.getAll(dim)){const op=f.split('.')[0],v=Number(f.slice(op.length+1));data=data.filter(x=>op==='gte'?x[dim]>=v:op==='lte'?x[dim]<=v:true);}const name=u.searchParams.get('approved_name');if(name){const term=name.replace(/^ilike\.%|%$/g,'').replace(/^eq\./,'');data=data.filter(x=>x.name.includes(term));}const ids=u.searchParams.get('id');if(ids)data=data.filter(x=>ids.includes(x.id));const category=u.searchParams.get('categories');if(category)data=data.filter(x=>category.includes(x.categories[0]));const n=Number(u.searchParams.get('limit')||data.length),offset=Number(u.searchParams.get('offset')||0);data=data.slice(offset,offset+n);}else requests.otherFixture++;}
 else if(u.pathname==='/auth/v1/user'){status=401;data={message:'Auth session missing!'};}
 else {await t.send('Fetch.continueRequest',{requestId:event.requestId});return;}
 if(event.request.method==='OPTIONS'){status=204;data=null;}
 await t.send('Fetch.fulfillRequest',{requestId:event.requestId,responseCode:status,responseHeaders:headers,body:Buffer.from(data===null?'':JSON.stringify(data)).toString('base64')});
 }catch{try{await t.send('Fetch.failRequest',{requestId:event.requestId,errorReason:'Failed'});}catch{}}});
 await t.send('Fetch.enable',{patterns:[{urlPattern:'https://localhost:3000/*'},{urlPattern:'*/rest/v1/*'},{urlPattern:'*/auth/v1/user'}]});
 await t.send('Page.enable');await t.send('Page.addScriptToEvaluateOnNewDocument',{source:`(${init.toString()})()`});await t.send('Page.navigate',{url:t.boot});await t.send('Page.bringToFront');
 await wait(t,()=>{try{const m=window.__mobileProbe?.mapRef?.deref(),c=m?.getCenter?.();return typeof c?.lat==='function'&&typeof c?.lng==='function';}catch{return false;}},45000);
 const setupCenter=await t.evaluate(()=>{const m=window.__mobileProbe.mapRef.deref(),c=m.getCenter();return {insideSyntheticFootprint:Math.abs(c.lat()-37.5665)<.03&&Math.abs(c.lng()-126.978)<.03,zoom:m.getZoom()};});t.fixtureDiagnostics.setupCenter=setupCenter;
 await t.evaluate(()=>{const m=window.__mobileProbe.mapRef.deref();m.setCenter(new window.naver.maps.LatLng(37.5665,126.978));m.setZoom(9);});
 await wait(t,()=>document.querySelectorAll('.cluster-marker-container').length>0,45000);
 await t.evaluate(()=>navigator.wakeLock?.request('screen').then(l=>window.__taskWakeLock=l).catch(()=>null));
 const proof=await t.evaluate(()=>({userAgent:navigator.userAgent,viewport:{width:innerWidth,height:innerHeight,dpr:devicePixelRatio},visibility:document.visibilityState,remoteSdk:!!document.querySelector('script[src*="oapi.map.naver.com/openapi/v3/maps.js"]'),sdkLoaded:!!window.naver?.maps?.Map,stub:!!document.querySelector('script[data-local-naver-maps="true"]'),mapCreates:window.__mobileProbe.mapCreates}));
 if(proof.visibility!=='visible'||proof.stub||!proof.sdkLoaded||!proof.remoteSdk||proof.viewport.width<=0)throw Error('native SDK proof failed');return {rows,errors,requests,proof};
}
function init(){
 navigator.wakeLock?.request('screen').then(l=>window.__taskWakeLock=l).catch(()=>null);
 window.__mobileProbe={mapRef:null,mapCreates:0,frames:[],tasks:[],touch:[],reset:{armed:false}};
 document.addEventListener('load',e=>{if(e.target?.tagName!=='SCRIPT'||!e.target.src.includes('oapi.map.naver.com/openapi/v3/maps.js'))return;const m=window.naver?.maps;if(!m?.Map)return;m.Map=new Proxy(m.Map,{construct(target,args,newTarget){const map=Reflect.construct(target,args,newTarget);window.__mobileProbe.mapRef=new WeakRef(map);window.__mobileProbe.mapCreates++;return map;}});},true);
 new PerformanceObserver(l=>{for(const x of l.getEntries())window.__mobileProbe.tasks.push({start:x.startTime,duration:x.duration});}).observe({type:'longtask',buffered:true});
 document.addEventListener('click',e=>{const q=window.__mobileProbe.reset,b=e.target.closest('button');if(q.armed&&b&&/초기화/.test((b.textContent??'')+' '+(b.getAttribute('aria-label')??''))){q.start=performance.now();q.trusted=e.isTrusted;q.stable=0;q.end=0;}},true);
 for(const type of ['touchstart','touchmove','touchend'])document.addEventListener(type,e=>{if(e.target.closest('[data-restaurant-detail-swipe-area]'))window.__mobileProbe.touch.push({type,trusted:e.isTrusted,t:performance.now()});},true);
 let previous=0;function frame(ts){const p=window.__mobileProbe,q=p.reset,nodes=document.querySelectorAll('[data-testid="marker"],.cluster-marker-container');if(p.frames.length<7200)p.frames.push({t:ts,gap:previous?ts-previous:0,count:nodes.length});previous=ts;
 if(q.start&&!q.end){if(nodes.length===q.target&&Array.from(nodes).some(e=>{const b=e.getBoundingClientRect();return b.width>0&&b.height>0&&b.right>0&&b.left<innerWidth&&b.bottom>0&&b.top<innerHeight;})){if(++q.stable>=2)q.end=performance.now();}else q.stable=0;}requestAnimationFrame(frame);}requestAnimationFrame(frame);
}
export async function wait(t,fn,ms=12000,arg){const deadline=Date.now()+ms;while(Date.now()<deadline){if(await t.evaluate(fn,arg))return;await sleep(75);}throw Error('owned condition timeout');}
export async function tap(t,selector,text){
 const point=await t.evaluate(({selector,text})=>{for(const e of document.querySelectorAll(selector)){if(text&&!new RegExp(text).test((e.textContent??'')+' '+(e.getAttribute('aria-label')??'')))continue;const b=e.getBoundingClientRect();if(b.width&&b.height&&b.top>=0&&b.bottom<=innerHeight){const x=b.x+b.width/2,y=b.y+b.height/2,h=document.elementFromPoint(x,y);if(h&&(e.contains(h)||h===e))return {x,y};}}return null;},{selector,text});
 if(!point)throw Error('owned visible tap target missing');await t.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[point]});await t.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
}
export {sleep};
