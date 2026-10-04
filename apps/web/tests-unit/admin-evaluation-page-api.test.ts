import { describe, expect, mock, test } from 'bun:test';
mock.module('server-only',()=>({}));
let authStatus=200;let revision='1';let creations=0;
const calls:string[]=[];
const row={id:'00000000-0000-4000-8000-000000000001',name:'fixture',approved_name:'fixture',status:'pending',created_at:'2026-01-01T00:00:00Z',youtube_link:''};
const stats={total:1,pending:1,approved:0,hold:0,db_conflict:0,ready_for_approval:0,unconfirmed_map:0,missing:0,not_selected:0,deleted:0};
mock.module('@/lib/auth/require-admin',()=>({requireAdmin:async()=>authStatus===200?{ok:true}:{ok:false,response:Response.json({error:'Unauthorized'},{status:authStatus})}}));
mock.module('@/lib/supabase/service-role',()=>({createSupabaseServiceRoleClient:()=>{
  creations++;return {
    rpc:async(name:string)=>{calls.push(name);if(name==='admin_evaluation_revision')return {data:revision,error:null};if(name!=='admin_evaluation_page')throw new Error('full_snapshot_forbidden');return {data:{revision,records:[row],stats,filteredTotal:1,hasMore:false,afterId:null},error:null};},
    from:(name:string)=>{calls.push(name);if(name!=='restaurants')throw new Error('unexpected_view');const chain={select:()=>chain,range:()=>chain,order:()=>chain,then:(resolve:(r:unknown)=>unknown)=>Promise.resolve({data:[row],error:null}).then(resolve)};return chain;},
  };
}}));
const {GET}=await import('../app/api/admin/evaluations/route');

describe('admin paginated HTTP read contract',()=>{
  test('denies browser/non-admin calls before privileged work',async()=>{
    const start=creations;
    for(const status of [401,403]){authStatus=status;expect((await GET(new Request('https://tzudong.app/api/admin/evaluations?view=page'))).status).toBe(status);}
    expect(creations).toBe(start);authStatus=200;
  });
  test('cold and repeated pages never read the full catalog, and remain private',async()=>{
    calls.length=0;
    const first=await GET(new Request('https://tzudong.app/api/admin/evaluations?view=page'));
    expect(first.status).toBe(200);expect(first.headers.get('cache-control')).toBe('private, no-store');
    expect((await first.json()).records).toHaveLength(1);
    expect(calls).toEqual(['admin_evaluation_revision','admin_evaluation_page','admin_evaluation_revision']);
    calls.length=0;const second=await GET(new Request('https://tzudong.app/api/admin/evaluations?view=page'));
    expect(second.status).toBe(200);expect(calls).toEqual(['admin_evaluation_revision']);
    revision='2';calls.length=0;expect((await GET(new Request('https://tzudong.app/api/admin/evaluations?view=page'))).status).toBe(200);
    expect(calls).toContain('admin_evaluation_page');
  });
  test('keeps the compatibility response and fixed invalid-query code',async()=>{
    calls.length=0;const legacy=await GET(new Request('https://tzudong.app/api/admin/evaluations'));
    expect(await legacy.json()).toEqual({records:[row]});expect(calls).toEqual(['restaurants']);
    const bad=await GET(new Request('https://tzudong.app/api/admin/evaluations?view=page&limit=201'));
    expect(bad.status).toBe(400);expect(await bad.json()).toEqual({error:'EVALUATION_QUERY_INVALID'});
  });
});
