# Tzudong 최종 소스 반대 감사 delta 계획

이 계획은 CMS 사용자·배너 수정이 끝난 뒤 **새 final-source snapshot**을 만드는 준비 문서다. 실제 연구, 업로드, dispatch, coordinator 변경, Git 작업은 수행하지 않는다. 기존 pre-repair thesis·antithesis 자료와 queued job은 수정하거나 대체하지 않는다.

## 불변 anchor

- 원래 thesis URL: `https://chatgpt.com/c/6ad4b1ad-fc10-83ec-bbd0-abd1dec881c4`
- 원문: `chatgpt-thesis-full-report.md`, SHA-256 `4c5542b59d9bcb426eac29722b6da36c9c23337fa622bd9e822bd6b3ffe4ad82`
- 원래 thesis bundle: `source_bundle.txt`, SHA-256 `bd8f5668b7a00d48a623471183863cda1ae9eb48c14a0d1dc569508e0f2058c3`
- 기존 antithesis bundle: `gemini-antithesis-source_bundle.txt`, SHA-256 `10fc28e7d72ed4fbb6e7b6206acbd31143528d0831d9f836ff41c47ace018bc7`
- 기존 queued Gemini job: `tzudong-b5d62c34-10fc28e7-antithesis-r01-r06`, request `b0b3b8780cd9dd5b3ffc4875`, dispatches `0`, uploads `0`

새 bundle은 위 job의 source를 바꾸지 않는다. `audit-state.json`, `completion-manifest.json`, 기존 plan·manifest·bundle·SHA 파일은 읽기만 한다. 새 snapshot은 별도 output directory와 별도 hash를 가진다.

## 감사 범위와 질문

### TZ-TH-001~003 · provider budget

최종 `provider-budget.mjs`, Python helper와 process/SQLite 회귀검사 전체를 읽고 다음을 다시 공격한다.

1. definite rejection이 canonical pre-commit exit로만 제한되는가.
2. commit/output ambiguity와 custom runner failure가 exact lease cleanup으로 이어지는가.
3. abort-before-spawn, spawn-error, close, release-debt drain 순서가 허구 debt나 double release를 만들지 않는가.

`provider-findings.json`은 local synthetic evidence다. 실제 quota·billing·Gemini 호출 증거로 승격하지 않는다.

### TZ-TH-004~006 · review/CMS interaction

최종 `SubmissionListView.tsx`, `ReviewModal.tsx`와 직접 browser/source tests를 full context로 읽는다.

1. save-affecting 모든 input, photo/OCR identity, readiness, submit generation이 side effect 직전 같은 snapshot에 결속되는가.
2. trim 후 20~4000자 계약이 client/server와 같으며 저장 문자열 기준인가.
3. Sheet와 inline inspector의 Escape/unmount/frame focus ownership, dirty draft, 외부 search focus가 실제 테스트에 분리되어 있는가.

### TZ-TH-007~008 · catalog/runtime 및 evidence-prefixed 89→105

기존 review-verification SQL과 exact PG17 receipt를 보존해 검토하고, 별도 evidence-prefixed chain을 다음 두 evidence class로 구분한다.

- constituent replay: predecessor `89→100` 11단계와 feature `100→105` 5단계의 각 migration/stage readback
- aggregate execution: compiler가 만든 최종 SQL 문자열을 fresh disposable PG17.6 target에서 실행한 별도 receipt

두 chain은 기존 `86→97`, `97→102` 계약을 바꾸지 않는다. hosted86 mapping과 local synthetic ledger identity를 합치지 않는다. local PG17 통과는 hosted 105, protected-source admission, writer fences, 배포나 operating readiness가 아니다. superuser/ACL predicate는 source와 retained catalog evidence 범위에서만 판정한다.

### TZ-TH-009 · longform response lineage

최종 `longform_analysis.py`와 실제 `claude_video_adapter.py` 호출 문맥에서 retained request digest와 최초 response ID가 receipt identity·observation hash에 결속되는지 확인한다. whole-observation swap, response-ID-only swap, pre-lineage succeeded/uncertain receipt가 GET이나 재생성을 허용하지 않는지 회귀검사와 함께 본다. `caption_osk_adapter.py`는 membership/OSK 경계이며 provider response-ID adapter로 오인하지 않는다.

### 새 delta · OCR credential fallback

최종 OCR routes, admin receipt processor, runtime credential resolution과 Gemini adapter를 함께 읽는다.

