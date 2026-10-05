# Native Astra Xhigh 최종 소스 검토 v3

**정상 replacement를 보존하면서 원래 saved composer를 완료·닫는 보완은 확인됐습니다.** v1 retry recapture P2와 v2의 replacement/자동저장 timestamp 변경으로 인한 완료 차단은 해결됐습니다. 국소 검증은 **15 통과 / 1 실패 (16 cases, 131 assertions)**입니다. 실패는 v2에서 이미 보고한 최초 snapshot 읽기 일시 실패 후 복구 불가 경로 1건입니다. P1은 없습니다.

## bool의 변경된 의미

cleanup의 `true`는 **원래 snapshot A에 대한 정리 의무가 완료됐다**는 뜻입니다. 현재 row를 반드시 삭제했다는 뜻이 아닙니다.

- 현재 row=A: delete와 transaction.done 완료 후 true.
- 현재 row 없음: 삭제 없이 true.
- 현재 row가 유효한 다른 B: B를 전혀 변경하지 않고 transaction.done 후 true. 내용이 같고 timestamp만 달라도 이 경우입니다.
- snapshot/IO 실패 또는 유효성을 확인하지 못한 row: false. 확인 불가 상태를 replacement 성공으로 취급하지 않습니다.

`clearSavedDraft`는 saved인 original operation의 캡처된 closure만 호출합니다. 현재 auth가 없어도 captured local key만 정리하는 의도는 유지되며, 이 method 자체는 서버 mutation/callback을 하지 않습니다. 성공 통지·닫기는 mounted owner의 실제 submit/handleClose에서 실행됩니다.

## 실제 데이터와 삭제 횟수

| 국소 재현 | 반환/완료 | 실제 delete 호출 | 실제 데이터 |
| --- | --- | --- | --- |
| exact A 정리 후 재호출 | true / true | 합계 1 | A 없음 |
| 다른 내용 B 등장 후 두 번 정리 | true / true | 0 | B 전체 필드 동일하게 보존 |
| 같은 내용, 새 timestamp 등장 후 두 번 정리 | true / true | 0 | 새 row 전체 필드 보존 |
| 없는 key 캡처 후 valid row 등장, 두 번 정리 | true / true | 0 | 새 row 전체 필드 보존 |
| known insert 중 B 등장 | success 1 / close 1 | 0 | B 보존, snapshot 1 / insert 1 |
| unanswered commit 후 B 저장, retry/readback saved | success 1 / close 1 | 0 | B 전체 필드 보존, snapshot 1 / insert 1 |
| unanswered commit 후 실제 autoSave handler가 timestamp 변경, retry/readback saved | success 1 / close 1 | 0 | 갱신된 row 보존, snapshot 1 / insert 1 |
| invalid snapshot | false | 0 | synthetic transport의 원본 row 보존 |

unmount/owner-change known commit 정리, unanswered commit의 draft/사진 보존, capture 중 owner 변경의 upload 전 취소, transient delete 실패 직후 재시도도 통과했습니다. Unknown operation에서 clearSavedDraft는 false이며 saved로 확인되기 전에는 삭제하지 않습니다. bool에 의존한 주장만 하지 않고 row의 전체 구조 동등성, delete 호출 횟수, snapshot/insert/callback/close 횟수를 각각 확인했습니다.

## v2 잔여 P2 — 최초 snapshot 오류의 영구 false closure

`apps/web/lib/reviewDraftDB.ts:422-423`은 최초 snapshot get 실패를 `async () => false`로 바꿉니다. `review-save-operation.ts:203-206`은 이를 operation에 고정한 뒤 insert를 진행합니다. **get 실패 1회 → insert 성공 → IDB 복구 → 재시도 → 실제 handleClose** 순서에서 snapshot 1 / insert 1 / delete 0 / success 0 / close 0, draft-cleanup 반환 3회를 재현했습니다.

