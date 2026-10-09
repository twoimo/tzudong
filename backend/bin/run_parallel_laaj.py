#!/usr/bin/env python3
"""Bounded per-video LAAJ subprocesses; existing script owns provider fallback."""
import argparse
from concurrent.futures import FIRST_COMPLETED, ThreadPoolExecutor, wait
import json
import os
from pathlib import Path
import re
import signal
import subprocess
import sys
import threading
import tempfile

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from backend.utils.jsonl_utils import load_last_jsonl_record
from backend.utils.stage_cache import certified, retire_outputs, reusable, stage_lock
from backend.utils.provider_budget import budget_path

FALLBACK_LOCK_STATE = threading.local()


def eligible(video, evaluation, crawling):
    output = evaluation / 'evaluation' / 'rule_results' / (video + '.jsonl')
    if not certified(output.parent / '.receipts' / (video + '.json'), [output]):
        return False
    rule = load_last_jsonl_record(output)
    transcript = load_last_jsonl_record(crawling / 'transcript' / (video + '.jsonl'))
    return bool(rule and any(value is True for value in rule.get('evaluation_target', {}).values())
                and transcript and transcript.get('transcript'))


def validated_items(ids, max_items=None):
    ids = list(dict.fromkeys(ids))
    if any(not re.fullmatch(r'[A-Za-z0-9_-]{1,64}', item) for item in ids):
        raise ValueError('LAAJ_ID_INVALID')
    if max_items is not None and max_items < 0:
        raise ValueError('LAAJ_LIMIT_INVALID')
    return ids


def select_items(ids, evaluation, crawling, max_items=None):
    """The live limit counts eligible videos, as in the sequential path."""
    ids = validated_items(ids, max_items)
    selected = [video for video in ids if eligible(video, evaluation, crawling)]
    return selected if max_items is None else selected[:max_items]


def prepare_items(ids, evaluation, crawling, max_items=None):
    """Retire omitted results under the producer lock order before admission."""
    ids = validated_items(ids, max_items)
    selected = []
    for video in ids:
        selection = evaluation / 'evaluation/selection/.receipts' / (video + '.json')
        rule = evaluation / 'evaluation/rule_results/.receipts' / (video + '.json')
        receipt = evaluation / 'evaluation/laaj_results/.receipts' / (video + '.json')
        with stage_lock(selection), stage_lock(rule), stage_lock(receipt):
            if not eligible(video, evaluation, crawling):
                retire_outputs([receipt.parent.parent / (video + '.jsonl'), receipt])
            else:
                selected.append(video)
    return selected if max_items is None else selected[:max_items]


def parse_usage(source):
    counts = {}
    # Provider diagnostics stay private and never become an unbounded string.
    for line in iter(lambda: source.readline(4096), b''):
        if not line.startswith(b'GEMINI_USAGE '):
            continue
        try:
            for key, value in json.loads(line.removeprefix(b'GEMINI_USAGE ')).items():
                if (key in {'promptTokenCount','candidatesTokenCount','totalTokenCount','cachedContentTokenCount'}
                    and type(value) is int and value >= 0):
                    counts[key] = counts.get(key, 0) + value
        except (ValueError, TypeError, AttributeError):
            pass
    return counts


def run_video(video, args, *, fallback=False):
    receipt = args.evaluation_path / 'evaluation' / 'laaj_results' / '.receipts' / (video + '.json')
    output = receipt.parent.parent / (video + '.jsonl')
    env = {**os.environ, 'LAAJ_CHILD': 'sequential' if fallback else '1',
           'LAAJ_SKIP_HEALTH_CHECK': ('1' if getattr(FALLBACK_LOCK_STATE,'health_passed',False) else '0') if fallback else '1'}
    if fallback:
        env.update({'GEMINI_MAX_INFLIGHT': '1', 'USE_OAUTH': 'true'})
        if getattr(FALLBACK_LOCK_STATE,'health_file',None): env['LAAJ_HEALTH_SUCCESS_FILE']=str(FALLBACK_LOCK_STATE.health_file)
    command = [os.environ.get('LAAJ_BASH', 'bash'), str(args.script), '--channel', args.channel,
               '--crawling-path', str(args.crawling_path), '--evaluation-path', str(args.evaluation_path), '--video-id', video]
    selection = args.evaluation_path / 'evaluation/selection/.receipts' / (video + '.json')
    rule = args.evaluation_path / 'evaluation/rule_results/.receipts' / (video + '.json')
    with stage_lock(selection) as selection_fd, stage_lock(rule) as rule_fd, stage_lock(receipt) as descriptor:
        if not eligible(video, args.evaluation_path, args.crawling_path):
            retire_outputs([output, receipt])
            return 0, {}
        descriptors=(selection_fd, rule_fd, descriptor)
        if fallback and getattr(FALLBACK_LOCK_STATE,'descriptor',None) is not None:
            descriptors+=(FALLBACK_LOCK_STATE.descriptor,)
        inherited = {'pass_fds': descriptors} if os.name != 'nt' else {}
        process = subprocess.Popen(command, env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, start_new_session=os.name != 'nt', **inherited)
        captured = []
        reader = threading.Thread(target=lambda: captured.append(parse_usage(process.stdout)), daemon=True)
        reader.start()
        try:
            code = process.wait(timeout=args.process_timeout)
        except subprocess.TimeoutExpired:
            if os.name == 'nt':
                process.terminate()
            else:
                os.killpg(process.pid, signal.SIGTERM)
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                if os.name == 'nt': process.kill()
                else: os.killpg(process.pid, signal.SIGKILL)
                process.wait()
            code = 1
        reader.join(timeout=5)
        if reader.is_alive(): raise TimeoutError('LAAJ_OUTPUT_DRAIN_TIMEOUT')
        process.stdout.close()
        counts = captured[0] if captured else {}
        if code == 0:
            try:
                expected = json.loads(receipt.read_bytes())['inputHash']
                if not isinstance(expected, str) or not reusable(receipt, expected, [output]): code = 1
            except (OSError, ValueError, KeyError, TypeError):
                code = 1
        return code, counts


