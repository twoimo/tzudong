import { afterAll, describe, expect, mock, test } from 'bun:test';
import { fetchAdminEvaluationPage } from '@/lib/admin/evaluation-page-client';

let revisionReads: string[] = [];
let rowReads = 0;
let allowed = true;
let rowError = false;
let serviceRoleKeyMissing = false;
mock.module('@/lib/auth/require-admin', () => ({ requireAdmin: async () => allowed ? { ok: true } : { ok: false, response: new Response(null,{status:403}) } }));
mock.module('@/lib/supabase/service-role', () => ({ createSupabaseServiceRoleClient: () => {
  if (serviceRoleKeyMissing) throw new Error('Supabase environment variables are missing (NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY).');
  return {
    rpc: async () => ({ data: revisionReads.shift(), error: null }),
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => { rowReads++; return { data: { id:'00000000-0000-0000-0000-000000000001' },error:rowError?'fixture':null }; } }) }) }),
  };
} }));
const { GET } = await import('@/app/api/admin/evaluations/[id]/route');
const context = { params: Promise.resolve({ id:'00000000-0000-0000-0000-000000000001' }) };
const originalFetch=globalThis.fetch;
afterAll(()=>{globalThis.fetch=originalFetch;mock.restore();});

describe('revision-bound detail reads',()=>{
  test('rejects a changed version before reading a row and enforces administrator auth',async()=>{
    rowReads=0;revisionReads=['2'];allowed=true;
    expect((await GET(new Request('http://fixture.test/api?revision=1'),context)).status).toBe(409);
    expect(rowReads).toBe(0);
    allowed=false;
    expect((await GET(new Request('http://fixture.test/api?revision=1'),context)).status).toBe(403);
    expect(rowReads).toBe(0);allowed=true;
  });
  test('a write during row retrieval cannot mix stale statistics with new details',async()=>{
    rowReads=0;revisionReads=['1','2'];
    const response=await GET(new Request('http://fixture.test/api?revision=1'),context);
    expect(response.status).toBe(409);expect(rowReads).toBe(1);
    expect(await response.json()).toEqual({error:'EVALUATION_CURSOR_STALE'});
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
  });
  test('returns complete current details when the version matches and retains legacy reads',async()=>{
    revisionReads=['1','1'];
    expect((await GET(new Request('http://fixture.test/api?revision=1'),context)).status).toBe(200);
    revisionReads=[];
    expect((await GET(new Request('http://fixture.test/api'),context)).status).toBe(200);
    rowError=true;
    expect((await GET(new Request('http://fixture.test/api'),context)).status).toBe(500);rowError=false;
  });
  test('a missing service-role key returns the fixed private read failure',async()=>{
    serviceRoleKeyMissing=true;
    try{
      const response=await GET(new Request('http://fixture.test/api'),context);
      expect(response.status).toBe(500);expect(response.headers.get('Cache-Control')).toBe('private, no-store');
      expect(await response.json()).toEqual({error:'EVALUATION_READ_FAILED'});
    }finally{serviceRoleKeyMissing=false;}
  });
});

describe('first-page revision races',()=>{
  const page={revision:'2',records:[],warnings:{},stats:{total:0,pending:0,approved:0,hold:0,db_conflict:0,missing:0,not_selected:0,deleted:0},filteredTotal:0,nextCursor:null};
  test('retries a first-page race once without reusing an old cursor',async()=>{
    let calls=0;
    globalThis.fetch=mock(async()=>++calls===1?new Response(null,{status:409}):Response.json(page)) as typeof fetch;
    expect((await fetchAdminEvaluationPage('')).revision).toBe('2');expect(calls).toBe(2);
    globalThis.fetch=originalFetch;
  });
  test('later cursors are stale immediately and repeated first-page races are bounded',async()=>{
    let calls=0;
    globalThis.fetch=mock(async()=>{calls++;return new Response(null,{status:409});}) as typeof fetch;
    await expect(fetchAdminEvaluationPage('','old')).rejects.toHaveProperty('name','EVALUATION_CURSOR_STALE');
    expect(calls).toBe(1);
    calls=0;await expect(fetchAdminEvaluationPage('')).rejects.toHaveProperty('name','EVALUATION_CURSOR_STALE');
    expect(calls).toBe(2);globalThis.fetch=originalFetch;
  });
});
