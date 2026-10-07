import {describe,expect,test} from 'bun:test';
import {parseRecordActionRequest,RECORD_ACTION_CONFIRMATION,type RecordActionReceipt} from '../lib/admin/record-action-contract';
import {runRecordAction,readRecordAction,resumeRecordMediaCleanup,createRecordMediaTransport,type RecordActionRpc} from '../lib/admin/record-action-service';
import {admitRecordMediaCleanup,createRecordMediaCleanupAdmitter,recordMediaEvidenceHash,RECORD_MEDIA_REQUIRED_CASES} from '../lib/admin/record-media-admission';
import compatibility from '../lib/admin/record-media-compatibility.json';
// Synthetic policy fixtures exercise orchestration without granting any production admission.
const unitProof={...compatibility,status:'passed',completeCaseSet:true,tests:RECORD_MEDIA_REQUIRED_CASES.map(name=>({name,passed:true}))};
const unitEnvironment={NEXT_PUBLIC_SUPABASE_URL:'http://127.0.0.1:54321',ADMIN_RECORD_MEDIA_VERIFIED_ENDPOINT:'http://127.0.0.1:54321',ADMIN_RECORD_MEDIA_STORAGE_IMAGE:unitProof.storageImage,ADMIN_RECORD_MEDIA_SQL_SHA256:unitProof.recordSqlSha256,ADMIN_RECORD_MEDIA_COMPATIBILITY_SHA256:recordMediaEvidenceHash(unitProof)};
const unitAdmission=createRecordMediaCleanupAdmitter(unitProof)(unitEnvironment)!;
const actor='11111111-1111-4111-8111-111111111111',operationId='22222222-2222-4222-8222-222222222222',target='33333333-3333-4333-8333-333333333333',jobId='44444444-4444-4444-8444-444444444444';
const request={phase:'preview' as const,operationId,action:'restaurant.approve' as const,targetIds:[target],payload:{}};
const receipt:RecordActionReceipt={operationId,action:'restaurant.approve',state:'applied',previewHash:'a'.repeat(64),targetIds:[target],auditId:jobId,expiresAt:'2026-10-05T00:00:00Z',readback:[{id:target,kind:'restaurant',status:'approved',fingerprint:'b'.repeat(64)}],mediaCleanupPending:false};
describe('admin action boundary',()=>{
 test('actor, fingerprint, unknown changes and unconfirmed apply cannot be supplied by browser',()=>{
  expect(parseRecordActionRequest(request)).not.toBeNull();
  for(const patch of [{actor},{phase:'apply'},{expectedFingerprint:'b'.repeat(64)},{targetIds:[target,target]}, {action:'restaurant.edit',payload:{changes:{status:'approved'}}}, {action:'restaurant.edit',payload:{changes:{evaluation_results:{}}}}, {action:'restaurant.edit',payload:{changes:{categories:['unknown']}}}]) expect(parseRecordActionRequest({...request,...patch})).toBeNull();
  expect(parseRecordActionRequest({...request,phase:'apply',previewHash:'a'.repeat(64),confirmation:RECORD_ACTION_CONFIRMATION})).not.toBeNull();
 });
 test('actual form contracts allow edited approval, cross-video merge and bounded multi-create',()=>{
  const changed={phone:'02-1234-5678'};
  for(const [action,targetIds,payload] of [
   ['restaurant.approve',[target],{changes:changed}],
   ['restaurant.merge',[target,actor],{mergeTargetId:target,incomingChanges:changed}],
   ['restaurant.create',[],{changes:changed,additions:[changed]}],
   ['restaurant.edit',[target],{changes:{},perTargetChanges:[{id:target,changes:{youtube_link:null,tzuyang_review:'공개 리뷰'}}]}],
  ] as const) expect(parseRecordActionRequest({...request,action,targetIds,payload})).not.toBeNull();
  expect(parseRecordActionRequest({...request,action:'restaurant.create',targetIds:[],payload:{changes:changed,additions:Array(25).fill(changed)}})).toBeNull();
  expect(parseRecordActionRequest({...request,action:'restaurant.edit',payload:{changes:{}}})).toBeNull();
  expect(parseRecordActionRequest({...request,action:'restaurant.merge',targetIds:[target,actor],payload:{mergeTargetId:target,incomingChanges:{evaluation_results:{}}}})).toBeNull();
 });
 test('shared or changed media and malformed claim never reach Storage remove',async()=>{
  for (const claim of [{ok:true,claimed:false},{ok:true}]) {
   let removes=0;
   const rpc:RecordActionRpc=async args=>({error:null,data:args.p_phase==='readback'?{...receipt,action:'review.delete'}:args.p_phase==='cleanup_read'?{jobs:[{id:jobId,bucket:'review-photos',objectName:`${actor}/reviews/${target}/food/fixture.jpg`,state:'pending'}]}:claim});
   const run=resumeRecordMediaCleanup(rpc,{exists:async()=>true,remove:async()=>{removes++;}},actor,operationId,unitAdmission);
   if ('claimed' in claim) await run; else await expect(run).rejects.toThrow('UNCERTAIN');
   expect(removes).toBe(0);
  }
 });
 test('incoming business telephone remains domain data and forbidden metadata remains blocked',async()=>{
  let calls=0;const rpc:RecordActionRpc=async()=>{calls++;return {data:{...receipt,action:'restaurant.merge',targetIds:[target,actor]},error:null};};
  await runRecordAction(rpc,actor,{...request,action:'restaurant.merge',targetIds:[target,actor],payload:{mergeTargetId:target,incomingChanges:{phone:'02-1234-5678'}}});
  expect(calls).toBe(1);
  await expect(runRecordAction(rpc,actor,{...request,action:'restaurant.merge',targetIds:[target,actor],payload:{mergeTargetId:target,incomingChanges:{youtube_meta:{title:'person@example.com'}}}})).rejects.toThrow('PRIVACY_UNSAFE');
  expect(calls).toBe(1);
 });
 test('uncertain ACK performs one RPC only; explicit readback recovers committed result',async()=>{
  const calls:Record<string,unknown>[]=[];
  const rpc:RecordActionRpc=async args=>{calls.push(args);if(args.p_phase!=='readback')throw Error('private provider diagnostic');return {data:receipt,error:null};};
  await expect(runRecordAction(rpc,actor,{...request,phase:'apply',previewHash:receipt.previewHash,confirmation:RECORD_ACTION_CONFIRMATION})).rejects.toThrow('RECORD_ACTION_UNCERTAIN');
  expect(calls.length).toBe(1);expect(await readRecordAction(rpc,actor,operationId)).toEqual(receipt);
  expect(calls.map(x=>x.p_phase)).toEqual(['apply','readback']);
 });
 test('privacy and bypass actor fail before transport; bounded business telephone is supported',async()=>{
  let calls=0;const rpc:RecordActionRpc=async()=>{calls++;return {data:{...receipt,action:'restaurant.edit'},error:null};};
  await expect(runRecordAction(rpc,'e2e-admin-route-bypass',request)).rejects.toThrow('FORBIDDEN');
  await expect(runRecordAction(rpc,actor,{...request,action:'review.reject',payload:{reason:'person@example.com'}})).rejects.toThrow('PRIVACY_UNSAFE');expect(calls).toBe(0);
  await runRecordAction(rpc,actor,{...request,action:'restaurant.edit',payload:{changes:{phone:'02-1234-5678'}}});expect(calls).toBe(1);
 });
 test('provider prose and malformed result never become an applied result',async()=>{
  await expect(runRecordAction(async()=>({data:null,error:{message:'secret provider details'}}),actor,request)).rejects.toThrow('RECORD_ACTION_UNCERTAIN');
  await expect(runRecordAction(async()=>({data:{...receipt,operationId:actor},error:null}),actor,request)).rejects.toThrow('RECORD_ACTION_UNCERTAIN');
 });
 test('storage is not touched before committed DB receipt',async()=>{
  let calls=0;await expect(resumeRecordMediaCleanup(async()=>({data:{...receipt,state:'preview',action:'review.delete'},error:null}),{exists:async()=>{calls++;return true;},remove:async()=>{calls++;}},actor,operationId,unitAdmission)).rejects.toThrow('STATE_CONFLICT');expect(calls).toBe(0);
 });
 test('lost delete ACK reads absence; uncertain restart does not repeat removal',async()=>{
  for(const state of ['pending','inflight','uncertain'] as const){
   const phases:string[]=[];let removes=0;let present=true;
   const rpc:RecordActionRpc=async args=>{phases.push(String(args.p_phase));return {error:null,data:args.p_phase==='readback'?{...receipt,action:'review.delete',mediaCleanupPending:present}:args.p_phase==='cleanup_read'?{jobs:[{id:jobId,bucket:'review-photos',objectName:`${actor}/reviews/${target}/food/fixture.jpg`,state}]}:{ok:true,claimed:true}};};
   const result=await resumeRecordMediaCleanup(rpc,{exists:async()=>present,remove:async()=>{removes++;present=false;throw Error('lost ACK');}},actor,operationId,unitAdmission);
   expect(removes).toBe(state==='pending'?1:0);expect(phases.includes('cleanup_absent')).toBe(state==='pending');expect(result.mediaCleanupPending).toBe(state!=='pending');
  }
 });
});

