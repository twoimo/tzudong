# 아키텍처와 목표 감사 — 2026-09-21

관찰 기준: 2026-09-21, Asia/Seoul. 대상은 현재 워크트리의 로컬 실행과 명시적 호스티드 개발 읽기 경로다. 이 문서는 로컬 코드·테스트·실행 readback을 묶은 감사 기록이며, 호스티드 쓰기·배포·production 승격의 영수증이 아니다.

## 현재 판정

| 영역 | 판정 | 직접 확인한 근거 | 남은 경계 |
| --- | --- | --- | --- |
| 로컬 MLX | 통과 | `health` 200, `/v1/models`에서 Qwen 텍스트와 Krea 이미지 모델 `loaded: true`; 실모델 smoke artifact와 5장면 자산 readback | 장시간 메모리 압박·swap 스트레스는 측정하지 않음 |
| 큐·lease | 통과 | 원자적 claim, 120초 DB lease, heartbeat, 만료 회수, 단일 활성 프로젝트/워커 제약; 관련 계약 테스트와 로컬 DB 상태 readback | 동시성 통합 테스트의 최신 재실행 receipt는 별도 보관하지 않음 |
| FSM | 통과 | 프로젝트 `waiting_worker → generating → ready/partial/failed/cancelled`와 job `queued → claimed → succeeded/failed/cancelled` 스키마·lifecycle 다이어그램·현재 상태 readback | 모든 상태 조합을 한 번에 검증하는 운영 stress run은 없음 |
| 메모리 admission | 보류 후 안전 종료 | `used + additionalPeakEstimate + reserve ≤ physical`, reserve `max(16 GiB, 12.5%)`; 실제 워커 실행이 claim 전에 `memory_deferred` 반환 | 실제 peak/RSS와 swap의 인과 추정은 미검증 |
| 지도·피드 | 통과 | 5종 필터 UI와 source contract, `fan-signal` 동일 영상 기준 회귀 테스트, 호스티드 개발 `/feed` 브라우저 readback | GPS 권한 승인과 실제 위치 제공은 수행하지 않음 |
| 로컬에서 호스티드 피드 읽기 | 통과 | 명시적 `dev:hosted` 서버의 `/feed`에 호스티드 인증 리뷰 2개와 `쯔동마스터` 표시, `Nightly CI` 미표시 | 호스티드 쓰기·자동 동기화·배포는 별도 작업 |

## 실행 경로와 계약

### MLX와 이미지 자산

- `apps/web/lib/admin/storyboard/mlx-transport.ts:11-119`는 literal loopback origin만 허용하고 DNS, proxy 환경변수, redirect, 원격 IP를 거부한다. 허용 API는 `/health`, `/v1/models`, `/v1/chat/completions`, `/v1/images/generations`뿐이다.
- `apps/web/lib/admin/storyboard/mlx-client.ts:64-127`는 모델 catalog와 capability를 확인한 뒤 텍스트 JSON schema 응답과 이미지 base64를 검증하고, 응답 모델이 선택 모델과 다르면 저장하지 않는다.
- `apps/web/lib/admin/storyboard/outbound-worker.ts:228-395`는 claim 후 heartbeat를 유지하고 텍스트를 먼저 저장한 뒤 장면 이미지를 하나씩 처리한다. 이미지 checkpoint가 불확실하면 blind retry나 다음 claim을 하지 않는다.
- `apps/web/.omx/artifacts/storyboard-mlx/2026-09-20T17-43-21-269Z/receipt.json`은 로컬 MLX socket readback과 외부 AI 비활성 상태를 보존한다. 같은 작업의 `draft.json`과 `assets.json`에는 Qwen 텍스트 provenance, Krea 이미지 provenance, 5장면의 PNG 원본과 WebP 파생 정보가 있다.

실행 당시 `/v1/models` readback은 다음 두 모델을 loaded로 반환했다.

- `ddalcu/Qwen3.8-Flash-Next-MLX-Serve-mixed-4-8bit`: `chat` 포함
- `ddalcu/Krea-2-Turbo-MLX-Serve-mixed-4-8`: `image`

### 큐, lease, checkpoint

