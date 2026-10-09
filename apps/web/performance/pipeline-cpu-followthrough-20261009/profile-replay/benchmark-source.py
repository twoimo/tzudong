#!/usr/bin/env python3
"""Frozen, network-free media/LAAJ/transform replay; never a live E2E claim.

Seven alternating baseline/candidate pairs use actual ffmpeg, the actual LAAJ
shell/parser and transform, and archived provider evaluations. Production
configuration, models, provider limits and original data are never written.
"""
from __future__ import annotations

import argparse
from concurrent.futures import ThreadPoolExecutor
import hashlib
import json
import os
from pathlib import Path
import platform
import random
import shutil
import signal
import statistics
import subprocess
import sys
import tempfile
import time

ROOT = Path(__file__).resolve().parents[2]
BASELINE = 'e6c7c97cc6fb9c4ac2e45297e22c2541bd5ad0d4'
ORIGINAL = Path('/Users/twoimo/Documents/projects/tzudong')
NODE = Path('/opt/homebrew/opt/node@24/bin/node')
FFMPEG = Path('/opt/homebrew/bin/ffmpeg')
FFPROBE = Path('/opt/homebrew/bin/ffprobe')
BASH = Path('/opt/homebrew/bin/bash')
MEDIA = 'backend/restaurant-crawling/scripts/04-extract-frames-with-heatmap.js'
LAAJ = 'backend/restaurant-evaluation/scripts/11-laaj-evaluation.sh'
TRANSFORM = 'backend/restaurant-evaluation/scripts/12-transform.py'
ASSETS = [MEDIA, LAAJ, TRANSFORM,
    'backend/package.json', 'backend/restaurant-evaluation/scripts/parse_laaj_evaluation.py',
    'backend/restaurant-evaluation/scripts/gemini_api_request.mjs',
    'backend/restaurant-evaluation/prompts/evaluation_prompt.txt',
    'backend/bin/stage_cache.py', 'backend/bin/run_parallel_laaj.py',
    'backend/utils/stage_cache.py', 'backend/utils/jsonl_utils.py',
    'backend/utils/provider_budget.py', 'backend/utils/provider-budget.mjs',
    'backend/utils/gemini-client.mjs', 'backend/utils/resource-budget.mjs',
    'backend/utils/frame-receipt.mjs', 'backend/utils/frame_lock_server.py',
    'backend/utils/privacy-log.mjs']
EVAL_KEYS = ['visit_authenticity', 'rb_inference_score', 'rb_grounding_TF',
             'review_faithfulness_score', 'category_TF']


def sha(data):
    return hashlib.sha256(data).hexdigest()


def canonical(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':')).encode()


def write_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n')


def last(path):
    return json.loads(path.read_text().splitlines()[-1])


def corpus_manifest():
    paths = []
    for relative in ['restaurant-crawling/data/tzuyang/meta',
                     'restaurant-crawling/data/tzuyang/transcript',
                     'restaurant-crawling/data/tzuyang/crawling',
                     'restaurant-evaluation/data/tzuyang/evaluation/rule_results',
                     'restaurant-evaluation/data/tzuyang/evaluation/laaj_results']:
        paths.extend(sorted((ORIGINAL / 'backend' / relative).glob('*.jsonl')))
    rows = [[str(p.relative_to(ORIGINAL)), p.stat().st_size, sha(p.read_bytes())] for p in paths]
    return {'files': len(rows), 'bytes': sum(r[1] for r in rows), 'sha256': sha(canonical(rows)), 'manifest': rows}


def select_corpus():
    evaluation = ORIGINAL / 'backend/restaurant-evaluation/data/tzuyang/evaluation'
    crawling = ORIGINAL / 'backend/restaurant-crawling/data/tzuyang'
    result = []
    for path in sorted((evaluation / 'laaj_results').glob('*.jsonl')):
        # A deterministic, declared subset; no coverage claim for other IDs.
        if path.stem.startswith('-'):
            continue
        rule = evaluation / 'rule_results' / path.name
        transcript = crawling / 'transcript' / path.name
        metadata = crawling / 'meta' / path.name
        if not all(p.is_file() for p in [rule, transcript, metadata]):
            continue
        values, response = last(rule), last(path)
        if (not any(x is True for x in values.get('evaluation_target', {}).values())
                or not set(EVAL_KEYS).issubset(response.get('evaluation_results', {}))):
            continue
        if not last(transcript).get('transcript'):
            continue
        result.append({'video': path.stem, 'rule': rule, 'transcript': transcript,
                       'meta': metadata, 'archivedEvaluation': path})
        if len(result) == 3:
            break
    if len(result) != 3:
        raise RuntimeError('CORPUS_SAMPLE_UNAVAILABLE')
    return result


