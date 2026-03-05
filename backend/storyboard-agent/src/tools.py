"""
Storyboard Agent Tools - Supabase RPC 함수 호출 도구 모음

이 모듈은 LangGraph 에이전트가 사용하는 도구들을 정의합니다.
각 도구는 Supabase RPC 함수를 호출하여 데이터를 조회합니다.
"""

import os
import json
import logging
from typing import Any, Optional
import numpy as np
from langchain_core.tools import tool
from supabase import create_client, Client
from dotenv import load_dotenv

load_dotenv()

SUPABASE_URL = os.getenv("PUBLIC_SUPABASE_URL") or os.getenv("SUPABASE_URL")
SUPABASE_KEY = (
    os.getenv("PUBLIC_SUPABASE_SERVICE_ROLE_KEY") or os.getenv("SUPABASE_SERVICE_ROLE_KEY")
)
LOGGER = logging.getLogger(__name__)

# 전역 클라이언트 (연결 재사용)
_supabase_client: Optional[Client] = None
_bge_model: Optional[Any] = None
_reranker: Optional[Any] = None

EMBEDDING_DENOMINATOR_EPSILON = 1e-8


def _parse_embedding(value: Any) -> list[float]:
    """Parse an embedding payload into a numeric vector."""
    if isinstance(value, str):
        try:
            value = json.loads(value)
        except json.JSONDecodeError:
            return []

    if not isinstance(value, list):
        return []

    parsed: list[float] = []
    for item in value:
        try:
            parsed.append(float(item))
        except (TypeError, ValueError):
            continue
    return parsed


def _as_sparse_query_map(raw_sparse: Any) -> dict[str, float]:
    if not isinstance(raw_sparse, dict):
        return {}
    parsed: dict[str, float] = {}
    for key, value in raw_sparse.items():
        try:
            parsed[str(key)] = float(value)
        except (TypeError, ValueError):
            continue
    return parsed


def _ensure_payload_data(payload: Any) -> list[dict[str, Any]]:
    """Normalize Supabase RPC payload data into a list of dict-like rows."""
    if not payload:
        return []

    if hasattr(payload, "data"):
        payload = {"data": payload.data}

    if not isinstance(payload, dict):
        return []

    data = payload.get("data")
    if not isinstance(data, list):
        return []

    return [item for item in data if isinstance(item, dict)]


def _build_query_embeddings(query: str) -> tuple[list[float], dict[str, float]]:
    """Build dense and sparse vectors used by vector search."""
    model = get_bge_model()
    encoded = model.encode([query], return_dense=True, return_sparse=True)

    dense_payload = encoded.get("dense_vecs")
    sparse_payload = encoded.get("lexical_weights")
    if not isinstance(dense_payload, (list, tuple)) or not dense_payload:
        raise ValueError("임베딩 dense 벡터 형식이 올바르지 않습니다.")
    if not isinstance(sparse_payload, (list, tuple)) or not sparse_payload:
        raise ValueError("임베딩 결과가 예상 형식이 아닙니다.")

    dense_vector = dense_payload[0]
    if hasattr(dense_vector, "tolist"):
        dense_vector = dense_vector.tolist()

    return list(dense_vector), _as_sparse_query_map(sparse_payload[0])


def get_supabase() -> Client:
    """Supabase 클라이언트 싱글톤 반환"""
    global _supabase_client
    if _supabase_client is None:
        if not SUPABASE_URL or not SUPABASE_KEY:
            raise ValueError(
                "SUPABASE_URL 또는 SUPABASE_SERVICE_ROLE_KEY가 설정되지 않았습니다."
            )
        _supabase_client = create_client(SUPABASE_URL, SUPABASE_KEY)
    return _supabase_client


def get_bge_model():
    """BGE-M3 모델 싱글톤 반환"""
    global _bge_model
    if _bge_model is None:
        from FlagEmbedding import BGEM3FlagModel

        _bge_model = BGEM3FlagModel("BAAI/bge-m3", use_fp16=True)
    return _bge_model


