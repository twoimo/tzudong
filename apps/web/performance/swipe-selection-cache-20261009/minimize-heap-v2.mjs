// The raw snapshot stays in owned driver RAM. Persist only fixed-schema
// structural counts; no strings, object values, URLs or node identifiers.
export async function snapshotStructure(cdp) {
  let chunks=[],bytes=0,oversize=false;
  const receive=({chunk})=>{bytes+=Buffer.byteLength(chunk);if(bytes>256*1024*1024){oversize=true;chunks=[];}else if(!oversize)chunks.push(chunk);};
  cdp.on('HeapProfiler.addHeapSnapshotChunk',receive);
  try { await cdp.send('HeapProfiler.takeHeapSnapshot',{reportProgress:false}); }
  finally { cdp.off('HeapProfiler.addHeapSnapshotChunk',receive); }
  if(oversize)return {status:'snapshot_size_limit_exceeded',rawSnapshotPersisted:false};
  const snapshot=JSON.parse(chunks.join(''));chunks=[];
  const {nodes,edges,strings}=snapshot,meta=snapshot.snapshot.meta;
  const nf=meta.node_fields,ef=meta.edge_fields,nw=nf.length,ew=ef.length;
  const ntype=nf.indexOf('type'),nname=nf.indexOf('name'),nsize=nf.indexOf('self_size'),ncount=nf.indexOf('edge_count'),detached=nf.indexOf('detachedness');
  const etype=ef.indexOf('type'),ename=ef.indexOf('name_or_index'),eto=ef.indexOf('to_node');
  const ntypes=meta.node_types[ntype],etypes=meta.edge_types[etype];
  const starts=new Uint32Array(nodes.length/nw);let cursor=0;
  for(let node=0,index=0;node<nodes.length;node+=nw,index+=1){starts[index]=cursor;cursor+=nodes[node+ncount]*ew;}
  const outgoing=node=>{
    const result=[];const start=starts[node/nw];
    for(let edge=start;edge<start+nodes[node+ncount]*ew;edge+=ew){const type=etypes[edges[edge+etype]];result.push({type,name:type==='property'||type==='internal'?strings[edges[edge+ename]]:null,target:edges[edge+eto]});}
    return result;
  };
  const snapshots=[],classes={Array:0,Object:0,Map:0,WeakMap:0,Set:0,Promise:0,HTMLDivElement:0,HTMLCanvasElement:0,other:0};
  const detachednessOrdinals={zero:0,one:0,two:0,other:0};
  const referencedRestaurants=new Set();let totalReferenceElements=0;
  for(let node=0;node<nodes.length;node+=nw){
    if(detached>=0){const value=nodes[node+detached];detachednessOrdinals[value===0?'zero':value===1?'one':value===2?'two':'other']+=1;}
    if(ntypes[nodes[node+ntype]]!=='object')continue;
    const name=strings[nodes[node+nname]];classes[Object.hasOwn(classes,name)?name:'other']+=1;
    if(name!=='Object')continue;
    const fields=outgoing(node).filter(edge=>edge.type==='property');
    if(['references','keys','unique'].every(key=>fields.some(edge=>edge.name===key)))snapshots.push({node,fields});
  }
  const owned=new Set(),rowKeys=new Set();let referenceArrays=0,keyArrays=0;
  const arrayMetadata=(node,keys,references=false)=>{
    const members=new Set();
    owned.add(node);
    for(const edge of outgoing(node)){
      if(edge.type==='internal'&&edge.name==='elements'){
        owned.add(edge.target);
        for(const child of outgoing(edge.target))if(child.type==='element'){if(keys)rowKeys.add(child.target);if(references)members.add(child.target);}
      }else if(edge.type==='element'){if(keys)rowKeys.add(edge.target);if(references)members.add(edge.target);}
    }
    if(references){totalReferenceElements+=members.size;for(const target of members)referencedRestaurants.add(target);}
  };
  for(const snapshot of snapshots){
    owned.add(snapshot.node);
    for(const field of snapshot.fields){
      if(field.name==='references'){referenceArrays+=1;arrayMetadata(field.target,false,true);}
      if(field.name==='keys'){keyArrays+=1;arrayMetadata(field.target,true);}
    }
  }
  const verifiedRowKeys=new Set();
  for(const node of rowKeys){
    const fields=outgoing(node).filter(edge=>edge.type==='property');
    if(!['id','name','mergedIds'].every(key=>fields.some(edge=>edge.name===key)))continue;
    verifiedRowKeys.add(node);owned.add(node);
    const merged=fields.find(edge=>edge.name==='mergedIds');if(merged)arrayMetadata(merged.target,false);
  }
  return {status:'minimized',nodeCount:nodes.length/nw,edgeCount:edges.length/ew,classes,detachednessOrdinals,totalReferenceElements,uniqueReferencedRestaurantObjects:referencedRestaurants.size,snapshotShapeCount:snapshots.length,referenceArrays,keyArrays,verifiedRowKeyObjects:verifiedRowKeys.size,ownedStructuralBytes:[...owned].reduce((sum,node)=>sum+nodes[node+nsize],0),scope:'metadata matching references/keys/unique cache shape; shared restaurant data, strings and provider internals excluded',snapshotMayTriggerGC:true,rawSnapshotPersisted:false,rawStringValuesPersisted:false};
}

export function samplingStructure(profile) {
  const known=new Set(['dedupeRestaurants','selectionCacheKey','matchesSelectionCacheKey','buildPostSearchSwipeCandidates','orderRestaurantsForSelection','construct','JSON.parse','parse','stringify']);
  const rows=[];
  const visit=node=>{
    const frame=node.callFrame??{};let script='other-script';
    try{const value=new URL(frame.url).pathname.split('/').pop();if(/^[a-zA-Z0-9._-]{1,100}$/.test(value))script=value;}catch{}
    if(node.selfSize>0)rows.push({script,functionGroup:known.has(frame.functionName)?frame.functionName:/^[a-zA-Z_$]{1,3}$/.test(frame.functionName)?'minified':'other-function',line:frame.lineNumber??null,column:frame.columnNumber??null,sampledSelfBytes:node.selfSize});
    for(const child of node.children??[])visit(child);
  };
  visit(profile.head);
  return {status:'minimized',sampleCount:profile.samples?.length??null,totalSampledSelfBytes:rows.reduce((sum,row)=>sum+row.sampledSelfBytes,0),topAllocations:rows.sort((a,b)=>b.sampledSelfBytes-a.sampledSelfBytes).slice(0,30),originalUrlsPersisted:false,rawAllocationProfilePersisted:false};
}
