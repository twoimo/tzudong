# Guarded records SQL 운영 적용 준비안 — 2026-10-09

읽기 전용 준비안이다. 현재 사용자 권한은 유지하며 새 승인을 요청하지 않는다. Manifest 승인 내용, 운영 DB/ledger, env, freeze, grants, queue, 배포와 branch promotion은 변경하지 않았다. Source-only canonical PG15와 isolated PG17 성공은 운영 반영 증명이 아니다.

## 현재 등록과 정확한 경계

현재 `.github/supabase-migration-release-manifest.v1.json:3`에는 `restaurant_refresh_history`, `g016_privacy_audit_owner_policy`, `g016_onboarding_confirmation_freshness` 세 항목만 있다. Manifest SHA와 workflow의 승인 pin은 `515743d094b4b431a29df772a363837bdad8f7541aa3acf4a923efb79f460c0d`로 같다 (`.github/workflows/supabase-migration-apply.yml:32`). 다음 네 SQL은 **등록되지 않았다**. 따라서 등록 ID·path·SHA·expectedPriorState·terminalReadback가 아직 없다. Pin을 바꾸거나 기존 G016 ID를 재사용하지 않았다.

| 순서 | 미적용 source | SHA-256 |
| --- | --- | --- |
| M1 | `20261004190259_admin_record_guarded_actions.sql` | `b373b7ea472c0352a33a4d4043cf8d6aa8474c04cc1ca5778805edfa77ac9c95` |
| M2 | `20261004192657_admin_evaluation_raw_warning_groups.sql` | `66eace1d6fb0dd55c1d780776bab855cc37690335ad40b0fdc1294c610e07d3a` |
| M3 | `20261004194715_admin_evaluation_raw_warning_invoker_contract.sql` | `e1c105df82c4f814d3e6adad807ff9d072b8cd42ae770b4b78f75b89a9387020` |
| forward127 | `20261009022915_restaurant_review_manual_preview_eligibility.sql` | `8acf6d1428764260ed57dac5fe09711868a82896f0a6d631d502128004c168a3` |

경로는 모두 `backend/supabase/migrations/` 아래다. 승인된 manifest pin을 인자로 전달한 source-only loader는 세 기존 항목을 검증했고 네 proposed ID에는 `MIGRATION_ID_NOT_ALLOWLISTED`를 반환했다 (`apps/web/scripts/apply-supabase-migration.mjs:199`). 최초 local CLI dry-run은 workflow env를 상속하지 않아 `MIGRATION_MANIFEST_DIGEST_INVALID`로 연결 전에 종료했다 (`:139`); 이 결과는 live GitHub 설정 누락을 뜻하지 않는다.

G037 active에서 `.github/workflows/supabase-migration-apply.yml:111`은 두 기존 G016 ID만 예외로 허용하고, `:113`에서 그 예외도 terminal verification만 허용한다. 네 신규 SQL은 ordinary apply뿐 아니라 이 job의 verify-terminal dispatch도 막힌다. G037 controller는 고정 G034 29개 manifest만 취급한다 (`backend/supabase/docs/g037-hosted-closure-runbook.md:7`). 네 SQL은 그 목록에도 없다. Local owner DSN으로 generic script/psql을 직접 호출하는 것은 active workflow 제한을 우회하는 방법이며 지원 절차로 제시하지 않는다.

G037의 supported 경로는 정확한 기존 29개 계약에 대한 source validate, bounded read-only modes, 별도로 묶인 local controller prepare/finalize/validate/rehearse/execute/reconcile이다 (`runbook:5`, `:85`, `:94`, `:95`). 이것을 네 SQL에 재사용하거나 selected manifest를 임의로 확장할 수 없다. Freeze는 G038까지 유지한다 (`:77`; `g038-account-deletion-successor-runbook.md:25`, `:51`). 이 감사에서는 네 SQL을 적용하기 위한 generic thaw/exception transition이 확인되지 않았다. 따라서 지금 허용되는 일은 source·manifest 준비와 읽기 전용 검증이며, 네 SQL의 운영 apply는 기술적으로 아직 열리지 않았다.

## Root가 마무리할 기술 조건

