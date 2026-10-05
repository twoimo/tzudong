import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import vm from 'node:vm';
const app = process.cwd();
const require = createRequire(path.join(app,'package.json'));
const ts = require('typescript');
const next = require('next/server');
const evidence='/Users/twoimo/.codex/worktrees/marker-memory-lifetime-20261001/tzudong/apps/web/performance/repository-quality-20261004/agents/astra-web-contract';
const baseline='4295fd54411ac8a4c304dce89efbb6f96e90935c';
const head='cd86c106b468c40e83a2e2edf39b49c3b9529937';
function load(relative, revision, dependencies, logs=[]) {
 const source = revision ? execFileSync('git',['show',`${revision}:apps/web/${relative}`],{cwd:app,encoding:'utf8'}) : readFileSync(path.join(app,relative),'utf8');
 const exports = {};
 const js=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 vm.runInNewContext(js,{exports,Error,process:{env:{}},console:{error:(...args)=>logs.push(args)},require(name){
  if (name in dependencies) return dependencies[name];
  throw new Error('UNEXPECTED_FIXTURE_DEPENDENCY');
 }});
 return exports;
}
const results=[];
for (const [label,revision] of [['baseline',baseline],['pr3031',head],['candidate',null]]) {
 const helpers=load('lib/dashboard/helpers.ts',revision,{});
 const id='a'.repeat(129);
 const extracted=helpers.extractVideoIdFromYoutubeLink(`https://youtu.be/${id}`);
 const row={id:'fixture',name:'fixture',categories:[],youtube_link:`https://youtu.be/${id}`,youtube_meta:null,lat:null,lng:null,updated_at:null,created_at:null,status:'approved'};
 const summary=load('lib/dashboard/summary.ts',revision,{'node:crypto':require('node:crypto'),'./helpers':helpers,'@/lib/dashboard/supabase':{}});
 const advertised=summary.buildDashboardSummaryFromRows([row]).videos.length;
 let detailLoads=0;
 const detail=load('app/api/dashboard/video/[videoId]/route.ts',revision,{'next/server':next,'@/lib/dashboard/helpers':helpers,'@/lib/dashboard/summary':{getDashboardVideoDetail:async()=>{detailLoads++;return {marker:'fixture'};}}});
 const detailResponse=await detail.GET(new Request('https://fixture.invalid'),{params:Promise.resolve({videoId:id})});
 const failureLogs=[];
 for (const [route,method] of [['summary','getDashboardSummary'],['restaurants','getDashboardRestaurants'],['video/[videoId]','getDashboardVideoDetail']]) {
  const logs=[];
  const failure=new Error('UNTRUSTED_FIXTURE');failure.name='UNTRUSTED_FIXTURE'.repeat(512);
  const module=load(`app/api/dashboard/${route}/route.ts`,revision,{'next/server':next,'@/lib/dashboard/helpers':helpers,'@/lib/dashboard/summary':{[method]:async()=>{throw failure;}}},logs);
  const response=await module.GET(new next.NextRequest('https://fixture.invalid'),{params:Promise.resolve({videoId:'abc123DEF45'})});
  failureLogs.push({route,status:response.status,argumentCount:logs[0]?.length??0,maxStringLength:Math.max(0,...logs.flat().filter(x=>typeof x==='string').map(x=>x.length)),untrustedNameLogged:logs.flat().includes(failure.name)});
 }
 results.push({label,revision,extractedLength:extracted?.length??null,advertisedVideos:advertised,classifier:helpers.classifyDashboardVideoId?.(id).status??'absent',detailStatus:detailResponse.status,detailLoads,failureLogs});
}
const value={purpose:'Behavior reproduction only; no performance acceptance or timing claim',results};
writeFileSync(path.join(evidence,'pr3031-reproduction.json'),JSON.stringify(value,null,2)+'\n');
console.log(JSON.stringify(value,null,2));

const loadSummary = (revision) => load('lib/dashboard/summary.ts',revision,{'node:crypto':require('node:crypto'),'./helpers':load('lib/dashboard/helpers.ts',revision,{}),'@/lib/dashboard/supabase':{}});
const before=loadSummary(baseline),after=loadSummary(null);
const loadHelpers=load('lib/dashboard/helpers.ts',baseline,{});
const now=new Date('2026-10-04T00:00:00.000Z');
let equivalenceCases=0,mismatches=0;
for(let size=0;size<40;size++) {
 const rows=Array.from({length:size},(_,i)=>({id:`fixture-${i}`,name:i%3===0?'':`fixture-${i}`,categories:['food',i%2?'other':'food'],road_address:null,jibun_address:null,origin_address:null,lat:i%3===0?null:37,lng:i%3===0?null:127,youtube_link:i%4===0?null:`https://youtu.be/video${i%7}fixture`,youtube_meta:null,source_type:'fixture',status:'approved',is_not_selected:i%3===0,geocoding_success:i%2===0,updated_at:[null,'','invalid-date','2026-01-01T00:00:00Z','2026-02-01T00:00:00Z'][i%5],created_at:null}));
 const compare=(left,right)=>{equivalenceCases++;if(JSON.stringify(left)!==JSON.stringify(right))mismatches++;};
 compare(before.buildDashboardSummaryFromRows(rows,now),after.buildDashboardSummaryFromRows(rows,now));
 for(const filter of [{},{onlyWithCoordinates:false},{onlyWithCoordinates:false,limit:3,offset:2},{q:'fixture'},{category:'other'},{q:'video',onlyWithCoordinates:false}]) compare(before.buildDashboardRestaurantsFromRows(rows,filter,now),after.buildDashboardRestaurantsFromRows(rows,filter,now));
 for(const id of ['video0fixture','video6fixture','absent111']) compare(rows.filter(row=>loadHelpers.extractVideoIdFromYoutubeLink(row.youtube_link)===id),after.selectDashboardRowsForVideoId(rows,id));
}
const equivalence={baseline,cases:equivalenceCases,mismatches,scope:'Real baseline source versus candidate summary, paging and selected rows for valid IDs, including null/invalid/tied dates; no timings'};
writeFileSync(path.join(evidence,'dashboard-equivalence.json'),JSON.stringify(equivalence,null,2)+'\n');
console.log(JSON.stringify(equivalence));
if(mismatches)process.exitCode=1;
