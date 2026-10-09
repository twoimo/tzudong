import { readFileSync, writeFileSync } from 'node:fs';
import { parse } from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { planVerificationTransfer, applyVerificationTransfer } from './verification-transfer-controller.mjs';

const mode=process.argv[2],label=process.argv[3];
if (!['plan','apply'].includes(mode) || !/^[a-z0-9-]+$/.test(label??'')) throw Error('OPERATION_ARGUMENTS');
const env=parse(readFileSync('/Users/twoimo/Documents/projects/tzudong/apps/web/.env.local'));
const origin='https://aqlcofblfxdrjhhdmarw.supabase.co';
if (env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/$/,'')!==origin || !env.SUPABASE_SERVICE_ROLE_KEY?.startsWith('sb_secret_')) throw Error('PROJECT_CREDENTIAL_BINDING');
const client=createClient(origin,env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false},
  global:{fetch:(url,options)=>fetch(url,{...options,signal:AbortSignal.timeout(15000)})}});
const deps={
  references:async()=>{
    const r=await client.from('reviews').select('id,user_id,verification_photo,food_photos').not('verification_photo','is',null).limit(65);
    if(r.error)throw Error('REFERENCE_READ_UNCONFIRMED');return r.data;
  },
  info:async(bucket,key)=>{
    const r=await client.storage.from(bucket).info(key);
    if(r.error){if(String(r.error.statusCode)==='404')return null;throw Error('IMAGE_INFO_UNCONFIRMED');}
    return r.data;
  },
  read:async(bucket,key)=>{
    const r=await client.storage.from(bucket).download(key);
    if(r.error || !r.data || r.data.size>5*1024*1024)throw Error('IMAGE_DOWNLOAD_UNCONFIRMED');
    return new Uint8Array(await r.data.arrayBuffer());
  },
  privateBucket:async()=>{
    const r=await client.storage.getBucket('review-verifications');if(r.error)throw Error('PRIVATE_BUCKET_UNCONFIRMED');return r.data;
  },
  copy:async key=>{const r=await client.storage.from('review-photos').copy(key,key,{destinationBucket:'review-verifications'});if(r.error)throw Error('COPY_REPLY_UNCONFIRMED');},
  remove:async keys=>{const r=await client.storage.from('review-photos').remove(keys);if(r.error)throw Error('REMOVE_REPLY_UNCONFIRMED');},
  publicStatus:async(bucket,key)=>{
    const url=`${origin}/storage/v1/object/public/${bucket}/${key.split('/').map(encodeURIComponent).join('/')}?__qa=review-private-readback`;
    const r=await fetch(url,{method:'HEAD',redirect:'error',cache:'no-store',signal:AbortSignal.timeout(15000)});return r.status;
  },
};
const result={startedAtUtc:new Date().toISOString(),mode,label,project:'aqlcofblfxdrjhhdmarw',keyEmitted:false,
  contentsPersisted:false,keysPersisted:false,sourceDataChanged:false,operatingWrites:mode==='apply',status:'unconfirmed'};
try {
  if(mode==='plan')result.plan=await planVerificationTransfer(deps);
  else {
    const path=process.argv[4];if(!path)throw Error('APPROVED_PLAN_REQUIRED');
    const saved=JSON.parse(readFileSync(path));if(saved.mode!=='plan'||saved.status!=='passed')throw Error('PLAN_UNCONFIRMED');
    result.readback=await applyVerificationTransfer(deps,saved.plan);
  }
  result.status=mode==='plan'||result.readback.completed?'passed':'pending_public_denial_readback';
} catch(error) { result.failureCode=/^[A-Z_]{1,64}$/.test(error.message)?error.message:'OPERATION_UNCONFIRMED';process.exitCode=1; }
result.endedAtUtc=new Date().toISOString();
writeFileSync(new URL(`verification-transfer-${label}.json`,import.meta.url),JSON.stringify(result,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({mode,label,status:result.status,files:result.plan?.expectedFiles??result.readback?.files,
  failureCode:result.failureCode??null,completed:result.readback?.completed??false,keyEmitted:false,contentsPersisted:false}));
