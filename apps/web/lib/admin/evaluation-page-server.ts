import 'server-only';
import { createHash } from 'node:crypto';
import { isRecord,normalizeEvaluationRecord,withAdminEvaluationDisplayName } from './normalize-evaluation-record';
import { summarizeEvaluationRecord } from './evaluation-summary';
import { formatSameVideoDuplicateWarning, type SameVideoDuplicateWarningCandidate } from '@/lib/admin-same-video-duplicate-warning';
import { findRestaurantIdentityWarnings, deletedRestaurantIdentityWarning } from '@/lib/admin-restaurant-identity-warning';
import { EvaluationWarningStream } from './evaluation-warning-stream';
import { extractVideoIdFromYoutubeLink } from '@/lib/dashboard/helpers';
import type { EvaluationQuery } from './evaluation-query';

type Result={data:unknown;error:{message?:string;code?:string}|null};
type RelatedQuery=PromiseLike<Result>&{
  select(columns:string):RelatedQuery;in(column:string,values:string[]):RelatedQuery;
  order(column:string,options:{ascending:boolean}):RelatedQuery;range(from:number,to:number):RelatedQuery;
};
type WarningMode='stream'|'rpc';
type WarningReadPath='WARNING_STREAM'|'WARNING_RPC'|'WARNING_STREAM_RUNTIME'|'WARNING_STREAM_UNICODE'|'WARNING_STREAM_CAPACITY';
const warningMode=():WarningMode=>process.env.ADMIN_EVALUATION_WARNING_READ_PATH==='rpc'?'rpc':'stream';
export interface EvaluationPageClient {
  rpc(name:string,args?:Record<string,unknown>):PromiseLike<Result>;
  from(name:'admin_evaluation_related_rows'):RelatedQuery;
}

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const REVISION=/^\d{1,20}$/;
const STAT_KEYS=['total','pending','approved','hold','db_conflict','ready_for_approval','unconfirmed_map','missing','not_selected','deleted'] as const;
export function supportsEvaluationWarningRuntime(versions:Readonly<Record<string,string|undefined>>=process.versions,locale=new Intl.Collator().resolvedOptions().locale) {
  return versions.unicode==='17.0'&&Boolean(versions.icu?.startsWith('78.'))&&locale==='en-US';
}
export function selectEvaluationWarningReadPath(mode:WarningMode,runtimeSupported=supportsEvaluationWarningRuntime()):WarningReadPath {
  return mode==='stream'?'WARNING_STREAM':runtimeSupported?'WARNING_RPC':'WARNING_STREAM_RUNTIME';
}

async function readStreamWarnings(client:EvaluationPageClient,records:ReturnType<typeof withAdminEvaluationDisplayName>[]) {
  const streams=new Map(records.map(record=>[record.id,new EvaluationWarningStream(record)]));
  const videos=[...new Set(records.map(record=>extractVideoIdFromYoutubeLink(record.youtube_link)).filter((video):video is string=>!!video))];
  if(videos.length)for(let offset=0;offset<=50000;offset+=200){
    const block=await client.from('admin_evaluation_related_rows').select('id,approved_name,origin_name,naver_name,google_name,phone,status,road_address,jibun_address,youtube_link,updated_by_admin_id,lat,lng,created_at,video_id,evaluation_results,name').in('video_id',videos)
      .order('created_at',{ascending:false}).order('id',{ascending:true}).range(offset,offset+199);
    if(block.error||!Array.isArray(block.data)||block.data.length>200||(offset===50000&&block.data.length))throw new Error('EVALUATION_RECORDS_UNAVAILABLE');
    const rows=block.data.map(value=>{
      const record=normalizeEvaluationRecord(value);if(!record||!UUID.test(record.id))throw new Error('EVALUATION_RECORDS_UNAVAILABLE');
      return withAdminEvaluationDisplayName(record);
    });
    for(const stream of streams.values())stream.add(rows);
    if(block.data.length<200)break;
  }
  return Object.fromEntries([...streams].map(([id,stream])=>[id,stream.result()]));
}
function validateStats(value:unknown) {
  if(!isRecord(value)||STAT_KEYS.some(key=>!Number.isSafeInteger(value[key])||(value[key] as number)<0)
    ||(value.total as number)>50000||STAT_KEYS.some(key=>(value[key] as number)>(value.total as number)))throw new Error('EVALUATION_RECORDS_UNAVAILABLE');
  return value;
}

