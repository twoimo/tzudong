"""
Review Admission Check for Tzuyang Review Minimal Drafts.
Self-contained validation utility enforcing pre-apply admission rules
without modifying external DB, Storage, or dependencies.
Zero PII / raw secret preservation.
"""
import re
import hashlib
from typing import Dict, Any, List, Tuple

# Reusable patterns
TS_PATTERN = re.compile(r'(\{[^}]*ts:[^}]*\}|\[[^\]]*ts:[^\]*\]|\([^)]*ts:[^)]*\))', re.IGNORECASE)
PARTICLE_NOUN_COLLISION = re.compile(r'([은는이가을를과와])(가게|식당|음식점)', re.UNICODE)
SPACE_BEFORE_PUNCT = re.compile(r'\s+[.,!?]')
CONSECUTIVE_SPACES = re.compile(r'\s{2,}')

def compute_sha256(text: str) -> str:
    return hashlib.sha256(text.encode('utf-8')).hexdigest()

def check_admission(
    key: str,
    kind: str,
    orig_text: str,
    after_text: str,
    admin_locked: bool,
    expected_before_sha: str = None
) -> Tuple[bool, str, List[str]]:
    """
    Evaluates candidate review draft against pre-apply admission criteria.
    Returns: (is_eligible, primary_code, list_of_issues)
    """
    issues = []

    # 1. Admin Edit & Optimistic Lock Check
    if admin_locked:
        issues.append("ADMIN_LOCK_ACTIVE: Admin pre-image must be preserved")

    if expected_before_sha and compute_sha256(orig_text) != expected_before_sha:
        issues.append("PREIMAGE_HASH_MISMATCH: Base review modified concurrently")

    # 2. Timestamp Preservation Check
    # Source timestamps must not be removed in DB layer (handled by display formatter)
    ts_orig = TS_PATTERN.findall(orig_text)
    ts_after = TS_PATTERN.findall(after_text)
    if len(ts_orig) > len(ts_after):
        issues.append("TIMESTAMP_DELETED: Video timestamp stripped from underlying source data")

    # 3. Particle-Noun Collision & Spacing Checks
    # Detects issues like '은가게' arising from direct literal substitution
    for match in PARTICLE_NOUN_COLLISION.finditer(after_text):
        # Check if preceding character is Korean syllable indicating attached particle without space
        start = match.start()
        if start > 0 and after_text[start - 1] not in (' ', '\t', '\n', '(', '[', '{', '.', ','):
            issues.append(f"SPACING_COLLISION: Unspaced particle-noun '{match.group(0)}'")

    if SPACE_BEFORE_PUNCT.search(after_text):
        issues.append("FORMAT_DEFECT: Unwanted space before punctuation")

    if CONSECUTIVE_SPACES.search(after_text):
        issues.append("FORMAT_DEFECT: Consecutive whitespace detected")

    # 4. Entity Consistency Check
    # Avoid mixing '유튜버' and '쯔양' in the same review body
    has_youtuber = "유튜버" in after_text
    has_tzuyang = "쯔양" in after_text
    if has_youtuber and has_tzuyang:
        issues.append("ENTITY_INCONSISTENCY: Mixed usage of '유튜버' and '쯔양' in single review")

    # 5. Scope Boundary Check
    # Minimal edits should not introduce large unrequested text expansions (> 40 chars)
    delta = len(after_text) - len(orig_text)
    if delta > 40:
        issues.append(f"SCOPE_CREEP: Length delta (+{delta} chars) exceeds minimal edit threshold")

    is_eligible = (len(issues) == 0)
    primary_code = "ADMISSION_PASSED" if is_eligible else issues[0].split(":")[0].strip()
    return is_eligible, primary_code, issues

