"""쿼리 기반 video_id 검색"""

import json
import os
import sys

_dir = os.path.dirname(os.path.abspath(__file__))
_src_dir = os.path.dirname(_dir)
for _p in (_dir, _src_dir):
    if _p not in sys.path:
        sys.path.insert(0, _p)

from _shared import get_supabase, get_bge_model, log_tool_call
from langchain_core.tools import tool


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
    충분한 video_id가 모이면 search_transcripts_hybrid를 호출하여 상세 자막+캡션을 조회하세요.

    Args:
        query: 검색 쿼리 (예: "떡볶이 먹방", "삼겹살 ASMR")
        match_count: 반환할 video_id 수 (기본값: 10)

    Returns:
        video_ids: 관련 video_id 목록 (중복 제거됨)
    """
    log_tool_call("search_video_ids_by_query", query=query, match_count=match_count)

    model = get_bge_model()
    encoded = model.encode([query], return_dense=True, return_sparse=True)
    query_dense = encoded["dense_vecs"][0].tolist()
    query_sparse = {str(k): float(v) for k, v in encoded["lexical_weights"][0].items()}

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


if __name__ == "__main__":
    if len(sys.argv) == 1:
        with open(__file__, encoding="utf-8") as f:
            print(f.read())
    else:
        args = json.loads(sys.argv[1])
        result = search_video_ids_by_query.invoke(args)
        print(json.dumps(result, ensure_ascii=False, indent=2))
