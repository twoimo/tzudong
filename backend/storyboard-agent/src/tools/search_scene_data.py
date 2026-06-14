"""장면 데이터 하이브리드 검색 (Dense + Sparse + MMR + Reranking + Caption)"""

import json
import os
import sys

_dir = os.path.dirname(os.path.abspath(__file__))
_src_dir = os.path.dirname(_dir)
for _p in (_dir, _src_dir):
    if _p not in sys.path:
        sys.path.insert(0, _p)

from _shared import get_supabase, get_bge_model, get_reranker, apply_mmr, log_tool_call
from get_video_captions_for_range import get_video_captions_for_range
from langchain_core.tools import tool


def _public_caption_provenance(captions: list[dict]) -> dict:
    """Return sanitized provider/provenance summary for caption rows."""
    if not captions:
        return {"captionLookupStatus": "unavailable", "captionFallbackReason": "empty_caption_result"}
    first = captions[0] if isinstance(captions[0], dict) else {}
    provenance = first.get("caption_provenance") or {}
    if not isinstance(provenance, dict):
        provenance = {}
    public_provenance = {
        "captionLookupStatus": "used",
        "captionProvider": first.get("caption_provider") or "llava_next_video",
        "captionModel": first.get("caption_model") or "llava-hf/LLaVA-NeXT-Video-7B-hf",
        "captionAuthMode": first.get("caption_auth_mode") or "unknown_legacy",
        "captionSchemaVersion": first.get("caption_schema_version") or 1,
        "frameCount": provenance.get("frameCount"),
        "truncatedFrames": provenance.get("truncatedFrames"),
        "requestHash": provenance.get("requestHash"),
        "parserStatus": provenance.get("parserStatus"),
        "latencyMs": provenance.get("latencyMs"),
        "responseId": provenance.get("responseId"),
    }
    return {k: v for k, v in public_provenance.items() if v is not None}


@tool
def search_scene_data(
    query: str,
    video_ids: list[str] = None,
    dense_weight: float = 0.7,
    match_count: int = 20,
    mmr_k: int = 10,
    mmr_diversity: float = 0.3,
    rerank_top_k: int = 5,
) -> dict:
    """
    먹방 유튜브 장면 데이터를 의미 기반으로 검색합니다.
    자막 텍스트를 검색하고, is_peak 구간의 캡션(시각적 묘사)을 자동 조회합니다.

    **사용 상황:**
    1. 특정 음식/식당을 먹는 영상을 찾을 때 (예: "떡볶이 먹는 장면")
    2. 특정 주제의 영상을 찾을 때 (예: "먹방 리액션", "ASMR 소리")
    3. 스토리보드 제작을 위해 참고 영상을 찾을 때

    **쿼리 작성 팁:**
    - 다양한 표현으로 여러 번 검색하세요 (예: "떡볶이", "매운 떡볶이")
    - 짧고 구체적인 키워드가 효과적입니다

    **반환 데이터:**
    - video_id: 영상 식별자
    - page_content: 자막 텍스트
    - metadata: 시작/종료 시간, is_peak 여부
    - metadata.caption: is_peak 구간의 시각적 묘사 (자동 조회)

    Args:
        query: 검색 쿼리 (예: "떡볶이 먹방", "삼겹살 굽는 소리")
        video_ids: 특정 video_id만 검색 (선택)

    Returns:
        transcripts: 검색된 장면 데이터 목록
    """
    log_tool_call("search_scene_data", query=query, video_ids=video_ids)

    model = get_bge_model()
    encoded = model.encode([query], return_dense=True, return_sparse=True)
    query_dense = encoded["dense_vecs"][0].tolist()
    query_sparse = {str(k): float(v) for k, v in encoded["lexical_weights"][0].items()}

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

    if video_ids:
        result.data = [r for r in result.data if r.get("video_id") in video_ids]

    mmr_results = apply_mmr(result.data, query_dense, k=mmr_k, diversity=mmr_diversity)
    if not mmr_results:
        return {"transcripts": [], "message": "MMR 후 결과 없음"}

    reranker = get_reranker()
    pairs = [(query, r["page_content"]) for r in mmr_results]
    scores = reranker.compute_score(pairs)
    if not isinstance(scores, list):
        scores = [scores]

    for i, r in enumerate(mmr_results):
        r["rerank_score"] = float(scores[i]) if i < len(scores) else 0.0

    reranked = sorted(mmr_results, key=lambda x: x["rerank_score"], reverse=True)[
        :rerank_top_k
    ]
    for r in reranked:
        r.pop("embedding", None)

    # is_peak 구간 캡션 자동 조회
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
                    doc["metadata"]["captionProvenance"] = _public_caption_provenance(
                        captions_result["captions"]
                    )
                    doc["metadata"]["captionLookupStatus"] = "used"
                else:
                    doc["metadata"]["captionLookupStatus"] = "unavailable"
                    doc["metadata"]["captionFallbackReason"] = "empty_caption_result"
            except Exception as exc:
                doc["metadata"]["captionLookupStatus"] = "unavailable"
                doc["metadata"]["captionFallbackReason"] = type(exc).__name__

    return {"transcripts": reranked}


if __name__ == "__main__":
    if len(sys.argv) == 1:
        with open(__file__, encoding="utf-8") as f:
            print(f.read())
    else:
        args = json.loads(sys.argv[1])
        result = search_scene_data.invoke(args)
        print(json.dumps(result, ensure_ascii=False, indent=2))
