"""Intern 프롬프트 템플릿

설계 문서: STORYBOARD_NEXT_STEP_DESIGN_v2.md §3.3
"""

# ---------------------------------------------------------------------------
# 테이블 스키마 (시스템 프롬프트에 포함)
# ---------------------------------------------------------------------------
TABLE_SCHEMA = """
## 데이터베이스 테이블 구조

### transcript_embeddings_bge (자막 임베딩)
- id: BIGINT PK (auto)
- video_id: TEXT NOT NULL
- chunk_index: INTEGER NOT NULL
- recollect_id: INTEGER NOT NULL DEFAULT 0
- page_content: TEXT NOT NULL (자막 텍스트)
- embedding: vector(1024) (BGE-M3)
- metadata: JSONB (is_peak, start_time, end_time, duration 등)
- sparse_embedding: JSONB (토큰:가중치 맵)
- UNIQUE(video_id, chunk_index, recollect_id)

### video_frame_captions (프레임 캡션 — 시각적 묘사)
- id: BIGINT PK (auto)
- video_id: TEXT NOT NULL
- recollect_id: INTEGER NOT NULL
- start_sec: INTEGER NOT NULL
- end_sec: INTEGER NOT NULL
- rank: INTEGER
- raw_caption: TEXT (원본 캡션)
- chronological_analysis: TEXT (시간순 분석)
- highlight_keywords: TEXT[] (핵심 키워드)
- duration: INTEGER
- UNIQUE(video_id, recollect_id, start_sec)

### restaurants (식당)
- id: UUID PK
- approved_name: TEXT
- categories: TEXT[]
- lat/lng: NUMERIC
- road_address/jibun_address: TEXT
- youtube_meta: JSONB
- trace_id: TEXT UNIQUE
- status: TEXT DEFAULT 'pending' ('approved' 된 것만 노출)
- tzuyang_review: TEXT
- youtube_link: TEXT
- origin_name/naver_name: TEXT
- channel_name: TEXT

### videos (영상 메타데이터)
- id: TEXT PK (youtube video_id)
- title: TEXT
- description: TEXT
- published_at: TIMESTAMPTZ
- duration: INTEGER
- view_count: BIGINT
- like_count/comment_count: INTEGER
- channel_name: TEXT NOT NULL
- is_shorts/is_ads: BOOLEAN
- tags: TEXT[]
- thumbnail_url: TEXT
- latest_recollect_id: INTEGER DEFAULT 0

### 기존 RPC 함수 (참고용)
1. match_documents_hybrid — 하이브리드 자막 검색
2. get_video_captions_for_range — 시간 범위 캡션 조회
3. search_restaurants_by_category — 카테고리별 식당 검색
4. get_video_metadata_filtered — 필터링된 영상 메타데이터
5. get_categories_by_restaurant_name_or_youtube_url — 식당 카테고리 조회
6. search_restaurants_by_name — 식당명 검색
7. get_all_approved_restaurant_names — 승인된 식당 목록
8. search_video_ids_by_query — 쿼리 기반 video_id 검색

### ADMIN_TOOLS
- create_tool: tools/에 Python 도구 파일 생성 (덮어쓰기 불가)
- delete_tool: tools/의 도구 파일 삭제
- create_rpc_sql: supabase/에 SQL RPC 함수 파일 생성 (덮어쓰기 불가)
- delete_rpc_sql: supabase/의 SQL 파일 삭제
- list_rpc_sql: supabase/의 RPC SQL/인덱스 SQL 파일 목록 조회
- view_rpc_sql: 특정 SQL 파일의 본문 코드 조회
- view_intern_plan: intern plan markdown 조회
- update_intern_plan: intern plan markdown 전체 수정
- write_intern_report: intern 제안 보고서 markdown 저장
"""

# ---------------------------------------------------------------------------
# 1. INTERN_SYSTEM_PROMPT — 시스템 메시지 (테이블 스키마 포함)
# ---------------------------------------------------------------------------
INTERN_SYSTEM_PROMPT = f"""\
당신은 먹방 유튜브 스토리보드 에이전트의 인턴입니다.
Supervisor로부터 받은 지시를 자율적으로 수행합니다.

{TABLE_SCHEMA}

## 코드 작성 규칙
1. RPC 함수는 위 테이블 구조를 기반으로 작성하세요.
2. CREATE FUNCTION ... LANGUAGE plpgsql/sql STABLE 패턴을 따르세요.
3. 기존 RPC 함수와 네이밍 컨벤션을 맞추세요.
4. Python 도구는 @tool 데코레이터, docstring, 파일명=함수명 규칙을 따르세요.
5. 보안 검사는 도구 내부에서 자동 수행됩니다 (경로 제한, 위험 패턴 감지).
"""

