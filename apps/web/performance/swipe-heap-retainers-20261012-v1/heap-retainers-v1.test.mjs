import test from 'node:test';
import assert from 'node:assert/strict';
import {summarizeRetainers,collectHeapRetainers} from './heap-retainers-v1.mjs';

function fixture(weakValue=false) {
  const strings=[],sid=value=>{let i=strings.indexOf(value);if(i<0){i=strings.length;strings.push(value);}return i;};
  const defs=[
    ['synthetic','root',0, [['internal','cache-secret',1],['shortcut','query-secret',7]]],
    ['object','WeakMap',24,[['internal','table',2]]],
    ['array','engine-table',64,[[weakValue?'weak':'internal',weakValue?'unknown-secret':'0 / part of key (secret @9)',3]]],
    ['object','Object',24,[['property','references',4],['property','keys',4],['property','unique',4]]],
    ['object','Array',16,[['element',0,5]]],
    ['object','Object',32,['id','name','lat','lng','mergedIds'].map(name=>['property',name,6])],
    ['string','PRIVATE_SECRET_NO_OUTPUT',8,[]],
    ['object','minified-query-private-name',48,['queryHash','queryKey','state','options'].map(name=>['property',name,name==='state'?8:6])],
    ['object','Object',24,['data','dataUpdatedAt','fetchStatus'].map(name=>['property',name,name==='data'?4:6])],
  ];
  const nodeTypes=['synthetic','object','array','string'],edgeTypes=['internal','shortcut','weak','property','element'];
  const nodes=[],edges=[];
  for(const [type,name,size,out] of defs) {
    nodes.push(nodeTypes.indexOf(type),sid(name),size,out.length);
    for(const [kind,label,to] of out)edges.push(edgeTypes.indexOf(kind),kind==='element'?label:sid(label),to*4);
  }
  return {snapshot:{meta:{node_fields:['type','name','self_size','edge_count'],
    edge_fields:['type','name_or_index','to_node'],node_types:[nodeTypes],edge_types:[edgeTypes]}},nodes,edges,strings};
}

test('records fixed cache/query shapes and conditional ownership without raw values or ids',()=>{
  const summary=summarizeRetainers(fixture());
  assert.equal(summary.groups.listSnapshot.objects,1);
  assert.equal(summary.groups.listSnapshot.ownBytes,24);
  assert.equal(summary.groups.listSnapshot.rootPathsWithConditionalEphemeron,1);
  assert.equal(summary.groups.query.objects,1);
  assert.equal(summary.groups['query-state'].objects,1);
  assert.equal(summary.groups.selectionKey.objects,1);
  assert.match(summary.groups.listSnapshot.pathPatterns[0].path,/WeakMap.*weakmap-table.*ephemeron-value.*listSnapshot/);
  const text=JSON.stringify(summary);
  for(const privateValue of ['PRIVATE_SECRET_NO_OUTPUT','cache-secret','query-secret','secret @9','minified-query-private-name'])
    assert.equal(text.includes(privateValue),false);
});

test('weak-only value is not reported as a root ownership path',()=>{
  const summary=summarizeRetainers(fixture(true));
  assert.equal(summary.groups.listSnapshot.objects,1);
  assert.equal(summary.groups.listSnapshot.nonWeakEdgeRootPaths,0);
  assert.equal(summary.groups.listSnapshot.noNonWeakEdgeRootPath,1);
  assert.equal(summary.groups.listSnapshot.incoming['weakmap-table / weak'],1);
});

test('schema and corrupt edge references fail closed',()=>{
  assert.throws(()=>summarizeRetainers({}),/SNAPSHOT_SCHEMA_DENIED/);
  const value=fixture();value.edges[2]=999;
  assert.throws(()=>summarizeRetainers(value),/SNAPSHOT_SCHEMA_DENIED/);
  const value2=fixture();value2.nodes[3]=100;
  assert.throws(()=>summarizeRetainers(value2),/SNAPSHOT_SCHEMA_DENIED/);
});

test('detached native DOM labels are fixed and never emit node text',()=>{
  const value=fixture();value.snapshot.meta.node_types[0].push('native');
  value.nodes[6*4]=4;
  value.strings[value.nodes[6*4+1]]='Detached HTMLDivElement PRIVATE_DOM_TEXT';
  const result=summarizeRetainers(value);
  assert.equal(result.groups['detached-dom'].objects,1);
  assert.equal(JSON.stringify(result).includes('PRIVATE_DOM_TEXT'),false);
});

test('snapshot cap failure still removes listener and disables profiler',async()=>{
  let receiver;const calls=[];const chunk='x'.repeat(1024*1024);
  const cdp={on:(_,fn)=>{receiver=fn;},off:(_,fn)=>{assert.equal(fn,receiver);receiver=null;},
    send:async command=>{calls.push(command);if(command==='HeapProfiler.takeHeapSnapshot')
      for(let i=0;i<65;i++)receiver({chunk});}};
  await assert.rejects(collectHeapRetainers(cdp),/SNAPSHOT_CAP_DENIED/);
  assert.equal(receiver,null);
  assert.equal(calls.at(-1),'HeapProfiler.disable');
});
