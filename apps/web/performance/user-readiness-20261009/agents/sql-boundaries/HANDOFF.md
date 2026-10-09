PR #3147 SQL 경계 인계 — 2026-10-09

허용된 7개 소스/테스트 파일과 이 증거 디렉터리만 수정했다. 시작 HEAD는 `6d12ce81e6f6e9c8b2e3a321cfc6d5f6eca93391`이다. 작업 중 공유 워크트리 HEAD가 `08ef6d5928edad2bafe38bbd0502519e2b833d27`로 이동한 것을 확인했다(별도 readiness 진단 커밋). 이 worker는 commit/push, 다른 워크트리, 기존 DB·컨테이너·역할, 운영 서비스, 휴대폰 또는 추가 에이전트를 사용하지 않았다. 역할 생성은 새 임시 PG fixture 내부에만 있다.

수정과 완료 범위:

- **kbZ9:** `review_media_private.enqueue_removed()` AFTER DELETE/미디어 UPDATE 트리거가 `OLD.user_id/id/food_photos/verification_photo`에서 정리 대상을 만든다. 호출자의 ID나 전달된 삭제 목록을 신뢰하지 않는다. 기존 직렬화 잠금, 글로벌 참조 확인, 트랜잭션 롤백과 tombstone 유지가 적용된다. 자기 소유의 canonical/legacy key로 해석되는 과거 URL만 정리한다.
- **knIh:** 새 `public.review_media_upload_allowed(p_bucket text,p_path text) -> boolean`이 참조 중인 키의 private shadow 삽입을 거부한다. 신규 canonical 업로드는 허용한다. Storage INSERT와 UPDATE의 restrictive 정책이 호출한다.
- **knIn:** `mutate_review_with_media`가 과거 URL을 무조건 다시 붙이지 않는다. `p_food_photos`를 최종 목록으로 저장한다. 과거 비정규 값은 해당 리뷰의 원본에 있었던 문자열만 그대로 유지하거나 제거할 수 있다. 클라이언트가 새 임의 URL을 추가할 수 없다. 제거된 과거 URL은 DB pre-image에서 안전하게 정리 키로 변환한다.
- **lDIo:** 위 업로드 helper가 같은 advisory lock을 잡고 `retired=true`인 키를 `complete` 상태와 관계없이 거부한다. public food/private verification 삽입과 이름 변경/UPDATE 모두 적용된다. 참조된 객체를 덮어쓰는 UPDATE도 거부된다.
- **sd9K — 부분 지원, 리뷰 종료 보류:** 모든 리뷰 DELETE는 소유자 정리 큐에 food/private verification 대상을 남긴다. 소유자 queue drain은 두 bucket의 부재를 확인한다. 그러나 기존 guarded admin queue/RPC와 관리자 클라이언트의 `review-photos` 고정 처리는 다른 채팅 소유이며 수정하지 않았다. 이 변경만으로 관리자 정리 완료나 private 객체 제거를 주장할 수 없다. parent/guarded SQL 소유자가 목적별 bucket 전달, private 제거, 양쪽 bucket 부재 readback까지 연결해야 한다.

프런트엔드 worker 인터페이스:

- 기존 RPC의 이름/인자/기본값/반환 코드는 동일하다. `p_food_photos`는 **남길 전체 값 1~10개**다. 과거 URL도 원본 그대로 포함하여 유지하고, 명시적으로 제거한 값만 뺀다. 업로드용 소유 path 필터를 최종 목록 전체에 적용하면 과거 값이 모두 제거되므로 이를 구분해야 한다. 과거 값도 보이게 하고 제거 UI와 총 개수에 포함해야 한다.
- 신규 사진은 종전처럼 canonical path + storage metadata 존재 확인이 필요하다. 과거 임의 URL 새 추가는 `REVIEW_INVALID`다. 요청 값은 하나당 최대 8192 bytes이며 새 canonical path 검증은 그대로다. compensation RPC는 계속 canonical food key만 받는다.
- 새 `review_media_upload_allowed(text,text)`는 authenticated만 실행하는 정책 helper다. UI에서 미리 호출할 필요 없다. 참조/퇴역된 키에 대한 업로드는 Storage RLS가 거부하므로 새 키를 사용해야 한다.
- 큐 형식 `{path, owner_id, review_id, purpose}`와 owner 전용 읽기 권한은 그대로다. verification 정리는 private와 과거 public bucket 모두 제거·부재 확인해야 한다. 새 admin queue 권한을 추가하지 않았다.

