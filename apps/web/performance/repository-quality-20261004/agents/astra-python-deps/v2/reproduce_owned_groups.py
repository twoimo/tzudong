"""Bounded diagnostic: observe and signal only groups spawned by this run."""
import errno,json,os,signal,subprocess,sys,tempfile,time
from pathlib import Path
from unittest.mock import patch
ROOT=Path('/Users/twoimo/.codex/worktrees/python-dependency-quality-20261004/tzudong')
sys.path.insert(0,str(ROOT))
from backend.pipeline import nodes
from backend.pipeline.state import StepName
OUT=Path('/Users/twoimo/.codex/worktrees/marker-memory-lifetime-20261001/tzudong/apps/web/performance/repository-quality-20261004/agents/astra-python-deps/v2')
RUN=ROOT.parent/'runtime/v2'
def no_network(event,args):
 if event in {'socket.connect','socket.bind','socket.getaddrinfo'}:raise RuntimeError('NETWORK_DISABLED')
sys.addaudithook(no_network)
output_name=sys.argv[1] if len(sys.argv)>1 else 'candidate-owned-reproduction-repeat.json'
if Path(output_name).name!=output_name or not output_name.endswith('.json'):raise SystemExit('INVALID_OUTPUT_NAME')
output_path=OUT/output_name
if output_path.exists():raise SystemExit('OUTPUT_ALREADY_EXISTS')
REAL_KILLPG=os.killpg
results=[]
def case(mode):
 events=[];owned={};supervisors=[];group=None;seen_term=False
 original_start=nodes._start_process_tree_supervisor
 original_terminate=nodes._terminate_process_tree
 original_wait=nodes._wait_for_posix_process_group
 original_helper=nodes._run_posix_tree_helper
 with tempfile.TemporaryDirectory(prefix='owned-tree-',dir=RUN) as tmp:
  directory=Path(tmp)
  identity="import json,os,time; from pathlib import Path\nroot=Path("+repr(tmp)+")\n"
  identity+="def register(role):\n (root/(role+'.json')).write_text(json.dumps({'pid':os.getpid(),'ppid':os.getppid(),'pgid':os.getpgrp(),'sid':os.getsid(0)}))\n"
  grandchild=identity+"register('grandchild')\nwhile True:\n with (root/'heartbeat').open('a') as f:f.write('x')\n time.sleep(0.02)"
  child=identity+"import subprocess,sys\nregister('child')\nsubprocess.Popen([sys.executable,'-c',"+repr(grandchild)+"])\nwhile True:time.sleep(0.05)"
  parent=identity+"import subprocess,sys\nregister('parent')\nsubprocess.Popen([sys.executable,'-c',"+repr(child)+"])\nwhile True:time.sleep(0.05)"
  def targets():
   for role in ['parent','child','grandchild']:
    path=directory/(role+'.json')
    if path.exists():
     try:record=json.loads(path.read_text())
     except json.JSONDecodeError:continue
     assert record['pgid']==record['sid']==group
     assert record['pid']>1 and record['pid']!=os.getpid()
     owned[role]=record
   return owned
  def snapshot(phase):
   targets();pids=[r['pid'] for r in owned.values()]
   if not pids:return
   try:
    p=subprocess.run(['/bin/ps','-p',','.join(map(str,pids)),'-o','pid=,ppid=,pgid=,stat='],capture_output=True,text=True,timeout=3)
    lines=p.stdout.splitlines()
   except OSError as exc:
    events.append({'phase':'OWNED_PID_OBSERVATION_UNAVAILABLE','errno':errno.errorcode.get(exc.errno,'OTHER')});lines=[]
   states=[]
   for line in lines:
    parts=line.split()
    if len(parts)!=4:continue
    pid,ppid,pgid=map(int,parts[:3]);assert pid in pids
    states.append({'pid':pid,'ppid':ppid,'pgid':pgid,'state':parts[3][0]})
   events.append({'phase':phase,'known_targets':len(pids),'states':states,'cached_returncode':None if not supervisors else supervisors[0].process.returncode})
  def start(process):
   nonlocal group
   group=process.pid
   assert group!=os.getpgrp() and os.getpgid(group)==group and os.getsid(group)==group
   result=original_start(process);assert result is not None
   supervisors.append(result);return result
  def terminate(supervisor):
   deadline=time.monotonic()+3
   while len(targets())<3 or not (directory/'heartbeat').exists():
    if time.monotonic()>=deadline:raise AssertionError('FIXTURE_READY_TIMEOUT')
    time.sleep(0.01)
   snapshot('BEFORE_TERMINATE')
   result=original_terminate(supervisor)
   snapshot('AFTER_TERMINATE')
   events.append({'phase':'TERMINATE_RESULT','clean':result})
   return result
  def killpg(pgid,sig):
   nonlocal seen_term
   assert pgid==group and pgid!=os.getpgrp()
   if sig==signal.SIGTERM and (mode=='TERM_HELPER_FAIL' or (mode=='FIRST_TERM_FAIL' and not seen_term)):
    seen_term=True;events.append({'phase':'MOCK_SIGNAL_FAILURE','signal':'TERM'});raise OSError('fixture_term_failure')
   try:result=REAL_KILLPG(pgid,sig)
   except OSError as exc:
    if sig!=0:events.append({'phase':'SIGNAL_OS_ERROR','signal':signal.Signals(sig).name,'errno':errno.errorcode.get(exc.errno,'OTHER')})
    raise
   if sig!=0:events.append({'phase':'SIGNAL_SENT','signal':signal.Signals(sig).name})
   return result
  def helper(pgid,sig):
   assert pgid==group
   if mode=='TERM_HELPER_FAIL':events.append({'phase':'MOCK_HELPER_FAILURE','signal':signal.Signals(sig).name});return False
   result=original_helper(pgid,sig);events.append({'phase':'HELPER_RESULT','signal':signal.Signals(sig).name,'success':result});return result
  def wait(pgid,deadline,**kwargs):
   assert pgid==group;snapshot('GROUP_WAIT_BEGIN');result=original_wait(pgid,deadline,**kwargs);snapshot('GROUP_WAIT_END');events.append({'phase':'GROUP_WAIT_RESULT','empty':result});return result
  begin=time.monotonic()
  try:
   with patch.object(nodes,'_start_process_tree_supervisor',side_effect=start),patch.object(nodes,'_terminate_process_tree',side_effect=terminate),patch.object(nodes,'_wait_for_posix_process_group',side_effect=wait),patch.object(nodes.os,'killpg',side_effect=killpg),patch.object(nodes,'_run_posix_tree_helper',side_effect=helper):
    result=nodes.run_command(StepName.GEMINI.value,[nodes._python_cmd(),'-c',parent],timeout=0.1)
   snapshot('AFTER_RUN')
   size=(directory/'heartbeat').stat().st_size;time.sleep(0.15);stable=(directory/'heartbeat').stat().st_size==size
   summary={'mode':mode,'reason_code':result.reason_code,'returncode':result.returncode,'seconds':round(time.monotonic()-begin,3),'owned_targets':owned,'events':events,'heartbeat_stopped':stable}
  finally:
   # Never enumerate/signal unrelated targets. Reap the exact Popen this run owns.
   for supervisor in supervisors:
    known_live=False
    for r in owned.values():
     try:
      if os.getpgid(r['pid'])==group and os.getsid(r['pid'])==group:known_live=True
     except ProcessLookupError:pass
    if known_live:
     try:REAL_KILLPG(group,signal.SIGKILL)
     except ProcessLookupError:pass
    supervisor.process.wait(timeout=5)
  summary['group_empty_after_owned_parent_reap']=nodes._posix_process_group_is_empty(group)
  snapshot('AFTER_FINAL_REAP')
  return summary
for mode in ['NORMAL_TERM','FIRST_TERM_FAIL','TERM_HELPER_FAIL']:
 try:result=case(mode)
 except Exception as exc:result={'mode':mode,'diagnostic_error_enum':type(exc).__name__}
 results.append(result);print(json.dumps(result),flush=True)
output_path.write_text(json.dumps({'network':'socket audit guard; controlled fixture-only children; sandbox status supplied by launcher','observation':'Exact registered fixture PIDs only; no command lines/environment/process-wide enumeration.','cases':results},indent=2)+'\n')
