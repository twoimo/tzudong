import {readFileSync,writeFileSync,mkdirSync,existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {parse} from 'dotenv';
import {GoogleGenAI,ThinkingLevel} from '@google/genai';
const hash=v=>createHash('sha256').update(typeof v==='string'?v:JSON.stringify(v)).digest('hex');
const root='/Users/twoimo/.codex/runtime-cache/tzuyang-review-census-20261009';
const snapshot=readFileSync(root+'/restaurants-review-snapshot-v1.json','utf8');
const manifest=JSON.parse(readFileSync(new URL('./export-manifest-v1.json',import.meta.url)));
if(hash(snapshot)!==manifest.sourceSnapshotSha256)throw Error('AUDIT_SOURCE_HASH_DENIED');
const source=JSON.parse(snapshot);
const prompt=readFileSync(new URL('./audit-prompt-v1.txt',import.meta.url),'utf8');
const env=parse(readFileSync('/Users/twoimo/Documents/projects/tzudong/backend/.env'));
if(!env.GEMINI_API_KEY)throw Error('EXISTING_GEMINI_KEY_MISSING');
const ai=new GoogleGenAI({apiKey:env.GEMINI_API_KEY,httpOptions:{timeout:300000,retryOptions:{attempts:1}},apiVersion:'v1beta'});
const issueCodes=['INTERNAL_MARKER','RAW_FORMATTING','DUPLICATE_WITHIN_REVIEW','BROKEN_PROSE','EDITORIAL_FIRST_PERSON','PROMOTIONAL_VOICE','CONTRADICTION','RECORD_MISMATCH','EMPTY_REVIEW','NEEDS_VIDEO_EVIDENCE'];
const schema={type:'object',additionalProperties:false,required:['rows'],properties:{rows:{type:'array',items:{type:'object',additionalProperties:false,required:['key','status','issues','revisedReview'],properties:{key:{type:'string'},status:{type:'string',enum:['ok','fix','needs_source']},issues:{type:'array',items:{type:'string',enum:issueCodes}},revisedReview:{type:'string'}}}}}};
function safeText(s){return String(s??'').replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi,'[CONTACT]').replace(/(?:\+82[ -]?)?0(?:1[016789]|2|[3-6][1-5])[ -]?\d{3,4}[ -]?\d{4}/g,'[CONTACT]');}
const batchSize=24;const maxBatches=Number(process.argv[2]??1);if(!Number.isInteger(maxBatches)||maxBatches<1||maxBatches>69)throw Error('AUDIT_BATCH_BOUND');
const checkpoint=root+'/gemini-v3';mkdirSync(checkpoint,{recursive:true,mode:0o700});
const start=Date.now();let spent=0,reused=0;
const plan=[{offset:0,size:8,index:0}];for(let offset=8,index=1;offset<source.length;offset+=batchSize,index++)plan.push({offset,size:batchSize,index});
for(const {offset,size,index} of plan){const label=String(index).padStart(3,'0');
 const originals=source.slice(offset,offset+size);
 const input=originals.map((r,i)=>({key:'r'+String(offset+i).padStart(4,'0'),recordName:safeText(r.approved_name??r.origin_name),channel:r.channel_name??'unknown',recordStatus:r.status,videoTitle:safeText(r.youtube_meta?.title),review:safeText(r.tzuyang_review)}));
 const inputSha256=hash(input),path=checkpoint+'/batch-'+label+'.json';
 if(existsSync(path)){const old=JSON.parse(readFileSync(path));if(old.inputSha256!==inputSha256||old.promptSha256!==hash(prompt)||old.model!=='gemini-3.8-flash'||old.thinkingLevel!=='HIGH')throw Error('AUDIT_CHECKPOINT_BINDING_DENIED');reused++;continue;}
 if(spent>=maxBatches)break;
 const startedAtUtc=new Date().toISOString();let reply;
 const requestReceipt=new URL('./model-request-'+label+'-v3.json',import.meta.url);
 if(existsSync(requestReceipt))throw Error('AUDIT_PRIOR_REQUEST_REQUIRES_RECONCILIATION');
 writeFileSync(requestReceipt,JSON.stringify({startedAtUtc,index,inputSha256,promptSha256:hash(prompt),model:'gemini-3.8-flash',thinkingLevel:'HIGH',maxOutputTokens:32768,automaticRetryAttempts:1,rows:input.length,completed:false})+'\n',{flag:'wx'});
 try{const stream=await ai.models.generateContentStream({model:'gemini-3.8-flash',contents:JSON.stringify({rows:input}),config:{systemInstruction:prompt,thinkingConfig:{thinkingLevel:ThinkingLevel.HIGH,includeThoughts:false},responseMimeType:'application/json',responseJsonSchema:schema,maxOutputTokens:32768,temperature:0.1}});let text='';let last={};for await(const chunk of stream){if(chunk.text){text+=chunk.text;writeFileSync(checkpoint+'/stream-'+label+'.txt',text,{mode:0o600});}last={...last,...chunk};}reply={...last,text};}
 catch(error){writeFileSync(new URL('./model-failed-v3-'+label+'-v1.json',import.meta.url),JSON.stringify({index,inputSha256,promptSha256:hash(prompt),model:'gemini-3.8-flash',thinkingLevel:'HIGH',httpStatus:typeof error?.status==='number'?error.status:null,providerMessagePersisted:false})+'\n',{flag:'wx'});throw Error('GEMINI_BATCH_UNCONFIRMED');}
 const responseMetadata={index,inputSha256,promptSha256:hash(prompt),requestedModel:'gemini-3.8-flash',actualModelVersion:reply.modelVersion??null,thinkingLevel:'HIGH',finishReason:reply.candidates?.[0]?.finishReason??null,candidateCount:reply.candidates?.length??0,usage:reply.usageMetadata,rawThoughtsPersisted:false};
 writeFileSync(checkpoint+'/response-'+label+'.json',JSON.stringify({...responseMetadata,text:reply.text??''},null,2)+'\n',{flag:'wx',mode:0o600});
 writeFileSync(new URL('./model-response-'+label+'-v3.json',import.meta.url),JSON.stringify(responseMetadata,null,2)+'\n',{flag:'wx'});
 if(!/^gemini-3\.8-flash(?:[-].*)?$/.test(reply.modelVersion??''))throw Error('ACTUAL_GEMINI_MODEL_UNCONFIRMED');
 if(reply.candidates?.length!==1||reply.candidates[0].finishReason!=='STOP')throw Error('AUDIT_FINISH_UNCONFIRMED');
 const parsed=JSON.parse(reply.text);
 if(!Array.isArray(parsed.rows)||parsed.rows.length!==input.length)throw Error('AUDIT_COVERAGE_DENIED');
 for(let i=0;i<input.length;i++){const r=parsed.rows[i];if(r.key!==input[i].key||!['ok','fix','needs_source'].includes(r.status)||!Array.isArray(r.issues)||r.issues.some(v=>!issueCodes.includes(v))||typeof r.revisedReview!=='string'||(r.status==='fix'?!r.revisedReview.trim():!!r.revisedReview))throw Error('AUDIT_RESULT_SCHEMA_DENIED');}
 const result={index,startedAtUtc,endedAtUtc:new Date().toISOString(),inputSha256,promptSha256:hash(prompt),model:'gemini-3.8-flash',actualModelVersion:reply.modelVersion,thinkingLevel:'HIGH',usage:reply.usageMetadata,rows:parsed.rows,sourceSnapshotSha256:manifest.sourceSnapshotSha256};
 writeFileSync(path,JSON.stringify(result,null,2)+'\n',{flag:'wx',mode:0o600});
 const publicResult={...result,rows:result.rows.map(r=>({key:r.key,status:r.status,issues:r.issues,revisedReviewSha256:hash(r.revisedReview),sourceReviewSha256:originals[Number(r.key.slice(1))-offset].reviewSha256})),privateRecommendationsPersisted:true,publicReviewTextPersisted:false};
 writeFileSync(new URL('./model-batch-'+label+'-v3.json',import.meta.url),JSON.stringify(publicResult,null,2)+'\n',{flag:'wx'});
 spent++;console.log(JSON.stringify({batch:index,rows:input.length,completed:Math.min(source.length,offset+input.length),total:source.length,actualModelVersion:reply.modelVersion,thinkingLevel:'HIGH',statusCounts:parsed.rows.reduce((o,r)=>(o[r.status]=(o[r.status]??0)+1,o),{})}));
}
console.log(JSON.stringify({modelCalls:spent,reusedBatches:reused,elapsedMs:Date.now()-start,operatingWrites:0}));
