import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {parse} from 'dotenv';
import {GoogleGenAI} from '@google/genai';
import {batchDisposition} from './batch-state-v2.mjs';
import {validateAuditRows} from './audit-response-v2.mjs';
const hash=v=>createHash('sha256').update(typeof v==='string'?v:JSON.stringify(v)).digest('hex');
const privateRoot='/Users/twoimo/.codex/runtime-cache/tzuyang-review-census-20261009';
const receipt=JSON.parse(readFileSync(new URL('./pilot-schema-job-v2.json',import.meta.url)));
const requests=JSON.parse(readFileSync(privateRoot+'/pilot-schema-requests-v2.json'));
const manifest=JSON.parse(readFileSync(new URL('./export-manifest-v1.json',import.meta.url)));
const sourceRaw=readFileSync(privateRoot+'/restaurants-review-snapshot-v1.json','utf8');
if(manifest.sourceSnapshotSha256!=='b8f06e7c5867b5ac2d8dfe5283e1ffdcf2a103a34f2e1d29333169fe4c5d38d8'||hash(sourceRaw)!==manifest.sourceSnapshotSha256)throw Error('PILOT_SOURCE_SNAPSHOT_DENIED');
const originalRows=JSON.parse(JSON.parse(readFileSync(privateRoot+'/batch-requests-v1.json'))[0].contents[0].parts[0].text).rows.slice(0,8);
if(hash(originalRows)!==receipt.inputSha256)throw Error('PILOT_ORIGINAL_INPUT_DENIED');
if(receipt.requestedModel!=='gemini-3.8-flash'||receipt.thinkingLevel!=='HIGH'||receipt.rows!==8||receipt.offset!==224||receipt.requestSha256!==hash(requests))throw Error('PILOT_BINDING_DENIED');
const env=parse(readFileSync('/Users/twoimo/Documents/projects/tzudong/backend/.env'));
const ai=new GoogleGenAI({apiKey:env.GEMINI_API_KEY,httpOptions:{timeout:120000,retryOptions:{attempts:1}}});
let result={observedAtUtc:new Date().toISOString(),name:receipt.name,status:'unconfirmed',addedAdmittedRows:0,operatingWrites:0};
try{
  const job=await ai.batches.get({name:receipt.name});if(job.name!==receipt.name)throw Error('PILOT_NAME_DRIFT');
  const disposition=batchDisposition(job.state);result.state=job.state;
  if(disposition.action!=='ingest'){result.status=disposition.status;if(disposition.action==='stop'){result.failureCode=disposition.failureCode;process.exitCode=1;}}
  else{
    const entry=job.dest?.inlinedResponses?.[0];
    if(job.dest?.inlinedResponses?.length!==1||entry?.metadata?.key!=='pilot-v2-0224'||entry.metadata.inputSha256!==receipt.inputSha256)throw Error('PILOT_RESPONSE_BINDING_DENIED');
    const response=entry.response;if(entry.error||response?.modelVersion!=='gemini-3.8-flash'||response.candidates?.length!==1||response.candidates[0].finishReason!=='STOP')throw Error('PILOT_FINISH_OR_MODEL_DENIED');
    const text=(response.candidates[0].content?.parts??[]).filter(p=>!p.thought&&typeof p.text==='string').map(p=>p.text).join('');
    const raw={jobName:job.name,inputSha256:receipt.inputSha256,promptSha256:receipt.promptSha256,actualModelVersion:response.modelVersion,finishReason:'STOP',usage:response.usageMetadata,text,thoughtsPersisted:false};
    const rawPath=privateRoot+'/pilot-schema-response-v2.json';if(!existsSync(rawPath))writeFileSync(rawPath,JSON.stringify(raw,null,2)+'\n',{flag:'wx',mode:0o600});
    let parsed;try{parsed=JSON.parse(text);}catch{throw Error('PILOT_JSON_DENIED');}
    if(!parsed||typeof parsed!=='object'||Array.isArray(parsed)||Object.keys(parsed).join(',')!=='rows'||!validateAuditRows(parsed.rows,{rows:8,offset:224}))throw Error('PILOT_COVERAGE_OR_SCHEMA_DENIED');
    const saved={index:1000,startedAtUtc:job.createTime,endedAtUtc:job.updateTime,inputSha256:receipt.inputSha256,promptSha256:receipt.promptSha256,
      model:'gemini-3.8-flash',actualModelVersion:response.modelVersion,thinkingLevel:'HIGH',usage:response.usageMetadata,rows:parsed.rows,
      sourceSnapshotSha256:manifest.sourceSnapshotSha256,batchJobName:receipt.name};
    const path=privateRoot+'/gemini-v3/batch-1000.json';
    if(existsSync(path)){const old=JSON.parse(readFileSync(path));if(hash(old)!==hash(saved))throw Error('PILOT_CHECKPOINT_DRIFT');}
    else{writeFileSync(path,JSON.stringify(saved,null,2)+'\n',{flag:'wx',mode:0o600});result.addedAdmittedRows=8;}
    const publicPath=new URL('./model-pilot-1000-schema-v2.json',import.meta.url);
    if(!existsSync(publicPath))writeFileSync(publicPath,JSON.stringify({...raw,text:undefined,sourceSnapshotSha256:manifest.sourceSnapshotSha256,
      rows:parsed.rows.map(r=>({key:r.key,status:r.status,issues:r.issues,revisedReviewSha256:hash(r.revisedReview)}))},null,2)+'\n',{flag:'wx'});
    result.status='validated_pilot';result.totalCensusNotEstablished=true;
  }
}catch(error){result.failureCode=/^[A-Z_]+$/.test(error?.message??'')?error.message:'PILOT_READBACK_UNCONFIRMED';result.httpStatus=typeof error?.status==='number'?error.status:null;process.exitCode=1;}
writeFileSync(new URL('./pilot-ingest-status-'+Date.now()+'.json',import.meta.url),JSON.stringify(result,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(result));