G014/source 계약:

- public 함수 7개, private helper 7개로 source/final SHA-256, owner, ACL, allowlist, 독립 SQL readback과 Python receipt 기대값을 함께 갱신했다. storage policy 총 기대값은 22개다.
- 기존 assertion 본문, 보호 관계 manifest 기존 행, membership 복원, auth-schema 금지, 초기 정확 source/default 검사와 나머지 함수 메타데이터 비교를 유지했다. `proargdefaults`는 기존 `pg_get_expr` 의미 비교 그대로다.
- 독립 readback에 기존 serialize/reference guard와 새 enqueue trigger의 정확 정의·활성 상태를 추가했다. trigger 제거/비활성화를 실제 DB에서 거부했다.
- 기존 3개 SQL만 수정했다. archive/G026 bundle/기타 migration은 수정하지 않았다.

검증:

- 새 임시 PostgreSQL **17.11 Homebrew**, TCP 비활성/독립 Unix socket, 테스트별 새 DB. 종료 시 fixture cluster 정지·제거.
- `python3 -m unittest backend.supabase.tests.test_review_media_commit_cleanup backend.supabase.tests.test_review_media_catalog_integration -v`: **29개 통과**(DB 동작 15개 + source/receipt 14개), `final-tests.log`.
- baseline에서는 새 경계 회귀 5개 모두 예상 실패: 직접 DELETE 큐 누락, private shadow 허용, retired food 재업로드 허용, 역사 URL 편집 거부, 역사 URL DELETE 큐 누락. `baseline-regressions.log` 보존.
- 실제 동시성: retirement 트랜잭션이 잠금을 보유하는 동안 업로드가 대기하고, COMMIT 이후 RLS 거부. 기존 reattach 대기/거부도 통과.
- 최소 권한 fixture: NOLOGIN/NOINHERIT/NOBYPASSRLS 역할, auth schema 권한 없음, Storage SELECT만으로 새 helper/삭제 trigger/queue drain 동작. 실제 G041 claim helper 원문과 제한된 RLS를 사용했으며 전체 G014 replay를 대체하지 않는다.
- 변경 파일 `git diff --check` 통과. 모든 중간 실패 로그도 보존했다. 첫 역사 URL drain 실패는 fixture가 별도 OLD 고아 객체를 남겨 기존 delete policy의 retirement 부수효과로 추가 queue를 만든 결과였다. fixture에서 그 별도 고아를 제거했고 해당 정책 자체는 변경하지 않았다. 중간 catalog 실패는 storage policy 개수 20→22 갱신 누락을 고쳤고, UPDATE 테스트 SQL의 중첩 DML CTE도 top-level로 바로잡았다.

남은 parent 직렬 검증: 프런트엔드 최종 목록 계약 통합, sd9K guarded admin cleanup, 변경된 소스로 PG15 dual replay 및 PG17.6 원자 적용/RPC7/익명거부/롤백/default·parallel drift 거부, full catalog/전체 suite/build/browser/SDK. 기존 `6d12`의 통과 근거를 이번 변경의 증거로 재사용하지 않았다.

변경 파일:

- `backend/supabase/migrations/20261008192455_review_media_commit_cleanup.sql`
- `backend/supabase/migrations/20261008200719_review_verification_private.sql`
- `backend/supabase/migrations/20261008201635_review_media_catalog_integration.sql`
- `backend/supabase/scripts/local-migrate.py`
- `backend/supabase/scripts/local_catalog_readback.sql`
- `backend/supabase/tests/test_review_media_commit_cleanup.py`
- `backend/supabase/tests/test_review_media_catalog_integration.py`

파일별 해시와 관측 HEAD는 `source-manifest.json`, baseline 대비 허용 파일 패치는 `sql-boundaries.patch`에 있다. `update_catalog_bindings.py`는 이 두 원본 SQL의 함수 본문/시그니처를 G014·readback·Python 기대값에 다시 묶는 국소 도구다.

참고한 현재 공식 보안 지침: [Supabase database functions](https://supabase.com/docs/guides/database/functions), [changelog](https://supabase.com/changelog.md). 실행 권한은 명시적으로 제한하고 definer의 search_path는 빈 값으로 고정했다.
