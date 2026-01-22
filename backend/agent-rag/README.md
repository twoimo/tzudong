# 📊 Analytics Agent for YouTube Content Analysis

> **Self-Generated Query Analytics Agent** - 쯔양 유튜브 콘텐츠 분석을 위한 Agentic RAG 시스템

## 🎯 목표

사용자의 자연어 질문을 받아 **LLM이 스스로 분석 방향을 결정하고 쿼리를 생성**하여 복합적인 콘텐츠 분석을 수행하는 에이전트.

### 예시 쿼리
```
"떡볶이 먹은 영상들 중에서 조회수 낮은 것들이 왜 그런건지 분석해줘"
```

---

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                     USER QUERY                                   │
│  "떡볶이 먹은 영상들 중에서 조회수 낮은 것들이 왜 그런건지 분석해줘"   │
└───────────────────────────────────────────────────────────────────┘
                                        │
                                        ▼
┌───────────────────────────────────────────────────────────────────┐
│  STAGE 1: MetaFilter                                              │
│  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ │
│  1. NL → SQL: "떡볶이" 관련 영상 필터링                             │
│     - video_meta 테이블에서 title ILIKE '%떡볶이%'                 │
│     - recollect_vars에서 최신 recollect_id 추출                    │
│  2. 조회수 기준 정렬 → 하위 N개 video_id 추출                       │
│                                                                   │
│  Output: [video_meta: {video_id, title, view_count, ...}]         │
└───────────────────────────────────────────────────────────────────┘
                                        │
                                        ▼
┌───────────────────────────────────────────────────────────────────┐
│  STAGE 2: AnalysisPlanner (Self-Query Generation) ⭐ 핵심         │
│  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ │
│  LLM이 분석 방향을 스스로 결정 & 검색 쿼리 생성                      │
│                                                                   │
│  Input: video_ids + user_query + available_tools                  │
│                                                                   │
│  Generated Queries Example:                                       │
│  ┌─────────────────────────────────────────────────────────────┐ │
│  │ Query 1: 비 피크 구간 자막 검색 (is_peak=false)              │ │
│  │ Query 2: 피크 구간 캡션 검색 (is_peak=true)                  │ │
│  │ Query 3: 도입부 (0-60초) 자막 검색                          │ │
│  └─────────────────────────────────────────────────────────────┘ │
│                                                                   │
│  Output: AnalysisPlan {hypothesis, queries[], expected_insight}   │
└───────────────────────────────────────────────────────────────────┘
                                        │
                                        ▼
┌───────────────────────────────────────────────────────────────────┐
│  STAGE 3: ParallelRetrieval                                       │
│  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ │
│  생성된 쿼리를 병렬 실행 (asyncio.gather)                           │
│                                                                   │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐            │
│  │TranscriptVec │  │ CaptionVec   │  │  MetaSQL     │            │
│  │   Search     │  │   Search     │  │   Retrieval  │            │
│  │(is_peak=F)   │  │(is_peak=T)   │  │(engagement)  │            │
│  └──────────────┘  └──────────────┘  └──────────────┘            │
│         │                 │                 │                     │
│         └────────────┬────┴─────────────────┘                     │
│                      ▼                                            │
│            Retrieved Contexts                                     │
└───────────────────────────────────────────────────────────────────┘
                                        │
                                        ▼
