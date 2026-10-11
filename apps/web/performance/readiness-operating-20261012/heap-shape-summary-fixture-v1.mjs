import assert from 'node:assert/strict';
import {summarizeHeapShapes} from '../swipe-heap-shapes-20261012/heap-shape-summary-v1.mjs';
const snapshot = {
  snapshot: {meta: {
    node_fields: ['type','name','self_size','edge_count'],
    edge_fields: ['type','name_or_index','to_node'],
    node_types: [['object','array','string']],
    edge_types: [['property','internal']],
  }},
  strings: ['Object','Array','private-value-never-emit','id','lat','lng','mergedIds','name','elements','__proto__'],
  nodes: [0,0,56,6,0,1,32,1,1,8,24,0,2,2,100,0],
  edges: [0,3,12,0,4,12,0,5,12,0,6,4,0,7,12,0,9,12,1,8,8],
};
const result = summarizeHeapShapes(snapshot);
assert.equal(result.shapes.selectionKey.objects,1);
assert.equal(result.shapes.selectionKey.directArrayObjects,1);
assert.equal(result.shapes.selectionKey.directArrayBackingBytes,24);
assert.equal(result.shapes.listSnapshot.objects,0);
assert.equal(JSON.stringify(result).includes('private-value-never-emit'),false);
assert.throws(() => summarizeHeapShapes({snapshot:{meta:{node_fields:[],edge_fields:[],node_types:[],edge_types:[]}}}), /SNAPSHOT_SCHEMA_DENIED/);
console.log(JSON.stringify({privacyFixture:'passed',arrayBytes:'passed',schemaDenial:'passed'}));
