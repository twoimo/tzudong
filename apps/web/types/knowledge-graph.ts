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
  edgePageTotal?: number; nextEdgeCursor?: string | null;
};

const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const count = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= 1_000_000;
const graphCount = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const nullableCount = (value: unknown) => value === null || count(value);
const identifier = (value: unknown): value is string => typeof value === 'string' && /^[a-zA-Z0-9_.:-]{1,160}$/.test(value);
const date = (value: unknown): value is string => typeof value === 'string' && value.length <= 64 && Number.isFinite(Date.parse(value));

// osk_projection._evidence uses Python's :g: six significant digits, half-even
// rounding and a two-digit exponent. Preserve that wire format exactly.
function evidenceTimestamp(value: number): string {
  const bits = new DataView(new ArrayBuffer(8));
  bits.setFloat64(0, value);
  const encoded = bits.getBigUint64(0), binaryExponent = Number((encoded >> 52n) & 2047n);
  let numerator = encoded & ((1n << 52n) - 1n), denominator = 1n;
  if (binaryExponent) numerator += 1n << 52n;
  const binaryShift = (binaryExponent || 1) - 1023 - 52;
  if (binaryShift >= 0) numerator <<= BigInt(binaryShift); else denominator <<= BigInt(-binaryShift);
  let exponent = Number(value.toExponential().split('e')[1]);
  const decimalShift = 5 - exponent;
  if (decimalShift >= 0) numerator *= 10n ** BigInt(decimalShift); else denominator *= 10n ** BigInt(-decimalShift);
  let rounded = numerator / denominator;
  const twiceRemainder = 2n * (numerator % denominator);
  if (twiceRemainder > denominator || (twiceRemainder === denominator && rounded % 2n === 1n)) rounded++;
  if (rounded >= 1000000n) { rounded /= 10n; exponent++; }
  const digits = rounded.toString().replace(/0+$/, '');
  if (exponent < -4 || exponent >= 6) {
    return `${digits[0]}${digits.length > 1 ? `.${digits.slice(1)}` : ''}e${exponent < 0 ? '-' : '+'}${String(Math.abs(exponent)).padStart(2, '0')}`;
  }
  const point = exponent + 1;
  if (point <= 0) return `0.${'0'.repeat(-point)}${digits}`;
  return point >= digits.length ? digits + '0'.repeat(point - digits.length) : `${digits.slice(0, point)}.${digits.slice(point)}`;
}

export function isKnowledgeNode(value: unknown): value is KnowledgeNode {
  if (!object(value) || !identifier(value.id) || typeof value.label !== 'string' || !value.label.trim() || Array.from(value.label).length > 512
    || !KNOWLEDGE_KINDS.includes(value.kind as KnowledgeKind) || typeof value.summary !== 'string' || Array.from(value.summary).length > 4000
    || !Array.isArray(value.evidence) || value.evidence.length > 64) return false;
  return value.evidence.every(item => {
    if (!object(item) || typeof item.videoId !== 'string' || !/^[a-zA-Z0-9_-]{11}$/.test(item.videoId)
      || typeof item.startSeconds !== 'number' || !Number.isFinite(item.startSeconds) || item.startSeconds < 0 || item.startSeconds > 1_000_000_000
      || (item.endSeconds !== null && (typeof item.endSeconds !== 'number' || !Number.isFinite(item.endSeconds) || item.endSeconds < item.startSeconds || item.endSeconds > 1_000_000_000))
      || !['verified', 'unverified'].includes(String(item.status)) || typeof item.url !== 'string') return false;
    return item.url === `https://www.youtube.com/watch?v=${item.videoId}${item.startSeconds ? `&t=${evidenceTimestamp(item.startSeconds)}s` : ''}`;
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
    || !['totalNodes', 'totalEdges', 'filteredTotal', 'omittedEdges'].every(key => graphCount(value[key]))
    || (value.nextCursor !== null && (typeof value.nextCursor !== 'string' || value.nextCursor.length > 4096))) return false;
  const ids = new Set(value.nodes.map(node => node.id));
  if ('edgePageTotal' in value || 'nextEdgeCursor' in value) {
    if (!graphCount(value.edgePageTotal) || value.edgePageTotal < value.edges.length || value.edgePageTotal > (value.totalEdges as number)
      || (value.nextEdgeCursor !== null && (typeof value.nextEdgeCursor !== 'string' || !value.nextEdgeCursor.length || value.nextEdgeCursor.length > 4096))) return false;
  }
  return ids.size === value.nodes.length && value.nodes.length <= (value.filteredTotal as number)
    && (value.filteredTotal as number) <= (value.totalNodes as number) && value.edges.every(edge => ids.has(edge.source) && ids.has(edge.target))
    && value.edges.length + (value.omittedEdges as number) === value.totalEdges;
}
