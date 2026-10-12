import test from 'node:test';
import assert from 'node:assert/strict';
import {summarizeRetainers} from './heap-retainers-v1.mjs';

function snapshot() {
  const strings=[],id=s=>{let at=strings.indexOf(s);if(at<0){at=strings.length;strings.push(s);}return at;};
  const types=['synthetic','object','closure','number'],etypes=['internal','property','context','shortcut'];
  const defs=[
    ['synthetic','root',[['internal','query-private',1]]],
    ['object','Object',['queryHash','queryKey','state','options'].map(name=>['property',name,name==='options'?2:7])],
    ['object','Object',[['property','queryFn',3],['property','getNextPageParam',3]]],
    ['closure','callback-private-name',[['internal','context',4]]],
    ['object','PRIVATE_UNKNOWN_CONTEXT_CLASS',[['context','PRIVATE_SETTER_NAME',5]]],
    ['closure','bound-private-name',[['shortcut','PRIVATE_BOUND_ARG',6]]],
    ['object','Object',['memoizedState','memoizedProps','stateNode','return','tag'].map(name=>['property',name,7])],
    ['number','0',[]],
  ];
  const nodes=[],edges=[];
  for(const [type,name,out] of defs) {
    nodes.push(types.indexOf(type),id(name),16,out.length);
    for(const [kind,name,to] of out)edges.push(etypes.indexOf(kind),id(name),to*4);
  }
  return {snapshot:{meta:{node_fields:['type','name','self_size','edge_count'],
    edge_fields:['type','name_or_index','to_node'],node_types:[types],edge_types:[etypes]}},nodes,edges,strings};
}

test('dispatch ownership follows the context edge role even when its class name is unknown',()=>{
  const result=summarizeRetainers(snapshot());
  for(const name of ['queryFn','getNextPageParam']) {
    assert.equal(result.callbackOwnership[name].distinctCallbacks,1);
    assert.equal(result.callbackOwnership[name].callbacksWithDirectContextDispatch,1);
    assert.equal(result.callbackOwnership[name].distinctDirectFiberTargets,1);
  }
  assert.equal(JSON.stringify(result).includes('PRIVATE_'),false);
  assert.equal(JSON.stringify(result).includes('private-name'),false);
});

test('non-Fiber bound targets do not count as component dispatch ownership',()=>{
  const data=snapshot();
  data.strings[data.nodes[6*4+1]]='ordinary-object';
  const eName=data.snapshot.meta.edge_fields.indexOf('name_or_index');
  for(let e=0;e<data.edges.length;e+=3)
    if(data.strings[data.edges[e+eName]]==='memoizedState') data.strings[data.edges[e+eName]]='ordinaryProperty';
  const result=summarizeRetainers(data);
  assert.equal(result.callbackOwnership.queryFn.callbacksWithDirectContextDispatch,0);
  assert.equal(result.callbackOwnership.getNextPageParam.callbacksWithDirectContextDispatch,0);
});
