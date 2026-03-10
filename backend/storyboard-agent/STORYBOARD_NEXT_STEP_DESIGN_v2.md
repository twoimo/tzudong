# Storyboard Multi-Agent System v2 (Current)

현재 코드 기준 최신 설계 문서.

- 기준 코드:
  - `src/graph.py`
  - `src/agents/supervisor.py`
  - `src/agents/researcher.py`
  - `src/agents/intern.py`
  - `src/agents/designer.py`
  - `src/state/main.py`

---

## 1. 시스템 목표

- 사용자 요청 기반 스토리보드 생성/수정
- 조사 부족 시 Researcher가 Intern에 도구/RPC 보강 요청
- Human-in-the-loop 승인/수정/재조사 루프 유지

---

## 2. 전체 그래프 흐름

표기:
- `---->`: 일반 엣지
- `==[조건]==>`: 조건부 엣지

```text
-----------
|  START  |
-----------
    |
    v
----------------
| extract_slots |
----------------
    |
    v
--------------
| supervisor  |
--------------
  ==[is_approved=True]==>----------------
                           |  designer   |
                           ----------------
  ==[else]==>----------------------------------------
              |             researcher               |
              ----------------------------------------

researcher(END)
  ==[intern_request 있음]==>------------
                              | intern |
                              ------------
  ==[intern_request 없음]==>--------------
                              | supervisor |
                              --------------

intern(END)
  ----> researcher

designer(END)
  ==[human_feedback or conversation_summary 있음]==> supervisor
  ==[else]==> END
```

핵심:
- Supervisor는 Intern으로 직접 라우팅하지 않음
- Intern 진입 여부는 Researcher 종료 시 `intern_request`로 결정

---

## 3. 에이전트별 상세

## 3.1 Supervisor

역할:
- `research_sufficient` 기준 승인/재조사 분기
- `research_instruction` 생성 및 `agent_instructions["researcher"]` append
- `research_results`를 `research_scene_data`, `research_web_summary`로 분리

입력 주요 상태:
- `research_sufficient`, `research_summary`
- `research_results`
- `human_feedback`, `conversation_summary`
- `researcher_stall_summary`, `intern_result`

출력 주요 상태:
- `is_approved`
- `research_instruction`
- `agent_instructions["researcher"]`
- `research_scene_data`, `research_web_summary`

규칙:
1. `human_feedback` 또는 `conversation_summary` 있으면 researcher 재지시
2. `research_sufficient == True`면 승인(`is_approved=True`)
3. 그 외는 researcher 재시도 지시

---

## 3.2 Researcher

서브그래프:
```text
START -> think -> tools -> evaluate
think --[tool_calls 없음]--> END
evaluate --[intern_request or sufficient or stall]--> END
evaluate --[else]--> think
```

역할:
- `research_instruction` 기반 검색/도구 호출
- 결과 누적(`scene_data/transcripts`, `web_results`, `web_summary`)
- `research_sufficient` 판정
- 필요 시 `intern_request` 생성

`intern_request` 생성 조건:
- `request_new_tool` 호출 감지
- think 반복 정체(`researcher_think_count >= 5`)

정체 처리:
- `researcher_stall_summary` 생성
- `researcher_think_count` 리셋(0)
- Intern 요청 생성 후 END

---

## 3.3 Intern (단순화 적용)

Intern은 “원본 호출 로그”와 “수정본 작업 상태”를 분리한다.

## 3.3.1 핵심 상태

- `original_tool_calls: list[dict]`
  - think가 최초 생성한 호출 로그
- `modified_tool_calls: dict[str, dict]`
  - 예: `{"tool:foo": {"tool_call": {...}, "status": "pending|needs_modify|approved|rejected|executed|failed", "version": 1}}`
- `tool_call_order: list[str]`
  - review 순서 고정
- `current_tool_key: Optional[str]`
  - 현재 처리 대상
- `pending_execute_calls: list[dict]`
  - 승인된 실행 대기 큐
- `pending_modified_feedback: dict[str, str]`
  - 사람 수정 지시
- `plan_update_events: list[ToolMessage]`
  - 계획 업데이트 이벤트 버퍼
- `intern_ready_to_end: bool`
  - finish 완료 플래그

## 3.3.2 서브그래프

```text
START -> plan -> think

think
  -> create_modify        (needs_modify create 우선)
  -> execute_delete       (pending/needs_modify delete)
  -> review_create        (pending create)
  -> execute              (pending_execute_calls 존재)
  -> update_plan          (plan_update_events 존재)
  -> finish               (새 tool_call 없음)
  -> END                  (intern_ready_to_end=True일 때만)
  -> think                (그 외)

review_create -> (interrupt_after) -> create_review_decision
execute_delete -> (interrupt_before) -> delete decision

create_modify -> review_create 또는 think
create_review_decision -> execute/update_plan/review_create/think
execute_delete -> execute/update_plan/review_create/think
execute -> update_plan/think
update_plan -> think
finish -> think
```