- `backend/supabase/migrations/20260918021531_storyboard_mlx_worker.sql:10-76`은 project, worker, job, asset, event 테이블과 `one_active_project`, `one_active_worker` partial unique index를 만든다.
- 같은 migration의 `:349-506`은 worker RPC의 lease 검증, expired lease 회수, `FOR UPDATE SKIP LOCKED` claim, revision/scene version 확인, draft/image/scene-error/finish checkpoint를 DB clock으로 처리한다.
- `apps/web/lib/admin/storyboard/production-store.ts:256-320`은 restore/edit/import의 CAS와 busy 검사를 DB RPC에 맡기고, worker checkpoint 전후에 strict schema와 provenance를 다시 검증한다.
- `apps/web/tests-unit/storyboard-outbound-worker.test.ts`와 `apps/web/tests-unit/storyboard-production-api.test.ts`는 claim, heartbeat loss, late result, uncertain delivery, cancellation, retry, asset cleanup과 export 검증을 다룬다.

현재 로컬 DB readback은 다음과 같다.

```text
project: revision 8 / ready / 5 scenes / 5 images / 5 asset rows / 9 events
cancelled job: stage=cancelled / error_code=generation_cancelled
worker: enabled / not revoked / model catalog 5 entries
storage: storyboard-private bucket 10 objects
```

수동 가져오기 프로젝트는 텍스트 import → 5개 이미지 import → 편집 → 버전 readback → 복원 → export 순서로 확인했고, 마지막 project 상태가 revision 8 `ready`였다. 이 경로는 모델 생성 성공과 구분되는 import/readback 증거다.

### FSM과 복원

- API 상태 schema는 `apps/web/lib/admin/storyboard/production-store.ts:45-99`에 있고, 프로젝트 상태와 job 상태를 각각 bounded enum으로 파싱한다.
- `docs/architecture/storyboard-local-mlx/storyboard-local-mlx.lifecycle.json:27-239`는 `queued`, `generating`, `awaiting_import`, `partial`, `ready`, `lease_expired`, `failed`, `cancelled`와 명시적 retry/reclaim 전이를 보여준다.
- `docs/architecture/storyboard-local-mlx/storyboard-local-mlx.workflow.json:43-207`는 생성 경로와 복원 경로를 분리한다. 복원은 모델 호출이나 새 job 없이 새 revision을 기록한다.
- `apps/web/lib/admin/storyboard/production-store.ts:256-320`의 restore preflight와 `backend/supabase/migrations/20260920021531_storyboard_historical_restore.sql`의 immutable snapshot/RPC가 자산 bytes, owner, CAS, replay를 함께 확인한다.

### 메모리와 큐 대기

- `apps/web/lib/admin/storyboard/resource-invariants.ts:12-50`은 reserve를 `max(16 GiB, physical × 12.5%)`로 계산하고, queue wait를 `W[i+1] = max(0, W[i] + S[i] - A[i])`로 계산한다. live worker가 없으면 wait는 `null`이다.
- `apps/web/lib/admin/storyboard/outbound-worker.ts:189-225`는 host-wide `os.freemem()`을 기본으로 사용하고, explicit RSS fallback에서만 model residency를 한 번 더 포함한다. admission은 claim보다 먼저 실행된다.
- 로컬 워커를 현재 앱에 `--once`로 실행한 readback은 다음 두 줄이었다.

```text
{"event":"worker_started"}
{"event":"memory_deferred"}
```

따라서 메모리 여유가 부족한 상태에서 job을 claim하지 않는 fail-safe 동작은 실제 runtime에서 확인했다. 이것은 메모리 압박의 peak 수치나 향후 생성 성공을 보장하지 않는다.

## 지도·피드와 호스티드 개발 읽기

- `apps/web/components/feed/FeedContent.tsx:252-358`은 verified `reviews`를 먼저 읽고, user id를 `readPublicProfileSummariesLookup`으로 보내 작성자 표시를 완성한다. `profiles` 테이블을 public join으로 노출하지 않는다.
- `backend/supabase/migrations/20260920171524_public_profile_summary_read_boundary.sql:128-315`은 `read_public_profile_summaries(uuid[])`를 bounded `SECURITY DEFINER` read boundary로 만들고, `profiles` 직접 SELECT는 anon/authenticated/service_role에 계속 거부한다. 탈퇴 닉네임은 RPC 결과에서 제외한다.
- `apps/web/lib/home-map-theme-filters.ts:226-262`는 `fan-signal`의 조회수 baseline과 댓글 비율을 같은 YouTube metadata 항목에서 계산한다. 서로 다른 영상의 조회수와 댓글 비율을 조합하는 회귀를 제거했다.
- `apps/web/tests-unit/home-map-theme-filters.test.ts:190-217`는 작은 고비율 영상 제외와 동일 영상 baseline 적용을 검증한다. 다섯 필터의 이름과 metric 계약도 같은 파일에서 검증한다.

