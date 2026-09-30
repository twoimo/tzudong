import {launch,save} from './runtime.mjs';
import {clusterSample} from './sample.mjs';
import {resourceSnapshot} from './resources.mjs';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
const label=process.argv[2]||'baseline-aa-final-v1',root=new URL(label+'/',import.meta.url);await mkdir(root);
for(const name of ['runtime.mjs','sample.mjs','baseline-aa-final.mjs','resources.mjs','plan-v4.json'])await writeFile(new URL(name+'.txt',root),await readFile(new URL(name,import.meta.url)),{flag:'wx'});
const run=await launch(),raw={receipt:run.receipt,browser:run.browser.version(),samples:[],warmups:[],scope:'Current-sampler production baseline A/A; independent contexts, 2 warmups/cell. Shared host. Old A/A floor is retained without lowering budgets.'};
try{
 for(let index=-4;index<12;index++){
  const mobile=Math.abs(index)%2===1,resourceBefore=resourceSnapshot(),sample=await clusterSample(run.browser,{mobile}),resourceAfter=resourceSnapshot();
  (index<0?raw.warmups:raw.samples).push({index,mobile,resourceBefore,resourceAfter,...sample});
  console.log(JSON.stringify({index,mobile,ms:sample.summary.clickToExpandedMs,valid:sample.summary.valid,heavy:resourceBefore.heavyOverlap||resourceAfter.heavyOverlap}));
 }
 await save(label,raw);
}catch(e){await save(label+'-rejected',{...raw,failure:e.name,safeState:e.safeState||null});throw e;}
finally{await run.close();}