def run_jobs(ids, args, runner=run_video):
    usage, failures, deferred, peak_pending = {}, 0, [], 0
    def consume(video, result):
        nonlocal failures
        code, counts = result
        if code == 75: deferred.append(video)
        else: failures += code != 0
        for key, value in counts.items(): usage[key] = usage.get(key, 0) + value

    iterator = iter([] if getattr(args,'oauth_only',False) else ids)
    if getattr(args,'oauth_only',False): deferred.extend(ids)
    if args.jobs==1:
        for video in iterator:
            result=runner(video,args)
            consume(video,result)
            peak_pending=1
            if result[0]==75:
                deferred.extend(iterator)
                break
    else:
        with ThreadPoolExecutor(max_workers=args.jobs) as pool:
            pending = {}
            def refill():
                nonlocal peak_pending
                while len(pending) < args.jobs:
                    video = next(iterator, None)
                    if video is None: break
                    pending[pool.submit(runner, video, args)] = video
                peak_pending = max(peak_pending, len(pending))
            refill()
            while pending:
                completed, _ = wait(pending, return_when=FIRST_COMPLETED)
                for future in completed:
                    video = pending.pop(future)
                    try: consume(video, future.result())
                    except (OSError, ValueError): failures += 1
                refill()
    # API exhaustion and invalid responses must not multiply OAuth concurrency.
    # Cross-run fallback serialization shares a lock within the runtime.
    fallback_receipt = Path(os.getenv('LAAJ_FALLBACK_LOCK_PATH',
        str(budget_path().parent / 'laaj-fallback.json')))
    if deferred:
        with stage_lock(fallback_receipt) as descriptor:
            FALLBACK_LOCK_STATE.descriptor=descriptor
            try:
                with tempfile.TemporaryDirectory(prefix='tzudong-fallback-health-') as temp:
                    FALLBACK_LOCK_STATE.health_file = Path(temp) / 'passed'
                    FALLBACK_LOCK_STATE.health_passed = False
                    for index, video in enumerate(deferred):
                        code, counts = runner(video, args, fallback=True)
                        if FALLBACK_LOCK_STATE.health_file.is_file():
                            FALLBACK_LOCK_STATE.health_passed = FALLBACK_LOCK_STATE.health_file.read_bytes() == b'passed\n'
                        failures += code != 0
                        for key, value in counts.items(): usage[key] = usage.get(key, 0) + value
                        if code != 0 and not FALLBACK_LOCK_STATE.health_passed:
                            failures += len(deferred) - index - 1
                            break
            finally:
                FALLBACK_LOCK_STATE.descriptor=None
                FALLBACK_LOCK_STATE.health_file=None
                FALLBACK_LOCK_STATE.health_passed=False
    return {'operation':'parallel_laaj_complete','items':len(ids),'failures':failures,'jobs':args.jobs,
            'fallbackItems':len(deferred),'peakPendingJobs':peak_pending,'knownTokenUsage':usage}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('action', choices=['eligible-count', 'run'])
    parser.add_argument('--jobs', type=int, default=1)
    parser.add_argument('--channel', required=True)
    parser.add_argument('--crawling-path', type=Path, required=True)
    parser.add_argument('--evaluation-path', type=Path, required=True)
    parser.add_argument('--script', type=Path, required=True)
    parser.add_argument('--max-items', type=int)
    parser.add_argument('--process-timeout', type=float, default=1800)
    parser.add_argument('--oauth-only', action='store_true')
    args = parser.parse_args()
    if not 1 <= args.jobs <= 8: raise ValueError('LAAJ_JOBS_INVALID')
    if not 0 < args.process_timeout <= 3600: raise ValueError('LAAJ_TIMEOUT_INVALID')
    candidates = [line.strip() for line in sys.stdin if line.strip()]
    if args.action == 'eligible-count':
        print(len(select_items(candidates, args.evaluation_path, args.crawling_path, args.max_items)))
        return 0
    ids = prepare_items(candidates, args.evaluation_path, args.crawling_path, args.max_items)
    result = run_jobs(ids, args)
    print(json.dumps(result,sort_keys=True))
    return 1 if result['failures'] else 0


if __name__ == '__main__':
    try:
        raise SystemExit(main())
    except (OSError, ValueError):
        raise SystemExit('PARALLEL_LAAJ_FAILED') from None
