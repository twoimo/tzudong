import {launch,setup,ready,metrics} from './runtime.mjs';import {mkdir,writeFile,readFile} from 'node:fs/promises';
const root=new URL('memory-gc-diagnostic-v1/',import.meta.url);await mkdir(root);for(const file of ['memory-gc.mjs','runtime.mjs','plan-v6.json'])await writeFile(new URL(file+'.txt',root),await readFile(new URL(file,import.meta.url)),{flag:'wx'});
const raw={scope:'Separate retained-heap diagnostic after explicit CDP GC, count2000 CPU4. Three paired independent whole server/browser executions; minimal DOM observers, not the full timing sampler. This does not replace or waive the original natural-heap 20% budget violation. No heap object/snapshot/cookies/headers stored.',pairs:[]};
for(let index=0;index<3;index++){
 const pair={index,order:index%2===0?['baseline','candidate']:['candidate','baseline']};
 for(const kind of pair.order){const run=await launch(kind);const t=await setup(run.browser,{count:2000,cpu:4});try{
  await ready(t.page);await t.page.locator('.cluster-marker-container').first().click();await t.page.waitForFunction(expected=>window.__TZUDONG_DEBUG_MAP__.getZoom()===14&&document.querySelectorAll('[data-testid="marker"]').length===expected,kind==='baseline'?2000:143);await t.page.waitForTimeout(600);
  const beforeGc=await t.cdp.send('Runtime.getHeapUsage');await t.cdp.send('HeapProfiler.collectGarbage');const afterGc=await t.cdp.send('Runtime.getHeapUsage');
  pair[kind]={receipt:run.receipt,browser:run.browser.version(),beforeGc,afterGc,metrics:await metrics(t.page),markerCount:await t.page.locator('[data-testid="marker"]').count(),errors:t.errors};
 }finally{await t.context.close();await run.close();}}
 raw.pairs.push(pair);await writeFile(new URL(`pair-${index}.json`,root),JSON.stringify(pair,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({index,usedBeforeGc:pair.order.map(k=>[k,pair[k].beforeGc.usedSize]),usedAfterGc:pair.order.map(k=>[k,pair[k].afterGc.usedSize])}));
}
await writeFile(new URL('raw.json',root),JSON.stringify(raw,null,2)+'\n',{flag:'wx'});
