# Code Style

1. 코드는 간결하게 작성한다. 불필요한 중간 변수, 중복 로직을 제거한다.
2. 디버깅용 코드(`print()`, `breakpoint()`, 주석 처리된 코드)를 프로덕션에 남기지 않는다.
3. 로그는 RAG 검색/Agent 도구 호출의 원문 기록 목적에 한해 `log.md`에 `log_tool_call()`로 남긴다.
4. 각 도구는 `src/tools/` 폴더에 개별 파일(`도구이름.py`)로 관리한다.
5. 도구 파일은 인자 없이 실행 시 소스 코드 출력, JSON 인자와 실행 시 도구 실행을 지원한다.
6. 도구 로딩은 동적(`load_tools()`)으로 수행한다. 모듈 레벨 캐싱 금지.
7. `_shared.py`는 `src/`에 위치한다 (`tools/` 폴더 외부). 에이전트가 접근 불가.
8. 다중 에이전트 구성 (v2):
   - Supervisor: 기획·분배·승인
   - Researcher: `TOOLS`만 접근, 자율 ReAct 루프
   - Intern: `ADMIN_TOOLS`만 접근, `interrupt_before` 필수
   - Designer: 도구 없음, `interrupt_after` (스토리보드 생성 후 human 확인)
9. ADMIN_TOOLS 경로 제한: `create_tool`/`delete_tool` → `tools/`, `generate_rpc_sql` → `supabase/`.
10. 코드 생성 보안 5계층: 경로 제한 → 정적 검사(regex `\b`) → Human Interrupt → LLM 리뷰(미구현) → 샌드박스(미구현).
11. SQL은 `CREATE FUNCTION` 화이트리스트 + 위험 패턴 블랙리스트 이중 검증.
12. Intern 문서 작성은 Pydantic 모델(`InfeasibilityReport`, `MetadataProposalReport`)로 검증한다.
13. 데이터 검증은 고정 임계값(캡션 N개)이 아닌 **슬롯 필링** 방식을 사용한다. `StoryboardSlots`에 정의된 슬롯별 충족 여부로 판단하며, 미충족 슬롯만 타겟 검색한다. 상세 설계: `STORYBOARD_NEXT_STEP_DESIGN_v2.md` §11.
