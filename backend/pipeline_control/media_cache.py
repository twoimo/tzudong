"""Run-owned media reuse; configured/shared user caches are never removed."""
from contextlib import contextmanager
import os
from pathlib import Path
import re
import shutil
import json
from backend.utils.stage_cache import atomic_write
from backend.pipeline_control.graph import AdapterGraphError


@contextmanager
def owned_media_cache(run_id: str, *, enabled: bool, root: Path | None = None):
    if not enabled or os.environ.get('VIDEO_CACHE_DIR'):
        yield lambda outcome=None: None
        return
    if not re.fullmatch(r'[A-Za-z0-9_-]{1,64}', run_id):
        raise AdapterGraphError('media_cache_run_invalid')
    backend = Path(__file__).resolve().parents[1]
    # Legacy scripts may read path settings from .env after worker preflight.
    # Detect that setting without loading or logging any credentials.
    if root is None:
        for env_path in [backend / '.env', backend / '.env.local']:
            if env_path.is_file() and any(re.match(r'\s*(?:export\s+)?VIDEO_CACHE_DIR\s*=\s*.+', line) for line in env_path.read_text().splitlines()):
                yield lambda outcome=None: None
                return
    base = root or backend / 'restaurant-crawling' / 'temp' / 'run-cache'
    cache = base / run_id
    base.mkdir(parents=True, exist_ok=True)
    if base.is_symlink() or cache.is_symlink():
        raise AdapterGraphError('media_cache_path_invalid')
    cache.mkdir(exist_ok=True)
    owner = cache / '.owner.json'
    if owner.is_file():
        try:
            valid_owner = json.loads(owner.read_bytes()) == {"runId":run_id,"schemaVersion":1}
        except (OSError,ValueError): valid_owner = False
        if not valid_owner: raise AdapterGraphError('media_cache_owner_invalid')
    elif any(cache.iterdir()):
        raise AdapterGraphError('media_cache_owner_missing')
    else:
        atomic_write(owner,json.dumps({"runId":run_id,"schemaVersion":1}).encode())
    previous = os.environ.get('PIPELINE_SHARED_VIDEO_CACHE_DIR')
    previous_owner = os.environ.get('PIPELINE_OWNED_VIDEO_CACHE_RUN_ID')
    os.environ['PIPELINE_OWNED_VIDEO_CACHE_RUN_ID'] = run_id
    os.environ['VIDEO_CACHE_DIR'] = str(cache.resolve())
    os.environ['PIPELINE_SHARED_VIDEO_CACHE_DIR'] = str(backend / 'restaurant-crawling' / 'data' / 'video_cache')

    def completed(outcome="Succeeded"):
        # This directory belongs to exactly one run, which the store locks.
        # Only Paused may resume; terminal owned caches are no longer reusable.
        if outcome == "Paused": return
        if outcome not in {"Succeeded", "Failed", "Cancelled"}: raise AdapterGraphError("media_cache_outcome_invalid")
        if cache.is_symlink() or cache.resolve().parent != base.resolve():
            raise AdapterGraphError('media_cache_path_invalid')
        if json.loads(owner.read_bytes()) != {"runId":run_id,"schemaVersion":1}:
            raise AdapterGraphError('media_cache_owner_invalid')
        shutil.rmtree(cache)

    try:
        yield completed
    except BaseException:
        try: completed("Failed")
        except (OSError, ValueError, AdapterGraphError): pass
        raise
    finally:
        os.environ.pop('VIDEO_CACHE_DIR', None)
        if previous_owner is None: os.environ.pop('PIPELINE_OWNED_VIDEO_CACHE_RUN_ID', None)
        else: os.environ['PIPELINE_OWNED_VIDEO_CACHE_RUN_ID'] = previous_owner
        if previous is None:
            os.environ.pop('PIPELINE_SHARED_VIDEO_CACHE_DIR', None)
        else:
            os.environ['PIPELINE_SHARED_VIDEO_CACHE_DIR'] = previous
