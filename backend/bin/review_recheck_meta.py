#!/usr/bin/env python3
"""Repair missing metadata for one registered video in owned review scratch.

No Gemini, hosted writes, persistent logs, or changes to the canonical corpus.
Exit codes match run_restaurant_review_automation.SOURCE_ADAPTER_EXITS.
"""
from __future__ import annotations

import importlib.util
from pathlib import Path
import re
import sys

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
from backend.bin.run_restaurant_review_automation import review_target, WorkerFailure


class QuietLogger:
    def __getattr__(self, _name):
        return lambda *_args, **_kwargs: None


def load_collector():
    script = ROOT / 'backend/restaurant-crawling/scripts/02-collect-meta.py'
    spec = importlib.util.spec_from_file_location('review_metadata_collector', script)
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def repair_metadata(channel, video_id, data_path, *, collector=None):
    try:
        if not isinstance(channel, str) or not channel:
            return 24
        target = review_target(channel)
    except WorkerFailure:
        return 24
    if not isinstance(video_id, str) or not re.fullmatch(r'[A-Za-z0-9_-]{11}', video_id):
        return 23
    try:
        module = collector or load_collector()
        if module.get_channel_info(channel).get('channel_id') != target['channel_id']:
            return 24
        module.collect_channel_meta(channel, None, None, QuietLogger(), video_id=video_id,
                                    review_data_path=Path(data_path))
        row = module.get_latest_meta(Path(data_path), video_id)
        if (not isinstance(row, dict) or row.get('youtube_link') != f'https://www.youtube.com/watch?v={video_id}'
                or row.get('channel_name') != channel or row.get('channel_id') != target['channel_id']):
            return 20
        return 0
    except Exception as error:
        code = str(error) if type(error).__name__ == 'ScopedMetadataError' else ''
        if code == 'metadata_identity_mismatch': return 20
        if code == 'metadata_provider_transient' or isinstance(error, (TimeoutError, ConnectionError)): return 21
        if code.startswith('metadata_channel_'): return 24
        if code in ('metadata_review_path_invalid', 'metadata_provider_output_invalid',
                    'metadata_checkpoint_invalid', 'metadata_video_id_invalid'): return 23
        return 22


def main(argv=None):
    args = sys.argv[1:] if argv is None else argv
    result = repair_metadata(*args) if len(args) == 3 else 23
    if result: print('REVIEW_METADATA_REPAIR_UNCONFIRMED', file=sys.stderr)
    return result


if __name__ == '__main__':
    raise SystemExit(main())
