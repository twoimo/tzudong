import { afterAll, beforeEach, describe, expect, mock, test } from 'bun:test';
import { NextRequest } from 'next/server';
import { embedStoryboardRagTexts, rerankStoryboardRagCandidates, STORYBOARD_RAG_EMBEDDING_FINGERPRINT as fingerprint } from '../lib/admin/storyboard/rag-worker-client';

const originalFetch = globalThis.fetch;
const originalUrl = process.env.STORYBOARD_RAG_WORKER_URL;
const requests: { path: string; body: any }[] = [];
const inserts: any[] = [];
const rpcArgs: any[] = [];
const filters: string[] = [];
const originalLegacy = { id: 'legacy-id', title: '국수', content: '보존된 편집 결과 국수', metadata: { edited: true } };
let badFingerprint = false;
let failEmbed = false;
let failLegacy = false;
mock.module('@/lib/admin/storyboard/rag-actions-auth', () => ({ authenticateStoryboardRagAction: async () => ({ ok: true, userId: 'owner' }) }));
mock.module('@/lib/security/same-origin-mutation', () => ({ isTrustedSameOriginMutation: () => true }));
mock.module('@/lib/supabase/service-role', () => ({ createSupabaseServiceRoleClient: () => ({
  rpc: async (_name: string, args: any) => { rpcArgs.push(args); return { data: [], error: null }; },
  from: () => ({
    upsert: (rows: any[]) => { inserts.push(...rows); return { select: async () => ({ data: [{ id: 'new-id' }], error: null }) }; },
    select: (columns: string) => { expect(columns).not.toContain('embedding');
      const chain: any = { eq: (_key: string, owner: string) => { expect(owner).toBe('owner'); return chain; },
        contains: () => chain, not: (_key: string, _op: string, value: string) => { filters.push(value); return chain; },
        or: (filter: string) => { filters.push(filter); return chain; }, order: () => chain,
        limit: async (count: number) => { expect(count).toBe(200); return { data: [structuredClone(originalLegacy)], error: failLegacy ? { message: 'private diagnostic' } : null }; },
      }; return chain;
    },
  }),
}) }));
const documents = await import('../app/api/admin/storyboard/rag/documents/route');
const search = await import('../app/api/admin/storyboard/rag/search/route');
function request(body: unknown) { return new NextRequest('http://localhost/api/admin/storyboard/rag', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); }
beforeEach(() => {
  requests.length = inserts.length = rpcArgs.length = filters.length = 0;
  badFingerprint = failEmbed = failLegacy = false;
  process.env.STORYBOARD_RAG_WORKER_URL = 'http://127.0.0.1:1234';
  globalThis.fetch = mock(async (url: any, options: any) => {
    const path = new URL(String(url)).pathname; const body = JSON.parse(options.body); requests.push({ path, body });
    if (failEmbed && path === '/embed') return new Response('private diagnostic', { status: 503 });
    return Response.json(path === '/embed' ? { schemaVersion: 1, provider: 'gemini-api', model: 'gemini-embedding-001', dimensions: 1024,
      fingerprint: badFingerprint ? 'BAAI/bge-m3' : fingerprint, items: body.texts.map(() => ({ dense: [1, ...Array(1023).fill(0)], sparse: {} })) }
      : { schemaVersion: 1, provider: 'gemini-api', model: 'gemini-embedding-001', fingerprint, method: 'embedding_cosine',
          results: body.candidates.slice(0, body.topK).map((item: any) => ({ ...item, rerankScore: 1 })) });
  }) as any;
});
afterAll(() => { mock.restore(); globalThis.fetch = originalFetch; if (originalUrl === undefined) delete process.env.STORYBOARD_RAG_WORKER_URL; else process.env.STORYBOARD_RAG_WORKER_URL = originalUrl; });