// Run the actual route source with only its I/O dependencies injected, without network or module mocks.
import {readFileSync} from 'node:fs';
import {RecordActionError} from '../lib/admin/record-action-service';
const routeSource=readFileSync(new URL('../app/api/admin/record-actions/route.ts',import.meta.url),'utf8');
function routeFixture(authorized=true,origin=true,body:unknown=request) {
 let reads=0,clients=0,calls=0;
 const executable=routeSource.replace(/^import .*\n/gm,'').replace(/^export const runtime=.*\n/gm,'').replaceAll('export async function','async function');
 const make=new Function('NextResponse','requireAdmin','createSupabaseServiceRoleClient','readBoundedJsonRequest','isTrustedSameOriginMutation','parseRecordActionRequest','RecordActionError','readRecordAction','runRecordAction',
  new Bun.Transpiler({loader:'ts'}).transformSync(executable+'\nreturn {POST,GET};'));
 const routes=make({json:Response.json},async()=>authorized?{ok:true,userId:actor}:{ok:false,response:Response.json({code:'FORBIDDEN'},{status:403})},()=>{clients++;return {rpc:async()=>{calls++;return {data:receipt,error:null};}};},async()=>{reads++;return {ok:true,value:body};},()=>origin,parseRecordActionRequest,RecordActionError,readRecordAction,runRecordAction) as {POST:(r:Request)=>Promise<Response>;GET:(r:Request)=>Promise<Response>};
 return {routes,counts:()=>({reads,clients,calls})};
}
test('real route denies authentication/origin before body or privileged transport',async()=>{
 for(const [auth,origin] of [[false,true],[true,false]]){
  const f=routeFixture(auth,origin);const response=await f.routes.POST(new Request('http://localhost/api/admin/record-actions',{method:'POST'}));
  expect(response.status).toBe(403);expect(response.headers.get('cache-control')).toBe('no-store');expect(f.counts()).toEqual({reads:0,clients:0,calls:0});
 }
});
test('real route rejects unknown fields, binds auth actor and returns only bounded receipts',async()=>{
 const bad=routeFixture(true,true,{...request,actor});expect((await bad.routes.POST(new Request('http://localhost',{method:'POST'}))).status).toBe(400);expect(bad.counts().calls).toBe(0);
 const valid=routeFixture();const response=await valid.routes.POST(new Request('http://localhost',{method:'POST'}));expect(response.status).toBe(200);expect(await response.json()).toEqual({success:true,receipt});expect(valid.counts()).toEqual({reads:1,clients:1,calls:1});
});


