"""Content-addressed stage receipts. Never trust output existence alone.

Receipts contain hashes only. JSONL inputs are latest-record oriented; volatile
YouTube counters are ignored only for inputs explicitly marked as metadata.
The caller owns validation and writes outputs before publishing a receipt.
"""
from __future__ import annotations

import argparse
from contextlib import contextmanager
import hashlib
import json
import os
import subprocess
import sys
from pathlib import Path
import tempfile
from typing import Iterator

from .jsonl_utils import load_last_jsonl_record

VOLATILE_META_FIELDS = frozenset({
    "viewCount", "likeCount", "commentCount", "view_count", "like_count",
    "comment_count", "statistics", "stats", "collected_at", "updated_at",
})


def digest_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def canonical_digest(value: object) -> str:
    return digest_bytes(json.dumps(value, ensure_ascii=False, sort_keys=True,
                                  separators=(",", ":"), allow_nan=False).encode())


def input_digest(path: Path, *, metadata: bool = False, latest: bool = True) -> str:
    if not path.is_file():
        raise ValueError("stage_input_missing")
    if latest and path.suffix == ".jsonl":
        value = load_last_jsonl_record(path, strict_utf8=True)
        if not isinstance(value, dict):
            raise ValueError("stage_input_invalid")
        if metadata:
            value = {key: val for key, val in value.items() if key not in VOLATILE_META_FIELDS}
        return canonical_digest(value)
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for block in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def fingerprint(inputs: list[Path], *, assets: list[Path] = (),
                metadata: list[Path] = (), settings: object = None,
                asset_digests: list[str] | None = None) -> str:
    return canonical_digest({
        "inputs": [input_digest(path) for path in inputs],
        "metadata": [input_digest(path, metadata=True) if path.is_file() else None for path in metadata],
        "assets": asset_digests if asset_digests is not None else [input_digest(path) for path in assets],
        "settings": settings,
    })


def atomic_write(path: Path, data: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary = tempfile.mkstemp(prefix=".stage-", dir=path.parent)
    try:
        with os.fdopen(descriptor, "wb") as target:
            target.write(data)
            target.flush()
            os.fsync(target.fileno())
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def reusable(receipt: Path, expected: str, outputs: list[Path]) -> bool:
    try:
        data = json.loads(receipt.read_bytes())
        return (data.get("schemaVersion") == 1 and data.get("inputHash") == expected
                and data.get("outputs") == [input_digest(path) for path in outputs]
                and bool(outputs))
    except (OSError, ValueError, TypeError, AttributeError):
        return False


def complete(receipt: Path, expected: str, outputs: list[Path]) -> None:
    if not outputs:
        raise ValueError("stage_outputs_missing")
    atomic_write(receipt, json.dumps({"schemaVersion": 1, "inputHash": expected,
                                     "outputs": [input_digest(path) for path in outputs]},
                                    sort_keys=True).encode() + b"\n")


@contextmanager
def stage_lock(receipt: Path) -> Iterator[int]:
    """Single writer; POSIX callers may pass the descriptor to a live child."""
    receipt.parent.mkdir(parents=True, exist_ok=True)
    with receipt.with_suffix(receipt.suffix + ".lock").open("a+b") as handle:
        if os.name == "nt":
            import msvcrt
            handle.write(b"\0")
            handle.flush()
            handle.seek(0)
            msvcrt.locking(handle.fileno(), msvcrt.LK_LOCK, 1)
            try:
                yield handle.fileno()
            finally:
                handle.seek(0)
                msvcrt.locking(handle.fileno(), msvcrt.LK_UNLCK, 1)
        else:
            import fcntl
            fcntl.flock(handle, fcntl.LOCK_EX)
            try:
                yield handle.fileno()
            finally:
                fcntl.flock(handle, fcntl.LOCK_UN)


STAGE_REUSED_EXIT = 10


def run_stage(receipt: Path, inputs: list[Path], outputs: list[Path], command: list[str], *,
              metadata: list[Path] = (), assets: list[Path] = (), settings: object = None,
              force: bool = False) -> int:
    """Own the lock across admission, child execution and receipt publication."""
    if not command:
        raise ValueError('stage_command_missing')
    with stage_lock(receipt):
        expected=fingerprint(inputs,metadata=metadata,assets=assets,settings=settings)
        if not force and reusable(receipt,expected,outputs):
            return STAGE_REUSED_EXIT
        env=os.environ.copy()
        env['TZUDONG_STAGE_LOCK_RECEIPT']=str(receipt.resolve())
        result=subprocess.run(command,env=env,check=False)
        if result.returncode:
            return result.returncode
        if fingerprint(inputs,metadata=metadata,assets=assets,settings=settings)!=expected:
            return 1
        complete(receipt,expected,outputs)
        return 0


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("action", choices=("check", "complete", "fingerprint", "scan", "run"))
    parser.add_argument("--receipt", type=Path, required=True)
    parser.add_argument("--input", type=Path, action="append", default=[])
    parser.add_argument("--metadata", type=Path, action="append", default=[])
    parser.add_argument("--asset", type=Path, action="append", default=[])
    parser.add_argument("--output", type=Path, action="append", required=True)
    parser.add_argument("--setting", action="append", default=[])
    parser.add_argument("--expected", default=None)
    parser.add_argument("--scan-dir", type=Path)
    parser.add_argument("--force", action='store_true')
    argv=sys.argv[1:]
    separator=argv.index('--') if '--' in argv else len(argv)
    args = parser.parse_args(argv[:separator])
    try:
        if args.action == 'run':
            return run_stage(args.receipt,args.input,args.output,argv[separator+1:],
                             metadata=args.metadata,assets=args.asset,settings=args.setting,force=args.force)
        if args.action == "scan":
            if args.scan_dir is None:
                return 1
            asset_digests = [input_digest(path) for path in args.asset]
            import re
            for source in sorted(args.scan_dir.glob("*.jsonl")):
                item = source.stem
                if not re.fullmatch(r"[A-Za-z0-9_-]{1,64}", item):
                    return 1
                substitute = lambda path: Path(str(path).replace("{id}", item))
                try:
                    expected = fingerprint([substitute(path) for path in args.input],
                                           metadata=[substitute(path) for path in args.metadata],
                                           assets=args.asset, asset_digests=asset_digests, settings=args.setting)
                    valid = reusable(substitute(args.receipt), expected, [substitute(path) for path in args.output])
                except (OSError, ValueError, TypeError):
                    valid = False
                if not valid:
                    print(item)
            return 0
        expected = fingerprint(args.input, metadata=args.metadata,
                               assets=args.asset, settings=args.setting)
        if args.expected is not None and args.expected != expected:
            return 1
        if args.action == "fingerprint":
            print(expected)
            return 0
        if args.action == "check":
            return 0 if reusable(args.receipt, expected, args.output) else 1
        complete(args.receipt, expected, args.output)
        return 0
    except (OSError, ValueError, TypeError):
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