def get_reranker():
    """BGE-reranker-v2-m3 싱글톤 반환"""
    global _reranker
    if _reranker is None:
        from FlagEmbedding import FlagReranker

        _reranker = FlagReranker("BAAI/bge-reranker-v2-m3", use_fp16=True)
    return _reranker


def apply_mmr(
    results: list[dict],
    query_embedding: list[float],
    k: int = 10,
    diversity: float = 0.3,
) -> list[dict]:
    """
    MMR(Maximal Marginal Relevance) 알고리즘으로 다양성 확보

    Args:
        results: 검색 결과 리스트 (embedding 포함)
        query_embedding: 쿼리 임베딩 벡터
        k: 선택할 결과 수
        diversity: 다양성 파라미터 (0-1, 높을수록 다양)

    Returns:
        MMR 알고리즘으로 선택된 결과
    """
    if not results or not query_embedding:
        return []

    query_vec = np.array(query_embedding, dtype=float)
    query_norm = float(np.linalg.norm(query_vec))
    if query_norm <= 0:
        return []

    prepared_candidates: list[tuple[dict, np.ndarray, float]] = []
    for source_doc in results:
        embedding = _parse_embedding(source_doc.get("embedding", []))
        if not embedding:
            continue
        vector = np.array(embedding, dtype=float)
        vector_norm = float(np.linalg.norm(vector))
        if vector_norm <= 0:
            continue
        prepared_candidates.append((source_doc, vector, vector_norm))

    if not prepared_candidates:
        return []

    selected: list[dict] = []
    selected_vectors: list[tuple[np.ndarray, float]] = []

    while len(selected) < k and prepared_candidates:
        best_score = -float("inf")
        best_index = None

        for index, (candidate, candidate_vec, candidate_norm) in enumerate(prepared_candidates):
            try:
                candidate_similarity = float(
                    np.dot(query_vec, candidate_vec) / (query_norm * candidate_norm + EMBEDDING_DENOMINATOR_EPSILON)
                )
            except ValueError:
                continue

            max_similarity_to_selected = 0.0
            for selected_vec, selected_norm in selected_vectors:
                try:
                    similarity = float(
                        np.dot(candidate_vec, selected_vec)
                        / (candidate_norm * selected_norm + EMBEDDING_DENOMINATOR_EPSILON)
                    )
                except ValueError:
                    continue
                if similarity > max_similarity_to_selected:
                    max_similarity_to_selected = similarity

            mmr_score = (1 - diversity) * candidate_similarity - diversity * max_similarity_to_selected
            if mmr_score > best_score:
                best_score = mmr_score
                best_index = index

        if best_index is None:
            break

        selected_doc, selected_vec, selected_norm = prepared_candidates.pop(best_index)
        selected.append(selected_doc)
        selected_vectors.append((selected_vec, selected_norm))

    return selected


# =============================================================================
# 1. 비디오 캡션 조회 (시간 범위)
# =============================================================================
# 주의: search_transcripts_hybrid에서 내부 호출하기 위해 먼저 정의합니다.
def get_video_captions_for_range(
    video_id: str,
    recollect_id: int,
    start_sec: int,
    end_sec: int,
) -> dict:
    """
    특정 비디오의 시간 범위에 해당하는 프레임 캡션 조회

    Args:
        video_id: 유튜브 비디오 ID
        recollect_id: 수집 ID (없으면 duration 기준으로 자동 매칭)
        start_sec: 시작 시간(초)
        end_sec: 종료 시간(초)

    Returns:
        해당 시간 범위의 캡션 목록
    """
    client = get_supabase()
    result = client.rpc(
        "get_video_captions_for_range",
        {
            "p_video_id": video_id,
            "p_recollect_id": recollect_id,
            "p_start_sec": start_sec,
            "p_end_sec": end_sec,
        },
    ).execute()
    return {"captions": result.data}


