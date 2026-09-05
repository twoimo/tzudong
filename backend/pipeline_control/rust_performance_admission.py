"""Read canonical retained performance artifacts and run the independent validator.

This is admission, not measurement or a performance-improvement claim. A valid
zero-admission scored result is sufficient; missing data and health blocks are
not. No caller-supplied executable, script or command is accepted.
"""
from __future__ import annotations
import base64
from collections import OrderedDict
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import subprocess
import stat
import threading

from backend.pipeline_control.performance_evidence import BACKEND_METRIC_BUDGETS, is_frozen_tree_valid
from backend.pipeline_control.receipt_json import parse_receipt_json

ROOT = Path(__file__).resolve().parents[2]
VALIDATOR = ROOT / 'apps/web/scripts/validate-performance-backlog.mjs'
_VERDICTS = OrderedDict()
_VERDICT_LOCK = threading.Lock()


def _read(root, reference, maximum):
    if not isinstance(reference, dict) or set(reference) != {'path', 'sha256'}:
        raise ValueError('invalid_performance_reference')
    relative = reference['path']
    if (not isinstance(relative, str) or '\\' in relative or
            not relative.startswith('apps/web/performance/') or
            any(part in {'', '.', '..'} for part in relative.split('/'))):
        raise ValueError('invalid_performance_path')
    if not isinstance(reference['sha256'], str) or re.fullmatch('[0-9a-f]{64}', reference['sha256']) is None:
        raise ValueError('invalid_performance_hash')
    path = root
    for part in PurePosixPath(relative).parts:
        path = path / part
        if path.is_symlink():
            raise ValueError('performance_alias')
    with path.open('rb') as stream:
        raw = stream.read(maximum + 1)
    if len(raw) > maximum or hashlib.sha256(raw).hexdigest() != reference['sha256']:
        raise ValueError('performance_hash_mismatch')
    return parse_receipt_json(raw)


def _candidate_tree(root, reference, git_sha):
    """Verify a retained Git commit object without a checkout or Git executable.

    Retain `git cat-file commit <sha>` bytes as base64 in the canonical
    performance tree. The Git object ID independently binds its tree header;
    a caller-supplied tree string alone is never trusted.
    """
    commit = _read(root, reference, 1024 * 1024)
    if commit.get('kind') != 'git_commit_object_v1':
        raise ValueError('invalid_commit_object')
    payload = base64.b64decode(commit['contentBase64'], validate=True)
    object_id = hashlib.sha1(b'commit ' + str(len(payload)).encode() + b'\0' + payload).hexdigest()
    match = re.match(rb'tree ([0-9a-f]{40})\n', payload)
    if object_id != git_sha or match is None:
        raise ValueError('invalid_commit_object')
    return match[1].decode('ascii')


def _measured_rust(root, receipt, raw, artifact_map, slice_id, artifact_id):
    """Bind each canonical candidate measurement to its captured Rust runtime.

    The measurement's required benchmark or RSS attestation hashes the retained
    execution receipt, including the exact candidate observations and binary
    digest. This extends the source attestation; relabeling an outer admission
    receipt cannot convert an unrelated Python run into Rust measurements.
    """
    captures = receipt.get('runtimeCaptures')
    if not isinstance(captures, dict) or set(captures) != set(BACKEND_METRIC_BUDGETS):
        return False
    if not isinstance(artifact_id, str) or re.fullmatch(r'[A-Za-z0-9_-]+@sha256:[0-9a-f]{64}', artifact_id) is None:
        return False
    for key, budget in BACKEND_METRIC_BUDGETS.items():
        items = [item for item in raw['items'] if item['key'] == key]
        if len(items) != 1:
            return False
        reference = items[0]['measurement']
        if artifact_map['artifacts'].get(reference['path']) != reference['sha256']:
            return False
        measurement = _read(root, reference, 8 * 1024 * 1024)
        capture = _read(root, captures[key], 8 * 1024 * 1024)
        observations = [row for row in measurement['observations'] if row['cohort'] == 'candidate']
        if (capture.get('kind') != 'rust_measurement_execution_v1'
                or capture.get('sliceId') != slice_id or capture.get('implementation') != 'rust'
                or capture.get('rustArtifactId') != artifact_id
                or capture.get('compiledArtifactSha256') != artifact_id.split('@sha256:')[1]
                or capture.get('key') != key or capture.get('candidate') != artifact_map['candidate']
                or capture.get('observations') != observations
                or len(observations) < budget['sampleMinimum']
                or any(capture.get(k) != measurement.get(k) for k in ('releaseId', 'configSha256', 'dataProfileSha256'))):
            return False
        attestations = [a for a in measurement['attestations']
                        if a['cohort'] == 'candidate' and a['evidenceForm'] ==
                        ('rss_ndjson' if key == 'backend.peak_rss_mib' else 'benchmark_summary')]
        if len(attestations) != 1 or attestations[0]['sourceSha256'] != captures[key]['sha256']:
            return False
    return True


