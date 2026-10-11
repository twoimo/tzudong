import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { formatKnowledgeEvidence as formatAfter } from '../../lib/admin/knowledge-graph-evidence.ts';
import { formatKnowledgeEvidence as formatBefore } from './formatter-before-8ca22313.ts';

type Evidence = {
  videoId: string;
  startSeconds: number;
  endSeconds: number | null;
  url: string;
  status: 'verified' | 'unverified';
};

type NodeRecord = {
  id: string;
  evidence?: Evidence[];
};

const root = process.cwd();
const graphRoot = resolve(root, 'data/knowledge-graph');
const manifestPath = resolve(graphRoot, 'tzudong.json');
const manifestBytes = readFileSync(manifestPath);
const manifest = JSON.parse(manifestBytes.toString('utf8')) as {
  revision: string;
  totalNodes: number;
  totalEdges: number;
  nodeShards: Array<{ path: string; sha256: string; count: number }>;
};

const sha256 = (value: Buffer | string) => createHash('sha256').update(value).digest('hex');
const nodes: NodeRecord[] = [];
const shardBindings = [];
for (const shard of manifest.nodeShards) {
  const path = resolve(graphRoot, shard.path);
  const bytes = readFileSync(path);
  const actualSha256 = sha256(bytes);
  if (actualSha256 !== shard.sha256) throw new Error(`NODE_SHARD_HASH_MISMATCH:${shard.path}`);
  const parsed = JSON.parse(bytes.toString('utf8')) as { items: NodeRecord[] };
  if (parsed.items.length !== shard.count) throw new Error(`NODE_SHARD_COUNT_MISMATCH:${shard.path}`);
  nodes.push(...parsed.items);
  shardBindings.push({ path: shard.path, bytes: bytes.length, sha256: actualSha256 });
}
if (nodes.length !== manifest.totalNodes) throw new Error('TOTAL_NODE_COUNT_MISMATCH');

const allEvidence = nodes.flatMap((node) =>
  (node.evidence ?? []).map((evidence) => ({ nodeId: node.id, evidence })),
);
const untimed = allEvidence.filter(({ evidence }) =>
  evidence.startSeconds === 0 && evidence.endSeconds === null,
);
const identitiesBefore = JSON.stringify(allEvidence.map(({ nodeId, evidence }) => ({
  nodeId,
  videoId: evidence.videoId,
  url: evidence.url,
  status: evidence.status,
  startSeconds: evidence.startSeconds,
  endSeconds: evidence.endSeconds,
})));

const comparisons = untimed.map(({ nodeId, evidence }) => {
  const before = formatBefore(evidence);
  const after = formatAfter(evidence);
  if (before.range !== '전체 영상') throw new Error(`BEFORE_LABEL_DRIFT:${nodeId}`);
  if (after.range !== '시간 정보 없음') throw new Error(`AFTER_LABEL_INVALID:${nodeId}`);
  if (after.range.includes('전체 영상')) throw new Error(`WHOLE_VIDEO_CLAIM_REMAINS:${nodeId}`);
  if (before.source !== after.source || before.status !== after.status) {
    throw new Error(`IDENTITY_OR_STATUS_CHANGED:${nodeId}`);
  }
  if (after.source !== `YouTube · ${evidence.videoId}`) throw new Error(`VIDEO_ID_CHANGED:${nodeId}`);
  return {
    nodeId,
    videoId: evidence.videoId,
    url: evidence.url,
    status: evidence.status,
    beforeRange: before.range,
    afterRange: after.range,
  };
});

const identitiesAfter = JSON.stringify(allEvidence.map(({ nodeId, evidence }) => ({
  nodeId,
  videoId: evidence.videoId,
  url: evidence.url,
  status: evidence.status,
  startSeconds: evidence.startSeconds,
  endSeconds: evidence.endSeconds,
})));
if (identitiesBefore !== identitiesAfter) throw new Error('SOURCE_DATA_MUTATED');

const beforeWholeVideoClaims = comparisons.filter((item) => item.beforeRange === '전체 영상').length;
const afterWholeVideoClaims = comparisons.filter((item) => item.afterRange === '전체 영상').length;
const afterUntimedLabels = comparisons.filter((item) => item.afterRange === '시간 정보 없음').length;
if (beforeWholeVideoClaims !== untimed.length || afterWholeVideoClaims !== 0
  || afterUntimedLabels !== untimed.length) throw new Error('LABEL_COUNTS_INVALID');

const result = {
  status: 'passed',
  revision: manifest.revision,
  graph: {
    nodes: manifest.totalNodes,
    edges: manifest.totalEdges,
    evidenceItems: allEvidence.length,
    untimedEvidenceItems: untimed.length,
  },
  labels: {
    denominator: untimed.length,
    beforeWholeVideoClaims,
    afterWholeVideoClaims,
    afterUntimedLabels,
  },
  preserved: {
    idsUrlsStatusAndRangesSha256Before: sha256(identitiesBefore),
    idsUrlsStatusAndRangesSha256After: sha256(identitiesAfter),
    unchanged: identitiesBefore === identitiesAfter,
  },
  sourceData: {
    manifest: { path: 'data/knowledge-graph/tzudong.json', bytes: manifestBytes.length, sha256: sha256(manifestBytes) },
    nodeShards: shardBindings,
  },
  comparisons,
  statistics: {
    method: 'fixed exhaustive enumeration of the canonical 30-node export',
    samplingConfidenceInterval: null,
    explanation: 'No sampling CI applies to exhaustive label counts. This check has no latency, provider, or quality-model implication.',
  },
};

writeFileSync(
  'performance/knowledge-evidence-untimed-20261011/meaning-contract-results.json',
  `${JSON.stringify(result, null, 2)}\n`,
);
console.log(JSON.stringify(result));
