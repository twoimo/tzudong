import {spawn} from 'node:child_process';
import {readFile,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
const here=new URL('./',import.meta.url),planFile=new URL('browser-confirm-plan-v6.json',here);
const plan=JSON.parse(await readFile(planFile));
const result={startedAtUtc:new Date().toISOString(),phases:[],plan:'browser-confirm-plan-v6.json',fieldAdmission:0,performanceAdmission:0};
for(const phase of plan.phases){
  for(const run of phase.runs){
    console.log(JSON.stringify({phase:phase.name,label:run.label,kind:run.kind,state:'starting'}));
    const child=spawn(process.execPath,[fileURLToPath(new URL('measure-ui-v6.mjs',here)),run.kind,run.label,'128','2'],{stdio:'inherit',env:process.env});
    const exit=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',resolve);});
    let raw;
    try{raw=JSON.parse(await readFile(new URL(`ui-${run.label}/raw.json`,here)));}catch{}
    const matched=exit===0&&raw?.passed&&raw.cycles.length===256&&raw.requests?.unsupportedFixtureQueries===undefined&&raw.sdkScript?.sha256===plan.sdkScriptSha256;
    const receipt={phase:phase.name,...run,exit,matched,endedAtUtc:new Date().toISOString()};
    result.phases.push(receipt);
    await writeFile(new URL(`series-${run.label}-receipt.json`,here),JSON.stringify(receipt,null,2)+'\n',{flag:'wx'});
    console.log(JSON.stringify({phase:phase.name,label:run.label,state:'ended',matched}));
    if(!matched){result.stopReason='browser_data_or_sdk_equivalence_failed';process.exitCode=1;break;}
  }
  if(process.exitCode)break;
}
result.endedAtUtc=new Date().toISOString();
await writeFile(new URL('browser-series-final-v6.json',here),JSON.stringify(result,null,2)+'\n',{flag:'wx'});
