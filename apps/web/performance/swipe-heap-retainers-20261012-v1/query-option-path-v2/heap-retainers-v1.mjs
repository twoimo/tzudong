// Snapshot strings and node ids stay in RAM. Only bounded fixed labels leave it.
export function summarizeRetainers(snapshot) {
  const meta = snapshot?.snapshot?.meta;
  if (!meta || !Array.isArray(snapshot.nodes) || !Array.isArray(snapshot.edges)
      || !Array.isArray(snapshot.strings)) throw Error('SNAPSHOT_SCHEMA_DENIED');
  const nf = meta.node_fields, ef = meta.edge_fields;
  if (!Array.isArray(nf) || !Array.isArray(ef)) throw Error('SNAPSHOT_SCHEMA_DENIED');
  const ni = Object.fromEntries(['type','name','self_size','edge_count'].map(k => [k,nf.indexOf(k)]));
  const ei = Object.fromEntries(['type','name_or_index','to_node'].map(k => [k,ef.indexOf(k)]));
  if ([...Object.values(ni),...Object.values(ei)].some(v => v < 0)
      || snapshot.nodes.length % nf.length || snapshot.edges.length % ef.length)
    throw Error('SNAPSHOT_SCHEMA_DENIED');
  const types = meta.node_types[ni.type], etypes = meta.edge_types[ei.type];
  if (!Array.isArray(types) || !Array.isArray(etypes)) throw Error('SNAPSHOT_SCHEMA_DENIED');
  const count = snapshot.nodes.length / nf.length, edgeCount = snapshot.edges.length / ef.length;
  const starts = new Uint32Array(count + 1), labels = new Array(count);
  const rawProperties = new Array(count);
  let cursor = 0;
  for (let node=0;node<count;node++) {
    starts[node] = cursor;
    const size = snapshot.nodes[node*nf.length+ni.edge_count];
    if (!Number.isSafeInteger(size) || size<0) throw Error('SNAPSHOT_SCHEMA_DENIED');
    cursor += size;
  }
  starts[count] = cursor;
  if (cursor !== edgeCount || count===0) throw Error('SNAPSHOT_SCHEMA_DENIED');
  const target = e => {
    const raw=snapshot.edges[e*ef.length+ei.to_node];
    if (!Number.isSafeInteger(raw) || raw<0 || raw>=snapshot.nodes.length || raw%nf.length)
      throw Error('SNAPSHOT_SCHEMA_DENIED');
    return raw/nf.length;
  };
  const edgeType = e => etypes[snapshot.edges[e*ef.length+ei.type]];
  const edgeName = e => snapshot.strings[snapshot.edges[e*ef.length+ei.name_or_index]];
  const shapes = {
    selectionKey: ['id','lat','lng','mergedIds','name'],
    listSnapshot: ['keys','references','unique'],
    orderedResult: ['restaurants','searched'],
    fallbackResult: ['restaurant','searched','visible'],
  };
  for (let node=0;node<count;node++) {
    const base=node*nf.length,type=types[snapshot.nodes[base+ni.type]];
    const name=snapshot.strings[snapshot.nodes[base+ni.name]],properties=[];
    for (let e=starts[node];e<starts[node+1];e++) {
      target(e);
      if (edgeType(e)==='property' && edgeName(e)!=='__proto__') properties.push(edgeName(e));
    }
    properties.sort();rawProperties[node]=properties;
    let label = type==='object' ? (['WeakMap','Map','Array'].includes(name)?name:'other-object')
      : type==='synthetic'?'gc-root':type==='closure'?'closure':type==='array'?'array-backing'
      : type==='hidden'?'engine-hidden':type==='string'||type==='concatenated string'||type==='sliced string'?'string':'other-node';
    if (type==='object') {
      for (const [shape,keys] of Object.entries(shapes))
        if (properties.join(',')===keys.join(',')) label=shape;
      if (['queryHash','queryKey','state','options'].every(k=>properties.includes(k))) label='query';
      if (['data','dataUpdatedAt','fetchStatus'].every(k=>properties.includes(k))) label='query-state';
      if (['id','name','lat','lng','road_address'].every(k=>properties.includes(k))) label='restaurant-row';
    }
    if (name==='system / Context') label='lexical-context';
    if (type==='native') {
      const detachedness=nf.indexOf('detachedness');
      if (name.startsWith('Detached ') || (detachedness>=0 && snapshot.nodes[base+detachedness]===1)) label='detached-dom';
      else if (name==='EventListener') label='event-listener';
      else if (/^(HTML|SVG|Text|Document|Comment)/.test(name)) label='dom-node';
    }
    if (type==='object' && ['memoizedState','memoizedProps','stateNode','return','tag'].every(k=>properties.includes(k))) label='react-fiber';
    labels[node]=label;
  }
  // V8 table edges to values can be conditional on a live WeakMap key.
  const conditional = e => edgeType(e)==='internal' && /^\d+ \/ part of key/.test(edgeName(e)??'');
  for(let n=0;n<count;n++) if(labels[n]==='WeakMap')
    for(let e=starts[n];e<starts[n+1];e++)
      if(edgeType(e)==='internal' && labels[target(e)]==='array-backing') labels[target(e)]='weakmap-table';
  const propertyAllow=new Set(['keys','references','unique','restaurants','searched','restaurant','visible',
    'queryHash','queryKey','state','options','data','observers','mergedIds','queryFn','getNextPageParam','select','structuralSharing','placeholderData','retry','retryDelay','enabled','persister','initialData','initialDataUpdatedAt','onSuccess','onError','onSettled']);
  const edgeLabel=e=>conditional(e)?'ephemeron-value':edgeType(e)==='property'
    ?'property:'+(propertyAllow.has(edgeName(e))?edgeName(e):'other')
    :['internal','element','context','hidden','weak','shortcut'].includes(edgeType(e))?edgeType(e):'other-edge';
  const parent=new Int32Array(count).fill(-1),parentEdge=new Int32Array(count).fill(-1);
  const distance=new Int32Array(count).fill(-1),hasConditional=new Uint8Array(count),queue=new Uint32Array(count);
  distance[0]=0;queue[0]=0;let head=0,tail=1,weakEdges=0,ephemeronEdges=0;
  for(let e=0;e<edgeCount;e++) {if(edgeType(e)==='weak') weakEdges++;if(conditional(e)) ephemeronEdges++;}
  while(head<tail) {
    const node=queue[head++];
    for(let e=starts[node];e<starts[node+1];e++) {
      if(edgeType(e)==='weak') continue;
      const next=target(e);if(distance[next]!==-1)continue;
      distance[next]=distance[node]+1;parent[next]=node;parentEdge[next]=e;
      hasConditional[next]=hasConditional[node]||conditional(e)?1:0;queue[tail++]=next;
    }
  }
  const tracked=[...Object.keys(shapes),'query','query-state','restaurant-row','detached-dom','dom-node','event-listener','react-fiber'];
  const totals=Object.fromEntries(tracked.map(k=>[k,{objects:0,ownBytes:0,nonWeakEdgeRootPaths:0,
    rootPathsWithConditionalEphemeron:0,noNonWeakEdgeRootPath:0,incoming:{},pathPatterns:[]} ]));
  const patterns=Object.fromEntries(tracked.map(k=>[k,new Map()]));
  for(let n=0;n<count;n++) {
    const group=totals[labels[n]];if(!group)continue;
    group.objects++;group.ownBytes+=snapshot.nodes[n*nf.length+ni.self_size];
    if(distance[n]===-1) {group.noNonWeakEdgeRootPath++;continue;}
    group.nonWeakEdgeRootPaths++;group.rootPathsWithConditionalEphemeron+=hasConditional[n];
    let at=n,steps=0;const path=[labels[n]];
    while(parent[at]!==-1 && steps++<24) {
      path.unshift(labels[parent[at]],edgeLabel(parentEdge[at]));at=parent[at];
    }
    if(parent[at]!==-1)path.unshift('truncated');
    const signature=path.join(' > '),byPattern=patterns[labels[n]];
    byPattern.set(signature,(byPattern.get(signature)??0)+1);
  }
  for(let n=0;n<count;n++) for(let e=starts[n];e<starts[n+1];e++) {
    const group=totals[labels[target(e)]];if(!group)continue;
    const key=labels[n]+' / '+edgeLabel(e);group.incoming[key]=(group.incoming[key]??0)+1;
  }
  for(const name of tracked) {
    const sorted=[...patterns[name]].sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0]));
    totals[name].pathPatterns=sorted.slice(0,8).map(([path,objects])=>({path,objects}));
    totals[name].unlistedPathPatternCount=Math.max(0,sorted.length-8);
  }
  return {schemaVersion:1,nodeCount:count,edgeCount,weakEdges,conditionalEphemeronEdges:ephemeronEdges,
    groups:totals,rawStringsPersisted:false,rawIdsPersisted:false,primaryGuardReplacement:false,
    scope:'Post-GC snapshot ownership paths. Conditional ephemerons are explicit. Not dominators, exclusive retained bytes, leak proof, or natural-heap performance samples.'};
}

export async function collectHeapRetainers(cdp) {
  let chunks=[],bytes=0,overflow=false;
  const receive=({chunk})=>{bytes+=Buffer.byteLength(chunk);if(bytes>64*1024*1024){chunks=[];overflow=true;}else if(!overflow)chunks.push(chunk);};
  await cdp.send('HeapProfiler.enable');cdp.on('HeapProfiler.addHeapSnapshotChunk',receive);
  try {
    await cdp.send('HeapProfiler.takeHeapSnapshot',{reportProgress:false});
    if(overflow)throw Error('SNAPSHOT_CAP_DENIED');
    const snapshot=JSON.parse(chunks.join(''));chunks=[];
    return summarizeRetainers(snapshot);
  } finally {chunks=[];cdp.off('HeapProfiler.addHeapSnapshotChunk',receive);await cdp.send('HeapProfiler.disable');}
}
