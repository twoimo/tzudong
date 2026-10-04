> Historical preparation snapshot. Current operating state is ledger78; use hosted-owner-final-readback-20261004-v2.json and the main operations report. This source-ready/testing snapshot predates the G016 identity correction.

# 선택형 migration pack 검증 — 2026-10-04

소스 기준: `a60ef70dba0bd32ea44d32218e2c66ef1b5410e1`. 운영 SQL 적용·권한 변경·secret 읽기·commit/push는 수행하지 않았다.

`hosted-migration-ledger-20261004.json`은 `aqlcofblfxdrjhhdmarw`의 실제 ledger를 2026-10-04 11:40 UTC에 읽은 메타데이터다. SQL 본문은 포함하지 않는다. 62행이며 8자리 version 3개, 14자리 59개, 12자리 0개다. 단일 문장 SHA256 외에 `sha256(UTF8(to_json(statements)::text))`를 보관하여 여러 문장과 빈 배열도 정확히 결속했다.

- 정규화된 ledger rows SHA256: `e456fc3ac8d39fa467c5c4e6d50d0e9f62e345cf4959e1deb384d262596b54f6`
- ledger 파일 SHA256: `21c8b9c7e5c92d9e6f143cd4095e75ff37384fcf5e8d56ac26c53a97bb14ce8f`
- 선택 plan SHA256: `0f7ed1db21e59569efc9ec30a651f00be9e4a8a317ba668b5ab3a3595e267847`
- materializer SHA256: `b975dd7d017a8bc5fbbafd6cf04c10a7d07f38f909e1b6644f61346b68437cfb`

기본 CLI 모드는 `selected`다. 62개 history mirror와 명시적으로 SHA가 고정된 후속 13개만 생성한다. 원격-only SQL은 추정하지 않고, 2개 검증된 storyboard receipt도 이미 적용된 history로만 표현한다. predecessor alias를 추가하지 않는다. 같은 legacy 날짜의 다른 로컬 SQL, parked migration, 선택적 warning RPC 2개, PG17 owner 복구는 포함하지 않는다. 기존 재구성 API `prepare()`와 `--mode legacy`는 별도로 유지하며 hosted push에 사용하지 않는다.

생성된 팩: `/Users/twoimo/.codex/runtime-cache/tzudong-rollout-pack-20261004-astra`

```sh
python3 backend/supabase/scripts/materialize_migration_workspace.py \
  --ledger apps/web/performance/rollout-preflight/hosted-migration-ledger-20261004.json \
  --destination /absolute/new/task-owned/directory
```

각 mirror는 실수로 실행될 때 `MIGRATION_HISTORY_MIRROR_EXECUTION_DENIED`를 발생시킨다. `verify-base-ledger.sql`은 migration 폴더 밖의 별도 `BEGIN READ ONLY` 사전 검사이며 version/name/count/단일 SHA/배열 SHA 전체를 비교한다. 변경된 ledger, 부분 적용 후 재사용은 거부한다. 실제 적용 전 대상 프로젝트·source/pack SHA·현재 ledger를 재확인하고, 이 검사 후 CLI 2.119.0의 `db push --dry-run --skip-vault` pending이 plan의 13개와 정확히 같은지 확인해야 한다. 검사와 CLI 연결 사이를 원자적으로 잠그는 실행기는 이 팩에 없다. `--include-roles`, seed, Vault 동기화, history repair는 사용하지 않는다.

## 로컬 검증

16 tests PASS (5.345초), diff whitespace 검사 PASS. 이후 배열 hash 검사를 다중 문장·빈 배열로 강화하고 해당 1개만 재검증하여 PASS (0.906초)했다. `test_selected_migration_workspace` 및 기존 `test_storyboard_history`만 실행했다. 관련 fixture는 socket-only PostgreSQL 17.6의 고유 임시 DB로 생성·삭제했다. 운영 statement 본문 대신 합성 문장을 사용했다.

- CLI 2.119.0의 일반 dry-run과 `--include-all` dry-run 모두 정확히 13개 pending, ledger 불변.
- 실제 CLI로 누락된 history mirror 적용을 시도하면 고정 예외로 실패하며 누락 행을 기록하지 않음. 이 쓰기 시도는 격리 fixture에만 수행.
- 단일 문장 hash가 양쪽 모두 null인 다중 문장에서 version/name/count를 유지하고 두 번째 문장만 변경해도 배열 hash로 preflight 거부, DB 불변. 빈 배열도 통과 확인.
- 8/14자리 보존, remote-only mirror, legacy 날짜 충돌, 중복 ledger, 임의 forward-set, source/receipt/manifest drift, SQL 본문 섞임, 기존 출력 덮어쓰기 거부 확인.

이는 CLI 선택/거부 동작의 로컬 증거이며 13개 실제 migration의 운영 적용이나 전체 애플리케이션 동작을 증명하지 않는다. 운영 dry-run도 수행하지 않았다.

## 별도 owner 최종 검증 경로

13개 chain 이후 `20260906064252_g014_pg17_workflow_owner_contract.sql`을 별도 단계로 검토한다. 먼저 적용하면 후속 owner 보호 함수 패치에 필요한 상속 권한이 사라진다. 이 팩에는 복구 SQL이나 역할 실행창을 포함하지 않았다.

현재 복구 SQL의 일회성 checker는 workflow-owner assertion만 검사한다. 복구 후 catalog/definer/public-rpc assertion의 EXECUTE는 owner 전용이므로, 3개를 호출하고 즉시 제거되는 owner 소유의 임시 SECURITY DEFINER verifier를 준비하는 별도 승인된 실행 경로가 필요하다. 정확한 함수·멤버십 admission, 복구 후 실행, verifier 제거, 예상 멤버십만 잔존 및 `postgres`의 owner USAGE/SET 부재를 같은 실행 경로에서 검증해야 한다. 기존 local replay transformer를 운영 grant recipe로 사용하지 않는다. 이 실행 경로는 계획만 제시했으며 구현·실행하지 않았다.
