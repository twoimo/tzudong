import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { copyFileSync, cpSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { localKnowledgeGraphReader, readLocalKnowledgeGraph } from '../lib/admin/knowledge-graph-local';
import legacy from './fixtures/knowledge-graph-v1-20261004.json';
import { queryKnowledgeGraph } from '../lib/admin/knowledge-graph-query';
import {
  isKnowledgeShardManifest, KNOWLEDGE_PAGE_MAX_BYTES, KNOWLEDGE_SHARD_MAX_BYTES,
  queryKnowledgeGraphExport, queryShardedKnowledgeGraph,
  type KnowledgeShardManifest, type KnowledgeShardReader,
} from '../lib/admin/knowledge-graph-shards';
import { isKnowledgeGraphPage, type KnowledgeSnapshot } from '../types/knowledge-graph';

let directory: string;
const fixtures: Record<string, { manifest: KnowledgeShardManifest; files: Map<string, Uint8Array> }> = {};
beforeAll(() => {
  directory = mkdtempSync(join(tmpdir(), 'tzudong-graph-shards-'));
  // Uses only the new pure exporter and synthetic data: no OSK vault, model,
  // video download, publication or provider. Also proves Python/TS wire parity.
  execFileSync('python3', ['-B', '-c', `
from pathlib import Path
from unittest.mock import patch
import sys
from backend.knowledge_graph import graph_shards as shard_module
from backend.knowledge_graph.graph_shards import build_graph_shards, write_graph_shards
from backend.knowledge_graph.tests.test_graph_shards import synthetic_graph
root = Path(sys.argv[1])
large = synthetic_graph()
large['nodes'][0]['label'] = 'cross shard pair'
large['nodes'][len(large['nodes']) // 2]['label'] = 'cross shard pair'
large['nodes'][-1]['label'] = '서울 마지막 Ａ'
large['nodes'][1]['label'] = '😀' * 512
dense = synthetic_graph(40, 780)
for i, edge in enumerate(dense['edges']):
 edge['target'] = dense['nodes'][(i + 1) % 40]['id']
wide = synthetic_graph(200, 0)
for node in wide['nodes']:
 node['summary'] = '가' * 4000
 node['label'] = '합' * 512
for name, graph in [('large', large), ('dense', dense), ('wide', wide)]:
 path = root / name
 path.mkdir()
 write_graph_shards(build_graph_shards(graph), path / 'tzudong.json')
path = root / 'tree'
path.mkdir()
with patch.object(shard_module, 'MAX_MANIFEST_CHILDREN', 2), patch.object(shard_module.projection, 'MAX_NODES', 1), patch.object(shard_module.projection, 'MAX_EDGES', 1):
 write_graph_shards(build_graph_shards(synthetic_graph(17, 31)), path / 'tzudong.json')
`, directory], { cwd: resolve(process.cwd(), '../..'), timeout: 30000, stdio: 'pipe' });
  for (const name of ['large', 'dense', 'wide', 'tree']) {
    const folder = join(directory, name);
    const manifest = JSON.parse(readFileSync(join(folder, 'tzudong.json'), 'utf8')) as KnowledgeShardManifest;
    const files = new Map(readdirSync(join(folder, 'shards')).map(name => [`shards/${name}`, new Uint8Array(readFileSync(join(folder, 'shards', name)))]));
    fixtures[name] = { manifest, files };
  }
});
afterAll(() => { if (directory) rmSync(directory, { recursive: true, force: true }); });

const fixture = (name: string) => fixtures[name]!;
const reader = (files: Map<string, Uint8Array>): KnowledgeShardReader => async (path, maximum) => {
  expect(maximum).toBe(KNOWLEDGE_SHARD_MAX_BYTES);
  const data = files.get(path);
  if (!data) throw new Error('synthetic missing shard with private path');
  return data;
};
function changedPart(kind: 'nodeShards' | 'edgeShards', mutate: (part: Record<string, unknown>) => void) {
  const input = fixture('large'), manifest = structuredClone(input.manifest), files = new Map(input.files);
  const descriptor = manifest[kind][0]!;
  const part = JSON.parse(new TextDecoder().decode(files.get(descriptor.path))) as Record<string, unknown>;
  mutate(part);
  const data = new TextEncoder().encode(JSON.stringify(part) + '\n');
  descriptor.sha256 = createHash('sha256').update(data).digest('hex');
  descriptor.path = `shards/${kind === 'nodeShards' ? 'nodes' : 'edges'}-${descriptor.sha256}.json`;
  descriptor.bytes = data.byteLength;
  files.set(descriptor.path, data);
  return { manifest, files };
}

describe('lossless sharded knowledge graph reads', () => {
  test('v1 export and existing query output remain compatible', async () => {
    const params = new URLSearchParams({ limit: '10' });
    expect(await queryKnowledgeGraphExport(legacy, params)).toEqual(queryKnowledgeGraph(legacy as KnowledgeSnapshot, params));
  });

  test('walks every Python hierarchy level with exact counts, ranges and local-file readback', async () => {
    const { manifest, files } = fixture('tree');
    expect(manifest.schemaVersion).toBe(3);
    expect(manifest.nodeShards[0]!.level).toBeGreaterThan(1);
    const page = await queryShardedKnowledgeGraph(manifest, new URLSearchParams(), reader(files));
    expect(page.totalNodes).toBe(17);
    expect(page.totalEdges).toBe(31);
    expect(page.nodes).toHaveLength(17);
    expect(page.edges).toHaveLength(31);
    expect(await readLocalKnowledgeGraph(new URLSearchParams(), join(directory, 'tree'))).toEqual(page);
    const last = await queryShardedKnowledgeGraph(manifest, new URLSearchParams({ node: 'n-000016' }), reader(files));
    expect(last.selected?.id).toBe('n-000016');
  });

  test('rejects corrupt, missing, cyclic, miscounted and foreign hierarchical indexes', async () => {
    const input = fixture('tree');
    const missing = new Map(input.files);
    missing.delete(input.manifest.nodeShards[0]!.path);
    await expect(queryShardedKnowledgeGraph(input.manifest, new URLSearchParams(), reader(missing))).rejects.toThrow('knowledge_unavailable');
    for (const mutate of [
      (part: Record<string, unknown>) => { part.scope = 'foreign'; },
      (part: Record<string, unknown>) => { part.level = 0; },
      (part: Record<string, unknown>) => { (part.items as Array<Record<string, unknown>>)[0]!.count = 999999; },
      (part: Record<string, unknown>) => { (part.items as Array<Record<string, unknown>>)[0]!.path = '../private.json'; },
      (part: Record<string, unknown>) => { const items = part.items as Array<Record<string, unknown>>; items[1] = items[0]!; },
    ]) {
      const manifest = structuredClone(input.manifest), files = new Map(input.files), entry = manifest.nodeShards[0]!;
      const index = JSON.parse(new TextDecoder().decode(files.get(entry.path))) as Record<string, unknown>;
      mutate(index);
      const data = new TextEncoder().encode(JSON.stringify(index) + '\n');
      entry.sha256 = createHash('sha256').update(data).digest('hex');
      entry.path = `shards/nodes-index-${entry.sha256}.json`;
      entry.bytes = data.byteLength;
      files.set(entry.path, data);
      await expect(queryShardedKnowledgeGraph(manifest, new URLSearchParams(), reader(files))).rejects.toThrow('knowledge_unavailable');
    }
  });

  test('hierarchical totals and page DTOs retain safe exact counts above one million', () => {
    const manifest = structuredClone(fixture('tree').manifest);
    manifest.nodeShards[0]!.count += 2_000_000;
    manifest.totalNodes += 2_000_000;
    expect(isKnowledgeShardManifest(manifest)).toBe(true);
    // Admission of a manifest is separate from verifying every descendant.
    manifest.totalNodes = Number.MAX_SAFE_INTEGER + 1;
    expect(isKnowledgeShardManifest(manifest)).toBe(false);
  });

  test('reads the full large Python export without loss, duplicate nodes or invented coverage', async () => {
    const { manifest, files } = fixture('large');
    expect(isKnowledgeShardManifest(manifest)).toBe(true);
    expect(manifest.totalNodes).toBe(12829);
    expect(manifest.totalEdges).toBe(25656);
    expect([...files.values()].reduce((sum, file) => sum + file.byteLength, 0)).toBeGreaterThan(KNOWLEDGE_SHARD_MAX_BYTES);
    let cursor: string | null = null;
    const ids: string[] = [];
    do {
      const params = new URLSearchParams({ limit: '200' });
      if (cursor) params.set('cursor', cursor);
      const page = await queryShardedKnowledgeGraph(manifest, params, reader(files));
      expect(isKnowledgeGraphPage(page)).toBe(true);
      expect(page.totalNodes).toBe(12829);
      expect(page.totalEdges).toBe(25656);
      expect(page.filteredTotal).toBe(12829);
      expect(page.coverage).toEqual(manifest.coverage);
      expect(page.coverage.analyzedCount).toBe(0);
      expect(Buffer.byteLength(JSON.stringify(page))).toBeLessThanOrEqual(KNOWLEDGE_PAGE_MAX_BYTES);
      ids.push(...page.nodes.map(node => node.id));
      cursor = page.nextCursor;
    } while (cursor);
    expect(ids).toEqual(Array.from({ length: 12829 }, (_, i) => `n-${String(i).padStart(6, '0')}`));
    expect(new Set(ids).size).toBe(12829);
  }, 30000);

  test('preserves Python Unicode scalar label bounds across the wire', async () => {
    const { manifest, files } = fixture('large');
    const page = await queryShardedKnowledgeGraph(manifest, new URLSearchParams({ node: 'n-000001' }), reader(files));
    expect(page.selected?.label).toBe('😀'.repeat(512));
    expect(isKnowledgeGraphPage(page)).toBe(true);
  });

  test('search and selected detail reach the last shard; cross-shard edges remain available', async () => {
    const { manifest, files } = fixture('large');
    const last = await queryShardedKnowledgeGraph(manifest, new URLSearchParams({ q: '서울 마지막 a', node: 'n-012828' }), reader(files));
    expect(last.nodes.map(node => node.id)).toEqual(['n-012828']);
    expect(last.selected?.id).toBe('n-012828');
    const pair = await queryShardedKnowledgeGraph(manifest, new URLSearchParams({ q: 'cross shard pair' }), reader(files));
    expect(pair.nodes.map(node => node.id)).toEqual(['n-000000', 'n-006414']);
    expect(pair.edges.some(edge => edge.source === 'n-000000' && edge.target === 'n-006414')).toBe(true);
    expect(pair.edges.length + pair.omittedEdges).toBe(manifest.totalEdges);
  });

  test('edge pagination explicitly traverses all induced edges while preserving graph totals', async () => {
    const { manifest, files } = fixture('dense');
    let edgeCursor: string | null = null;
    const ids: string[] = [];
    do {
      const params = new URLSearchParams({ edgeLimit: '17' });
      if (edgeCursor) params.set('edgeCursor', edgeCursor);
      const page = await queryShardedKnowledgeGraph(manifest, params, reader(files));
      expect(page.edgePageTotal).toBe(780);
      expect(page.totalEdges).toBe(780);
      expect(page.omittedEdges + page.edges.length).toBe(780);
      expect(page.edges.length).toBeLessThanOrEqual(17);
      ids.push(...page.edges.map(edge => edge.id));
      edgeCursor = page.nextEdgeCursor;
    } while (edgeCursor);
    expect(ids).toEqual(Array.from({ length: 780 }, (_, i) => `e-${String(i).padStart(6, '0')}`));
  });

  test('byte-bound node pages expose a next cursor instead of truncating large evidence/summary rows', async () => {
    const { manifest, files } = fixture('wide');
    const first = await queryShardedKnowledgeGraph(manifest, new URLSearchParams({ limit: '200' }), reader(files));
    expect(first.nodes.length).toBeGreaterThan(0);
    expect(first.nodes.length).toBeLessThan(200);
    expect(first.nextCursor).not.toBeNull();
    expect(Buffer.byteLength(JSON.stringify(first))).toBeLessThanOrEqual(KNOWLEDGE_PAGE_MAX_BYTES);
    const next = await queryShardedKnowledgeGraph(manifest, new URLSearchParams({ limit: '200', cursor: first.nextCursor! }), reader(files));
    expect(new Set([...first.nodes, ...next.nodes].map(node => node.id)).size).toBe(200);
    expect(next.nextCursor).toBeNull();
  });

  test('rejects stale, cross-query, cross-node-page and malformed cursors before returning a partial graph', async () => {
    const { manifest, files } = fixture('dense');
    const first = await queryShardedKnowledgeGraph(manifest, new URLSearchParams({ limit: '20', edgeLimit: '1' }), reader(files));
    const params = new URLSearchParams({ limit: '20', edgeLimit: '1', cursor: first.nextCursor! });
    await expect(queryShardedKnowledgeGraph({ ...manifest, revision: 'b'.repeat(64) }, params, reader(files))).rejects.toThrow('knowledge_cursor_stale');
    params.set('q', 'changed');
    await expect(queryShardedKnowledgeGraph(manifest, params, reader(files))).rejects.toThrow('knowledge_query_invalid');
    params.delete('q');
    expect(first.nextEdgeCursor).not.toBeNull();
    params.set('edgeCursor', first.nextEdgeCursor!);
    await expect(queryShardedKnowledgeGraph(manifest, params, reader(files))).rejects.toThrow('knowledge_query_invalid');
    await expect(queryShardedKnowledgeGraph({ ...manifest, revision: 'b'.repeat(64) }, new URLSearchParams({ limit: '20', edgeLimit: '1', edgeCursor: first.nextEdgeCursor! }), reader(files))).rejects.toThrow('knowledge_cursor_stale');
    for (const query of ['cursor=bad', 'limit=201', 'edgeLimit=2001', 'scope=other', 'q=a&q=b'])
      await expect(queryShardedKnowledgeGraph(manifest, new URLSearchParams(query), reader(files))).rejects.toThrow('knowledge_query_invalid');
  });

  test('refuses foreign scope, wrong totals, arbitrary paths and missing/corrupt shards with fixed errors', async () => {
    const { manifest, files } = fixture('large');
    for (const altered of [{ ...manifest, scope: 'other' }, { ...manifest, totalNodes: manifest.totalNodes - 1 }, { ...manifest, nodeShards: [{ ...manifest.nodeShards[0], path: '../private.json' }, ...manifest.nodeShards.slice(1)] }])
      await expect(queryShardedKnowledgeGraph(altered, new URLSearchParams(), reader(files))).rejects.toThrow('knowledge_unavailable');
    const missing = new Map(files); missing.delete(manifest.nodeShards.at(-1)!.path);
    await expect(queryShardedKnowledgeGraph(manifest, new URLSearchParams({ limit: '1' }), reader(missing))).rejects.toThrow('knowledge_unavailable');
    const corrupt = new Map(files); corrupt.set(manifest.edgeShards.at(-1)!.path, new Uint8Array([0]));
    await expect(queryShardedKnowledgeGraph(manifest, new URLSearchParams(), reader(corrupt))).rejects.toThrow('knowledge_unavailable');
  });

  test('rejects hash-valid foreign scope, provenance extras and dangling cross-shard edges', async () => {
    for (const value of [
      changedPart('nodeShards', part => { part.scope = 'other'; }),
      changedPart('nodeShards', part => { (part.items as Record<string, unknown>[])[0]!.privateField = 'not public'; }),
      changedPart('edgeShards', part => { (part.items as Record<string, unknown>[])[0]!.target = 'foreign-node'; }),
    ]) await expect(queryShardedKnowledgeGraph(value.manifest, new URLSearchParams(), reader(value.files))).rejects.toThrow('knowledge_unavailable');
  });
});


describe('actual local graph file reader', () => {
  test('reads Python manifest/files through the route reader with global search, selected detail and edge cursors', async () => {
    const root = join(directory, 'large');
    const page = await readLocalKnowledgeGraph(new URLSearchParams({ q: '마지막 A', node: 'n-000000' }), root);
    expect(page.totalNodes).toBe(12829); expect(page.totalEdges).toBe(25656);
    expect(page.nodes.map(node => node.id)).toEqual(['n-012828']);
    expect(page.selected?.id).toBe('n-000000'); expect(page.coverage.analyzedCount).toBe(0);
    const dense = join(directory, 'dense'), first = await readLocalKnowledgeGraph(new URLSearchParams(), dense);
    expect(first.nextEdgeCursor).toBeTruthy(); expect(first.edges.length).toBe(500);
    const next = await readLocalKnowledgeGraph(new URLSearchParams({ edgeCursor: first.nextEdgeCursor! }), dense);
    expect(next.edges.length).toBe(280); expect(next.nextEdgeCursor).toBeNull();
    expect(new Set([...first.edges, ...next.edges].map(edge => edge.id)).size).toBe(780);
  });

  test('reads a fresh manifest and rejects old cursors before accessing replaced shards', async () => {
    const root = join(directory, 'fresh'); cpSync(join(directory, 'large'), root, { recursive: true });
    const first = await readLocalKnowledgeGraph(new URLSearchParams({ limit: '2' }), root);
    const nextManifest = { ...fixture('large').manifest, revision: 'b'.repeat(64) };
    writeFileSync(join(root, 'tzudong.json'), JSON.stringify(nextManifest));
    rmSync(join(root, 'shards'), { recursive: true });
    await expect(readLocalKnowledgeGraph(new URLSearchParams({ limit: '2', cursor: first.nextCursor! }), root)).rejects.toThrow('knowledge_cursor_stale');
  });

  test('refuses missing, oversized, corrupted or symlinked files without leaking paths or partial rows', async () => {
    const root = join(directory, 'failure'); cpSync(join(directory, 'large'), root, { recursive: true });
    const part = fixture('large').manifest.nodeShards[1]!.path;
    writeFileSync(join(root, part), 'PRIVATE SYNTHETIC SENTINEL');
    await expect(readLocalKnowledgeGraph(new URLSearchParams({ limit: '1' }), root)).rejects.toThrow(/^knowledge_unavailable$/);
    rmSync(join(root, part));
    await expect(readLocalKnowledgeGraph(new URLSearchParams(), root)).rejects.toThrow(/^knowledge_unavailable$/);
    symlinkSync(join(directory, 'large', part), join(root, part));
    await expect(readLocalKnowledgeGraph(new URLSearchParams(), root)).rejects.toThrow(/^knowledge_unavailable$/);
    rmSync(join(root, 'shards'), { recursive: true });
    symlinkSync(join(directory, 'large', 'shards'), join(root, 'shards'));
    await expect(readLocalKnowledgeGraph(new URLSearchParams(), root)).rejects.toThrow(/^knowledge_unavailable$/);
    writeFileSync(join(root, 'tzudong.json'), Buffer.alloc(KNOWLEDGE_SHARD_MAX_BYTES + 1));
    await expect(readLocalKnowledgeGraph(new URLSearchParams(), root)).rejects.toThrow(/^knowledge_unavailable$/);
    const read = await localKnowledgeGraphReader(root);
    await expect(read('../private.json', KNOWLEDGE_SHARD_MAX_BYTES)).rejects.toThrow(/^knowledge_unavailable$/);
  });

  test('retains the single-file export route and validates optional edge pagination DTO as a pair', async () => {
    const root = join(directory, 'legacy'); cpSync(join(directory, 'wide'), root, { recursive: true });
    copyFileSync(resolve(process.cwd(), 'tests-unit/fixtures/knowledge-graph-v1-20261004.json'), join(root, 'tzudong.json'));
    expect(await readLocalKnowledgeGraph(new URLSearchParams(), root)).toEqual(queryKnowledgeGraph(legacy as KnowledgeSnapshot, new URLSearchParams()));
    const page = await readLocalKnowledgeGraph(new URLSearchParams(), join(directory, 'dense'));
    expect(isKnowledgeGraphPage(page)).toBe(true);
    expect(isKnowledgeGraphPage({ ...page, edgePageTotal: undefined })).toBe(false);
    expect(isKnowledgeGraphPage({ ...page, nextEdgeCursor: undefined })).toBe(false);
    expect(isKnowledgeGraphPage({ ...page, edgePageTotal: 1 })).toBe(false);
  });
});
