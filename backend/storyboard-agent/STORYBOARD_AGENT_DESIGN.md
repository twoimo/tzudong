# Storyboard Agent Design (LangGraph Architecture)

이 문서는 LangGraph 기반의 **먹방 스토리보드 제작 에이전트** 아키텍처 및 상세 설계를 기술합니다.
사용자의 모호한 요구 사항을 처리하고, 내부 데이터(DB)와 외부 데이터(Web)를 유연하게 활용하여 최적의 스토리보드를 생성하는 것을 목표로 합니다.

---

## 1. 시스템 개요 (System Overview)

- **목적**: 사용자 입력(키워드, 상황, 분위기 등)을 분석하여 영상 기획에 필요한 구체적인 스토리보드(씬 구성, 자막, 촬영 구도 등)를 제안합니다.
- **핵심 기술**: LangGraph (순환형 에이전트 구조), Vector Search (의미 검색), RAG (검색 증강 생성).
- **데이터 소스**:
    - **Internal DB**: `restaurants` (음식점명, 카테고리 정보), `videos` (조회수, 메타데이터), `transcript_embeddings_bge` (자막 벡터), `video_frame_captions` (피크 구간 캡션).
    - **External**: Web Search (Tavily).

---

## 2. 아키텍처 흐름 (Architecture Flow)

**중앙 제어형 오케스트레이터(Orchestrator)** 모델을 채택합니다. Orchestrator가 중심에서 상황(State)을 판단하여 도구(Tools)를 동적으로 호출하는 **Loop 구조**입니다.

### 전체 그래프 흐름 (Diagram)

```text
[Start] --> [Intent Router]
                 |
      +----------+---------------------------+
      | (simple_chat)                        | (qna / storyboard)
      v                                      v
[Simple Response]                    [Orchestrator] <----------------------------------------+
      |                               /      ^                                               |
      v                              /       | (Returns: Transcript + Caption / Meta)        |
    [End]                      (Need Data)   |                                               |
                                   /         |                                               |
                                  v          |                                               |
               +---------- [Tools Node] -----+--------------------------------------------+  |
               |                                                                          |  |
               |  +-- [Transcript Search] (Logic Included) ----------------------------+  |  |
               |  | * search_transcripts_hybrid                                        |  |  |
               |  |      | (intent='storyboard'?)                                      |  |  |
               |  |      +--(Yes)--> [+get_video_captions_for_range] (Auto)            |  |  |
               |  |      +--(No)---> (Transcript Only)                                 |  |  |
               |  +--------------------------------------------------------------------+  |  |
               |                                                                          |  |
               |  +-- [Video/Meta] ------------------------+  +-- [Restaurant/Category] --+  |
               |  | * get_video_metadata_filtered          |  | * search_restaurants_by_  |  |
               |  | * search_video_ids_by_query            |  |   category                |  |
               |  +----------------------------------------+  | * search_restaurants_by_  |  |
               |                                              |   name                    |  |
               |  +-- [Web Search] ------------------------+  | * get_categories_by_      |  |
               |  | * web_search (Trend/Supp)              |  |   restaurant              |  |
               |  +----------------------------------------+  | * get_all_approved_       |  |
               |                                              |   restaurant_names        |  |
               |                                              +---------------------------+  |
               +------------------+-------------------------------------------------------+  |
                                  |                                                          |
                                  | (Finish / Check)                                         |
                                  v                                                          |
                           [Data Validator] ---------------------(Fail: Retry)---------------+
                            /            \                                                   |
                   (Pass)  /              \ (Fail: Need Human)                               |
                          /                \                                                 |
                         /                  v                                                |
           +------------+             [Human Request] ---(New Query/Feedback)----------------+
           |            |                   |
      (storyboard)    (qna)            (Proceed)
           |            |                   |
           v            v                   v
      [Generator]  [QnA Responder]    (Intent Check)
           ^            ^                   |
           +------------+-------------------+
                        |
                 (Route by Intent)
           +------------+------------+
           |                         |
           v                         v
         [End]                     [End]
```

### 핵심 설계 원칙

1. **Orchestrator 중심 루프**: 데이터가 충분할 때까지 도구 호출을 반복합니다.
2. **자동 캡션 보강**: `search_transcripts_hybrid(intent='storyboard')` 호출 시 Peak 구간 캡션을 자동으로 가져옵니다.
3. **이전 쿼리 추적**: 동일한 검색어 재사용 방지를 위해 `previous_queries`를 관리합니다.
4. **Human-in-the-Loop**: 3회 재시도 후에도 데이터가 부족하면 사용자에게 질문합니다.

---

## 3. 상세 시나리오 (Detailed Scenarios)

### 시나리오 1: "조회수 높은 떡볶이 먹방 참고해서 짜줘"
사용자가 구체적인 메뉴와 '인기 영상'이라는 조건을 제시한 경우입니다.

1. **Intent Router**: 'storyboard'로 분류 → **Orchestrator** 진입.
2. **Orchestrator (Turn 1)**: 
   - 판단: "조회수 높은 영상이 어떤 것인지 먼저 파악해야 함."
   - 도구 호출: **`get_video_metadata_filtered(order_by='view_count', limit=5)`**
