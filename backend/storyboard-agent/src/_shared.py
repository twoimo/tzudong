"""공유 유틸리티: Supabase 클라이언트, BGE 모델, Reranker, MMR, log.md 로거, 코드 안전성 검사"""

import json
import os
import re
import sys
from pathlib import Path
from datetime import datetime
from typing import Optional

import numpy as np
from supabase import create_client, Client
from dotenv import load_dotenv

_BACKEND_ROOT = Path(__file__).resolve().parents[2]
if str(_BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(_BACKEND_ROOT))

from utils.privacy_log import redact_log_text
from utils.supabase_rest import resolve_privileged_supabase_rest_credentials

_SRC_DIR = os.path.dirname(os.path.abspath(__file__))
_BASE_DIR = os.path.dirname(_SRC_DIR)

load_dotenv(os.path.join(_BASE_DIR, ".env"))


_supabase_client: Optional[Client] = None
_bge_model = None
_reranker = None
_LOG_PATH = os.path.join(_BASE_DIR, "log.md")


def _supports_fp16() -> bool:
    """Return True only when half precision inference is safe for this host."""
    try:
        import torch

        return bool(torch.cuda.is_available())
    except Exception:
        return False


def _patch_flagembedding_dtype_kwarg() -> None:
    """Keep FlagEmbedding 1.4.0 compatible with transformers 4.x.

    FlagEmbedding 1.4.0 calls ``AutoModel.from_pretrained(..., dtype=...)``.
    The transformers 4.x line expects ``torch_dtype`` instead and forwards the
    unknown ``dtype`` kwarg into XLMRobertaModel, which raises at runtime.
    Patch the narrow FlagEmbedding runner call-site instead of weakening the
    storyboard search contract or pretending retrieval succeeded.
    """
    try:
        from FlagEmbedding.finetune.embedder.encoder_only.m3 import runner as m3_runner
    except Exception:
        return

    original = m3_runner.AutoModel.from_pretrained
    if getattr(original, "_tzudong_dtype_compat", False):
        return

    def compat_from_pretrained(*args, **kwargs):
        if "dtype" in kwargs:
            dtype_value = kwargs.pop("dtype")
            if dtype_value is not None and "torch_dtype" not in kwargs:
                kwargs["torch_dtype"] = dtype_value
        return original(*args, **kwargs)

    compat_from_pretrained._tzudong_dtype_compat = True  # type: ignore[attr-defined]
    m3_runner.AutoModel.from_pretrained = compat_from_pretrained


def log_tool_call(tool_name: str, **kwargs) -> None:
    """Record only bounded tool identity and argument field names, never values."""
    timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    safe_tool_name = redact_log_text(tool_name, max_length=64)
    field_names = sorted(redact_log_text(name, max_length=64) for name in kwargs)[:32]
    entry = (
        f"- `{timestamp}` **{safe_tool_name}**"
        f"(fields={json.dumps(field_names, ensure_ascii=True)}, field_count={len(kwargs)})\n"
    )
    flags = os.O_WRONLY | os.O_CREAT | os.O_APPEND
    if hasattr(os, "O_NOFOLLOW"):
        flags |= os.O_NOFOLLOW
    descriptor = os.open(_LOG_PATH, flags, 0o600)
    with os.fdopen(descriptor, "a", encoding="utf-8") as file:
        file.write(entry)


def get_supabase() -> Client:
    """Supabase 클라이언트 싱글톤 반환"""
    global _supabase_client
    if _supabase_client is None:
        credentials = resolve_privileged_supabase_rest_credentials()
        _supabase_client = create_client(
            credentials.url,
            credentials.service_role_key,
        )
    return _supabase_client


def get_bge_model():
    """BGE-M3 모델 싱글톤 반환"""
    global _bge_model
    if _bge_model is None:
        _patch_flagembedding_dtype_kwarg()
        from FlagEmbedding import BGEM3FlagModel

        _bge_model = BGEM3FlagModel("BAAI/bge-m3", use_fp16=_supports_fp16())
    return _bge_model


def get_reranker():
    """BGE-reranker-v2-m3 싱글톤 반환"""
    global _reranker
    if _reranker is None:
        from FlagEmbedding import FlagReranker

        _reranker = FlagReranker("BAAI/bge-reranker-v2-m3", use_fp16=_supports_fp16())
    return _reranker