export async function readDatabaseEvaluationPage(client:EvaluationPageClient,query:EvaluationQuery,limit:number,cursor:string|null,expectedRevision?:string,mode:WarningMode=warningMode()) {
  // The SQL warning adapter admits Unicode 15.1 plus the 37 Unicode 16/17
  // ASCII compatibility mappings. Case conversion and ordering are pinned to
  // ICU 78 / en-US. The existing JS stream remains the default and handles
  // unadmitted runtimes without changing warning semantics. RPC needs opt-in.
  let warningReadPath=selectEvaluationWarningReadPath(mode);
  if(!Number.isInteger(limit)||limit<1||limit>200)throw new Error('EVALUATION_QUERY_INVALID');
  const key=createHash('sha256').update(JSON.stringify(query)).digest('hex');
  let after:string|null=null;let expected:string|null=null;
  if(cursor){
    if(cursor.length>4096||!/^[a-zA-Z0-9_-]+$/.test(cursor))throw new Error('EVALUATION_CURSOR_INVALID');
    let value:unknown;try{value=JSON.parse(Buffer.from(cursor,'base64url').toString());}catch{throw new Error('EVALUATION_CURSOR_INVALID');}
    if(!isRecord(value)||value.query!==key||typeof value.id!=='string'||!UUID.test(value.id)||typeof value.revision!=='string'||!REVISION.test(value.revision))throw new Error('EVALUATION_CURSOR_INVALID');
    after=value.id;expected=value.revision;
  }
  if(expected&&expectedRevision&&expected!==expectedRevision)throw new Error('EVALUATION_CURSOR_STALE');
  const result=await client.rpc('admin_evaluation_page',{page_query:query,page_size:limit,after_id:after,expected_revision:expected??expectedRevision??null});
  if(result.error){
    if(result.error.message?.includes('EVALUATION_CURSOR_STALE'))throw new Error('EVALUATION_CURSOR_STALE');
    if(result.error.message?.includes('EVALUATION_QUERY_INVALID'))throw new Error('EVALUATION_QUERY_INVALID');
    throw new Error('EVALUATION_RECORDS_UNAVAILABLE');
  }
  const page=result.data;
  if(!isRecord(page)||!Array.isArray(page.records)||page.records.length>limit||typeof page.revision!=='string'||!REVISION.test(page.revision)
    ||typeof page.hasMore!=='boolean'||typeof page.filteredTotal!=='number'||!Number.isSafeInteger(page.filteredTotal)||page.filteredTotal<0||!isRecord(page.stats))throw new Error('EVALUATION_RECORDS_UNAVAILABLE');
  if(expectedRevision&&page.revision!==expectedRevision)throw new Error('EVALUATION_CURSOR_STALE');
  const stats=validateStats(page.stats);
  if(page.filteredTotal>(stats.total as number)||page.filteredTotal<page.records.length)throw new Error('EVALUATION_RECORDS_UNAVAILABLE');
  const full=page.records.map(raw=>{
    const record=normalizeEvaluationRecord(raw);if(!record||!isRecord(raw)||!UUID.test(record.id))throw new Error('EVALUATION_RECORDS_UNAVAILABLE');
    return {raw,record:withAdminEvaluationDisplayName(record)};
  });
  if(new Set(full.map(({record})=>record.id)).size!==full.length)throw new Error('EVALUATION_RECORDS_UNAVAILABLE');
  if(page.hasMore&&(full.length!==limit||typeof page.afterId!=='string'||page.afterId!==full.at(-1)?.record.id))throw new Error('EVALUATION_RECORDS_UNAVAILABLE');
  const warnings:Record<string,{sameVideo:{count:number;candidates:SameVideoDuplicateWarningCandidate[];message:string};identity:ReturnType<typeof findRestaurantIdentityWarnings>}>={};
  let grouped:Result|null=null;
  if(full.length&&warningReadPath==='WARNING_RPC'){
    grouped=await client.rpc('admin_evaluation_warning_groups',{page_ids:full.map(({record})=>record.id),expected_revision:page.revision});
    if(grouped.error?.message==='EVALUATION_CURSOR_STALE')throw new Error('EVALUATION_CURSOR_STALE');
    if(grouped.error){
      // Only exact SQL admission refusals can use the existing JS algorithm.
      // Never disguise transport/DB errors, missing RPCs or malformed results.
      if(grouped.data!==null||grouped.error.code!=='P0001')throw new Error('EVALUATION_RECORDS_UNAVAILABLE');
      if(grouped.error.message==='EVALUATION_WARNING_UNICODE_UNSUPPORTED')warningReadPath='WARNING_STREAM_UNICODE';
      else if(grouped.error.message==='EVALUATION_WARNING_CAPACITY_EXCEEDED')warningReadPath='WARNING_STREAM_CAPACITY';
      else throw new Error('EVALUATION_RECORDS_UNAVAILABLE');
    }
  }
  if(full.length&&warningReadPath==='WARNING_RPC'){
    const data=grouped?.data;
    if(!grouped||grouped.error||!isRecord(data)||data.revision!==page.revision||!Array.isArray(data.groups)||data.groups.length!==full.length)throw new Error('EVALUATION_RECORDS_UNAVAILABLE');
    const records=new Map(full.map(({record})=>[record.id,record]));
    const count=(value:unknown):value is number=>typeof value==='number'&&Number.isSafeInteger(value)&&value>=0&&value<=50000;
    const rules={exact_identity:1,same_phone_similar_name:0.98,same_address_similar_name:0.97,near_coordinate_similar_name:0.96};
    for(const group of data.groups){
      if(!isRecord(group)||typeof group.id!=='string'||!records.has(group.id)||warnings[group.id]||!isRecord(group.sameVideo)||!isRecord(group.deleted))throw new Error('EVALUATION_RECORDS_UNAVAILABLE');
      const {sameVideo,deleted}=group;
      if(!count(sameVideo.count)||!count(deleted.count)||!Array.isArray(sameVideo.candidates)||sameVideo.candidates.length!==Math.min(3,sameVideo.count)
        ||!Array.isArray(deleted.samples)||deleted.samples.length!==Math.min(3,deleted.count))throw new Error('EVALUATION_RECORDS_UNAVAILABLE');
      const candidates=sameVideo.candidates.map((candidate:unknown)=>{
        if(!isRecord(candidate)||typeof candidate.id!=='string'||!UUID.test(candidate.id)||candidate.id===group.id||typeof candidate.name!=='string'
          ||(candidate.status!==null&&typeof candidate.status!=='string')||(candidate.address!==null&&typeof candidate.address!=='string')
          ||typeof candidate.adminTouched!=='boolean'||typeof candidate.rule!=='string'||!Object.hasOwn(rules,candidate.rule)
          ||candidate.confidence!==rules[candidate.rule as keyof typeof rules])throw new Error('EVALUATION_RECORDS_UNAVAILABLE');
        return {id:candidate.id,name:candidate.name,status:candidate.status as string|null,address:candidate.address as string|null,
          adminTouched:candidate.adminTouched,rule:candidate.rule as SameVideoDuplicateWarningCandidate['rule'],confidence:candidate.confidence as number};
      });
      const samples=deleted.samples.map((sample:unknown)=>{
        if(!isRecord(sample)||typeof sample.id!=='string'||!UUID.test(sample.id)||sample.id===group.id
          ||(sample.origin_name!==null&&typeof sample.origin_name!=='string')||typeof sample.candidate_name!=='string')throw new Error('EVALUATION_RECORDS_UNAVAILABLE');
        return {id:sample.id,origin_name:sample.origin_name as string|null,approved_name:sample.candidate_name};
      });
      if(new Set(candidates.map(candidate=>candidate.id)).size!==candidates.length||new Set(samples.map(sample=>sample.id)).size!==samples.length)throw new Error('EVALUATION_RECORDS_UNAVAILABLE');
      const target=records.get(group.id)!;const identity=findRestaurantIdentityWarnings(target,[]);
      if(deleted.count)identity.push(deletedRestaurantIdentityWarning(samples,deleted.count));
      identity.sort((left,right)=>left.severity===right.severity?0:left.severity==='block'?-1:1);
      warnings[group.id]={sameVideo:{count:sameVideo.count,candidates,message:formatSameVideoDuplicateWarning(candidates,sameVideo.count)},identity};
    }
  }
  if(warningReadPath!=='WARNING_RPC')Object.assign(warnings,await readStreamWarnings(client,full.map(({record})=>record)));
  const revision=await client.rpc('admin_evaluation_revision');
  if(revision.error||revision.data!==page.revision)throw new Error('EVALUATION_CURSOR_STALE');
  return {records:full.map(({raw,record})=>summarizeEvaluationRecord(raw,record)),stats,filteredTotal:page.filteredTotal,revision:page.revision,
    nextCursor:page.hasMore?Buffer.from(JSON.stringify({revision:page.revision,query:key,id:page.afterId})).toString('base64url'):null,
    warnings,warningReadPath};
}

