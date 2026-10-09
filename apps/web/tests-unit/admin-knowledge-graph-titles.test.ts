import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { readLocalKnowledgeGraph } from '../lib/admin/knowledge-graph-local';
import { expect, test } from 'bun:test';
import { isKnowledgeNode, isKnowledgeGraphPage, type KnowledgeSnapshot } from '../types/knowledge-graph';
import { queryKnowledgeGraph } from '../lib/admin/knowledge-graph-query';
import legacy from './fixtures/knowledge-graph-v1-20261004.json';
const node = { id: 'caption-node', kind: 'video' as const, label: 'ABCDEFGHIJK · 자막 1차 검토', summary: '독립 시각·음성 미검토', evidence: [], displayTitle: '강릉 원성식당 공개 영상 제목', displayStage: 'caption-first-pass' as const };
test('title-only search finds exact sourced title while preserving identity and analysis coverage', () => {
  const fixture: KnowledgeSnapshot = { ...(legacy as KnowledgeSnapshot), nodes: [node], edges: [] };
  const page = queryKnowledgeGraph(fixture, new URLSearchParams({q: '강릉', node: node.id}));
  expect(isKnowledgeGraphPage(page)).toBe(true); expect(page.nodes).toEqual([node]); expect(page.selected?.label).toBe(node.label); expect(page.coverage.analyzedCount).toBe(0);
  expect(queryKnowledgeGraph(fixture, new URLSearchParams({q:'ABCDEFGHIJK'})).nodes).toHaveLength(1);
});
test('legacy nodes stay valid; incomplete, foreign, unsafe, and fabricated stage contracts fail closed', () => {
  const old = { id: node.id, kind: node.kind, label: node.label, summary: node.summary, evidence: node.evidence };
  expect(isKnowledgeNode(old)).toBe(true); expect(isKnowledgeNode(node)).toBe(true);
  for (const value of [{...old,displayTitle:node.displayTitle},{...old,displayStage:node.displayStage},{...node,kind:'claim'},{...node,displayTitle:''},{...node,displayTitle:'x'.repeat(513)},{...node,displayTitle:'title\r\nheader'},{...node,displayTitle:'title\u0085line'},{...node,displayStage:'complete'}]) expect(isKnowledgeNode(value)).toBe(false);
  expect(isKnowledgeNode({...node,displayTitle:'😀'.repeat(512)})).toBe(true);
});

test('strict file reader preserves optional title/stage and title-only search from Python shards', async () => {
 const directory=mkdtempSync(join(tmpdir(),'tzudong-title-shard-'));
 try {
  execFileSync('python3',['-B','-c',`
import sys
from pathlib import Path
from backend.knowledge_graph.tests.test_graph_shards import synthetic_graph
from backend.knowledge_graph.graph_shards import build_graph_shards,write_graph_shards
graph=synthetic_graph(1,0)
graph['nodes'][0].update(kind='video',label='ABCDEFGHIJK',summary='unverified',displayTitle='강릉 원성식당',displayStage='caption-first-pass')
write_graph_shards(build_graph_shards(graph),Path(sys.argv[1])/'tzudong.json')
`,directory],{cwd:resolve('../..')});
  const page=await readLocalKnowledgeGraph(new URLSearchParams({q:'강릉'}),directory);
  expect(page.nodes).toHaveLength(1);expect(page.nodes[0]?.displayTitle).toBe('강릉 원성식당');expect(page.nodes[0]?.displayStage).toBe('caption-first-pass');
 } finally {rmSync(directory,{recursive:true,force:true});}
});
