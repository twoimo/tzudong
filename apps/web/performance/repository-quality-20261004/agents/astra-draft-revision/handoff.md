PR3114의 실제 draft cleanup P2 두 건을 지정 checkout에서 수정했습니다. 통합과 protected delivery는 parent 소유이며 commit/push는 하지 않았습니다.

Checkout: `/Users/twoimo/.codex/worktrees/review-contract-quality-20261004/tzudong`
Branch: `codex/review-draft-revision-quality-20261004`
Baseline와 최종 HEAD: `7a430454cf90a4d9f1ba0ce35ad3ffd5022ceebd` (변경은 working tree에 있음)
자체 세션 metadata: provider `openai`, model `gpt-6-astra`, effort `xhigh`. 근거는 `model-metadata.json`의 session_meta / turn_context 위치입니다.

재현과 수정 결과:

- `PRRT_kwDOQGRyNc6oxx7Y`: A의 autosave 뒤 같은 owner/restaurant에 B가 autosave한 다음 A가 submit하는 ordering. baseline은 B row를 삭제했습니다. 수정본은 A가 실제 저장/복원한 revision만 비교하므로 B row를 보존하고 A 제출을 완료합니다.
- `PRRT_kwDOQGRyNc6oxx7T`: definite upload rejection과 definite insert rejection을 각각 완전히 compensation한 뒤, 같은 폼의 autosave가 savedAt만 갱신하고 retry하는 ordering. baseline은 제출한 row를 남겼습니다. 수정본은 새 dispatch interval에서 같은 composer의 최신 revision을 사용하여 이를 삭제합니다.
- 먼저 실제 component submit/autosave, controller, DB save/get/validator/compare-delete를 deterministic transaction transport로 실행하여 3개 기대 불변식의 실패를 확인했습니다. 이후 단 한 번의 Chrome 실행에서 baseline source와 수정본 source를 별도 offline context의 실제 React/IndexedDB에 연결해 동일한 3개 ordering을 baseline 실패 → after 성공으로 확인했습니다. SDK 경계는 합성 메모리 대역입니다.

변경 원리:

- `saveDraft`는 transaction.done 성공 뒤 같은 transaction에서 확인한 bounded public text row를 반환합니다. limit enforcement로 새 row가 없어졌다면 null입니다.
- `ReviewModal`은 saveDraft/getDraft로 직접 저장 또는 실제 복원한 revision 하나만 memory ref에 보관합니다. scope object의 identity는 owner/restaurant/open lifetime 변경 뒤 늦게 완료된 load/save가 이전 권한을 되살리지 못하게 합니다. 저장 시각 표시는 committed.savedAt을 사용합니다.
- `prepareDraftDeletion`은 owner/restaurant뿐 아니라 전달받은 revision 전체를 검증하고 비교합니다. 소유 revision 없음, 빈 key, scope mismatch, 만료 또는 valid replacement는 삭제 권한 없는 성공 no-op입니다. 유효한 본인 revision을 캡처할 때 I/O/invalid-row 실패는 remote dispatch 전에 고정 코드로 차단합니다. 최종 비교와 삭제는 같은 IDB transaction입니다.
- `ReviewSaveOperation`은 saved 결과를 먼저 확인하고, unknown insert 없음 / unanswered upload 없음 / touched upload 모두 보상됨이 확인된 retry에만 capture를 갱신합니다. saved, unknown, unanswered-upload 재시도는 최초 interval의 snapshot을 유지합니다.

Bounded data shape:

- memory revision은 기존 public ReviewDraft의 userId, restaurantId, optional currentStep, visitedDate, visitedTime, categories, content, savedAt뿐입니다. 한 composer의 최신 row 한 개와 한 operation의 고정된 cleanup 비교 snapshot만 유지합니다.
- persisted v3의 기존 9개 필드(userId, restaurantId, currentStep, visitedDate, visitedTime, categories, content, savedAt, expiresAt), compound key, indexes는 그대로입니다. content 4,000자, categories 15개, row 16KiB, user당 20개, sweep 100개, TTL 24시간을 변경하지 않았습니다.
- 새 opcode, token, operation ID, 사진, 파일, 브라우저 reference, 원격 payload를 저장소에 추가하지 않았습니다. 원래 schema/검증 경계를 재사용합니다.

검증:

- focused unit 126 pass / 0 fail / 1,655 assertions. 실제 submit/autosave/load와 controller, upload uncertainty, draft privacy, 기존 draft-store hardening을 포함합니다.
- 새 real React/IndexedDB test 1 pass / 30 assertions. baseline의 P2 ordering 3개는 기대한 실패를 보이고 after의 내부 불변식 7개는 모두 통과했습니다. 브라우저 프로세스 1개, 외부 요청 0, page error 0입니다. 실제 v3 저장 필드와 TTL, committed public text shape를 readback했습니다.
- 변경 7개 파일 targeted ESLint 통과. pinned native 7.0.2 / compat 6.0.2 parity 통과, diagnostics 0, logical inputs 2,379개입니다. git diff --check 통과.
- no-own revision, restored revision, absent key, timestamp-only replacement, compensation 후 B row, unknown insert, unanswered upload, saved cleanup retry, capture error/recovery, scope mismatch, late load/save, expired owned revision을 focused cases에서 확인했습니다.
- 기존 owner-lifecycle 및 9-case IDB browser fixture는 새 내부 API/메모리 ref에 맞춰 수정했습니다. 중복 Chrome 실행을 피하기 위해 해당 기존 browser suite는 재실행하지 않았으며, 새 browser test가 실제 source lifecycle callbacks를 실행합니다. parent의 기존 v4/9-case 검증을 이번 결과로 가장하지 않습니다.

변경 파일은 source-manifest.json의 7개뿐이며 source.patch와 after/에 보존했습니다. 기존 astra-commit-recovery/v4 및 review-commit-recovery-final-checks-v4.json 총 20개 파일의 SHA-256이 시작 시와 동일합니다. source-manifest.json과 prior-preservation-manifest.json을 확인할 수 있습니다.

남은 작업은 parent의 통합, 기존 browser suites를 포함한 통합 검증 판단, 보호된 delivery입니다. 이 담당 범위에 미완료 구현은 없습니다. 요청에 따라 full build/full unit, 추가 SDK A/B, 실제 phone/hosted Auth/Storage, remote write, commit/push는 실행하지 않았습니다. 원격 성공이나 배포를 주장하지 않습니다. package/lock, generated types, runtime maps, nightly CI, docs, applied SQL 및 다른 checkout source를 수정하지 않았습니다. 이 증거 디렉터리만 지정된 parent checkout에 썼습니다.

증거는 합성 fixture의 boolean/count/hash와 source만 담고 있으며 raw PII, credentials, provider diagnostics, 원본 실행 로그는 보존하지 않았습니다.