test('media admission requires complete physical proof and exact deployment bindings',()=>{
 const admit=createRecordMediaCleanupAdmitter(unitProof);
 expect(admit(unitEnvironment)).not.toBeNull();
 expect(admitRecordMediaCleanup(unitEnvironment)).toBeNull(); // Bundled proof is deliberately not passed.
 for(const key of Object.keys(unitEnvironment)) {
  expect(admit({...unitEnvironment,[key]:undefined})).toBeNull();
  expect(admit({...unitEnvironment,[key]:'mismatch'})).toBeNull();
 }
 for(const endpoint of ['http://user:password@127.0.0.1:54321','http://127.0.0.1:54321/path','http://127.0.0.1:54321/?token=x','http://127.0.0.1:54321/#x']) expect(admit({...unitEnvironment,NEXT_PUBLIC_SUPABASE_URL:endpoint})).toBeNull();
 for(const proof of [{...unitProof,status:'failed'},{...unitProof,completeCaseSet:false},{...unitProof,tests:unitProof.tests.slice(1)},{...unitProof,tests:unitProof.tests.map((x,i)=>i===0?{...x,passed:false}:x)}]) {
  expect(createRecordMediaCleanupAdmitter(proof)({...unitEnvironment,ADMIN_RECORD_MEDIA_COMPATIBILITY_SHA256:recordMediaEvidenceHash(proof)})).toBeNull();
 }
});
test('missing or forged media admission fails before RPC and Storage; DB moderation remains available',async()=>{
 let calls=0;const runner:RecordActionRpc=async()=>{calls++;return {error:null,data:{...receipt,action:'review.delete'}};};
 const storage={exists:async()=>{calls++;return true;},remove:async()=>{calls++;}};
 for(const admission of [undefined,{} as typeof unitAdmission]) await expect(resumeRecordMediaCleanup(runner,storage,actor,operationId,admission)).rejects.toThrow('RECORD_ACTION_MEDIA_NOT_ADMITTED');
 expect(calls).toBe(0);
 await runRecordAction(runner,actor,{...request,action:'review.delete',payload:{reason:'확인'}});
 expect(calls).toBe(1);
});
test('actual SDK transport reads exact metadata name and never interprets partial readback as absence',async()=>{
 const calls:unknown[]=[];
 const client={storage:{from:(bucket:string)=>({list:async(path:string,options:unknown)=>{calls.push({bucket,path,options});return {data:[{name:'image.png.extra'}],error:null};},remove:async(paths:string[])=>{calls.push({bucket,paths});return {error:null};}})}};
 const transport=createRecordMediaTransport(client);
 expect(await transport.exists('review-photos','a/b/image.png')).toBe(false);
 await transport.remove('review-photos','a/b/image.png');
 expect(calls).toEqual([{bucket:'review-photos',path:'a/b',options:{search:'image.png',limit:100}},{bucket:'review-photos',paths:['a/b/image.png']}]);
 const uncertain=createRecordMediaTransport({storage:{from:()=>({list:async()=>({data:Array(100).fill({name:'other'}),error:null}),remove:async()=>({error:Error('private diagnostic')})})}});
 await expect(uncertain.exists('review-photos','a/b/image.png')).rejects.toThrow('MEDIA_READBACK_UNCERTAIN');
 await expect(uncertain.remove('review-photos','a/b/image.png')).rejects.toThrow('MEDIA_WRITE_UNCERTAIN');
});

