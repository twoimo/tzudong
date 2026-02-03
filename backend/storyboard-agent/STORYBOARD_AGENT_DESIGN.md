# Storyboard Agent Design (LangGraph Architecture)

이 문서는 LangGraph 기반의 "먹방 스토리보드 제작 에이전트" 아키텍처 및 상세 설계를 기술합니다.
사용자의 모호한 요구 사항을 처리하고, 내부 데이터(DB)와 외부 데이터(Web)를 유연하게 활용하여 최적의 스토리보드를 생성하는 것을 목표로 합니다.

## 1. 시스템 개요 (System Overview)

- **목적**: 사용자 입력(키워드, 상황, 분위기 등)을 분석하여 영상 기획에 필요한 구체적인 스토리보드(씬 구성, 자막, 촬영 구도 등)를 제안합니다.
- **핵심 기술**: LangGraph (순환형 에이전트 구조), Vector Search (의미 검색), RAG (검색 증강 생성).
- **데이터 소스**:
    - **Internal DB**: `restaurants` (카테고리 정보), `video` (조회수, 메타데이터), `document_embeddings_transcript`, `video_caption`.
    - **External**: Web Search.

---

## 2. 아키텍처 흐름 (Architecture Flow)

복잡한 의존성(예: "조회수 확인 후 -> 해당 영상의 자막 검색 -> 부족하면 웹 검색")을 처리하기 위해 **중앙 제어형 오케스트레이터(Orchestrator)** 모델을 채택합니다.

### 핵심 변경 사항
- **기존**: Router가 처음에 경로를 정하면 바꾸기 어려운 선형 구조.
- **변경**: **Orchestrator Agent**가 중심에서 상황(State)을 판단하여 도구(Tools)를 동적으로 꺼내 쓰는 **Loop 구조**.

```text
[Start] --> [Intent Router]
                 |
      +----------+---------------------------+
      | (Simple Chat)                        | (Q&A / Storyboard)
      v                                      v
[Simple Chat]                    +--> [Orchestrator] <---------------------------------------------+
      |                          |       /      ^                                                  |
      v                          |    (Call)  (Result)                                             |
    [End]                        |     /        |                                                  |
                                 |    v         |                                                  |
                                 |  [Tools Node]+                                                  |
                                 |   |                                                             |
                                 |   +-> 1. Get Video Meta                                         |
                                 |   +-> 2. Search Transcripts                                     |
                                 |   |     (+ Video Caption if Peak)                               |
                                 |   +-> 3. Web Search                                             |
                                 |   +-> 4. Category Search                                        |
                                 |                                                                 |
                                 +--(Finish)--> [Mode Check]                                       |
                                                  /      \                                         |
                                            (Q&A)         (Storyboard)                             |
                                              |                |                                   |
                                              v                v                                   |
                                       [Gen Answer]     [Data Validator]                           |
                                              |           /        \                               |
                                              v        (Pass)     (Fail)                           |
                                            [End]        |           \                             |
                                                         v            v                            |
                                                  [Storyboard]   [Query Refiner]                   |
                                                  [ Generator]    /           \                    |
                                                         |  (Still Fail)     (Retry) --------------+
                                                         v       |                                 |
                                                       [End]     v                                 |
                                                           [Human Request]                         |
                                                                 |                                 |
                                                                 +---------------------------------+
```

### F. Query Refiner (자동 재검색)
- **역할**: Validator(검증기)가 "정보 부족" 판정을 내렸을 때, 즉시 포기하지 않고 검색어를 수정합니다.
- **전략**:
    - "매운거" -> "불닭볶음면, 엽기떡볶이" (구체화)
    - "쯔양 뭐 먹었지" -> "쯔양 최신 영상 목록" (도구 변경)
    - **Self-Correction Loop**: 최대 3회까지 스스로 재시도합니다.