- 다음 credential은 앞 credential의 **구조화된 definitive credential rejection**에서만 시도하는가.
- transport uncertainty, unclassified 400, 5xx, status-less prose, parse failure, caller abort 후에는 회전하지 않는가.
- credential 값, provider body, OCR 원문이 receipt/log에 저장되지 않는가.
- route/stream/admin 세 caller가 같은 bounded contract를 사용하는가.

### 새 delta · Admin users/banner CAS와 refresh 경합

CMS agent 종료 후 최종 source와 tests를 읽는다.

- banner update/delete가 `expectedUpdatedAt`과 현재 row를 원자 비교하고 409에서 최신 row만 반환하는가.
- refresh 중 editor revision·dirty state가 바뀌면 stale response가 editor를 닫거나 draft를 덮지 않는가.
- user pagination/refresh가 page/query/sort generation에 결속되고 stale response가 최신 목록·선택·dirty dialog를 덮지 않는가.
- optimistic UI, refetch, cancel, delete 후 removed-row 처리와 server mutation CAS가 일관되는가.

## 새 bundle의 포함 범위

`prepare-final-source-antithesis-bundle.py`의 canonical 목록을 사용한다.

- 원문 thesis와 immutable receipt, 기존 antithesis plan/manifest
- TZ-TH-001~009의 최종 code와 직접 tests
- provider/CMS/DB/lineage local adjudication JSON
- OCR fallback의 최종 code와 synthetic contract tests
- users/banner CAS의 최종 code, direct tests, pre-fix/final-diff JSON
- review-verification migration/test/PG17 receipt
- evidence-prefixed manifests, compiler scripts, target migration full files, direct tests
- constituent PG17.6 receipt와 aggregate compiler-output PG17.6 receipt 및 native review/addendum
- sanitized hosted86 identity mapping과 held launch contracts

포함하지 않는다: `.env`, credential/cookie/profile, `apps/web/supabase/.temp`, 개인 DB row, OCR 원문·이미지, raw provider response/log, PNG, raw browser trace, 실제 Storage payload, 기존 source bundle을 중첩 복사한 파일.

## CMS 종료 후 root 실행 순서

1. CMS owner가 source/test/evidence 작업을 끝냈는지 확인한다. 이 단계는 CMS 파일을 수정하지 않는다.
2. 선택 파일 검증만 수행한다.

```sh
/Users/twoimo/Documents/projects/tzudong/.venv/bin/python3 \
  apps/web/performance/cross-audit-20261018/prepare-final-source-antithesis-bundle.py \
  --check-only --snapshot-label final-source-post-cms
```

3. 새 빈 output directory에 flatten한다.

```sh
/Users/twoimo/Documents/projects/tzudong/.venv/bin/python3 \
  apps/web/performance/cross-audit-20261018/prepare-final-source-antithesis-bundle.py \
  --snapshot-label final-source-post-cms \
  --output-dir apps/web/performance/cross-audit-20261018/final-source-antithesis-post-cms
```

4. 생성된 manifest의 `sourceRevision`, selected-path Git status, 각 file SHA/bytes, bundle SHA를 검토한다. CMS source가 이후 바뀌면 output directory를 재사용하지 말고 새 snapshot으로 다시 만든다.
5. 실제 Deep Research/역검증 dispatch와 업로드는 별도 root 작업이다. 기존 queued job은 취소·수정·재사용하지 않는다.

## 최종 감사 산출물 요구

각 TZ-TH ID와 새 delta에 대해 ACCEPT/CONDITIONAL/REJECT/DEFER, full-source 근거, 반례, 수정 후 판정, 잔여 gate를 쓴다. source/test/PG17/hosted/deployed/provider/field evidence를 합치지 않는다. 새 finding은 안정적 ID를 사용한다. 원문 thesis를 고치지 않으며 새 report가 source나 운영 변경 권한을 주지 않는다.


## 현재 배정과 사용 경계

기존 Gemini FIFO/job/hash는 사용자의 최신 유지 지시에 따라 그대로 둔다. 이 추가 묶음은 원래 대기 중인 job의 첨부나 source hash를 조용히 바꾸지 않는다. 현재 소스 delta를 나중에 별도 검토하거나 최종 역검증에 전달할 수 있도록 준비하는 산출물이며, 생성·hash 검증만으로 업로드·배정·연구 완료를 주장하지 않는다. 두 실제 연구 보고서가 여전히 남아 있다.