1. `docs/agents/release.md:5`의 보호된 `develop -> data -> main` 순서를 유지하고 exact protected-main SHA에 source, SQL hashes, manifest 항목과 workflow manifest pin을 함께 바인딩한다. Standing user authorization을 다른 확인 질문으로 대체하지 않는다.
2. Supported freeze transition을 먼저 확정한다. G037/G038 기록·continuity를 유지해야 하며 변수 `active`를 임의로 바꾸거나 네 SQL을 G016 예외로 넣지 않는다. 기존 계약으로 네 SQL이 선택되지 않는다는 제약을 root가 실제 실행 설계에 반영해야 한다.
3. 정확한 target/version과 **fresh** operating read-only preimage를 얻어 expectedPriorState를 작성한다. 과거 ledger 80, env 24 production/36 전체, production f319 관측은 locator이며 현재 전제값이 아니다. Ledger의 네 version 부재, M1 객체 부재, M2 RPC 부재, G014 assertion/legacy RPC body·owner·ACL·allowlist, role/member/immutable manifest roots, composite identity index, forward127의 old manual/preview body hashes와 metadata, revision singleton 존재를 묶는다. Revision 없는 pristine schema는 helper가 stale로 거부하며 임의로 운영 singleton을 생성하지 않는다.
4. Postimage는 M1 service-only new RPC·세 operation/audit/cleanup tables·RLS/fences, 기존 legacy authenticated/service ACL 보존, M2 raw RPC exact body, M3 allowlist/G014 등록, forward127 manual/preview exact body 및 private fixed-lock helper의 postgres owner/빈 search_path/2s timeout/owner+service EXECUTE/browser deny를 검증한다. 기존 table/schema/function ACL과 role/member/immutable manifest 불변도 비교한다. M2 직후에는 새 RPC 등록이 아직 M3에 없으므로 complete G014 checkpoint는 M3 이후에 둔다. 전환 사이를 일반 가용 상태로 취급하지 않는다.
5. SQL execution/ledger/rollback 경계를 명시한 supported executor를 확정한다. 현재 generic script는 manifest 단일 ID만 처리하고 (`apply-supabase-migration.mjs:203`), source SQL 뒤 terminal query를 붙여 psql `--single-transaction`으로 호출한 다음 JSON equality를 process 종료 후 검사한다 (`:341`, `:431`). 네 파일은 각각 내부 `BEGIN/COMMIT`이 있으므로 source `COMMIT`이 outer transaction을 끝낼 수 있고, JSON mismatch가 이미 commit된 DDL을 undo하지 않는다. 또한 이 runner에는 `schema_migrations` INSERT가 없다. Local 실험의 outer BEGIN/ROLLBACK는 파일의 outer BEGIN/COMMIT만 제거한 isolated verification이었다. 이것을 literal multi-file operating atomic rollback/ledger proof로 사용하지 않는다. 임의 ledger insert/repair로 통과시키지 않는다.
6. Held deployment와 target old-schema read compatibility를 확인한 뒤 필요한 maintenance 창에서만 전환한다. SQL·frontend·deployed SHA·실제 env/instance generation·authenticated API·SQL readback·audit를 서로 다른 gate로 기록한다. 실제 config 변경은 기존 인스턴스나 진행 중 SQL을 자동으로 갱신/중단하지 않는다. Readback 성공 전에는 hold/media admission을 열지 않는다.

## Additive 호환성과 hold

현재 M1은 세 legacy RPC의 authenticated/service EXECUTE와 authenticated allowlist를 **보존하고 exact preimage를 검사**한다 (`M1:643`–`:657`). 이전 `rollout-and-rollback-audit.json`과 `admin-record-actions-contract.md`의 즉시 retirement 서술은 역사적 원본 SQL에 대한 설명이다. 현재 SQL에 은퇴가 채택됐다고 해석하지 않는다. Retirement proposal/index convergence proposal은 별도 미채택 상태이며 최신 body/hash와 actual consumer cutover/readback에 다시 묶어야 한다.

