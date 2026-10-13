import test from 'node:test';
import assert from 'node:assert/strict';
import { summarizeQueryReachability } from './query-reachability-v1.mjs';

function fixture({ shared = false, weak = false } = {}) {
  const strings = ['root', 'Query', 'Array', 'restaurant-reviews', 'private-source-string', 'state', 'queryKey', 'queryHash', 'child'];
  const specs = [
    { type: 0, name: 0, size: 0, edges: [[0, 8, 1], ...(shared ? [[0, 8, 5]] : [])] },
    { type: 1, name: 1, size: 100, edges: [[0, 6, 2], [0, 7, 4], [0, 5, 5]] },
    { type: 1, name: 2, size: 40, edges: [[1, 0, 3]] },
    { type: 2, name: 3, size: 20, edges: [] },
    { type: 2, name: 4, size: 30, edges: [] },
    { type: 1, name: 5, size: 200, edges: [[weak ? 2 : 0, 8, 6]] },
    { type: 1, name: 8, size: 80, edges: [[0, 8, 5]] },
  ];
  return {
    snapshot: { meta: { node_fields: ['type', 'name', 'self_size', 'edge_count'], node_types: [['synthetic', 'object', 'string']], edge_fields: ['type', 'name_or_index', 'to_node'], edge_types: [['property', 'element', 'weak']] } },
    nodes: specs.flatMap(n => [n.type, n.name, n.size, n.edges.length]),
    edges: specs.flatMap(n => n.edges.flatMap(([type, name, target]) => [type, name, target * 4])), strings,
  };
}
test('omitting a query accounts for its cyclic exclusively reachable data', () => {
  const result = summarizeQueryReachability(fixture());
  assert.equal(result.identifiedQueries, 1);
  assert.equal(result.groups.find(x => x.family === 'all').counterfactualUnreachableJsBytes, 470);
  assert.ok(!JSON.stringify(result).includes('private-source-string'));
});
test('a shared external root prevents attributing shared state to query removal', () => {
  const result = summarizeQueryReachability(fixture({ shared: true }));
  assert.equal(result.groups.find(x => x.family === 'all').counterfactualUnreachableJsBytes, 190);
});
test('weak-only targets are excluded from the baseline strong graph', () => {
  const result = summarizeQueryReachability(fixture({ weak: true }));
  assert.equal(result.baselineStrongReachableJsBytes, 390);
});
test('an invalid target rejects the snapshot rather than producing a partial estimate', () => {
  const input = fixture(); input.edges[2] = 3;
  assert.throws(() => summarizeQueryReachability(input), /SNAPSHOT_TARGET/);
});