# =============================================================================
# 2. 하이브리드 자막 검색 (Dense 0.6 + Sparse 0.4) + MMR + Reranking
# =============================================================================
@tool
def search_transcripts_hybrid(
    query: str,
    video_ids: list[str] | None = None,
    dense_weight: float = 0.6,
    match_count: int = 20,
    mmr_k: int = 10,
    mmr_diversity: float = 0.3,
    rerank_top_k: int = 5,
    intent: str = "simple_chat",
) -> dict:
    """
    먹방 유튜브 자막을 의미 기반으로 검색합니다.

    **사용 상황:**
    1. 특정 음식/식당을 먹는 영상을 찾을 때 (예: "떡볶이 먹는 장면", "냉면 맛있다")
    2. 특정 주제의 영상을 찾을 때 (예: "먹방 리액션", "ASMR 소리")
    3. 스토리보드 제작을 위해 참고 영상을 찾을 때

    **쿼리 작성 팁:**
    - 다양한 표현으로 여러 번 검색하세요 (예: "떡볶이", "매운 떡볶이", "떡볶이 먹방")
    - 짧고 구체적인 키워드가 효과적입니다
    - 검색 결과가 부족하면 다른 키워드로 재검색하세요

    **반환 데이터:**
    - video_id: 영상 식별자
    - page_content: 자막 텍스트
    - metadata: 시작/종료 시간, is_peak 여부
    - caption (storyboard 모드): 해당 구간의 시각적 묘사

    **storyboard 모드:**
    intent='storyboard'로 설정하면 is_peak=True인 구간의 캡션(시각적 묘사)을 자동 조회합니다.
    스토리보드 제작 시 반드시 intent='storyboard'를 사용하세요.

    Args:
        query: 검색 쿼리 (예: "떡볶이 먹방", "삼겹살 굽는 소리")
        video_ids: 특정 video_id만 검색 (선택, search_video_ids_by_query 결과 사용)
        intent: 'storyboard' 또는 'simple_chat' (기본값)

    Returns:
        transcripts: 검색된 자막 목록 (video_id, page_content, metadata 포함)
    """
    # 1. 쿼리 임베딩 생성 (Dense + Sparse)
    query_dense, query_sparse = _build_query_embeddings(query)

    # 2. 하이브리드 검색 (Supabase RPC)
    client = get_supabase()
    result = client.rpc(
        "match_documents_hybrid",
        {
            "query_embedding": query_dense,
            "query_sparse": query_sparse,
            "dense_weight": dense_weight,
            "match_threshold": 0.5,
            "match_count": match_count,
        },
    ).execute()

    search_results = _ensure_payload_data(result)
    if not search_results:
        return {"transcripts": [], "message": "검색 결과 없음"}

    # video_ids 필터링 (지정된 경우)
    if video_ids:
        requested_ids = set(video_ids)
        search_results = [r for r in search_results if r.get("video_id") in requested_ids]

    # 3. MMR 적용 (다양성 확보)
    mmr_results = apply_mmr(search_results, query_dense, k=mmr_k, diversity=mmr_diversity)

    if not mmr_results:
        return {"transcripts": [], "message": "MMR 후 결과 없음"}

    # 4. Reranking (BGE-reranker-v2-m3)
    reranker = get_reranker()
    pairs = [(query, r.get("page_content", "")) for r in mmr_results]
    scores = reranker.compute_score(pairs)

    # 점수가 단일 값이면 리스트로 변환
    if not isinstance(scores, list):
        scores = [scores]

    # 점수 할당 및 정렬
    scored_results = []
    for i, r in enumerate(mmr_results):
        scored_doc = dict(r)
        scored_doc["rerank_score"] = float(scores[i]) if i < len(scores) else 0.0
        scored_results.append(scored_doc)

    reranked = sorted(scored_results, key=lambda x: x["rerank_score"], reverse=True)[
        :rerank_top_k
    ]

    # embedding 제거 (응답 크기 축소)
    for r in reranked:
        r.pop("embedding", None)

    # 5. 캡션 자동 보강 (Storyboard 모드일 때만 실행)
    if intent == "storyboard":
        LOGGER.info("Storyboard 모드 감지: Peak 구간 캡션 자동 조회 중...")
        for doc in reranked:
            # 메타데이터에 is_peak가 있고 True인 경우
            meta = doc.get("metadata", {})
            if meta.get("is_peak"):
                try:
                    # 내부적으로 캡션 함수 호출
                    captions_result = get_video_captions_for_range(
                        video_id=doc["video_id"],
                        recollect_id=doc["recollect_id"],
                        start_sec=int(meta.get("start_time", 0)),
                        end_sec=int(meta.get("end_time", 0)),
                    )
                    # 찾은 캡션을 해당 자막 문서에 'caption' 필드로 추가
                    # (LLM이 참고할 수 있도록 metadata에 합침)
                    if captions_result and captions_result.get("captions"):
                        doc["metadata"]["caption"] = captions_result["captions"]

                except Exception as e:
                    LOGGER.warning(
                        "캡션 조회 실패 (%s): %s",
                        doc.get("video_id"),
                        e,
                    )

    return {"transcripts": reranked}


