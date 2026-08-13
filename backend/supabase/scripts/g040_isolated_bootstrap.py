#!/usr/bin/env python3
"""Execute a verified G040 entrypoint without importing checkout-local bytes first."""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import stat
import subprocess
import sys
import types
from pathlib import Path, PurePosixPath

COMMIT_RE = re.compile(r"^[0-9a-f]{40}$")
MANIFEST_PATH = ".github/g034-hosted-migration-closure.v1.json"
DOMAIN = b"g040-recovery-source-root-v1\x00"
RUNTIME_FILES = (
    "backend/supabase/scripts/g040_prefix_recovery.py", "backend/supabase/scripts/g040_recovery_authorization.py",
    "backend/supabase/scripts/g040_reverse_00400.py", "backend/supabase/scripts/g040_recovery_source.py",
    "backend/supabase/scripts/g040_isolated_bootstrap.py", "backend/supabase/scripts/g040_reference_evidence.py",
    "backend/supabase/scripts/g040_production_controller.py", "backend/supabase/scripts/g040_clone_rehearsal.py",
    "backend/supabase/scripts/g040_prefix_executor.py", "backend/supabase/scripts/g037_hosted_closure_contract.py",
    "backend/supabase/scripts/g037_hosted_closure_executor.py", "backend/supabase/scripts/g037_write_freeze.py",
    "backend/supabase/scripts/g037_managed_recovery.py", "backend/supabase/scripts/g037_production_controller.py",
    "backend/supabase/scripts/g037_remediation_authorization.py", "backend/supabase/scripts/g037_supabase_statement_vector.mjs",
    "backend/supabase/scripts/g037-parser-oracle/go.mod", "backend/supabase/scripts/g037-parser-oracle/go.sum",
    "backend/supabase/scripts/g037-parser-oracle/main.go", "backend/supabase/scripts/g035_hosted_recovery.py",
    "backend/supabase/scripts/g035_hosted_recovery_contract.py", "backend/supabase/scripts/preflight_g034_hosted_migration_closure.py",
    MANIFEST_PATH, ".github/workflows/g040-prefix-recovery.yml",
)
G014_FILES = (
    "backend/supabase/migrations/20260713002000_g014_public_api_private_boundary.sql",
    "backend/supabase/migrations/20260713002100_g014_privacy_workflows.sql",
    "backend/supabase/migrations/20260713002200_g014_marketing_state_machine.sql",
    "backend/supabase/migrations/20260713002300_g014_account_deletion_state_machine.sql",
    "backend/supabase/migrations/20260713002400_g014_retention_adapters_receipts.sql",
)

def fail():
    raise RuntimeError("protected recovery source verification failed")

def git(root, *args):
    result = subprocess.run(["git", "-C", os.fspath(root), *args], stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, check=False)
    if result.returncode or not isinstance(result.stdout, bytes): fail()
    return result.stdout

def relative(value):
    path = PurePosixPath(value)
    if not isinstance(value, str) or not value or "\\" in value or path.is_absolute() or any(part in ("", ".", "..") for part in path.parts): fail()
    return value

def manifest_paths(raw):
    try:
        payload = json.loads(raw.decode("ascii"), object_pairs_hook=lambda pairs: dict(pairs) if len({key for key, _ in pairs}) == len(pairs) else (_ for _ in ()).throw(ValueError()))
        canonical = json.dumps(payload, separators=(",", ":"), ensure_ascii=True).encode("ascii")
        pretty = json.dumps(payload, indent=2, ensure_ascii=True).encode("ascii")
        rows = payload["migrations"]
        if raw not in (canonical, canonical + b"\n", pretty, pretty + b"\n") or tuple(payload) != ("schemaVersion", "ledgerTerminalVersion", "closureTerminalVersion", "requiredLaterPromotionGate", "migrations", "excludedVersions", "cloneBackupRecoveryRequired") or payload["schemaVersion"] != 1 or type(rows) is not list: fail()
        paths = tuple(row["path"] for row in rows)
        if not paths or any(type(row) is not dict or tuple(row) != ("version", "name", "path", "sha256") or not isinstance(row["path"], str) or not row["path"].startswith("backend/supabase/migrations/") or not re.fullmatch(r"[0-9a-f]{64}", row["sha256"]) for row in rows): fail()
        return paths
    except Exception:
        fail()

