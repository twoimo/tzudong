// Snapshot strings stay in RAM. Emit only fixed shape counts and byte totals.
export function summarizeHeapShapes(snapshot) {
  const nf = snapshot.snapshot.meta.node_fields;
  const ef = snapshot.snapshot.meta.edge_fields;
  const nt = snapshot.snapshot.meta.node_types[nf.indexOf('type')];
  const et = snapshot.snapshot.meta.edge_types[ef.indexOf('type')];
  const nType = nf.indexOf('type'), nName = nf.indexOf('name'), nSize = nf.indexOf('self_size'), nEdges = nf.indexOf('edge_count');
  const eType = ef.indexOf('type'), eName = ef.indexOf('name_or_index'), eTo = ef.indexOf('to_node');
  if ([nType, nName, nSize, nEdges, eType, eName, eTo].some(x => x < 0)) throw Error('SNAPSHOT_SCHEMA_DENIED');
  const shapes = {
    selectionKey: ['id', 'lat', 'lng', 'mergedIds', 'name'],
    listSnapshot: ['keys', 'references', 'unique'],
    orderedResult: ['restaurants', 'searched'],
    fallbackResult: ['restaurant', 'searched', 'visible'],
  };
  const starts = new Map(), totals = {}, refs = new Map();
  let cursor = 0;
  for (let n = 0; n < snapshot.nodes.length; n += nf.length) {
    starts.set(n, cursor);
    cursor += snapshot.nodes[n + nEdges] * ef.length;
  }
  for (const key of Object.keys(shapes)) { totals[key] = { objects: 0, ownBytes: 0, directArrayObjects: 0, directArrayBackingBytes: 0 }; refs.set(key, new Set()); }
  for (let n = 0; n < snapshot.nodes.length; n += nf.length) {
    if (nt[snapshot.nodes[n + nType]] !== 'object' || snapshot.strings[snapshot.nodes[n + nName]] !== 'Object') continue;
    const properties = new Map(), start = starts.get(n), end = start + snapshot.nodes[n + nEdges] * ef.length;
    for (let e = start; e < end; e += ef.length) {
      if (et[snapshot.edges[e + eType]] === 'property') properties.set(snapshot.strings[snapshot.edges[e + eName]], snapshot.edges[e + eTo]);
    }
    const names = [...properties.keys()].filter(x => x !== '__proto__').sort().join(',');
    for (const [key, expected] of Object.entries(shapes)) {
      if (names !== expected.join(',')) continue;
      totals[key].objects += 1; totals[key].ownBytes += snapshot.nodes[n + nSize];
      for (const target of properties.values()) {
        if (nt[snapshot.nodes[target + nType]] !== 'object' || snapshot.strings[snapshot.nodes[target + nName]] !== 'Array') continue;
        refs.get(key).add(target);
      }
    }
  }
  for (const [key, arrays] of refs) {
    totals[key].directArrayObjects = arrays.size;
    const backing = new Set();
    for (const target of arrays) {
      const start = starts.get(target), end = start + snapshot.nodes[target + nEdges] * ef.length;
      for (let e = start; e < end; e += ef.length) {
        const to = snapshot.edges[e + eTo];
        if (nt[snapshot.nodes[to + nType]] === 'array') backing.add(to);
      }
    }
    for (const target of backing) totals[key].directArrayBackingBytes += snapshot.nodes[target + nSize];
  }
  return { shapes: totals, scope: 'Post-snapshot shape counts only; shared arrays are not exclusive retained bytes.', rawStringsPersisted: false, primaryGuardReplacement: false };
}

export async function collectHeapShapeSummary(cdp) {
  let chunks = [], bytes = 0, overflow = false;
  const onChunk = ({chunk}) => { bytes += Buffer.byteLength(chunk); if (bytes > 64 * 1024 * 1024) { chunks = []; overflow = true; } else if (!overflow) chunks.push(chunk); };
  await cdp.send('HeapProfiler.enable');
  cdp.on('HeapProfiler.addHeapSnapshotChunk', onChunk);
  try {
    await cdp.send('HeapProfiler.takeHeapSnapshot', { reportProgress: false });
    if (overflow) throw Error('SNAPSHOT_CAP_DENIED');
    const snapshot = JSON.parse(chunks.join('')); chunks = [];
    return summarizeHeapShapes(snapshot);
  } finally { chunks = []; cdp.off('HeapProfiler.addHeapSnapshotChunk', onChunk); await cdp.send('HeapProfiler.disable'); }
}
