"""Conservative, offline first-party disclosure grammar. See sponsorship-disclosure.md.

Keep the TypeScript implementation and shared golden fixture in parity. Normalized
text is used only for matching; emitted names are slices of the original source.
"""
import hashlib
import re
import unicodedata

VERSION = "first-party-disclosure-v1"
SOURCE = "description_rules"
SUBJECT = r"(?:(?:본|이|이번)\s*(?:영상|콘텐츠)(?:은|는|이|가)\s*)"
NAME = r"(?P<sponsor>.+?)"
POSITIVE = [
    SUBJECT + NAME + r"\s*(?:의|와의|과의)\s*(?:유료\s*광고|광고|협찬)(?:을|를)?\s*(?:포함(?:하고\s*있(?:습니다|어요)|합니다)|진행(?:하고\s*있(?:습니다|어요)|합니다)|입니다)",
    r"(?:" + SUBJECT + r"|(?:저희|우리|저)(?:는|가)?\s+)?" + NAME + r"\s*(?:으?로부터|에게서)\s*(?:유료\s*광고|광고|협찬)(?:을|를)?\s*(?:받았습니다|받았어요|받아\s*(?:제작|진행)(?:했습니다|하였습니다|되었습니다|됐습니다))",
    r"(?:저희|우리|저)(?:는|가)?\s+" + NAME + r"\s*(?:의|와의|과의)\s*(?:유료\s*광고|광고|협찬)(?:을|를)?\s*(?:받았습니다|받았어요|받아\s*(?:제작|진행)(?:했습니다|되었습니다))",
    r"this\s+(?:video|content)\s+(?:is|was)\s+sponsored\s+by\s+" + NAME,
    r"this\s+(?:video|content)\s+(?:is|was)\s+(?:an?\s+)?(?:paid\s+promotion|sponsorship|advertisement|advertising)\s+(?:from|by|with|for)\s+" + NAME,
    r"this\s+(?:video|content)\s+(?:contains|includes)\s+(?:a\s+)?(?:paid\s+promotion|sponsorship)\s+(?:from|by|with)\s+" + NAME,
    r"(?:i|we)\s+(?:received|accepted)\s+(?:a\s+)?(?:sponsorship|paid\s+promotion)\s+(?:from|with)\s+" + NAME,
]
NEGATIVE = [
    SUBJECT + r"(?:유료\s*광고|광고|협찬)(?:가|이)\s*아닙니다",
    SUBJECT + r"(?:광고\s*(?:및|와|나|또는)\s*)?협찬\s*없이\s*(?:제작|진행)(?:했습니다|되었습니다|됐습니다)",
    r"this\s+(?:video|content)\s+(?:is|was)\s+not\s+sponsored",
    r"this\s+(?:video|content)\s+(?:contains|includes)\s+no\s+(?:paid\s+promotion|sponsorship|advertising)",
]
POSITIVE = [re.compile(r"^(?:" + p + r")$", re.I) for p in POSITIVE]
NEGATIVE = [re.compile(r"^(?:" + p + r")$", re.I) for p in NEGATIVE]
UNNAMED = re.compile(r"^(?:" + SUBJECT + r"(?:유료\s*광고|광고|협찬)(?:을|를)?\s*(?:포함(?:합니다|하고\s*있습니다)|입니다)|this\s+(?:video|content)\s+(?:(?:is|was)\s+(?:sponsored|(?:an?\s+)?(?:paid\s+promotion|sponsorship|advertisement|advertising))|(?:contains|includes)\s+(?:a\s+)?(?:paid\s+promotion|sponsorship)))$", re.I)
SPLIT_NAMES = re.compile(r"\s*(?:,|;|\s+(?:및|그리고)\s+)\s*", re.I)


def _normalized_source(source):
    # Combine marks and Hangul Jamo before NFKC; retain raw source offsets.
    groups = []
    for i, char in enumerate(source):
        if groups and (unicodedata.category(char).startswith("M") or
                       ((0x1161 <= ord(char) <= 0x1175 and 0x1100 <= ord(source[i-1]) <= 0x1112) or
                        (0x11A8 <= ord(char) <= 0x11C2 and 0x1161 <= ord(source[i-1]) <= 0x1175))):
            groups[-1][1] = i + 1
        else:
            groups.append([i, i + 1])
    chars, spans = [], []
    for start, end in groups:
        if source[start:end] == "\n" and start > 0 and source[start-1] == "\r":
            continue
        for char in unicodedata.normalize("NFKC", source[start:end]):
            if char in "\u200b\ufeff":
                continue
            chars.append("\n" if char in "\r\n\u2028\u2029" else " " if char.isspace() else char)
            spans.append((start, end))
    return "".join(chars), spans