# =============================================================================
# 3. 카테고리별 음식점 검색
# =============================================================================
@tool
def search_restaurants_by_category(
    category: str,
    limit: int = 10,
) -> dict:
    """
    특정 카테고리에 해당하는 음식점 검색 (예: "냉면", "치킨")

    Args:
        category: 검색할 카테고리명
        limit: 최대 반환 수 (기본값: 10)

    Returns:
        해당 카테고리의 승인된 음식점 목록
    """
    client = get_supabase()
    result = client.rpc(
        "search_restaurants_by_category",
        {"p_category": category, "p_limit": limit},
    ).execute()
    return {"restaurants": result.data}


# =============================================================================
# 4. 비디오 메타데이터 필터링 조회
# =============================================================================
@tool
def get_video_metadata_filtered(
    min_view_count: int = 0,
    limit: int = 5,
    order_by: str = "view_count",
) -> dict:
    """
    조회수/게시일 등으로 필터링된 비디오 메타데이터 조회

    Args:
        min_view_count: 최소 조회수 (기본값: 0)
        limit: 최대 반환 수 (기본값: 5)
        order_by: 정렬 기준 - "view_count", "published_at", "comment_count" (기본값: "view_count")

    Returns:
        필터링된 비디오 메타데이터 목록
    """
    client = get_supabase()
    result = client.rpc(
        "get_video_metadata_filtered",
        {"min_view_count": min_view_count, "p_limit": limit, "p_order_by": order_by},
    ).execute()
    return {"videos": result.data}


# =============================================================================
# 5. 음식점명/video_id로 카테고리 조회
# =============================================================================
@tool
def get_categories_by_restaurant(
    restaurant_name: Optional[str] = None,
    video_id: Optional[str] = None,
) -> dict:
    """
    음식점명 또는 video_id로 해당 음식점의 카테고리 조회

    Args:
        restaurant_name: 음식점명 (선택)
        video_id: 유튜브 비디오 ID (선택)

    Returns:
        해당 음식점의 카테고리 배열
    """
    client = get_supabase()
    result = client.rpc(
        "get_categories_by_restaurant_name_or_youtube_url",
        {"p_restaurant_name": restaurant_name, "p_video_id": video_id},
    ).execute()
    return {"categories": result.data}


