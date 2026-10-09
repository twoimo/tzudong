import {validateAuditRows} from './audit-response-v2.mjs';
import {batchDisposition} from './batch-state-v2.mjs';
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {parse} from 'dotenv';import {createHash} from 'node:crypto';import {GoogleGenAI} from '@google/genai';
const root='/Users/twoimo/.codex/runtime-cache/tzuyang-review-census-20261009/gemini-v3';
const hash=v=>createHash('sha256').update(v).digest('hex');
const receipt=JSON.parse(readFileSync(new URL('./batch-job-v1.json',import.meta.url)));
const binding=JSON.parse(readFileSync(new URL('./batch-input-bindings-v1.json',import.meta.url)));
if(receipt.requestedModel!=='gemini-3.8-flash'||receipt.requestedThinkingLevel!=='HIGH'||receipt.sourceSnapshotSha256!==binding.sourceSnapshotSha256)throw Error('BATCH_BINDING_DENIED');
const env=parse(readFileSync('/Users/twoimo/Documents/projects/tzudong/backend/.env'));
const ai=new GoogleGenAI({apiKey:env.GEMINI_API_KEY,httpOptions:{timeout:120000,retryOptions:{attempts:1}}});
let result={observedAtUtc:new Date().toISOString(),name:receipt.name,status:'unconfirmed',admittedRows:0,admittedRequests:0,incomplete:[],operatingWrites:0};
try{
 const job=await ai.batches.get({name:receipt.name});if(job.name!==receipt.name)throw Error('BATCH_NAME_DRIFT');
 result.state=job.state;
 const disposition=batchDisposition(job.state);
 if(disposition.action==='wait'){result.status=disposition.status;}
 else if(disposition.action==='stop'){result.status=disposition.status;result.failureCode=disposition.failureCode;process.exitCode=1;}
 else{
  const replies=job.dest?.inlinedResponses;
  if(!Array.isArray(replies)||replies.length!==binding.bindings.length)throw Error('BATCH_RESPONSE_COUNT_DENIED');
  for(let i=0;i<replies.length;i++){
   const b=binding.bindings[i],entry=replies[i],response=entry.response;
   if(entry.metadata?.key&&entry.metadata.key!==b.label)throw Error('BATCH_RESPONSE_KEY_DENIED');
   if(entry.metadata?.inputSha256&&entry.metadata.inputSha256!==b.inputSha256)throw Error('BATCH_RESPONSE_INPUT_DENIED');
   const path=root+'/batch-'+b.label+'.json';if(existsSync(path))continue;
   if(entry.error){result.incomplete.push({index:b.index,class:'provider_error',code:typeof entry.error.code==='number'?entry.error.code:null});continue;}
   if(response?.modelVersion!=='gemini-3.8-flash'||response.candidates?.length!==1||response.candidates[0].finishReason!=='STOP'){result.incomplete.push({index:b.index,class:'finish_or_model_unconfirmed'});continue;}
   const text=(response.candidates[0].content?.parts??[]).filter(p=>!p.thought&&typeof p.text==='string').map(p=>p.text).join('');
   const responseMeta={index:b.index,actualModelVersion:response.modelVersion,requestedThinkingLevel:'HIGH',finishReason:response.candidates[0].finishReason,usage:response.usageMetadata,inputSha256:b.inputSha256,promptSha256:binding.promptSha256,jobName:receipt.name,thoughtsPersisted:false};
   const rawPath=root+'/response-'+b.label+'-batch-v1.json';if(!existsSync(rawPath))writeFileSync(rawPath,JSON.stringify({...responseMeta,text},null,2)+'\n',{flag:'wx',mode:0o600});
   let parsed;try{parsed=JSON.parse(text);}catch{result.incomplete.push({index:b.index,class:'json_unconfirmed'});continue;}
   if(!Array.isArray(parsed?.rows)||parsed.rows.length!==b.rows){result.incomplete.push({index:b.index,class:'coverage_unconfirmed'});continue;}
   const valid=validateAuditRows(parsed.rows,b);
   if(!valid){result.incomplete.push({index:b.index,class:'schema_unconfirmed'});continue;}
   const saved={index:b.index,startedAtUtc:job.createTime,endedAtUtc:job.updateTime,inputSha256:b.inputSha256,promptSha256:binding.promptSha256,model:'gemini-3.8-flash',actualModelVersion:response.modelVersion,thinkingLevel:'HIGH',usage:response.usageMetadata,rows:parsed.rows,sourceSnapshotSha256:binding.sourceSnapshotSha256,batchJobName:receipt.name};
   writeFileSync(path,JSON.stringify(saved,null,2)+'\n',{flag:'wx',mode:0o600});
   writeFileSync(new URL('./model-batch-'+b.label+'-async-v1.json',import.meta.url),JSON.stringify({...responseMeta,rows:parsed.rows.map(r=>({key:r.key,status:r.status,issues:r.issues,revisedReviewSha256:hash(r.revisedReview)}))},null,2)+'\n',{flag:'wx'});
   result.admittedRequests++;result.admittedRows+=b.rows;
  }
  result.status=result.incomplete.length && !result.admittedRequests ? 'rejected' : (result.incomplete.length||disposition.partial)?'partial':'ingested';
 }
}catch(error){result.failureCode=/^[A-Z_]+$/.test(error?.message??'')?error.message:'BATCH_STATUS_UNCONFIRMED';result.httpStatus=typeof error?.status==='number'?error.status:null;process.exitCode=1;}
writeFileSync(new URL('./batch-ingest-v2-status-'+Date.now()+'.json',import.meta.url),JSON.stringify(result,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(result));