┌───────────────────────────────────────────────────────────────────┐
│  STAGE 4: AnalysisGenerator                                       │
│  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ │
│  Retrieved contexts + AnalysisPlan → Structured Analysis          │
│                                                                   │
│  Output:                                                          │
│  ┌─────────────────────────────────────────────────────────────┐ │
│  │ 1. 가설 검증: 비 피크 구간이 너무 길다 (60% 구간)              │ │
│  │ 2. 비교 분석: 고조회수 vs 저조회수 피크 장면 차이               │ │
│  │ 3. 개선 제안: 도입부 15초 개선 포인트                          │ │
│  └─────────────────────────────────────────────────────────────┘ │
└───────────────────────────────────────────────────────────────────┘
```

---

## 📁 파일 구조

```
backend/agent-rag/
├── app/
│   ├── agents/
│   │   └── analytics_agent.py      # 메인 분석 에이전트 (LangGraph)
│   ├── nodes/
│   │   ├── meta_filter.py          # Stage 1: 메타데이터 필터링
│   │   ├── analysis_planner.py     # Stage 2: 분석 쿼리 자동 생성 ⭐
│   │   ├── parallel_retriever.py   # Stage 3: 병렬 검색 실행
│   │   └── analysis_generator.py   # Stage 4: 최종 분석 생성
│   ├── tools/
│   │   ├── transcript_search.py    # 자막 벡터 검색 (is_peak 필터)
│   │   ├── caption_search.py       # 이미지 캡션 검색
│   │   ├── meta_sql.py             # 메타데이터 SQL 쿼리
│   │   └── heatmap_analyzer.py     # Retention 패턴 분석
│   └── state.py                    # AnalyticsAgentState
├── data/
│   └── tzuyang/
│       └── documents-with-restaurants/  # 자막 문서 (video_id.jsonl)
├── scripts/
│   ├── 01-add-restaurants-to-documents.py
│   ├── 02-add-peak-metadata.py
│   ├── 03-embed-and-store-pgvector.py
│   └── 05-ingest-video-meta.py
└── README.md
```

---

## 📊 데이터 스키마

### PostgreSQL Tables

#### `video_meta`
| Column | Type | Description |
|--------|------|-------------|
| video_id | TEXT PK | YouTube video ID |
| title | TEXT | 영상 제목 |
| view_count | INTEGER | 조회수 |
| like_count | INTEGER | 좋아요 수 |
| comment_count | INTEGER | 댓글 수 |
| recollect_vars | JSONB | 수집 상태 (viral_growth 등) |
| collected_at | TIMESTAMPTZ | 수집 시간 |

#### `document_embeddings`
| Column | Type | Description |
|--------|------|-------------|
| video_id | TEXT | YouTube video ID |
| chunk_index | INTEGER | 청크 순서 |
| page_content | TEXT | 자막 + 문맥 |
| embedding | vector(1536) | OpenAI 임베딩 |
| metadata | JSONB | is_peak, peak_score, restaurants, start_time, end_time 등 |

### Heatmap Data (JSONL)
```json
{
  "video_id": "abc123",
  "interaction_data": [
    {"startMillis": "0", "intensityScoreNormalized": 0.42, "formatted_time": "00:00"},
    ...
  ],
  "most_replayed_markers": [
    {"startMillis": 167550, "peakMillis": 178720, "label": "가장 많이 다시 본 장면"}
  ]
}
```

---

## 🔧 핵심 컴포넌트

### 1. AnalyticsAgentState

```python
class AnalyticsAgentState(TypedDict):
    # User input
    user_query: str
    
    # Stage 1 output
    target_videos: List[Dict[str, Any]]  # 필터링된 video_meta
    
    # Stage 2 output  
    analysis_plan: Dict[str, Any]  # {hypothesis, direction, generated_queries}
    
    # Stage 3 output
    retrieved_contexts: Dict[str, List[Dict]]  # {query_id: [contexts]}
    
    # Stage 4 output
    analysis_result: str
    
    # Trace
    steps: List[str]
```

### 2. AnalysisPlanner Prompt (핵심)

```python
ANALYSIS_PLANNER_PROMPT = """
You are an Analytics Planner for YouTube video performance analysis.

Given:
- User query: {user_query}
- Target videos (low performing): {target_videos}
- Available search tools:
  * transcript_search(query, video_ids, is_peak=True/False/None)
  * caption_search(query, video_ids, is_peak=True/False/None)
  * meta_sql(sql_query)
  * heatmap_analyzer(video_ids)

Your task:
1. Form a HYPOTHESIS about why these videos have low view counts
2. Generate 2-4 SEARCH QUERIES to validate your hypothesis

Focus on:
- 도입부 훅(Hook)의 강도
- 피크 구간 vs 비피크 구간의 차이
- 스토리/맥락의 유무
- 시청자 retention 패턴

Output JSON:
{
  "hypothesis": "저조회수 영상들은 도입부 훅이 약하고 스토리가 부족할 것이다",
  "analysis_direction": "도입부 30초와 피크 구간 비교 분석",
  "queries": [
    {
      "id": "q1",
      "purpose": "비 피크 구간 자막 패턴",
      "tool": "transcript_search",
      "params": {"query": "시청자 이탈 징후", "is_peak": false}
    },
    ...
  ]
}
"""
```

---

## 📈 실제 분석 결과 예시

### 데이터 기반 인사이트

| 구분 | 영상 | 조회수 | 처음 30초 retention | 피크 비율 |
|------|------|--------|---------------------|----------|
| **저조회수** | 김밥천국 떡볶이 | 68만 | **0.16** ❌ | 7.0% |
| **고조회수** | 얄개분식 떡볶이 | 490만 | **0.42** ✅ | 18.0% |

### LLM 분석 요약

1. **도입부 훅의 차이**
   - 저조회수: "안녕하세요 여러분..." (일반적인 인사)
   - 고조회수: "응답하라 1988에 등장한 그 떡볶이집!" (스토리 + 궁금증)

2. **콘텐츠 차별화**
   - 저조회수: 프랜차이즈 체인점 (김밥천국)
   - 고조회수: 50년 전통 지역 맛집 + 스토리

3. **개선 제안**
   - 도입부 15초를 충격적 비주얼/도전 포인트로 시작
   - 썸네일 키워드: "세계기록", "XX년 전통", "놀란 현지인"

---

## 🚀 TODO

- [ ] `is_peak`, `peak_score` 메타데이터를 document_embeddings에 적재
- [ ] AnalysisPlanner 노드 구현
- [ ] ParallelRetriever 노드 구현 (asyncio.gather)
- [ ] AnalysisGenerator 프롬프트 설계
- [ ] LangGraph 워크플로우 완성
- [ ] 이미지 캡션 데이터 수집 및 적재 (frame-caption)
- [ ] 웹 UI 연동

---

## 📚 References

- [LangGraph Documentation](https://python.langchain.com/docs/langgraph)
- [Agentic RAG Patterns](https://www.anthropic.com/research/building-effective-agents)
- [YouTube Data API](https://developers.google.com/youtube/v3)
