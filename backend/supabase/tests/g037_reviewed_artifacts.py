"""Verify immutable approval-era bytes separately from the current correction.

This helper is for historical evidence tests only, never runtime admission.
All other reviewed artifacts continue to match their current bytes exactly.
"""
import hashlib
import json
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parents[3]
TRANSITION = ROOT / 'backend/supabase/g037-readonly-transaction-source-transition.v1.json'
EXECUTOR = ROOT / 'backend/supabase/scripts/g037_hosted_closure_executor.py'
REVIEWED_COMMIT = 'f26d78fda521537f5a1cfc941bc94a3c0a95ca2b'
REVIEWED_SHA256 = '188095df7df30edbe890d3cb0df9b1d69f59b7942dd449ae5f0b7b8fad5e89b0'


def reviewed_sha256(path: Path) -> str:
    current = hashlib.sha256(path.read_bytes()).hexdigest()
    if path != EXECUTOR:
        return current
    transition = json.loads(TRANSITION.read_text())
    assert transition['schemaVersion'] == 1
    assert transition['kind'] == 'g037_readonly_transaction_source_transition'
    assert transition['sourcePath'] == EXECUTOR.relative_to(ROOT).as_posix()
    assert transition['reviewedCommit'] == REVIEWED_COMMIT
    assert transition['reviewedSha256'] == REVIEWED_SHA256
    assert transition['candidateSha256'] == current, 'unrecorded_current_source_drift'
    assert transition['priorApprovalsApplyToReviewedBytesOnly'] is True
    assert transition['priorApprovalArtifactsModified'] is False
    assert transition['newHostedExecutionAuthorizedByThisFile'] is False
    assert transition['freshExactMainAuthorizationRequired'] is True
    reviewed = subprocess.check_output(
        ['git', 'show', f'{REVIEWED_COMMIT}:{transition["sourcePath"]}'], cwd=ROOT)
    digest = hashlib.sha256(reviewed).hexdigest()
    assert digest == REVIEWED_SHA256, 'reviewed_git_source_drift'
    return digest
