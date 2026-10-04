export const KNOWLEDGE_KINDS = ['hub', 'video', 'restaurant', 'menu', 'claim'] as const;
export type KnowledgeKind = typeof KNOWLEDGE_KINDS[number];
export type KnowledgeEvidence = {
  videoId: string; startSeconds: number; endSeconds: number | null;
  url: string; status: 'verified' | 'unverified';
};
export type KnowledgeNode = { id: string; label: string; kind: KnowledgeKind; summary: string; evidence: KnowledgeEvidence[] };
export type KnowledgeEdge = { id: string; source: string; target: string; relation: 'references' | 'derived-from' };
export type KnowledgeCoverage = {
  inventoryCount: number | null; eligibleCount: number | null; analyzedCount: number;
  pendingCount: number | null; failedCount: number; excludedShortsCount: number | null; asOf: string | null;
};
export type KnowledgeSnapshot = {
  schemaVersion: 1; scope: 'tzudong'; revision: string; generatedAt: string;
  nodes: KnowledgeNode[]; edges: KnowledgeEdge[]; coverage: KnowledgeCoverage;
};
export type KnowledgeGraphPage = {
  revision: string; generatedAt: string; coverage: KnowledgeCoverage;
  nodes: KnowledgeNode[]; edges: KnowledgeEdge[]; selected: KnowledgeNode | null;
  totalNodes: number; totalEdges: number; filteredTotal: number; omittedEdges: number; nextCursor: string | null;
};

const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const count = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= 1_000_000;
const nullableCount = (value: unknown) => value === null || count(value);
const identifier = (value: unknown): value is string => typeof value === 'string' && /^[a-zA-Z0-9_.:-]{1,160}$/.test(value);
const date = (value: unknown): value is string => typeof value === 'string' && value.length <= 64 && Number.isFinite(Date.parse(value));

export function isKnowledgeNode(value: unknown): value is KnowledgeNode {
  if (!object(value) || !identifier(value.id) || typeof value.label !== 'string' || !value.label.trim() || value.label.length > 512
    || !KNOWLEDGE_KINDS.includes(value.kind as KnowledgeKind) || typeof value.summary !== 'string' || value.summary.length > 4000
    || !Array.isArray(value.evidence) || value.evidence.length > 64) return false;
  return value.evidence.every(item => {
    if (!object(item) || typeof item.videoId !== 'string' || !/^[a-zA-Z0-9_-]{11}$/.test(item.videoId)
      || typeof item.startSeconds !== 'number' || !Number.isFinite(item.startSeconds) || item.startSeconds < 0
      || (item.endSeconds !== null && (typeof item.endSeconds !== 'number' || !Number.isFinite(item.endSeconds) || item.endSeconds < item.startSeconds))
      || !['verified', 'unverified'].includes(String(item.status)) || typeof item.url !== 'string') return false;
    return item.url === `https://www.youtube.com/watch?v=${item.videoId}&t=${Math.floor(item.startSeconds)}s`;
  });
}
function isEdge(value: unknown): value is KnowledgeEdge {
  return object(value) && identifier(value.id) && identifier(value.source) && identifier(value.target)
    && ['references', 'derived-from'].includes(String(value.relation));
}
function isCoverage(value: unknown): value is KnowledgeCoverage {
  return object(value) && ['inventoryCount', 'eligibleCount', 'pendingCount', 'excludedShortsCount'].every(key => nullableCount(value[key]))
    && count(value.analyzedCount) && count(value.failedCount) && (value.asOf === null || date(value.asOf))
    && (value.eligibleCount === null || (value.analyzedCount + value.failedCount <= (value.eligibleCount as number)
      && value.pendingCount === (value.eligibleCount as number) - value.analyzedCount - value.failedCount))
    && (value.inventoryCount === null || value.eligibleCount === null || (value.eligibleCount as number) <= (value.inventoryCount as number));
}
export function isKnowledgeSnapshot(value: unknown): value is KnowledgeSnapshot {
  if (!object(value) || value.schemaVersion !== 1 || value.scope !== 'tzudong' || typeof value.revision !== 'string' || !/^[a-f0-9]{64}$/.test(value.revision)
    || !date(value.generatedAt) || !isCoverage(value.coverage) || !Array.isArray(value.nodes) || value.nodes.length > 50_000
    || !value.nodes.every(isKnowledgeNode) || !Array.isArray(value.edges) || value.edges.length > 100_000 || !value.edges.every(isEdge)) return false;
  const ids = new Set(value.nodes.map(node => node.id));
  return ids.size === value.nodes.length && new Set(value.edges.map(edge => edge.id)).size === value.edges.length
    && value.edges.every(edge => ids.has(edge.source) && ids.has(edge.target));
}
export function isKnowledgeGraphPage(value: unknown): value is KnowledgeGraphPage {
  if (!object(value) || typeof value.revision !== 'string' || !/^[a-f0-9]{64}$/.test(value.revision) || !date(value.generatedAt)
    || !isCoverage(value.coverage) || !Array.isArray(value.nodes) || value.nodes.length > 200 || !value.nodes.every(isKnowledgeNode)
    || !Array.isArray(value.edges) || value.edges.length > 100_000 || !value.edges.every(isEdge)
    || (value.selected !== null && !isKnowledgeNode(value.selected))
    || !['totalNodes', 'totalEdges', 'filteredTotal', 'omittedEdges'].every(key => count(value[key]))
    || (value.nextCursor !== null && (typeof value.nextCursor !== 'string' || value.nextCursor.length > 4096))) return false;
  const ids = new Set(value.nodes.map(node => node.id));
  return ids.size === value.nodes.length && value.nodes.length <= (value.filteredTotal as number)
    && (value.filteredTotal as number) <= (value.totalNodes as number) && value.edges.every(edge => ids.has(edge.source) && ids.has(edge.target))
    && value.edges.length + (value.omittedEdges as number) === value.totalEdges;
}
