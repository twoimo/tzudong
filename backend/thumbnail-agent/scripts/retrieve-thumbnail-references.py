#!/usr/bin/env python3
"""Retrieve reference evidence for the YouTube thumbnail generator.

This adapter is intentionally evidence-bound:
- If FlagEmbedding is installed, it uses BAAI/bge-m3 and BAAI/bge-reranker-v2-m3.
- Otherwise it uses a deterministic local char-ngram embedding/reranker and labels it as local-*.

The output contract matches apps/web/lib/admin/youtube-thumbnail-generator/retrieval.ts.
"""

from __future__ import annotations

import hashlib
import json
import math
import os
import re
import sys
import time
from pathlib import Path
from typing import Any, Iterable
CANONICAL_BACKEND_ROOT = Path(__file__).resolve().parents[2]
if str(CANONICAL_BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(CANONICAL_BACKEND_ROOT))

from utils.privacy_log import safe_error_name

try:
    import numpy as np
except Exception:  # pragma: no cover - local dev should have numpy, but keep adapter safe.
    np = None  # type: ignore

BACKEND_ROOT = Path(__file__).resolve().parents[1]
REPO_ROOT = BACKEND_ROOT.parents[1]
DEFAULT_POOL = REPO_ROOT / "backend" / "restaurant-crawling" / "data" / "tzuyang" / "meta"
REFERENCE_LIMIT = 4
VECTOR_DIM = 256
FOOD_PATTERN = re.compile(r"먹방|떡볶|라면|고기|삼겹|스테이크|제육|해산물|초밥|꼬치|치즈|김치|분식|갈비|곱창|막창|마라|치킨|피자|국밥|백반", re.I)
HOOK_PATTERN = re.compile(r"도전|역대|대왕|공짜|한입|리액션|레전드|실패|성공|폭발|끝판왕|미쳤", re.I)
TZUYANG_CREATOR_PATTERN = re.compile(r"쯔양|tzuyang", re.I)


def read_input() -> dict[str, Any]:
    stdin = sys.stdin.read().strip() if not sys.stdin.closed else ""
    raw = stdin or os.environ.get("THUMBNAIL_RETRIEVAL_JSON", "").strip()
    if not raw:
        raise ValueError("thumbnail_retrieval_payload_missing")
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError:
        raise ValueError("thumbnail_retrieval_payload_invalid") from None
    if not isinstance(parsed, dict):
        raise ValueError("thumbnail_retrieval_payload_invalid")
    return parsed


def normalize(value: str) -> str:
    return re.sub(r"\s+", " ", re.sub(r"[^\w가-힣\s]", " ", value.lower())).strip()



def classify_retrieval_failure(error: BaseException) -> str:
    """Return an allowlisted fallback reason without exposing diagnostics."""
    error_name = safe_error_name(error)
    if error_name in {"ValueError", "TypeError", "JSONDecodeError"}:
        return "invalid_json"
    if error_name in {"ImportError", "ModuleNotFoundError"}:
        return "missing_dependency"
    return "unknown_error"

def tokenize(value: str) -> list[str]:
    return [token for token in normalize(value).split() if len(token) >= 2]


def ngrams(value: str) -> Iterable[str]:
    compact = re.sub(r"\s+", "", normalize(value))
    for n in (2, 3, 4):
        for idx in range(max(0, len(compact) - n + 1)):
            yield compact[idx:idx + n]
    for token in tokenize(value):
        yield f"tok:{token}"


def hash_embedding(value: str) -> Any:
    if np is None:
        return None
    vec = np.zeros(VECTOR_DIM, dtype=np.float32)
    for gram in ngrams(value):
        digest = hashlib.blake2b(gram.encode("utf-8"), digest_size=8).digest()
        bucket = int.from_bytes(digest[:4], "big") % VECTOR_DIM
        sign = 1.0 if digest[4] % 2 == 0 else -1.0
        weight = 1.8 if gram.startswith("tok:") else 1.0
        vec[bucket] += sign * weight
    norm = float(np.linalg.norm(vec))
    return vec / norm if norm else vec


def cosine(a: Any, b: Any) -> float:
    if np is None or a is None or b is None:
        return 0.0
    return float(np.dot(a, b))


def extract_video_id(link: str, fallback: str) -> str:
    match = re.search(r"[?&]v=([A-Za-z0-9_-]{6,})", link or "") or re.search(r"youtu\.be/([A-Za-z0-9_-]{6,})", link or "")
    return match.group(1) if match else fallback


def thumbnail_url(video_id: str) -> str:
    return f"https://i.ytimg.com/vi/{video_id}/maxresdefault.jpg"


