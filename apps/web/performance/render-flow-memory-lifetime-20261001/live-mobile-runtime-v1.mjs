import {execFileSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {usbSerial,origin} from './real-sdk-runtime.mjs';

const sleep=ms=>new Promise(r=>setTimeout(r,ms));
export async function ownedLivePage(mode){
 const serial=usbSerial(),pkg=mode==='samsung'?'com.sec.android.app.sbrowser':'com.android.chrome',socket=mode==='samsung'?'Terrace_devtools_remote':'chrome_devtools_remote',unique=randomUUID(),boot='https://www.tzudong.app/?__qa=memory-release&__perf_mobile='+unique;
 execFileSync('adb',['-s',serial,'shell','am','start','-a','android.intent.action.VIEW','-d',boot,'-p',pkg],{stdio:'ignore',timeout:10000});
 const port=execFileSync('adb',['-s',serial,'forward','tcp:0','localabstract:'+socket],{encoding:'utf8',stdio:['ignore','pipe','ignore'],timeout:5000}).trim();
 let target,ws,id=0;const pending=new Map(),listeners=new Map();
 const close=async()=>{if(target){try{await fetch(`http://127.0.0.1:${port}/json/close/${encodeURIComponent(target.id)}`,{signal:AbortSignal.timeout(2000)});}catch{}}if(ws)ws.close();try{execFileSync('adb',['-s',serial,'forward','--remove','tcp:'+port],{stdio:'ignore',timeout:5000});}catch{}};
 try{
 const deadline=Date.now()+15000;while(!target&&Date.now()<deadline){try{target=(await (await fetch(`http://127.0.0.1:${port}/json/list`,{signal:AbortSignal.timeout(1000)})).json()).find(t=>{try{const u=new URL(t.url);return u.hostname==='www.tzudong.app'&&u.protocol==='https:'&&u.searchParams.get('__perf_mobile')===unique;}catch{return false;}});}catch{}if(!target)await sleep(100);}
 if(!target)throw Error('owned target missing');const url=new URL(target.webSocketDebuggerUrl);url.hostname='127.0.0.1';url.port=port;ws=new WebSocket(url.href);
 await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('owned websocket timeout')),5000);ws.addEventListener('open',()=>{clearTimeout(timer);resolve();},{once:true});ws.addEventListener('error',()=>{clearTimeout(timer);reject(Error('owned websocket error'));},{once:true});});
 const send=(method,params={})=>new Promise((resolve,reject)=>{const n=++id,timer=setTimeout(()=>{pending.delete(n);reject(Error('owned command timeout'));},10000);pending.set(n,{resolve,reject,timer});ws.send(JSON.stringify({id:n,method,params}));});
 ws.addEventListener('message',e=>{const m=JSON.parse(e.data);if(m.id&&pending.has(m.id)){const p=pending.get(m.id);clearTimeout(p.timer);pending.delete(m.id);m.error?p.reject(Error('owned command rejected')):p.resolve(m.result);}else if(m.method)for(const fn of listeners.get(m.method)||[])fn(m.params);});
 const on=(method,fn)=>{const list=listeners.get(method)||[];list.push(fn);listeners.set(method,list);};
 const evaluate=async(fn,arg)=>{const r=await send('Runtime.evaluate',{expression:`(${fn.toString()})(${arg===undefined?'undefined':JSON.stringify(arg)})`,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error('owned evaluation failed');return r.result.value;};
 await send('Runtime.runIfWaitingForDebugger');return {send,on,evaluate,close,pkg,serial,boot};
 }catch(e){await close();throw e;}
}

export {sleep};