MEDIA_WORKER = r'''
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
const [source,video,directory]=process.argv.slice(2);
const {extractFrames}=await import(source);
const segments=Array.from({length:4},(_,i)=>({startSec:2*i,endSec:2*i+2,peakSec:2*i+1}));
const outputs=Array.from({length:3},(_,i)=>path.join(directory,`video-${i}`));
outputs.forEach(p=>fs.mkdirSync(p,{recursive:true}));
const started=performance.now();
const results=await Promise.all(outputs.map(p=>extractFrames(video,segments,p,'360p',2,0,'jpg')));
const wallMs=performance.now()-started;
const manifest=[];
for(const p of outputs) for(const f of fs.readdirSync(p,{recursive:true}).filter(f=>f.endsWith('.jpg')&&!f.includes('.history')&&!f.includes('.frames-')).sort()) {
 manifest.push([path.basename(p)+'/'+f,createHash('sha256').update(fs.readFileSync(path.join(p,f))).digest('hex')]);
}
console.log('RESULT '+JSON.stringify({wallMs,manifest,frameCount:manifest.length,failedSegments:results.reduce((a,b)=>a+b.failedSegments,0)}));
'''

# Every journal write is a locked append. Store only hashes, counts and timing;
# original prompts/responses and ffmpeg arguments never enter retained logs.
JOURNAL_HELPER = r'''
import fcntl,hashlib,json,os,time
from pathlib import Path
def event(kind, **values):
 p=Path(os.environ['REPLAY_JOURNAL'])
 with p.open('a') as out:
  fcntl.flock(out,fcntl.LOCK_EX)
  out.write(json.dumps(dict(kind=kind,at=time.monotonic_ns(),pid=os.getpid(),**values))+'\n')
  out.flush()
'''
FFMPEG_WRAPPER = JOURNAL_HELPER + r'''
import subprocess,sys
args=sys.argv[1:]
if args==['-version']: os.execv(os.environ['REAL_FFMPEG'],[os.environ['REAL_FFMPEG'],*args])
event('ffmpeg-start')
try:
 result=subprocess.run([os.environ['REAL_FFMPEG'],*args],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
 event('ffmpeg-end',code=result.returncode)
 raise SystemExit(result.returncode)
except BaseException:
 raise
'''
PROVIDER_WRAPPER = JOURNAL_HELPER + r'''
import re,sys
if len(sys.argv)!=4 or not sys.argv[1].endswith('gemini_api_request.mjs'):
 raise SystemExit('REPLAY_PROVIDER_COMMAND_REJECTED')
prompt=Path(sys.argv[2]).read_bytes()
match=re.search(rb'(?:watch\?v=|youtu\.be/)([A-Za-z0-9_-]{11})',prompt)
identity=match.group(1).decode() if match else None
event('provider-start',video=identity,promptSha256=hashlib.sha256(prompt).hexdigest())
barrier=os.environ.get('REPLAY_BARRIER')
while identity and barrier and Path(barrier).exists(): time.sleep(.01)
payload=(Path(os.environ['REPLAY_RESPONSES'])/(identity+'.json')).read_bytes() if identity else b'{"result":"2"}'
Path(sys.argv[3]).write_bytes(payload)
event('provider-end',video=identity,responseSha256=hashlib.sha256(payload).hexdigest())
'''


def freeze(work, output):
    hashes = {}
    for implementation in ['baseline', 'candidate']:
        hashes[implementation] = {}
        for relative in ASSETS:
            current = (ROOT / relative).read_bytes()
            if implementation == 'baseline' and relative in [MEDIA, LAAJ, TRANSFORM,
                    'backend/restaurant-evaluation/scripts/parse_laaj_evaluation.py']:
                current = subprocess.check_output(['git', 'show', f'{BASELINE}:{relative}'], cwd=ROOT)
            frozen = output / 'frozen-source' / implementation / relative
            frozen.parent.mkdir(parents=True, exist_ok=True)
            frozen.write_bytes(current)
            hashes[implementation][relative] = sha(current)
            target = work / implementation / relative
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(current + (b'\nexport { extractFrames };\n' if implementation == 'baseline' and relative == MEDIA else b''))
        (work / implementation / 'backend/node_modules').symlink_to(ORIGINAL / 'backend/node_modules', target_is_directory=True)
        # Exact shell orchestration is retained; only external provider adapters
        # are fail-closed replay stubs. No operator credential/config reads.
        (work / implementation / 'backend/bin/run_agy_prompt.py').write_text('raise SystemExit(1)\n')
    return hashes


