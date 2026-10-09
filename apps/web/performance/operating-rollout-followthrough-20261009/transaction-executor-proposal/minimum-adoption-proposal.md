# Atomic migration executor: 최소 채택안 (미채택)

Source 편집·manifest 승인/pin·G037 규칙·운영 DB/env/queue/grants를 바꾸지 않은 isolated PG17.6 실험이다. Root가 shared runner와 adoption을 결정한다. Existing three manifest entries and pin `515743d0…` remain intact. Synthetic local managed-ledger rows are protocol fixtures, never an operating application receipt.

## 실제로 확인한 경계

- 기존 psql `--single-transaction` + process 밖 JSON equality: terminal mismatch에도 DDL은 commit된다.
- Source 내부 COMMIT 뒤 DDL 오류: 첫 DDL은 남고 ledger가 없는 partial state가 가능하다.
- SQL assertion을 동일 transaction의 COMMIT 전에 배치: mismatch, DDL 오류, ledger INSERT 오류 모두 DDL과 journal을 rollback한다.
- 실제 네 원본 SQL은 pinned statement-vector parser로 첫 BEGIN/끝 COMMIT만 확인했다. Execution view는 그 두 byte span만 제외하고 inverse가 원본 bytes와 정확히 같았다. Function body/anchors를 재작성하지 않았다.
- 실제 네 SQL + SQL terminal assertion + isolated `supabase_migrations.schema_migrations` INSERT: mismatch면 전체 schema/state/ledger rollback; 성공이면 version/name/원본 statement arrays 네 개가 함께 commit됐다. 기존 role/member/immutable manifest/legacy metadata는 같았다.
- Commit 뒤 client response를 소비하지 않고 소유 session만 끊었다. 새 connection의 ledger+terminal 조회는 committed를 확인했다. Post-COMMIT 오류의 nonzero exit도 committed였다. Automatic resend는 하지 않았다.
- 별도 writer `postgres`는 nonsuperuser이고 cloned managed ledger USAGE/INSERT는 있다. 그러나 G014 standalone assertions 4개의 EXECUTE는 모두 없다. Source M1/M3의 기존 private registration window 검사는 유지됐고, 전체 4종 검사 성공은 existing fixture inspector의 post-commit 증거다. Writer의 pre-commit 성공으로 바꿔 보고하지 않는다.

## 최소 구현 경로

1. **Shared runner apply core를 단일 SQL transaction owner로 교체.** 기존 3개 manifest 내용/승인 pin은 바꾸지 않는다. 기존 dry-run와 provider terminal-verification mode를 유지한다. Current workflow active/main/detached/manifest gates를 통과하기 전 credential/connection admission을 하지 않는다. 네 신규 migration은 정식 manifest 등록과 pin binding 전 실행 불가이다. Local bypass/active exception을 추가하지 않는다.
2. **Transaction admission은 connection 이전에 fail closed.** Source path/bytes/SHA는 manifest와 canonical checkout에 묶고 original statement vector도 보존한다. 알려진 네 파일에만 검증된 outer-BEGIN/COMMIT execution view를 허용하며 inverse-byte equality를 확인한다. Intermediate COMMIT/ROLLBACK/END/ABORT/START TRANSACTION, SAVEPOINT/RELEASE, PREPARE/COMMIT PREPARED 등은 거부한다. Dollar-quoted function/DO 본문의 BEGIN/COMMIT 문자열을 regex로 일괄 삭제하지 않는다. 현재 fixture의 lexical classifier는 known-hash four-file envelope 검증이며 generic SQL AST/security validator는 아니다. 더 넓은 source 지원은 typed transaction admission을 별도로 결정해야 한다.
3. **Prior와 terminal은 DB 안에서 검증.** Trusted, hash-bound 단일 SELECT 결과를 `EXECUTE … INTO STRICT`로 얻고 `::jsonb IS DISTINCT FROM <expected>::jsonb`이면 fixed exception을 발생시킨다. Zero/multiple rows, invalid JSON, extra/missing keys/value drift도 COMMIT 전에 실패해야 한다. Node의 외부 equality는 committed receipt consistency check이며 rollback mechanism이 아니다. Generated dollar tags/string quoting은 query/expected bytes와 충돌을 검사한다.
4. **Known four-source batch를 한 session/transaction에서 수행.** M1→M2→M3→forward127 dependency를 묶는다. M2 단독의 미등록 RPC/G014 gap을 외부에 commit하지 않는다. Ledger relation에 transaction-scoped lock을 잡고 fresh prior를 다시 확인한 후 source views·terminal guards·ledger INSERT·ledger equality guard를 완료한 다음 단 한 번 COMMIT한다. Model/worker/customer mutation은 실행하지 않는다. G037 provider/ingress quiescence는 이 ledger lock으로 대체할 수 없다.
5. **Managed ledger 원자성.** Current columns `version,name,statements`와 writer의 pre-existing schema/table privileges를 target에서 확인한다. Original source vectors를 기록하고 실행 view를 historical source로 바꾸지 않는다. Existing equal entry는 source+vector+terminal을 모두 확인한 별도 already-applied/reconcile disposition으로 처리한다. Equal-version/different content는 stop; UPSERT/overwrite/delete/repair하지 않는다. Writer 권한이 없으면 별도 지원되는 platform executor 결정이 필요하고 grant fallback은 없다. Fixture vectors use the existing G037 pinned parser contract; installed CLI semantic equivalence를 새로 입증했다고 주장하지 않는다.
6. **Ambiguity/reconciliation.** Secret admission/connection 전에 private durable attempt record를 source commit, manifest, batch/source/vector roots에 묶는다. COMMIT acknowledgement가 확정되지 않으면 outcome_uncertain으로 기록한다. Fresh read-only connection으로 exact ledger entries + terminal + invariant roots를 조사해 committed / not-applied / partial-conflict로 구분한다. Exit status만으로 rollback 또는 success를 결정하지 않는다. 자동 retry는 없고 uncertain attempt를 새 output path로 다시 쓰지 않는다. Credentials/DSN/raw provider errors는 argv/log/artifact에 넣지 않는 기존 custody 경계를 유지한다.