def _valid_name(name):
    if not 1 <= len(name) <= 80 or not any(unicodedata.category(c).startswith("L") for c in name):
        return False
    # Contact-shaped tokens are not company evidence, even inside a disclosure.
    # Keep mixed-letter number brands; reject standalone long phone-like runs.
    if re.search(r"[@:/\\]|(?:^|\s)[^\s.]+\.[^\s.]+(?:\s|$)|(?<![A-Za-z0-9])[0-9](?:[ ()+.-]*[0-9]){6,}(?![A-Za-z0-9])", name):
        return False
    if not all(unicodedata.category(c)[0] in "LN" or c in " &.'’()-" for c in name):
        return False
    if re.search(r"[.!?]\s", name):
        return False
    # Reject prose, unresolved lists, placeholders and meta/instructional mentions.
    return not re.search(r"(?:광고|협찬|영상|콘텐츠|저희|저는|우리는|소문|예시|문구|따르면|오늘|어제|내일|이번에|아닙|없이|없음|없습니다|받지|예정|sponsor|advertis|example|prompt|instruction|rumor|reported|alleged|\b(?:if|unless|but|because|according|for|no|one)\b|not\b|none\b|unknown\b|https?|www\.|(?:와|과|은|는|이|가)\s|\band\b)", name, re.I)


def _uncertain_period(left, right):
    """Do not split dotted company abbreviations into confident shorter names."""
    left = left.rstrip()
    if not left.endswith("."):
        return False
    word = re.search(r"(?:^|[\s(])([A-Za-z]+)\.$", left)
    return bool((word and (len(word.group(1)) == 1 or word.group(1).lower() in
                         {"dr", "mr", "mrs", "ms", "st", "jr", "sr", "co", "inc", "ltd", "corp", "vs", "etc"}))
                or re.match(r"\s*(?:inc|ltd|llc|corp|co)\b", right, re.I))