def setup_data(directory, corpus):
    for row in corpus:
        video = row['video']
        for key, relative in [('rule', 'evaluation/evaluation/rule_results'),
                              ('transcript', 'crawling/transcript'), ('meta', 'crawling/meta')]:
            target = directory / relative / (video + '.jsonl')
            target.parent.mkdir(parents=True, exist_ok=True)
            # Preserve exact latest-record semantics; historical metadata and
            # transcript JSONL bytes are copied without editing the originals.
            target.write_bytes(row[key].read_bytes())
        rule = directory / 'evaluation/evaluation/rule_results' / (video + '.jsonl')
        receipt = rule.parent / '.receipts' / (video + '.json')
        write_json(receipt, {'schemaVersion': 1, 'inputHash': sha(rule.read_bytes()),
                            'outputs': [sha(canonical(last(rule)))]})
    protected = protected_rows(corpus)
    (directory/'evaluation/evaluation/transforms.jsonl').write_bytes(b''.join(canonical(row)+b'\n' for row in protected))


def protected_rows(corpus):
    return [{'trace_id': f'fixture-protected-{index}', 'youtube_link': last(corpus[0]['rule'])['youtube_link'],
             'channel_name':'tzuyang', 'origin_name':f'fixture-admin-{index}', 'source_type':'geminiCLI',
             'lat':None, 'lng':None, 'status':state, 'approved_name':f'fixture-approved-{index}',
             'updated_by_admin_id':'00000000-0000-0000-0000-000000000001',
             'evaluation_results':{'fixture-admin-decision':index}}
            for index,state in enumerate(['approved','hold','pending'])]


def sampled_tree(pid):
    result = subprocess.run(['ps', '-axo', 'pid=,ppid=,rss=,comm='], capture_output=True, text=True, check=True)
    table = {}
    for line in result.stdout.splitlines():
        values = line.split(None, 3)
        if len(values) == 4:
            table[int(values[0])] = (int(values[1]), int(values[2]), values[3])
    owned = {pid}
    while True:
        children = {child for child, (parent, _, _) in table.items() if parent in owned}
        if children.issubset(owned):
            break
        owned.update(children)
    return sum(table[p][1] for p in owned if p in table) / 1024, sum(Path(table[p][2]).name == 'ffmpeg' for p in owned if p in table)


def execute(command, env, cwd, input_text=None):
    started = time.perf_counter()
    with tempfile.TemporaryFile() as logs, tempfile.TemporaryFile() as stdin:
        if input_text is not None:
            stdin.write(input_text.encode()); stdin.seek(0)
        process = subprocess.Popen(command, cwd=cwd, env=env, stdout=logs, stderr=logs,
                                   stdin=stdin, start_new_session=True)
        peak_rss = peak_ffmpeg = samples = 0
        deadline = time.monotonic() + 90
        while True:
            pid, status, usage = os.wait4(process.pid, os.WNOHANG)
            if pid:
                process.returncode = os.waitstatus_to_exitcode(status)
                break
            if time.monotonic() > deadline:
                os.killpg(process.pid, signal.SIGKILL); process.wait()
                raise RuntimeError('REPLAY_DEADLINE_EXCEEDED')
            rss, count = sampled_tree(process.pid)
            peak_rss, peak_ffmpeg = max(peak_rss, rss), max(peak_ffmpeg, count)
            samples += 1
            time.sleep(.02)
        wall_ms = (time.perf_counter() - started) * 1000
        logs.seek(0); content = logs.read()
        values = [json.loads(x.removeprefix(b'RESULT ')) for x in content.splitlines() if x.startswith(b'RESULT ')]
        # Diagnostics can include transcript/evaluation fields: retain hash only.
        return {'wallMs': wall_ms, 'cpuMs': (usage.ru_utime + usage.ru_stime) * 1000,
                'peakTreeRssMiB': peak_rss, 'sampledPeakFfmpeg': peak_ffmpeg,
                'resourceSamples': samples, 'exitCode': process.returncode,
                'diagnosticSha256': sha(content), 'result': values[-1] if values else None}


