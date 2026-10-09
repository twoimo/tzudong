import { createHash } from 'node:crypto';
import {
  KNOWLEDGE_KINDS, isKnowledgeNode, isKnowledgeSnapshot,
  type KnowledgeCoverage, type KnowledgeEdge, type KnowledgeGraphPage, type KnowledgeNode,
} from '@/types/knowledge-graph';
import { queryKnowledgeGraph } from './knowledge-graph-query';

export const KNOWLEDGE_SHARD_FORMAT = 'tzudong-graph-shards/v1';
export const KNOWLEDGE_TREE_FORMAT = 'tzudong-graph-tree/v1';
const MAX_INDEX_CHILDREN = 256, MAX_TREE_DEPTH = 8;
export const KNOWLEDGE_SHARD_MAX_BYTES = 4 * 1024 * 1024;
export const KNOWLEDGE_PAGE_MAX_BYTES = 2 * 1024 * 1024;
const MAX_TOTAL = Number.MAX_SAFE_INTEGER;
const SHA = /^[a-f0-9]{64}$/;
const ID = /^[a-zA-Z0-9_.:-]{1,160}$/;
const DIAGNOSTICS = ['excludedUnregisteredNodes', 'excludedExternalEdges', 'excludedUnresolvedEdges', 'excludedUnregisteredEdges', 'excludedUnsupportedEdges'];
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const keys = (value: Record<string, unknown>, allowed: string[]) => Object.keys(value).every(key => allowed.includes(key)) && allowed.every(key => key in value);
const count = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= MAX_TOTAL;
const hash = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex');
const bytes = (value: unknown) => Buffer.byteLength(JSON.stringify(value));
function unavailable(): never { throw new Error('knowledge_unavailable'); }
function invalid(): never { throw new Error('knowledge_query_invalid'); }

export type KnowledgeShardDescriptor = {
  path: string; sha256: string; bytes: number; count: number; firstId: string; lastId: string; level?: number;
};
export type KnowledgeShardManifest = {
  schemaVersion: 2 | 3; format: typeof KNOWLEDGE_SHARD_FORMAT | typeof KNOWLEDGE_TREE_FORMAT; scope: 'tzudong'; revision: string;
  generatedAt: string; coverage: KnowledgeCoverage; diagnostics: Record<string, number>;
  totalNodes: number; totalEdges: number; nodeShards: KnowledgeShardDescriptor[]; edgeShards: KnowledgeShardDescriptor[];
};
/** The caller supplies an authenticated local-file reader with the same byte ceiling. */
export type KnowledgeShardReader = (relativePath: string, maxBytes: number) => Promise<Uint8Array>;
export type ShardedKnowledgeGraphPage = KnowledgeGraphPage & {
  edgePageTotal: number; nextEdgeCursor: string | null;
};

export function isKnowledgeShardManifest(value: unknown): value is KnowledgeShardManifest {
  if (!object(value) || !keys(value, ['schemaVersion', 'format', 'scope', 'revision', 'generatedAt', 'coverage', 'diagnostics', 'totalNodes', 'totalEdges', 'nodeShards', 'edgeShards'])
    || !((value.schemaVersion === 2 && value.format === KNOWLEDGE_SHARD_FORMAT) || (value.schemaVersion === 3 && value.format === KNOWLEDGE_TREE_FORMAT)) || value.scope !== 'tzudong'
    || !count(value.totalNodes) || !count(value.totalEdges) || bytes(value) > KNOWLEDGE_SHARD_MAX_BYTES
    || !isKnowledgeSnapshot({ schemaVersion: 1, scope: value.scope, revision: value.revision, generatedAt: value.generatedAt, coverage: value.coverage, nodes: [], edges: [] })
    || !object(value.diagnostics) || Object.entries(value.diagnostics).some(([key, number]) => !DIAGNOSTICS.includes(key) || !count(number))) return false;
  if (value.schemaVersion === 2 && ((value.totalNodes as number) > 1_000_000 || (value.totalEdges as number) > 1_000_000)) return false;
  return descriptorsValid(value.nodeShards, 'nodes', value.totalNodes as number, value.schemaVersion === 3)
    && descriptorsValid(value.edgeShards, 'edges', value.totalEdges as number, value.schemaVersion === 3);
}