명시적 호스티드 개발 서버에서 브라우저 readback은 다음을 보였다.

```text
URL: http://127.0.0.1:3000/?panel=feed  (사용자가 연 /feed가 이 상태로 해석됨)
heading: 리뷰 (2개)
restaurants: 데일리픽스 강남본점, 스시린 불당본점
authors: 쯔동마스터
absent: Nightly CI
```

기본 로컬 서버 `http://127.0.0.1:18080/?panel=feed`는 별도 loopback Supabase 스택을 사용하며 같은 시점에 `리뷰 (0개)`였다. 이것은 hosted readback 실패가 아니라 두 데이터 경계를 분리한 결과다. 호스티드 데이터를 로컬 브라우저에서 보려면 저장소 루트의 owner-only `.env.local`에 필요한 값을 두고 `apps/web`에서 `bun run dev:hosted`를 사용한다. 기본 `bun run dev`는 hosted fallback을 하지 않는다. 이 계약은 `apps/web/README.md:24-50,110-118`, `apps/web/scripts/dev-prewarm.mjs:19-55`에 적혀 있다.

GPS는 `apps/web/tests-unit/device-location-privacy.test.ts`의 readiness와 destination gate, 기존 브라우저 검수의 `DEVICE_LOCATION_OPERATOR_EVIDENCE_REQUIRED` 결과까지만 확인했다. 브라우저 위치 권한을 승인하거나 실제 좌표를 전송하는 검증은 수행하지 않았다.

## 검증 결과

현재 변경 집합에 대해 다음을 다시 실행했다.

```text
cd apps/web
bun test tests-unit/storyboard-resource-invariants.test.ts \
  tests-unit/storyboard-outbound-worker.test.ts \
  tests-unit/storyboard-production-api.test.ts \
  tests-unit/admin-storyboard-async-jobs-contract.test.ts \
  tests-unit/admin-storyboard-history.test.ts \
  tests-unit/storyboard-local-egress.test.ts \
  tests-unit/storyboard-mlx-provider.test.ts \
  tests-unit/home-map-theme-filters.test.ts \
  tests-unit/public-profile-read.test.ts \
  tests-unit/nightly-profile-read-rpc-boundary.test.ts \
  tests-unit/local-supabase-runtime.test.ts \
  tests-unit/nightly-regression-workflow.test.ts
# 187 pass, 0 fail

cd ../..
python3 -m unittest \
  backend.supabase.tests.test_local_function_runtime_contract \
  backend.supabase.tests.test_local_publication_verifier \
  backend.supabase.tests.test_local_replay_contract \
  backend.supabase.tests.test_local_seed_receipt_contract
# Ran 93 tests ... OK
```

추가 runtime readback은 다음과 같다.

- `backend/supabase/volumes/.local-stack/tzudong-local-ab5bc03b76d9/last-receipt.json`: `ok=true`, 14 services `running`; 12개는 health `healthy`, functions/rest는 health 문자열 없이 running.
- 같은 stack의 `local-receipt-v1.json` content는 `local-receipt-v2`, migration ledger 99개(`applied` 96, `verified-existing` 2, `legacy-contract-preserved` 1)다.
- 현재 앱 `127.0.0.1:18080`의 `/api/health`, `/`, `/feed`는 각각 HTTP 200이다.
- `git diff --check`는 공백 오류 없이 종료했다.

## 미검증 항목과 완료 경계

- 호스티드 DB migration 적용과 public profile RPC ACL은 읽기 경로에서 확인했지만, 호스티드 쓰기·Auth identity 변경·자동 동기화·production 배포·보호 브랜치 승격은 수행하지 않았다.
- 호스티드 피드의 카드와 사진 요소는 브라우저 DOM에 존재하는 것을 확인했지만, 호스티드 Storage 객체의 원본 bytes/hash를 별도 다운로드 readback하지 않았다.
- `memory_deferred`는 admission이 보수적으로 작동했다는 증거다. 실제 RSS peak, swap 감소, 여러 작업의 장시간 안정성은 별도 측정이 필요하다.
- GPS는 위치 권한 승인 없이 fail-closed 계약만 검증했다.
- 이 문서의 로컬 MLX 성공 증거는 local model/API와 manual import의 결과다. 외부 ChatGPT/Grok API 성공이나 외부 모델 전환을 의미하지 않는다.
