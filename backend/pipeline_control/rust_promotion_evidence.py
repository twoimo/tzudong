"""Content-addressed live parity, operator approval, and readback admission.

The default loader reads retained receipts from the reviewed source tree. A
backend may inject a durable-store reader returning bytes; hashes are always
verified here. Missing receipts never fall back to claimed counts or booleans.
"""
from __future__ import annotations

import hashlib
from datetime import datetime, timezone
import json
from pathlib import Path
import re
from typing import Callable

from backend.pipeline_control.manifest import deletion_allowed
from backend.pipeline_control.rust_performance_admission import verified_performance

_ROOT = Path(__file__).resolve().parents[1] / 'rust/promotion-evidence'
_REF = re.compile(r'sha256:([0-9a-f]{64})')
_MAX_BYTES = 1024 * 1024


def digest(value) -> str:
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(',', ':'),
                                     ensure_ascii=True, allow_nan=False).encode()).hexdigest()


def _read_local(reference: str) -> bytes:
    match = _REF.fullmatch(reference)
    if match is None:
        raise ValueError('promotion_evidence_invalid')
    path = _ROOT / (match[1] + '.json')
    if path.is_symlink():
        raise ValueError('promotion_evidence_invalid')
    with path.open('rb') as stream:
        return stream.read(_MAX_BYTES + 1)


def read_receipt(reference, loader: Callable[[str], bytes] | None = None) -> dict | None:
    try:
        match = _REF.fullmatch(reference) if isinstance(reference, str) else None
        if match is None:
            return None
        raw = (loader or _read_local)(reference)
        if not isinstance(raw, bytes) or len(raw) > _MAX_BYTES or hashlib.sha256(raw).hexdigest() != match[1]:
            return None
        receipt = json.loads(raw)
        return receipt if isinstance(receipt, dict) else None
    except Exception:
        return None


def _valid_approval_time(value) -> bool:
    if not isinstance(value, str) or re.fullmatch(r'[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\.[0-9]{1,6})?(?:Z|\+00:00)', value) is None:
        return False
    try:
        # Python versions differ on ISO-8601 end-of-day rollover. RFC3339
        # permits only hours 00..23; validate components before parsing.
        year, month, day, hour, minute, second = map(int, re.findall(r'[0-9]+', value)[:6])
        datetime(year, month, day, hour, minute, second, tzinfo=timezone.utc)
        instant = datetime.fromisoformat(value.replace('Z', '+00:00'))
        return instant.tzinfo is not None and instant.utcoffset() == timezone.utc.utcoffset(instant)
    except ValueError:
        return False


def approved(receipt, *, purpose: str, binding: dict) -> bool:
    return bool(isinstance(receipt, dict)
                and receipt.get('kind') == 'rust_operator_approval_v1'
                and receipt.get('purpose') == purpose
                and receipt.get('status') == 'approved'
                and isinstance(receipt.get('approverName'), str)
                and 0 < len(receipt['approverName'].strip()) <= 128
                and _valid_approval_time(receipt.get('approvedAt'))
                and receipt.get('binding') == binding)


def verified_live_promotion(reference, slice_id, artifact_id, results, *, loader=None) -> bool:
    """Verify all three retained live runs, their cohort, approval and readback."""
    try:
        receipt = read_receipt(reference, loader)
        if (receipt is None or receipt.get('kind') != 'rust_promotion_evidence_v1'
                or receipt.get('sliceId') != slice_id or receipt.get('rustArtifactId') != artifact_id
                or not isinstance(artifact_id, str)
                or re.fullmatch(r'[A-Za-z0-9_-]+@sha256:[0-9a-f]{64}', artifact_id) is None
                or receipt.get('parityResults') != results):
            return False
        ledger = receipt.get('liveLedger')
        if not isinstance(ledger, dict) or not deletion_allowed(ledger):
            return False
        performance_ref = receipt.get('performanceEvidenceRef')
        if not verified_performance(performance_ref, slice_id, artifact_id, ledger['cohort']['gitSha']):
            return False
        # Each live receipt must be bound to exactly one qualifying Rust result.
        # Duplicated jobs, hashes, changed cohorts and non-live manifests are
        # rejected by the shared live-ledger validator, recomputed above.
        qualifying = []
        for result in reversed(results):
            if not isinstance(result, dict) or result.get('rust_artifact_id') != artifact_id:
                continue
            if result.get('matched') is not True:
                break
            if not result.get('compared_fields'):
                continue
            if result.get('input_id') in {row.get('input_id') for row in qualifying}:
                continue
            qualifying.append(result)
            if len(qualifying) == 3:
                break
        if len(qualifying) != 3:
            return False
        for result, attempt in zip(reversed(qualifying), ledger['attempts'][-3:]):
            if (result.get('slice_id') != slice_id or result.get('result_code') is not None
                    or result.get('mismatch_field_count') != 0 or result.get('mismatch_fields') != []
                    or result.get('normalization_rule_id') != 'v1'
                    or not isinstance(result.get('input_id'), str) or not result['input_id'].strip()
                    or result.get('liveJobId') != attempt['jobId']
                    or result.get('liveReceiptSha256') != attempt['evidenceReceiptSha256']):
                return False
        binding = {'sliceId': slice_id, 'rustArtifactId': artifact_id,
                   'liveLedgerSha256': digest(ledger), 'parityResultsSha256': digest(results),
                   'performanceEvidenceRef': performance_ref}
        approval = read_receipt(receipt.get('approvalRef'), loader)
        if not approved(approval, purpose='rust_default_switch', binding=binding):
            return False
        readback = read_receipt(receipt.get('readbackRef'), loader)
        return bool(readback and readback.get('kind') == 'rust_promotion_readback_v1'
                    and readback.get('binding') == binding
                    and readback.get('approvalRef') == receipt.get('approvalRef')
                    and readback.get('jobIds') == [a['jobId'] for a in ledger['attempts'][-3:]]
                    and readback.get('receiptSha256s') == [a['evidenceReceiptSha256'] for a in ledger['attempts'][-3:]])
    except Exception:
        return False
