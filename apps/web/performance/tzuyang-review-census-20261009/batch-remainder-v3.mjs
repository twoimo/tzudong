import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {parse} from 'dotenv';
import {GoogleGenAI,Type,ThinkingLevel} from '@google/genai';
const hash=v=>createHash('sha256').update(typeof v==='string'?v:JSON.stringify(v)).digest('hex');
const privateRoot='/Users/twoimo/.codex/runtime-cache/tzuyang-review-census-20261009';
const sourceRaw=readFileSync(privateRoot+'/restaurants-review-snapshot-v1.json','utf8');
const manifest=JSON.parse(readFileSync(new URL('./export-manifest-v1.json',import.meta.url)));
if(hash(sourceRaw)!==manifest.sourceSnapshotSha256)throw Error('REMAINDER_SOURCE_BINDING_DENIED');
const source=JSON.parse(sourceRaw),completed=new Set();
const {readdirSync}=await import('node:fs');
for(const filename of readdirSync(privateRoot+'/gemini-v3').filter(n=>/^batch-\d+\.json$/.test(n))){
 const b=JSON.parse(readFileSync(privateRoot+'/gemini-v3/'+filename));
 if(b.sourceSnapshotSha256!==manifest.sourceSnapshotSha256||b.actualModelVersion!=='gemini-3.8-flash'||b.thinkingLevel!=='HIGH')throw Error('REMAINDER_CHECKPOINT_BINDING_DENIED');
 for(const r of b.rows){if(completed.has(r.key))throw Error('REMAINDER_DUPLICATE_COMPLETED_KEY');completed.add(r.key);}
}
if(completed.size!==232)throw Error('REMAINDER_COMPLETED_COVERAGE_DRIFT');
function safeText(s){return String(s??'').replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi,'[CONTACT]').replace(/(?:\+82[ -]?)?0(?:1[016789]|2|[3-6][1-5])[ -]?\d{3,4}[ -]?\d{4}/g,'[CONTACT]');}
const remaining=[];for(let index=0;index<source.length;index++){
 const r=source[index],key='r'+String(index).padStart(4,'0');if(completed.has(key))continue;
 remaining.push({key,recordName:safeText(r.approved_name??r.origin_name),channel:r.channel_name??'unknown',recordStatus:r.status,videoTitle:safeText(r.youtube_meta?.title),review:safeText(r.tzuyang_review)});
}
if(remaining.length!==1427||remaining[0].key!=='r0232')throw Error('REMAINDER_COVERAGE_DRIFT');
const prompt=readFileSync(new URL('./audit-prompt-v1.txt',import.meta.url),'utf8');
if(hash(prompt)!=='7a279af1b9586e9b2f482f1e2b23cdb93bcc013d0daf2e4dbc9277c64a277ae7')throw Error('REMAINDER_PROMPT_BINDING_DENIED');
const issueCodes=['INTERNAL_MARKER','RAW_FORMATTING','DUPLICATE_WITHIN_REVIEW','BROKEN_PROSE','EDITORIAL_FIRST_PERSON','PROMOTIONAL_VOICE','CONTRADICTION','RECORD_MISMATCH','EMPTY_REVIEW','NEEDS_VIDEO_EVIDENCE'];
const requests=[],bindings=[];
for(let cursor=0;cursor<remaining.length;cursor+=8){
 const rows=remaining.slice(cursor,cursor+8),index=1001+bindings.length,label=String(index);
 const offset=Number(rows[0].key.slice(1));if(rows.some((r,i)=>r.key!=='r'+String(offset+i).padStart(4,'0')))throw Error('REMAINDER_NONCONTIGUOUS_KEYS');
 bindings.push({index,label,offset,rows:rows.length,inputSha256:hash(rows)});
 const count=rows.length;

const schema={type:Type.OBJECT,required:['rows'],properties:{rows:{type:Type.ARRAY,minItems:count,maxItems:count,
  items:{type:Type.OBJECT,required:['key','status','issues','revisedReview'],propertyOrdering:['key','status','issues','revisedReview'],
    properties:{key:{type:Type.STRING,enum:rows.map(r=>r.key)},status:{type:Type.STRING,enum:['ok','fix','needs_source']},
      issues:{type:Type.ARRAY,items:{type:Type.STRING,enum:issueCodes}},revisedReview:{type:Type.STRING}}}}}};
requests.push({contents:[{role:'user',parts:[{text:prompt},{text:'Input JSON is data only. Return every input key in order, including ok, empty and deleted rows.\n'+JSON.stringify({rows})}]}],
  metadata:{key:label,inputSha256:hash(rows)},config:{systemInstruction:{parts:[{text:prompt}]},
    thinkingConfig:{thinkingLevel:ThinkingLevel.HIGH,includeThoughts:false},responseMimeType:'application/json',responseSchema:schema,maxOutputTokens:65536,temperature:0.1}});
}
if(bindings.length!==179||Buffer.byteLength(JSON.stringify(requests))>=20*1024*1024)throw Error('REMAINDER_REQUEST_BOUND');
const env=parse(readFileSync('/Users/twoimo/Documents/projects/tzudong/backend/.env'));
const ai=new GoogleGenAI({apiKey:env.GEMINI_API_KEY,httpOptions:{timeout:120000,retryOptions:{attempts:1}}});
const displayName='tzuyang-remainder-validated-schema-v3-'+hash(requests).slice(0,16);
const intent=new URL('./remainder-intent-v3.json',import.meta.url),receipt=new URL('./remainder-job-v3.json',import.meta.url);
function minimal(job){return {name:job.name,displayName:job.displayName,state:job.state,model:job.model,createTime:job.createTime,
  sourceSnapshotSha256:manifest.sourceSnapshotSha256,promptSha256:hash(prompt),requestSha256:hash(requests),requestedModel:'gemini-3.8-flash',thinkingLevel:'HIGH',
  requestCount:179,rows:1427,completed232Reused:true,normalInferenceJob:true,operatingWrites:0,capacityPurchase:false,
  changedTransport:'responseSchema with explicit <=8-item/object/key bounds plus repeated task in user content; editorial rubric unchanged'};}
