#!/usr/bin/env python3
"""Readonly paired metadata replay: integrity checks are included in the candidate."""
import ast
import hashlib
import json
import math
from pathlib import Path
import random
import resource
import subprocess
import sys
import time

ROOT = Path(__file__).resolve().parents[2]
DATA = Path('/Users/twoimo/Documents/projects/tzudong/backend/restaurant-crawling/data/tzuyang/meta')
BASELINE = 'e6c7c97cc6fb9c4ac2e45297e22c2541bd5ad0d4'
sys.path.insert(0, str(ROOT / 'backend'))
from utils.metadata_checkpoint import latest_metadata

def original_reader():
    source = subprocess.check_output(['git','show',BASELINE+':backend/restaurant-crawling/scripts/02-collect-meta.py'],cwd=ROOT,text=True)
    node = next(node for node in ast.parse(source).body if isinstance(node,ast.FunctionDef) and node.name=='get_latest_meta')
    scope = {'Path':Path,'Dict':dict,'Optional':__import__('typing').Optional,'json':json}
    exec(compile(ast.Module(body=[node],type_ignores=[]),'<baseline-metadata-reader>','exec'),scope)
    return scope['get_latest_meta']

def source_digest():
    digest=hashlib.sha256(); size=0; paths=sorted(DATA.glob('*.jsonl'))
    for path in paths:
        content=path.read_bytes(); size+=len(content)
        digest.update(path.name.encode());digest.update(hashlib.sha256(content).digest())
    return {'files':len(paths),'bytes':size,'sha256':digest.hexdigest()}

def percentile(values,p):
    return sorted(values)[max(0,math.ceil(len(values)*p)-1)]

if len(sys.argv)>1 and sys.argv[1]=='--worker':
    kind=sys.argv[2]; baseline=original_reader(); paths=sorted(DATA.glob('*.jsonl'))
    start=time.perf_counter();cpu=time.process_time()
    rows={path.stem:(baseline(DATA.parent,path.stem) if kind=='baseline' else latest_metadata(path,path.stem)) for path in paths}
    result={'wallMs':(time.perf_counter()-start)*1000,'cpuMs':(time.process_time()-cpu)*1000,
            'peakRssMiB':resource.getrusage(resource.RUSAGE_SELF).ru_maxrss/1048576,
            'records':sum(isinstance(row,dict) for row in rows.values()),
            'outputSha256':hashlib.sha256(json.dumps(rows,ensure_ascii=False,sort_keys=True).encode()).hexdigest()}
    print(json.dumps(result))
else:
    initial=source_digest();pairs=[]
    for pair in range(7):
        result={}
        for kind in (['baseline','candidate'] if pair%2==0 else ['candidate','baseline']):
            result[kind]=json.loads(subprocess.check_output([sys.executable,__file__,'--worker',kind],text=True,cwd=ROOT))
        assert result['baseline']['outputSha256']==result['candidate']['outputSha256']
        pairs.append(result)
    assert source_digest()==initial
    rng=random.Random(20261003);summary={}
    for metric in ['wallMs','cpuMs','peakRssMiB']:
        summary[metric]={}
        for label,p in [('p50',.5),('p75',.75),('p95',.95)]:
            before=percentile([x['baseline'][metric] for x in pairs],p);after=percentile([x['candidate'][metric] for x in pairs],p)
            changes=[]
            for _ in range(10000):
                sample=[pairs[rng.randrange(7)] for _ in range(7)]
                b=percentile([x['baseline'][metric] for x in sample],p);a=percentile([x['candidate'][metric] for x in sample],p)
                changes.append((a-b)/b*100)
            summary[metric][label]={'before':before,'after':after,'absoluteChange':after-before,'changePercent':(after-before)/before*100,
                                   'change95CI':[percentile(changes,.025),percentile(changes,.975)],'samplePairs':7}
    out=ROOT/'apps/web/performance/pipeline-20261002/metadata-reader-v2-raw.json'
    out.write_text(json.dumps({'kind':'readonly-metadata-reader-replay','baseline':BASELINE,'dataset':initial,'sourcePreserved':True,
        'actualProviderCalls':0,'pairs':pairs,'summary':summary,'confidenceMethod':'10000 paired percentile bootstrap; seed 20261003',
        'environment':{'python':sys.version,'platform':sys.platform},'limitations':['Reader comparison includes new integrity checks; not a whole collector timing.',
        'Date-only baseline cache skips reads without validating outputs; that shortcut is not treated as a valid equivalent baseline.','No network or provider cost comparison.']},indent=2)+'\n')
    print(json.dumps({'records':pairs[0]['candidate']['records'],'wallP75':summary['wallMs']['p75'],'sourcePreserved':True}))
