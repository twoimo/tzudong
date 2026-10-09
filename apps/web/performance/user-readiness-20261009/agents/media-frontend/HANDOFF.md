PR #3147 media/frontend 인계 — 2026-10-09

시작 기준은 `6d12ce81e6f6e9c8b2e3a321cfc6d5f6eca93391`이다. 작업 중 parent의 disjoint readiness 진단 커밋으로 공유 HEAD가 `08ef6d5928edad2bafe38bbd0502519e2b833d27`로 이동했다. 이 작업은 commit/push, 실제 계정·리뷰·Storage·DB·SDK·브라우저·휴대폰 작업을 하지 않았고 SQL/Auth/stamp/lock/catalog 파일을 편집하지 않았다.

완료 범위:

- **LU1, kbZ4, lJCY:** private verification은 canonical/legacy/동일 origin의 authoritative URL을 소유 key로 해석하고 private bucket을 먼저 읽은 뒤 pre-migration public bucket으로 호환 조회한다. 리뷰 삭제 cleanup은 verification key를 private와 public 양쪽에서 제거하고 부재를 확인한다.
- **LU5, LU8:** frozen media operation의 실제 `edit`/`delete` kind를 UI retry에 유지한다. 확정된 missing upload만 취소할 수 있고, 이미 업로드된 sibling은 기존 durable cleanup queue에 성공적으로 기록된 뒤에만 operation을 해제한다. 불확실 write/key는 그대로 frozen 상태다.
- **knIZ, sOjm:** OCR 교체는 authoritative 원문을 owned key로 normalize하고 실제 download source bucket에서 이전 객체를 제거한다. DB 미디어 참조가 바뀌는 트랜잭션의 `OLD` key durable queue는 SQL worker의 `review_media_private.enqueue_removed()` AFTER UPDATE trigger에 맡긴다. transport 오류는 rollback으로 간주하지 않으며 replacement key를 보존한다.
- **kyLC:** receipt 입력/준비는 JPEG, PNG, WebP, AVIF만 허용한다.
- **lDIl:** local nightly Storage probe와 publication allowlist가 실제 canonical `<owner>/reviews/<review>/food/<file>` key를 사용한다.
- **sd9C:** 완전한 compensation 뒤 다음 등록은 새 review UUID/key를 만들고, commit 가능성이 불확실한 operation은 기존 UUID/key를 유지한다.
- **SQL 최종 목록 계약:** `ReviewEditModal`은 검증된 canonical/legacy/동일 origin public 값의 원문 문자열을 표시·총개수·draft·`p_food_photos` 최종 목록에 그대로 유지한다. Storage 접근용 key 해석과 새 upload key를 분리했고 명시적으로 제거한 기존 값만 최종 목록에서 빠진다. `review_media_upload_allowed(text,text)`는 UI에서 호출하지 않는다.
- **sd9K consumer:** guarded admin cleanup consumer는 `review-photos`와 `review-verifications` job을 bucket 그대로 제거하고 각각 부재 readback한다. private bucket에서 food path는 거부한다. verification의 private/public 두 job을 모두 처리하는 회귀 검사를 추가했다.

남은 직렬 통합 의존성:

- OCR durable reconciliation은 SQL worker의 authoritative AFTER UPDATE/DELETE enqueue trigger와 함께 반영되어야 한다. frontend source test만으로 DB 트랜잭션 동작은 증명하지 않는다.
- 기존 guarded admin SQL `cleanup_read` producer가 verification cleanup에 `review-verifications`와 legacy `review-photos` job을 모두 생성하도록 purpose별 bucket을 연결해야 한다. TS consumer/route는 두 bucket을 처리하지만 SQL worker handoff 기준 producer는 아직 `review-photos` 고정이다. 이 작업에서는 guarded SQL을 수정하지 않았다.
- parent가 변경된 SQL과 함께 PG15/PG17 replay, full suite/build/browser/SDK를 수행해야 한다.

검증:

- Node `v24.21.0`, Bun `1.4.0`.
- focused unit 11개 파일: **178 pass, 0 fail, 2151 expect**.
- 변경 source/test 22개 파일 focused ESLint `--max-warnings=0`: 통과.
- `git diff --check`: 통과.

