"""Owned offline actual-video FFmpeg component experiment; no provider execution."""
import sys,pathlib,tempfile,subprocess,os,json,shutil,time
sys.path.insert(0,str(pathlib.Path(__file__).resolve().parents[4]))
from backend.bin import benchmark_media_orchestration as b
from concurrent.futures import ThreadPoolExecutor
E=pathlib.Path(__file__).resolve().parent; ORIGINAL=pathlib.Path('/Users/twoimo/.aside/u/0/projects/super-knowledge-graph/channels/tzuyang/source/analysis/F93TnnxCNvY/video.mp4')
write=lambda n,v:b.write_json(E/n,v)
before=b.sha(ORIGINAL.read_bytes()); repair='--cleanup-only' in sys.argv; observations=json.loads((E/'raw.json').read_text()) if repair else [];reference=json.loads((E/'manifests/0-baseline-cold.json').read_text()) if repair else None
with tempfile.TemporaryDirectory(prefix='tzudong-owned-media-') as d:
 w=pathlib.Path(d);hashes=b.freeze(w,E);tools=w/'tools';tools.mkdir();journal=w/'ffmpeg.jsonl'
 wrapper=b.FFMPEG_WRAPPER.replace("os.environ['REAL_FFMPEG']",repr(str(b.FFMPEG))).replace("os.environ['REPLAY_JOURNAL']",repr(str(journal)))
 (tools/'ffmpeg').write_text('#!'+sys.executable+'\n'+wrapper);(tools/'ffmpeg').chmod(0o700)
 clip=w/'owned-original-9s.mp4';subprocess.run([str(b.FFMPEG),'-v','error','-nostdin','-i',str(ORIGINAL),'-t','9','-map','0:v:0','-c','copy',str(clip)],check=True,capture_output=True)
 worker=w/'worker.mjs';worker.write_text(b.MEDIA_WORKER)
 env={'PATH':str(tools)+':/opt/homebrew/bin:/usr/bin:/bin','HOME':os.environ['HOME'],'FFMPEG_CMD':str(tools/'ffmpeg'),'FFPROBE_CMD':str(b.FFPROBE),'PYTHONDONTWRITEBYTECODE':'1','TZUDONG_PIPELINE_ISOLATED':'1'}
 for pair in range(0 if repair else 7):
  for impl in (['baseline','candidate'] if pair%2==0 else ['candidate','baseline']):
   directory=w/f'frames-{pair}-{impl}';source=w/impl
   for phase in ['cold','restart']:
    offset=len(b.journal(journal));r=b.execute([str(b.NODE),str(worker),str(source/b.MEDIA),str(clip),str(directory)],env,source);events=b.journal(journal)[offset:];result=r.pop('result');summary=b.event_summary(events)
    if r['exitCode']!=0 or not result:raise RuntimeError('MEDIA_EXECUTION_FAILED')
    if reference is None:reference=result['manifest']
    same=result['manifest']==reference
    record={'pair':pair,'implementation':impl,'phase':phase,**r,**summary,'frameCount':result['frameCount'],'failedSegments':result['failedSegments'],'outputManifestSha256':b.sha(b.canonical(result['manifest'])),'equivalent':same}
    observations.append(record);write('raw.json',observations);write(f'traces/{pair}-{impl}-{phase}.json',events);write(f'manifests/{pair}-{impl}-{phase}.json',result['manifest'])
    if not same or result['failedSegments']:raise RuntimeError('OUTPUT_NOT_EQUIVALENT')
    if impl=='candidate' and summary['exactPeakFfmpegCommands']>4:raise RuntimeError('NESTED_CAP_EXCEEDED')
   print(json.dumps({'pair':pair+1,'implementation':impl,'complete':True}),flush=True)
 # Separate output roots make the two processes' aggregate pool visible.
 if not repair:
  offset=len(b.journal(journal))
  def concurrent(i):return b.execute([str(b.NODE),str(worker),str(w/'candidate'/b.MEDIA),str(clip),str(w/f'concurrent-{i}')],env,w/'candidate')
  with ThreadPoolExecutor(max_workers=2) as pool: contenders=list(pool.map(concurrent,[0,1]))
  write('two-processes.json',{'results':[{k:v for k,v in x.items() if k!='result'} for x in contenders],**b.event_summary(b.journal(journal)[offset:]),'allOutputsEquivalent':all(x['result']['manifest']==reference for x in contenders),'hostWideCapClaim':False})
 # Exercise real processSingleVideo cleanup, with offline acquisition/heatmap inputs only.
 cache=w/'cache';cache.mkdir();(cache/'OTHERVIDEO1A.mp4').write_bytes(b'foreign-cache-sentinel');owned=cache/'F93TnnxCNvY.mp4';owned.write_bytes(b'invalid-owned-media')
 flow=w/'flow.mjs';flow.write_text('''import fs from 'node:fs';import {createHash} from 'node:crypto';
const [source,clip,cache]=process.argv.slice(2);const {processSingleVideo}=await import(source);
const owned=cache+'/F93TnnxCNvY.mp4',other=cache+'/OTHERVIDEO1A.mp4';
const deps={loadSegments:async()=>[{startSec:0,endSec:2,peakSec:1}],acquireVideo:async()=>owned};
const params={channel:'offlinefixture',fps:2,buffer:0,quality:['360p'],ext:['jpg'],deleteCache:true};
let rejected=false;try{await processSingleVideo('F93TnnxCNvY',params,deps);}catch{rejected=true;}
const failureCachePreserved=fs.existsSync(owned)&&fs.readFileSync(owned).equals(Buffer.from('invalid-owned-media'));
fs.copyFileSync(clip,owned);await processSingleVideo('F93TnnxCNvY',params,deps);
console.log('RESULT '+JSON.stringify({rejected,failureCachePreserved,successOwnCacheRemoved:!fs.existsSync(owned),otherCachePreserved:fs.readFileSync(other).equals(Buffer.from('foreign-cache-sentinel'))}));''')
 data=w/'candidate/backend/restaurant-crawling/data';(data/'offlinefixture/meta').mkdir(parents=True,exist_ok=True);(data/'offlinefixture/meta/F93TnnxCNvY.jsonl').write_text('{"recollect_id":0,"duration":9}\n');frames=w/'flow-frames';frames.mkdir();flow_env={**env,'VIDEO_CACHE_DIR':str(cache),'FRAMES_ROOT_DIR':str(frames)};r=b.execute([str(b.NODE),str(flow),str(w/'candidate'/b.MEDIA),str(clip),str(cache)],flow_env,w/'candidate');write('cleanup.json',r)
 if r['exitCode']!=0 or not r['result'] or not all(r['result'].values()):raise RuntimeError('CLEANUP_CONTRACT_FAILED')
 write('configuration.json',{'baselineComponentCommit':b.BASELINE,'candidateHead':subprocess.check_output(['git','rev-parse','HEAD'],cwd=b.ROOT,text=True).strip(),'sourceHashes':hashes,'originalMediaSha256':before,'clipSha256':b.sha(clip.read_bytes()),'clipSeconds':9,'sourceVideoId':'F93TnnxCNvY','pairs':7,'nestedVideos':3,'segmentsPerVideo':4,'fps':2,'quality':'360p','mediaDefaultCap':4,'samplingMinimumMs':20,'cpuMeasurement':'wait4 user+system subprocess tree usage','noiseBudget':{'maxCvPercent':20,'minimumAbsoluteWallReductionMs':50,'minimumRelativeWallReductionPercent':5},'providerCalls':0,'downloads':0,'providerPerformanceClaim':False,'baselineBoundary':'four historical components with current support helpers; media-only executed','originalMediaUnchanged':b.sha(ORIGINAL.read_bytes())==before,'outputImagesPersisted':False})
 write('summary.json',{phase:{metric:b.paired_summary([x for x in observations if x['phase']==phase],metric) for metric in ['wallMs','cpuMs','peakTreeRssMiB','ffmpegCalls']} for phase in ['cold','restart']})
write('validation.json',{'pairs':7,'observations':len(observations),'allOutputsEqual':all(x['equivalent'] for x in observations),'originalMediaUnchanged':b.sha(ORIGINAL.read_bytes())==before,'isolatedWorkDirectoryRemoved':not w.exists(),'providerCalls':0,'downloads':0,'fullPipelinePerformanceVerified':False})
