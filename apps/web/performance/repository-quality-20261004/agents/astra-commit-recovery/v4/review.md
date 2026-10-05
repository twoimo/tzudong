# Native Astra Xhigh 재현 검토 v4

**최종 잔여 P2가 해결됐습니다. 요청한 범위에서 남은 재현 가능한 P1/P2는 없습니다.** 이미 재현했던 capture failure → recovery → retry 및 B 보존 경로만 국소 확인했고 **4 cases / 120 assertions 모두 통과**했습니다. 부모의 unit/lint/parity 실행을 중복하지 않았습니다.

## 실행 순서와 관측값

| 사례 | 최초 실패 단계 | 복구 후 결과 |
| --- | --- | --- |
| 최초 get IO 실패 → 복구 → 같은 입력 retry | blocked, upload 0 / insert 0 / read 0 / callback 0 / close 0 | saved, generated ID 합계 1, capture 시도 2, upload 2 / insert 1 / draft delete 1 / success 1 / close 1 |
| 최초 stored snapshot invalid → valid row로 복구 → retry | blocked, upload 0 / insert 0 / read 0 / callback 0 / close 0 | saved, generated ID 합계 1, capture 시도 2, upload 2 / insert 1 / draft delete 1 / success 1 / close 1 |
| capture 두 번 실패 → 첫 valid snapshot → unanswered commit → B 등장 → readback retry | 두 실패 동안 upload 0 / insert 0, generated ID 합계 1 | 총 capture 시도 3으로 고정(성공 capture 1), insert 1 / delete 0 / success 1 / close 1, B 전체 필드 보존 |
| capture 실패 → valid capture → known insert 중 B 등장 | upload 0 / insert 0 | capture 시도 2, generated ID 합계 1, insert 1 / delete 0 / success 1 / close 1, B 전체 필드 보존 |

예외는 실제 helper에서 정확히 `REVIEW_DRAFT_CAPTURE_FAILED`로 나오는 것을 검증했습니다. controller의 assignment는 await가 resolve된 뒤에만 이루어지므로 실패한 capture는 closure를 배정하지 않으며 기존 catch가 `blocked`로 끝냅니다. ID 생성 횟수는 실제 native adapter의 newId 경계를 계측했고 모든 retry에서 합계 1이었습니다. 첫 valid capture 이후의 unanswered-write retry는 기존 original snapshot을 사용해 B를 재캡처하지 않았습니다.

정상 row cleanup은 실제 delete 1회 후 row가 없어졌습니다. replacement B 경로는 실제 delete 0회이고 B의 전체 구조가 전후 동일했습니다. 실제 submit/clearDraft/handleClose/notify handler를 연결해 성공 통지와 닫기를 각각 1회 확인했습니다. 로그의 `cleared`는 부모 fixture의 기존 mock 카운터이며 이 검증에서는 사용하지 않습니다. 실제 draft 삭제 판정은 `deletes`, row readback과 전후 동등성입니다.

## 계약 구분

- **Capture 단계:** 최초 get/invalid stored snapshot 실패는 fixed error를 throw합니다. 아직 upload/insert를 보내지 않으며 성공한 capture를 얻을 때까지 동일 operation에서 읽기를 재시도합니다.
- **성공 capture 이후:** original operation snapshot을 바꾸지 않습니다.
- **Cleanup 단계의 true:** 원래 snapshot의 정리 의무 완료. exact A 삭제, 이미 없음, 유효한 B를 보존한 경우 모두 true일 수 있습니다. true를 현재 row의 삭제 증거로 취급하지 않았습니다.
- **Cleanup 단계의 false:** IO/current row 검증 등으로 정리 완료를 확인하지 못한 경우입니다. 초기 capture 예외와 구분됩니다.

v1 recapture, v2 정상 replacement/autosave mismatch, v2/v3 초기 capture 실패 고정 closure finding을 모두 해결 상태로 기록했습니다. 새로운 추측성 범위를 추가하지 않았습니다.

## 최종 소스 결속

Source: `/Users/twoimo/.codex/worktrees/review-commit-recovery-20261004/tzudong`. Base: `4295fd54411ac8a4c304dce89efbb6f96e90935c`.

현행 5개 파일을 `source/`에 보존했고 테스트 전후 원본 SHA가 모두 같습니다. 정렬된 `SHA256  relative-path\n` 5행의 SHA256: **`1c346b60c9a35e5afc77ede4e4a3c56980bcc16aa7b49e1fb9589b3020d93398`**. 원문은 `final-source-hashes.sha256`, 최종 readback은 `final-source-binding.json`입니다.

| 파일 | SHA256 |
| --- | --- |
| `apps/web/components/reviews/ReviewModal.tsx` | `a72506853619b8bf0233b56df2e434aacbea1ec166a6fdbb18d77416128b617d` |
| `apps/web/lib/reviewDraftDB.ts` | `2461dd8a29e59360aeaeb48e3647ea42adbca22244af54c8e8f05398914f275f` |
| `apps/web/tests-unit/review-save-submit.test.ts` | `eba156d87211e9e50eb930d91efdb0c6229d7ddf2dfda20c8aaba1736a05fa40` |
| `apps/web/tests-unit/review-draft-deletion-browser.test.ts` | `638899794c077cbb1c002eec1c9cae16ffa3c1f7073fe47a5c6183d06051f1ba` |
| `apps/web/lib/reviews/review-save-operation.ts` | `c6437f5ddabd8c2a949492b6252483ac3f16ad96d0e9abd70710911a896d3106` |

실제 세션 `01a10669-73d6-7f20-bce6-674c4de5d383`, provider `openai`, model `gpt-6-astra`, effort `xhigh`. `model-metadata.json`에 session_meta와 최신 turn_context line 244를 정제하여 기록했습니다. Opus upstream429는 성공 검토로 세지 않았습니다.

## 증거와 경계

- `repro-output.txt`: 4 pass / 0 fail / 120 assertions.
- `repro-results.json`: 첫 실패/최종 단계별 서버쓰기·capture·ID 생성·delete·notification·close 및 B 보존 비교.
- `scratch/setup.ts`, `scratch/fixture.ts`, `scratch/capture-recovery.test.ts`: 실제 source 함수/controller/validator를 실행하고 IDB/서버 transport만 deterministic synthetic 경계로 치환합니다. source/부모 테스트 파일은 변경하지 않았습니다.
- v1/v2/v3의 기존 **55개 파일** SHA가 모두 유지됐습니다 (`prior-preservation-manifest.json`). 이전 실패 기록을 덮어쓰지 않았습니다.
- full suite/browserprobe/phone/authStorage/원격쓰기/lint/parity를 실행하지 않았습니다. 부모의 최종 unit/lint/parity는 별도 증거이며 이 보고서는 해당 성공을 주장하지 않습니다. React 렌더링 또는 real-IDB 재검증도 아닙니다.

```sh
/Users/twoimo/.bun/bin/bun test /Users/twoimo/.codex/worktrees/marker-memory-lifetime-20261001/tzudong/apps/web/performance/repository-quality-20261004/agents/astra-commit-recovery/v4/scratch/capture-recovery.test.ts
```
