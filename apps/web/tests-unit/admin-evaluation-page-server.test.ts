import { describe, expect, mock, test } from 'bun:test';
mock.module('server-only',()=>({}));
const {readDatabaseEvaluationPage,DatabaseEvaluationPageCache,supportsEvaluationWarningRuntime,selectEvaluationWarningReadPath}=await import('../lib/admin/evaluation-page-server');
import { WARNING_TUPLE_FIELDS } from '../lib/admin/evaluation-warning-adaptive-codec';
import type {EvaluationPageClient} from '../lib/admin/evaluation-page-server';
const query={searchQuery:'',evalFilters:{},deepLinkFilter:null};
const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const row=(n:number)=>({id:id(n),origin_name:'fixture',approved_name:'fixture',name:'fixture',status:'pending',created_at:'2026-01-01T00:00:00Z',youtube_link:'https://youtu.be/abcdefghijk',naver_name:null,google_name:null,phone:null,road_address:null,jibun_address:null,updated_by_admin_id:null,lat:null,lng:null});
const stats={total:201,pending:201,approved:0,hold:0,db_conflict:0,ready_for_approval:0,unconfirmed_map:0,missing:0,not_selected:0,deleted:0};
function fixture(related=Array.from({length:201},(_,i)=>row(i))) {
  let revision='1';let finishRevision:string|null=null;let bad:unknown=null;let loads=0;const ranges:number[][]=[];
  let warningReply:unknown=null;let relatedReply:unknown=null;let warningThrow=false;
  const rpc=mock(async(name:string,args?:Record<string,unknown>)=>{
    if(name==='admin_evaluation_revision')return {data:finishRevision??revision,error:null};
    if(name==='admin_evaluation_raw_warning_groups'){
      const groups=new Map<string,{attrs:Record<string,unknown>;count:number;firstOrder:number;selfIds:string[];samples:{id:string;sourceOrder:number}[]}>();
      for(const [index,item] of related.entries()){
        const source=item as Record<string,unknown>;const attrs:Record<string,unknown>={};
        for(const key of ['approved_name','origin_name','naver_name','google_name','phone','status','road_address','jibun_address','youtube_link','updated_by_admin_id','lat','lng','name'])attrs[key]=source[key]??null;
        attrs.evaluation_results={location_match_TF:{eval_value:null,match_status:null,naver_name:null,matched_provider:null,matched_name:null}};
        const key=JSON.stringify(attrs);let group=groups.get(key);
        if(!group){group={attrs,count:0,firstOrder:index+1,selfIds:[],samples:[]};groups.set(key,group);}
        group.count++;if(item.id===related[0].id)group.selfIds.push(item.id);
        if(group.samples.length<4)group.samples.push({id:item.id,sourceOrder:index+1});
      }
      const all=[...groups.values()];const after=(args?.after_cursor as {offset:number}|null)?.offset??0;const previous=all.filter(group=>group.firstOrder<=after);const batch=all.filter(group=>group.firstOrder>after).slice(0,1000);
      return {data:{codecVersion:1,mode:'grouped',cursor:{revision,pageIds:[related[0].id],mode:'grouped',totalRows:related.length,offset:batch.at(-1)?.firstOrder??after,afterId:related[(batch.at(-1)?.firstOrder??after)-1].id,afterCreated:related[0].created_at},revision,pageIds:[related[0].id],totalRows:related.length,totalGroups:all.length,groupOffset:previous.length,rowOffset:previous.reduce((n,g)=>n+g.count,0),groups:batch,hasMore:previous.length+batch.length<all.length,nextAfterOrder:batch.at(-1)?.firstOrder??after},error:null};
    }
    if(name==='admin_evaluation_warning_groups'){if(warningThrow)throw new Error('network_failure');return warningReply??{data:{revision,groups:[{id:id(0),sameVideo:{count:200,candidates:[1,2,3].map(n=>({id:id(n),name:'fixture',status:'pending',address:null,adminTouched:false,rule:'exact_identity',confidence:1}))},deleted:{count:0,samples:[]}}]},error:null};}
    if(name!=='admin_evaluation_page')throw new Error('unexpected_catalog_read');
    loads++;return {data:bad??{records:[related[0]],stats,filteredTotal:201,revision,hasMore:true,afterId:id(0)},error:null};
  });
  const client={rpc,from:()=>{
    const builder={select:(cols:string)=>{expect(cols).not.toBe('*');return builder;},in:()=>builder,order:()=>builder,
      range:(from:number,to:number)=>{ranges.push([from,to]);return {then:(resolve:(value:unknown)=>unknown)=>Promise.resolve(relatedReply??{data:related.slice(from,to+1),error:null}).then(resolve)};}};
    return builder;
  }} as unknown as EvaluationPageClient;
  return {client,rpc,ranges,setWarning:(value:unknown)=>{warningReply=value;},setRelated:(value:unknown)=>{relatedReply=value;},throwWarning:()=>{warningThrow=true;},loads:()=>loads,setRevision:(r:string)=>{revision=r;},setFinish:(r:string)=>{finishRevision=r;},setBad:(r:unknown)=>{bad=r;}};
}

