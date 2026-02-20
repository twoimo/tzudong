"""Supervisor 에이전트 — 기획·설계·분배 (ReAct 패턴)

설계 문서: STORYBOARD_NEXT_STEP_DESIGN_v2.md §3.1
구현 파일: agents/supervisor.py + prompts/supervisor.py

핵심 핸드오프:
- Researcher -> Supervisor: intern_request, researcher_context
- Supervisor -> Intern: intern_request를 HumanMessage 또는 전용 필드로 전달
- Intern -> Supervisor: intern_result(str) 전달
- Supervisor -> Researcher: intern_result 판단 후 researcher_context 기반 재시도 지시
"""

# TODO: 아래 순서대로 구현

# ---------------------------------------------------------------------------
# 1. supervisor_node (메인 노드)
# ---------------------------------------------------------------------------
# - SupervisorState를 받아서 ReAct 루프 실행
# - [Observe] slots.unfilled_required()로 미충족 슬롯 확인
# - [Observe] intern_result가 있으면 intern 작업 결과(성공/부분성공/실패)를 파싱
# - [Think] LLM에게 현재 슬롯 상태 + research_results + intern_result 요약을 주고 판단 요청
# - [Act] Task 목록 생성 (structured output) 또는 is_approved=True 반환
# - Researcher는 slots에 직접 접근 않음 → Supervisor가 미충족 슬롯을 구체적 instruction으로 변환
#
# 입력: SupervisorState
# 출력(예):
# {
#   "tasks": [...],
#   "slots": ...,
#   "is_approved": bool,
#   "loop_count": +1,
#   "intern_request": Optional[str],   # Intern 보낼 요청
#   "intern_result": Optional[str],    # 처리 후 소비(clear) 대상
# }
#
# 참고: prompts/supervisor.py의 SLOT_EVALUATION_PROMPT, TASK_GENERATION_PROMPT 사용

# ---------------------------------------------------------------------------
# 2. route_supervisor (조건부 라우팅)
# ---------------------------------------------------------------------------
# - is_approved == True → "designer"
# - intern_result가 있으면:
#   - status=completed/partial 이면 researcher 재시도 경로 생성 (researcher_context 복원)
#   - status=failed/no_op 이면 대체 task 생성 또는 human 문의
#   - intern_result는 소비 후 None으로 초기화
# - intern_request가 있으면 → Intern에게 Task 생성 후 Send
#   (request_new_tool이 ToolNode에서 실행되고 evaluate에서 감지된 결과)
# - tasks가 있고 researcher 업무 포함 → "researcher" (Send API로 병렬)
# - tasks가 있고 intern 업무 포함 → "intern"
# - loop_count >= 3 → END (무한 루프 방지)
#
# intern_request 처리:
# - Researcher의 evaluate에서 감지된 intern_request를 읽어 Intern Task 생성
# - Intern 완료 후 researcher_context로 이전 대화 복원하여 Researcher 재시도
# - intern_request 소비 후 None으로 초기화
# - Intern에게 전달 시 원문 request를 유지하여 intern_result.request와 비교 가능하게 함
#
# 반환: list[Send] 또는 문자열 ("designer", "end")
#
# def route_supervisor(state: SupervisorState) -> list[Send] | str:
#     if state["is_approved"]:
#         return "designer"
#     if state.get("intern_result"):
#         # 예: "request=... | status=completed | done=[create_tool(x)]"
#         status = parse_intern_result_status(state["intern_result"])
#         if status in ("completed", "partial"):
#             return [Send("researcher", {
#                 "messages": state.get("researcher_context", []),
#                 "intern_request": None,
#                 "intern_result": None,
#             })]
#     if state.get("intern_request"):
#         return [Send("intern", {
#             "messages": [HumanMessage(content=state["intern_request"])],
#             "intern_request": state["intern_request"],
#             "intern_result": None,
#         })]
#     researcher_tasks = [t for t in state["tasks"] if t.agent == "researcher"]
#     return [Send("researcher", {
#         "messages": state.get("researcher_context", []) + [HumanMessage(content=task.instruction)],
#         "slots": state["slots"],
#         "intern_request": None,
#         "intern_result": None,
#         "researcher_context": None,
#     }) for task in researcher_tasks]

# ---------------------------------------------------------------------------
# 3. extract_slots (슬롯 초기 추출 — 첫 호출 시)
# ---------------------------------------------------------------------------
# - 사용자 입력(messages[-1])에서 StoryboardSlots 초기값 추출
# - LLM structured output → StoryboardSlots
# - user_intent, target_scene_count 등 메타 필드도 채움
#
# 참고: prompts/supervisor.py의 SLOT_EXTRACTION_PROMPT 사용

# ---------------------------------------------------------------------------
# 4. update_slots_from_results (Researcher 결과 → 슬롯 업데이트)
# ---------------------------------------------------------------------------
# - Researcher는 slots에 직접 접근 않음 → Supervisor가 결과를 슬롯에 매핑
# - ToolMessage에서 transcript, caption, metadata 등 파싱
# - 해당 슬롯에 Pydantic 모델로 변환하여 추가
#   (VisualReference, TranscriptChunk, FoodRestaurantInfo 등)
# - 중복 제거 (video_id + start_sec 기준)
# - 슬롯 데이터는 Designer가 스토리보드 생성 시 직접 읽음
#
# ---------------------------------------------------------------------------
# 5. parse_intern_result_status (유틸)
# ---------------------------------------------------------------------------
# - intern_result(str)에서 status를 안정적으로 파싱
# - 형식 예: "request=... | status=completed | done=[create_tool(x)]"
# - 파싱 실패 시 "unknown" 반환하여 보수적으로 재요청/검토 경로 선택
