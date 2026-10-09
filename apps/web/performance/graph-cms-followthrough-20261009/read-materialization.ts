import { readLocalKnowledgeGraph } from '../../lib/admin/knowledge-graph-local.ts';
import { writeFileSync } from 'node:fs';
const page=await readLocalKnowledgeGraph(new URLSearchParams({limit:'100'}));
writeFileSync('performance/graph-cms-followthrough-20261009/reader-summary.json',JSON.stringify({revision:page.revision,totalNodes:page.totalNodes,totalEdges:page.totalEdges,coverage:page.coverage,captionFirstPass:page.nodes.filter(n=>n.label.includes('자막 1차 검토')).length},null,2));
console.log({nodes:page.totalNodes,edges:page.totalEdges,analyzed:page.coverage.analyzedCount});
