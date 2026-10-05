# B1 야간 publication·ledger 계약 수정

요청한 두 오류를 재현하고 허용 범위의 수정은 완료했다. **B1 전체는 아직 완료되지 않았다.** 쓰기 범위 밖인 `.github/scripts/build-nightly-local-publication.py:20`의 `99`개 pin이 남아 publication 테스트 2개가 실패한다. 해당 파일의 한 줄 검토용 패치를 준비했으며 실제 파일에는 적용하지 않았다.

- Worktree: `/Users/twoimo/.codex/worktrees/nightly-quality-20261004/tzudong`
- Branch: `codex/nightly-quality-20261004`
- 시작 HEAD·origin/develop·실시간 원격 develop: `d0e38f333a8d9dbd9ed4e14d3e113732ad58ef9a`
- 구현 전 세션 확인: provider `openai`, model `gpt-6-astra`, effort `xhigh`.
- 실행 Python: `/opt/homebrew/opt/python@3.11/bin/python3.11`, 3.11.17. 저장소 security-audit의 Python 3.11 pin에 맞췄다. nightly 자체는 Ubuntu runner의 python3를 사용하므로 CI OS 동등성은 주장하지 않는다.

## 변경 파일

| 파일 | 변경과 이유 |
|---|---|
| `backend/supabase/scripts/local-migrate.py` | 정확한 ledger 수 pin을 99에서 100으로 갱신. 검증 분기/허용 조건/실행 권한은 그대로. |
| `.github/scripts/verify-nightly-local-publication.py` | 같은 검토된 100개 계약으로 갱신. 전체 source equality, replay proofs, ledger/status/hash, sequence, service, source bindings 검증 유지. |
| `backend/supabase/tests/test_local_publication_verifier.py` | 현재 100개 계약과 세 producer/verifier의 pin 일치 검증. chain hash를 다시 계산해도 99·101개 manifest가 거부됨을 확인. |
| `backend/supabase/tests/test_local_seed_receipt_contract.py` | 현재 마지막 migration 및 100개 기대값 갱신. 누락/추가/중복/재정렬/checksum/status/evidence 변조 거부 회귀 검사. comparator fixture의 실제 로컬 환경 의존성만 분리. |
| `backend/supabase/tests/test_local_replay_contract.py` | 100개 중 97 applied 계획, 2 verified-existing, 1 legacy-contract-preserved의 정확한 구분을 검증. 실제 DB 실행을 주장하지 않음. |

`backend/supabase/migrations/20260921123000_g041_privacy_consent_lock_privilege.sql`까지 추적된 canonical SQL은 이미 100개였다. source chain SHA는 수정 전후 `97bece6f9e28a7f231477aeaba9631e549ee8a25c63ab6ea6492629de95dd27f`로 동일하다. applied migration, manifests/dependencies, web/auth/review, backend/layout-manifest는 이 작업에서 수정하지 않았다.

## 검증 결과

- 수정 전 focused 2개: `100 != 99` 실패 1개, `receipt_ledger_state` 오류 1개로 재현.
- publication module: 40개 중 **38 통과 / 1 failure / 1 error / 0 skip**. 남은 두 경우는 builder의 99 pin과 cross-boundary 100 pin 불일치뿐이다.
- related ledger/seed/replay/migration 초기 48개: 47 통과, comparator fixture의 실제 환경 상태 의존 오류 1개. 이것을 fake operator secret이나 실제 stack 생성으로 우회하지 않았다.
- comparator fixture 수정 후 해당 테스트 통과. 전체 seed-receipt module도 **21/21 통과**.
- 나머지 replay+migration **27/27 통과**(수정 이후 무관한 재실행 없음).
- 최신 모듈 결과 합계: **88개 중 86 통과 / 2 실패 사례 / 0 skip**.
- 수정한 Python 5개 AST parse와 scoped `git diff --check` 통과.
- DB/컨테이너 실행 검증은 필요하지 않은 source/fixture 수정이며 실행하지 않았다. 로컬 테스트 입력은 임시 fixture로만 사용하고 실제 publication 증거로 저장하지 않았다.

## 부모 검토에 필요한 남은 조치

1. 사용자 지정 source write scope에 없는 `.github/scripts/build-nightly-local-publication.py`의 pin도 99에서 100으로 맞춰야 한다. [proposed-builder-scope-extension.patch](proposed-builder-scope-extension.patch)는 실제 소스에 적용되지 않은 한 줄 패치다. 부모가 적용하거나 이 파일을 수정 범위에 포함하도록 승인한 뒤 publication module 전체를 재검증해야 한다.
2. 부모 검토 전 commit/push 하지 않는다. 현재 변경은 전부 uncommitted 상태다.
3. 이후 보호된 `develop -> data -> main` 승격과 실제 canonical all-suite nightly 성공/readback이 있어야 #2843을 종결할 수 있다. 후속 unit/e2e/실제 publication 성공을 이번 로컬 검사로 주장하지 않는다.

동시 작업자의 `.kiro/specs/crawler-pipeline-operational-readiness/platform-modernization-reconciliation.v1.json`, `backend/layout-manifest.v1.json` 및 관련 테스트 변경을 관찰했으며 보존했다. [scoped-source-changes.patch](scoped-source-changes.patch)에는 이 작업 소유 5개 파일만 포함된다.

검사 결과·기준 SHA·변경 해시·경계는 [HANDOFF.json](HANDOFF.json), [source-and-scope-verification.json](source-and-scope-verification.json)에 기록했다. 원시 실행 로그, operator secrets, 개인 데이터, 실제/호스팅 DB payload는 저장하지 않았다.
