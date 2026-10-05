"""Run a bounded unittest target; retain counts and fixed error locations, not logs."""
import contextlib, importlib.util, io, json, os, sys, traceback, unittest
from pathlib import Path
ROOT=Path('/Users/twoimo/.codex/worktrees/python-dependency-quality-20261004/tzudong')
sys.path.insert(0,str(ROOT)); os.chdir(ROOT)
class Result(unittest.TestResult):
 def __init__(self): super().__init__(); self.issues=[]
 def _exc_info_to_string(self,err,test): return type(err[1]).__name__
 def addError(self,test,err): self.record(test,err,'error');super().addError(test,err)
 def addFailure(self,test,err): self.record(test,err,'failure');super().addFailure(test,err)
 def record(self,test,err,kind):
  frames=[{'file':f.filename,'line':f.lineno,'function':f.name} for f in traceback.extract_tb(err[2])[-5:]]
  self.issues.append({'test':test.id(),'kind':kind,'type':err[0].__name__,'frames':frames})
result=Result(); target=sys.argv[1]
with contextlib.redirect_stdout(io.StringIO()),contextlib.redirect_stderr(io.StringIO()):
 if '.py' in target:
  path,_,cls=target.partition('::');p=Path(path);p=p if p.is_absolute() else ROOT/p
  spec=importlib.util.spec_from_file_location(p.stem,p);m=importlib.util.module_from_spec(spec);sys.modules[p.stem]=m
  try:
   spec.loader.exec_module(m)
   suite=unittest.defaultTestLoader.loadTestsFromName(cls,m) if cls else unittest.defaultTestLoader.loadTestsFromModule(m)
  except Exception:
   suite=unittest.TestSuite();result.issues.append({'test':target,'kind':'import','type':sys.exc_info()[0].__name__,'frames':[{'file':f.filename,'line':f.lineno,'function':f.name} for f in traceback.extract_tb(sys.exc_info()[2])[-5:]]})
 else: suite=unittest.defaultTestLoader.loadTestsFromName(target)
 suite.run(result)
data={'target':target,'tests_run':result.testsRun,'failures':len(result.failures),'errors':len(result.errors),'skips':[{'test':t.id(),'reason':why} for t,why in result.skipped],'issues':result.issues,'successful':result.wasSuccessful() and not result.issues}
print(json.dumps(data));sys.exit(0 if data['successful'] else 1)
