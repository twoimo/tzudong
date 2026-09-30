import {launch,save} from './runtime.mjs';import {clusterSample} from './sample.mjs';
const run=await launch('candidate'),samples=[];
try{for(const options of [{mobile:false,count:735,cpu:1},{mobile:true,count:735,cpu:1},{mobile:false,count:3,cpu:1}]){const sample=await clusterSample(run.browser,options);samples.push({options,...sample});console.log(JSON.stringify({options,valid:sample.summary.valid,markers:sample.summary.markerCount,errors:sample.errors}));}await save('preflight-final-v1',{build:run.receipt,samples});}
catch(e){await save('preflight-final-v1-rejected',{build:run.receipt,samples,failure:e.name,safeState:e.safeState||null});throw e;}
finally{await run.close();}
