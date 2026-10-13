# Readiness11 release 후보 — 운영 실행 없음

기준 HEAD: `03cd3c8c93041b0835f55943f76ff058c4620a88`.
이 패킷 디렉터리만 파일을 변경했다. 원본 36개 파일은 byte/SHA 재검증했고 Git refs, 179f, 다른 패킷, 외부 credentials/.env, hosted DB/Storage/배포/producer/설정/휴대폰은 건드리지 않았다.

## 부모가 통합할 변경

`source.patch`는 다음 5개 경로만 변경한다. `candidate/`는 원본 의존 소스를 포함한 실행 가능한 축소 사본이며 전체를 복사하는 배포물이 아니다.

- `.github/workflows/supabase-migration-apply.yml`: 동일 concurrency 아래 `readiness_validate`, `readiness_apply` 추가. main / 정확한 detached SHA / 고정 manifest 재검증. 기존 apply job과 G016 두 terminal-only 예외는 그대로다.
- `.github/supabase-readiness-release-manifest.v1.json`: 11개 source bytes/SHA/vector digest, payload, caller 의존 소스, 사전·최종 catalog, 기존 ledger prefix의 별도 고정 manifest.
- `apps/web/scripts/readiness-release.mjs`: 원본 `migrationEnvelope`와 canonical statement vector parser 재사용. 단일 transaction·ledger lock, 11개 원본 version/name/statements 삽입, 사전·최종 비교와 불확실 COMMIT reconciliation.
- `apps/web/scripts/apply-readiness-release.mjs`: 원래 direct DB 환경 전송/psql 안전 함수 재사용. 정확한 보호 경로와 project binding, 고정 오류 코드만 출력. Management credentials fallback 없음.
- `backend/supabase/release-bundles/readiness11-v1.sql`: 검증된 bundle의 동일 byte 사본. canonical migrations 추가 없음. 실행 시 검증한 BEGIN/COMMIT만 제거하고 나머지 byte는 보존한다.

`workflow.patch`는 workflow만 별도로 검토할 때 사용한다. `source.patch`와 중복 적용하지 않는다. 기존 generic manifest pin `515743d094b4b431a29df772a363837bdad8f7541aa3acf4a923efb79f460c0d`를 유지한다. 새 경로의 고정 ID는 `review_media_readiness11_v1`이며 G037은 **active 그대로**다. 다른 producer/deletion/retention hold를 바꾸는 파일이나 경로는 없다.

## 원장과 상태

- 0개 원장 + exact prior만 적용한다. 기존 prefix count/digest와 전체 원장 구조도 검사한다.
- 일부 존재, vector/name 불일치, 예상 외 구조/trigger, catalog drift는 fail closed.
- 11개 원장이 모두 정확하고 final이 일치하면 최초 read-only transaction으로 종료한다. 적용 진입 후 경쟁 조건에서도 lock 아래 동일 조건을 재검사한다.
- 기존 원장 11행을 각각 canonical originalVector로 기록한다. aggregate 전용 행은 만들지 않는다.
- COMMIT 응답 유실은 단 한 번의 read-only reconciliation으로 final/prior/conflict/unknown을 판별한다. SQL을 자동 재전송하지 않는다.
- G041/admin body hashes, public review RPC 7개와 private helpers, revision 함수, owner/ACL/RLS/강제 RLS/정책/trigger/constraint/private bucket, 기존 immutable manifest, role membership을 비교한다. 새 보존 기간·접근 권한은 추가하지 않는다.

운영 원장 prefix 86개와 membership digest는 기존 `hosted-preflight-readback-v1.json`에서 온 **과거 자료**다. 나머지 예상 catalog는 격리 PG17.6 reference clone에서 측정했다. 이것은 신규 hosted receipt가 아니다. runner는 실행 시 fresh read-only 결과가 pinned prior와 정확히 같아야 쓴다. 차이가 나면 부모가 원인을 검토하고 계약을 다시 검증해야 하며, gate를 완화하거나 local fixture를 운영에 추가해서 통과시키면 안 된다.