3. **Tools**: 상위 5개 영상 정보(ID, Title, View Count) 반환.
4. **Orchestrator (Turn 2)**: 
   - 판단: "영상 ID를 확보했으니, 이제 해당 영상들의 '떡볶이' 관련 내용을 찾아보자."
   - 도구 호출: **`search_transcripts_hybrid(query="떡볶이 먹방", intent="storyboard")`** (확보한 Video ID 범위 내 검색 추천될 수도 있음)
5. **Tools**: 자막 리스트 반환. (이때 `is_peak=True`인 중요 구간은 자동으로 `get_video_captions_for_range`가 실행되어 시각적 묘사(Caption)가 포함됨)
6. **Orchestrator (Turn 3)**:
   - 판단: "자막과 시각 묘사 데이터가 충분히 모였다." → 검증 요청.
7. **Validator**: 
   - "캡션 있는 자막 3개 이상 확보됨" → **Pass**.
8. **Generator**: 수집된 데이터를 바탕으로 씬별 영상 묘사, 연출, 대사를 포함한 스토리보드 생성.

### 시나리오 2: "요즘 유행하는 마라탕 챌린지 좀 찾아줘"
내부 DB에 최신 유행 정보가 없을 가능성이 높은 경우입니다.

1. **Orchestrator (Turn 1)**: 
   - 판단: "최신 '유행'이나 '챌린지'는 내부 DB보다 웹 검색이 정확할 것이다."
   - 도구 호출: **`web_search("latest mukbang maratang challenge trend")`**
2. **Tools**: Tavily 검색 결과(최신 뉴스, 영상 트렌드 요약) 반환.
3. **Orchestrator (Turn 2)**: 
   - 판단: "웹 정보는 얻었지만, 구체적인 먹방 씬 구성 예시를 위해 내부 DB도 찾아보자."
   - 도구 호출: **`search_transcripts_hybrid("마라탕 챌린지")`**
4. **Tools**: 내부 DB 검색 결과 (있으면 반환, 없으면 빈 리스트).
5. **Validator**: 
   - "내부 자막은 부족하지만, 웹 정보가 풍부하므로 진행 가능" → **Pass**.
6. **Generator**: 웹 트렌드 정보를 기반으로 컨셉을 잡고, 내부 씬 데이터가 부족하면 일반적인 연출 가이드를 제안.

### 시나리오 3: "엽기떡볶이 영상 찾아줘" (상호명 검색)
1. **Orchestrator**:
   - 판단: "특정 브랜드(엽기떡볶이)를 언급했으니 상호명 검색이 필요하다."
   - 도구 호출: **`search_restaurants_by_name("엽기떡볶이")`**
2. **Tools**: 엽기떡볶이 관련 메타데이터 및 해당 가게가 등장한 Video ID 반환.
3. **Orchestrator**:
   - 판단: "해당 Video ID들에서 자막을 뽑아보자."
   - 도구 호출: **`search_transcripts_hybrid`** (특정 Video ID 필터링 적용 가능 시 적용)

---

## 4. 노드별 상세 기능 (Node Details)

### A. Intent Router (가벼운 분류기)

- **역할**: 사용자 입력을 3가지 의도로 분류합니다.
- **모델**: `gpt-4o-mini` (경량 모델)

| Intent | 설명 | 예시 |
|--------|------|------|
| `simple_chat` | 인사, 잡담 | "안녕", "고마워" |
| `qna_about_data` | 데이터/정보 질문 | "영상 몇 개야?", "쯔양 뭐 먹었어?" |
| `storyboard` | 영상 기획 요청 | "떡볶이 먹방 짜줘", "기획안 만들어줘" |

---

### B. Orchestrator Agent (중앙 지휘관)

- **역할**: 현재 State를 보고 **"다음에 무엇을 할지"** 결정합니다.
- **특징**: 
  - 반복(Loop)하며 필요한 데이터를 단계적으로 수집합니다.
  - 검증 실패 시 피드백(`validation_feedback`)을 참고하여 재검색합니다.
  - 이전에 사용한 쿼리(`previous_queries`)를 기억하여 중복 검색을 방지합니다.

---

### C. Tools Node (도구 모음)

#### 도구 목록

| # | 도구명 | 용도 | 언제 사용? |
|---|--------|------|-----------|
| 1 | `search_transcripts_hybrid` | 하이브리드 자막 검색 (Dense + Sparse + MMR + Reranking) | 키워드/문장으로 관련 영상 자막 검색 (캡션 자동 포함) |
| 2 | `search_video_ids_by_query` | 쿼리 기반 영상 ID 검색 | 특정 키워드 관련 영상 ID 목록 조회 |
| 3 | `get_video_metadata_filtered` | 조회수/게시일 기반 비디오 필터링 | "인기 영상", "최신 영상" 요청 시 |
| 4 | `search_restaurants_by_category` | 카테고리별 음식점 검색 | "냉면집 추천" → 냉면 카테고리 음식점 조회 |
| 5 | `get_categories_by_restaurant` | 음식점→카테고리 역조회 | 카테고리 확장 검색 시 |
| 6 | `search_restaurants_by_name` | 음식점명 검색 | 사용자가 특정 식당 언급 시 |
| 7 | `get_all_approved_restaurant_names` | 전체 승인 음식점명 목록 | LLM이 사용자 입력에서 음식점명 추출 시 참조 |
| 8 | `web_search` | Tavily 웹 검색 | 최신 트렌드, 내부 DB에 없는 정보 |

