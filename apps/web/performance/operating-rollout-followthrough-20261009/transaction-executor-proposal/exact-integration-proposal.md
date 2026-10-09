# 정확한 최소 통합 위치 — root adoption 전

남은 runtime 실험/실행 handle은 없다. 10개 transaction 실험, 실제 네 source의 atomic execution-view/managed-local-ledger rollback·성공, 실제 client cut 후 fresh reconciliation이 완료됐다. 운영 성공이나 approved executor adoption으로 보고하지 않는다.

## 제안 파일 범위

1. 작은 **pure helper** `apps/web/scripts/supabase-migration-transaction.mjs` 하나. 새 CLI/daemon/executor framework/manifest를 만들지 않는다. 다음만 담당한다.
   - Hash-bound original bytes + 기존 pinned statement vector → transaction-control admission 및 execution view. None 또는 정확한 paired outer BEGIN/COMMIT만 지원; 중간 controls 거부; inverse byte equality.
   - 기존 manifest의 `expectedPriorState.query/expected`, `terminalReadback.query/expected` → bounded server-side `EXECUTE … INTO STRICT` + JSONB equality/fixed exception SQL. Trusted query/tag collision 검증.
   - 미래 **정식 등록된** 네 path/hash profile에만 원본 version/name/statements ledger INSERT와 exact equality SQL. 이 profile은 approval을 대체하지 않는다.
2. 기존 `apps/web/scripts/apply-supabase-migration.mjs`의 caller 수정.
   - `loadReviewedMigration` digest 검사 뒤 `:314`–`:321`: 원본 bytes를 보존하고 source/vector/envelope를 준비할 재료를 반환. Existing manifest lookup/path/digest gates 앞에서 실행하지 않는다.
   - `applyMigrationWithTerminalReadback` `:431`–`:443`: 기존 `runPsql(..., true)`의 **단일 transaction**을 그대로 사용하되 payload를 `ledger lock + prior SQL guard + admitted execution view + terminal SQL guard + applicable ledger INSERT/guard + terminal JSON output`으로 바꾼다. Payload에는 처리하지 않은 BEGIN/COMMIT이 없고 psql -1이 유일한 transaction owner다. Node equality는 redundant receipt consistency check만 맡는다.
   - `main` apply branch `:501`–`:506`: 밖에서 prior를 읽고 나중에 apply하는 경계를 제거한다. Same-connection locked prior/terminal 검사로 위 caller를 호출한다. Existing provider-owned denial `:473`–`:479`, dry-run와 provider verify-terminal branch는 그대로 둔다.
   - `runPsql` `:341`–`:380` 및 apply catch: connection/commit acknowledgement가 확정되지 않는 failure는 rollback이라고 단정하지 않는다. 자동 resend 없이 fresh **read-only** exact ledger+terminal reconciliation만 시도한다. Not-applied/committed/partial-conflict/unknown을 fixed result로 구분한다. Credential/provider diagnostics custody와 current transport deny rules를 유지한다.
3. 기존 migration apply unit tests와 본인 isolated fixtures만 관련 검증을 추가한다. 새 package/runtime는 필요 없다. Statement vector는 기존 `backend/supabase/scripts/g037_supabase_statement_vector.mjs` CLI 계약을 재사용하고 G037 parser/controller를 수정하지 않는다.

## 현재 승인 3개와 G037 불변

- `.github/supabase-migration-release-manifest.v1.json`, pin `515743d0…`, workflow active/main/detached/concurrency guards는 수정하지 않는다.
- Current three entries의 metadata와 provider verification semantics는 유지한다. Generic refresh-history apply에는 server-side prior/terminal rollback fix를 적용하고, 두 provider-owned G016은 지금처럼 direct apply를 거부한다. 기존 historical ledger를 새로 덮어쓰지 않는다.
- 네 신규 source의 ledger profile은 **나중에 manifest에서 정식 lookup된 경우에만** 켜진다. Current manifest에는 없으므로 지금은 여전히 `MIGRATION_ID_NOT_ALLOWLISTED`/active-freeze blocked다. Source helper가 이를 허용하는 새 입구는 없다. 실제 적용 문제를 이 단계에서 닫았다고 보고하지 않는다.
- Target roles/ledger columns/USAGE/INSERT/lock privileges와 original vector semantics를 fresh target preimage에 묶는다. Root fresh ledger80/latest20261008124858에서 missing M1/M2/M3는 max(version)보다 낮지만 absent이다. Explicit four-version/old-row preservation을 검사한다.

## Actor 경계

현재 clone의 nonsuperuser postgres는 managed-ledger USAGE/INSERT를 갖지만 4 G014 assertion EXECUTE는 없다. Shared helper에 role grant/SET ROLE/private inspector API를 넣지 않는다. M1/M3의 source 내부 기존 owner-controlled 검사와 외부 기존 privileged inspector의 4종 readback을 다른 gate로 기록한다. Root가 4종 **모두 pre-commit**을 요구하면 미적용 M1/M3의 기존 등록 helper 안 검사 보완을 별도 결정해야 하며, 이 최소 shared-runner adoption에 새 grant를 숨기지 않는다.

## 완료된 runtime 근거

`transaction-runtime.json`: 10개 legacy/proposed mismatch, DDL/ledger failure, mid-COMMIT, commit 이후 nonzero exit, source-version collision.
`admission-batch-runtime.json`: actual four source hashes/vectors/inverse bytes, whole schema/state/managed-local-ledger rollback, successful four-entry original vectors; old roots preserved.
`response-loss-runtime.json`: client가 살아 있고 own backend가 active인 상태에서 commit visibility 확인 후 client/session을 종료; fresh connection committed readback; resend 없음.
`executor-principal-admission.json`: existing writer/inspector 권한 경계. 실패 기록들도 보존했다.