## Root가 결정할 작은 추가 범위

- **Four G014 pre-commit 요구가 있으면 shared runner만으로는 부족하다.** Postgres writer에 broad EXECUTE/role grant를 주지 않는다. 가장 좁은 후보는 *미적용* M1/M3의 기존 owner-controlled registration helper window 안에서 필요한 나머지 assertions를 호출하게 하는 source-bound 보완이다. 새 private grants/membership window/inspector API를 추가하는 대안은 이 실험에서 구현하거나 승인하지 않았다. Source hashes와 PG15 adapter/replay 및 PG17 checks는 그 경우 다시 묶어야 한다. 또는 atomic public-catalog terminal guards와 별도의 기존 privileged inspector readback을 다른 gate로 정확히 유지한다. Root가 요구하는 commit gate를 명시해야 한다.
- Batch/ledger contract를 existing V1 schema를 바꾸지 않고 executor-side exact-source profile로 둘지, 새 manifest version으로 둘지 root가 선택한다. 현재 승인 3개 내용/pin은 이 제안에서 불변이다. 네 source 등록은 adoption deliverable이지 fixture 성공이 아니다.
- Root fresh operating read-only: PG17.6, ledger80/latest `20261008124858`, four versions absent, policy OFF/version1/batch50/daily50, runs/items/active0, old manual `ec677876…` owner postgres/invoker/service-only/2s. M1/M2/M3 versions precede current latest: exact version absence and untouched existing ledger rows are required; simply rejecting/accepting by max(version) is wrong. Remaining M1/M3 G014/legacy/namespace/member/index preimages and writer/inspector privileges still need exact target binding.
- G037 active still excludes these four from ordinary apply. This prototype does not establish a thaw/exception, protected promotion, operating authorization artifact, frontend cutover or physical rollback path.

## Acceptance for adopted implementation

Keep current 3 manifest/pin and freeze checks. Add tests for server-side prior/terminal false/invalid/multi-row; both DDL and ledger failure; top-level transaction aliases/nested quote boundaries and inverse bytes; actual four-source rollback/ledger source-vector equality; competing same-version executions; committed/no-commit/partial reconciliation with response loss; source/manifest/privilege drift; old provider verification compatibility. If parent chooses extra private assertion placement, verify exact no-extra-ACL/member roots and four G014 before commit in the actual admitted principal. No source edits have been made here.
