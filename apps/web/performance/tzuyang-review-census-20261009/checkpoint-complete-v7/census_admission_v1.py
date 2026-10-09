"""Build a local, hash-bound edit plan. This module performs no hosted writes."""
from __future__ import annotations

import hashlib
import re


def sha(value: str) -> str:
    return hashlib.sha256(value.encode()).hexdigest()


def presentation_only(value: str, *, allow_video_parentheses: bool = False) -> str:
    # Explicit source markers are metadata. Ordinary brackets remain untouched.
    value = re.sub(r"\[\s*ts\s*:[^\[\]]*\]", "", value, flags=re.I)
    # Only paired emphasis is admitted; multiplication, unmatched stars and
    # arbitrary markdown/link rewriting are outside this format-only proof.
    value = re.sub(r"\*\*([^*\n]+)\*\*", r"\1", value)
    value = re.sub(r"(?<=[가-힣])[ \t]+([.,!?])(?=\s|$)", r"\1", value)
    if allow_video_parentheses:
        # This is opt-in per independently read source record, never a global
        # time removal rule: business hours and food/duration quantities survive.
        stamp = r"(?:\d{1,3}:)?\d{1,3}:[0-5]\d"
        value = re.sub(r"\(" + stamp + r"(?:,\s*" + stamp + r")*\)", "", value)
    return value.strip()


def classify(source: dict, item: dict, *, reviewed_video_parentheses=False) -> dict:
    """Refuse factual/semantic edits; preserve each original row's ownership."""
    key = item["key"]
    original = source.get("tzuyang_review") or ""
    if sha(original) != source["reviewSha256"]:
        raise ValueError("CENSUS_REVIEW_PREIMAGE_HASH_DENIED")
    reasons = []
    if source.get("status") != "approved":
        reasons.append("NON_APPROVED_STATE_PRESERVED")
    if source.get("channel_name") != "tzuyang":
        reasons.append("CHANNEL_UNCONFIRMED")
    if item.get("status") != "fix":
        reasons.append("MODEL_DID_NOT_PROPOSE_SAFE_FIX")
    if set(item.get("issues", [])) - {"INTERNAL_MARKER", "RAW_FORMATTING"}:
        reasons.append("SEMANTIC_REVIEW_REQUIRED")
    proposal = item.get("revisedReview", "")
    if not isinstance(proposal, str) or not proposal.strip() or len(proposal) > 4000:
        reasons.append("BOUNDED_NONEMPTY_PROPOSAL_REQUIRED")
    if "[CONTACT]" in proposal:
        reasons.append("REDACTED_MODEL_INPUT")
    expected = presentation_only(original, allow_video_parentheses=reviewed_video_parentheses)
    if proposal != expected or proposal == original:
        reasons.append("FORMAT_ONLY_EQUIVALENCE_NOT_ESTABLISHED")
    # Existing timestamp/body uncertainty never becomes factual certification.
    return {"key": key, "decision": "local_plan" if not reasons else "deferred",
            "reasons": sorted(set(reasons)), "sourceReviewSha256": sha(original),
            "proposalSha256": sha(proposal) if isinstance(proposal, str) else None,
            "sourceRecordSha256": source["recordSha256"],
            "adminLocked": source["adminLocked"], "videoFactsCertified": False,
            "hostedApplyAdmitted": False}


def assert_fresh_preimage(source: dict, fresh: dict, *, fresh_record_sha256: str) -> None:
    """A planned source ID/body/state is never reinterpreted after collection."""
    if (fresh_record_sha256 != source["recordSha256"]
            or fresh.get("id") != source["id"]
            or fresh.get("status") != source["status"]
            or fresh.get("channel_name") != source["channel_name"]
            or sha(fresh.get("tzuyang_review") or "") != source["reviewSha256"]
            or fresh.get("updated_at") != source["updated_at"]
            or bool(fresh.get("updated_by_admin_id")) != source["adminLocked"]):
        raise ValueError("CENSUS_FRESH_PREIMAGE_DENIED")
    # The full export fingerprint includes the administrator ID without saving
    # that identity in evidence. The caller supplies exactly the export columns.
    # A guarded DB preview then freezes the complete authoritative row for CAS.
