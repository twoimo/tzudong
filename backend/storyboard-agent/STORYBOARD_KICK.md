# Storyboard Agent Kick (Current)

## 1) 목표
- 사용자 요청 기반으로 먹방 스토리보드를 생성/수정한다.
- 조사 부족 시 researcher가 intern에 도구/RPC 보강을 요청한다.
- 최종 승인 전까지 `research -> design -> feedback` 루프를 유지한다.

## 2) 최상위 그래프
- `START -> extract_slots -> supervisor`
- `supervisor -> researcher | designer`
- `researcher -> intern | supervisor`
- `intern -> researcher`
- `designer -> supervisor | END`

핵심 원칙:
- supervisor는 `research_sufficient`로만 승인 여부를 결정한다.
- supervisor는 intern으로 직접 보내지 않는다.
- intern 요청 생성 책임은 researcher에 있다.

## 3) Supervisor 설계
- 입력: research 결과, designer 피드백, intern 결과
- 출력: researcher instruction 또는 승인(`is_approved=True`)

동작:
1. `research_sufficient=True`면 즉시 designer 승인
2. `human_feedback`/`conversation_summary`가 있으면 researcher 재지시 생성
3. 그 외 `research_sufficient=False`면 researcher 재시도 instruction 생성
4. 모든 researcher 지시는 `agent_instructions["researcher"]`에 append

## 4) Researcher 설계
- `think -> tools -> evaluate` 루프
- think에서 최신 researcher instruction만 사용
- evaluate에서 아래를 수행:
  - `scene_data`/`web_results` 누적
  - `web_summary` 생성
  - `research_sufficient` 판정
  - 필요 시 `intern_request` 생성

intern 요청 조건:
- `request_new_tool` tool call 발생
- think 반복 정체(`researcher_think_count >= 5`)

요청 포맷:
1) 목표
2) 현재 부족한 데이터/이유
3) 생성할 항목(tool/rpc)
4) 완료 기준

## 5) Intern 설계
- plan 생성 후 think 루프 시작
- `modified_tool_calls` 상태를 기준으로 create/delete를 1건씩 검토
- create 수정 요청은 `create_modify`에서 해당 대상 1건만 재생성 후 재리뷰
- delete는 `interrupt_before(execute_delete)`, create는 `interrupt_after(review_create)`로 사람 확인
- 승인 건은 `pending_execute_calls`에 쌓고 `execute`에서 실제 실행
- 승인/거부/수정/실행결과 이벤트를 `plan_update_events`로 모아 `update_plan`에서 반영
- 완료 시 `intern_result`를 생성해 researcher/supervisor 판단에 전달

## 6) Designer 설계
- `research_scene_data` + `research_web_summary`로 초안 생성
- 피드백 분류:
  - `edit_storyboard`: 즉시 수정 루프
  - `need_research`: 요약 후 supervisor 복귀
  - `approved`: 종료

## 7) 현재 운영 기준
- 충분성 단일 기준: `research_sufficient`
- 사용하지 않는 상태(`slots_ready`, `required_slots`, `slot_status`) 제거
- instruction/history 중심 운영:
  - `agent_instructions["researcher"]`
  - `agent_instructions["intern"]`

## 8) 체크리스트
- researcher가 충분 판단 시 supervisor가 즉시 designer로 보낸다.
- researcher 부족/정체 시 intern_request가 생성된다.
- intern 완료 후 researcher 재실행으로 복귀한다.
- designer의 need_research 피드백은 supervisor -> researcher로 재진입한다.
