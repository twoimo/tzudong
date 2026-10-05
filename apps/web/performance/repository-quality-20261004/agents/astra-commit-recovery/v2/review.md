# Native Astra Xhigh 독립 재검토 v2

기존 retry recapture P2는 해결됐습니다. 요청한 최초 재현과 주변 6개 사례는 **7/7 통과**했습니다. 다만 operation별 snapshot을 고정한 뒤의 복구 경로에서 **P2 1건**을 추가 확인했습니다. 추가 3개 국소 사례는 1 통과, 2 실패입니다. P1은 없습니다.

## P2 — 고정 snapshot의 영구 실패와 복구 가능한 정리 실패를 구분하세요

위치: `apps/web/lib/reviews/review-save-operation.ts:100-104`, 귀속 설정 `203-206`. 연결된 경로: `ReviewModal.tsx:1453-1458,1496-1500,1648-1659`, `reviewDraftDB.ts:422-423,435-438`.

정리 closure를 원래 operation에 귀속시키는 변경은 새 draft 삭제를 막습니다. 그러나 closure의 `false`를 모두 재시도 가능한 실패로 전달하면, 시간이 지나도 성공할 수 없는 경우에도 UI가 계속 정리 재시도만 요구하고 닫기를 거절합니다.

재현 A (자동저장): snapshot A → insert는 commit됐지만 응답과 최초 readback은 미확정 → submit finally가 isSubmitting을 false로 복구 → 소스의 500ms autosave effect가 같은 입력을 다시 저장하여 savedAt/expiresAt 갱신 → submit 재시도에서 원래 ID의 readback으로 saved 확인 → 고정 snapshot은 timestamp가 달라 비교 실패 → 재시도와 실제 handleClose가 모두 draft-cleanup으로 반환. 실제 autoSave 핸들러를 실행했고 갱신된 row가 실제 validator를 통과함을 확인했습니다. **insert 1, upload 2, snapshot 1, read 2, 성공 callback 0, close 0**.

재현 B (일시 snapshot 실패): 최초 IDB get만 실패 → prepareDraftDeletion이 항상 false인 closure 반환 → operation에 이 closure를 저장한 채 insert 성공 → 저장소 복구 → 재시도와 실제 handleClose가 같은 false closure만 호출. **insert 1, snapshot 1, 성공 callback 0, close 0**, draft-cleanup 알림 3회. 이 경우 controller의 capture catch는 실행되지 않습니다. 실제 helper가 오류를 삼키고 함수로 바꾸기 때문입니다.

원래 snapshot을 재캡처해 새 draft를 삭제하는 방식으로 되돌리면 안 됩니다. 다른/새로운 row를 보존했다는 terminal 결과와 일시 IDB 오류를 구분하여 이미 저장된 작업의 통지·닫기를 완료할 수 있어야 합니다. capture 자체가 실패했다면 write 전에 block하거나 별도의 안전한 완료 정책이 필요합니다. 현재 입력을 그대로 둔 동일 mounted composer에서는 정상 재시도/닫기로 빠져나오지 못합니다. reload/강제 unmount나 입력을 바꾸는 우회는 복구 UI의 완료가 아닙니다.

## 확인된 정상 경로

| 사례 | 결과 |
| --- | --- |
| 최초 P2: 다른 composer의 B를 보존하고 같은 A 재시도 | 통과, snapshot 1 / insert 1 / delete 0 / B 보존 |
| known success 이후 unmount | 통과, 원래 draft 정리 / callback·사진삭제 없음 |
| known success 이후 owner 변경 | 통과, 원래 draft 정리 / callback·사진삭제 없음 |
| unmount 뒤 newer draft 등장 | 통과, B 보존 |
| unanswered insert 뒤 unmount | 통과, draft·사진 보존 |
| snapshot 실패 시 삭제 권한 미부여 | 통과 (단, 복구 후 완료는 위 P2) |
| delete 오류 직후 autosave 전 재시도 | 통과, insert 1 |
| native capture 대기 중 owner 변경 | 통과, capture 1 / upload·insert·remove·read·callback·close 모두 0 |

`clearSavedDraft`는 saved operation에 캡처된 local closure만 호출합니다. 현재 auth를 요구하지 않는 의도는 타당하며 이를 finding으로 취급하지 않았습니다. 서버 mutation이나 소비자 callback을 직접 호출하지 않습니다. known commit과 unanswered commit을 구분하고, same mounted operation의 중복 insert를 막는 동작은 유지됩니다. IDB get/compare/delete는 같은 readwrite transaction 안에 있습니다. 새 persisted fields/media/IDs/TTL 및 unknown restart의 durable idempotency 주장은 없습니다.

## 소스·모델·증거

- Source: `/Users/twoimo/.codex/worktrees/review-commit-recovery-20261004/tzudong`.
- Base: `4295fd54411ac8a4c304dce89efbb6f96e90935c`. 현행 5개 파일의 snapshot과 SHA는 `source/`, `source-manifest.json`, diff는 `source.patch`.
- 실제 세션: `01a10669-73d6-7f20-bce6-674c4de5d383`. Provider `openai`, model `gpt-6-astra`, effort `xhigh`. 최신 turn_context line 115와 session_meta를 `model-metadata.json`에 정제해 보존.
- 요청된 7개 결과: `repro-output.txt`, `repro-results.json`.
- 추가 owner-change 및 복구 재현: `extra-output.txt`, `extra-results.json`.
- 재현 코드: `scratch/fixture.ts`, `scratch/cleanup-retry.test.ts`. 현재 부모 fixture와 실제 source handlers/controller/validator를 실행하고 IDB·서버 transport만 synthetic 경계로 치환했습니다. React effect의 500ms 경과 자체를 렌더링한 것은 아니며, effect 연결은 소스 확인 후 해당 실제 autosave handler를 호출했습니다.
- 부모 113-unit/8-real-IDB 보고는 독립 검증 근거로 재사용하지 않았습니다. Full suite/browser probe/phone/authStorage/원격쓰기/lint/parity는 실행하지 않았습니다.
- v1 원본 15개 artifact의 SHA를 `v1-preservation-manifest.json`에 기록하고 종료 전 불변 확인. v1 결과/재현/결론은 수정하지 않았습니다.

```sh
# task-owned scratch 전체 국소 재현 (현재 8 pass / 2 fail 예상)
/Users/twoimo/.bun/bin/bun test /Users/twoimo/.codex/worktrees/marker-memory-lifetime-20261001/tzudong/apps/web/performance/repository-quality-20261004/agents/astra-commit-recovery/v2/scratch/cleanup-retry.test.ts
```
