import {spawn} from 'node:child_process';
import {writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
const here=new URL('./',import.meta.url),results={startedAt:new Date().toISOString(),phases:[],measurementOrder:'A/A4process -> original ABBA4process pilot -> original randomized9process-pairs confirm',source:'0f6b4d0798a0825178889e7d01da212457325ed7',noConcurrentBuildsOrTests:true};
const script=fileURLToPath(new URL('measure-warm-token-values-v4.mjs',here));
for(const label of ['aa-current-v4','original-pilot-v4','original-confirm-v4']){
 console.log(JSON.stringify({phase:label,state:'starting'}));
 const child=spawn(process.execPath,[script,label],{stdio:'inherit',env:process.env});const code=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',resolve);});
 const phase={label,exit:code,endedAt:new Date().toISOString()};results.phases.push(phase);await writeFile(new URL(`orchestration-${label}-receipt.json`,here),JSON.stringify({...results},null,2)+'\n',{flag:'wx'});
 console.log(JSON.stringify({phase:label,state:'ended',exit:code}));
 if(code!==0){process.exitCode=1;break;}
 const agg=spawn('python3',[fileURLToPath(new URL('summarize-warm-token-values-v1.py',here)),label],{stdio:'inherit'});const aggCode=await new Promise((resolve,reject)=>{agg.once('error',reject);agg.once('exit',resolve);});if(aggCode!==0){process.exitCode=1;break;}
}
results.endedAt=new Date().toISOString();await writeFile(new URL('orchestration-final-receipt.json',here),JSON.stringify(results,null,2)+'\n',{flag:'wx'});
