# Code Style

1. 코드는 간결하게 작성한다. 불필요한 중간 변수, 중복 로직을 제거한다.
2. 디버깅용 코드(`print()`, `breakpoint()`, 주석 처리된 코드)를 프로덕션에 남기지 않는다.
3. 주석 규칙: 함수 설명은 함수 시그니처 아래 docstring으로 작성한다. 함수 내부의 복잡한 흐름은 `# 1)`, `# 2)` 같은 단계 주석으로만 설명한다. 함수 바깥 설명용 한 줄 주석과 `# 기능:` 표현은 사용하지 않는다.
4. 로그는 RAG 검색/Agent 도구 호출의 원문 기록 목적에 한해 `log.md`에 `log_tool_call()`로 남긴다.
5. 각 도구는 `src/tools/` 폴더에 개별 파일(`도구이름.py`)로 관리한다.
6. 도구 파일은 인자 없이 실행 시 소스 코드 출력, JSON 인자와 실행 시 도구 실행을 지원한다.
7. 도구 로딩은 동적(`load_tools()`)으로 수행한다. 모듈 레벨 캐싱 금지.
8. `_shared.py`는 `src/`에 위치한다 (`tools/` 폴더 외부). 에이전트가 접근 불가.
9. 다중 에이전트 구성 (v2):
   - Supervisor: 규칙 기반 분기. `research_sufficient`로 승인(`designer`) 또는 재조사(`researcher`)를 결정한다. supervisor는 intern으로 직접 라우팅하지 않는다.
   - Researcher: `TOOLS` + `request_new_tool`. `think → tools → evaluate` 루프. `ToolMessage.name`으로 결과 분류, `previous_queries: {"scene":[], "web":[]}` 관리, `researcher_think_count`가 5회 이상이면 정체 요약(`researcher_stall_summary`)을 만들어 Supervisor로 복귀한다.
   - Intern: `ADMIN_TOOLS`(9종). 시작 시 `plan` 노드에서 Markdown 계획 생성, `think`는 실행할 tool_call만 만든다(`update_intern_plan` 직접 호출 금지). 생성된 호출은 `original_tool_calls`(원본 로그)와 `modified_tool_calls`(현재 작업본)로 분리 관리한다. create 수정 요청은 `create_modify`에서 대상 1건만 재생성 후 `review_create(interrupt_after)`로 재리뷰한다. delete는 `execute_delete(interrupt_before)`에서 사람 확인 후 승인 시 `pending_execute_calls`에 적재한다. 승인/거부/수정/실행결과 이벤트는 `plan_update_events`에 누적하고 `update_plan`에서 반영한다. END는 `think`에서만 분기한다.
   - Designer: 도구 없음, `interrupt_after` (스토리보드 생성 후 human 확인). 입력은 `slots` + `research_scene_data` + `research_web_summary`.
   - State: **SharedState + 에이전트별 Private** 분리. 서브그래프로 독립 관리.
10. ADMIN_TOOLS 9종: `create_tool`/`delete_tool`/`view_intern_plan`/`update_intern_plan`/`write_intern_report` → `tools/`, `create_rpc_sql`/`delete_rpc_sql`/`list_rpc_sql`/`view_rpc_sql` → `supabase/`. `list_rpc_sql`/`view_rpc_sql`/`view_intern_plan`/`update_intern_plan`/`write_intern_report`은 Researcher가 접근하지 못하도록 ADMIN에만 둔다. 계획 파일은 `.storyboard-agent/intern-reports/plan/active_plan.md`.
11. 코드 생성 보안 5계층: 경로 제한 → 정적 검사(regex `\b`) → **LLM 코드 리뷰**(`review_create` 노드, `CODE_REVIEW_PROMPT`) → Human 확인(create→`interrupt_after=["review_create"]`, delete→`interrupt_before=["execute_delete"]`) → 샌드박스(미구현).
12. SQL은 `CREATE FUNCTION` 화이트리스트 + 위험 패턴 블랙리스트 이중 검증.
13. Intern create 코드리뷰 응답(JSON)은 Pydantic 모델로 검증한다.
14. Supervisor 승인 규칙은 단순하게 유지한다. 기본은 `research_sufficient == True`일 때 `designer`로 이동한다.
15. 런타임 데이터(메모리, 로그, Intern 보고서)는 `.storyboard-agent/`에 저장. `.gitignore` 대상.
16. ToolMessage 처리 시 `msg.name`(도구 이름)으로 결과를 분류한다. 도구별 쿼리 분리 관리(`previous_queries`).
17. 시스템 보호 파일(`_PROTECTED`): `__init__`, `_shared`, `list_tools`, `create_tool`, `delete_tool`, `create_rpc_sql`, `delete_rpc_sql`, `list_rpc_sql`, `view_rpc_sql`, `view_intern_plan`, `update_intern_plan`, `write_intern_report`. 생성/삭제 불가. 코드 리뷰에서도 거부.
18. 덮어쓰기 금지: `create_tool`/`create_rpc_sql`은 overwrite 불가. 수정 시 `delete` → human 승인 → `create` 순서 강제.
19. Intern 산출물/상태 추적: `created_artifacts`(이력 append), `artifact_statuses`(대상별 최신 상태), `review_statuses`(승인/삭제/수정), `pending_modified_feedback`(사람 수정 지시)로 관리한다. `intern_action`으로 라우팅하며 계획 상태는 `.storyboard-agent/intern-reports/plan/active_plan.md` Markdown 파일로 관리한다.
20. Intern 요청/결과 전달: `intern_request`(Researcher→Intern 라우팅 결과)를 Intern이 우선 지시로 사용한다. Intern 완료 결과는 Supervisor 판단용 `intern_result: str`로 전달한다.
21. RPC SQL 분리 원칙: `supabase/`는 함수별 `*.sql`로 관리하고, 인덱스 SQL은 `idx_*.sql` 또는 `_*.sql`로 별도 관리한다. `list_rpc_sql`은 인덱스를 RPC와 분리해 반환한다.
22. 최상위 라우팅 원칙: supervisor는 `is_approved`가 true면 `designer`, 그 외는 `researcher`로 보낸다. researcher 종료 후 `intern_request`가 있으면 `intern`, 없으면 `supervisor`로 복귀한다. `intern_result`는 supervisor 처리 후 소비(clear)한다.
