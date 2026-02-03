from langchain_core.runnables import chain


# 전역 클라이언트 (연결 재사용)
_supabase_client = None

def get_supabase() -> Client:
    global _supabase_client
    if _supabase_client is None:
        _supabase_client = create_client(SUPABASE_URL, SUPABASE_KEY)
    return _supabase_client


@chain
def get_video_caption(video_id: str, recollect_id: str) -> dict:
    """Get video caption from the database."""
    intergrated_video_caption = None




    return {"video_caption": intergrated_video_caption}





def get_video_meta(query: str) -> str:
    """Get video metadata from the database."""
    # video_id와 recollect_id가 모두 있는 경우
    if video_id and recollect_id:
        try:
            client = get_supabase()
            query = client.table(table_name).select("*")

            # 필터 조건이 있으면 적용
            if filter_column and filter_value:
                query = query.eq(filter_column, filter_value)

            # limit 적용 및 실행
            response = query.limit(limit).execute()

            if not response.data:
                return "[]"  # 빈 결과

        # 결과가 너무 길면 잘라서 보여주거나 요약할 수도 있지만, 일단 전체 반환
        json.dumps(response.data, ensure_ascii=False)

    except Exception as e:
        return f"Error querying {table_name}: {str(e)}"

    # 가장 최근 수집의 프레임 캡셔닝에서부터 duration 비교해서 가져오기
    elif video_id:
        pass


    return 




def format_docs(docs):
    return "\n\n".join(
        [
            f'<document><content>{doc.page_content}</content><source>{doc.metadata["source"]}</source><page>{doc.metadata["page"]+1}</page></document>'
            for doc in docs
        ]
    )







@tool
def fetch_supabase_data() -> str:
    """
    Supabase의 특정 테이블에서 데이터를 조회합니다.

    Args:
        table_name (str): 조회할 테이블 이름 (예: 'video_meta', 'restaurants', 'image_captions')
        filter_column (str): 필터링할 컬럼명 (선택사항, 예: 'title', 'id'). 없을 경우 전체 조회.
        filter_value (str): 필터링할 값 (선택사항, filter_column과 함께 사용). 단순 일치(eq) 조건.
        limit (int): 반환할 최대 행 수 (기본값: 5). 너무 많은 데이터를 가져오지 않도록 제한합니다.

    Returns:
        str: 조회된 데이터의 JSON 문자열. 에러 발생 시 에러 메시지 반환.
    """




# RAG 체인 생성
rag_chain = prompt | llm | StrOutputParser()