import {z} from 'zod';
const mediaRouteSource=readFileSync(new URL('../app/api/admin/record-actions/media-cleanup/route.ts',import.meta.url),'utf8');
test('actual media route rejects unadmitted deployment before creating a privileged client',async()=>{
 let clients=0;
 const executable=mediaRouteSource.replace(/^import .*\n/gm,'').replace(/^export const runtime=.*\n/gm,'').replaceAll('export async function','async function');
 const make=new Function('NextResponse','z','requireAdmin','createSupabaseServiceRoleClient','readBoundedJsonRequest','isTrustedSameOriginMutation','RecordActionError','resumeRecordMediaCleanup','createRecordMediaTransport','admitRecordMediaCleanup',new Bun.Transpiler({loader:'ts'}).transformSync(executable+'\nreturn POST;'));
 const post=make({json:Response.json},z,async()=>({ok:true,userId:actor}),()=>{clients++;throw Error('must not initialize');},async()=>({ok:true,value:{operationId}}),()=>true,RecordActionError,resumeRecordMediaCleanup,createRecordMediaTransport,()=>admitRecordMediaCleanup(unitEnvironment)) as (request:Request)=>Promise<Response>;
 const response=await post(new Request('http://localhost',{method:'POST'}));
 expect(response.status).toBe(503);expect(response.headers.get('cache-control')).toBe('no-store');expect(await response.json()).toEqual({success:false,code:'RECORD_ACTION_MEDIA_NOT_ADMITTED'});expect(clients).toBe(0);
});