- **실패 판단 (Still Fail)**:
    - **조건 1**: `retry_count >= 3` (3번 고쳐도 Validator 통과 못함)
    - **조건 2**: Refiner가 "더 이상 검색할 키워드가 없음"이라고 판단할 때.
    - -> 이 경우 **Human Request**로 넘어갑니다.

### G. Human Request (사용자 질문)
- **역할**: Query Refiner로도 해결되지 않을 때, 또는 사용자 취향 결정이 필요할 때 실행됩니다.
- **행동**: "검색 결과가 없습니다. 혹시 특정 식당을 원하시나요?"라고 되묻고, 사용자의 답변을 받아 다시 Orchestrator로 전달합니다.

### D. Data Validator (검증기)
- **역할**: Orchestrator가 생각하기를 멈췄을 때, 정말로 충분한지 검사하는 '비평가(Critic)' 역할.
- **흐름**:
    - **Pass** -> Generator로 이동.
    - **Fail (Recoverable)** -> Query Refiner로 이동 (검색어 변경).
    - **Fail (Unrecoverable/Ambiguous)** -> Human Request로 이동 (사용자 질문).

### 상세 시나리오 흐름 (Scenario)

#### 시나리오 1: "조회수 높은 떡볶이 먹방 참고해서 짜줘"
1. **Router**: 'Storyboard Plan'으로 분류 -> **Orchestrator** 진입.
2. **Orchestrator (Turn 1)**: "조회수 정보가 먼저 필요하군." -> **`get_video_meta(sort='view')`** 호출.
3. **Tools**: 상위 3개 영상 정보(ID, Title 등) 반환.
4. **Orchestrator (Turn 2)**: "ID를 확보했으니 이제 내용을 보자." -> **`search_transcripts(filter_ids=[...])`** 호출.
5. **Tools**: 자막 및 Peak 구간 캡션 반환.
6. **Orchestrator (Turn 3)**: "정보가 충분하다." -> 종료 신호.
7. **Validator**: Pass.
8. **Generator**: 스토리보드 작성.

#### 시나리오 2: "요즘 유행하는 마라탕 챌린지 좀 찾아줘"
1. **Orchestrator**: "내부 DB에는 최신 유행 정보가 없을 거야." -> **`search_web("latest maratang challenge trend")`** 호출.
2. **Tools**: 웹 검색 결과 반환.
3. **Validator**: Pass.
4. **Generator**: 트렌드 기반 기획안 작성.

---

## 3. 노드별 상세 기능 (Node Details)

### A. Intent Router (가벼운 분류기)
- **역할**: 비싼 Orchestrator를 호출할지, 가벼운 잡담을 할지 결정.
- **도구**: LLM (gpt-4o-mini 등 light model).

### B. Orchestrator Agent (중앙 지휘관)
- **역할**: 현재 State(대화 기록, 수집된 데이터)를 보고 **"다음에 무엇을 할지"** 결정합니다.
- **특징**: 반복(Loop)하며 필요한 데이터를 단계적으로 수집합니다.
- **Logic**:
    - 입력에 '조회수', '인기' 키워드 -> `video_meta` 도구 우선 호출.
    - 입력에 '특정 장면' 묘사 -> `transcript` 도구 호출.
    - 내부 데이터 결과가 없거나 부족 -> `web_search` 도구 호출.
    - 검색 결과가 부족하지만 카테고리 확장이 가능해 보일 때 -> `search_by_category` 도구 호출.

### C. Tools Node (도구 모음)
실제 기능을 수행하는 함수들의 집합입니다.

1.  **`get_video_metadata`**: 조회수 필터링, 영상 기본 정보 조회.
2.  **`search_transcripts`**: 자막 검색 수행. **`is_peak=True`인 경우, 해당 구간의 시각적 묘사(Video Caption)를 자동으로 함께 가져와 반환합니다.**
3.  **`web_search`**: 트렌드 및 부족한 정보 검색.
4.  **`search_restaurants_by_category`**: 음식 카테고리(중식, 한식 등)로 관련 영상 검색.