## 로컬 검증

Node `24.21.0`, PostgreSQL `17.6`, 비슈퍼유저 `postgres`로 실행했다.

- PostgreSQL 통합 **11/11**: 실제 원장 11개 vector 동일성, already-applied read-only, partial/vector/prior grant/final private bucket/revision 함수 drift 차단, DDL+11개 원장 삽입 후 실패의 완전 rollback, 실제 commit 후 응답 유실 reconciliation, ledger lock contention, owner RPC 7개·anon/private schema 거부.
- 단위 **11/11**: manifest/source/bundle/parser/generic pin 변조, 불확실 결과 재전송 없음, 보호 실행 문맥, envelope byte 보존, 경쟁 caller 결과.
- workflow: YAML parse, shell syntax **9개**, negative gate **13개**, G016 terminal 예외 **2개** 보존. GitHub Actions 실행이나 actionlint 실행 증거는 아니다.
- dry-run: 환경 Proxy가 manifest pin 이외의 모든 환경 접근을 거부한 상태에서 byte/source/manifest 검사 성공. credentials/DB 접속 0.
- `source.patch`를 별도 사본에 적용한 뒤 결과 5개 파일의 byte 일치를 확인했다. canonical migrations 추가 0.
- 초회 owner probe의 경로 오류와 workflow EOF newline 비교 오류는 수정 후 통과했다. 현재 실패 0.

`reports/integration.json`, `reports/unit-final.tap`, `reports/workflow.json`, `reports/dry-run.json`, `reports/package.json`가 최종 결과다. 초회 logs는 실패 경위를 남긴 자료다.

허용된 Docker context `colima-tzudong-catalog-20261007` / container `tzudong-ranking-clone-20261008`의 network=none, ports={}를 검증했다. 새 고유 `rrel_…` DB만 사용했다. `ranking_clone`의 catalog/manifest/member/data fingerprint는 전후 동일하다. 임시 시험 DB 22개를 정리했고 재실행용 base/reference 2개만 남겼다(`reports/local-cleanup.json`). 6개 foundation은 해당 로컬 DB의 fixture에만 사용했으며 hosted payload/patch에는 없다.

재검증은 패킷 디렉터리에서 아래 명령으로 실행한다. 통합 검사는 보존한 base fixture에서 매번 새 고유 DB를 만든다.

```sh
/opt/homebrew/opt/node@24/bin/node tests/dry_run.mjs
/opt/homebrew/opt/node@24/bin/node --test tests/unit.test.mjs
/opt/homebrew/opt/node@24/bin/node tests/integration.mjs
/opt/homebrew/opt/node@24/bin/node tests/workflow.test.mjs
python3 tests/package.py
```

`tests/build_manifest.py`/`build_workflow.py`는 후보를 변경한 경우에만 재생성에 사용한다. 결과를 바꾸면 manifest pin, tests, patch와 결과 hash를 다시 묶어야 한다. `original/`은 immutable source 사본이며 `source-hashes.json`에 실제 크기/SHA를 기록했다.

## 남은 전달 단계

부모의 SDK PR3198 승격과 직렬화해 이 별도 후보를 fresh head에 통합하고 protected develop→data→main 및 해당 CI/catalog replay를 완료해야 한다. 이후 보호 workflow의 credentials 없는 dry-run, fresh hosted exact prior, 권한 있는 적용, COMMIT 후 최종 readback/audit를 확인한다. 이 작업에서 hosted write 권한을 사용하거나 위 단계를 실행하지 않았다.

공식 계약 참고: [Supabase migration workflow](https://supabase.com/docs/guides/deployment/database-migrations), [changelog](https://supabase.com/changelog). 실제 statement vector는 저장소의 pinned canonical parser를 재사용했다.