IO 실패 중 false를 반환하는 정책 자체를 문제로 보는 것이 아닙니다. 오류가 사라진 뒤에도 IO를 다시 확인하지 않는 closure가 false만 반환하여 동일 입력의 정상 재시도·닫기로 완료할 수 없는 부분입니다. 새 B를 재캡처해 지우는 수정은 피하면서 capture 실패를 write 전에 차단하거나 안전한 보존 완료 정책을 분리할 필요가 있습니다. 기존 v2 finding의 잔여 부분이며 새 중복 finding으로 세지 않았습니다.

## 최종 소스/모델 결속

Source: `/Users/twoimo/.codex/worktrees/review-commit-recovery-20261004/tzudong`. Base: `4295fd54411ac8a4c304dce89efbb6f96e90935c`.

최종 5개 파일은 `source/`와 `source-manifest.json`에 보존했습니다. 아래 정렬된 `SHA256  relative-path\n` 5행의 SHA256은 **`64152bb8891678b222942060408cd88431d36695230df6f8e388c595bdbabbb8`**입니다. `final-source-hashes.sha256`, `final-source-binding.json`으로 readback했습니다.

| 파일 | 최종 SHA256 |
| --- | --- |
| `apps/web/components/reviews/ReviewModal.tsx` | `a72506853619b8bf0233b56df2e434aacbea1ec166a6fdbb18d77416128b617d` |
| `apps/web/lib/reviewDraftDB.ts` | `a2e36b225205fd6feaa1809dd9aa18781d5668326229491779eb50ce11585068` |
| `apps/web/tests-unit/review-save-submit.test.ts` | `eba156d87211e9e50eb930d91efdb0c6229d7ddf2dfda20c8aaba1736a05fa40` |
| `apps/web/tests-unit/review-draft-deletion-browser.test.ts` | `638899794c077cbb1c002eec1c9cae16ffa3c1f7073fe47a5c6183d06051f1ba` |
| `apps/web/lib/reviews/review-save-operation.ts` | `c6437f5ddabd8c2a949492b6252483ac3f16ad96d0e9abd70710911a896d3106` |

테스트한 runtime 소스는 실행 전후 동일합니다. 최종 해시 확인 중 부모가 browser test에 operation retry 9번째 사례를 추가한 것을 발견했습니다. 해당 diff를 읽고 최종 snapshot/hash에 반영했으며 browser를 중복 실행하지 않았습니다. 첫 snapshot은 `initial-source/`, `initial-source-manifest.json`, 변경 내역은 `source-drift.json`에 별도 보존했습니다. 이 test-only 변경은 실행한 scratch가 import하지 않습니다.

실제 세션 `01a10669-73d6-7f20-bce6-674c4de5d383`, provider `openai`, model `gpt-6-astra`, effort `xhigh`. `model-metadata.json`에 session_meta와 최신 turn_context line 186을 기록했습니다.

## 검증 범위/보존

`repro-output.txt`, `repro-results.json`, `extra-results.json`과 task-owned `scratch/`에 실제 source submit/handleClose/autoSave/controller/helper/validator 재현을 보존했습니다. IDB·서버 transport는 synthetic이며 browser의 IDB 구현/React timer 렌더링은 실행하지 않았습니다. get/compare/delete의 동일 transaction 여부는 소스로 확인했습니다.

v1/v2 **33개 파일**의 SHA가 모두 보존됐습니다 (`prior-preservation-manifest.json`). 부모 소스는 읽기 전용입니다. full suite/browserprobe/phone/authStorage/원격쓰기/lint/parity를 실행하지 않았으며 부모의 reported counts를 독립 성공 근거로 쓰지 않았습니다. 새 persisted fields/media/IDs/TTL이나 unknown restart durable idempotency를 요구하거나 주장하지 않습니다.

```sh
/Users/twoimo/.bun/bin/bun test /Users/twoimo/.codex/worktrees/marker-memory-lifetime-20261001/tzudong/apps/web/performance/repository-quality-20261004/agents/astra-commit-recovery/v3/scratch/cleanup-retry.test.ts
```
