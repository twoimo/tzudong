# Storyboard Agent v2 — Kick

---

## 1. 속도: 순차 Retrieve 반복으로 인한 지연

**문제**

전체 스토리보드 생성에 약 1분 30초 소요. 원인은 단일 에이전트가 tool calling으로 Retrieve → 데이터 검증 fail → 동일 파이프라인으로 재검색하는 순차 구조. 핏한 데이터를 한 번에 가져오지 못하면 같은 경로를 반복하면서 시간이 누적됨.

**해결**

- **RAG 병렬 처리**: Supervisor가 업무를 분해한 뒤 `Send` API로 Researcher 복수 인스턴스에 동시 분배. 자막 검색, 카테고리 조회, 메타데이터 조회를 병렬 실행.
- **Supervisor ReAct 루프**: Observe(슬롯 충족도) → Think(판단) → Act(Task 생성/승인) 구조로, **미충족 슬롯만 타겟팅**하여 불필요한 전체 재검색 방지.

---

## 2. 데이터 충분성 검증 실패율

**문제**

Retrieve 후 데이터 충분성 검증(캡션 ≥ 3개)이 자주 fail. 근본 원인은 검색으로 걸릴 만한 데이터 자체가 충분하지 않은 경우가 많다는 것. 고정 임계값 기반 검증이라 유연성이 없고, 실패 시 동일 쿼리로 재검색만 반복.

**해결**

- **슬롯 필링 전환**: 고정 임계값 대신 `StoryboardSlots`(visual_references, transcript_context, food_restaurant_info 등)별 충족 여부로 판단. 미충족 슬롯만 타겟 검색하고, human에게도 "어떤 슬롯이 왜 부족한지" 구체적으로 설명.
- **웹 검색 적극 활용**: DB에 없는 트렌드, 배경 지식은 `web_search` 도구로 외부에서 보충.
- **Intern 에이전트의 동적 도구 생성**: 기존 도구로 해결 안 되는 검색 패턴 → Intern이 새로운 RPC 함수/도구를 생성. 에이전트는 `list_tools`로 동적으로 사용 가능한 도구를 확인.
- **Intern 계획 루프 추가**: Intern은 시작 시 `plan` 노드에서 Markdown 계획 파일을 만들고, 실행 턴 종료/리뷰 비승인 시 시스템이 계획을 자동 갱신한다.
- **Intern 리뷰 루프 단순화**: create/delete를 `pending_review_calls` 큐로 1개씩 처리한다. create는 `review_create(interrupt_after)`에서 코드리뷰+사람 확인, delete는 `execute_delete(interrupt_before)`에서 사람 확인 후 처리한다. 사람 입력은 `승인/삭제` 규칙 분기, 그 외 텍스트는 `pending_modified_feedback`에 저장하고 다음 think에서 반영한다.
- **Intern 요청/결과 핸드오프 명시화**: Researcher 요청은 `intern_request`로 전달하고, Intern은 처리 결과를 Supervisor 판단용 `intern_result` 문자열로 반환.

---

## 3. 동적 도구 생성의 보안 리스크

**문제**

Intern이 코드를 생성하고 실행하는 구조는 임의 코드 실행, 외부 요청, SQL injection 등 보안 위험을 수반.

**해결 — 5계층 보안 모델**

| 계층 | 방어 | 상태 |
|------|------|------|
| 1 | 경로 제한: `tools/` 폴더만 접근, `supabase/`만 SQL 저장 | 구현 |
| 2 | 정적 코드 검사: regex `\b` 기반 위험 패턴 9종 차단 (exec, subprocess, requests 등) | 구현 |
| 3 | LLM 코드 리뷰: 별도 LLM이 `_PROTECTED` + 위험 패턴 목록 기준으로 검토 | **구현** |
| 4 | Human 확인: create→`interrupt_after`(코드 확인), delete→`interrupt_before`(삭제 승인) | 구현 |
| 5 | 실행 샌드박스: 격리 환경에서 실행 | 미구현 |

- SQL은 `CREATE FUNCTION` 화이트리스트 + 위험 패턴 블랙리스트 이중 검증
- 외부 `requests` 호출, `CREATE FUNCTION` 이외의 DDL 차단
- `list_rpc_sql`/`view_rpc_sql`은 ADMIN 전용으로 유지하고, 목록 조회와 SQL 본문 조회를 분리

---

## 4. 단일 State의 유지보수 한계

**문제**

v1은 모든 필드가 하나의 flat `AgentState`에 몰려 있어서:
- 에이전트 추가/수정 시 전체 State 영향 파악 필요
- 어떤 노드가 어떤 필드를 건드렸는지 추적 어려움
- 테스트 시 전체 State mock 필요

**해결 — SharedState + 에이전트별 Private State**

```
SharedState (공유): messages, slots, is_approved, final_output
 ├── SupervisorPrivate: tasks, loop_count, human_feedback
 ├── ResearcherPrivate: research_results, previous_queries
 ├── InternPrivate:     intern_reports, intern_action, pending_review_calls, pending_execute_calls, review_statuses, pending_modified_feedback, plan_update_events, created_artifacts, artifact_statuses
 └── DesignerPrivate:   storyboard_history, human_feedback, conversation_summary
```

- SharedState에는 `intern_request`, `researcher_context`, `intern_result`를 포함해 Researcher↔Intern 왕복 컨텍스트를 유지

- 각 에이전트는 서브그래프로 자체 State를 관리
- Private 필드 추가/수정 시 **해당 에이전트만 수정**, SharedState 변경 최소화
- 서브그래프 단위 독립 테스트 가능

---

## 5. 피드백 재조사 시 컨텍스트 폭발

**문제**

Designer가 스토리보드를 생성하고 human 피드백으로 "추가 조사 필요" → Supervisor로 복귀할 때, 기존 대화(messages)가 전부 누적되면 컨텍스트 윈도우를 초과하거나 LLM의 판단력이 저하.

**해결 — summarize_and_reset**

- Designer → Supervisor 복귀 전에 `summarize_and_reset` 노드가 실행
- 기존 대화를 한 문단으로 요약 (LLM) + 이전 메시지 삭제 (`RemoveMessage`)
- 요약 + human feedback(research_query)만 Supervisor에 전달
- `conversation_summary`에 저장하여 재조사 맥락 유지, 토큰 절약

---

## 6. Supervisor의 역할 복잡도

**문제**

Supervisor는 슬롯 초기 추출, 업무 분배, 결과 수신, 충족도 평가, 승인, 피드백 라우팅까지 담당. 단순 분기 로직으로는 동적 판단이 어려움.

**해결 — Supervisor에 ReAct 패턴 적용**

```
[Observe] slots + research_results 충족도 확인
    → [Think] 어떤 슬롯이 부족한가? 어떤 Task를 만들어야 하는가?
    → [Act] Task 생성 → Send / 또는 is_approved=True → Designer
    → [Observe] 결과 수신 → 슬롯 업데이트
    → ... (최대 3회)
```

- 도구 호출 없이 LLM 판단 루프로 동작
- 미충족 슬롯 기반으로 구체적인 Task(업무)를 생성하여 Researcher/Intern에 분배
- 루프 카운터(max 3)로 무한 반복 방지
- `intern_result`를 해석해 Intern 작업 성공/실패를 판단하고 Researcher 재시도 여부를 제어
