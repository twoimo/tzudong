"""Read canonical retained performance artifacts and run the independent validator.

This is admission, not measurement or a performance-improvement claim. A valid
zero-admission scored result is sufficient; missing data and health blocks are
not. No caller-supplied executable, script or command is accepted.
"""
from __future__ import annotations
import hashlib
import json
from pathlib import Path, PurePosixPath
import re
import shutil
import subprocess

from backend.pipeline_control.performance_evidence import BACKEND_METRIC_BUDGETS, is_frozen_tree_valid

ROOT = Path(__file__).resolve().parents[2]
VALIDATOR = ROOT / 'apps/web/scripts/validate-performance-backlog.mjs'


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
    return json.loads(raw)


def verified_performance(reference, slice_id, artifact_id, git_sha, *, repo_root=ROOT, runner=None):
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
        tree = subprocess.run(['git', 'rev-parse', '--verify', git_sha + '^{tree}'], cwd=root,
                              capture_output=True, text=True, timeout=10, check=True).stdout.strip()
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
