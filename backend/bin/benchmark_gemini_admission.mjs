#!/usr/bin/env node
/** Local SDK transport and uncooperative-response replay; zero Google requests. */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createServer } from 'node:http';
import { performance } from 'node:perf_hooks';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { omitUnsupportedGeminiSampling, createGeminiClient, generateWithProjectBudget } from '../utils/gemini-client.mjs';
import { withProjectBudget } from '../utils/provider-budget.mjs';

const root=fileURLToPath(new URL('../../',import.meta.url));
const argv=process.argv.slice(2);const index=argv.indexOf('--output');
if(index<0||!argv[index+1])throw new Error('OUTPUT_REQUIRED');
const output=argv[index+1];if(fs.existsSync(output))throw new Error('OUTPUT_ALREADY_EXISTS');
const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'gemini-admission-replay-'));
Object.assign(process.env,{GEMINI_BUDGET_PATH:path.join(temporary,'budget.sqlite'),GEMINI_BUDGET_PROJECT:'sdk-replay',GEMINI_REQUESTS_PER_MINUTE:'100000',GEMINI_MAX_INFLIGHT:'1'});
const hash=value=>createHash('sha256').update(value).digest('hex');
const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'
    ?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const config=omitUnsupportedGeminiSampling('gemini-3.7-flash',{temperature:.1,maxOutputTokens:8192,responseMimeType:'application/json',thinkingConfig:{thinkingLevel:'MEDIUM'}});
let current;
const server=createServer(async(req,res)=>{
    current.calls++;current.active++;current.peak=Math.max(current.peak,current.active);
    let body='';for await(const piece of req)body+=piece;
    const payload=JSON.parse(body);current.requestHashes.push(hash(JSON.stringify(canonical({contents:payload.contents,generationConfig:payload.generationConfig}))));
    await pause(30);current.active--;
    res.writeHead(200,{'content-type':'application/json'});
    res.end(JSON.stringify({candidates:[{content:{role:'model',parts:[{text:'{"ok":true}'}]}}]}));
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const baseUrl=`http://127.0.0.1:${server.address().port}`;
const observations=[];
try {
    for(const scenario of ['unguarded-merge','timeout-unsettled'])for(let repeat=0;repeat<7;repeat++)
        for(const implementation of repeat%2?['candidate','baseline']:['baseline','candidate']){
            current={calls:0,active:0,peak:0,requestHashes:[]};let returnedWhileWorkActive=0;
            const used=process.cpuUsage();const started=performance.now();let results;
            if(scenario==='unguarded-merge'){
                if(implementation==='baseline'){
                    const model=new GoogleGenerativeAI('fixture').getGenerativeModel({model:'gemini-3.7-flash',generationConfig:config},{baseUrl});
                    results=await Promise.all(Array.from({length:6},async()=>{const result=await model.generateContent('fixture');return result.response.text();}));
                }else{
                    const ai=createGeminiClient('fixture');
                    results=await Promise.all(Array.from({length:6},async()=>{
                        const result=await generateWithProjectBudget(ai,{model:'gemini-3.7-flash',contents:'fixture',config:{...config,httpOptions:{baseUrl}}});return result.text;
                    }));
                }
            }else{
                let begin;const begun=new Promise(resolve=>begin=resolve);const pending=[];
                const fake={models:{generateContent:async request=>{
                    current.calls++;current.active++;current.peak=Math.max(current.peak,current.active);begin();
                    const response=(async()=>{await pause(request.contents==='first'?220:10);current.active--;return {text:'{"ok":true}'};})();
                    pending.push(response);return response;
                }}};
                const run=contents=>implementation==='candidate'
                    ?generateWithProjectBudget(fake,{model:'gemini-3.7-flash',contents},contents==='first'?20:1000)
                    :withProjectBudget(async()=>{
                        if(contents!=='first')return fake.models.generateContent({contents});
                        let timer;
                        try{return await Promise.race([fake.models.generateContent({contents}),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Object.assign(new Error('GEMINI_API_TIMEOUT'),{code:'GEMINI_API_TIMEOUT'})),20);})]);}
                        finally{clearTimeout(timer);}
                    });
                const first=run('first').then(()=> 'unexpected_success',error=>{if(current.active) returnedWhileWorkActive++;return error.code;});
                await begun;await pause(30);
                const second=run('second').then(result=>result.text);
                results=await Promise.all([first,second]);await Promise.allSettled(pending);
            }
            const wallMs=performance.now()-started;const cpu=process.cpuUsage(used);
            if(current.active!==0)throw new Error('REPLAY_NOT_DRAINED');
            observations.push({scenario,implementation,repeat,wallMs,nodeCpuMs:(cpu.user+cpu.system)/1000,
                calls:current.calls,peakActive:current.peak,returnedWhileWorkActive,
                configuredConcurrency:1,concurrencyViolations:Math.max(0,current.peak-1),
                resultSha256:hash(JSON.stringify(results)),requestHashes:current.requestHashes});
        }
    const sources=['backend/utils/gemini-client.mjs','backend/utils/provider-budget.mjs','backend/utils/provider_budget.py',
        'backend/restaurant-crawling/scripts/final_merge_chunk.mjs','backend/restaurant-crawling/scripts/gemini_chunk_video_request.mjs',
        'backend/restaurant-evaluation/scripts/gemini_api_request.mjs'];
    const report={kind:'controlled_gemini_admission_replay',measuredAt:new Date().toISOString(),
        sourceCommit:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),
        sourceFiles:Object.fromEntries(sources.map(file=>[file,hash(fs.readFileSync(path.join(root,file)))])),
        benchmarkSourceSha256:hash(fs.readFileSync(fileURLToPath(import.meta.url))),
        environment:{node:process.version,platform:process.platform,architecture:process.arch,
            sdk:JSON.parse(fs.readFileSync(new URL('../node_modules/@google/genai/package.json',import.meta.url),'utf8')).version},
        settings:{pairsPerCondition:7,concurrency:1,rpm:100000,httpFixtureDelayMs:30,uncooperativeWorkMs:220,deadlineMs:20,
            actualGoogleRequests:0,rateScope:'Isolated replay settings only; not operational quota.'},
        limitations:['Local loopback HTTP and simulated uncooperative SDK; not provider latency or cost.',
            'Concurrency means admitted client operations; aborting a client does not cancel remote computation or billing.',
            'Baseline violates configured concurrency; elapsed-time differences are not a like-for-like speed claim.',
            'Node CPU excludes Python budget children.'],observations};
    fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n',{flag:'wx'});
    console.log(JSON.stringify({observations:observations.length,googleRequests:0,
        peakByScenario:Object.fromEntries(['unguarded-merge','timeout-unsettled'].map(scenario=>[scenario,
            Object.fromEntries(['baseline','candidate'].map(implementation=>[implementation,Math.max(...observations.filter(row=>row.scenario===scenario&&row.implementation===implementation).map(row=>row.peakActive))]))]))}));
}finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));fs.rmSync(temporary,{recursive:true,force:true});}
