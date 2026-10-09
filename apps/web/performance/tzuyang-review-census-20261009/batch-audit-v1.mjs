import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {parse} from 'dotenv';
import {GoogleGenAI,ThinkingLevel} from '@google/genai';
const hash=v=>createHash('sha256').update(typeof v==='string'?v:JSON.stringify(v)).digest('hex');
const root='/Users/twoimo/.codex/runtime-cache/tzuyang-review-census-20261009';
const sourceRaw=readFileSync(root+'/restaurants-review-snapshot-v1.json','utf8');
const manifest=JSON.parse(readFileSync(new URL('./export-manifest-v1.json',import.meta.url)));
if(hash(sourceRaw)!==manifest.sourceSnapshotSha256)throw Error('BATCH_SOURCE_BINDING');
const source=JSON.parse(sourceRaw),prompt=readFileSync(new URL('./audit-prompt-v1.txt',import.meta.url),'utf8');
const issueCodes=['INTERNAL_MARKER','RAW_FORMATTING','DUPLICATE_WITHIN_REVIEW','BROKEN_PROSE','EDITORIAL_FIRST_PERSON','PROMOTIONAL_VOICE','CONTRADICTION','RECORD_MISMATCH','EMPTY_REVIEW','NEEDS_VIDEO_EVIDENCE'];
const schema={type:'object',additionalProperties:false,required:['rows'],properties:{rows:{type:'array',items:{type:'object',additionalProperties:false,required:['key','status','issues','revisedReview'],properties:{key:{type:'string'},status:{type:'string',enum:['ok','fix','needs_source']},issues:{type:'array',items:{type:'string',enum:issueCodes}},revisedReview:{type:'string'}}}}}};
function safeText(s){return String(s??'').replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi,'[CONTACT]').replace(/(?:\+82[ -]?)?0(?:1[016789]|2|[3-6][1-5])[ -]?\d{3,4}[ -]?\d{4}/g,'[CONTACT]');}
const plan=[{index:0,offset:0,size:8}];for(let offset=8,index=1;offset<source.length;offset+=24,index++)plan.push({offset,index,size:24});
const requests=[],bindings=[];
for(const part of plan){
 const label=String(part.index).padStart(3,'0');
 if(existsSync(root+'/gemini-v3/batch-'+label+'.json'))continue;
 const rows=source.slice(part.offset,part.offset+part.size).map((r,i)=>({key:'r'+String(part.offset+i).padStart(4,'0'),recordName:safeText(r.approved_name??r.origin_name),channel:r.channel_name??'unknown',recordStatus:r.status,videoTitle:safeText(r.youtube_meta?.title),review:safeText(r.tzuyang_review)}));
 bindings.push({...part,rows:rows.length,label,inputSha256:hash(rows)});
 requests.push({contents:[{role:'user',parts:[{text:JSON.stringify({rows})}]}],metadata:{key:label,inputSha256:hash(rows)},config:{systemInstruction:prompt,thinkingConfig:{thinkingLevel:ThinkingLevel.HIGH,includeThoughts:false},responseMimeType:'application/json',responseJsonSchema:schema,maxOutputTokens:65536,temperature:0.1}});
}
const env=parse(readFileSync('/Users/twoimo/Documents/projects/tzudong/backend/.env'));
const ai=new GoogleGenAI({apiKey:env.GEMINI_API_KEY,httpOptions:{timeout:120000,retryOptions:{attempts:1}}});
const displayName='tzuyang-census-'+manifest.sourceSnapshotSha256.slice(0,12)+'-'+hash(prompt).slice(0,12)+'-remaining224';
const intent=new URL('./batch-create-intent-v1.json',import.meta.url),receipt=new URL('./batch-job-v1.json',import.meta.url);
function minimal(job){return {name:job.name,displayName:job.displayName,model:job.model,state:job.state,createTime:job.createTime,updateTime:job.updateTime,requestCount:bindings.length,expectedRows:bindings.reduce((n,b)=>n+b.rows,0),sourceSnapshotSha256:manifest.sourceSnapshotSha256,promptSha256:hash(prompt),requestedModel:'gemini-3.8-flash',requestedThinkingLevel:'HIGH',maxOutputTokens:65536,operatingDataWrites:0,normalInferenceJob:true,paidCapacityPurchase:false};}
let job;
if(existsSync(receipt)){
 const prior=JSON.parse(readFileSync(receipt));job=await ai.batches.get({name:prior.name});
}else if(existsSync(intent)){
 const saved=JSON.parse(readFileSync(intent));if(saved.requestSha256!==hash(requests))throw Error('BATCH_INTENT_DRIFT');
 const pager=await ai.batches.list({config:{pageSize:100}});const found=[];for await(const x of pager){if(x.displayName===displayName)found.push(x);}
 if(found.length!==1)throw Error('BATCH_CREATE_OUTCOME_REQUIRES_RECONCILIATION');
 job=await ai.batches.get({name:found[0].name});
 writeFileSync(receipt,JSON.stringify(minimal(job),null,2)+'\n',{flag:'wx'});
}else{
 if(Buffer.byteLength(JSON.stringify(requests))>=20*1024*1024||bindings.length!==60||bindings.reduce((n,b)=>n+b.rows,0)!==1435)throw Error('BATCH_COVERAGE_BOUND');
 writeFileSync(root+'/batch-requests-v1.json',JSON.stringify(requests)+'\n',{flag:'wx',mode:0o600});
 writeFileSync(new URL('./batch-input-bindings-v1.json',import.meta.url),JSON.stringify({bindings,requestedModel:'gemini-3.8-flash',thinkingLevel:'HIGH',sourceSnapshotSha256:manifest.sourceSnapshotSha256,promptSha256:hash(prompt)},null,2)+'\n',{flag:'wx'});
 writeFileSync(intent,JSON.stringify({displayName,requestSha256:hash(requests),requestBytes:Buffer.byteLength(JSON.stringify(requests)),requestCount:bindings.length,rows:1435,completed224Reused:true,automaticRetries:1,startedAtUtc:new Date().toISOString()})+'\n',{flag:'wx'});
 try{job=await ai.batches.create({model:'gemini-3.8-flash',src:requests,config:{displayName}});}
 catch(e){writeFileSync(new URL('./batch-create-unconfirmed-v1.json',import.meta.url),JSON.stringify({httpStatus:typeof e?.status==='number'?e.status:null,providerMessagePersisted:false,blindRetryAllowed:false})+'\n',{flag:'wx'});throw Error('BATCH_CREATE_UNCONFIRMED_RECONCILE_BY_DISPLAY_NAME');}
 if(!job.name)throw Error('BATCH_NAME_UNCONFIRMED');
 writeFileSync(receipt,JSON.stringify(minimal(job),null,2)+'\n',{flag:'wx'});
 const check=await ai.batches.get({name:job.name});if(check.name!==job.name)throw Error('BATCH_JOB_READBACK_MISMATCH');job=check;
}
const meta=minimal(job);writeFileSync(new URL('./batch-status-'+Date.now()+'.json',import.meta.url),JSON.stringify(meta,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify(meta));