### D. Data Validator (검증기)
- **역할**: Orchestrator가 생각하기를 멈췄을 때, 정말로 충분한지 검사하는 '비평가(Critic)' 역할.
- **체크리스트**:
    - 필수 시각 정보(Visual Description)가 포함되었는가?
    - 사용자가 요청한 제약조건(조회수 등)이 반영되었는가?
    - 특정 씬(Intro, Climax) 구성에 필요한 데이터가 있는가?
- **Action**: 부족하면 이유(Reason)와 함께 다시 Orchestrator로 돌려보냅니다. -> 이때 `missing_info`를 State에 추가하여 힌트를 줍니다.

### E. Storyboard Generator (생성기)
- **역할**: 최종 포맷(씬/비디오/오디오/연출)에 맞춰 구조화된 출력을 생성합니다.
- **입력**: State에 저장된 모든 Context (Messages + Retrieved Docs).

---

## 4. 데이터 처리 로직 (Data Processing Logic)

### 오케스트레이터의 도구 사용 전략

1. **상호 보완적 검색**:
    - 자막 검색(`search_transcripts`) 결과가 좋으면 거기서 멈춥니다.
    - 결과가 없으면 `web_search`를 부르거나, `search_restaurants_by_category`로 범위를 넓힙니다.

2. **데이터 결합 자동화**:
    - `search_transcripts` 도구 내부에서 `is_peak=True`인 구간에 대해 자동으로 `fetch_video_caption`을 수행하거나,
    - Orchestrator가 별도 호출 없이 데이터를 한 번에 가져오도록 도구를 설계합니다.

### Peak & Caption 매칭
- **목표**: 가장 시각적으로 풍부한 정보를 제공.
- **로직**:
    1. 자막 검색 결과 확인.
    2. `is_peak: true`인 청크 식별.
    3. 해당 청크의 `duration` 및 `video_id`로 가장 최신(Max ID)의 Caption 데이터 병합.

---

## 5. 상태 관리 (State Management)

복잡한 루프와 분기, 그리고 사용자 개입(Interrupt)을 안정적으로 처리하기 위해 상태(State)를 체계적으로 정의합니다.

```python
class AgentState(TypedDict):
    """
    LangGraph 흐름 제어를 위한 통합 상태 정의
    """
    # --- 1. Conversation & Core ---
    # 대화 히스토리 (User, AI, Tool 메시지 누적)
    messages: Annotated[List[BaseMessage], operator.add]
    
    # --- 2. Flow Control (라우팅 및 루프 제어) ---
    # intent: Router가 분석한 사용자 의도 ('simple_chat', 'qna', 'storyboard')
    intent: str
    
    # mode: ModeCheck 노드에서 분기를 결정하는 플래그 ('qna' vs 'storyboard')
    mode: Literal["qna", "storyboard", "unknown"]
    
    # loop_count: Orchestrator 무한 루프 방지용 카운터
    loop_count: int
    
    # retry_count: Validator -> Refiner 재시도 횟수 제한 (Max 3회)
    retry_count: int

    # --- 3. Data Context (데이터 축적) ---
    # 도구 실행으로 얻은 핵심 문서/정보를 메시지와 별도로 구조화하여 관리
    # Generator가 참고할 최종 소스 데이터
    context_docs: Annotated[List[Document], operator.add]
    
    # --- 4. Validation & Refinement (검증 및 개선) ---
    # validation_status: Validator 결과 ('pass', 'fail')
    validation_status: Literal["pass", "fail", "pending"]
    
    # validation_feedback: 왜 실패했는지에 대한 피드백 (Refiner나 Human에게 전달)
    validation_feedback: Optional[str]
    
    # active_query: 현재 Refiner가 개선 중인 검색어
    active_query: Optional[str]

    # --- 5. Human Interaction (사용자 개입) ---
    # human_feedback: HumanRequest 노드에서 사용자가 입력한 추가 정보/지시
    human_feedback: Optional[str]

    # --- 6. Results (최종 결과) ---
    final_output: Optional[Union[str, dict]] 
```