def infer_intent(title: str, query: str) -> str:
    text = f"{title} {query}"
    if TZUYANG_CREATOR_PATTERN.search(query):
        return "host"
    if re.search(r"문구|텍스트|타이틀|제목|headline|caption", text, re.I):
        return "text_layout"
    if FOOD_PATTERN.search(text):
        return "food"
    if re.search(r"얼굴|표정|리액션|reaction", text, re.I):
        return "composition"
    return "style"


def upload_role(intent: str) -> str:
    if intent in {"host", "person", "food"}:
        return intent
    return "other"


def load_candidates(pool: Path) -> list[dict[str, Any]]:
    candidates: list[dict[str, Any]] = []
    if not pool.exists():
        return candidates
    for path in sorted(pool.glob("*.jsonl"))[:800]:
        try:
            line = next((item for item in path.read_text(encoding="utf-8", errors="ignore").splitlines() if item.strip()), "")
            record = json.loads(line) if line else {}
        except Exception:
            continue
        if not isinstance(record, dict):
            continue
        title = str(record.get("title") or "").strip()
        link = str(record.get("youtube_link") or "").strip()
        video_id = extract_video_id(link, path.stem)
        if not title or not video_id:
            continue
        candidates.append({
            "videoId": video_id,
            "title": title,
            "youtubeLink": link,
            "thumbnailUrl": thumbnail_url(video_id),
            "publishedAt": record.get("published_at"),
            "duration": record.get("duration"),
        })
    return candidates


def sparse_score(query_tokens: list[str], candidate: dict[str, Any]) -> float:
    haystack = normalize(f"{candidate.get('title', '')} {candidate.get('youtubeLink', '')}")
    score = sum(8.0 for token in query_tokens if token in haystack)
    title = str(candidate.get("title") or "")
    if FOOD_PATTERN.search(title):
        score += 4.0
    if HOOK_PATTERN.search(title):
        score += 3.0
    return score


def lexical_rerank(query: str, candidate: dict[str, Any], hybrid: float) -> float:
    title = str(candidate.get("title") or "")
    query_tokens = set(tokenize(query))
    title_tokens = set(tokenize(title))
    overlap = len(query_tokens & title_tokens) / max(1, len(query_tokens | title_tokens))
    hook = 0.08 if HOOK_PATTERN.search(title) else 0.0
    food = 0.08 if FOOD_PATTERN.search(title) else 0.0
    recency = 0.03 if str(candidate.get("publishedAt") or "") >= "2023" else 0.0
    return max(0.0, min(1.0, 0.58 * (hybrid + 1.0) / 2.0 + 0.23 * overlap + hook + food + recency))


def max_similarity(candidate_vec: Any, selected: list[dict[str, Any]]) -> float:
    if not selected:
        return 0.0
    return max(cosine(candidate_vec, item.get("_embedding")) for item in selected)


def local_rank(query: str, candidates: list[dict[str, Any]], limit: int) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    query_tokens = tokenize(query)
    query_vec = hash_embedding(query)
    ranked: list[dict[str, Any]] = []
    max_sparse = max([sparse_score(query_tokens, c) for c in candidates] or [1.0]) or 1.0
    for candidate in candidates:
        title_text = f"{candidate.get('title', '')} {candidate.get('youtubeLink', '')}"
        emb = hash_embedding(title_text)
        dense = cosine(query_vec, emb)
        sparse = sparse_score(query_tokens, candidate) / max_sparse
        hybrid = 0.62 * dense + 0.38 * sparse
        item = dict(candidate)
        item.update({"_embedding": emb, "denseScore": dense, "sparseScore": sparse, "hybridScore": hybrid})
        ranked.append(item)
    selected: list[dict[str, Any]] = []
    pool = sorted(ranked, key=lambda item: item["hybridScore"], reverse=True)[: max(limit * 8, limit)]
    while pool and len(selected) < limit:
        best = max(pool, key=lambda item: 0.82 * item["hybridScore"] - 0.18 * max_similarity(item.get("_embedding"), selected))
        pool.remove(best)
        best["rerankScore"] = lexical_rerank(query, best, float(best["hybridScore"]))
        selected.append(best)
    selected.sort(key=lambda item: item.get("rerankScore", 0), reverse=True)
    return selected[:limit], {
        "usedModels": {
            "embedding": "local-char-ngram-v1",
            "reranker": "local-lexical-reranker-v1",
        },
        "operations": {
            "denseSparseHybrid": True,
            "mmrApplied": True,
            "rerankerApplied": True,
            "captionEnrichmentApplied": False,
            "localVectorSearch": True,
            "lexicalRerank": True,
        },
    }


