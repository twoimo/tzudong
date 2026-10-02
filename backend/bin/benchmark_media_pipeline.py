#!/usr/bin/env python3
"""Paired real-ffmpeg experiments on synthetic media, never provider timing."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import time

ROOT = Path(__file__).resolve().parents[2]
BASELINE = 'e6c7c97cc6fb9c4ac2e45297e22c2541bd5ad0d4'
SOURCE = ROOT/'backend/restaurant-crawling/scripts/04-extract-frames-with-heatmap.js'
NODE = '/opt/homebrew/opt/node@24/bin/node'
FFMPEG = '/opt/homebrew/bin/ffmpeg'
FFPROBE = '/opt/homebrew/bin/ffprobe'

WORKER = r'''
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
const [modulePath, video, directory, scenario] = process.argv.slice(2);
const { extractFrames } = await import(modulePath);
const segments = Array.from({length:12},(_,index)=>({startSec:index,endSec:index+1,peakSec:index+.5}));
const outputs = [path.join(directory,'video-a'),path.join(directory,'video-b')];
outputs.forEach(output=>fs.mkdirSync(output,{recursive:true}));
const run = () => Promise.all(outputs.map(output=>extractFrames(video,segments,output,'360p',2,0,'jpg')));
if (scenario !== 'cold') await run();
if (scenario === 'damaged-frame') {
  const file = fs.readdirSync(outputs[0],{recursive:true}).find(file=>file.endsWith('.jpg')&&!file.includes('.history'));
  fs.writeFileSync(path.join(outputs[0],file),'damaged');
}
console.log('MEASUREMENT_START');
const started=performance.now();
const summaries=await run();
const wallMs=performance.now()-started;
let files=[];
for (const output of outputs) {
  for (const file of fs.readdirSync(output,{recursive:true}).filter(file=>file.endsWith('.jpg')&&!file.includes('.history')).sort()) {
    files.push([path.basename(output)+'/'+file,createHash('sha256').update(fs.readFileSync(path.join(output,file))).digest('hex')]);
  }
}
console.log('MEASUREMENT_RESULT '+JSON.stringify({wallMs,frameCount:files.length,failedSegments:summaries.reduce((n,value)=>n+value.failedSegments,0),
  frameManifestSha256:createHash('sha256').update(JSON.stringify(files)).digest('hex')}));
'''


def process_tree_sample(pid):
    result=subprocess.run(['ps','-axo','pid=,ppid=,rss=,comm='],capture_output=True,text=True,check=True)
    table={}
    for line in result.stdout.splitlines():
        parts=line.strip().split(None,3)
        if len(parts)==4:
            try: table[int(parts[0])]=(int(parts[1]),int(parts[2]),parts[3])
            except ValueError: pass
    owned={pid}
    while True:
        children={child for child,(parent,_,_) in table.items() if parent in owned}
        if children.issubset(owned):break
        owned.update(children)
    rss=sum(table[child][1] for child in owned if child in table)/1024
    media=sum(Path(table[child][2]).name=='ffmpeg' for child in owned if child in table)
    return rss,media


def measure(command, env):
    # Only owned descendant counters are retained. ps diagnostics are discarded.
    with tempfile.TemporaryFile() as logs:
        process=subprocess.Popen(command,cwd=ROOT,env=env,stdout=logs,stderr=logs,start_new_session=True)
        peak_rss=peak_media=samples=0
        deadline=time.monotonic()+120
        while True:
            pid,status,usage=os.wait4(process.pid,os.WNOHANG)
            if pid:
                process.returncode=os.waitstatus_to_exitcode(status)
                break
            if time.monotonic()>deadline:
                os.killpg(process.pid,9);process.wait()
                raise RuntimeError('MEDIA_BENCHMARK_TIMEOUT')
            rss,media=process_tree_sample(process.pid)
            peak_rss=max(peak_rss,rss);peak_media=max(peak_media,media);samples+=1
            time.sleep(.02)
        logs.seek(0)
        measurements=[json.loads(line.removeprefix(b'MEASUREMENT_RESULT ')) for line in logs if line.startswith(b'MEASUREMENT_RESULT ')]
        if process.returncode or len(measurements)!=1:raise RuntimeError('MEDIA_BENCHMARK_FAILED')
        # Tree resource measurements include priming when present, unlike wallMs.
        return {**measurements[0], 'totalWorkerCpuMs':1000*(usage.ru_utime+usage.ru_stime),
                'peakProcessTreeRssMiB':peak_rss,'maximumSingleProcessRssMiB':usage.ru_maxrss/1048576,
                'sampledPeakFfmpegProcesses':peak_media,'resourceSamples':samples,
                'resourceScope':'whole worker including priming; wallMs only final run'}


def main():
    parser=argparse.ArgumentParser();parser.add_argument('--output',type=Path,required=True);args=parser.parse_args()
    assets=[SOURCE,ROOT/'backend/utils/frame-receipt.mjs',ROOT/'backend/utils/resource-budget.mjs',ROOT/'backend/utils/stage_cache.py',ROOT/'backend/utils/frame_lock_server.py']
    asset_hashes={str(path.relative_to(ROOT)):hashlib.sha256(path.read_bytes()).hexdigest() for path in assets}
    before=SOURCE.read_bytes();observations=[]
    with tempfile.TemporaryDirectory(prefix='tzudong-media-replay-') as directory:
        work=Path(directory);scripts=work/'backend/restaurant-crawling/scripts';scripts.mkdir(parents=True)
        (work/'backend/package.json').write_text('{"type":"module"}')
        (work/'backend/node_modules').symlink_to(ROOT/'backend/node_modules',target_is_directory=True)
        (work/'backend/utils').symlink_to(ROOT/'backend/utils',target_is_directory=True)
        baseline=scripts/'baseline.js'
        baseline_source=subprocess.run(['git','show',f'{BASELINE}:backend/restaurant-crawling/scripts/04-extract-frames-with-heatmap.js'],cwd=ROOT,capture_output=True,check=True).stdout
        baseline.write_bytes(baseline_source+b'\nexport { extractFrames };\n')
        worker=work/'worker.mjs';worker.write_text(WORKER)
        video=work/'synthetic.mp4'
        subprocess.run([FFMPEG,'-v','error','-f','lavfi','-i','testsrc2=size=640x360:rate=8','-t','13','-c:v','libx264','-threads','1','-pix_fmt','yuv420p',str(video)],check=True,capture_output=True)
        env={**os.environ,'FFMPEG_CMD':FFMPEG,'FFPROBE_CMD':FFPROBE,'PIPELINE_FFMPEG_JOBS':'4','RUN_DAILY_PYTHON':sys.executable}
        reference=None
        for scenario in ['cold','unchanged','damaged-frame']:
            for repeat in range(7):
                for implementation in (['baseline','candidate'] if repeat%2==0 else ['candidate','baseline']):
                    output=work/f'{scenario}-{repeat}-{implementation}'
                    module=baseline if implementation=='baseline' else SOURCE
                    result=measure([NODE,str(worker),str(module),str(video),str(output),scenario],env)
                    if reference is None:reference=result['frameManifestSha256']
                    result['frameBytesEquivalent']=result['frameManifestSha256']==reference
                    if scenario!='damaged-frame' and not result['frameBytesEquivalent']:raise RuntimeError('FRAME_EQUIVALENCE_FAILED')
                    if implementation=='candidate' and (not result['frameBytesEquivalent'] or result['sampledPeakFfmpegProcesses']>4):raise RuntimeError('FRAME_CANDIDATE_INVALID')
                    observations.append({'scenario':scenario,'repeat':repeat,'implementation':implementation,**result})
                print(json.dumps({'scenario':scenario,'pairedSamples':repeat+1}),flush=True)
        source_sha=hashlib.sha256(video.read_bytes()).hexdigest()
    if asset_hashes!={str(path.relative_to(ROOT)):hashlib.sha256(path.read_bytes()).hexdigest() for path in assets}:raise RuntimeError('BENCHMARK_SOURCE_CHANGED')
    result={'kind':'local_real_ffmpeg_synthetic_media','liveEvidenceEligible':False,'baselineSha':BASELINE,
            'candidateSourceSha256':hashlib.sha256(before).hexdigest(),'sourceAssetsSha256':asset_hashes,'syntheticMediaSha256':source_sha,
            'environment':{'node':subprocess.check_output([NODE,'--version'],text=True).strip(),
                           'ffmpeg':subprocess.check_output([FFMPEG,'-version'],text=True).splitlines()[0],
                           'python':sys.version.split()[0],'platform':sys.platform,'candidateFfmpegCap':4,
                           'resourceSamplingMinimumIntervalMs':20},
            'externalCalls':0,'downloads':0,'actualProviderTokens':0,'observations':observations}
    args.output.parent.mkdir(parents=True,exist_ok=True);args.output.write_text(json.dumps(result,indent=2)+'\n')


if __name__=='__main__':main()
