"""Prospective source/input-bound real FFmpeg correctness probe, not speedup."""
import pathlib,sys,os,subprocess,json,tempfile,shutil
from concurrent.futures import ThreadPoolExecutor
sys.path.insert(0,str(next(p for p in pathlib.Path(__file__).resolve().parents if (p/'backend').is_dir())))
from backend.bin import benchmark_media_orchestration as b
E=pathlib.Path(__file__).resolve().parent;BASELINE='3f86d6999d4a6b00e6221510a0728358747fa997';original=pathlib.Path('/Users/twoimo/.aside/u/0/projects/super-knowledge-graph/channels/tzuyang/source/analysis/F93TnnxCNvY/video.mp4');original_sha=b.sha(original.read_bytes());rows=[]
write=lambda n,a:b.write_json(E/n,a)
with tempfile.TemporaryDirectory(prefix='tzudong-shared-media-owned-') as d:
 w=pathlib.Path(d).resolve();source_hashes={}
 for impl in ['baseline','candidate']:
  source_hashes[impl]={}
  for relative in b.ASSETS+['backend/utils/media_lease_exec.py']:
   if impl=='baseline' and relative.endswith('media_lease_exec.py'):continue
   data=subprocess.check_output(['git','show',BASELINE+':'+relative],cwd=b.ROOT) if impl=='baseline' else (b.ROOT/relative).read_bytes()
   source_hashes[impl][relative]=b.sha(data);p=w/impl/relative;p.parent.mkdir(parents=True,exist_ok=True);p.write_bytes(data);p=E/'frozen-source'/impl/relative;p.parent.mkdir(parents=True,exist_ok=True);p.write_bytes(data)
  (w/impl/'backend/node_modules').symlink_to(b.ORIGINAL/'backend/node_modules',target_is_directory=True)
 clip=w/'clip.mp4';subprocess.run([str(b.FFMPEG),'-v','error','-nostdin','-i',str(original),'-t','9','-map','0:v:0','-c','copy',str(clip)],check=True,capture_output=True)
 tools=w/'tools';tools.mkdir();journal=w/'ffmpeg.jsonl'
 wrapper=b.FFMPEG_WRAPPER.replace("os.environ['REAL_FFMPEG']",repr(str(b.FFMPEG))).replace("os.environ['REPLAY_JOURNAL']",repr(str(journal)))
 wrapper=wrapper.replace('stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)',"stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,pass_fds=tuple([int(os.environ['PIPELINE_MEDIA_LEASE_FD'])]) if 'PIPELINE_MEDIA_LEASE_FD' in os.environ else ())")
 (tools/'ffmpeg').write_text('#!'+sys.executable+'\n'+wrapper);(tools/'ffmpeg').chmod(0o700);worker=w/'worker.mjs';worker.write_text(b.MEDIA_WORKER)
 env={'PATH':str(tools)+':/opt/homebrew/bin:/usr/bin:/bin','HOME':os.environ['HOME'],'FFMPEG_CMD':str(tools/'ffmpeg'),'FFPROBE_CMD':str(b.FFPROBE),'RUN_DAILY_PYTHON':sys.executable,'PIPELINE_MEDIA_RESOURCE_DIR':str(w/'shared-context'),'PYTHONDONTWRITEBYTECODE':'1','TZUDONG_PIPELINE_ISOLATED':'1'}
 config={'baselineCommit':BASELINE,'sourceHashes':source_hashes,'clipSha256':b.sha(clip.read_bytes()),'originalMediaSha256':original_sha,'workerSha256':b.sha(worker.read_bytes()),'harnessSha256':b.sha(pathlib.Path(__file__).read_bytes()),'instrumentSha256':b.sha((tools/'ffmpeg').read_bytes()),'sharedLimit':4,'processLocalDefaultLimit':4,'inputVideoId':'F93TnnxCNvY','clipSeconds':9,'providerCalls':0,'downloads':0,'speedupClaim':False,'sourceContext':'owned shared directory for both candidate Node processes','ffmpegVersion':subprocess.check_output([str(b.FFMPEG),'-version'],text=True).splitlines()[0]}
 write('preflight-bound-inputs.json',config) # durable before the first measured command
 reference=None
 for impl in ['baseline','candidate']:
  source=w/impl
  for phase in ['cold','restart']:
   offset=len(b.journal(journal))
   def run(i):return b.execute([str(b.NODE),str(worker),str(source/b.MEDIA),str(clip),str(w/f'{impl}-{i}')],env,source)
   with ThreadPoolExecutor(max_workers=2) as pool:results=list(pool.map(run,[0,1]))
   events=b.journal(journal)[offset:];summary=b.event_summary(events)
   for result in results:
    if result['exitCode'] or not result['result']:raise RuntimeError('ACTUAL_MEDIA_FAILED')
    if reference is None:reference=result['result']['manifest']
    if result['result']['manifest']!=reference:raise RuntimeError('OUTPUT_MISMATCH')
   record={'implementation':impl,'phase':phase,'processResults':[{k:v for k,v in x.items() if k!='result'} for x in results],**summary,'framesPerProcess':len(reference),'outputManifestSha256':b.sha(b.canonical(reference)),'outputsEquivalent':True}
   rows.append(record);write('raw.json',rows);write(f'traces/{impl}-{phase}.json',events)
   if impl=='candidate' and summary['exactPeakFfmpegCommands']>4:raise RuntimeError('SHARED_CAP_EXCEEDED')
 # Real function failure/success cleanup in this same admitted context.
 cache=w/'cache';cache.mkdir();(cache/'OTHER.mp4').write_bytes(b'other-owned-fixture');owned=cache/'F93TnnxCNvY.mp4';owned.write_bytes(b'invalid-owned-media');frames=w/'cleanup-frames';frames.mkdir();data=w/'candidate/backend/restaurant-crawling/data/offlinefixture/meta';data.mkdir(parents=True);(data/'F93TnnxCNvY.jsonl').write_text('{"recollect_id":0,"duration":9}\n')
 flow=w/'flow.mjs';flow.write_text('''import fs from 'node:fs';const [source,clip,cache]=process.argv.slice(2);const {processSingleVideo}=await import(source);const own=cache+'/F93TnnxCNvY.mp4';const deps={loadSegments:async()=>[{startSec:0,endSec:2,peakSec:1}],acquireVideo:async()=>own};const params={channel:'offlinefixture',fps:2,buffer:0,quality:['360p'],ext:['jpg'],deleteCache:true};let rejected=false;try{await processSingleVideo('F93TnnxCNvY',params,deps);}catch{rejected=true;}const failureCachePreserved=fs.existsSync(own)&&fs.readFileSync(own).equals(Buffer.from('invalid-owned-media'));fs.copyFileSync(clip,own);await processSingleVideo('F93TnnxCNvY',params,deps);console.log('RESULT '+JSON.stringify({rejected,failureCachePreserved,successOwnCleanup:!fs.existsSync(own),otherCachePreserved:fs.readFileSync(cache+'/OTHER.mp4').equals(Buffer.from('other-owned-fixture'))}));''')
 cleanup=b.execute([str(b.NODE),str(flow),str(w/'candidate'/b.MEDIA),str(clip),str(cache)],{**env,'VIDEO_CACHE_DIR':str(cache),'FRAMES_ROOT_DIR':str(frames)},w/'candidate');write('cleanup.json',cleanup)
 if cleanup['exitCode'] or not cleanup['result'] or not all(cleanup['result'].values()):raise RuntimeError('CLEANUP_NOT_VERIFIED')
 for impl in source_hashes:
  for relative,sha in source_hashes[impl].items():
   if b.sha((w/impl/relative).read_bytes())!=sha:raise RuntimeError('FROZEN_SOURCE_DRIFT')
 if b.sha(clip.read_bytes())!=config['clipSha256'] or b.sha(original.read_bytes())!=original_sha:raise RuntimeError('INPUT_DRIFT')
write('validation.json',{'preflightPersistedBeforeMeasurement':True,'inputAndFrozenSourcesUnchanged':True,'aggregateCandidatePeak':max(x['exactPeakFfmpegCommands'] for x in rows if x['implementation']=='candidate'),'outputsEquivalent':True,'restartFfmpegCalls':sum(x['ffmpegCalls'] for x in rows if x['phase']=='restart'),'workDirectoryRemoved':not w.exists(),'providerCalls':0,'speedupClaim':False})
print(json.dumps({'complete':True,'aggregatePeak':4,'observations':len(rows)}))
