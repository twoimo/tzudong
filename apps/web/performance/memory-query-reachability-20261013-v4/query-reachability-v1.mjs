const families = new Set(['restaurants', 'restaurant-search', 'restaurant-reviews', 'restaurant-tzuyang-review-siblings']);
const jsTypes = new Set(['hidden', 'array', 'string', 'object', 'code', 'closure', 'regexp', 'number', 'concatenated string', 'sliced string', 'symbol', 'bigint']);

export function summarizeQueryReachability(snapshot) {
  const { nodes, edges, strings } = snapshot;
  const meta = snapshot.snapshot.meta;
  const nf = meta.node_fields, ef = meta.edge_fields;
  const nt = nf.indexOf('type'), nn = nf.indexOf('name'), ns = nf.indexOf('self_size'), ne = nf.indexOf('edge_count');
  const et = ef.indexOf('type'), en = ef.indexOf('name_or_index'), to = ef.indexOf('to_node');
  if ([nt, nn, ns, ne, et, en, to].some(x => x < 0) || nodes.length % nf.length || edges.length % ef.length) throw Error('SNAPSHOT_SCHEMA');
  const nodeTypes = meta.node_types[nt], edgeTypes = meta.edge_types[et];
  const count = nodes.length / nf.length;
  if (count > 2_000_000 || nodeTypes[nodes[nt]] !== 'synthetic') throw Error('SNAPSHOT_BOUNDS');
  const offsets = new Uint32Array(count + 1);
  for (let i = 0; i < count; i++) offsets[i + 1] = offsets[i] + nodes[i * nf.length + ne] * ef.length;
  if (offsets[count] !== edges.length) throw Error('SNAPSHOT_EDGES');
  const target = e => { const n = edges[e + to] / nf.length; if (!Number.isInteger(n) || n < 0 || n >= count) throw Error('SNAPSHOT_TARGET'); return n; };
  const properties = index => {
    const result = new Map();
    for (let e = offsets[index]; e < offsets[index + 1]; e += ef.length) {
      if (edgeTypes[edges[e + et]] !== 'property') continue;
      const name = strings[edges[e + en]];
      if (['queryKey', 'queryHash', 'state'].includes(name)) result.set(name, target(e));
    }
    return result;
  };
  const firstKey = index => {
    for (let e = offsets[index]; e < offsets[index + 1]; e += ef.length) {
      if (edgeTypes[edges[e + et]] === 'element' && edges[e + en] === 0) {
        const n = target(e); return strings[nodes[n * nf.length + nn]];
      }
    }
    return null;
  };
  const grouped = new Map();
  for (let i = 0; i < count; i++) {
    if (nodeTypes[nodes[i * nf.length + nt]] !== 'object') continue;
    const props = properties(i);
    if (props.size !== 3) continue;
    const key = firstKey(props.get('queryKey'));
    const family = families.has(key) ? key : 'other';
    const group = grouped.get(family) ?? []; group.push(i); grouped.set(family, group);
  }
  const reach = omitted => {
    const visited = new Uint8Array(count), queue = new Uint32Array(count);
    let head = 0, tail = 1; visited[0] = 1; queue[0] = 0;
    let jsBytes = 0, reachableNodes = 0;
    while (head < tail) {
      const n = queue[head++]; reachableNodes++;
      if (jsTypes.has(nodeTypes[nodes[n * nf.length + nt]])) jsBytes += nodes[n * nf.length + ns];
      for (let e = offsets[n]; e < offsets[n + 1]; e += ef.length) {
        if (edgeTypes[edges[e + et]] === 'weak') continue;
        const next = target(e);
        if (visited[next] || omitted.has(next)) continue;
        visited[next] = 1; queue[tail++] = next;
      }
    }
    return { jsBytes, reachableNodes };
  };
  const baseline = reach(new Set());
  const all = [...grouped.values()].flat();
  const results = [];
  for (const [family, group] of [...grouped.entries(), ['all', all]]) {
    const after = reach(new Set(group));
    results.push({ family, queryObjects: group.length, shallowSelfBytes: group.reduce((sum, n) => sum + nodes[n * nf.length + ns], 0), counterfactualUnreachableJsBytes: baseline.jsBytes - after.jsBytes, counterfactualUnreachableNodes: baseline.reachableNodes - after.reachableNodes });
  }
  return { graphNodes: count, graphEdges: edges.length / ef.length, identifiedQueries: all.length, baselineStrongReachableJsBytes: baseline.jsBytes, groups: results, semantics: 'Counterfactual strong-edge reachability only; weak/ephemeron/dominator/actual-eviction effects unproven. Do not add overlapping family results.' };
}
