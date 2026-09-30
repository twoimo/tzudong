import {tmpdir} from 'node:os';import {join} from 'node:path';import {fileURLToPath} from 'node:url';
import {readFile,writeFile,mkdir,mkdtemp} from 'node:fs/promises';import {createHash} from 'node:crypto';import {execFileSync} from 'node:child_process';
import {launch,setup,ready} from './runtime.mjs';
const here=new URL('./',import.meta.url),root=new URL((process.argv[2]||'pool-dom-final-v2')+'/',here);await mkdir(root);await writeFile(new URL('pool-browser-dom.mjs.txt',root),await readFile(new URL('pool-browser-dom.mjs',here)),{flag:'wx'});
const baseline=execFileSync('git',['show','da805ea2602f4ed83e6e77e52e9da0b74ba2f8c5:apps/web/lib/marker-pool.ts']);
await writeFile(new URL('baseline-pool.ts.txt',root),baseline,{flag:'wx'});
const current=await readFile(new URL('../../lib/marker-pool.ts',here));await writeFile(new URL('candidate-pool.ts.txt',root),current,{flag:'wx'});
const scratch=await mkdtemp(join(tmpdir(),'tzudong-pool-dom-'));
const prefix='import { createIndividualMarkerHTML } from '+JSON.stringify(fileURLToPath(new URL('../../lib/cluster-marker.ts',here)))+';\n';
for(const kind of ['baseline','candidate']){
 await writeFile(join(scratch,`${kind}-pool.ts`),kind==='baseline'?baseline:current,{flag:'wx'});
 const contents=prefix+`import { MarkerPool } from './${kind}-pool';\nglobalThis.__poolDOMProbe={MarkerPool,createIndividualMarkerHTML};\n`;
 const entry=join(scratch,`${kind}-entry.ts`);await writeFile(entry,contents,{flag:'wx'});await writeFile(new URL(`${kind}-entry.ts.txt`,root),contents,{flag:'wx'});
 const build=await Bun.build({entrypoints:[entry],target:'browser',format:'iife',minify:false});if(!build.success)throw Error('probe bundle compilation');
 await writeFile(new URL(`${kind}.js`,root),await build.outputs[0].text(),{flag:'wx'});
}
const run=await launch('candidate'),raw={scope:'Supplemental real-DOM pool API accuracy test with simulated provider; user pan/detail integration is separately in regression-candidate-v6-v1. No performance claim.',sources:{baseline:createHash('sha256').update(baseline).digest('hex'),candidate:createHash('sha256').update(current).digest('hex')},variants:[]};
try{
 for(const kind of ['baseline','candidate']){
  const t=await setup(run.browser,{cpu:1});try{
   await ready(t.page);await t.page.addScriptTag({content:await readFile(new URL(`${kind}.js`,root),'utf8')});
   const result=await t.page.evaluate(async()=>{
    const {MarkerPool,createIndividualMarkerHTML}=window.__poolDOMProbe,pool=MarkerPool.getInstance(),map=window.__TZUDONG_DEBUG_MAP__;
    const pos=()=>new window.naver.maps.LatLng(map.getCenter().lat(),map.getCenter().lng()),icon=(id,n,bubble=false)=>({content:createIndividualMarkerHTML('분식',false,n,id).replace('</div>',bubble?'<div data-visible-marker-review-bubble="true">fixture-review</div></div>':'</div>'),anchor:new window.naver.maps.Point(16,16)});
    const steps=[];let marker;
    const read=(phase,expectedId,expectedCount)=>{const node=marker.getElement().querySelector('[data-testid="marker"]'),badge=node.querySelector('[data-tzuyang-visit-count-badge="true"]');steps.push({phase,expectedId,actualId:node.getAttribute('data-restaurant-id'),expectedCount,actualCount:badge?Number(badge.textContent.trim()):0,badgeLabel:badge?.getAttribute('aria-label')||null,coordinateMatches:marker.getPosition().lat()===map.getCenter().lat()&&marker.getPosition().lng()===map.getCenter().lng()});};
    marker=pool.acquire('fixture-a',pos(),icon('fixture-a',0),map);pool.release('fixture-a');marker=pool.acquire('fixture-b',pos(),icon('fixture-b',0),map);read('reuse-a-to-b','fixture-b',0);
    for(const count of [2,3,0]){marker=pool.acquire('fixture-b',pos(),icon('fixture-b',count),map);read(`visit-${count}`,'fixture-b',count);}
    const beforeImage=marker.getElement().querySelector('img');marker=pool.acquire('fixture-b',pos(),icon('fixture-b',0,true),map);const sameImage=beforeImage===marker.getElement().querySelector('img');read('same-id-bubble-only','fixture-b',0);
    marker=pool.acquire('fixture-c',pos(),icon('fixture-c',2),map);read('fresh-same-id-visit-2','fixture-c',2);marker=pool.acquire('fixture-c',pos(),icon('fixture-c',3),map);read('same-id-2-to-3','fixture-c',3);marker=pool.acquire('fixture-c',pos(),icon('fixture-c',0),map);read('same-id-badge-removal','fixture-c',0);
    const result={steps,sameImageOnBubbleOnly:sameImage,accuracyFailures:steps.filter(s=>s.expectedId!==s.actualId||s.expectedCount!==s.actualCount||!s.coordinateMatches).length};
    await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));return result;
   });
   raw.variants.push({kind,result});await t.page.screenshot({path:new URL(`${kind}-final.png`,root).pathname});
  }finally{await t.context.close();}
 }
 await writeFile(new URL('raw.json',root),JSON.stringify(raw,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(raw.variants));if(raw.variants.find(v=>v.kind==='candidate').result.accuracyFailures!==0)throw Error('candidate pool DOM accuracy failed');
}finally{await run.close();}