describe('DB-backed bounded evaluation pages',()=>{
  test('pins normalization and default ordering rather than silently accepting runtime drift',()=>{
    expect(supportsEvaluationWarningRuntime({icu:'78.3',unicode:'17.0'},'en-US')).toBe(true);
    expect(supportsEvaluationWarningRuntime({icu:'77.1',unicode:'17.0'},'en-US')).toBe(false);
    expect(supportsEvaluationWarningRuntime({icu:'78.3',unicode:'16.0'},'en-US')).toBe(false);
    expect(supportsEvaluationWarningRuntime({icu:'78.3',unicode:'17.0'},'ko-KR')).toBe(false);
    expect(selectEvaluationWarningReadPath('stream',false)).toBe('WARNING_STREAM');
    expect(selectEvaluationWarningReadPath('rpc',false)).toBe('WARNING_STREAM_RUNTIME');
    expect(selectEvaluationWarningReadPath('raw',false)).toBe('WARNING_RAW_GROUPS');
  });
  test('reads only the page and bounded database warning aggregates across the page boundary',async()=>{
    const f=fixture();const page=await readDatabaseEvaluationPage(f.client,query,1,null,undefined,'rpc');
    expect(page.warningReadPath).toBe('WARNING_RPC');
    expect(f.loads()).toBe(1);expect(f.ranges).toEqual([]);
    expect(f.rpc.mock.calls.map(call=>call[0])).toEqual(['admin_evaluation_page','admin_evaluation_warning_groups','admin_evaluation_revision']);
    expect(page.records).toHaveLength(1);expect(page.stats.total).toBe(201);
    expect(page.warnings[id(0)].sameVideo.count).toBe(200);
    expect(page.warnings[id(0)].sameVideo.candidates).toHaveLength(3);
    expect(page.nextCursor).not.toBeNull();
  });
  test('explicit compatibility stream does not depend on RPC admission',async()=>{
    const f=fixture();f.throwWarning();const page=await readDatabaseEvaluationPage(f.client,query,1,null,undefined,'stream');
    expect(page.warningReadPath).toBe('WARNING_STREAM');expect(f.ranges).toEqual([[0,199],[200,399]]);
    expect(page.warnings[id(0)].sameVideo.count).toBe(200);
    expect(f.rpc.mock.calls.map(call=>call[0])).toEqual(['admin_evaluation_page','admin_evaluation_revision']);
  });
  test('defaults to the compatibility stream until adaptive admission is approved',async()=>{
    const f=fixture();const page=await readDatabaseEvaluationPage(f.client,query,1,null);
    expect(page.warningReadPath).toBe('WARNING_STREAM');expect(f.ranges).toEqual([[0,199],[200,399]]);
    expect(page.warnings[id(0)].sameVideo.count).toBe(200);
    expect(f.rpc.mock.calls.map(call=>call[0])).toEqual(['admin_evaluation_page','admin_evaluation_revision']);
  });
  test('only exact SQL Unicode/capacity admission failures use the complete existing stream',async()=>{
    const related=Array.from({length:201},(_,i)=>({...row(i),approved_name:'a\u0897',origin_name:'a\u0897',status:i>=199?'deleted':'pending'}));
    const baseline=fixture(related);const expected=await readDatabaseEvaluationPage(baseline.client,query,1,null);
    expect(expected.warnings[id(0)].sameVideo.count).toBe(198);
    expect(expected.warnings[id(0)].identity.some(warning=>warning.rule==='deleted_same_video_identity')).toBe(true);
    for(const [message,path] of [['EVALUATION_WARNING_UNICODE_UNSUPPORTED','WARNING_STREAM_UNICODE'],['EVALUATION_WARNING_CAPACITY_EXCEEDED','WARNING_STREAM_CAPACITY']]){
      const f=fixture(related);f.setWarning({data:null,error:{code:'P0001',message}});
      const actual=await readDatabaseEvaluationPage(f.client,query,1,null,undefined,'rpc');
      expect(actual.warningReadPath).toBe(path);expect(actual.warnings).toEqual(expected.warnings);expect(f.ranges).toEqual([[0,199],[200,399]]);
      f.setFinish('2');await expect(readDatabaseEvaluationPage(f.client,query,1,null,undefined,'rpc')).rejects.toThrow('EVALUATION_CURSOR_STALE');
    }
  });
  test('does not hide transport, DB, malformed, unknown or stale RPC failures',async()=>{
    for(const reply of [
      {data:null,error:{code:'08006',message:'EVALUATION_WARNING_UNICODE_UNSUPPORTED'}},
      {data:null,error:{code:'P0001',message:'prefix EVALUATION_WARNING_CAPACITY_EXCEEDED'}},
      {data:null,error:{code:'P0001',message:'EVALUATION_WARNING_COORDINATE_UNSUPPORTED'}},
      {data:{},error:{code:'P0001',message:'EVALUATION_WARNING_UNICODE_UNSUPPORTED'}},
      {data:{revision:'1',groups:[]},error:null},
      {data:null,error:{code:'42883',message:'function missing'}},
    ]){
      const f=fixture();f.setWarning(reply);
      await expect(readDatabaseEvaluationPage(f.client,query,1,null,undefined,'rpc')).rejects.toThrow('EVALUATION_RECORDS_UNAVAILABLE');expect(f.ranges).toEqual([]);
    }
    const f=fixture();f.throwWarning();await expect(readDatabaseEvaluationPage(f.client,query,1,null,undefined,'rpc')).rejects.toThrow('network_failure');expect(f.ranges).toEqual([]);
    const stale=fixture();stale.setWarning({data:null,error:{code:'P0001',message:'EVALUATION_CURSOR_STALE'}});
    await expect(readDatabaseEvaluationPage(stale.client,query,1,null,undefined,'rpc')).rejects.toThrow('EVALUATION_CURSOR_STALE');expect(stale.ranges).toEqual([]);
  });
  test('stream failures remain errors after an admission refusal',async()=>{
    for(const related of [{data:null,error:{message:'unavailable'}},{data:[{id:'invalid'}],error:null}]){
      const f=fixture();f.setWarning({data:null,error:{code:'P0001',message:'EVALUATION_WARNING_CAPACITY_EXCEEDED'}});f.setRelated(related);
      await expect(readDatabaseEvaluationPage(f.client,query,1,null,undefined,'rpc')).rejects.toThrow('EVALUATION_RECORDS_UNAVAILABLE');
    }
  });
  test('refuses source mutation during warnings and does not pass partial statistics',async()=>{
    const f=fixture();f.setFinish('2');await expect(readDatabaseEvaluationPage(f.client,query,1,null)).rejects.toThrow('EVALUATION_CURSOR_STALE');
    const malformed=fixture();malformed.setBad({records:[row(0)],stats:{total:1},filteredTotal:1,revision:'1',hasMore:false});
    await expect(readDatabaseEvaluationPage(malformed.client,query,1,null)).rejects.toThrow('EVALUATION_RECORDS_UNAVAILABLE');
  });
  test('rejects malformed UUID/cross-filter cursors and duplicate row IDs',async()=>{
    const f=fixture();const page=await readDatabaseEvaluationPage(f.client,query,1,null);
    await expect(readDatabaseEvaluationPage(f.client,{...query,searchQuery:'changed'},1,page.nextCursor)).rejects.toThrow('EVALUATION_CURSOR_INVALID');
    const malformed=Buffer.from(JSON.stringify({...JSON.parse(Buffer.from(page.nextCursor!,'base64url').toString()),id:'-'.repeat(36)})).toString('base64url');
    await expect(readDatabaseEvaluationPage(f.client,query,1,malformed)).rejects.toThrow('EVALUATION_CURSOR_INVALID');
    f.setBad({records:[row(0),row(0)],stats,filteredTotal:201,revision:'1',hasMore:false});
    await expect(readDatabaseEvaluationPage(f.client,query,2,null)).rejects.toThrow('EVALUATION_RECORDS_UNAVAILABLE');
  });
  test('coalesces 100 cold reads, reuses summaries, and refreshes after a revision or TTL change',async()=>{
    let now=0;const cache=new DatabaseEvaluationPageCache(()=>now);const f=fixture();
    const pages=await Promise.all(Array.from({length:100},()=>cache.read(f.client,'tenant',query,1,null)));
    expect(f.loads()).toBe(1);expect(pages.every(page=>page===pages[0])).toBe(true);
    await cache.read(f.client,'tenant',query,1,null);expect(f.loads()).toBe(1);
    now=30000;await cache.read(f.client,'tenant',query,1,null);expect(f.loads()).toBe(2);
    f.setRevision('2');await cache.read(f.client,'tenant',query,1,null);expect(f.loads()).toBe(3);
    await expect(cache.read(f.client,'tenant',query,1,pages[0].nextCursor)).rejects.toThrow('EVALUATION_CURSOR_STALE');
    await cache.read(f.client,'other-tenant',query,1,null);expect(f.loads()).toBe(4);
  });
  test('never caches a failed or inconsistent load',async()=>{
    const cache=new DatabaseEvaluationPageCache();const f=fixture();f.setFinish('2');
    await expect(cache.read(f.client,'tenant',query,1,null)).rejects.toThrow('EVALUATION_CURSOR_STALE');
    f.setRevision('2');const page=await cache.read(f.client,'tenant',query,1,null);expect(page.revision).toBe('2');expect(f.loads()).toBe(2);
  });
  test('evicts older queries rather than retaining an unbounded catalog of pages',async()=>{
    const cache=new DatabaseEvaluationPageCache();const f=fixture();
    for(let i=0;i<17;i++)await cache.read(f.client,'tenant',{...query,searchQuery:String(i)},1,null);
    expect(f.loads()).toBe(17);
    await cache.read(f.client,'tenant',{...query,searchQuery:'0'},1,null);expect(f.loads()).toBe(18);
  });
});


