#!/usr/bin/env python3
"""Read-only real-corpus replay. Local measurements are not live evidence."""
import argparse
from contextlib import redirect_stdout
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import resource
import shutil
import subprocess
import sys
import tempfile
import time
import types

ROOT = Path(__file__).resolve().parents[2]
SCRIPT = ROOT / 'backend/restaurant-evaluation/scripts/12-transform.py'
BASELINE = 'e6c7c97cc6fb9c4ac2e45297e22c2541bd5ad0d4'
DATA = Path('/Users/twoimo/Documents/projects/tzudong/backend')


def load_transform(kind):
    name = 'transform_benchmark_' + kind
    if kind == 'baseline':
        source = subprocess.check_output(['git','show',BASELINE+':backend/restaurant-evaluation/scripts/12-transform.py'],cwd=ROOT,text=True)
        module = types.ModuleType(name); module.__file__ = str(SCRIPT)
        exec(compile(source,str(SCRIPT),'exec'),module.__dict__)
        return module
    spec = importlib.util.spec_from_file_location(name,SCRIPT)
    module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
    return module


def invoke(module, crawling, evaluation):
    previous = sys.argv
    sys.argv = [str(SCRIPT),'--channel','tzuyang','--crawling-path',str(crawling),'--evaluation-path',str(evaluation)]
    try:
        with redirect_stdout(io.StringIO()): module.main()
    finally: sys.argv = previous


def output_digest(path):
    rows = {row['trace_id']:row for row in (json.loads(line) for line in path.read_text().splitlines() if line.strip())}
    encoded = json.dumps(rows,sort_keys=True,ensure_ascii=False,separators=(',',':')).encode()
    return len(rows),hashlib.sha256(encoded).hexdigest()


def dataset_digest():
    digest = hashlib.sha256(); count = size = 0
    directories = [DATA/'restaurant-crawling/data/tzuyang/meta'] + [DATA/'restaurant-evaluation/data/tzuyang/evaluation'/name for name in ['rule_results','laaj_results','notSelection']]
    for directory in directories:
        for path in sorted(directory.glob('*.jsonl')):
            content = path.read_bytes(); digest.update(str(path.relative_to(DATA)).encode());digest.update(hashlib.sha256(content).digest())
            count += 1; size += len(content)
    return {'sha256':digest.hexdigest(),'files':count,'bytes':size}


def input_tree(path, *, delta=False):
    crawling, evaluation = path/'crawling', path/'evaluation'
    crawling.mkdir(parents=True); (evaluation/'evaluation').mkdir(parents=True)
    (crawling/'meta').symlink_to(DATA/'restaurant-crawling/data/tzuyang/meta',target_is_directory=True)
    for name in ['rule_results','laaj_results','notSelection']:
        source = DATA/'restaurant-evaluation/data/tzuyang/evaluation'/name
        target = evaluation/'evaluation'/name
        if delta and name == 'rule_results':
            target.mkdir()
            for index,item in enumerate(sorted(source.glob('*.jsonl'))):
                if index < 5:
                    value=json.loads(item.read_text().strip())
                    # Change evaluation content without changing the identity inputs.
                    value['evaluation_results']['category_validity_TF'] = [dict(row,eval_value=not row.get('eval_value',False)) for row in value['evaluation_results'].get('category_validity_TF',[])]
                    (target/item.name).write_text(json.dumps(value,ensure_ascii=False)+'\n')
                else: (target/item.name).symlink_to(item)
        else: target.symlink_to(source,target_is_directory=True)
    return crawling,evaluation


def main():
    parser=argparse.ArgumentParser();parser.add_argument('--worker',choices=['baseline','candidate']);parser.add_argument('--crawling',type=Path);parser.add_argument('--evaluation',type=Path);parser.add_argument('--output',type=Path)
    args=parser.parse_args()
    if args.worker:
        module=load_transform(args.worker)
        start_cpu=time.process_time();start=time.perf_counter();invoke(module,args.crawling,args.evaluation)
        elapsed=(time.perf_counter()-start)*1000;cpu=(time.process_time()-start_cpu)*1000
        records,digest=output_digest(args.evaluation/'evaluation/transforms.jsonl')
        print(json.dumps({'wallMs':elapsed,'cpuMs':cpu,'peakRssMiB':resource.getrusage(resource.RUSAGE_SELF).ru_maxrss/1048576,'records':records,'outputSha256':digest}))
        return
    if args.output is None:raise SystemExit('--output required')
    args.output.parent.mkdir(parents=True,exist_ok=True)
    initial=dataset_digest();source_hash=hashlib.sha256(SCRIPT.read_bytes()).hexdigest()
    observations=[]
    with tempfile.TemporaryDirectory(prefix='tzudong-transform-replay-') as temporary:
        work=Path(temporary)
        inputs,evaluation=input_tree(work/'source')
        invoke(load_transform('baseline'),inputs,evaluation)
        invoke(load_transform('candidate'),inputs,evaluation)
        seed=evaluation/'evaluation/transforms.jsonl';ledger=evaluation/'evaluation/.receipts/transform.json'
        seed_hash=output_digest(seed)
        delta_inputs,delta_evaluation=input_tree(work/'delta',delta=True)
        invoke(load_transform('baseline'),delta_inputs,delta_evaluation)
        delta_hash=output_digest(delta_evaluation/'evaluation/transforms.jsonl')
        for scenario in ['cold','unchanged','delta-five']:
            for repeat in range(7):
                for implementation in (['baseline','candidate'] if repeat%2==0 else ['candidate','baseline']):
                    target=work/(scenario+'-'+str(repeat)+'-'+implementation)
                    (target/'evaluation').mkdir(parents=True)
                    input_eval=delta_evaluation if scenario=='delta-five' else evaluation
                    for directory in ['rule_results','laaj_results','notSelection']:
                        (target/'evaluation'/directory).symlink_to(input_eval/'evaluation'/directory,target_is_directory=True)
                    if scenario=='unchanged' or scenario=='delta-five' and implementation=='candidate':
                        shutil.copy2(seed,target/'evaluation/transforms.jsonl')
                        if implementation=='candidate':
                            (target/'evaluation/.receipts').mkdir();shutil.copy2(ledger,target/'evaluation/.receipts/transform.json')
                    command=[sys.executable,str(Path(__file__)), '--worker',implementation,'--crawling',str(delta_inputs if scenario=='delta-five' else inputs),'--evaluation',str(target)]
                    result=subprocess.run(command,cwd=ROOT,capture_output=True,text=True,timeout=120)
                    if result.returncode:raise RuntimeError('TRANSFORM_BENCHMARK_FAILED')
                    measurement=json.loads(result.stdout.strip().splitlines()[-1])
                    expected=delta_hash if scenario=='delta-five' else seed_hash
                    if (measurement['records'],measurement['outputSha256'])!=expected:raise RuntimeError('TRANSFORM_EQUIVALENCE_FAILED')
                    observations.append({'scenario':scenario,'repeat':repeat,'implementation':implementation,**measurement})
                print(json.dumps({'scenario':scenario,'pairedSamples':repeat+1,'equivalent':True}),flush=True)
    final=dataset_digest()
    if initial!=final or source_hash!=hashlib.sha256(SCRIPT.read_bytes()).hexdigest():raise RuntimeError('BENCHMARK_INPUT_CHANGED')
    args.output.write_text(json.dumps({'kind':'local_real_corpus_replay','liveEvidenceEligible':False,'baselineSha':BASELINE,'candidateSourceSha256':source_hash,'dataset':initial,'sourcePreserved':True,'observations':observations},indent=2)+'\n')


if __name__=='__main__':
    main()
