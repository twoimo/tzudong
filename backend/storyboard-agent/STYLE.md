# Code Style

1. 코드는 간결하게 작성한다. 불필요한 중간 변수, 중복 로직을 제거한다.
2. 디버깅용 코드(`print()`, `breakpoint()`, 주석 처리된 코드)를 프로덕션에 남기지 않는다.
3. 로그는 RAG 검색/Agent 도구 호출의 원문 기록 목적에 한해 `log.md`에 `log_tool_call()`로 남긴다.
4. 각 도구는 `src/tools/` 폴더에 개별 파일(`도구이름.py`)로 관리한다.
5. 도구 파일은 인자 없이 실행 시 소스 코드 출력, JSON 인자와 실행 시 도구 실행을 지원한다.
6. 도구 로딩은 동적(`load_tools()`)으로 수행한다. 모듈 레벨 캐싱 금지.
7. `_shared.py`는 `src/`에 위치한다 (`tools/` 폴더 외부). 에이전트가 접근 불가.
8. 다중 에이전트 구성 (v2):
   - Supervisor: 기획·분배·승인, **ReAct 패턴** (Observe→Think→Act 루프)
   - Researcher: `TOOLS` + `request_new_tool`. ReAct + Self-RAG(최대 3턴). `ToolMessage.name`으로 결과 분류. `previous_queries: {"scene":[], "web":[]}`.
   - Intern: `ADMIN_TOOLS`(6종). 시작 시 `plan` 노드로 `intern_plan`을 만들고, 매 작업 뒤 `update_plan` 노드로 계획을 갱신한다. 상태 기반 분기(`intern_action`). create→`review(interrupt_after)`, delete→`execute_delete(interrupt_before)`, read(`list_rpc_sql`/`view_rpc_sql`)→`execute`. 덮어쓰기 불가(삭제→재생성 강제).
   - Designer: 도구 없음, `interrupt_after` (스토리보드 생성 후 human 확인)
   - State: **SharedState + 에이전트별 Private** 분리. 서브그래프로 독립 관리.
9. ADMIN_TOOLS 6종: `create_tool`/`delete_tool` → `tools/`, `create_rpc_sql`/`delete_rpc_sql`/`list_rpc_sql`/`view_rpc_sql` → `supabase/`. `list_rpc_sql`/`view_rpc_sql`은 Researcher가 접근하지 못하도록 ADMIN에만 둔다. 보고서 → `.storyboard-agent/intern-reports/`.
10. 코드 생성 보안 5계층: 경로 제한 → 정적 검사(regex `\b`) → **LLM 코드 리뷰**(review 노드, `CODE_REVIEW_PROMPT`) → Human 확인(create→interrupt_after, delete→interrupt_before) → 샌드박스(미구현).
11. SQL은 `CREATE FUNCTION` 화이트리스트 + 위험 패턴 블랙리스트 이중 검증.
12. Intern 문서 작성은 Pydantic 모델(`InfeasibilityReport`, `MetadataProposalReport`)로 검증한다.
13. 데이터 검증은 **슬롯 필링** 방식. `StoryboardSlots`에 정의된 슬롯별 충족 여부로 판단.
14. 런타임 데이터(메모리, 로그, Intern 보고서)는 `.storyboard-agent/`에 저장. `.gitignore` 대상.
15. ToolMessage 처리 시 `msg.name`(도구 이름)으로 결과를 분류한다. 도구별 쿼리 분리 관리(`previous_queries`).
16. 시스템 보호 파일(`_PROTECTED`): `__init__`, `_shared`, `list_tools`, `create_tool`, `delete_tool`, `create_rpc_sql`, `delete_rpc_sql`, `list_rpc_sql`, `view_rpc_sql`. 생성/삭제 불가. 코드 리뷰에서도 거부.
17. 덮어쓰기 금지: `create_tool`/`create_rpc_sql`은 overwrite 불가. 수정 시 `delete` → human 승인 → `create` 순서 강제.
18. Intern 산출물 추적: `created_artifacts: list[dict]`로 생성/삭제 이력 관리. `intern_action` 상태로 라우팅(문자열 매칭 금지). 계획 상태는 `intern_plan`에 저장한다.
19. Intern 요청/결과 전달: `intern_request`(Researcher→Supervisor→Intern)를 Intern이 우선 지시로 사용한다. Intern 완료 결과는 Supervisor 판단용 `intern_result: str`로 전달한다.
20. RPC SQL 분리 원칙: `supabase/`는 함수별 `*.sql`로 관리하고, 인덱스 SQL은 `idx_*.sql` 또는 `_*.sql`로 별도 관리한다. `list_rpc_sql`은 인덱스를 RPC와 분리해 반환한다.
21. Supervisor 라우팅 원칙: `intern_result`를 해석해 Researcher 재시도/추가 요청/human 문의를 결정하고, 처리한 `intern_request`/`intern_result`는 소비(clear)한다.
