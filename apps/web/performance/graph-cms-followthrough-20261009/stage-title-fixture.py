"""Build a disposable fixture from current export plus reviewed title plan.
Never changes shared vault/canonical export or copies raw caption content.
"""
from pathlib import Path
import hashlib,json,sys
sys.path.insert(0,str(Path(__file__).resolve().parents[4]))
from backend.knowledge_graph import caption_title_enrichment as title
from backend.knowledge_graph.graph_shards import build_graph_shards,write_graph_shards
web=Path('apps/web'); plan_path=Path(sys.argv[1]); destination=Path(sys.argv[2])
plan=json.loads(plan_path.read_text());title.validate_plan(plan)
manifest=json.loads((web/'data/knowledge-graph/tzudong.json').read_text())
root=web/'data/knowledge-graph'
def items(shards):
 result=[]
 for item in shards:
  raw=(root/item['path']).read_bytes()
  if hashlib.sha256(raw).hexdigest()!=item['sha256']:raise ValueError('fixture_source_changed')
  result.extend(json.loads(raw)['items'])
 return result
nodes=items(manifest['nodeShards']); edges=items(manifest['edgeShards'])
for target in plan['targets']:
 node=next(n for n in nodes if n['id']==target['id'])
 fields=title.title_fields(target['body'],target['videoId']);node.update(fields)
snapshot={'schemaVersion':1,'scope':'tzudong','revision':hashlib.sha256(json.dumps(nodes,sort_keys=True,ensure_ascii=False).encode()).hexdigest(),'generatedAt':manifest['generatedAt'],'coverage':manifest['coverage'],'diagnostics':manifest['diagnostics'],'nodes':nodes,'edges':edges}
destination.mkdir(mode=0o700)
write_graph_shards(build_graph_shards(snapshot),destination/'tzudong.json')
print(json.dumps({'nodes':len(nodes),'edges':len(edges),'titles':sum('displayTitle' in n for n in nodes),'analyzed':snapshot['coverage']['analyzedCount'],'canonicalWrites':0,'vaultWrites':0}))
