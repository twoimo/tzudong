// This optional Bun-only fixture harness does not add Bun ambient types to the Node app.
const bunTestModule: string='bun:test';
const { mock }=await import(bunTestModule);
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
mock.module('server-only',()=>({}));
const { readDatabaseEvaluationPage }=await import('../lib/admin/evaluation-page-server');
import type { EvaluationPageClient } from '../lib/admin/evaluation-page-server';
const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const attrs={approved_name:'fixture a\u0897',origin_name:'fixture a\u0897',naver_name:null,google_name:null,phone:null,status:'pending',road_address:null,jibun_address:null,youtube_link:'https://youtu.be/abcdefghijk',updated_by_admin_id:null,lat:null,lng:null,evaluation_results:{location_match_TF:{eval_value:null,match_status:null,naver_name:null,matched_provider:null,matched_name:null}},name:'fixture a\u0897'};
const rows=Array.from({length:1000},(_,n)=>({...attrs,id:id(n),created_at:'2026-01-01T00:00:00Z',video_id:'abcdefghijk',status:n>=990?'deleted':'pending'}));
const pageIds=rows.slice(0,200).map(row=>row.id);
const groups=[{attrs,count:990,firstOrder:1,selfIds:pageIds,samples:rows.slice(0,4).map((row,n)=>({id:row.id,sourceOrder:n+1}))},
  {attrs:{...attrs,status:'deleted'},count:10,firstOrder:991,selfIds:[],samples:rows.slice(990,994).map((row,n)=>({id:row.id,sourceOrder:991+n}))}];
const stats={total:1000,pending:990,approved:0,hold:0,db_conflict:0,ready_for_approval:0,unconfirmed_map:0,missing:0,not_selected:0,deleted:10};
const data={codecVersion:1,mode:'grouped',revision:'1',pageIds,totalRows:1000,totalGroups:2,groupOffset:0,rowOffset:0,groups,hasMore:false,nextAfterOrder:991,
  cursor:{revision:'1',pageIds,mode:'grouped',totalRows:1000,offset:991,afterId:id(990),afterCreated:rows[0].created_at}};
const query={searchQuery:'',evalFilters:{},deepLinkFilter:null};
const bytes=(value:unknown)=>Buffer.byteLength(JSON.stringify(value));
function fixture(){
  const measurements={warningCalls:0,warningResponseBytes:0,totalCalls:0,totalResponseBytes:0,maxWarningResponseBytes:0};
  const record=(value:unknown,warning:boolean)=>{measurements.totalCalls++;measurements.totalResponseBytes+=bytes(value);if(warning){measurements.warningCalls++;measurements.warningResponseBytes+=bytes(value);measurements.maxWarningResponseBytes=Math.max(measurements.maxWarningResponseBytes,bytes(value));}return {data:value,error:null};};
  const client={rpc:async(name:string)=>{
    if(name==='admin_evaluation_revision')return record('1',false);
    if(name==='admin_evaluation_page')return record({records:rows.slice(0,200),stats,filteredTotal:1000,revision:'1',hasMore:true,afterId:id(199)},false);
    if(name==='admin_evaluation_raw_warning_groups')return record(data,true);
    throw new Error('unexpected_rpc');
  },from:()=>{const builder={select:()=>builder,in:()=>builder,order:()=>builder,range:(from:number,to:number)=>Promise.resolve(record(rows.slice(from,to+1),true))};return builder;}} as unknown as EvaluationPageClient;
  return {client,measurements};
}
const observations=[];
for(let pair=0;pair<7;pair++){
  const results=[];
  for(const mode of pair%2?['auto','stream'] as const:['stream','auto'] as const){
    const f=fixture();const result=await readDatabaseEvaluationPage(f.client,query,200,null,undefined,mode);
    if(result.records.length!==200||result.warnings[id(0)].sameVideo.count!==989)throw new Error('fixture_contract');
    const outputSha256=createHash('sha256').update(JSON.stringify(result.warnings)).digest('hex');
    const observation={pair,mode,warningReadPath:result.warningReadPath,outputSha256,...f.measurements};
    observations.push(observation);results.push(observation);
  }
  if(results[0].outputSha256!==results[1].outputSha256)throw new Error('warning_equivalence');
}
const closure=['lib/admin/evaluation-page-server.ts','lib/admin/evaluation-warning-adaptive-codec.ts','lib/admin/evaluation-warning-raw-groups.ts','lib/admin/evaluation-warning-stream.ts','lib/admin-same-video-duplicate-warning.ts','lib/admin-restaurant-identity-warning.ts','lib/admin/normalize-evaluation-record.ts','scripts/measure-evaluation-warning-default.ts'];
writeFileSync('performance/pr-review-followthrough-20261009/evaluation-warnings/default-transport-counts.json',JSON.stringify({environment:'Bun 1.4.0, local in-process synthetic client; no SQL/PostgREST/network/provider execution',kind:'deterministic request and compact JSON response byte accounting; not latency/CPU/RSS or operating performance',pairs:7,rows:1000,targets:200,equivalent:true,sourceSha256:Object.fromEntries(closure.map(path=>[path,createHash('sha256').update(readFileSync(path)).digest('hex')])),observations},null,2)+'\n');
console.log(JSON.stringify({equivalent:true,observations:observations.slice(0,2)}));