# =============================================================================
# 6. 음식점 이름으로 검색
# =============================================================================
@tool
def search_restaurants_by_name(
    keyword: str,
    limit: int = 5,
) -> dict:
    """
    음식점 이름으로 검색 (부분 일치)

    Args:
        keyword: 검색 키워드 (예: "엽기떡볶이")
        limit: 최대 반환 수 (기본값: 5)

    Returns:
        매칭된 음식점 목록 (id, name, categories, youtube_link, video_id, tzuyang_review)
    """
    client = get_supabase()
    result = client.rpc(
        "search_restaurants_by_name",
        {"keyword": keyword, "p_limit": limit},
    ).execute()
    return {"restaurants": result.data}


# =============================================================================
# 7. 승인된 모든 음식점명 조회
# =============================================================================
@tool
def get_all_approved_restaurant_names() -> dict:
    """
    승인된 모든 음식점명 목록 조회 (LLM 참조용)

    LLM이 사용자 입력에서 음식점명을 추출할 때 참조합니다.

    Returns:
        승인된 음식점명과 카테고리 목록
    """
    client = get_supabase()
    result = client.rpc("get_all_approved_restaurant_names", {}).execute()
    return {"restaurants": result.data}


# =============================================================================
# 8. 쿼리 기반 video_id 검색
# =============================================================================
@tool
def search_video_ids_by_query(
    query: str,
    match_count: int = 10,
) -> dict:
    """
    사용자 요청에 맞는 검색 쿼리를 생성하여 관련 video_id 목록을 검색합니다.

    **사용 상황:**
    1. 스토리보드 제작 시 참고할 영상을 찾을 때 (1단계)
    2. 특정 음식/주제의 영상 목록을 수집할 때

    **쿼리 생성 팁:**
    - 사용자 요청에서 핵심 키워드를 추출하세요
    - 다양한 표현으로 여러 번 호출하세요 (예: "떡볶이", "매운 떡볶이", "떡볶이 먹방")
    - 충분한 video_id가 모일 때까지 반복 호출하세요

    **반환 데이터:**
    - video_id: 영상 식별자
    - recollect_id: 수집 버전 ID
    - best_score: 해당 영상의 최고 매칭 점수
    - sample_content: 매칭된 자막 샘플 (150자)
    - has_peak: 하이라이트 구간(is_peak=True) 존재 여부

    **다음 단계:**
    충분한 video_id가 모이면 get_transcripts_with_captions를 호출하여 상세 자막+캡션을 조회하세요.

    Args:
        query: 검색 쿼리 (예: "떡볶이 먹방", "삼겹살 ASMR")
        match_count: 반환할 video_id 수 (기본값: 10)

    Returns:
        video_ids: 관련 video_id 목록 (중복 제거됨)
    """
    # 쿼리 임베딩 생성
    query_dense, query_sparse = _build_query_embeddings(query)

    # Supabase RPC 호출
    client = get_supabase()
    result = client.rpc(
        "search_video_ids_by_query",
        {
            "query_embedding": query_dense,
            "query_sparse": query_sparse,
            "dense_weight": 0.6,
            "match_threshold": 0.5,
            "match_count": match_count,
        },
    ).execute()

    return {"video_ids": result.data, "query_used": query}


# =============================================================================
# 10. 웹 검색 (Tavily)
# =============================================================================
try:
    from langchain_teddynote.tools.tavily import TavilySearch

    # Tavily 웹 검색 도구 초기화
    web_search = TavilySearch(max_results=5)
except Exception as exc:
    LOGGER.warning("TavilySearch 초기화 실패: %s", exc)
    web_search = None


# =============================================================================
# 도구 목록 (LangGraph에서 사용)
# =============================================================================
TOOLS = [
    # Supabase RPC 도구
    search_video_ids_by_query,  # 1단계: video_id 수집
    search_transcripts_hybrid,  # 2단계: 자막 검색 (video_ids 필터, intent별 캡션)
    search_restaurants_by_category,
    get_video_metadata_filtered,
    get_categories_by_restaurant,
    search_restaurants_by_name,
    get_all_approved_restaurant_names,
]

if web_search is not None:
    TOOLS.append(web_search)  # 외부 도구