describe('Gemini RAG isolation and existing data preservation without paid calls', () => {
  test('rejects old fingerprints even at matching dimensions without a second call', async () => {
    badFingerprint = true;
    await expect(embedStoryboardRagTexts(['국수'])).rejects.toThrow('embed_contract_invalid');
    expect(requests).toHaveLength(1);
  });
  test('new versioned writes preserve the old external identity and metadata', async () => {
    const body = { documents: [{ externalId: 'existing-id', title: '국수', content: '새 문서', metadata: { edited: true, storyboardEmbeddingFingerprint: 'forged' } }] };
    const response = await documents.POST(request(body));
    expect(response.status).toBe(200);
    expect(inserts[0].external_id).not.toBe('existing-id');
    expect(inserts[0].external_id).toStartWith('gemini-rag:');
    expect(inserts[0].metadata).toMatchObject({ edited: true, storyboardOriginalExternalId: 'existing-id', storyboardEmbeddingFingerprint: fingerprint });
    expect(requests[0].body.task).toBe('RETRIEVAL_DOCUMENT');
    const id = inserts[0].external_id;
    await documents.POST(request(body));
    expect(inserts[1].external_id).toBe(id);
    expect(originalLegacy.metadata.edited).toBe(true);
  });
  test('query vector search is isolated; legacy text is still returned and is never vector-selected', async () => {
    const response = await search.POST(request({ query: '국수', metadataFilter: { storyboardEmbeddingFingerprint: 'forged' } }));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(rpcArgs[0].p_metadata_filter.storyboardEmbeddingFingerprint).toBe(fingerprint);
    expect(rpcArgs[0].p_dense_weight).toBe(1);
    expect(requests[0].body.task).toBe('RETRIEVAL_QUERY');
    expect(requests[1].body.candidates[0].denseScore).toBe(null);
    expect(requests).toHaveLength(2);
    expect(requests[1].body.queryEmbedding).toEqual({ dense: [1, ...Array(1023).fill(0)], fingerprint });
    expect(body.results[0].id).toBe('legacy-id');
    expect(body.results[0].metadata.edited).toBe(true);
    expect(body.retrieval.legacyMode).toBe('content-only');
  });
  test('provider failure has no write or hidden retry and does not return raw diagnostic', async () => {
    failEmbed = true;
    const response = await documents.POST(request({ documents: [{ externalId: 'existing', title: '국수', content: '보존' }] }));
    expect(response.status).toBe(503);
    expect(inserts).toHaveLength(0);
    expect(requests).toHaveLength(1);
    expect(await response.text()).not.toContain('private diagnostic');
  });
  test('legacy read failure does not silently discard existing documents or rerank', async () => {
    failLegacy = true;
    const response = await search.POST(request({ query: '국수' }));
    expect(response.status).toBe(503);
    expect(requests).toHaveLength(1);
    expect(await response.text()).not.toContain('private diagnostic');
  });
  test('user-supplied query vectors cannot replace the server embedding', async () => {
    const response = await search.POST(request({ query: '국수', queryEmbedding: { dense: [1], fingerprint } }));
    expect(response.status).toBe(400);
    expect(requests).toHaveLength(0);
    expect(rpcArgs).toHaveLength(0);
  });
  test('invalid reused vectors and mismatched spaces fail before worker transport', async () => {
    for (const vector of [Array(1024).fill(0), Array(1024).fill(NaN), [1], [2, ...Array(1023).fill(0)]]) {
      await expect(rerankStoryboardRagCandidates({ query: '국수', candidates: [{ id: 'real', content: '원본' }], topK: 1,
        queryEmbedding: { dense: vector, fingerprint } })).rejects.toThrow();
    }
    await expect(rerankStoryboardRagCandidates({ query: '국수', candidates: [{ id: 'real', content: '원본' }], topK: 1,
      queryEmbedding: { dense: [1, ...Array(1023).fill(0)], fingerprint: 'other-model' } })).rejects.toThrow();
    expect(requests).toHaveLength(0);
  });
  test('rejects forged candidate IDs rather than accepting provider-supplied content', async () => {
    globalThis.fetch = mock(async () => Response.json({ schemaVersion: 1, provider: 'gemini-api', model: 'gemini-embedding-001', fingerprint,
      method: 'embedding_cosine', results: [{ id: 'forged', content: 'forged', rerankScore: 1 }] })) as any;
    await expect(rerankStoryboardRagCandidates({ query: '국수', candidates: [{ id: 'real', content: '원본' }], topK: 1 })).rejects.toThrow('rerank_results_invalid');
  });
});
