import { expect, test } from 'bun:test';
import { resolve } from 'node:path';
// Run route mocks in a disposable worker so service/auth module mocks cannot
// contaminate unrelated API tests. Actual GET handlers are imported there.
const worker = String.raw`
import { mock } from 'bun:test';
import { NextRequest } from 'next/server';
let authStatus=200, services=0, listCalls=0, exactCalls=0, missing=false;
const target='00000000-0000-4000-9000-000000000101';
const actor='00000000-0000-4000-9000-000000000001';
const queries=[];
const user={id:target,email:'fixture@example.test',user_metadata:{nickname:'after-name'},banned_until:null};
const candidate=(id)=>({id,restaurant_id:actor,run_id:null,candidate_status:'approved',detected_change_types:['name'],previous_snapshot:{name:'synthetic'},candidate_snapshot:{},evidence:{},operator_decision:'approved',decided_at:'2026-10-09T00:00:00Z',applied_at:null,created_at:'2026-10-01T00:00:00Z'});
const older=candidate(target);
function builder(table){
 const q={table,eq:[],limit:null,head:false}; queries.push(q);
 const b={select:(_fields,opts)=>{q.head=!!opts?.head;return b;},eq:(k,v)=>{q.eq.push([k,v]);return b;},in:()=>b,order:()=>b,limit:(n)=>{q.limit=n;return b;},overrideTypes:()=>b,
  then:(resolve)=>{let data=[];if(table==='restaurant_refresh_candidates'){data=q.eq.some(([k,v])=>k==='id'&&v===target)?[older]:Array.from({length:100},(_,i)=>candidate('newer-'+i));if(missing)data=[];}return Promise.resolve({data,count:q.head?1000:null,error:null}).then(resolve);}};
 return b;
}
mock.module('@/lib/auth/require-admin',()=>({requireAdmin:async()=>authStatus===200?{ok:true,userId:actor}:{ok:false,response:Response.json({code:'DENIED'},{status:authStatus})}}));
mock.module('@/lib/supabase/service-role',()=>({createSupabaseServiceRoleClient:()=>{services++;return {from:builder,auth:{admin:{listUsers:async()=>{listCalls++;return {data:{users:[],total:0},error:null};},getUserById:async(id)=>{exactCalls++;if(id!==target)throw Error('unexpected_id');return {data:{user:missing?null:user},error:missing?{status:404}:null};}}},rpc:async(_name,args)=>({data:args.p_user_ids.map(id=>({user_id:id,username:'after-user',nickname:'after-name',avatar_url:null,is_admin:false,account_status:'active',profile_role:'user'})),error:null})};}}));
const users=await import('./app/api/admin/users/route.ts');
const refresh=await import('./app/api/admin/restaurant-refresh-history/route.ts');
const results=[];
function check(name,ok){if(!ok)throw Error(name);results.push(name);}
const req=(path)=>new NextRequest('http://localhost'+path);
for(const module of [users,refresh]){
 for(const status of [401,403]){authStatus=status;const before=services;const response=await module.GET(req('/api?user_id='+target+'&candidate_id='+target));check('auth_before_read_'+status,response.status===status&&services===before&&response.headers.get('cache-control')?.includes('no-store'));}
 authStatus=200;
 for(const value of ['','not-an-id',target+'x','../'+target]){const before=services;const response=await module.GET(req('/api?user_id='+encodeURIComponent(value)+'&candidate_id='+encodeURIComponent(value)));check('invalid_id_bounded',response.status===400&&services===before&&response.headers.get('cache-control')?.includes('no-store'));}
}
let response=await users.GET(req('/api/admin/users?user_id='+target+'&search=before-name'));
let payload=await response.json();check('user_exact_outside_active_search',response.status===200&&payload.users.length===1&&payload.users[0].nickname==='after-name'&&exactCalls===1&&listCalls===0&&response.headers.get('cache-control')?.includes('no-store'));
response=await refresh.GET(req('/api/admin/restaurant-refresh-history?candidate_id='+target+'&status=rejected&search=does-not-match'));
payload=await response.json();const candidateQuery=queries.find(q=>q.table==='restaurant_refresh_candidates');check('candidate_older_than100_exact',response.status===200&&payload.candidates.length===1&&payload.candidates[0].id===target&&candidateQuery.limit===1&&candidateQuery.eq.some(([k,v])=>k==='id'&&v===target)&&!candidateQuery.eq.some(([k])=>k==='candidate_status'));
check('candidate_no_store',response.headers.get('cache-control')?.includes('no-store'));
missing=true;
for(const [module,key] of [[users,'user_id'],[refresh,'candidate_id']]){response=await module.GET(req('/api?'+key+'='+target));check('missing_target_not_success',response.status===404&&response.headers.get('cache-control')?.includes('no-store'));}
console.log(JSON.stringify({passed:results.length,actualGETHandlers:true,hostedReads:0}));
`;
test('actor-authenticated exact GET reads stay bounded, ignore list filters, and find candidates outside newest100', () => {
 const result=Bun.spawnSync([process.execPath,'--eval',worker],{cwd:resolve(import.meta.dir,'..'),env:process.env,stdout:'pipe',stderr:'pipe'});
 expect(result.exitCode).toBe(0);expect(new TextDecoder().decode(result.stderr)).toBe('');
 const report=JSON.parse(new TextDecoder().decode(result.stdout));expect(report.actualGETHandlers).toBe(true);expect(report.passed).toBe(17);expect(report.hostedReads).toBe(0);
});