type Page=Awaited<ReturnType<typeof readDatabaseEvaluationPage>>;
type Entry={page:Page;expires:number;bytes:number};

/** Bounded summary pages; every request checks a fresh DB revision before reuse. */
export class DatabaseEvaluationPageCache {
  private entries=new Map<string,Entry>();
  private pending=new Map<string,Promise<Page>>();
  private revisions=new Map<string,Promise<string>>();
  private bytes=0;
  constructor(private readonly now=Date.now) {}

  async read(client:EvaluationPageClient,scope:string,query:EvaluationQuery,limit:number,cursor:string|null) {
    let revisionPromise=this.revisions.get(scope);
    if(!revisionPromise) {
      revisionPromise=Promise.resolve(client.rpc('admin_evaluation_revision')).then(result=>{
        if(result.error||typeof result.data!=='string'||!REVISION.test(result.data))throw new Error('EVALUATION_RECORDS_UNAVAILABLE');
        return result.data;
      });
      this.revisions.set(scope,revisionPromise);
    }
    let revision:string;
    try {revision=await revisionPromise;}
    finally {if(this.revisions.get(scope)===revisionPromise)this.revisions.delete(scope);}
    const mode=warningMode();
    const key=`${scope}:${mode}:${revision}:${createHash('sha256').update(JSON.stringify([query,limit,cursor])).digest('hex')}`;
    for(const [id,entry] of this.entries)if(entry.expires<=this.now())this.evict(id);
    const cached=this.entries.get(key);
    if(cached){this.entries.delete(key);this.entries.set(key,cached);return cached.page;}
    const existing=this.pending.get(key);if(existing)return existing;
    if(this.pending.size>=4)throw new Error('EVALUATION_READ_CAPACITY_EXCEEDED');
    const work=readDatabaseEvaluationPage(client,query,limit,cursor,revision,mode);this.pending.set(key,work);
    try {
      const page=await work;const bytes=Buffer.byteLength(JSON.stringify(page));
      if(bytes<=8*1024*1024){
        while(this.entries.size>=16||this.bytes+bytes>8*1024*1024)this.evict(this.entries.keys().next().value!);
        this.entries.set(key,{page,bytes,expires:this.now()+30000});this.bytes+=bytes;
      }
      return page;
    }finally{this.pending.delete(key);}
  }

  private evict(key:string){const entry=this.entries.get(key);if(entry){this.bytes-=entry.bytes;this.entries.delete(key);}}
}
