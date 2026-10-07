import { afterAll, beforeAll, beforeEach, describe, expect, mock, test } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

let authStatus = 200, reads = 0;
let exportRoot: string | undefined, fixtureRoot: string;
const actual = await import('../lib/admin/knowledge-graph-local');
const readLocal = actual.readLocalKnowledgeGraph;
mock.module('@/lib/admin/knowledge-graph-local', () => ({ ...actual, readLocalKnowledgeGraph: async (params: URLSearchParams, directory?: string) => {
  reads++; return readLocal(params, directory ?? exportRoot);
} }));
beforeAll(() => {
  fixtureRoot = mkdtempSync(join(tmpdir(), 'tzudong-graph-api-'));
  execFileSync('python3', ['-B', '-c', `
import sys
from pathlib import Path
from backend.knowledge_graph.graph_shards import build_graph_shards, write_graph_shards
from backend.knowledge_graph.tests.test_graph_shards import synthetic_graph
write_graph_shards(build_graph_shards(synthetic_graph(250, 1000)), Path(sys.argv[1]) / 'tzudong.json')
`, fixtureRoot], { cwd: resolve(process.cwd(), '../..'), stdio: 'pipe', timeout: 30000 });
});
afterAll(() => { if (fixtureRoot) rmSync(fixtureRoot, { recursive: true, force: true }); });
mock.module('@/lib/auth/require-admin', () => ({ requireAdmin: async () => authStatus === 200 ? { ok: true } : { ok: false, response: Response.json({ error: 'Unauthorized' }, { status: authStatus }) } }));
const { GET } = await import('../app/api/admin/knowledge-graph/route');
beforeEach(() => { authStatus = 200; reads = 0; exportRoot = undefined; });

describe('knowledge graph admin boundary', () => {
  test('denies both browser roles and keeps the valid admin feed private', async () => {
    for (const status of [401, 403]) { authStatus = status; expect((await GET(new Request('https://tzudong.app/api/admin/knowledge-graph'))).status).toBe(status); }
    expect(reads).toBe(0);
    authStatus = 200; const response = await GET(new Request('https://tzudong.app/api/admin/knowledge-graph'));
    expect(response.status).toBe(200); expect(response.headers.get('cache-control')).toBe('private, no-store');
    const body = await response.json(); expect(body.coverage.analyzedCount).toBe(0); expect(body.nodes.length).toBeGreaterThan(0); expect(body.nodes.length).toBeLessThanOrEqual(100);
  });
  test('serves the actual sharded files and returns private 409/503 responses without exposing diagnostics', async () => {
    exportRoot = fixtureRoot;
    const first = await GET(new Request('https://tzudong.app/api/admin/knowledge-graph?limit=2'));
    expect(first.status).toBe(200); expect(first.headers.get('cache-control')).toBe('private, no-store');
    const page = await first.json(); expect(page.totalNodes).toBe(250); expect(page.totalEdges).toBe(1000);
    const path = join(fixtureRoot, 'tzudong.json'), manifest = JSON.parse(readFileSync(path, 'utf8'));
    writeFileSync(path, JSON.stringify({ ...manifest, revision: 'b'.repeat(64) }));
    const stale = await GET(new Request(`https://tzudong.app/api/admin/knowledge-graph?limit=2&cursor=${page.nextCursor}`));
    expect(stale.status).toBe(409); expect(await stale.json()).toEqual({ error: 'knowledge_cursor_stale' });
    expect(stale.headers.get('cache-control')).toBe('private, no-store');
    const broken = await GET(new Request('https://tzudong.app/api/admin/knowledge-graph'));
    expect(broken.status).toBe(503); expect(await broken.json()).toEqual({ error: 'knowledge_unavailable' });
    expect(broken.headers.get('cache-control')).toBe('private, no-store');
  });
  test('returns fixed bounded errors for malformed public input', async () => {
    const response = await GET(new Request('https://tzudong.app/api/admin/knowledge-graph?limit=999&url=http://localhost'));
    expect(response.status).toBe(400); expect(await response.json()).toEqual({ error: 'knowledge_query_invalid' });
  });
});