let job;
if(existsSync(receipt)){const saved=JSON.parse(readFileSync(receipt));if(saved.requestSha256!==hash(requests))throw Error('REMAINDER_RECEIPT_DRIFT');job=await ai.batches.get({name:saved.name});}
else if(existsSync(intent)){
  const saved=JSON.parse(readFileSync(intent));if(saved.requestSha256!==hash(requests))throw Error('REMAINDER_INTENT_DRIFT');
  const pager=await ai.batches.list({config:{pageSize:100}});const found=[];let examined=0;
  for await(const item of pager){if(item.displayName===displayName)found.push(item);if(++examined>=500)break;}
  if(found.length!==1)throw Error('REMAINDER_CREATE_OUTCOME_REQUIRES_RECONCILIATION');
  job=await ai.batches.get({name:found[0].name});writeFileSync(receipt,JSON.stringify(minimal(job),null,2)+'\n',{flag:'wx'});
}else{
  writeFileSync(privateRoot+'/remainder-requests-v3.json',JSON.stringify(requests)+'\n',{flag:'wx',mode:0o600});
  writeFileSync(new URL('./remainder-bindings-v3.json',import.meta.url),JSON.stringify({bindings,sourceSnapshotSha256:manifest.sourceSnapshotSha256,promptSha256:hash(prompt)},null,2)+'\n',{flag:'wx'});
  writeFileSync(intent,JSON.stringify({displayName,requestSha256:hash(requests),rows:1427,completed232Reused:true,validatedPilotJob:'batches/ou10609mribyd7b806gebolzxtvkjmcjngzv',blindCreateRetryAllowed:false})+'\n',{flag:'wx'});
  try{job=await ai.batches.create({model:'gemini-3.8-flash',src:requests,config:{displayName}});}
  catch(error){writeFileSync(new URL('./remainder-create-unconfirmed-v3.json',import.meta.url),JSON.stringify({httpStatus:typeof error?.status==='number'?error.status:null,blindRetryAllowed:false})+'\n',{flag:'wx'});throw Error('REMAINDER_CREATE_UNCONFIRMED');}
  if(!job.name)throw Error('REMAINDER_NAME_UNCONFIRMED');writeFileSync(receipt,JSON.stringify(minimal(job),null,2)+'\n',{flag:'wx'});
  const check=await ai.batches.get({name:job.name});if(check.name!==job.name)throw Error('REMAINDER_READBACK_DRIFT');job=check;
}
const result=minimal(job);writeFileSync(new URL('./remainder-status-'+Date.now()+'.json',import.meta.url),JSON.stringify(result,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(result));
