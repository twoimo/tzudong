import { createHash } from 'node:crypto';
import { KNOWLEDGE_KINDS, type KnowledgeGraphPage, type KnowledgeSnapshot } from '@/types/knowledge-graph';

export function queryKnowledgeGraph(snapshot: KnowledgeSnapshot, params: URLSearchParams): KnowledgeGraphPage {
  const q = params.get('q') ?? '', kind = params.get('kind') ?? '', selectedId = params.get('node');
  const limitText = params.get('limit') ?? '100', limit = Number(limitText), cursor = params.get('cursor');
  if ([...params.keys()].some(key => !['q', 'kind', 'node', 'limit', 'cursor'].includes(key))
    || q.length > 256 || (kind && !KNOWLEDGE_KINDS.includes(kind as typeof KNOWLEDGE_KINDS[number]))
    || !/^\d{1,3}$/.test(limitText) || !Number.isInteger(limit) || limit < 1 || limit > 200
    || (selectedId !== null && !/^[a-zA-Z0-9_.:-]{1,160}$/.test(selectedId))) throw new Error('knowledge_query_invalid');
  const key = createHash('sha256').update(JSON.stringify([q, kind, limit])).digest('hex');
  let offset = 0;
  if (cursor) {
    if (cursor.length > 4096 || !/^[a-zA-Z0-9_-]+$/.test(cursor)) throw new Error('knowledge_query_invalid');
    let value;
    try { value = JSON.parse(Buffer.from(cursor, 'base64url').toString()); } catch { throw new Error('knowledge_query_invalid'); }
    if (!value || value.query !== key || !Number.isSafeInteger(value.offset) || value.offset < 0) throw new Error('knowledge_query_invalid');
    if (value.revision !== snapshot.revision) throw new Error('knowledge_cursor_stale');
    if (value.offset > snapshot.nodes.length) throw new Error('knowledge_query_invalid');
    offset = value.offset;
  }
  const search = q.normalize('NFKC').toLowerCase().trim();
  const filtered = snapshot.nodes.filter(node => (!kind || node.kind === kind)
    && (!search || `${node.label} ${node.summary}`.normalize('NFKC').toLowerCase().includes(search)));
  const nodes = filtered.slice(offset, offset + limit), ids = new Set(nodes.map(node => node.id));
  const edges = snapshot.edges.filter(edge => ids.has(edge.source) && ids.has(edge.target));
  return { revision: snapshot.revision, generatedAt: snapshot.generatedAt, coverage: snapshot.coverage, nodes, edges,
    selected: selectedId ? snapshot.nodes.find(node => node.id === selectedId) ?? null : null,
    totalNodes: snapshot.nodes.length, totalEdges: snapshot.edges.length, filteredTotal: filtered.length, omittedEdges: snapshot.edges.length - edges.length,
    nextCursor: offset + nodes.length < filtered.length ? Buffer.from(JSON.stringify({ revision: snapshot.revision, query: key, offset: offset + limit })).toString('base64url') : null };
}
