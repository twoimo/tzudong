import {execFileSync} from 'node:child_process';
import {writeFile} from 'node:fs/promises';
import {usbSerial} from './real-sdk-runtime.mjs';
const serial=usbSerial();let port;const result={observedAt:new Date().toISOString(),scope:'Only current-run pixel-review intent boot tabs with generated nonce; no profile, other tabs, settings or stored auth changed',ownedTargetsObserved:0,ownedTargetsClosed:0,privateTargetUrlsRetained:false};
try {
 port=execFileSync('adb',['-s',serial,'forward','tcp:0','localabstract:chrome_devtools_remote'],{encoding:'utf8',stdio:['ignore','pipe','ignore']}).trim();
 const targets=await(await fetch(`http://127.0.0.1:${port}/json/list`,{signal:AbortSignal.timeout(4000)})).json();
 const owned=targets.filter(t=>{try{const u=new URL(t.url);return t.type==='page'&&u.origin==='https://www.tzudong.app'&&['footer-pixels-v8','footer-pixels-v10','footer-pixels-after-v1'].includes(u.searchParams.get('__qa'))&&/^[a-f0-9-]{36}$/.test(u.searchParams.get('__perf_mobile')??'');}catch{return false;}});
 result.ownedTargetsObserved=owned.length;
 for(const t of owned){const r=await fetch(`http://127.0.0.1:${port}/json/close/${encodeURIComponent(t.id)}`,{signal:AbortSignal.timeout(4000)});if(r.ok)result.ownedTargetsClosed++;}
 const remaining=await(await fetch(`http://127.0.0.1:${port}/json/list`,{signal:AbortSignal.timeout(4000)})).json();result.ownedTargetsRemain=owned.filter(t=>remaining.some(r=>r.id===t.id)).length;
}catch{result.fixedFailure='owned_cleanup_readback_unavailable';}
finally {if(port)execFileSync('adb',['-s',serial,'forward','--remove','tcp:'+port],{stdio:'ignore'});}
await writeFile(new URL('owned-chrome-pixel-intent-cleanup-v1.json',import.meta.url),JSON.stringify(result,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(result));