## 3.3.3 승인/삭제/수정 규칙

- 입력 `승인` -> `approve`
- 입력 `삭제` -> `delete`
- 그 외 텍스트 -> `modify`

Create(`create_review_decision`):
- 승인: `status=approved`, `pending_execute_calls += call`, 이벤트 `approved(queued)`
- 삭제: `status=rejected`, 이벤트 적재 후 `update_plan`
- 수정: `status=needs_modify`, 피드백 저장, 이벤트 적재 후 `update_plan`

Delete(`execute_delete`):
- 승인: `status=approved`, `pending_execute_calls += delete_call`, 이벤트 `approved(queued)`
- 삭제(거부): `status=rejected`, 이벤트 적재 후 `update_plan`
- 수정: `status=needs_modify`, 피드백 저장, 이벤트 적재 후 `update_plan`

Create 수정(`create_modify`):
- `INTERN_CREATE_MODIFY_PROMPT`로 대상 1건 재생성
- 대상 불일치/실패 시 경고 후 기존 흐름 복귀
- 성공 시 `version += 1`, `status=pending`으로 재리뷰

실행(`execute`):
- `pending_execute_calls` 실제 실행
- 결과 반영: `modified_tool_calls[key].status = executed|failed`
- `created_artifacts`, `artifact_statuses`, `plan_update_events` 업데이트

종료(`finish`):
- `intern_result` 생성
- `intern_ready_to_end=True`
- think 복귀 후 END 분기

## 3.3.4 Interrupt 계약

- `interrupt_after=["review_create"]`
  - create 코드 리뷰 결과 확인 후 사람 입력
- `interrupt_before=["execute_delete"]`
  - delete 실행 직전 사람 입력

---

## 3.4 Designer

서브그래프:
```text
START -> designer_node -> feedback_classifier
feedback_classifier --[edit_storyboard]--> designer_node
feedback_classifier --[need_research]--> summarize_and_reset -> END
feedback_classifier --[approved]--> END
```

입력:
- `slots`
- `research_scene_data`
- `research_web_summary`

동작:
- 생성/수정 후 `interrupt_after=["designer_node"]`
- 피드백 분류 결과:
  - `edit_storyboard`: 즉시 재작성
  - `need_research`: 대화 요약(`conversation_summary`) + `human_feedback` 유지 후 supervisor 복귀
  - `approved`: 종료

---

## 4. 상태 아키텍처

SharedState 핵심:
- `messages`
- `slots`
- `is_approved`, `final_output`
- `research_instruction`, `research_results`
- `research_scene_data`, `research_web_summary`
- `research_sufficient`, `research_summary`
- `researcher_think_count`, `researcher_stall_summary`
- `intern_request`, `intern_result`, `researcher_context`
- `agent_instructions`
- `human_feedback`, `conversation_summary`

Intern Private 핵심:
- `intern_action`
- `original_tool_calls`, `modified_tool_calls`, `tool_call_order`, `current_tool_key`
- `pending_execute_calls`, `pending_modified_feedback`
- `plan_update_events`
- `created_artifacts`, `artifact_statuses`, `review_statuses`
- `intern_ready_to_end`

---

## 5. 프롬프트/도구 계약

## 5.1 Intern 프롬프트

- `INTERN_THINK_PROMPT`
  - `original_tool_calls`, `modified_tool_calls`, `pending_modified_feedback`, `artifact_statuses` 입력
- `INTERN_CREATE_MODIFY_PROMPT`
  - 수정 대상 1건 재생성 전용
- `CODE_REVIEW_PROMPT` + JSON 검증
  - create 코드 리뷰 결과 구조 강제

## 5.2 도구 접근

- Researcher: `TOOLS + request_new_tool`
- Intern: `ADMIN_TOOLS`만

---

## 6. 운영 체크리스트

1. Supervisor는 `research_sufficient`만으로 승인 판단하는가
2. Researcher 정체(5회) 시 `researcher_stall_summary` + `intern_request` 생성되는가
3. Intern에서 create 수정은 `create_modify`로 1건 재생성되는가
4. delete는 `interrupt_before` 이후에만 승인/실행되는가
5. END가 think에서만 분기되는가(`intern_ready_to_end`)
6. Designer `need_research` 시 `conversation_summary`가 supervisor로 전달되는가

---

## 7. 문서 정책

- 본 문서를 최신 설계의 source of truth로 사용
- `STORYBOARD_NEXT_STEP_DESIGN.md`는 구상/아이디어 참고용(레거시)