def _verify_performance(reference, slice_id, artifact_id, git_sha, *, repo_root=ROOT, runner=None):
    """Fail closed unless retained bytes pass the real canonical validator."""
    try:
        root = Path(repo_root).resolve()
        receipt = _read(root, reference, 1024 * 1024)
        if (receipt.get('kind') != 'rust_performance_admission_v1'
                or receipt.get('sliceId') != slice_id or receipt.get('rustArtifactId') != artifact_id
                or not is_frozen_tree_valid(receipt.get('frozenTree'))
                or receipt['frozenTree']['startCommit'] != git_sha):
            return False
        artifact_map = _read(root, receipt.get('artifactMap'), 1024 * 1024)
        raw = _read(root, receipt.get('raw'), 8 * 1024 * 1024)
        scored = _read(root, receipt.get('scored'), 16 * 1024 * 1024)
        if (artifact_map.get('schemaVersion') != 'performance-trusted-artifacts.v1'
                or artifact_map['candidate']['sha'] != git_sha
                or raw.get('schemaVersion') != 'performance-backlog-raw.v2'
                or scored.get('schemaVersion') != 'performance-backlog-scored.v2'
                or scored.get('releaseBlocked') is not False):
            return False
        if not _measured_rust(root, receipt, raw, artifact_map, slice_id, artifact_id):
            return False
        # Unavailable measurements are not zero-admission measurements. All
        # three backend metrics need real, sufficient observations; they may
        # legitimately admit no improvements after budget/noise evaluation.
        items = scored.get('items')
        if not isinstance(items, list):
            return False
        for key, budget in BACKEND_METRIC_BUDGETS.items():
            matches = [item for item in items if isinstance(item, dict) and item.get('key') == key]
            if len(matches) != 1:
                return False
            measured = matches[0]
            if (type(measured.get('sampleCount')) is not int or measured['sampleCount'] < budget['sampleMinimum']
                    or any(type(measured.get(field)) is not int or measured[field] < 0 for field in ('observed', 'baseline'))):
                return False
        # The map SHA is supplied by a separately addressed receipt, outside
        # the map. Its candidate tree must resolve to the frozen Git object.
        tree = _candidate_tree(root, receipt.get('candidateCommitObject'), git_sha)
        if tree != artifact_map['candidate']['tree']:
            return False
        node = shutil.which('node')
        if node is None:
            return False
        arguments = {'--artifact-root': str(root), '--artifact-map': receipt['artifactMap']['path'],
                     '--artifact-map-sha256': receipt['artifactMap']['sha256'],
                     '--release-id': artifact_map['releaseId'], '--candidate-sha': git_sha,
                     '--candidate-tree': tree, '--config-sha256': artifact_map['configSha256'],
                     '--data-profile-sha256': artifact_map['dataProfileSha256'],
                     '--frozen-as-of': artifact_map['frozenAsOf'],
                     '--input': receipt['raw']['path'], '--scored': receipt['scored']['path']}
        argv = [node, str(VALIDATOR)]
        for key, value in arguments.items():
            if not isinstance(value, str):
                return False
            argv.extend([key, value])
        result = (runner or subprocess.run)(argv, cwd=root, stdout=subprocess.DEVNULL,
                                           stderr=subprocess.DEVNULL, timeout=60, check=False)
        # Successful validation recomputes budgets, scoring, pins, data/health
        # receipts and detached hashes. Do not require a positive admitted count.
        return result.returncode == 0
    except Exception:
        return False