def object_entry(root, commit, path):
    output = git(root, "ls-tree", "-z", commit, "--", path)
    suffix = b"\t" + path.encode() + b"\0"
    if output.count(b"\0") != 1 or not output.endswith(suffix): fail()
    try: mode, kind, object_id = output[:-1].split(b"\t", 1)[0].split(b" ")
    except ValueError: fail()
    if mode not in (b"100644", b"100755") or kind != b"blob" or not re.fullmatch(rb"[0-9a-f]{40}", object_id): fail()
    return mode.decode(), git(root, "show", f"{commit}:{path}")

def verify(root, commit, entrypoint):
    if not root.is_absolute() or not COMMIT_RE.fullmatch(commit) or entrypoint not in RUNTIME_FILES or not entrypoint.endswith(".py"): fail()
    attached = subprocess.run(["git", "-C", os.fspath(root), "symbolic-ref", "-q", "HEAD"], stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, check=False)
    if attached.returncode != 1 or git(root, "rev-parse", "--verify", "HEAD^{commit}") != (commit + "\n").encode() or git(root, "status", "--porcelain=v1", "-z", "--untracked-files=all"): fail()
    manifest = git(root, "show", f"{commit}:{MANIFEST_PATH}")
    inventory = tuple(sorted(set((*RUNTIME_FILES, *G014_FILES, *manifest_paths(manifest)))))
    entries = []
    entry_bytes = None
    for path in inventory:
        relative(path)
        mode, data = object_entry(root, commit, path)
        local = root.joinpath(*PurePosixPath(path).parts)
        try:
            info = local.lstat()
            if stat.S_ISLNK(info.st_mode) or not stat.S_ISREG(info.st_mode) or bool(info.st_mode & stat.S_IXUSR) != (mode == "100755") or local.read_bytes() != data: fail()
        except OSError: fail()
        entries.append((path, mode, hashlib.sha256(data).hexdigest()))
        if path == entrypoint: entry_bytes = data
    digest = hashlib.sha256(DOMAIN)
    for path, mode, blob in entries:
        encoded = path.encode(); digest.update(len(encoded).to_bytes(4, "big")); digest.update(encoded); digest.update(mode.encode()); digest.update(bytes.fromhex(blob))
    if entry_bytes is None: fail()
    script_root = root / "backend" / "supabase" / "scripts"
    for import_root in (root, script_root):
        try: candidates = tuple(import_root.iterdir())
        except OSError: fail()
        for candidate in candidates:
            try: info = candidate.lstat()
            except OSError: fail()
            if stat.S_ISLNK(info.st_mode): fail()
            package = candidate.is_dir() and any((candidate / name).is_file() for name in ("__init__.py", "__init__.pyc"))
            if (candidate.suffix in (".py", ".pyc") or package) and subprocess.run(["git", "-C", os.fspath(root), "ls-files", "--error-unmatch", "--", candidate.relative_to(root).as_posix()], stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, check=False).returncode != 0: fail()
    return entry_bytes, digest.hexdigest()

def load(name, data, filename, main=False):
    module = types.ModuleType("__main__" if main else name)
    module.__file__ = filename; module.__package__ = None
    if not main: sys.modules[name] = module
    exec(compile(data, filename, "exec"), module.__dict__)

def main():
    parser = argparse.ArgumentParser(add_help=False)
    parser.add_argument("--repository-root", required=True); parser.add_argument("--authorized-final-commit", required=True); parser.add_argument("--entrypoint", required=True); parser.add_argument("entry_args", nargs=argparse.REMAINDER)
    args = parser.parse_args()
    root = Path(args.repository_root)
    entry_bytes, source_root = verify(root, args.authorized_final_commit, args.entrypoint)
    script_root = root / "backend" / "supabase" / "scripts"
    source_path = "backend/supabase/scripts/g040_recovery_source.py"
    _, source_bytes = object_entry(root, args.authorized_final_commit, source_path)
    sys.path.insert(0, os.fspath(script_root))
    load("g040_recovery_source", source_bytes, os.fspath(root / source_path))
    source = sys.modules["g040_recovery_source"]
    source._establish_isolated_bootstrap(root, args.authorized_final_commit, source_root)
    sys.argv = [os.fspath(root / args.entrypoint), *args.entry_args]
    load("__main__", entry_bytes, os.fspath(root / args.entrypoint), main=True)

if __name__ == "__main__":
    try: main()
    except Exception: raise SystemExit("protected recovery source verification failed") from None