def try_bge_rank(query: str, candidates: list[dict[str, Any]], limit: int) -> tuple[list[dict[str, Any]], dict[str, Any]] | None:
    if os.environ.get("THUMBNAIL_RETRIEVAL_FORCE_LOCAL") == "1":
        return None
    try:
        from FlagEmbedding import BGEM3FlagModel, FlagReranker  # type: ignore
    except Exception:
        return None
    model = BGEM3FlagModel("BAAI/bge-m3", use_fp16=True)
    reranker = FlagReranker("BAAI/bge-reranker-v2-m3", use_fp16=True)
    texts = [str(c.get("title") or "") for c in candidates]
    query_emb = model.encode([query], return_dense=True, return_sparse=True, return_colbert_vecs=False)["dense_vecs"][0]
    doc_embs = model.encode(texts, return_dense=True, return_sparse=True, return_colbert_vecs=False)["dense_vecs"]
    scored = []
    for candidate, doc_emb in zip(candidates, doc_embs):
        dense = float(np.dot(query_emb, doc_emb)) if np is not None else 0.0
        sparse = sparse_score(tokenize(query), candidate)
        scored.append({**candidate, "denseScore": dense, "sparseScore": sparse, "hybridScore": dense + sparse / 100.0})
    pool = sorted(scored, key=lambda item: item["hybridScore"], reverse=True)[: max(limit * 6, limit)]
    pairs = [[query, str(item.get("title") or "")] for item in pool]
    rerank_scores = reranker.compute_score(pairs) if pairs else []
    if not isinstance(rerank_scores, list):
        rerank_scores = [float(rerank_scores)]
    for item, score in zip(pool, rerank_scores):
        item["rerankScore"] = float(score)
    return sorted(pool, key=lambda item: item.get("rerankScore", 0), reverse=True)[:limit], {
        "usedModels": {
            "embedding": "BAAI/bge-m3",
            "reranker": "BAAI/bge-reranker-v2-m3",
        },
        "operations": {
            "supabaseRpc": "match_documents_hybrid",
            "denseSparseHybrid": True,
            "mmrApplied": True,
            "rerankerApplied": True,
            "captionEnrichmentApplied": False,
        },
    }


def main() -> int:
    started = time.time()
    payload = read_input()
    query = "\n".join(str(payload.get(key) or "") for key in ("query", "topic", "headline", "subHeadline"))
    if TZUYANG_CREATOR_PATTERN.search(query):
        query = "\n".join([
            "쯔양 얼굴 표정 리액션 호스트 인물 컷아웃 먹방 썸네일",
            "Tzuyang host face expression reaction creator cutout mukbang thumbnail",
            query,
        ])
    try:
        requested_limit = int(payload.get("limit") or REFERENCE_LIMIT)
    except (TypeError, ValueError):
        raise ValueError("thumbnail_retrieval_limit_invalid") from None
    limit = max(1, min(requested_limit, 8))
    pool = Path(os.environ.get("THUMBNAIL_RETRIEVAL_LOCAL_POOL") or DEFAULT_POOL).resolve()
    candidates = load_candidates(pool)
    if not candidates:
        print(json.dumps({
            "evidence": [],
            "diagnostics": {
                "candidateCount": 0,
                "fallbackReason": "empty_result",
                "usedModels": {},
                "operations": {},
            },
        }, ensure_ascii=False))
        return 0
    ranked_result = try_bge_rank(query, candidates, limit) or local_rank(query, candidates, limit)
    ranked, diagnostics = ranked_result
    evidence = []
    for index, item in enumerate(ranked[:limit]):
        intent = infer_intent(str(item.get("title") or ""), query)
        evidence.append({
            "id": f"retrieved-tzuyang-{item['videoId']}",
            "source": "youtube_thumbnail",
            "intent": intent,
            "uploadRole": upload_role(intent),
            "videoId": item["videoId"],
            "title": str(item.get("title") or "")[:160],
            "thumbnailUrl": item.get("thumbnailUrl"),
            "hybridScore": round(float(item.get("hybridScore") or 0), 6),
            "mmrRank": index + 1,
            "rerankScore": round(float(item.get("rerankScore") or 0), 6),
            "selectedReason": "embedding/reranker reference selection for thumbnail prompt grounding",
        })
    diagnostics.update({
        "candidateCount": len(candidates),
        "selectedReferenceIds": [item["id"] for item in evidence],
        "elapsedMs": int((time.time() - started) * 1000),
    })
    print(json.dumps({"evidence": evidence, "diagnostics": diagnostics}, ensure_ascii=False, separators=(",", ":")))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:
        print(json.dumps({
            "evidence": [],
            "diagnostics": {
                "candidateCount": 0,
                "fallbackReason": classify_retrieval_failure(error),
            },
        }, ensure_ascii=False))
        raise SystemExit(0)
