"""
Storyboard Agent Tools - Supabase RPC 함수 호출 도구 모음

이 모듈은 LangGraph 에이전트가 사용하는 도구들을 정의합니다.
각 도구는 Supabase RPC 함수를 호출하여 데이터를 조회합니다.
"""

import json
import logging
import os
from typing import Optional

import numpy as np
from langchain_core.tools import tool
from supabase import create_client, Client
from dotenv import load_dotenv

logger = logging.getLogger(__name__)

load_dotenv()

SUPABASE_URL = os.getenv("PUBLIC_SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")

# 전역 클라이언트 (연결 재사용)
_supabase_client: Optional[Client] = None
_bge_model = None
_reranker = None


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
    if not results:
        return []

    selected = []
    candidates = results.copy()
    query_vec = np.array(query_embedding)

    def parse_embedding(val):
        if isinstance(val, str):
            try:
                val = json.loads(val)
            except (json.JSONDecodeError, TypeError):
                return []
        return val

    while len(selected) < k and candidates:
        best_score = -float("inf")
        best_idx = 0

        for i, cand in enumerate(candidates):
            emb = parse_embedding(cand.get("embedding", []))
            cand_vec = np.array(emb)

            if len(cand_vec) == 0:
                continue

            # 쿼리와의 유사도
            sim_query = np.dot(query_vec, cand_vec) / (
                np.linalg.norm(query_vec) * np.linalg.norm(cand_vec) + 1e-8
            )

            # 이미 선택된 것들과의 최대 유사도
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

            # MMR 점수
            mmr_score = (1 - diversity) * sim_query - diversity * max_sim_selected

            if mmr_score > best_score:
                best_score = mmr_score
                best_idx = i

        if candidates:
            # 안전장치: best_idx가 유효할 때만
            if 0 <= best_idx < len(candidates):
                selected.append(candidates.pop(best_idx))
            else:
                break

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
    logger.info(
        "get_video_captions_for_range: video_id=%s, recollect_id=%s, start=%s, end=%s",
        video_id,
        recollect_id,
        start_sec,
        end_sec,
    )
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
    video_ids: list[str] = None,
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
    logger.info(
        "search_transcripts_hybrid: query=%s, video_ids=%s, intent=%s",
        query,
        video_ids,
        intent,
    )
    model = get_bge_model()
    encoded = model.encode([query], return_dense=True, return_sparse=True)
    query_dense = encoded["dense_vecs"][0].tolist()
    query_sparse = {str(k): float(v) for k, v in encoded["lexical_weights"][0].items()}

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

    if not result.data:
        return {"transcripts": [], "message": "검색 결과 없음"}

    # video_ids 필터링 (지정된 경우)
    if video_ids:
        result.data = [r for r in result.data if r.get("video_id") in video_ids]

    # 3. MMR 적용 (다양성 확보)
    mmr_results = apply_mmr(result.data, query_dense, k=mmr_k, diversity=mmr_diversity)

    if not mmr_results:
        return {"transcripts": [], "message": "MMR 후 결과 없음"}

    # 4. Reranking (BGE-reranker-v2-m3)
    reranker = get_reranker()
    pairs = [(query, r["page_content"]) for r in mmr_results]
    scores = reranker.compute_score(pairs)

    # 점수가 단일 값이면 리스트로 변환
    if not isinstance(scores, list):
        scores = [scores]

    # 점수 할당 및 정렬
    for i, r in enumerate(mmr_results):
        r["rerank_score"] = float(scores[i]) if i < len(scores) else 0.0

    reranked = sorted(mmr_results, key=lambda x: x["rerank_score"], reverse=True)[
        :rerank_top_k
    ]

    # embedding 제거 (응답 크기 축소)
    for r in reranked:
        r.pop("embedding", None)

    # 캡션 자동 보강 (Storyboard 모드일 때만 실행)
    if intent == "storyboard":
        for doc in reranked:
            meta = doc.get("metadata", {})
            if meta.get("is_peak"):
                try:
                    captions_result = get_video_captions_for_range(
                        video_id=doc["video_id"],
                        recollect_id=doc["recollect_id"],
                        start_sec=int(meta.get("start_time", 0)),
                        end_sec=int(meta.get("end_time", 0)),
                    )
                    if captions_result and captions_result.get("captions"):
                        doc["metadata"]["caption"] = captions_result["captions"]
                except Exception:
                    pass

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
    logger.info(
        "search_restaurants_by_category: category=%s, limit=%s", category, limit
    )
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
    logger.info(
        "get_video_metadata_filtered: min_view_count=%s, limit=%s, order_by=%s",
        min_view_count,
        limit,
        order_by,
    )
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
    logger.info(
        "get_categories_by_restaurant: restaurant_name=%s, video_id=%s",
        restaurant_name,
        video_id,
    )
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
    logger.info("search_restaurants_by_name: keyword=%s, limit=%s", keyword, limit)
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
    logger.info("get_all_approved_restaurant_names")
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
    logger.info(
        "search_video_ids_by_query: query=%s, match_count=%s", query, match_count
    )
    model = get_bge_model()
    encoded = model.encode([query], return_dense=True, return_sparse=True)
    query_dense = encoded["dense_vecs"][0].tolist()
    query_sparse = {str(k): float(v) for k, v in encoded["lexical_weights"][0].items()}

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
from langchain_teddynote.tools.tavily import TavilySearch

# Tavily 웹 검색 도구 초기화
web_search = TavilySearch(max_results=5)


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
    # 외부 도구
    web_search,
]
