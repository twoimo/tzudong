"""Actual four native leases + bounded busy/release probe + queued parent death."""
import pathlib,sys,tempfile,subprocess,os,time,json
sys.path.insert(0,str(next(p for p in pathlib.Path(__file__).resolve().parents if (p/'backend').is_dir())))
from backend.bin import benchmark_media_orchestration as b
from backend.utils.tests.test_media_shared_lease import comm
E=pathlib.Path(__file__).resolve().parent
with tempfile.TemporaryDirectory(prefix='tzudong-probe-saturation-') as d:
 root=pathlib.Path(d).resolve()
 for relative in b.ASSETS+['backend/utils/media_lease_exec.py']:
  p=root/relative;p.parent.mkdir(parents=True,exist_ok=True);p.write_bytes((b.ROOT/relative).read_bytes())
 (root/'backend/node_modules').symlink_to(b.ORIGINAL/'backend/node_modules',target_is_directory=True)
 context=root/'slots';helper=root/'backend/utils/media_lease_exec.py';holders=[]
 env={'PATH':'/opt/homebrew/bin:/usr/bin:/bin','HOME':os.environ['HOME'],'PIPELINE_MEDIA_RESOURCE_DIR':str(context),'RUN_DAILY_PYTHON':sys.executable}
 try:
  for _ in range(4):holders.append(subprocess.Popen([sys.executable,str(helper),str(context),'--',str(b.FFMPEG),'-nostdin','-v','error','-re','-f','lavfi','-i','testsrc2=size=64x64:rate=4','-t','7','-f','null','-'],stdin=subprocess.PIPE,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL))
  deadline=time.monotonic()+3
  while not all(pathlib.Path(comm(p.pid)).name=='ffmpeg' for p in holders):
   if time.monotonic()>deadline:raise RuntimeError('SATURATION_NOT_OBSERVED')
   time.sleep(.02)
  marker=root/'queued-tool-started';code="import {spawn} from 'node:child_process';import {sharedMediaInvocation} from './backend/utils/resource-budget.mjs';const v=sharedMediaInvocation(process.env.TEST_PYTHON,['-c',\"open(__import__('os').environ['TEST_MARKER'],'w').write('started')\"]);const c=spawn(v.file,v.args,{stdio:['pipe','ignore','ignore'],detached:true});console.log(c.pid);setInterval(()=>{},1000);"
  queued=subprocess.Popen([str(b.NODE),'--input-type=module','-e',code],cwd=root,env={**env,'TEST_PYTHON':sys.executable,'TEST_MARKER':str(marker)},stdout=subprocess.PIPE,text=True);queued_pid=int(queued.stdout.readline());time.sleep(.08);queued.kill();queued.wait(timeout=2);queued.stdout.close()
  probe="import {isRunnableMediaTool} from './backend/restaurant-crawling/scripts/04-extract-frames-with-heatmap.js';try{console.log(JSON.stringify({runnable:isRunnableMediaTool('/opt/homebrew/bin/ffmpeg')}));}catch(e){console.log(JSON.stringify({code:e.message}));}"
  started=time.monotonic();first=subprocess.run([str(b.NODE),'--input-type=module','-e',probe],cwd=root,env=env,capture_output=True,text=True,timeout=7);elapsed=time.monotonic()-started;busy=json.loads(first.stdout)
  assert busy=={'code':'FRAME_MEDIA_RESOURCE_BUSY'},busy
  for p in holders:assert p.wait(timeout=4)==0
  second=subprocess.run([str(b.NODE),'--input-type=module','-e',probe],cwd=root,env=env,capture_output=True,text=True,timeout=3);assert json.loads(second.stdout)=={'runnable':True}
  assert not marker.exists(),'UNADMITTED_TOOL_STARTED_AFTER_PARENT_EXIT'
  b.write_json(E/'probe-saturation-validation.json',{'actualNativeHolders':4,'busyFixedCode':busy['code'],'boundedProbeElapsedSeconds':elapsed,'probeDeadlineMs':5000,'runnableAfterRelease':True,'unadmittedToolStartedAfterParentExit':False,'queuedToolMarkerAbsent':True,'inputAndCodeScopes':'owned snapshot/context only','providerCalls':0,'sourceHashes':{relative:b.sha((b.ROOT/relative).read_bytes()) for relative in b.ASSETS+['backend/utils/media_lease_exec.py']}})
  print(json.dumps({'busy':busy['code'],'releaseProbe':True,'queuedParentExit':True}))
 finally:
  for p in holders:
   if p.poll() is None:p.kill();p.wait()
   p.stdin.close()
