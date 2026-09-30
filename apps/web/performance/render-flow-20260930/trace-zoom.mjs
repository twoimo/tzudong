import {launch,setup,ready,metrics,save} from './runtime.mjs';
import {zoomMockMap} from '../../tests/mobile-home-map-helpers.ts';
import {writeFile,mkdir} from 'node:fs/promises';
const label=process.argv[2]||'zoom-baseline-v1',kind=process.argv[3]||'baseline';
const root=new URL(label+'/',import.meta.url);await mkdir(root);
const run=await launch(kind),t=await setup(run.browser,{count:735,cpu:4});
try{
 await t.page.addInitScript(()=>{
  window.__poolActions=[]; const proto=window.naver.maps.Marker.prototype, original=proto.setMap;
  proto.setMap=function(map){window.__poolActions.push({time:performance.now(),attached:Boolean(map),stack:new Error().stack.split('\n').slice(1,5)});return original.call(this,map);};
 });
 await ready(t.page);
 const events=[];t.cdp.on('Tracing.dataCollected',d=>events.push(...d.value));
 await t.cdp.send('Tracing.start',{categories:'devtools.timeline,blink.user_timing,disabled-by-default-devtools.timeline,disabled-by-default-devtools.screenshot',transferMode:'ReportEvents'});
 await t.cdp.send('Profiler.enable');await t.cdp.send('Profiler.start');
 const start=await t.page.evaluate(()=>performance.now());await zoomMockMap(t.page,15);await t.page.waitForTimeout(700);
 const profile=await t.cdp.send('Profiler.stop');
 const complete=new Promise(r=>t.cdp.once('Tracing.tracingComplete',r));await t.cdp.send('Tracing.end');await complete;
 const raw={kind,start,metrics:await metrics(t.page),actions:await t.page.evaluate(()=>window.__poolActions),errors:t.errors};
 await writeFile(new URL('raw.json',root),JSON.stringify(raw,null,2)+'\n',{flag:'wx'});
 await writeFile(new URL('trace.json',root),JSON.stringify({traceEvents:events})+'\n',{flag:'wx'});
 await writeFile(new URL('profile.json',root),JSON.stringify(profile)+'\n',{flag:'wx'});
 await t.page.screenshot({path:new URL('after.png',root).pathname});
 console.log(JSON.stringify({start,actions:raw.actions.filter(x=>x.time>start).map(x=>({time:x.time-start,attached:x.attached,stack:x.stack})),frames:raw.metrics.frames.filter(f=>f.t>start).slice(0,12)}));
}finally{await run.close();}
