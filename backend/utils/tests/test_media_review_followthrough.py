"""Offline concrete regressions for cache outcomes, worker IO, health and recipe."""
import json,os,io,re,shlex,shutil,subprocess,tempfile,unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch
from contextlib import contextmanager,redirect_stdout
from backend.pipeline_control.media_cache import owned_media_cache
from backend.pipeline_control.worker import process_one
from backend.pipeline_control.store import MemoryStore
from backend.bin import run_parallel_laaj as laaj
from backend.utils.stage_cache import fingerprint, complete
ROOT=Path(__file__).resolve().parents[3]

class ReviewTests(unittest.TestCase):
 def test_outcomes_purge_only_terminal_owned_cache(self):
  with tempfile.TemporaryDirectory() as d,patch.dict(os.environ,{},clear=True):
   root=Path(d)
   for outcome in ['Paused','Failed','Cancelled','Succeeded']:
    with owned_media_cache(outcome,enabled=True,root=root) as finish:
     cache=Path(os.environ['VIDEO_CACHE_DIR']);(cache/'video').write_bytes(b'owned');finish(outcome)
    self.assertEqual(cache.exists(),outcome=='Paused')
   user=root/'user';user.mkdir();(user/'keep').write_bytes(b'user')
   with patch.dict(os.environ,{'VIDEO_CACHE_DIR':str(user)}):
    with owned_media_cache('Configured',enabled=True,root=root) as finish:finish('Failed')
   self.assertEqual((user/'keep').read_bytes(),b'user')
 def test_setup_io_error_settles_claim_and_writes_fixed_manifest(self):
  store=MemoryStore(clock=lambda:1000.0);run,_=store.create_run(target='tzuyang',profile='lite_gha',idempotency_key='io-failure',payload={'dryRun':False},actor='qa',request_id='req',dry_run=False)
  @contextmanager
  def denied(*args,**kwargs):
   raise PermissionError('private diagnostic not for output')
   yield
  with tempfile.TemporaryDirectory() as d,patch.dict(os.environ,{'TZUDONG_DATA_SINK':'artifact_only','TZUDONG_EXECUTION_MODE':'live','TZUDONG_COMPUTE_PROFILE':'lite_gha'}),patch('backend.pipeline_control.worker.owned_media_cache',denied),redirect_stdout(io.StringIO()) as out:
   path=Path(d)/'manifest.json';result=process_one(store,live=True,runner=lambda argv:0,manifest_path=path)
   self.assertEqual(result,'Failed');self.assertEqual(store.get(run.id).status,'Failed');self.assertEqual(store.get(run.id).error_code,'worker_io_failed');self.assertTrue(path.exists());self.assertNotIn('private diagnostic',path.read_text()+out.getvalue())
 def test_real_cache_setup_mkdir_and_owner_write_io_failures(self):
  for phase in ['mkdir','owner_write']:
   with self.subTest(phase=phase),tempfile.TemporaryDirectory() as d,patch.dict(os.environ,{'TZUDONG_DATA_SINK':'artifact_only','TZUDONG_EXECUTION_MODE':'live','TZUDONG_COMPUTE_PROFILE':'lite_gha'},clear=True):
    root=Path(d);cache_root=root/'owned-cache';store=MemoryStore(clock=lambda:1000.0);run,_=store.create_run(target='tzuyang',profile='lite_gha',idempotency_key=phase,payload={'dryRun':False},actor='qa',request_id='req',dry_run=False)
    real_mkdir=Path.mkdir
    def mkdir(p,*args,**kwargs):
     if phase=='mkdir' and p==cache_root:raise PermissionError('private mkdir detail')
     return real_mkdir(p,*args,**kwargs)
    from backend.pipeline_control import media_cache
    def context(*args,**kwargs):return media_cache.owned_media_cache(*args,**kwargs,root=cache_root)
    with patch('backend.pipeline_control.worker.owned_media_cache',context),patch.object(Path,'mkdir',mkdir),patch('backend.pipeline_control.media_cache.atomic_write',side_effect=PermissionError('private owner detail')) if phase=='owner_write' else patch.object(Path,'mkdir',mkdir):
     path=root/'manifest.json';self.assertEqual(process_one(store,live=True,runner=lambda argv:0,manifest_path=path),'Failed')
    self.assertEqual(store.get(run.id).status,'Failed');self.assertEqual(store.get(run.id).error_code,'worker_io_failed');self.assertNotIn('private',path.read_text());self.assertNotIn('PIPELINE_OWNED_VIDEO_CACHE_RUN_ID',os.environ)
 def test_real_env_inspection_io_failure_is_fixed(self):
  from backend.pipeline_control import media_cache
  env_file=Path(media_cache.__file__).resolve().parents[1]/'.env';real_is_file=Path.is_file;real_read=Path.read_text
  def exists(p):return True if p==env_file else real_is_file(p)
  def read(p,*args,**kwargs):
   if p==env_file:raise PermissionError('private env detail')
   return real_read(p,*args,**kwargs)
  with tempfile.TemporaryDirectory() as d,patch.dict(os.environ,{'TZUDONG_DATA_SINK':'artifact_only','TZUDONG_EXECUTION_MODE':'live','TZUDONG_COMPUTE_PROFILE':'lite_gha'},clear=True),patch.object(Path,'is_file',exists),patch.object(Path,'read_text',read):
   store=MemoryStore(clock=lambda:1000.0);run,_=store.create_run(target='tzuyang',profile='lite_gha',idempotency_key='env_io',payload={'dryRun':False},actor='qa',request_id='req',dry_run=False)
   path=Path(d)/'manifest.json';self.assertEqual(process_one(store,live=True,runner=lambda argv:0,manifest_path=path),'Failed');self.assertEqual(store.get(run.id).error_code,'worker_io_failed');self.assertNotIn('private env',path.read_text())
 def test_real_child_batch_health_success_once_and_no_restart_cache(self):
  with tempfile.TemporaryDirectory() as d:
   root=Path(d);log=root/'commands';script=root/'worker.sh'
   script.write_text('''if [ "$LAAJ_SKIP_HEALTH_CHECK" != 1 ]; then
 printf 'health\\n' >> "$TEST_HEALTH_LOG"
 [ "$TEST_FAIL_HEALTH" = 1 ] && exit 1
 printf 'passed\\n' > "$LAAJ_HEALTH_SUCCESS_FILE"
fi
printf 'evaluation\\n' >> "$TEST_HEALTH_LOG"
''')
   args=SimpleNamespace(jobs=1,oauth_only=True,script=script,channel='fixture',crawling_path=root,evaluation_path=root,process_timeout=5)
   for video in ['one','two','three']:
    output=root/'evaluation/laaj_results'/(video+'.jsonl');output.parent.mkdir(parents=True,exist_ok=True);output.write_text('{"fixture":true}\n');complete(output.parent/'.receipts'/(video+'.json'),'a'*64,[output])
   with patch.dict(os.environ,{'LAAJ_FALLBACK_LOCK_PATH':str(root/'lock.json'),'TEST_HEALTH_LOG':str(log),'LAAJ_BASH':'/opt/homebrew/bin/bash'}),patch.object(laaj,'eligible',return_value=True):
    self.assertEqual(laaj.run_jobs(['one','two','three'],args)['failures'],0)
    self.assertEqual(log.read_text().splitlines().count('health'),1);self.assertEqual(log.read_text().splitlines().count('evaluation'),3)
    with patch.dict(os.environ,{'TEST_FAIL_HEALTH':'1'}):self.assertEqual(laaj.run_jobs(['one','two'],args)['failures'],2)
    self.assertEqual(laaj.run_jobs(['one'],args)['failures'],0)
    self.assertEqual(log.read_text().splitlines().count('health'),3)
 def test_shell_receipt_changes_for_web_route_and_optional_visual_bytes(self):
  source=(ROOT/'backend/restaurant-crawling/scripts/08-chunk-multimodal-crawling.sh').read_text();snippet=source.split('        local cache_args=(',1)[1].split('        local force_args=',1)[0];snippet='local cache_args=('+snippet
  with tempfile.TemporaryDirectory() as d:
   root=Path(d);helper_dir=root/'backend/utils';helper_dir.mkdir(parents=True)
   for helper in ['gemini-model.mjs','gemini-model.sh']:shutil.copy2(ROOT/'backend/utils'/helper,helper_dir/helper)
   variables={'receipt_file':str(root/'receipt'),'transcript_file':str(root/'transcript.jsonl'),'meta_file':str(root/'meta.jsonl'),'crawling_file':str(root/'out.jsonl'),'SCRIPT_DIR':str(root/'scripts'),'PROJECT_ROOT':str(root/'backend'),'full_data_path':str(root/'data'),'video_id':'ABCDEFGHIJK','PRIMARY_MODEL':'gemini-3.7-flash','FALLBACK_MODEL':'gemini-3.7-flash','GEMINI_CHUNK_THINKING_LEVEL':'LOW','GEMINI_FINAL_MERGE_THINKING_LEVEL':'LOW'}
   for key in ['PROMPT_FILE','CHUNK_PLANNER','MERGE_RESULTS','PARSER_SCRIPT','GEMINI_CHUNK_API']:variables[key]=str(root/key)
   def recipe(model='gemini-3.7-flash',route='0'):
    v={**variables,'WEB_GEMINI_MODEL':model,'FORCE_WEB_FALLBACK':route};pre='\n'.join(k+'='+shlex.quote(x) for k,x in v.items());code=pre+'\nsource "$PROJECT_ROOT/utils/gemini-model.sh"\nmigrate_deprecated_gemini_model_vars PRIMARY_MODEL FALLBACK_MODEL WEB_GEMINI_MODEL TZUDONG_STAGE_CURRENT_MODEL\ncapture(){\n'+snippet+'\nprintf "%s\\0" "${cache_args[@]}";\n}\ncapture'
    args=subprocess.check_output(['/opt/homebrew/bin/bash','--noprofile','--norc','-c',code]).decode().split('\0')[:-1];groups={}
    for i in range(0,len(args),2):groups.setdefault(args[i],[]).append(args[i+1])
    for k in ['--input','--metadata','--asset']:
     for name in groups.get(k,[]):
      p=Path(name);p.parent.mkdir(parents=True,exist_ok=True)
      if not p.exists():p.write_text('{"fixture":true}\n' if p.suffix=='.jsonl' else 'asset')
    return fingerprint([Path(x) for x in groups['--input']],metadata=[Path(x) for x in groups['--metadata']],assets=[Path(x) for x in groups['--asset']],settings=groups['--setting'])
   absent=recipe();self.assertEqual(absent,recipe('gemini-3.8-flash'));self.assertNotEqual(absent,recipe('gemini-2.5-flash'));self.assertNotEqual(absent,recipe(route='1'))
   visual=root/'data/visual-location/ABCDEFGHIJK.jsonl';visual.parent.mkdir(parents=True);visual.write_text('{"candidate":"one"}\n');present=recipe();self.assertNotEqual(absent,present);visual.write_text('{"candidate":"two"}\n');self.assertNotEqual(present,recipe());visual.unlink();self.assertEqual(absent,recipe())
