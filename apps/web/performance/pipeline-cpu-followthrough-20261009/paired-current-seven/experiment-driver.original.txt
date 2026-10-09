from pathlib import Path
import importlib.util,sys,json,hashlib,subprocess
repo=Path(__file__).resolve().parents[4]
base=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location('replay',repo/'backend/bin/benchmark_media_orchestration.py')
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
owned={'backend/utils/stage_cache.py','backend/restaurant-evaluation/scripts/11-laaj-evaluation.sh'}
after=base/'after-source';after.mkdir(exist_ok=False)
for relative in m.ASSETS:
 data=(repo/relative).read_bytes() if relative in owned else (base/'before-source'/relative).read_bytes()
 p=after/relative;p.parent.mkdir(parents=True,exist_ok=True);p.write_bytes(data)
head=json.loads((base/'before-source-binding.json').read_text())['headReference']
m.BASELINE=head
m.ROOT=after
output=base/'paired-current-seven'
def freeze(work,output):
 hashes={}
 for implementation in ['baseline','candidate']:
  hashes[implementation]={}
  source=base/'before-source' if implementation=='baseline' else after
  for relative in m.ASSETS:
   data=(source/relative).read_bytes()
   frozen=output/'frozen-source'/implementation/relative;frozen.parent.mkdir(parents=True,exist_ok=True);frozen.write_bytes(data)
   hashes[implementation][relative]=m.sha(data)
   target=work/implementation/relative;target.parent.mkdir(parents=True,exist_ok=True);target.write_bytes(data)
  (work/implementation/'backend/node_modules').symlink_to(m.ORIGINAL/'backend/node_modules',target_is_directory=True)
  (work/implementation/'backend/bin/run_agy_prompt.py').write_text('raise SystemExit(1)\n')
 return hashes
m.freeze=freeze
sys.argv=['benchmark_media_orchestration.py','--pairs','7','--output',str(output)]
m.main()
config=json.loads((output/'configuration.json').read_text())
config['comparisonScope']='Frozen current stage implementation before versus two owned stage optimizations; all other components use identical one-time snapshot bytes, including other-agent-owned Gemini components. Git heads are references, not entire-checkout identity.'
config['sourceMutationScope']='Frozen after-source tree only; concurrent original worktree edits are outside this comparison.'
config['providerPacingSymmetric']=True
config['changedSourcePaths']=sorted(owned)
config['driverSha256']=m.sha(Path(__file__).read_bytes())
m.write_json(output/'configuration.json',config)
(output/'experiment-driver.original.txt').write_bytes(Path(__file__).read_bytes())
paths=[p for p in sorted(output.rglob('*')) if p.is_file() and p.name not in ['artifact-map.json','artifact-map.json.sha256']]
m.write_json(output/'artifact-map.json',{str(p.relative_to(output)):m.sha(p.read_bytes()) for p in paths})
(output/'artifact-map.json.sha256').write_text(m.sha((output/'artifact-map.json').read_bytes())+'\n')
print(json.dumps({'frozenCurrentPairComplete':True,'pairs':7,'actualProviderCalls':0,'sourceChanges':sorted(owned)}),flush=True)