function descriptorsValid(value: unknown, kind: 'nodes' | 'edges', total: number, tree: boolean, expectedLevel?: number): value is KnowledgeShardDescriptor[] {
  if (!Array.isArray(value) || value.length > total || (tree && value.length > MAX_INDEX_CHILDREN)) return false;
  let lastId = '', sum = 0, level: number | undefined;
  for (const part of value) {
    if (!object(part) || !keys(part, ['path', 'sha256', 'bytes', 'count', 'firstId', 'lastId', ...(tree ? ['level'] : [])])) return false;
    const currentLevel = tree ? part.level : 0;
    if (!count(currentLevel) || currentLevel > MAX_TREE_DEPTH || (expectedLevel !== undefined && currentLevel !== expectedLevel)
      || (level !== undefined && currentLevel !== level)) return false;
    level = currentLevel;
    if (typeof part.sha256 !== 'string' || !SHA.test(part.sha256) || part.path !== `shards/${kind}${currentLevel ? '-index' : ''}-${part.sha256}.json`
      || typeof part.bytes !== 'number' || !Number.isSafeInteger(part.bytes) || part.bytes < 1 || part.bytes > KNOWLEDGE_SHARD_MAX_BYTES
      || !count(part.count) || part.count === 0 || (!currentLevel && part.count > (kind === 'nodes' ? 5000 : 20000))
      || typeof part.firstId !== 'string' || !ID.test(part.firstId) || typeof part.lastId !== 'string' || !ID.test(part.lastId)
      || part.firstId > part.lastId || part.firstId <= lastId) return false;
    lastId = part.lastId;
    sum += part.count;
    if (!Number.isSafeInteger(sum)) return false;
  }
  return sum === total;
}

async function* leafDescriptors(manifest: KnowledgeShardManifest, kind: 'nodes' | 'edges', reader: KnowledgeShardReader): AsyncGenerator<KnowledgeShardDescriptor> {
  const seen = new Set<string>();
  async function* visit(entries: KnowledgeShardDescriptor[]): AsyncGenerator<KnowledgeShardDescriptor> {
    for (const entry of entries) {
      if (seen.has(entry.path)) unavailable();
      seen.add(entry.path);
      if (!entry.level) { yield entry; continue; }
      const raw = await reader(entry.path, KNOWLEDGE_SHARD_MAX_BYTES);
      if (!(raw instanceof Uint8Array) || raw.byteLength !== entry.bytes || raw.byteLength > KNOWLEDGE_SHARD_MAX_BYTES || hash(raw) !== entry.sha256) unavailable();
      let part: unknown;
      try { part = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw)); } catch { unavailable(); }
      if (!object(part) || !keys(part, ['schemaVersion', 'scope', 'revision', 'kind', 'level', 'items'])
        || part.schemaVersion !== 1 || part.scope !== 'tzudong' || part.revision !== manifest.revision || part.kind !== `${kind}-index`
        || part.level !== entry.level || !descriptorsValid(part.items, kind, entry.count, true, entry.level - 1)
        || part.items[0]?.firstId !== entry.firstId || part.items.at(-1)?.lastId !== entry.lastId) unavailable();
      yield* visit(part.items);
    }
  }
  yield* visit(kind === 'nodes' ? manifest.nodeShards : manifest.edgeShards);
}

function isStrictNode(value: unknown): value is KnowledgeNode {
  return isKnowledgeNode(value) && value.evidence.length <= 16 && keys(value as unknown as Record<string, unknown>, ['id', 'label', 'kind', 'summary', 'evidence', ...(value.displayTitle === undefined ? [] : ['displayTitle', 'displayStage'])])
    && value.evidence.every(item => keys(item as unknown as Record<string, unknown>, ['videoId', 'startSeconds', 'endSeconds', 'url', 'status']));
}
function isStrictEdge(value: unknown): value is KnowledgeEdge {
  return object(value) && keys(value, ['id', 'source', 'target', 'relation'])
    && ['id', 'source', 'target'].every(key => typeof value[key] === 'string' && ID.test(value[key]))
    && (value.relation === 'references' || value.relation === 'derived-from');
}

