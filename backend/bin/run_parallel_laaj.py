#!/usr/bin/env python3
"""Bounded per-video LAAJ subprocesses; existing script owns provider fallback."""
import argparse
from concurrent.futures import ThreadPoolExecutor, as_completed
import json
import os
from pathlib import Path
import re
import subprocess
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from backend.utils.jsonl_utils import load_last_jsonl_record
from backend.utils.stage_cache import stage_lock


def eligible(video, evaluation, crawling):
    rule = load_last_jsonl_record(evaluation / 'evaluation' / 'rule_results' / (video + '.jsonl'))
    transcript = load_last_jsonl_record(crawling / 'transcript' / (video + '.jsonl'))
    return bool(rule and any(value is True for value in rule.get('evaluation_target', {}).values())
                and transcript and transcript.get('transcript'))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('action', choices=['eligible-count', 'run'])
    parser.add_argument('--jobs', type=int, default=1)
    parser.add_argument('--channel', required=True)
    parser.add_argument('--crawling-path', type=Path, required=True)
    parser.add_argument('--evaluation-path', type=Path, required=True)
    parser.add_argument('--script', type=Path, required=True)
    parser.add_argument('--max-items', type=int)
    args = parser.parse_args()
    if not 1 <= args.jobs <= 8: raise ValueError('LAAJ_JOBS_INVALID')
    ids = [line.strip() for line in sys.stdin if line.strip()]
    if any(not re.fullmatch(r'[A-Za-z0-9_-]{1,64}', item) for item in ids): raise ValueError('LAAJ_ID_INVALID')
    ids = list(dict.fromkeys(ids))
    if args.max_items is not None:
        if args.max_items < 0: raise ValueError('LAAJ_LIMIT_INVALID')
        ids = ids[:args.max_items]
    if args.action == 'eligible-count':
        print(sum(eligible(video, args.evaluation_path, args.crawling_path) for video in ids))
        return 0
    usage = {}
    failures = 0
    def process(video):
        receipt = args.evaluation_path / 'evaluation' / 'laaj_results' / '.receipts' / (video + '.json')
        with stage_lock(receipt):
            result = subprocess.run(['bash', str(args.script), '--channel', args.channel,
                '--crawling-path', str(args.crawling_path), '--evaluation-path', str(args.evaluation_path), '--video-id', video],
                env={**os.environ, 'LAAJ_CHILD': '1', 'LAAJ_SKIP_HEALTH_CHECK': '1'},
                stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
        counts = {}
        for line in result.stdout.splitlines():
            if line.startswith('GEMINI_USAGE '):
                try:
                    for key, value in json.loads(line.removeprefix('GEMINI_USAGE ')).items():
                        if key in {'promptTokenCount','candidatesTokenCount','totalTokenCount','cachedContentTokenCount'} and isinstance(value,int) and value >= 0:
                            counts[key] = counts.get(key, 0) + value
                except (ValueError, TypeError):
                    pass
        return result.returncode, counts
    with ThreadPoolExecutor(max_workers=args.jobs) as pool:
        for future in as_completed([pool.submit(process, video) for video in ids]):
            code, counts = future.result()
            failures += code != 0
            for key, value in counts.items(): usage[key] = usage.get(key, 0) + value
    print(json.dumps({'operation':'parallel_laaj_complete','items':len(ids),'failures':failures,'jobs':args.jobs,'knownTokenUsage':usage},sort_keys=True))
    return 1 if failures else 0


if __name__ == '__main__':
    try:
        raise SystemExit(main())
    except (OSError, ValueError):
        raise SystemExit('PARALLEL_LAAJ_FAILED') from None