#### 핵심 도구: `search_transcripts_hybrid`

- **검색 파이프라인**:
  1. **Dense + Sparse 하이브리드**: Dense(0.6) + Sparse(0.4) 가중 결합
  2. **MMR (Maximal Marginal Relevance)**: 다양성 확보 (중복 결과 제거)
  3. **BGE-reranker-v2-m3**: 최종 재순위화

- **자동 캡션 보강**: 
  - `intent='storyboard'`로 호출 시, `is_peak=True`인 구간에 대해 내부적으로 `get_video_captions_for_range`를 호출
  - 캡션을 `metadata['caption']`에 포함하여 반환

---

### D. Data Validator (검증기)

Storyboard 모드에서 데이터 충분성을 판단합니다.

**충분성 기준:**

| 조건 | 판정 | 다음 행동 |
|------|------|----------|
| 캡션 있는 자막 ≥ 3개 | **pass** | Generator |
| 캡션 있는 자막 + 웹검색 ≥ 3개 | **pass** | Generator |
| 캡션 있는 자막 < 3개 + retry < 3 | **fail** | Orchestrator (재검색) |
| 재검색 3회 후에도 부족 | **need_human** | Human Request |

---

### E. Human Request (사용자 질문)

재검색 후에도 데이터가 부족할 때 실행됩니다. LangGraph의 `interrupt` 기능을 사용합니다.

**출력 예시:**
```
⚠️ 부족한 점:
재검색 후에도 시각 자료가 부족합니다.

어떻게 할까요?
1. 다시 검색 (검색어를 입력하세요)
2. 현재 정보로 진행
```

**재개 방법:** `Command(resume=...)` 사용.

---

### F. Storyboard Generator (생성기)

- **입력**: 캡션 있는 자막 + 웹검색 결과 (캡션 없는 자막 제외)
- **역할**: 시나리오 기반의 최종 기획안 생성

**출력 형식:**
```markdown
# 제목: [전체 스토리보드 제목]
# 컨셉: [스토리보드 컨셉]

## 📍 씬 1: [씬 제목]
- 영상: [어떤 대상이 어떻게 보이는지 자세히 서술]
- 오디오: [대사/효과음/자막]
- 연출: [촬영 기법]
...
```

---

## 5. State Schema

LangGraph에서 관리할 에이전트의 상태(`AgentState`) 정의입니다.

```python
class AgentState(TypedDict):
    messages: Annotated[List[BaseMessage], add_messages]
    intent: Literal["simple_chat", "qna_about_data", "storyboard"]
    loop_count: int
    retry_count: int
    
    # 데이터 (분리 관리)
    transcript_docs: List[Document] # 자막+캡션
    web_search_docs: Annotated[List[Document], operator.add] # 웹/메타데이터
    
    # 검증 및 피드백
    validation_status: Literal["pass", "fail", "need_human", "pending"]
    validation_feedback: Optional[str]
    previous_queries: Annotated[list[str], operator.add]
    
    active_query: Optional[str]
    human_feedback: Optional[str]
    
    final_output: Optional[str]
```

---

## 6. 그래프 빌드 코드

```python
from langgraph.graph import StateGraph, END
from langgraph.prebuilt import ToolNode
from langgraph.checkpoint.memory import MemorySaver

# 노드 등록
builder = StateGraph(AgentState)

builder.add_node("intent_router", intent_router)
builder.add_node("orchestrator", orchestrator)
builder.add_node("tools", ToolNode(TOOLS))
builder.add_node("validator", validator)
builder.add_node("human_request", human_request)
builder.add_node("generator", generate_storyboard)
builder.add_node("qna_responder", qna_responder)
builder.add_node("simple_response", simple_response)

# 엣지 설정
builder.set_entry_point("intent_router")

builder.add_conditional_edges("intent_router", route_after_intent, {"simple_response": "simple_response", "orchestrator": "orchestrator"})
builder.add_edge("simple_response", END)

builder.add_conditional_edges("orchestrator", route_after_orchestrator, {"tools": "tools", "validator": "validator"})
builder.add_edge("tools", "orchestrator")

builder.add_conditional_edges(
    "validator", route_after_validator,
    {"generator": "generator", "qna_responder": "qna_responder", "human_request": "human_request", "orchestrator": "orchestrator"}
)

builder.add_conditional_edges(
    "human_request", route_after_human,
    {"generator": "generator", "qna_responder": "qna_responder", "orchestrator": "orchestrator"}
)

builder.add_edge("generator", END)
builder.add_edge("qna_responder", END)

# 컴파일
memory = MemorySaver()
graph = builder.compile(checkpointer=memory)
```