def analyze_disclosure(source):
    digest = hashlib.sha256(source.encode("utf-8")).hexdigest() if isinstance(source, str) else None

    def result(outcome, reason, names=None):
        return {"is_ads": True if outcome == "detected" else False if outcome == "confirmed_none" else None,
                "what_ads": names,
                "sponsor_analysis": {"status": "completed" if outcome != "unknown" else "unknown",
                                     "outcome": outcome, "reason": reason, "source": SOURCE,
                                     "version": VERSION, "source_sha256": digest}}

    if not isinstance(source, str):
        return result("unknown", "description_unavailable")
    text, spans = _normalized_source(source)
    names, seen = [], set()
    negative = False
    ambiguous = False
    negative_mention = bool(re.search(r"(?:광고|협찬)(?:가|이)?\s*(?:아닙|아니|없)|협찬\s*없이|\b(?:not|never)\s+sponsored\b", text, re.I))
    # A paragraph framed as an example, quotation or code is not the author's disclosure.
    for paragraph in re.finditer(r"[^\n]+(?:\n(?!\s*\n)[^\n]+)*", text):
        content = paragraph.group()
        if re.search(r"소문|따르면|보도|주장|말했|말합|전했|전합|\b(?:said|says|wrote|claims?|reported|alleged|rumou?r|according\s+to|for\s+example)\b", content, re.I):
            continue
        if any(marker in content for marker in ('```', '"', '“', '”')):
            continue
        if any(line.lstrip().startswith(('>', "'", '‘')) or
               (len(line) <= 1024 and re.search(r"(?:예시|인용|문구|example|quote|prompt|instruction).*:", line, re.I))
               for line in content.split("\n")):
            continue
        # Split ordinary sentences as well as wrapped lines, after rejecting
        # quoted/reported framing. Abbreviations must not truncate company names.
        chunks = []
        cursor = 0
        separators = re.finditer(r"\n+|[.!?。！？]+", content)
        for sep in list(separators) + [None]:
            if sep:
                following = content[sep.end():sep.end()+128]
                if sep.group()[0] != "\n" and following and not following[0].isspace() and not re.match(
                        r"(?:(?:본|이|이번)\s*(?:영상|콘텐츠)|this\s+(?:video|content)|(?:i|we)\s+(?:received|accepted))", following, re.I):
                    continue
                if _uncertain_period(content[max(0, sep.end()-128):sep.end()], following):
                    continue
            end = sep.start() if sep else len(content)
            if end > cursor:
                chunks.append((cursor, end))
            cursor = sep.end() if sep else len(content)
        i = 0
        while i < len(chunks):
            matched = False
            # Up to three physical lines may wrap a disclosure. Do not join sentences.
            for count in range(1, min(3, len(chunks)-i) + 1):
                start, end = chunks[i][0], chunks[i+count-1][1]
                if count > 1 and re.search(r"[.!?。！？]", content[chunks[i+count-2][1]:chunks[i+count-1][0]]):
                    break
                raw = content[start:end].strip()
                if raw.endswith(("?", "？")):
                    continue
                statement = raw.rstrip(".!?。！？").rstrip()
                delimiter = re.compile(r"[.!?。！？]+").match(content, end)
                if not statement or len(statement) > 1024 or (delimiter and re.search(r"[?？]", delimiter.group())):
                    continue
                if _uncertain_period(content[start:end], content[end:end+128]):
                    continue
                if any(p.fullmatch(statement) for p in NEGATIVE):
                    negative = True
                    matched = True
                if UNNAMED.fullmatch(statement):
                    ambiguous = True
                    matched = True
                for pattern in POSITIVE:
                    match = pattern.fullmatch(statement)
                    if not match:
                        continue
                    matched = True
                    value = match.group("sponsor")
                    # Split with explicit separators, preserving exact source spelling.
                    cursor = 0
                    parts = []
                    for sep in list(SPLIT_NAMES.finditer(value)) + [None]:
                        stop = sep.start() if sep else len(value)
                        piece = value[cursor:stop]
                        left = len(piece) - len(piece.lstrip())
                        piece = piece.strip()
                        parts.append((piece, cursor + left))
                        cursor = sep.end() if sep else len(value)
                    if any(not _valid_name(name) for name, _ in parts):
                        ambiguous = True
                        continue
                    offset = paragraph.start() + start + len(content[start:end]) - len(content[start:end].lstrip()) + match.start("sponsor")
                    for name, position in parts:
                        key = re.sub(r"\s+", " ", name).lower()
                        if key not in seen:
                            seen.add(key)
                            a, b = offset + position, offset + position + len(name)-1
                            original_name = source[spans[a][0]:spans[b][1]]
                            if len(original_name) > 160:
                                ambiguous = True
                            else:
                                names.append(original_name)
                if matched:
                    i += count
                    break
            if not matched:
                i += 1
    if ambiguous or len(names) > 5 or ((negative or negative_mention) and names):
        return result("unknown", "ambiguous_disclosure")
    if names:
        return result("detected", "positive_first_party_evidence_found", names)
    if negative:
        return result("confirmed_none", "explicit_first_party_no_ad")
    return result("unknown", "no_positive_first_party_evidence")


def supplement_ads(description, previous=None, previous_description=None, *, enabled=True):
    """Unknown/disabled replacement preserves historical values, never completion."""
    prior = previous if isinstance(previous, dict) else {}
    resolved = type(prior.get("is_ads")) is bool or bool(prior.get("what_ads"))
    if resolved and description == previous_description and enabled:
        return dict(prior)  # Do not replay or relabel legacy evidence as v1 rule evidence.
    if enabled:
        current = analyze_disclosure(description)
    else:
        current = {"is_ads": None, "what_ads": None,
                   "sponsor_analysis": {"status": "unknown", "outcome": "unknown",
                                        "reason": "analysis_disabled", "source": SOURCE,
                                        "version": VERSION,
                                        "source_sha256": hashlib.sha256(description.encode("utf-8")).hexdigest()
                                        if isinstance(description, str) else None}}
    if resolved and current["sponsor_analysis"]["outcome"] == "unknown":
        analysis = dict(current["sponsor_analysis"])
        old = prior.get("sponsor_analysis")
        old = old if isinstance(old, dict) else {}
        analysis.update(retained_previous=True,
                        retained_version=old.get("retained_version", old.get("version", "legacy")),
                        retained_source_sha256=old.get("retained_source_sha256", old.get("source_sha256")))
        return {**prior, "sponsor_analysis": analysis}
    return current
