"""
Review Content Triage v2 Utility.
Static content-level triage tool distinguishing hard source integrity errors
from editorial advisory hints.
Always maintains applyReady: False because runtime DB/optimistic locks are not verified here.
Zero PII / raw secret preservation.
"""
import re
import hashlib
from collections import Counter
from typing import Dict, Any, List, Tuple

# TS marker pattern: supports {ts:...}, [ts:...], (ts:...)
TS_PATTERN = re.compile(r'(\{[^}]*ts:[^}]*\}|\[[^\]]*ts:[^\]*\]|\([^)]*ts:[^)]*\))', re.IGNORECASE)

# Spacing collisions: Korean particle + noun without space (e.g. 은가게, 는가게, 이가게, 을가게)
PARTICLE_NOUN_COLLISION = re.compile(r'([은는이가을를과와])(가게|식당|음식점)', re.UNICODE)
SPACE_BEFORE_PUNCT = re.compile(r'\s+[.,!?]')
CONSECUTIVE_SPACES = re.compile(r'\s{2,}')

# Unprompted advisory expansion markers
ADVISORY_EXPANSION_PATTERNS = [
    re.compile(r'요청하면\s+좋겠다'),
    re.compile(r'요청하면\s+더\s+좋을'),
    re.compile(r'추천하며\s+덧붙였'),
]

def compute_sha256(text: str) -> str:
    return hashlib.sha256(text.encode('utf-8')).hexdigest()

def extract_ts_markers(text: str) -> List[str]:
    return TS_PATTERN.findall(text)

def check_standalone_youtuber(text: str) -> List[str]:
    """
    Finds standalone '유튜버' not part of compound '유튜버 쯔양'.
    Valid: '유튜버 쯔양의 단골집', '유튜버 쯔양이...'
    Invalid collision: '유튜버가 추천하는' while '쯔양' is used as referent.
    """
    matches = []
    for m in re.finditer(r'유튜버', text):
        idx = m.start()
        lookahead = text[idx:idx + 12]
        if not re.match(r'유튜버\s*쯔양', lookahead):
            matches.append(lookahead.strip())
    return matches

def triage_review_content_v2(
    key: str,
    kind: str,
    orig_text: str,
    after_text: str
) -> Dict[str, Any]:
    hard_errors = []
    advisory_hints = []

    # 1. Exact string multiset preservation of video timestamp markers
    ts_orig_counts = Counter(extract_ts_markers(orig_text))
    ts_after_counts = Counter(extract_ts_markers(after_text))
    if ts_orig_counts != ts_after_counts:
        removed = ts_orig_counts - ts_after_counts
        added = ts_after_counts - ts_orig_counts
        hard_errors.append({
            "code": "TS_MARKER_MULTISET_MISMATCH",
            "message": "Timestamp marker multiset altered in underlying source data",
            "details": {
                "removed": dict(removed),
                "added": dict(added)
            }
        })

    # 2. Particle-noun collision check (e.g. '은가게' spacing defect)
    for match in PARTICLE_NOUN_COLLISION.finditer(after_text):
        start = match.start()
        # If preceding character is Korean syllable indicating attached particle without space
        if start > 0 and after_text[start - 1] not in (' ', '\t', '\n', '(', '[', '{', '.', ','):
            hard_errors.append({
                "code": "PARTICLE_SPACING_COLLISION",
                "message": f"Unspaced particle-noun collision '{match.group(0)}'",
                "details": {"matched": match.group(0)}
            })

    # 3. Formatting defects (space before punct, multiple spaces)
    if SPACE_BEFORE_PUNCT.search(after_text):
        hard_errors.append({
            "code": "SPACE_BEFORE_PUNCTUATION",
            "message": "Unwanted whitespace before punctuation mark",
            "details": {}
        })
    if CONSECUTIVE_SPACES.search(after_text):
        hard_errors.append({
            "code": "CONSECUTIVE_SPACES",
            "message": "Consecutive whitespace characters detected",
            "details": {}
        })

    # 4. Standalone narrator referent collision
    has_tzuyang = "쯔양" in after_text
    standalone_youtuber = check_standalone_youtuber(after_text)
    if has_tzuyang and standalone_youtuber:
        hard_errors.append({
            "code": "STANDALONE_REFERENT_COLLISION",
            "message": "Standalone '유튜버' referent coexists with '쯔양' in single review",
            "details": {"standaloneOccurrences": standalone_youtuber}
        })

    # 5. Advisory Editorial Hints (Separated from hard errors)
    # 5a. Unprompted instructional advisory expansion
    delta = len(after_text) - len(orig_text)
    has_unprompted_advice = any(p.search(after_text) for p in ADVISORY_EXPANSION_PATTERNS)
    if has_unprompted_advice:
        advisory_hints.append({
            "code": "UNPROMPTED_ADVISORY_EXPANSION",
            "message": f"Appends unprompted instructional advice/caveat (delta=+{delta} chars)",
            "details": {"deltaCharacters": delta}
        })
    elif delta > 50:
        advisory_hints.append({
            "code": "PARAGRAPH_EXPANSION_NOTICE",
            "message": f"Text expanded by +{delta} characters",
            "details": {"deltaCharacters": delta}
        })

    # 5b. Style tone notice (honorific normalization)
    if kind == "editorial":
        advisory_hints.append({
            "code": "HONORIFIC_NORMALIZATION",
            "message": "Standardized endings to polite declarative form (~습니다)",
            "details": {}
        })

    # Determine overall static triage status
    if hard_errors:
        triage_status = "SOURCE_INTEGRITY_VIOLATION"
    elif any(h["code"] == "UNPROMPTED_ADVISORY_EXPANSION" for h in advisory_hints):
        triage_status = "EDITORIAL_ADVISORY_HELD"
    else:
        triage_status = "CONTENT_TRIAGE_ELIGIBLE"

    return {
        "key": key,
        "kind": kind,
        "triageStatus": triage_status,
        "applyReady": False,  # Always False: runtime optimistic locks and DB state unverified
        "hardErrors": hard_errors,
        "advisoryHints": advisory_hints,
        "beforeSha256": compute_sha256(orig_text),
        "afterSha256": compute_sha256(after_text),
        "lengthDeltaCharacters": delta
    }