def journal(path):
    return [json.loads(line) for line in path.read_text().splitlines()] if path.is_file() else []


def event_summary(events):
    active = peak = 0
    for event in sorted(events, key=lambda x: x['at']):
        if event['kind'] == 'ffmpeg-start':
            active += 1; peak = max(peak, active)
        elif event['kind'] == 'ffmpeg-end':
            active -= 1
    return {'exactPeakFfmpegCommands': peak, 'ffmpegCalls': sum(e['kind'] == 'ffmpeg-start' for e in events),
            'providerReplayCalls': sum(e['kind'] == 'provider-start' for e in events),
            'evaluationReplayCalls': sum(e['kind'] == 'provider-start' and e.get('video') is not None for e in events),
            'unclosedFfmpegCommands': active}


def output_manifest(directory):
    laaj = directory / 'evaluation/evaluation/laaj_results'
    evaluation = [[p.name, sha(canonical(last(p)))] for p in sorted(laaj.glob('*.jsonl'))]
    transformed = directory / 'evaluation/evaluation/transforms.jsonl'
    rows = [json.loads(line) for line in transformed.read_text().splitlines()]
    identities = [row['trace_id'] for row in rows]
    return {'evaluations': evaluation, 'evaluationSha256': sha(canonical(evaluation)),
            'transformSha256': sha(canonical(sorted(rows, key=lambda row: row['trace_id']))),
            'rows': len(rows), 'traceIds': sorted(identities), 'duplicates': len(rows) - len(set(identities))}


def protected_unchanged(directory, corpus):
    rows = [json.loads(line) for line in (directory/'evaluation/evaluation/transforms.jsonl').read_text().splitlines()]
    actual = {row['trace_id']:row for row in rows}
    return all(actual.get(row['trace_id']) == row for row in protected_rows(corpus))