def apply_mmr(
    results: list[dict],
    query_embedding: list[float],
    k: int = 10,
    diversity: float = 0.3,
) -> list[dict]:
    """MMR(Maximal Marginal Relevance) 알고리즘으로 다양성 확보"""
    if not results:
        return []

    def parse_embedding(val):
        if isinstance(val, str):
            try:
                val = json.loads(val)
            except (json.JSONDecodeError, TypeError):
                return []
        return val

    selected = []
    candidates = results.copy()
    query_vec = np.array(query_embedding)

    while len(selected) < k and candidates:
        best_score = -float("inf")
        best_idx = 0

        for i, cand in enumerate(candidates):
            emb = parse_embedding(cand.get("embedding", []))
            cand_vec = np.array(emb)
            if len(cand_vec) == 0:
                continue

            sim_query = np.dot(query_vec, cand_vec) / (
                np.linalg.norm(query_vec) * np.linalg.norm(cand_vec) + 1e-8
            )

            max_sim_selected = 0
            for sel in selected:
                s_emb = parse_embedding(sel.get("embedding", []))
                sel_vec = np.array(s_emb)
                if len(sel_vec) == 0:
                    continue
                sim = np.dot(cand_vec, sel_vec) / (
                    np.linalg.norm(cand_vec) * np.linalg.norm(sel_vec) + 1e-8
                )
                max_sim_selected = max(max_sim_selected, sim)

            mmr_score = (1 - diversity) * sim_query - diversity * max_sim_selected
            if mmr_score > best_score:
                best_score = mmr_score
                best_idx = i

        if candidates and 0 <= best_idx < len(candidates):
            selected.append(candidates.pop(best_idx))
        else:
            break

    return selected


# =============================================================================
# 코드 안전성 검사 (regex 기반, 단어 경계 매칭)
# =============================================================================

_PYTHON_DANGEROUS_RE = [
    (re.compile(r"\bos\.system\s*\("), "os.system() — 시스템 명령 실행"),
    (re.compile(r"\bsubprocess\b"), "subprocess — 서브프로세스"),
    (re.compile(r"\bexec\s*\("), "exec() — 동적 코드 실행"),
    (re.compile(r"\beval\s*\("), "eval() — 동적 표현식 실행"),
    (re.compile(r"\b__import__\s*\("), "__import__() — 동적 임포트"),
    (re.compile(r"\bshutil\.rmtree\b"), "shutil.rmtree — 디렉토리 재귀 삭제"),
    (
        re.compile(r"\bos\.(rmdir|unlink|remove)\s*\("),
        "os.remove/unlink/rmdir — 파일 삭제",
    ),
    (re.compile(r"\b(requests|urllib|httpx)\."), "HTTP 라이브러리 — 외부 요청"),
    (re.compile(r"\bsocket\."), "socket — 직접 네트워크 접근"),
]

_SQL_DANGEROUS_RE = [
    (
        re.compile(
            r"\bdrop\s+(table|schema|database|function|index|view|trigger|role|type)\b",
            re.I,
        ),
        "DROP 구문",
    ),
    (re.compile(r"\btruncate\b", re.I), "TRUNCATE — 전체 데이터 삭제"),
    (
        re.compile(r"\balter\s+(table|schema|database|role|type)\b", re.I),
        "ALTER 구문 — 구조 변경",
    ),
    (re.compile(r"\bgrant\b", re.I), "GRANT — 권한 부여"),
    (re.compile(r"\brevoke\b", re.I), "REVOKE — 권한 회수"),
    (re.compile(r"\bcreate\s+role\b", re.I), "CREATE ROLE"),
    (re.compile(r"\bcopy\b", re.I), "COPY — 파일 I/O"),
    (re.compile(r"\bexecute\b", re.I), "EXECUTE — 동적 SQL"),
]


def review_python_code(code: str) -> list[str]:
    """Python 코드에서 위험 패턴 탐지 (regex 단어 경계 매칭)."""
    return [f"[위험] {desc}" for pat, desc in _PYTHON_DANGEROUS_RE if pat.search(code)]


def review_sql_code(code: str) -> list[str]:
    """SQL 코드에서 위험 패턴 탐지. RPC 함수 정의(CREATE FUNCTION)만 허용."""
    warnings = []
    if not re.search(r"\bcreate\s+(or\s+replace\s+)?function\b", code, re.I):
        warnings.append(
            "[위험] CREATE FUNCTION 구문이 아닙니다. RPC 함수 정의만 허용됩니다."
        )
    warnings.extend(
        f"[위험] {desc}" for pat, desc in _SQL_DANGEROUS_RE if pat.search(code)
    )
    if re.search(r"\bdelete\s+from\b", code, re.I) and not re.search(
        r"\bwhere\b", code, re.I
    ):
        warnings.append("[위험] DELETE FROM without WHERE — 전체 행 삭제 가능")
    if re.search(r"\bupdate\b.*\bset\b", code, re.I) and not re.search(
        r"\bwhere\b", code, re.I
    ):
        warnings.append("[위험] UPDATE without WHERE — 전체 행 수정 가능")
    return warnings
