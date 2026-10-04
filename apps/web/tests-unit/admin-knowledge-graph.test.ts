import { describe, expect, test } from 'bun:test';
import snapshot from '../data/knowledge-graph/tzudong.json';
import { isKnowledgeGraphPage, isKnowledgeSnapshot, isKnowledgeNode, type KnowledgeSnapshot } from '../types/knowledge-graph';
import { queryKnowledgeGraph } from '../lib/admin/knowledge-graph-query';

const fixture: KnowledgeSnapshot = {
  schemaVersion: 1, scope: 'tzudong', revision: 'a'.repeat(64), generatedAt: '2026-10-04T00:00:00Z',
  coverage: { inventoryCount: 250, eligibleCount: 240, analyzedCount: 0, pendingCount: 240, failedCount: 0, excludedShortsCount: 10, asOf: '2026-10-04T00:00:00Z' },
  nodes: Array.from({ length: 240 }, (_, index) => ({ id: `node-${index}`, label: index === 239 ? '서울 맛집 Ａ' : `영상 ${index}`, kind: index === 239 ? 'restaurant' : 'video', summary: '공개 영상 근거', evidence: [] })),
  edges: [{ id: 'edge-1', source: 'node-0', target: 'node-239', relation: 'references' }],
};

describe('bounded Tzudong knowledge graph reads', () => {
  test('accepts the actual scope-only OSK export without treating its hub as analyzed video', () => {
    expect(isKnowledgeSnapshot(snapshot)).toBe(true);
    expect(snapshot.coverage.analyzedCount).toBe(0);
    expect(isKnowledgeGraphPage(queryKnowledgeGraph(snapshot as KnowledgeSnapshot, new URLSearchParams()))).toBe(true);
  });
  test('pages all nodes without loss or duplicates while preserving whole graph counts', () => {
    let cursor: string | null = null; const ids: string[] = [];
    do {
      const params = new URLSearchParams({ limit: '50' }); if (cursor) params.set('cursor', cursor);
      const page = queryKnowledgeGraph(fixture, params); expect(isKnowledgeGraphPage(page)).toBe(true);
      expect(page.totalNodes).toBe(240); expect(page.totalEdges).toBe(1); expect(page.filteredTotal).toBe(240);
      ids.push(...page.nodes.map(node => node.id)); cursor = page.nextCursor;
    } while (cursor);
    expect(new Set(ids).size).toBe(240); expect(ids).toEqual(fixture.nodes.map(node => node.id));
  });
  test('searches outside the first page and returns typed detail for the selected node', () => {
    const page = queryKnowledgeGraph(fixture, new URLSearchParams({ q: '서울 맛집 a', node: 'node-239', kind: 'restaurant' }));
    expect(page.nodes.map(node => node.id)).toEqual(['node-239']); expect(page.selected?.id).toBe('node-239');
    expect(page.omittedEdges).toBe(1); expect(page.coverage.pendingCount).toBe(240);
  });
  test('rejects stale and cross-query cursors and bounded malformed queries', () => {
    const page = queryKnowledgeGraph(fixture, new URLSearchParams());
    expect(() => queryKnowledgeGraph({ ...fixture, revision: 'b'.repeat(64) }, new URLSearchParams({ cursor: page.nextCursor! }))).toThrow('knowledge_cursor_stale');
    expect(() => queryKnowledgeGraph(fixture, new URLSearchParams({ q: 'changed', cursor: page.nextCursor! }))).toThrow('knowledge_query_invalid');
    for (const query of ['limit=201', 'limit=0', 'limit=1e2', 'kind=other', 'url=http://localhost', 'cursor=%3Cscript%3E', `q=${'a'.repeat(257)}`])
      expect(() => queryKnowledgeGraph(fixture, new URLSearchParams(query))).toThrow('knowledge_query_invalid');
  });
  test('refuses foreign scope, dangling edges, duplicate ids and invented coverage', () => {
    for (const value of [ { ...fixture, scope: 'other' }, { ...fixture, nodes: [...fixture.nodes, fixture.nodes[0]] },
      { ...fixture, edges: [{ ...fixture.edges[0], target: 'foreign-node' }] },
      { ...fixture, coverage: { ...fixture.coverage, analyzedCount: 241 } } ]) expect(isKnowledgeSnapshot(value)).toBe(false);
  });
  test('limits outbound evidence to the exact typed public video and timestamp', () => {
    const node = { ...fixture.nodes[0], evidence: [{ videoId: 'ABCDEFGHIJK', startSeconds: 12.5, endSeconds: 15, url: 'https://www.youtube.com/watch?v=ABCDEFGHIJK&t=12s', status: 'unverified' }] };
    expect(isKnowledgeNode(node)).toBe(true);
    for (const url of ['https://www.youtube.com.evil.test/watch?v=ABCDEFGHIJK&t=12s', 'javascript:alert(1)', 'https://www.youtube.com/watch?v=other&t=12s', 'https://www.youtube.com/watch?v=ABCDEFGHIJK&t=999s'])
      expect(isKnowledgeNode({ ...node, evidence: [{ ...node.evidence[0], url }] })).toBe(false);
  });
});