def fault_probes(work, output, corpus, base_env, worker, video, reference):
    probes = []
    for implementation in ['baseline','candidate']:
        source = work/implementation
        directory = work/f'contenders-{implementation}'; setup_data(directory,corpus)
        event_file = work/f'contenders-{implementation}.jsonl'
        env = {**base_env,'REPLAY_JOURNAL':str(event_file),'LAAJ_FALLBACK_LOCK_PATH':str(work/'fallback.json')}
        media_command = [str(NODE),str(worker),str(source/MEDIA),str(video),str(directory/'frames')]
        before = len(journal(work/'ffmpeg-events.jsonl'))
        with ThreadPoolExecutor(max_workers=2) as executor:
            media_results = list(executor.map(lambda _:execute(media_command,env,source),range(2)))
        media_events = journal(work/'ffmpeg-events.jsonl')[before:]
        laaj_command = [str(BASH),str(source/LAAJ),'--channel','tzuyang','--crawling-path',str(directory/'crawling'),'--evaluation-path',str(directory/'evaluation')]
        with ThreadPoolExecutor(max_workers=2) as executor:
            laaj_results = list(executor.map(lambda _:execute(laaj_command,env,source),range(2)))
        execute([sys.executable,str(source/TRANSFORM),'--channel','tzuyang','--crawling-path',str(directory/'crawling'),'--evaluation-path',str(directory/'evaluation')],env,source)
        manifest = output_manifest(directory)
        frames_ok = all(r['result'] is not None and sha(canonical(r['result']['manifest']))==reference['frameSha256'] for r in media_results)
        evaluation_ok = manifest['evaluationSha256']==reference['evaluationSha256'] and manifest['transformSha256']==reference['transformSha256']
        events = sorted(media_events+journal(event_file),key=lambda x:x['at'])
        summary = event_summary(events)
        result = {'probe':'two_independent_processes_same_outputs','implementation':implementation,
                  'mediaExitCodes':[r['exitCode'] for r in media_results],
                  'laajExitCodes':[r['exitCode'] for r in laaj_results],
                  'framesEquivalent':frames_ok,'evaluationAndTraceEquivalent':evaluation_ok,
                  'adminProtectedRowsUnchanged':protected_unchanged(directory,corpus),**summary,
                  'duplicateEvaluations':max(0,summary['evaluationReplayCalls']-len(corpus))}
        probes.append(result);write_json(output/f'traces/contenders-{implementation}.json',events)
        if implementation=='candidate' and (not frames_ok or not evaluation_ok or summary['ffmpegCalls']!=12 or summary['evaluationReplayCalls']!=3 or not result['adminProtectedRowsUnchanged']):
            write_json(output/'fault-probes.json',probes)
            raise RuntimeError('SINGLE_WRITER_PROBE_FAILED')
        image_path = next(p for p in sorted((directory/'frames').rglob('*.jpg')) if '.history' not in p.parts)
        image_path.write_bytes(b'fixture-damaged-frame')
        before = len(journal(work/'ffmpeg-events.jsonl'))
        repaired = execute(media_command,env,source)
        damage_events=journal(work/'ffmpeg-events.jsonl')[before:]
        repaired_ok = repaired['result'] is not None and sha(canonical(repaired['result']['manifest']))==reference['frameSha256']
        retained_damage = any(p.read_bytes()==b'fixture-damaged-frame' for p in (directory/'frames').rglob('*.jpg') if '.history' in p.parts)
        probes.append({'probe':'damaged_frame_recovery','implementation':implementation,
                       'exitCode':repaired['exitCode'],'restoredExactBytes':repaired_ok,
                       'damagedBytesRetainedInHistory':retained_damage,**event_summary(damage_events)})
        write_json(output/f'traces/damage-{implementation}.json',damage_events)
        if implementation=='candidate' and (not repaired_ok or not retained_damage or event_summary(damage_events)['ffmpegCalls']!=1):
            write_json(output/'fault-probes.json',probes)
            raise RuntimeError('DAMAGED_FRAME_RECOVERY_FAILED')
    # Real child-group timeout and rerun; unchanged production configuration.
    directory=work/'timeout-restart';setup_data(directory,corpus);source=work/'candidate'
    barrier=work/'provider-barrier';barrier.touch();event_file=work/'timeout-events.jsonl'
    env={**base_env,'REPLAY_JOURNAL':str(event_file),'REPLAY_BARRIER':str(barrier),'LAAJ_FALLBACK_LOCK_PATH':str(work/'fallback.json')}
    command=[sys.executable,str(source/'backend/bin/run_parallel_laaj.py'),'run','--jobs','1',
             '--process-timeout','2','--channel','tzuyang','--crawling-path',str(directory/'crawling'),
             '--evaluation-path',str(directory/'evaluation'),'--script',str(source/LAAJ)]
    interrupted=execute(command,env,source,corpus[0]['video']+'\n')
    partial_files=list((directory/'evaluation/evaluation/laaj_results').glob('*.jsonl'))
    timeout_events=journal(event_file)
    barrier.unlink()
    restarted=execute([str(BASH),str(source/LAAJ),'--channel','tzuyang','--crawling-path',str(directory/'crawling'),'--evaluation-path',str(directory/'evaluation')],env,source)
    transformed=execute([sys.executable,str(source/TRANSFORM),'--channel','tzuyang','--crawling-path',str(directory/'crawling'),'--evaluation-path',str(directory/'evaluation')],env,source)
    manifest=output_manifest(directory);events=journal(event_file)
    result={'probe':'provider_process_timeout_then_restart','implementation':'candidate',
            'timeoutExitCode':interrupted['exitCode'],'partialPublishedFiles':len(partial_files),
            'restartExitCode':restarted['exitCode'],'transformExitCode':transformed['exitCode'],
            'evaluationAndTraceEquivalent':manifest['evaluationSha256']==reference['evaluationSha256'] and manifest['transformSha256']==reference['transformSha256'],
            'adminProtectedRowsUnchanged':protected_unchanged(directory,corpus),
            'timeoutProviderStarted':any(e['kind']=='provider-start' for e in timeout_events),**event_summary(events)}
    probes.append(result);write_json(output/'traces/timeout-restart.json',events)
    write_json(output/'fault-probes.json',probes)
    if result['timeoutExitCode']==0 or result['partialPublishedFiles'] or not result['timeoutProviderStarted'] or not result['evaluationAndTraceEquivalent'] or not result['adminProtectedRowsUnchanged'] or restarted['exitCode']:
        raise RuntimeError('TIMEOUT_RESTART_PROBE_FAILED')
    return probes