async function readItems(manifest: KnowledgeShardManifest, descriptor: KnowledgeShardDescriptor, kind: 'nodes' | 'edges', reader: KnowledgeShardReader): Promise<unknown[]> {
  const raw = await reader(descriptor.path, KNOWLEDGE_SHARD_MAX_BYTES);
  if (!(raw instanceof Uint8Array) || raw.byteLength !== descriptor.bytes || raw.byteLength > KNOWLEDGE_SHARD_MAX_BYTES || hash(raw) !== descriptor.sha256) unavailable();
  let part: unknown;
  try { part = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw)); } catch { unavailable(); }
  if (!object(part) || !keys(part, ['schemaVersion', 'scope', 'revision', 'kind', 'items']) || part.schemaVersion !== 1
    || part.scope !== 'tzudong' || part.revision !== manifest.revision || part.kind !== kind
    || !Array.isArray(part.items) || part.items.length !== descriptor.count) unavailable();
  let previous = '';
  for (const item of part.items) {
    if (!(kind === 'nodes' ? isStrictNode(item) : isStrictEdge(item))) unavailable();
    const id = (item as KnowledgeNode | KnowledgeEdge).id;
    if (id <= previous) unavailable();
    previous = id;
  }
  if ((part.items[0] as KnowledgeNode | KnowledgeEdge).id !== descriptor.firstId || previous !== descriptor.lastId) unavailable();
  return part.items;
}

type Cursor = { revision: string; query: string; offset: number; kind: 'nodes' | 'edges'; page?: string };
function cursor(value: string | null, revision: string, query: string, kind: Cursor['kind'], maximum: number): Cursor | null {
  if (value === null) return null;
  if (!value || value.length > 4096 || !/^[a-zA-Z0-9_-]+$/.test(value)) invalid();
  let parsed: unknown;
  try {
    const decoded = Buffer.from(value, 'base64url');
    if (decoded.toString('base64url') !== value) invalid();
    parsed = JSON.parse(decoded.toString('utf8'));
  } catch { invalid(); }
  if (!object(parsed) || typeof parsed.revision !== 'string' || !SHA.test(parsed.revision)
    || typeof parsed.query !== 'string' || !SHA.test(parsed.query) || parsed.kind !== kind || !count(parsed.offset)
    || !keys(parsed, kind === 'edges' ? ['revision', 'query', 'offset', 'kind', 'page'] : ['revision', 'query', 'offset', 'kind'])
    || (kind === 'edges' && (typeof parsed.page !== 'string' || !SHA.test(parsed.page)))) invalid();
  if (parsed.revision !== revision) throw new Error('knowledge_cursor_stale');
  if (parsed.query !== query || parsed.offset > maximum) invalid();
  return parsed as Cursor;
}
const encodeCursor = (value: Cursor) => Buffer.from(JSON.stringify(value)).toString('base64url');

/**
 * Scans every shard with bounded per-file memory. Search and detail never stop at
 * the first shard. All edges are validated against the complete node identity
 * set; only edges within the current node page are rendered, with an explicit
 * independent cursor when they exceed the edge/response page budget.
 */
