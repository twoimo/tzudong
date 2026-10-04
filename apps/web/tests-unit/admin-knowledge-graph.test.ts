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
    const node = { ...fixture.nodes[0], evidence: [{ videoId: 'ABCDEFGHIJK', startSeconds: 12.5, endSeconds: 15, url: 'https://www.youtube.com/watch?v=ABCDEFGHIJK&t=12.5s', status: 'unverified' }] };
    expect(isKnowledgeNode(node)).toBe(true);
    for (const url of ['https://www.youtube.com.evil.test/watch?v=ABCDEFGHIJK&t=12.5s', 'javascript:alert(1)', 'https://www.youtube.com/watch?v=other&t=12.5s', 'https://www.youtube.com/watch?v=ABCDEFGHIJK&t=999s',
      'https://www.youtube.com/watch?v=ABCDEFGHIJK&t=12s', 'https://www.youtube.com/watch?v=ABCDEFGHIJK&t=12.50s',
      'https://www.youtube.com/watch?v=ABCDEFGHIJK&t=12.5s&feature=share', 'https://www.youtube.com/watch?v=ABCDEFGHIJK&t=12.5s#extra'])
      expect(isKnowledgeNode({ ...node, evidence: [{ ...node.evidence[0], url }] })).toBe(false);
  });
  test('admits backend canonical zero, fractional, rounded and exponent timestamps throughout the read contract', () => {
    // Produced by osk_projection._evidence's Python :g formatter, including exact half-even ties.
    const cases: Array<[number, string]> = [[0, ''], [-0, ''], [12, '12'], [12.5, '12.5'], [12.345678, '12.3457'],
      [100000.5, '100000'], [100001.5, '100002'], [999999.5, '1e+06'], [1e9, '1e+09'],
      [0.0001, '0.0001'], [0.00001, '1e-05'], [0.00009999999, '0.0001'], [0.001953125, '0.00195312'], [Number.MIN_VALUE, '4.94066e-324']];
    for (const [startSeconds, timestamp] of cases) {
      const evidence = { videoId: 'ABCDEFGHIJK', startSeconds, endSeconds: null, status: 'unverified' as const,
        url: `https://www.youtube.com/watch?v=ABCDEFGHIJK${timestamp ? `&t=${timestamp}s` : ''}` };
      const source: KnowledgeSnapshot = { ...fixture, nodes: [{ ...fixture.nodes[0], evidence: [evidence] }], edges: [] };
      expect(isKnowledgeSnapshot(source)).toBe(true);
      expect(isKnowledgeGraphPage(queryKnowledgeGraph(source, new URLSearchParams()))).toBe(true);
    }
    const zero = { ...fixture.nodes[0], evidence: [{ videoId: 'ABCDEFGHIJK', startSeconds: 0, endSeconds: null, status: 'unverified', url: 'https://www.youtube.com/watch?v=ABCDEFGHIJK&t=0s' }] };
    expect(isKnowledgeNode(zero)).toBe(false);
    for (const startSeconds of [-1, Infinity, NaN, 1_000_000_001]) expect(isKnowledgeNode({ ...zero, evidence: [{ ...zero.evidence[0], startSeconds }] })).toBe(false);
  });
});