def paired_summary(observations, metric):
    pairs = {}
    for row in observations:
        pairs.setdefault(row['pair'], {})[row['implementation']] = row[metric]
    before = [v['baseline'] for _, v in sorted(pairs.items())]
    after = [v['candidate'] for _, v in sorted(pairs.items())]
    reductions = [b-a for b, a in zip(before, after)]
    relative = [(b-a)/b*100 if b else None for b, a in zip(before, after)]
    # Paired t interval is reported for n=7, with no population-generalization
    # claim. A deterministic paired percentile bootstrap is an extra sensitivity.
    n = len(reductions)
    mean = statistics.mean(reductions)
    half = 2.446911851 * statistics.stdev(reductions) / n**.5 if n == 7 else None
    rng = random.Random(20261007)
    draws = sorted(statistics.mean(rng.choices(reductions, k=n)) for _ in range(10000))
    return {'pairs': n, 'baselineMean': statistics.mean(before), 'candidateMean': statistics.mean(after),
            'absoluteReductionMean': mean, 'relativeReductionMeanPercent': statistics.mean(relative) if all(v is not None for v in relative) else None,
            'pairedT95CiAbsoluteReduction': [mean-half, mean+half] if half is not None else None,
            'pairedBootstrap95CiAbsoluteReduction': [draws[249], draws[9749]],
            'pairedDifferenceStddev': statistics.stdev(reductions) if n > 1 else None,
            'baselineCvPercent': statistics.stdev(before)/statistics.mean(before)*100 if n > 1 and statistics.mean(before) else None,
            'candidateCvPercent': statistics.stdev(after)/statistics.mean(after)*100 if n > 1 and statistics.mean(after) else None}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--pairs', type=int, default=7, choices=[1, 7])
    args = parser.parse_args()
    output = args.output.resolve(); output.mkdir(parents=True, exist_ok=True)
    (output/'benchmark-source.py').write_bytes(Path(__file__).read_bytes())
    before = corpus_manifest(); write_json(output/'corpus-before.json', before)
    source_before = {relative: sha((ROOT/relative).read_bytes()) for relative in ASSETS}
    corpus = select_corpus()
    observations = []
    reference = None
    with tempfile.TemporaryDirectory(prefix='tzudong-media-orchestration-') as temporary:
        work = Path(temporary)
        source_hashes = freeze(work, output)
        tools = work/'tools'; tools.mkdir()
        (tools/'python').symlink_to(sys.executable)
        for name, source in [('ffmpeg', FFMPEG_WRAPPER), ('node', PROVIDER_WRAPPER),
                             ('gemini', 'raise SystemExit("NETWORK_PROVIDER_DISABLED")\n')]:
            path = tools/name
            if name == 'ffmpeg':
                # Production media deliberately strips non-allowlisted env.
                # Bind the instrument's paths once; do not weaken that boundary.
                source = source.replace("os.environ['REAL_FFMPEG']", repr(str(FFMPEG))).replace("os.environ['REPLAY_JOURNAL']", repr(str(work/'ffmpeg-events.jsonl')))
            path.write_text(f'#!{sys.executable}\n'+source); path.chmod(0o700)
        responses = work/'responses'; responses.mkdir()
        response_hashes = {}
        for row in corpus:
            payload = {key: last(row['archivedEvaluation'])['evaluation_results'][key] for key in EVAL_KEYS}
            data = canonical(payload); (responses/(row['video']+'.json')).write_bytes(data)
            response_hashes[row['video']] = sha(data)
        video = output/'synthetic-source.mp4'
        subprocess.run([str(FFMPEG), '-v', 'error', '-y', '-f', 'lavfi', '-i',
                        'testsrc2=size=640x360:rate=8', '-t', '9', '-c:v', 'libx264',
                        '-threads', '1', '-pix_fmt', 'yuv420p', str(video)], check=True, capture_output=True)
        worker = work/'media-worker.mjs'; worker.write_text(MEDIA_WORKER)
        base_env = {'PATH': f'{tools}:/opt/homebrew/bin:/usr/bin:/bin', 'HOME': os.environ['HOME'],
                    'PYTHONDONTWRITEBYTECODE': '1', 'TZUDONG_PIPELINE_ISOLATED': '1',
                    'GEMINI_API_KEY': 'offline-replay-unusable', 'RUN_DAILY_PYTHON': sys.executable,
                    'LAAJ_BASH': str(BASH), 'FFMPEG_CMD': str(tools/'ffmpeg'),
                    'FFPROBE_CMD': str(FFPROBE), 'REAL_FFMPEG': str(FFMPEG),
                    'REPLAY_RESPONSES': str(responses), 'LAAJ_PARSE_RETRY_SLEEP_SEC': '0'}
        for pair in range(args.pairs):
            for implementation in (['baseline', 'candidate'] if pair % 2 == 0 else ['candidate', 'baseline']):
                directory = work/f'data-{pair}-{implementation}'; setup_data(directory, corpus)
                source = work/implementation
                for phase in ['cold', 'restart']:
                    ffmpeg_offset = len(journal(work/'ffmpeg-events.jsonl'))
                    events_file = work/f'events-{pair}-{implementation}-{phase}.jsonl'
                    env = {**base_env, 'REPLAY_JOURNAL': str(events_file),
                           'LAAJ_FALLBACK_LOCK_PATH': str(work/'fallback.json')}
                    media = execute([str(NODE), str(worker), str(source/MEDIA), str(video), str(directory/'frames')], env, source)
                    laaj = execute([str(BASH), str(source/LAAJ), '--channel', 'tzuyang', '--crawling-path', str(directory/'crawling'), '--evaluation-path', str(directory/'evaluation')], env, source)
                    transform = execute([sys.executable, str(source/TRANSFORM), '--channel', 'tzuyang', '--crawling-path', str(directory/'crawling'), '--evaluation-path', str(directory/'evaluation')], env, source)
                    if any(r['exitCode'] != 0 for r in [media, laaj, transform]):
                        failure = {'pair': pair, 'implementation': implementation, 'phase': phase, 'media': media, 'laaj': laaj, 'transform': transform}
                        write_json(output/'failure.json', failure)
                        raise RuntimeError('REPLAY_STAGE_FAILED_SEE_FAILURE_JSON')
                    manifest = output_manifest(directory)
                    frames = media.pop('result'); laaj.pop('result'); transform.pop('result')
                    if frames is None:
                        raise RuntimeError('MEDIA_RESULT_MISSING')
                    manifest['frameSha256'] = sha(canonical(frames['manifest']))
                    manifest['frames'] = frames['frameCount']
                    manifest['failedSegments'] = frames['failedSegments']
                    comparable = {k: manifest[k] for k in ['evaluationSha256', 'transformSha256', 'traceIds', 'frameSha256', 'frames', 'failedSegments', 'duplicates', 'rows']}
                    if reference is None: reference = comparable
                    events = sorted(journal(events_file) + journal(work/'ffmpeg-events.jsonl')[ffmpeg_offset:], key=lambda x: x['at'])
                    summaries = event_summary(events)
                    record = {'pair': pair, 'implementation': implementation, 'phase': phase,
                              'wallMs': sum(r['wallMs'] for r in [media,laaj,transform]),
                              'cpuMs': sum(r['cpuMs'] for r in [media,laaj,transform]),
                              'peakTreeRssMiB': max(r['peakTreeRssMiB'] for r in [media,laaj,transform]),
                              'media': media, 'laaj': laaj, 'transform': transform,
                              **summaries, 'outputs': manifest, 'exactOutputEquivalent': comparable == reference}
                    record['adminProtectedRowsUnchanged'] = protected_unchanged(directory,corpus)
                    observations.append(record)
                    write_json(output/'raw.json', observations)
                    write_json(output/f'traces/pair-{pair}-{implementation}-{phase}.json', events)
                    write_json(output/f'manifests/pair-{pair}-{implementation}-{phase}.json', frames['manifest'])
                    if not record['exactOutputEquivalent']:
                        raise RuntimeError('EXACT_OUTPUT_EQUIVALENCE_FAILED')
                    if not record['adminProtectedRowsUnchanged']:
                        raise RuntimeError('ADMIN_PROTECTED_ROW_CHANGED')
                    if implementation == 'candidate' and summaries['exactPeakFfmpegCommands'] > 4:
                        raise RuntimeError('MEDIA_RESOURCE_LIMIT_EXCEEDED')
                print(json.dumps({'pairedRun': pair+1, 'implementation': implementation, 'complete': True}), flush=True)
        probes=fault_probes(work,output,corpus,base_env,worker,video,reference)
        config = {'kind': 'bounded_real_ffmpeg_archived_provider_orchestration_replay',
                  'liveEvidenceEligible': False, 'fullEndToEndGoalComplete': False,
                  'baselineCommit': BASELINE, 'candidateHead': subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip(),
                  'sourceHashes': source_hashes, 'archivedResponseSha256': response_hashes,
                  'selectedCorpus': [{key: str(p.relative_to(ORIGINAL)) if isinstance(p,Path) else p for key,p in row.items()} for row in corpus],
                  'syntheticMediaSha256': sha(video.read_bytes()), 'mediaIsOriginalVideo': False,
                  'sourceSelection': 'first three eligible non-hyphen-leading IDs in sorted original corpus',
                  'excludedIdsNote': 'Leading-hyphen IDs are outside this bounded sample; this is not evidence of a parser defect.',
                  'environment': {'python':sys.version, 'node':subprocess.check_output([str(NODE),'--version'],text=True).strip(),
                                  'ffmpeg':subprocess.check_output([str(FFMPEG),'-version'],text=True).splitlines()[0],
                                  'platform':platform.platform(), 'cpuCount':os.cpu_count(),
                                  'samplingIntervalMinimumMs':20, 'mediaDefaultCap':4,
                                  'providerProductionCapChanged':False, 'laajDefaultJobs':1},
                  'dependenciesLockSha256':sha((ORIGINAL/'backend/node_modules/.package-lock.json').read_bytes()),
                  'externalNetworkCalls':0, 'actualProviderTokens':0, 'paidCalls':0, 'operatingDbWrites':0,
                  'providerReplaySkipsNodeSdkAndAdmission':True,'fullProviderBudgetLatencyVerified':False,
                  'absoluteTimeReductionAdmittedForProduction':False,
                  'modelsChanged':False, 'corpusOriginalReadOnly':True,
                  'measurementScope':'separate actual subprocess durations summed, excludes fixture setup, includes process startup and 20ms sampler; cold and restart separate',
                  'statisticalScope':'seven alternating paired samples on one shared macOS host; 95% paired-t and seeded paired bootstrap intervals; no multiple-comparison correction',
                  'noiseBudget':{'maxCvPercent':20, 'minimumAbsoluteWallReductionMs':50, 'minimumRelativeWallReductionPercent':5},
                  'remainingGaps':['actual provider latency/tokens/accuracy and stochastic consistency', 'original-video media dataset',
                                   'parallel LAAJ at an unchanged admitted production budget', 'worker full graph and whole-worker interruption recovery',
                                   'storage RPC and rendered admin within the same timed run']}
        write_json(output/'configuration.json', config)
    after = corpus_manifest(); write_json(output/'corpus-after.json', after)
    if before != after: raise RuntimeError('ORIGINAL_CORPUS_CHANGED')
    if source_before != {relative:sha((ROOT/relative).read_bytes()) for relative in ASSETS}:
        raise RuntimeError('CANDIDATE_SOURCE_CHANGED_DURING_EXPERIMENT')
    summary = {phase:{metric:paired_summary([r for r in observations if r['phase']==phase],metric)
                      for metric in ['wallMs','cpuMs','peakTreeRssMiB','ffmpegCalls','evaluationReplayCalls']}
               for phase in ['cold','restart']}
    write_json(output/'summary.json', summary)
    write_json(output/'validation.json', {'pairs':args.pairs,'observations':len(observations),
               'originalCorpusUnchanged':True,'sourceUnchanged':True,
               'exactOutputsAllEqual':all(x['exactOutputEquivalent'] for x in observations),
               'adminProtectedRowsUnchanged':all(x['adminProtectedRowsUnchanged'] for x in observations),
               'faultProbes':len(probes),
               'duplicates':max(x['outputs']['duplicates'] for x in observations),
               'candidatePeakFfmpeg':max(x['exactPeakFfmpegCommands'] for x in observations if x['implementation']=='candidate'),
               'liveEvidenceEligible':False,'fullEndToEndGoalComplete':False})
    paths = [p for p in sorted(output.rglob('*')) if p.is_file() and p.name not in ['artifact-map.json','artifact-map.json.sha256']]
    mapping = {str(p.relative_to(output)):sha(p.read_bytes()) for p in paths}
    write_json(output/'artifact-map.json', mapping)
    (output/'artifact-map.json.sha256').write_text(sha((output/'artifact-map.json').read_bytes())+'\n')
    print(json.dumps({'completed':True,'output':str(output),'corpusUnchanged':True}), flush=True)


if __name__ == '__main__':
    main()
