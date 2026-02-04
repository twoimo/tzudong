from supabase import create_client, Client
from langchain_core.runnables import chain


# 전역 클라이언트 (연결 재사용)
_supabase_client = None


def get_supabase() -> Client:
    global _supabase_client
    if _supabase_client is None:
        _supabase_client = create_client(SUPABASE_URL, SUPABASE_KEY)
    return _supabase_client


# 2. get_video_captions_for_range (시간 범위 캡션)
@chain
def get_video_caption(
    video_id: str, recollect_id: str, start_sec: int, end_sec: int
) -> dict:
    """Get video caption from the database."""
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
    return {"video_captions": result.data}


@tool
def get_video_meta(min_view_count: int, limit: int, order_by: str) -> dict:
    """Get video metadata from the database by minimum view count, limit, and order."""
    client = get_supabase()
    result = client.rpc(
        "get_video_metadata_filtered",
        {"min_view_count": min_view_count, "limit": limit, "order_by": order_by},
    ).execute()
    return {"video_meta": result.data}


@tool
def get_categories_by_restaurant_name_or_youtube_url(
    restaurant_name: str, youtube_url: str
) -> dict:
    """Get categories of a restaurant from the database by restaurant name or youtube url."""
    client = get_supabase()
    result = client.rpc(
        "get_categories_by_restaurant_name_or_youtube_url",
        {"p_restaurant_name": restaurant_name, "p_youtube_url": youtube_url},
    ).execute()
    return {"categories": result.data}


# 1. match_documents_bge (벡터 검색)
result = client.rpc(
    "match_documents_bge",
    {
        "query_embedding": embedding_vector,  # list[float], 1024차원
        "match_threshold": 0.7,
        "match_count": 10,
        "filter": {},  # optional jsonb
    },
).execute()


# 3. search_restaurants_by_category
result = client.rpc(
    "search_restaurants_by_category", {"p_category": "냉면", "p_limit": 10}
).execute()

# 4. get_video_metadata_filtered
result = client.rpc(
    "get_video_metadata_filtered",
    {"min_view_count": 100000, "p_limit": 5, "p_order_by": "view_count"},
).execute()

# 5. search_restaurants_by_name
result = client.rpc(
    "search_restaurants_by_name", {"keyword": "엽기떡볶이", "p_limit": 5}
).execute()

# 결과 접근
data = result.data  # list[dict]
