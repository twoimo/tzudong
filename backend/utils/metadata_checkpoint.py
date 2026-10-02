"""Integrity-bound metadata completion; no provider keys or responses in receipts."""
from datetime import datetime
import re
from pathlib import Path
from .jsonl_utils import load_last_jsonl_record
from .stage_cache import canonical_digest


def latest_metadata(path: Path, video_id: str):
    try:
        row = load_last_jsonl_record(path)
        if not isinstance(row, dict) or not re.fullmatch(r'[A-Za-z0-9_-]{11}', video_id):
            return None
        if row.get('youtube_link') != f'https://www.youtube.com/watch?v={video_id}':
            return None
        if not isinstance(row.get('title'), str) or not row['title'].strip():
            return None
        if not isinstance(row.get('description', ''), str) or not isinstance(row.get('stats'), dict):
            return None
        if type(row.get('duration')) not in (int, float) or row['duration'] < 0:
            return None
        if type(row.get('recollect_id')) is not int or row['recollect_id'] < 0:
            return None
        collected = datetime.fromisoformat(row['collected_at'].replace('Z', '+00:00'))
        if collected.tzinfo is None:
            return None
        # Reject nonfinite numbers as well as partial/truncated records.
        canonical_digest(row)
        return row
    except (OSError, ValueError, TypeError, KeyError, AttributeError):
        return None


def checkpoint(day: str, recipe: str, metadata: dict):
    return {'schemaVersion': 1, 'day': day, 'recipe': recipe, 'outputHash': canonical_digest(metadata)}


def verified_today(entry, day: str, recipe: str, metadata) -> bool:
    if not isinstance(metadata, dict) or not isinstance(entry, dict):
        return False
    return entry == checkpoint(day, recipe, metadata)


def last_sequence(path: Path, video_id: str):
    """Recover the prior sequence when a damaged tail needs repair; never reuse its body."""
    sequence = None
    try:
        import json
        with path.open(encoding='utf-8') as source:
            for line in source:
                try:
                    row = json.loads(line)
                    value = row.get('recollect_id')
                    if row.get('youtube_link') == f'https://www.youtube.com/watch?v={video_id}' and type(value) is int and 0 <= value < 2_147_483_647:
                        sequence = max(sequence if sequence is not None else 0, value)
                except (ValueError, TypeError, AttributeError):
                    continue
    except (OSError, UnicodeError):
        pass
    return sequence


def append_metadata(path: Path, row: dict):
    """Caller holds the channel lock. Preserve a damaged tail as a separate line."""
    import json
    import os
    encoded = json.dumps(row, ensure_ascii=False, allow_nan=False).encode('utf-8') + b'\n'
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open('a+b') as output:
        output.seek(0, os.SEEK_END)
        if output.tell():
            output.seek(-1, os.SEEK_END)
            if output.read(1) != b'\n':
                output.write(b'\n')
        output.write(encoded)
        output.flush()
        os.fsync(output.fileno())
