import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {readFileSync,writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {readCompletePublicProfileLeaderboard} from '/Users/twoimo/.codex/worktrees/mobile-nav-read-20261012/tzudong/apps/web/lib/public-profile-read.ts';

const source='/Users/twoimo/.codex/worktrees/mobile-nav-read-20261012/tzudong/apps/web/lib/public-profile-read.ts';
const require=createRequire('/Users/twoimo/.codex/worktrees/mobile-nav-read-20261012/tzudong/apps/web/package.json');
const env=require('dotenv').parse(readFileSync('/Users/twoimo/Documents/projects/tzudong/apps/web/.env.local'));
const url=env.NEXT_PUBLIC_SUPABASE_URL;
if(new URL(url).hostname!=='aqlcofblfxdrjhhdmarw.supabase.co'||!env.NEXT_PUBLIC_SUPABASE_ANON_KEY)throw Error('PROJECT_INPUT_UNAVAILABLE');
if(!env.NEXT_PUBLIC_SUPABASE_ANON_KEY.startsWith('sb_publishable_'))throw Error('PUBLISHABLE_INPUT_UNAVAILABLE');
const result={credentialKind:'publishable',publicKeyCheckedBeforeRead:true,observedAtUTC:new Date().toISOString(),projectRef:'aqlcofblfxdrjhhdmarw',sourceSha256:createHash('sha256').update(readFileSync(source)).digest('hex'),role:'anonymous',reads:[],checks:[],privateRowsPersisted:false,credentialsPersisted:false,operatingWrites:0,browserRenderingEvidence:false,fieldAdmission:0,performanceAdmission:0};
for(const period of ['all','monthly']){
  let calls=0;
  const client={rpc:async(name,args)=>{
    if(name!=='read_public_profile_leaderboard_page'||++calls>8)throw Error('BOUNDED_READ_LIMIT');
    const response=await fetch(new URL('/rest/v1/rpc/'+name,url),{method:'POST',headers:{apikey:env.NEXT_PUBLIC_SUPABASE_ANON_KEY,'Content-Type':'application/json'},body:JSON.stringify(args),signal:AbortSignal.timeout(10000)});
    result.reads.push({period,rpc:name,httpStatus:response.status});
    if(!response.ok)return {data:null,error:{code:'UNAVAILABLE'}};
    return {data:await response.json(),error:null};
  }};
  try{
    const rows=await readCompletePublicProfileLeaderboard(client,period);
    result.checks.push({period,passed:true,rows:rows.length,calls,scope:'bounded public ranking response grammar, pagination, ordering and duplicates'});
  }catch(error){
    const code=['PUBLIC_PROFILE_READ_UNAVAILABLE','PUBLIC_PROFILE_READ_INVALID_RESPONSE','PUBLIC_PROFILE_READ_INVALID_INPUT'].includes(error.code)?error.code:'BOUNDED_CHECK_UNAVAILABLE';
    result.checks.push({period,passed:false,calls,code});
  }
}
result.allPassed=result.checks.every(x=>x.passed);
writeFileSync(fileURLToPath(new URL('readback-v2.json',import.meta.url)),JSON.stringify(result,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({allPassed:result.allPassed,checks:result.checks,reads:result.reads}));
