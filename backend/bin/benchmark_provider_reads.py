#!/usr/bin/env python3
"""Controlled provider-read replay, never a claim about live provider latency."""
from contextlib import redirect_stdout
import importlib.util
import io
import json
from pathlib import Path
import subprocess
import sys
import time
import types

ROOT=Path(__file__).resolve().parents[2]
SCRIPT=ROOT/'backend/restaurant-evaluation/scripts/10-rule-evaluation.py'
sys.path.insert(0,str(ROOT));sys.path.insert(0,str(ROOT/'backend'))

def load(kind):
    if kind=='baseline':
        source=subprocess.check_output(['git','show','e6c7c97c:backend/restaurant-evaluation/scripts/10-rule-evaluation.py'],cwd=ROOT,text=True)
        module=types.ModuleType('provider_baseline');module.__file__=str(SCRIPT)
        exec(compile(source,str(SCRIPT),'exec'),module.__dict__);return module
    spec=importlib.util.spec_from_file_location('provider_candidate',SCRIPT)
    module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module);return module

class Response:
    content=b'fixture'
    def raise_for_status(self):pass
    def json(self):return {'items':[{'title':'fixture','address':'fixture','roadAddress':'fixture','mapx':'1270000000','mapy':'370000000'}]}

observations=[]
for repeat in range(7):
    outputs={}
    for kind in (['baseline','candidate'] if repeat%2==0 else ['candidate','baseline']):
        module=load(kind);calls=[0]
        def read(*args,**kwargs):
            calls[0]+=1;time.sleep(.001);return Response()
        if kind=='baseline':module.requests.get=read
        else:module.provider_get=read
        start=time.perf_counter()
        with redirect_stdout(io.StringIO()):
            values=[module.naver_local_search_one('fixture-'+str(index%25),5) for index in range(500)]
        elapsed=(time.perf_counter()-start)*1000
        outputs[kind]=values
        observations.append({'repeat':repeat,'implementation':kind,'wallMs':elapsed,'requestedReads':500,'providerReadAttempts':calls[0],'responseDelayMs':1})
    if outputs['baseline']!=outputs['candidate']:raise SystemExit('PROVIDER_REPLAY_EQUIVALENCE_FAILED')
directory=ROOT/'apps/web/performance/pipeline-20261002';directory.mkdir(parents=True,exist_ok=True)
(directory/'provider-read-raw.json').write_text(json.dumps({'kind':'controlled_provider_response_replay','liveEvidenceEligible':False,'actualNetworkRequests':0,'samplesPerImplementation':7,'outputsEquivalent':True,'observations':observations},indent=2)+'\n')
print(json.dumps({'status':'passed','samplesPerImplementation':7,'requestedReads':500,'baselineAttempts':500,'candidateAttempts':25,'actualNetworkRequests':0}))