export async function queryShardedKnowledgeGraph(input: unknown, params: URLSearchParams, reader: KnowledgeShardReader): Promise<ShardedKnowledgeGraphPage> {
  try {
    if (!isKnowledgeShardManifest(input)) unavailable();
    const manifest = input;
    const q = params.get('q') ?? '', kind = params.get('kind') ?? '', selectedId = params.get('node');
    const limitText = params.get('limit') ?? '100', edgeLimitText = params.get('edgeLimit') ?? '500';
    const limit = Number(limitText), edgeLimit = Number(edgeLimitText);
    if ([...params.keys()].some(key => !['q', 'kind', 'node', 'limit', 'cursor', 'edgeLimit', 'edgeCursor'].includes(key) || params.getAll(key).length !== 1)
      || q.length > 256 || (kind && !KNOWLEDGE_KINDS.includes(kind as typeof KNOWLEDGE_KINDS[number]))
      || !/^\d{1,3}$/.test(limitText) || limit < 1 || limit > 200
      || !/^\d{1,4}$/.test(edgeLimitText) || edgeLimit < 1 || edgeLimit > 2000
      || (selectedId !== null && !ID.test(selectedId))) invalid();
    const query = hash(JSON.stringify([q, kind, limit, edgeLimit]));
    const nodeCursor = cursor(params.get('cursor'), manifest.revision, query, 'nodes', manifest.totalNodes);
    const edgeCursor = cursor(params.get('edgeCursor'), manifest.revision, query, 'edges', manifest.totalEdges);
    const offset = nodeCursor?.offset ?? 0;
    const search = q.normalize('NFKC').toLowerCase().trim();
    const nodeIds = new Set<string>(), candidates: KnowledgeNode[] = [];
    let selected: KnowledgeNode | null = null, filteredTotal = 0;
    for await (const descriptor of leafDescriptors(manifest, 'nodes', reader)) {
      for (const item of await readItems(manifest, descriptor, 'nodes', reader)) {
        const node = item as KnowledgeNode;
        nodeIds.add(node.id);
        if (node.id === selectedId) selected = node;
        if ((!kind || node.kind === kind) && (!search || `${node.displayTitle ?? ''} ${node.label} ${node.summary}`.normalize('NFKC').toLowerCase().includes(search))) {
          if (filteredTotal >= offset && candidates.length < limit) candidates.push(node);
          filteredTotal++;
        }
      }
    }
    if (nodeIds.size !== manifest.totalNodes) unavailable();
    if (offset > filteredTotal) invalid();
    const base = { revision: manifest.revision, generatedAt: manifest.generatedAt, coverage: manifest.coverage,
      selected, totalNodes: manifest.totalNodes, totalEdges: manifest.totalEdges, filteredTotal };
    // A requested limit is an upper bound. If node evidence is large, move the
    // remaining nodes to the next explicit node page instead of dropping data.
    while (candidates.length > 1 && bytes({ ...base, nodes: candidates }) > KNOWLEDGE_PAGE_MAX_BYTES - 8192) candidates.pop();
    const baseBytes = bytes({ ...base, nodes: candidates });
    if (baseBytes > KNOWLEDGE_PAGE_MAX_BYTES - 8192) unavailable();
    const pageKey = hash(JSON.stringify([offset, candidates.map(node => node.id)]));
    if (edgeCursor && edgeCursor.page !== pageKey) invalid();
    const edgeOffset = edgeCursor?.offset ?? 0, visible = new Set(candidates.map(node => node.id));
    const edges: KnowledgeEdge[] = [];
    let edgePageTotal = 0, edgeBytes = 0, full = false, scannedEdges = 0;
    for await (const descriptor of leafDescriptors(manifest, 'edges', reader)) {
      for (const item of await readItems(manifest, descriptor, 'edges', reader)) {
        const edge = item as KnowledgeEdge;
        scannedEdges++;
        if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target)) unavailable();
        if (!visible.has(edge.source) || !visible.has(edge.target)) continue;
        if (edgePageTotal >= edgeOffset && !full) {
          const size = bytes(edge) + 1;
          if (edges.length >= edgeLimit || baseBytes + edgeBytes + size > KNOWLEDGE_PAGE_MAX_BYTES - 4096) full = true;
          else { edges.push(edge); edgeBytes += size; }
        }
        edgePageTotal++;
      }
    }
    if (scannedEdges !== manifest.totalEdges) unavailable();
    if (edgeOffset > edgePageTotal) invalid();
    if (edgeOffset < edgePageTotal && !edges.length) unavailable();
    const page: ShardedKnowledgeGraphPage = { ...base, nodes: candidates, edges,
      omittedEdges: manifest.totalEdges - edges.length, edgePageTotal,
      nextCursor: offset + candidates.length < filteredTotal ? encodeCursor({ revision: manifest.revision, query, kind: 'nodes', offset: offset + candidates.length }) : null,
      nextEdgeCursor: edgeOffset + edges.length < edgePageTotal ? encodeCursor({ revision: manifest.revision, query, kind: 'edges', page: pageKey, offset: edgeOffset + edges.length }) : null };
    if (bytes(page) > KNOWLEDGE_PAGE_MAX_BYTES) unavailable();
    return page;
  } catch (error) {
    if (error instanceof Error && ['knowledge_query_invalid', 'knowledge_cursor_stale'].includes(error.message)) throw error;
    unavailable();
  }
}

/** Dispatch the authenticated local reader while preserving existing v1 output semantics. */
export async function queryKnowledgeGraphExport(input: unknown, params: URLSearchParams, reader?: KnowledgeShardReader): Promise<KnowledgeGraphPage | ShardedKnowledgeGraphPage> {
  if (isKnowledgeSnapshot(input)) {
    const page = queryKnowledgeGraph(input, params);
    if (bytes(page) > KNOWLEDGE_PAGE_MAX_BYTES) unavailable();
    return page;
  }
  if (!reader) unavailable();
  return queryShardedKnowledgeGraph(input, params, reader);
}