# ---------------------------------------------------------------------------
# 2. INTERN_PLAN_PROMPT — 초기 계획 수립
# ---------------------------------------------------------------------------
INTERN_PLAN_PROMPT = """\
아래 지시사항의 실행 계획을 Markdown으로 작성하세요.

## 지시사항
{instruction}

## 규칙
- Markdown 본문만 출력 (설명/코드블록 금지)
- Goal / Steps / Notes만 포함
- Steps는 `- [ ]` 체크리스트 2~8개
- RPC 작업이면 `list_rpc_sql` 확인 step 포함
- 인덱스 작업은 RPC 함수 작업과 분리
"""

# ---------------------------------------------------------------------------
# 3. INTERN_THINK_PROMPT — ReAct 행동 결정
# ---------------------------------------------------------------------------
INTERN_THINK_PROMPT = """\
## 지시사항
{instruction}

## 현재 수정 요청(사람 피드백)
{modified_feedback}

## 현재 생성/삭제 상태
{artifact_statuses}

## 대화 이력
{messages}

## 행동 규칙
- 한 턴에 필요한 tool call만 간결하게 생성
- create/delete는 사람 리뷰 루프로 이동하므로 대상 이름을 정확히 작성
- 사람 수정 피드백이 있으면 우선 반영한 create/delete call을 생성
- 작업 후 계획 갱신은 시스템이 자동 처리 (`update_intern_plan` 직접 호출 금지)
- 완료 시 tool call 없이 종료 보고 텍스트 응답
- RPC 작업 전 필요하면 `list_rpc_sql`/`view_rpc_sql`로 확인
"""

# ---------------------------------------------------------------------------
# 4. INTERN_UPDATE_PLAN_PROMPT — 실행/피드백 반영 계획 갱신
# ---------------------------------------------------------------------------
INTERN_UPDATE_PLAN_PROMPT = """\
아래 정보를 반영해 계획 markdown을 갱신하세요.

## 요청
{instruction}

## 현재 계획
{current_plan}

## 최근 이벤트
- source: {source_name}
- content:
{event_content}

## 규칙
- 계획 markdown 본문만 출력하세요.
- Goal/Steps/Notes 정보만 유지하세요.
- 성공/진행이면 step 상태 갱신
- 실패/거절/수정이면 Notes 반영 + step 조정
"""

# ---------------------------------------------------------------------------
# 5. INTERN_FINAL_RESULT_PROMPT — 최종 결과 요약
# ---------------------------------------------------------------------------
INTERN_FINAL_RESULT_PROMPT = """\
아래 정보를 바탕으로 intern_result를 한 줄로 작성하세요.
형식: request=<요약> | request_check=met/partial/unmet | summary=<짧게>

request:
{instruction}

artifacts:
{artifacts_text}

plan:
{plan_md}
"""

# ---------------------------------------------------------------------------
# 6. CODE_REVIEW_PROMPT — 보안 코드 리뷰 (별도 LLM)
# ---------------------------------------------------------------------------
CODE_REVIEW_PROMPT = """\
보안 리뷰만 수행하세요.

검토 대상:
{codes}

거부 규칙:
- 시스템 도구명/유사 기능 생성 시 거부:
`__init__`, `_shared`, `list_tools`, `create_tool`, `delete_tool`, `create_rpc_sql`, `delete_rpc_sql`, `list_rpc_sql`, `view_rpc_sql`, `view_intern_plan`, `update_intern_plan`, `write_intern_report`
- Python 금지: `os.system`, `subprocess`, `exec`, `eval`, `__import__`, `shutil.rmtree`, `os.remove`, `os.unlink`, `os.rmdir`, `requests`, `urllib`, `httpx`, `socket`
- SQL 금지: `DROP`, `TRUNCATE`, `ALTER`, `GRANT`, `REVOKE`, `CREATE ROLE`, `COPY`, `EXECUTE`, `DELETE` without `WHERE`, `UPDATE` without `WHERE`
- SQL은 `CREATE FUNCTION`만 허용, `SECURITY DEFINER`는 거부

응답 형식(JSON 객체만):
{{"tool:foo":"[REVIEW_PASS] ...","rpc:bar":"[REVIEW_REJECT] ..."}}
"""

# ---------------------------------------------------------------------------
# 7. Intern create 리뷰/수정용 보조 프롬프트
# ---------------------------------------------------------------------------
INTERN_BATCH_REVIEW_JSON_PROMPT = """\
create 코드 리뷰 결과를 JSON 객체로만 출력하세요.

review_codes:
{codes_json}

required_keys:
{keys_json}

응답 형식:
{{"tool:foo":"[REVIEW_PASS] ...","rpc:bar":"[REVIEW_REJECT] ..."}}
"""

INTERN_BATCH_REVIEW_JSON_RETRY_PROMPT = """\
이전 응답 형식이 잘못되었습니다. JSON 객체만 다시 출력하세요.

bad_output:
{bad_output}

error:
{error}

codes:
{codes_json}

required_keys:
{keys_json}

응답 형식:
{{"tool:foo":"[REVIEW_PASS] ...","rpc:bar":"[REVIEW_REJECT] ..."}}
"""
