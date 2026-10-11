import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { readLocalKnowledgeGraph } from '../../lib/admin/knowledge-graph-local.ts';

const exportDir = 'data/knowledge-graph';
const revision = '285ba23b0eacb4a7069205b90e772b613daeadc6f34bbc18f0ad73afb3da6150';
const outsideId = '261006-1i3c-k0l3q5eb';

const outsidePage = await readLocalKnowledgeGraph(new URLSearchParams({ limit: '1', node: outsideId }), exportDir);
const selectedOutsideReturnedPage = !outsidePage.nodes.some((node) => node.id === outsidePage.selected?.id);
assert.equal(outsidePage.revision, revision);
assert.equal(outsidePage.nodes.length, 1);
assert.equal(outsidePage.selected?.id, outsideId);
assert.equal(selectedOutsideReturnedPage, true, 'selected node must be outside the one-node page');
assert.equal(outsidePage.totalNodes, 30);
assert.equal(outsidePage.totalEdges, 88);
assert.deepEqual(outsidePage.coverage, {
  analyzedCount: 0,
  eligibleCount: 1071,
  excludedShortsCount: 81,
  failedCount: 0,
  inventoryCount: 1152,
  pendingCount: 1071,
  asOf: '2026-10-09T00:34:34.628933Z',
});

const bounded = await readLocalKnowledgeGraph(new URLSearchParams({ limit: '1', node: '261004-19ug-29fj8ql0' }), exportDir);
assert.deepEqual(bounded.selected?.evidence[0], {
  videoId: 'QWtvZ6NfNJ8',
  startSeconds: 81,
  endSeconds: 84,
  url: 'https://www.youtube.com/watch?v=QWtvZ6NfNJ8&t=81s',
  status: 'unverified',
});

const whole = await readLocalKnowledgeGraph(new URLSearchParams({ limit: '1', node: '261006-1dn0-bhr7lw23' }), exportDir);
assert.deepEqual(whole.selected?.evidence[0], {
  videoId: '3Z-ngM3DVi0',
  startSeconds: 0,
  endSeconds: null,
  url: 'https://www.youtube.com/watch?v=3Z-ngM3DVi0',
  status: 'unverified',
});

const result = {
  status: 'passed',
  revision,
  pageLimit: 1,
  pageNodeId: outsidePage.nodes[0]?.id ?? null,
  selectedNodeId: outsidePage.selected?.id ?? null,
  selectedOutsideReturnedPage,
  totals: { nodes: outsidePage.totalNodes, edges: outsidePage.totalEdges },
  coverage: { analyzed: outsidePage.coverage.analyzedCount, eligible: outsidePage.coverage.eligibleCount },
  evidence: {
    bounded: bounded.selected?.evidence[0] ?? null,
    wholeVideo: whole.selected?.evidence[0] ?? null,
  },
};
writeFileSync('performance/knowledge-evidence-develop-20261011/reader-contract-results.json', `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify(result));