Additive ACL이 기존 기능 성공을 보장하지는 않는다. 실제 PG17 before/after의 세 old authenticated RPC는 preexisting private `is_user_admin` helper EXECUTE denied(42501)를 관측했다. 컬럼 이후 단계까지 실행됐다고 주장하지 않는다. 이 준비안은 legacy owner helper grants를 추가하지 않는다. f319의 direct browser submission/merge consumers는 새 `/api/admin/record-actions` server hold를 통과하지 않는다. Old cached clients와 external/direct DB writers는 별도 ingress/quiescence 경계다.

신규 POST는 `ADMIN_RECORD_MUTATIONS_HOLD === 'cleared'`만 허용하며 unset/다른 값은 held다 (`apps/web/lib/admin/record-action-admission.ts:4`). Auth와 same-origin 확인 후 privileged transport 전에 검사한다 (`record-actions/route.ts:20`, `:22`; `media-cleanup/route.ts:14`, `:16`). GET readback은 유지한다 (`record-actions/route.ts:29`). 이 hold는 새 POST 진입만 막고 이미 진행 중 transaction, old browser RPC, 자동 worker·외부 쓰기를 멈추지 않는다. 자동검수의 service-role stop은 이제 fixed private revision lock을 사용하고 queued/running 취소·worker cancelled/disabled readback을 보존하지만, source/isolated 성공을 실제 운영 stop 완료로 간주하지 않는다.

## Rollback와 partial state

Commit 이전의 bounded SQL failure는 해당 transaction의 rollback으로 확인한다. 여러 파일의 일부 commit이나 terminal mismatch/연결 모호성이 있으면 holds/fence를 유지하고 fresh catalog/ledger와 operationId GET readback부터 확인한다. 실패한 POST를 자동 재전송하거나 migration ledger/archive를 지우지 않는다. Partial state에 대한 reviewed fix-forward가 기본 복구 방향이다.

Committed M1에는 operations/audit/cleanup 상태와 storage reference/object fences가 생긴다. Audit의 before/after는 fingerprint이며 전체 undo image가 아니다 (`M1:12`, `:579`). 이미 실행된 사용자 변경은 source-truth/CAS-bound 보상 작업이 필요하고 물리 Storage 삭제는 frontend rollback으로 복구되지 않는다. forward127을 과거 manual body로 되돌리면 service-role의 revision FOR UPDATE 42501 공백도 되살아난다. Applied SQL 수정이나 즉흥 DROP/ACL 복구는 제안하지 않는다.

마지막 관측된 production rollback locator는 `f31904e6dca2d9b608259cf150c5d0894db0928e`이며 이번 감사에서 live alias를 다시 조회하지 않았다. 그 source의 RAG worker는 `BAAI/bge-m3`, 1024 dimension과 `BAAI/bge-reranker-v2-m3`를 요구한다 (`apps/web/lib/admin/storyboard/rag-worker-client.ts@f319:34`, `:35`, `:89`, `:133`, `:152`). 따라서 raw f319 rollback을 Gemini-only라고 부를 수 없고 이전 build/env/cron 및 legacy API 부족도 남는다. Policy-safe fallback은 held/read-only compatibility deployment 또는 현재 Gemini/guarded 계약을 보존하는 fix-forward를 준비하고 실제 deployed SHA/URL을 read back하는 것이다 (`docs/agents/release.md:9`). 이 문서는 새 BAAI 호출이나 배포/rollback을 실행하지 않는다.

## 증빙 연결

- `apps/web/performance/operating-rollout-followthrough-20261009/release-readiness-refresh/audit.json`: source hashes, 네 manifest 미등록, source-only validator fixed codes, freeze/transaction/ledger 제한.
- `apps/web/performance/record-review-fixes-20261009/pg15/head-99b12562/final-verification.json`: clean 99b source, PG15.8 두 replay와 56 artifact 비교 성공.
- `apps/web/performance/record-review-fixes-20261009/final-receipt.json`: 실제 isolated PG17 service-role run/stop/actor/CAS/timeout/G014/rollback.
- `apps/web/performance/pr-review-followthrough-20261009/remaining-runtime-proof.json`: actual category/deferred/worker/fingerprint/one-batch 증빙. Synthetic judgment DTO이며 provider invocation/quality/performance 증거가 아니다.
