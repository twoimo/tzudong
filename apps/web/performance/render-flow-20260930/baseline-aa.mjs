import {launch,save} from './runtime.mjs';import {clusterSample} from './sample.mjs';
const label=process.argv[2]||'baseline-aa-v3';const run=await launch(),raw={receipt:run.receipt,browser:run.browser.version(),samples:[],scope:'Local production route with anonymous synthetic catalog and simulated SDK. Independent browser context per sample. A/A pre-change noise estimation.'};
try{for(let i=0;i<12;i++){
 const sample=await clusterSample(run.browser,{mobile:i%2===1});raw.samples.push({index:i,mobile:i%2===1,...sample});console.log(JSON.stringify({index:i,mobile:i%2===1,summary:sample.summary}));
}await save(label,raw);}catch(e){await save(label+'-rejected',{...raw,failure:e.name});throw e;}finally{await run.close();}