def _snapshot_paths(root, reference):
    receipt = _read(root, reference, 1024 * 1024)
    artifact_map = _read(root, receipt['artifactMap'], 1024 * 1024)
    references = [reference, receipt['artifactMap'], receipt['raw'], receipt['scored'],
                  receipt['candidateCommitObject'], *receipt['runtimeCaptures'].values(),
                  *artifact_map.get('pins', {}).values()]
    paths = {ref['path'] for ref in references} | set(artifact_map['artifacts'])
    if len(paths) > 256:
        raise ValueError('performance_file_limit')
    for path in paths:
        if (not isinstance(path, str) or not path.startswith('apps/web/performance/')
                or '\\' in path or any(p in {'', '.', '..'} for p in path.split('/'))):
            raise ValueError('invalid_performance_path')
    return tuple(sorted({root / path for path in paths} | {VALIDATOR}))


def _snapshot(paths):
    """Fingerprint every previously hash-validated file and its directory chain.

    Includes ctime/inode/device, so same-size edits, mtime restoration and atomic
    replacement invalidate a verdict. This assumes the OS metadata is trusted;
    an actor controlling the kernel or process can also replace this verifier.
    """
    directories = {parent for path in paths for parent in path.parents}
    for parent in directories:
        mode = parent.lstat().st_mode
        if not stat.S_ISDIR(mode):
            raise ValueError('performance_directory_alias')
    result = []
    for path in paths:
        snapshot = path.lstat()
        if not stat.S_ISREG(snapshot.st_mode):
            raise ValueError('performance_file_alias')
        result.append((str(path), snapshot.st_dev, snapshot.st_ino, snapshot.st_size,
                       snapshot.st_mtime_ns, snapshot.st_ctime_ns, snapshot.st_mode))
    return tuple(result)


def verified_performance(reference, slice_id, artifact_id, git_sha, *, repo_root=ROOT, runner=None):
    """Validate once per immutable evidence/artifact binding in this process.

    Every reuse checks the full retained file set, including nested map inputs,
    runtime captures, pins, and the validator. Writable Compose mounts therefore
    cannot retain a passing verdict after a file changes, disappears or aliases.
    Changed bytes must pass their pinned hashes and full validation again.
    Failures are never cached; trusted test runners bypass the shared cache.
    The bounded cache is serialized so concurrent first calls validate once.
    """
    # Windows ctime is a creation timestamp, not a reliable change timestamp.
    # Native worker execution is POSIX-only; other hosts validate without cache.
    if runner is not None or os.name != 'posix':
        return _verify_performance(reference, slice_id, artifact_id, git_sha, repo_root=repo_root, runner=runner)
    try:
        root = Path(repo_root).resolve()
        key = (str(root), json.dumps(reference, sort_keys=True), slice_id, artifact_id, git_sha)
        with _VERDICT_LOCK:
            if key in _VERDICTS:
                paths, previous = _VERDICTS.pop(key)
                if _snapshot(paths) == previous:
                    _VERDICTS[key] = (paths, previous)
                    return True
            paths = _snapshot_paths(root, reference)
            before = _snapshot(paths)
            if not _verify_performance(reference, slice_id, artifact_id, git_sha, repo_root=repo_root):
                return False
            if _snapshot(paths) != before:
                return False
            _VERDICTS[key] = (paths, before)
            if len(_VERDICTS) > 128:
                _VERDICTS.popitem(last=False)
            return True
    except Exception:
        return False