describe('raw warning server transport', () => {
  const id = (n: number) => `00000000-0000-0000-0000-${String(n + 1).padStart(12, '0')}`;
  const query = { searchQuery: '', evalFilters: {}, deepLinkFilter: null };
  const attrs = { approved_name: 'a\u0897', origin_name: 'a\u0897', naver_name: null, google_name: null, phone: null, status: 'pending',
    road_address: null, jibun_address: null, youtube_link: 'https://youtu.be/ABCDEFGHIJK', updated_by_admin_id: null, lat: null, lng: null,
    evaluation_results: { location_match_TF: { eval_value: null, match_status: null, naver_name: null, matched_provider: null, matched_name: null } }, name: 'a\u0897' };
  const rows = Array.from({ length: 300 }, (_, n) => ({ ...attrs, id: id(n), created_at:'2026-01-01T00:00:00+00:00',video_id:'ABCDEFGHIJK',phone:String(n),status:n>=298?'deleted':'pending' }));
  const tuple = (row: typeof rows[number]) => WARNING_TUPLE_FIELDS.map(key => row[key]);
  const cursor = (offset:number) => ({revision:'1',pageIds:[id(0)],mode:'flat',totalRows:300,offset,afterId:id(offset-1),afterCreated:rows[0].created_at});
  const data = { codecVersion:1,mode:'flat',revision:'1',pageIds:[id(0)],totalRows:300,rowOffset:0,tuples:rows.map(tuple),hasMore:false,cursor:cursor(300) };
  function fixture(replies: unknown[] = [{ data, error: null }]) {
    const calls: { name: string; args?: Record<string, unknown> }[] = []; let requests = 0; let streams = 0; let finalRevision = '1';
    const client = {
      rpc: async (name: string, args?: Record<string, unknown>) => {
        calls.push({ name, args });
        if (name === 'admin_evaluation_revision') return { data: finalRevision, error: null };
        if (name === 'admin_evaluation_raw_warning_groups') { const value = replies[requests++]; if (value instanceof Error) throw value; return value; }
        if (name !== 'admin_evaluation_page') throw new Error('unexpected_rpc');
        return { data: { records: [rows[0]], revision: '1', hasMore: false, filteredTotal: 300, stats: { total: 300, pending: 298, approved: 0, hold: 0, db_conflict: 0, ready_for_approval: 0, unconfirmed_map: 0, missing: 0, not_selected: 0, deleted: 2 } }, error: null };
      },
      from: () => { const builder = { select: () => builder, in: () => builder, order: () => builder,
        range: (from:number,to:number) => { streams++; return Promise.resolve({ data: rows.slice(from,to+1), error: null }); } }; return builder; },
    } as unknown as EvaluationPageClient;
    return { client, calls, streams: () => streams, setFinal: (value: string) => { finalRevision = value; } };
  }

  test('raw RPC preserves unsupported Unicode and deleted union without the SQL ICU gate', async () => {
    const f = fixture(); const raw = await readDatabaseEvaluationPage(f.client, query, 1, null, undefined, 'raw');
    const stream = await readDatabaseEvaluationPage(fixture().client, query, 1, null, undefined, 'stream');
    expect(raw.warnings).toEqual(stream.warnings); expect(raw.warningReadPath).toBe('WARNING_RAW_FLAT'); expect(f.streams()).toBe(0);
    expect(raw.warnings[id(0)].sameVideo.count).toBe(297);
    expect(f.calls[1]).toEqual({ name: 'admin_evaluation_raw_warning_groups', args: { page_ids: [id(0)], expected_revision: '1', after_cursor: null, batch_size: 1000 } });
  });

  test('advances bound cursor and restarts complete stream only on exact capacity refusal after a partial batch', async () => {
    const first = { data: { ...data, tuples:data.tuples.slice(0,150), hasMore: true, cursor:cursor(150) }, error: null };
    const second = { data: { ...data, tuples:data.tuples.slice(150), rowOffset:150 }, error: null };
    const good = fixture([first, second]); const raw = await readDatabaseEvaluationPage(good.client, query, 1, null, undefined, 'raw');
    expect(good.calls[2].args?.after_cursor).toEqual(cursor(150));
    const fallback = fixture([first, { data: null, error: { code: 'P0001', message: 'EVALUATION_WARNING_RAW_CAPACITY_EXCEEDED' } }]);
    const page = await readDatabaseEvaluationPage(fallback.client, query, 1, null, undefined, 'raw');
    expect(page.warnings).toEqual(raw.warnings); expect(page.warningReadPath).toBe('WARNING_STREAM_RAW_CAPACITY'); expect(fallback.streams()).toBe(2);
  });

  test('raw transport, unknown, permission, malformed and stale failures never trigger stream fallback', async () => {
    for (const reply of [
      new Error('network_failure'), { data: null, error: { code: '42883', message: 'missing_rpc' } },
      { data: null, error: { code: '42501', message: 'permission_denied' } },
      { data: null, error: { code: '08006', message: 'EVALUATION_WARNING_RAW_CAPACITY_EXCEEDED' } },
      { data: null, error: { code: 'P0001', message: 'prefix EVALUATION_WARNING_RAW_CAPACITY_EXCEEDED' } },
      { data: {}, error: { code: 'P0001', message: 'EVALUATION_WARNING_RAW_CAPACITY_EXCEEDED' } },
      { data: { ...data, totalRows: 11 }, error: null }, { data: { ...data, revision: '2' }, error: null },
      { data: null, error: { code: 'P0001', message: 'EVALUATION_CURSOR_STALE' } },
    ]) {
      const f = fixture([reply]); await expect(readDatabaseEvaluationPage(f.client, query, 1, null, undefined, 'raw')).rejects.toThrow(); expect(f.streams()).toBe(0);
    }
    const final = fixture(); final.setFinal('2'); await expect(readDatabaseEvaluationPage(final.client, query, 1, null, undefined, 'raw')).rejects.toThrow('EVALUATION_CURSOR_STALE');
  });
});
