# Code Style

1. 코드는 간결하게 작성한다. 불필요한 중간 변수, 중복 로직을 제거한다.
2. 디버깅용 코드(`print()`, `breakpoint()`, 주석 처리된 코드)를 프로덕션에 남기지 않는다.
3. 로그는 RAG 검색/Agent 도구 호출의 원문 기록 목적에 한해 `log.md`에 `log_tool_call()`로 남긴다.
4. 각 도구는 `src/tools/` 폴더에 개별 파일(`도구이름.py`)로 관리한다.
5. 도구 파일은 인자 없이 실행 시 소스 코드 출력, JSON 인자와 실행 시 도구 실행을 지원한다.
6. 도구 로딩은 동적(`load_tools()`)으로 수행한다. 모듈 레벨 캐싱 금지.
7. 다중 에이전트 구성: 자료 서치 에이전트는 `TOOLS`만, 도구/RPC 제작 에이전트는 `ADMIN_TOOLS`를 `interrupt_before`로 제공한다.
8. `_shared.py`는 `src/`에 위치한다 (`tools/` 폴더 외부). 에이전트가 접근 불가.
9. ADMIN_TOOLS는 해당 폴더만 접근 가능: `create_tool`/`delete_tool` → `tools/`, `generate_rpc_sql` → `supabase/`.
10. 코드 안전성 검사: regex 단어 경계(`\b`) 기반 정적 분석 적용. SQL은 `CREATE FUNCTION` 화이트리스트 + 위험 패턴 블랙리스트 이중 검증.
11. LLM 코드 리뷰 노드: 미구현. 향후 `admin_tools` 노드 앞에 LLM 리뷰 노드를 추가하여 의미 수준 검토 예정.
