import { describe, expect, mock, test } from 'bun:test';
mock.module('server-only',()=>({}));
const {readDatabaseEvaluationPage,DatabaseEvaluationPageCache}=await import('../lib/admin/evaluation-page-server');
import type {EvaluationPageClient} from '../lib/admin/evaluation-page-server';
const query={searchQuery:'',evalFilters:{},deepLinkFilter:null};
const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const row=(n:number)=>({id:id(n),origin_name:'fixture',approved_name:'fixture',name:'fixture',status:'pending',created_at:'2026-01-01T00:00:00Z',youtube_link:'https://youtu.be/abcdefghijk'});
const stats={total:201,pending:201,approved:0,hold:0,db_conflict:0,ready_for_approval:0,unconfirmed_map:0,missing:0,not_selected:0,deleted:0};
function fixture() {
  let revision='1';let finishRevision:string|null=null;let bad:unknown=null;let loads=0;const ranges:number[][]=[];
  const related=Array.from({length:201},(_,i)=>row(i));
  const rpc=mock(async(name:string)=>{
    if(name==='admin_evaluation_revision')return {data:finishRevision??revision,error:null};
    if(name!=='admin_evaluation_page')throw new Error('unexpected_catalog_read');
    loads++;return {data:bad??{records:[row(0)],stats,filteredTotal:201,revision,hasMore:true,afterId:id(0)},error:null};
  });
  const client={rpc,from:()=>{
    const builder={select:(cols:string)=>{expect(cols).not.toBe('*');return builder;},in:()=>builder,order:()=>builder,
      range:(from:number,to:number)=>{ranges.push([from,to]);return {then:(resolve:(value:unknown)=>unknown)=>Promise.resolve({data:related.slice(from,to+1),error:null}).then(resolve)};}};
    return builder;
  }} as unknown as EvaluationPageClient;
  return {client,rpc,ranges,loads:()=>loads,setRevision:(r:string)=>{revision=r;},setFinish:(r:string)=>{finishRevision=r;},setBad:(r:unknown)=>{bad=r;}};
}

describe('DB-backed bounded evaluation pages',()=>{
  test('reads only the page and batches related warnings across the page boundary',async()=>{
    const f=fixture();const page=await readDatabaseEvaluationPage(f.client,query,1,null);
    expect(f.loads()).toBe(1);expect(f.ranges).toEqual([[0,199],[200,399]]);
    expect(page.records).toHaveLength(1);expect(page.stats.total).toBe(201);
    expect(page.warnings[id(0)].sameVideo.count).toBe(200);
    expect(page.warnings[id(0)].sameVideo.candidates).toHaveLength(3);
    expect(page.nextCursor).not.toBeNull();
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
