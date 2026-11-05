# Tzudong 심층 기술 감사 — Thesis

## 감사 범위와 증거 수준

이번 감사는 **첨부된 두 파일을 canonical 입력으로 삼아 읽기 전용으로 수행**했다. `source_bundle(3).txt`의 SHA-256을 직접 계산한 결과는 사용자가 제시한 값과 정확히 일치했다.

`bd8f5668b7a00d48a623471183863cda1ae9eb48c14a0d1dc569508e0f2058c3`

`master-plan(2).md`의 실제 SHA-256은 `fbf4cd47c1bed3d7042ca7860050d640b72e25a5c798d1898790ba0f5ef0c0a9`였다. 묶음에는 정확히 10개 소스가 있고, 이 중 `provider-budget.mjs`, `provider_budget.py`, JS quota 테스트, storyboard runtime binding, readiness SQL, readiness unit test는 `kind=full`, `SubmissionListView.tsx`, `ReviewModal.tsx`, `caption_osk_adapter.py`, `longform_analysis.py`는 명시적으로 `kind=patch`다. 따라서 네 patch는 주변 문맥을 포함한 발췌로만 해석했으며 전체 저장소 부재를 근거로 결함을 단정하지 않았다. fileciteturn0file1

계획서는 `ea08db3ae0c1a8d2525da15e6026ca4556ec0260`의 dirty snapshot을 감사 원점으로 두고, quota의 `L(t) ≤ C`, sliding-window 요청 상한, OCR의 `B0 = B1`, catalog-bound readiness, membership/provider evidence boundary, 운영 증거 분리를 명시한다. 또한 실제 PG clone, 브라우저 폭 검증, provider/Storage readback, 운영 배포 등을 서로 다른 증거 등급으로 취급하라고 요구한다. 이 감사 역시 그 구분을 유지했다. fileciteturn0file0

추가로 통합 commit `b5d62c34f4a2e854ab10fd9f6741597b6081c43b`가 공개 저장소에 존재하는 것과 핵심 파일 일부의 full-file 문맥은 읽기 전용으로 교차 확인했다. 다만 **10개 파일 전부를 b5에서 다시 내려받아 SHA-256을 일괄 재계산한 것은 아니다.** 그러므로 “b5의 10개 파일 바이트가 모두 동결 묶음과 동일하다”는 provenance는 이번 보고서에서 사용자 제공 사실 이상으로 승격하지 않는다.

증거 수준도 분리한다. 이번에 새로 실제 실행한 것은 **R01에 대한 로컬 synthetic Node 반례 두 개**뿐이다. 첨부 계획에 기록된 “6/6”, “72/72”, “14/14”, “PG17.6 clone passed” 등의 결과는 계획서에 적힌 기존 증거로 읽었을 뿐 내가 다시 실행해 재인증한 결과가 아니다. 실제 PG17 catalog replay, synthetic React/Radix rendering, 실제 Storage, 실제 OCR/provider 호출, 청구·quota readback, 운영 배포는 이번 thesis에서 수행하지 않았다. 따라서 원본 영상 분석 완료나 production readiness도 인증하지 않는다. fileciteturn0file0

전체 판정은 다음과 같다.

| ID | 영역 | 심각도 | 판정 |
|---|---|---:|---|
| **TZ-TH-001** | quota acquire definite rejection | 높음 | **실제 결함, synthetic 재현** |
| **TZ-TH-002** | release debt 회복 | 높음 | **실제 결함, synthetic 재현** |
| **TZ-TH-003** | abort와 spawn-failure race | 중간 | **소스상 실제 race** |
| **TZ-TH-004** | OCR/save B0→B1 TOCTOU | 높음 | **실제 불변식 위반** |
| **TZ-TH-005** | 리뷰 20–4000자 경계 | 낮음 | **일관성 결함** |
| **TZ-TH-006** | Sheet/inline focus ownership | 낮음 | **Sheet는 양호, inline은 조건부 위험** |
| **TZ-TH-007** | DB ACL의 superuser predicate | 중간 | **catalog 의존 조건부 위험** |
| **TZ-TH-008** | catalog/admission 증거 | 중간 | **검증 공백; 릴리스 차단 사유** |
| **TZ-TH-009** | provider GET response ID | 중간 | **patch 범위의 조건부 결속 결함** |

가장 중요한 thesis는 세 가지다. **R01은 아직 “definite rejection”과 release debt가 완전히 닫히지 않았다. R02는 계획서가 요구한 `B0 = B1`을 구현하지 못했다. R04의 SQL은 이전의 느슨한 readiness보다 상당히 강하지만, 실제 catalog admission을 이 묶음만으로 확정할 수 없고 특정 ACL predicate는 실제 role 속성에 따라 영구-held가 될 수 있다.** fileciteturn0file0 fileciteturn0file1


## 프로젝트 quota lease

### 확정 거절 프로토콜은 아직 commit-response loss를 증명하지 못한다

**TZ-TH-001 — 높음 — `backend/utils/provider-budget.mjs::budgetCommand`, `withProjectBudget`; `backend/utils/provider_budget.py::ProjectBudget.acquire`, `main`.**

핵심 분류는 `budgetCommand`가 acquire child의 비정상 종료를 보고, **exit code 1 + stdout 길이 0 + stderr의 정확한 `PROVIDER_BUDGET_UNAVAILABLE`** 조합이면 `budgetAcquireRejected=true`로 만드는 부분이다. 그 뒤 `withProjectBudget`은 이 플래그가 참이면 부모가 선택한 lease ID의 release를 시도하지 않는다. 반대로 partial stdout 등을 동반한 nonzero는 ambiguous로 남아 release한다. Python 쪽에서는 SQLite에 lease와 birth identity를 넣고 pacing을 갱신한 뒤 `db.commit()`하고 identity를 반환하며, top-level은 `OSError`, `ValueError`, `sqlite3.Error`, `TimeoutError`를 모두 같은 sentinel 종료로 축약한다. fileciteturn0file1

이 구조가 놓치는 것은 **“sentinel을 관측했다”와 “lease commit이 절대 없었다”가 동치가 아니라는 점**이다. 특히 Python의 commit 성공 이후 `print(budget.acquire(...))`까지가 별도 transport 구간이고, top-level의 넓은 `OSError` catch는 출력 실패를 같은 sentinel로 변환할 수 있다. 더 직접적으로 `RUN_DAILY_PYTHON`은 실행 파일을 환경으로 바꿀 수 있는데, JS 쪽 definite 판별은 실제 실행 파일이 canonical helper인지 attestation하지 않는다. 따라서 “lease를 commit한 뒤 stdout은 쓰지 않고 정확한 sentinel과 code 1을 반환하는 runner”도 definite rejection으로 오분류된다. fileciteturn0file1

나는 묶음의 **full `provider-budget.mjs`를 그대로 추출**하고, runner만 synthetic fixture로 바꿔 다음 상태 전이를 실행했다.

`lease L 선택 → custom runner가 L을 ledger에 commit → stdout=∅ → stderr=sentinel → exit 1 → JS가 definite rejection으로 판정 → release 생략`

관측 결과는 `A_ledger_remains true`, `A_release_called false`였다. 즉 이 반례에서는 work는 실행되지 않지만 live parent에 귀속된 lease는 남는다. `GEMINI_MAX_INFLIGHT=1`과 같은 단일 concurrency라면 같은 살아 있는 부모의 다음 acquire가 그 lease를 stale로 제거하지 못하므로 capacity가 막힐 수 있다. 이 테스트는 **실제 provider quota나 청구를 재현한 것이 아니라, 첨부 state machine의 commit/response 경계만 재현한 로컬 synthetic test**다. fileciteturn0file1

최소 수정은 “stderr 문자열을 더 강하게 만드는 것”이 아니다. **child 내부 commit-state를 프로토콜 상태로 분리해야 한다.** `NO_LEASE_COMMIT_POSSIBLE` 같은 결과는 validation 또는 commit attempt 이전처럼 실제로 no-lease가 증명된 분기에서만 내보내고, `db.commit()`을 시도한 이후의 모든 예외와 stdout 전달 실패는 `AMBIGUOUS`로 취급해야 한다. 부모가 이미 lease ID를 정하므로 ambiguous 분기의 idempotent `release(lease)`가 안전한 회복 경계다. `RUN_DAILY_PYTHON` 같은 대체 runner를 계속 허용한다면 runner가 임의 sentinel을 흉내 내도 안전해야 하므로 **transport text만으로 definite를 증명해서는 안 된다.**

회귀 검사는 최소 다음 상태 전이를 포함해야 한다: pre-commit validation rejection은 release 없이 종료, insert/commit 이전 timeout은 no-lease, commit 후 정상 identity는 work→release, commit 후 partial stdout은 release, commit 후 empty stdout+sentinel도 release, commit 결과 자체가 불확실한 SQLite error도 release, 그리고 release 자체는 여러 번 실행돼도 최종 DB 상태가 동일해야 한다.

### release debt가 고장 난 실행 환경을 함께 영구 캡처한다

**TZ-TH-002 — 높음 — `provider-budget.mjs::releasePermit`, `withProjectBudget`.**

현재 debt는 `{ lease, env }`로 만들어지며 `env`는 acquire 시점 요청 환경의 복사본이다. release가 세 번 실패하면 이 객체가 모듈 전역 `pendingReleases`에 남는다. 다음 `withProjectBudget`은 새 요청의 정상 환경으로 acquire를 시도하기 **전에** 모든 기존 debt를 먼저 drain하지만, drain에는 debt에 저장된 **옛 `env`**가 그대로 쓰인다. 하나라도 남으면 새 요청은 `PROVIDER_BUDGET_UNAVAILABLE`로 막힌다. fileciteturn0file1

이를 실제 full module에 대해 synthetic으로 재현했다.

`helper A로 acquire 성공 → work가 "paid-result" 반환 → A가 release 전에 사라짐 → 3회 release spawn 실패 → debt {L, env(A)} 저장 → 다음 호출은 건강한 helper B를 제공 → debt drain이 B가 아니라 다시 A를 사용 → 3회 실패 → B의 acquire까지 도달하지 못함`

실제 관측은 첫 호출이 `paid-result`를 정상 반환했고, 둘째 호출은 `PROVIDER_BUDGET_UNAVAILABLE`로 실패했으며, 로그에는 처음의 `acquire`만 있었다. 즉 “유료 응답을 release bookkeeping error로 덮어쓰지 않는다”는 설계는 지키지만, 그 대가로 **runner 장애가 해결되어도 프로세스 내 future progress가 회복되지 않는 debt**가 만들어진다. fileciteturn0file1

최소 수정은 **lease의 영속 identity와 release를 실행하는 runner identity를 분리**하는 것이다. debt에는 lease ID, budget DB 경로, project scope처럼 release 대상의 identity만 동결하고, 재시도 시 executable/interpreter는 현재 건강한 canonical runner를 쓸 수 있어야 한다. 단, 현재 요청의 project/path를 debt에 덮어씌우면 다른 budget을 release할 수 있으므로 “새 실행기 + 옛 debt scope”로 병합해야 한다.

회귀 검사는 helper A로 acquire한 뒤 A를 제거해 debt를 만들고, 다음 요청의 B가 **옛 lease를 먼저 삭제한 후** 자신의 acquire로 진행하는지 확인해야 한다. 실제 release가 이미 commit됐으나 응답만 유실된 경우도 포함해 “not found release”를 성공으로 처리하는 idempotency를 검증해야 한다.

### abort 직후 spawn 실패는 없는 lease의 release debt를 만들 수 있다

**TZ-TH-003 — 중간 — `provider-budget.mjs::budgetCommand`의 `spawn`/`error`/abort 처리.**

정상 spawn 실패에서는 `'spawn'` 이벤트가 오지 않아 `childStarted=false`가 유지되고, `'error'` handler가 `budgetChildStarted=false`를 error에 붙이므로 부모는 release를 건너뛴다. 첨부 테스트의 “spawn failure creates no fictitious release debt”도 바로 이 정상 순서를 검사한다. fileciteturn0file1

그러나 abort 분기에서는 다르다. `spawn()` 호출 후 실제 `'error'` 이벤트가 오기 전에 AbortSignal이 발화하면 `aborted=true`가 먼저 설정된다. 이후 `'error'` handler는 `if (aborted) finish(abortError())`로 빠져 **`budgetChildStarted=false` 정보를 잃는다.** 부모 catch에서는 `undefined !== false`이므로 release를 시도하고, runner 자체가 존재하지 않는 spawn failure라면 release도 실패해 fictitious debt를 만들 수 있다. Node의 공식 child-process 문서는 성공한 process에만 `'spawn'`이 발생하고 spawn 실패에는 `'error'`가 발생한다고 명시하며, `'close'`는 spawn 실패의 `'error'` 뒤에도 올 수 있다고 설명한다. citeturn4view0

최소 수정은 abort 원인을 반환할 때도 **child가 실제 spawn됐는지의 tri-state를 보존**하는 것이다. `AbortError` 객체의 임의 속성에 의존하기보다는 command 결과를 `{kind: 'aborted', childStarted}` 같은 내부 상태로 만들고, `childStarted === true`일 때만 ambiguous cleanup을 시도하는 편이 명확하다.

기존 abort 회귀는 “이미 acquire child가 commit한 후 abort”를 잘 검사한다. 여기에 `spawn() 반환 직후, 'spawn'/'error' 전 abort`와 `ENOENT + abort`를 추가해야 한다. fileciteturn0file1

반면 **정상 acquire 후 work의 성공·실패에서 논리적으로 같은 lease ID를 release하고, release command 자체가 여러 번 실행돼도 Python `DELETE ... WHERE id=? AND scope=?`가 idempotent인 점은 현재 구조의 안전한 부분**이다. 부모 강제 종료처럼 `finally`가 실행될 수 없는 경우에는 다음 acquire가 PID와 process birth identity를 검사해 stale lease를 정리하도록 되어 있고, Linux에서는 boot ID와 process start tick을 함께 사용해 단순 PID 재사용을 방어한다. 이것은 로컬 lease 회복 설계이며 실제 provider 청구 취소를 의미하지 않는다. fileciteturn0file1

복잡도 면에서 Python acquire의 stale scan은 해당 scope의 active/stale lease 수에 대해 `O(L)`이고, configured concurrency 자체는 코드상 최대 8로 제한된다. JS debt drain은 `O(D)`개의 debt 각각에 최대 세 번 subprocess를 시도하므로 최악의 로컬 복구 비용은 `O(D)` spawn이다. 첫 unresolved debt가 future acquire를 막으므로 정상적인 순차 흐름에서 `D`가 무한히 늘지는 않지만, 장애 시점에 이미 병행 중이던 호출들이 추가 debt를 만들 수 있다. 실제 spawn latency나 비용은 측정하지 않았다. fileciteturn0file1


## OCR 저장 경계와 포커스

### 계획서의 B0=B1 불변식은 구현되지 않았다

**TZ-TH-004 — 높음 — `apps/web/components/reviews/ReviewModal.tsx::handleSubmit`, `latestSaveInputsRef`, OCR completion binding.**

통합 파일의 submit 경계는 개념적으로 다음 순서다.

`B0: submittedInputs = latestSaveInputsRef.current → await database readiness → B1: currentInputs = latestSaveInputsRef.current → 일부 OCR field 비교 → draft 구성 → submit/upload/write → 사후 changedDuringSave 검사`

문제는 B0/B1 비교가 **전체 저장 입력의 동일성**이 아니라 AI mode에서 `ocrResultRef`와 `ocrResultRevision` 중심으로 좁혀져 있다는 것이다. 반면 draft는 `targetRestaurant`, `visitedDate/time`, `categories`, `content`, `verificationPhoto`, `foodPhotos` 등 click 시 렌더의 값들을 사용한다. `submissionMode`는 `verificationInputModeRef.current`에서 readiness 이후의 live 값을 읽는다. 따라서 하나의 draft가 서로 다른 epoch의 값을 섞을 수 있다. `changedDuringSave`는 모든 submitted input key를 나중에 비교하지만 이 검사는 **`saveOperation.submit(draft)` 이후**이므로 이미 upload/write가 시작된 뒤다. 계획서의 “B0=B1이어야 업로드·저장을 시작한다”는 요구를 충족하지 못한다. fileciteturn0file0 fileciteturn0file1

가장 단순한 반례는 provider나 OCR이 전혀 필요 없다.

`manual mode + 영수증 사진 A + 식당 X + 내용 C0 → 등록 클릭 → readiness promise pending → 사진 B/식당 Y/내용 C1로 UI 수정 → readiness 완료 → OCR binding guard는 manual이라 적용되지 않음 → click 시점 closure의 A/X/C0 draft가 submit될 수 있음 → 사후 changedDuringSave만 이를 발견`

즉 화면에는 B/Y/C1이 보이는데 Storage와 DB에는 A/X/C0가 들어가는 **upload/save TOCTOU**가 가능하다. 사진 A의 JavaScript `File` 객체는 UI에서 교체해도 draft가 참조하고 있는 한 그대로 업로드 가능한 객체이므로, “현재 UI 입력”과 “실제 side effect”의 identity가 갈라진다. fileciteturn0file1

AI 경로에는 좋은 방어가 있다. 사진 교체 함수는 OCR run을 invalidate/abort하고 `ocrResultRef`와 `ocrResultRevision`을 state 및 `latestSaveInputsRef`에서 모두 null로 만들며, 성공 결과는 UUID 형식을 확인한 뒤 두 ref를 같이 넣는다. UI submit 가능 여부도 AI mode에서는 `!isAnalyzing && ocrResultRef && ocrResultRevision`을 요구한다. 따라서 **통상적인 “AI 분석 중 사진 교체”는 상당 부분 fail-closed**다. fileciteturn0file1

그러나 이것은 `B0=B1`과 같지 않다. `isAnalyzing`은 submit handler의 렌더 epoch 값인 반면 `submissionMode`는 live ref에서 읽고, OCR identity 비교는 전체 save input mutation을 검출하지 않는다. 따라서 streaming `done` 이전 결속까지 강하게 보장하려면 단순 “결과 UUID 존재”보다 **OCR run generation/done token + photo identity + result ref/revision**을 한 snapshot으로 묶어야 한다. 동일 사진의 재분석이 기존 result ID를 언제 지우는지는 patch 발췌만으로 모든 경로를 증명할 수 없으므로, “same-photo rerun 도중 stale result로 실제 저장된다”까지는 이 thesis에서 확정하지 않는다. 이 부분은 조건부 위험이다. fileciteturn0file1

최소 수정은 B0에 immutable `SaveAttempt`를 만드는 것이다. 적어도 `mode`, verification photo의 stable identity, OCR run generation, result ref/revision, restaurant ID, visited date/time, canonical category set, content, food-photo identities, owner를 포함해야 한다. readiness가 끝난 직후 side effect 전에 B1을 다시 만들어 **전체 identity equality 또는 단일 monotonic input revision**을 검사한다. 하나라도 변했으면 upload/DB write 없이 attempt를 폐기하고 명시적 재등록을 요구한다. 이후 draft와 upload도 반드시 B0 snapshot만 사용해야 한다.

회귀 검사는 deferred readiness를 사용해 B0와 B1 사이에 각각 **한 필드만** 바꾸는 table-driven test가 적합하다. restaurant, date, time, categories, content, verification photo, food photo, mode에 대해 모두 `upload count = 0`, `DB write count = 0`을 확인해야 한다. AI에는 사진 교체, AI→manual, manual→AI, 동일 사진 재분석, 이전 run의 늦은 completion, `done` 직전 submit을 추가하고 `(runGeneration, photoIdentity, resultRef, revision)`이 정확히 같은 경우만 통과시켜야 한다.

### 문자 수 경계는 저장되는 문자열과 다른 기준을 사용한다

**TZ-TH-005 — 낮음 — `ReviewModal.tsx::handleSubmit`, `isFormValid`.**

최소 길이는 `content.trim().length < 20`으로 검사하고 실제 draft도 `content.trim()`을 저장하지만, 최대 길이는 `content.length > 4000`으로 검사한다. 따라서 예를 들어 저장될 trim 결과가 정확히 4,000자인 문자열에 앞뒤 공백이 붙으면 저장 값은 허용 범위인데 UI는 거부한다. 안전성 측면에서는 과다 저장을 허용하지 않는 보수적 오류지만, “저장되는 리뷰 내용이 20–4,000자”라는 동일 계약을 양쪽 경계가 따르지는 않는다. fileciteturn0file1

최소 수정은 `const normalizedContent = content.trim()`을 한 번 만들고 20과 4,000 모두 그 값으로 검사하며 draft도 같은 값만 쓰는 것이다. DB/API에 별도의 문자 수 계약이 있다면 동일 normalization을 서버에서도 재검사해야 한다. 이번 자료로 서버 측 길이 constraint까지는 확인하지 못했다.

### Sheet의 외부 focus ownership은 방향이 맞고, inline은 별도 확인이 필요하다

**TZ-TH-006 — 낮음·조건부 — `apps/web/components/admin/SubmissionListView.tsx`, focus restoration helper.**

Sheet 수정은 핵심 ownership 원칙을 제대로 반영한다. 닫힘 시 Radix `onCloseAutoFocus` 기본 복원을 막고, 현재 focus가 moderation drawer 내부에 남았거나 body로 떨어진 경우에만 선택 행 trigger로 복원하며, 검색창 같은 drawer 외부 element가 이미 focus를 소유하면 복원하지 않는 구조다. row trigger가 연결되어 있고 disabled가 아닐 때만 `.focus()`한다. 따라서 계획서의 “Escape 직후 사용자가 검색 입력으로 focus를 옮겼으면 늦은 close가 이를 강탈하지 않는다”는 source-level 방어는 성립한다. fileciteturn0file0 fileciteturn0file1

다만 inline 상세 경로는 Sheet와 같은 lifecycle이 아니며 requestAnimationFrame/React unmount 순서에 영향을 받는다. 첨부 patch는 drawer ownership marker를 중심으로 restoration 여부를 결정하므로, inline inspector의 focused node가 frame 시점까지 잠시 연결돼 있는 경로는 별도 synthetic rendering으로 반증해야 한다. 이 조건이 실제 컴포넌트 전체 문맥에서 이미 다른 marker로 닫혀 있을 가능성이 있으므로 확정 결함으로 승격하지 않는다.

최소 회귀는 실제 DOM에서 `Enter/Space → 상세 open → Escape → 즉시 search.focus()`를 실행하고 animation/frame 종료 후 search가 여전히 `document.activeElement`인지 검사하는 것이다. 선택 행 삭제·disabled·filter-out, Sheet와 inline을 각각 분리해야 한다. 계획서에 언급된 1440/834/390px 시각 검증은 이 focus ownership test와 별개이며 이번 감사에서는 synthetic rendering이나 실제 viewport 캡처를 실행하지 않았다. fileciteturn0file0


## 데이터베이스 capability와 admission

첨부 successor SQL은 이전의 “이름이나 문자열이 보이면 ready” 수준보다 훨씬 강하다. `ocr_private.get_feature_runtime_capability(uuid)`를 forward-only로 교체하고, delete guard의 trigger name, `tgenabled='O'`, `tgtype`, `pg_get_triggerdef`, 정확한 trigger function regprocedure, function owner/security metadata, body hash, execute exposure를 검사한다. 첨부 unit test도 delete trigger에 대해 `a01_review_verification_guard_delete`, `tgenabled='O'`, `tgtype=11`, exact trigger definition, function-body SHA, `privacy_workflow_owner`, `SECURITY DEFINER`, ACL 검사를 source text에서 확인한다. predecessor migration은 수정하지 않고 successor에서 private helper만 교체한다는 계약도 테스트한다. fileciteturn0file1

즉 **trigger disabled, 다른 function으로 재결속, body 변조, owner/security/ACL drift를 단순 capability 이름만으로 놓치는 문제는 source-level 설계상 상당히 잘 닫혀 있다.** 특히 exact body hash와 exact trigger definition은 false-ready보다 false-held 쪽으로 실패하는 fence다. 다만 다음 두 점 때문에 “실제 PG17 catalog에서도 ready/held가 정확하다”까지는 아직 올릴 수 없다.

### superuser를 effective EXECUTE deny 대상으로 넣으면 predicate가 충족 불가능할 수 있다

**TZ-TH-007 — 중간·조건부 — successor SQL의 ACL/catalog predicate.**

첨부 SQL의 execute-exposure 판정에서 `postgres` 같은 privileged role까지 “`has_function_privilege(..., 'EXECUTE')`가 없어야 한다”는 집합에 포함시키는 부분은 **실제 role attribute와 함께** 검증해야 한다. PostgreSQL 17의 공식 문서는 superuser가 로그인 자체를 제외한 permission check를 우회한다고 명시한다. 또한 `has_function_privilege`는 특정 user가 function의 `EXECUTE` privilege를 갖는지 묻는 공식 access-privilege inquiry 함수다. citeturn3search2turn3search0

따라서 대상 PG17 catalog에서 `postgres.rolsuper = true`이고 readiness가 `NOT has_function_privilege('postgres', function_oid, 'EXECUTE')`를 요구한다면 그 조건은 사실상 영구적으로 false가 되어 capability가 계속 `held`일 수 있다. 이 경우 **보안 우회는 아니다.** 오히려 fail-closed availability/admission blocker다. 사용자가 언급한 실제 PG17.6 clone에서 정말 `ready`가 나왔다면, 그 보존 catalog에서 `postgres`의 실제 속성 및 SQL predicate를 함께 제시하면 이 조건부 우려는 즉시 반증될 수 있다. 계획서의 “clone passed”라는 문장만으로는 그 반증을 재현할 수 없다. fileciteturn0file0 fileciteturn0file1

최소 수정은 **effective privilege와 explicit ACL drift를 구분**하는 것이다. “PUBLIC/anon/authenticated/service_role 등에 명시적 execute grant가 없는가”가 계약이라면 `proacl`/ACL expansion을 기준으로 정확한 grantee를 검사하고, superuser의 본질적인 권한 우회까지 “ACL이 잘 잠겼음”의 부정 조건으로 쓰지 않는 편이 정확하다. 반대로 superuser도 실행할 수 없어야 한다는 정책이라면 PostgreSQL superuser 모델 자체와 양립하지 않으므로 role 설계를 바꿔야 한다.

회귀는 실제 대상 catalog에서 최소 `pg_roles.rolsuper`, target function `proacl`, `has_function_privilege` 결과를 함께 snapshot해야 한다. `REVOKE EXECUTE`, PUBLIC default ACL, owner/superuser, service-role 각각을 별개로 변형해 ready→held 전이를 확인해야 한다. PostgreSQL의 privilege query는 explicit ACL 문자열만 보는 함수가 아니라 role이 실제로 privilege를 갖는지를 묻는 함수이므로 이 구분이 중요하다. citeturn3search0

### source-text unit test는 catalog semantics를 실행하지 않는다

**TZ-TH-008 — 중간·검증 공백 — successor readiness test 및 admission evidence.**

첨부 `review-verification-runtime-readiness.test.ts`는 SQL 파일을 문자열로 읽고 `toContain(...)`으로 특정 fragment의 존재를 검사한다. 이것은 forward migration이 예상한 clause를 잃어버리는 회귀에는 유용하지만, clause가 잘못된 boolean branch 안에 있거나 항상-false predicate와 결합됐거나 실제 PG catalog type/coercion/ACL semantics에서 다르게 동작하는 경우를 검증하지 못한다. 예를 들어 test는 `tgenabled='O'`, `tgtype=11`, body hash 문자열, `has_function_privilege` 문자열이 **존재함**을 확인하지, 실제 altered catalog에서 capability가 `held`로 바뀌는 것을 실행하지 않는다. fileciteturn0file1

따라서 계획서의 Bun readiness 테스트 통과와 **실제 PostgreSQL replay 통과는 서로 대체할 수 없다.** 계획서는 별도로 “PG17.6 clone replay passed, findings=[]”를 기록하지만, 이번 10-source bundle에는 그 replay의 catalog dump/readback 결과 자체가 포함되어 있지 않다. 나는 실제 PG17 instance에서 migration을 재생하지 않았으므로 그 결과를 독립 재인증하지 않는다. fileciteturn0file0

사용자가 특별히 지시한 **successor102와 새 develop migration105 ledger도 분리**해야 한다. 이번 동결 10-source 묶음은 계획서가 말하는 기존 feature successor/102 계약과 `20261016090000_review_verification_delete_guard_readiness.sql`을 감사하는 자료다. **별도의 새 develop migration105 ledger는 이 10개 소스에 포함되어 있지 않다.** 따라서 migration105에서 더 강한 evidence ledger가 추가됐더라도 그것을 successor102의 과거 증거로 소급 적용하지 않았고, 반대로 successor102에서 발견한 조건부 위험을 migration105에도 자동 전파하지 않았다. migration105는 별도의 source hash와 catalog replay가 있어야 독립 판정할 수 있다. fileciteturn0file0 fileciteturn0file1

사용자가 요구한 `97→102 admission`에 대해서도 결론은 동일하다. 첨부 source만 보면 **정확한 trigger/function/catalog drift를 보고 held로 떨어뜨리려는 fence는 확인**된다. 하지만 실제 97 상태의 catalog에서 successor를 순차 적용해 102 receipt/admission에 도달하고, 중간 rollback·재적용·trigger disable·body drift마다 기대 상태가 나오는 실행 증거는 이번 thesis에서 생성하지 않았다. 그러므로 “97→102 admission이 실제 PG17에서 검증 완료”라는 최종 판정은 **UNVERIFIED**다.

최종 PG regression에는 최소 다음 상태들을 한 catalog에서 순차 재생해야 한다: pristine predecessor→successor ready, UPDATE trigger disabled→held, DELETE trigger disabled→held, trigger function OID 교체→held, 동일 signature의 body만 변조→held, SECURITY DEFINER 제거→held, owner 변경→held, search_path/config drift→held, prohibited ACL grant→held, 원복→ready, transaction 중 rollback→old state 유지, successor 재적용의 기대 idempotency/실패 특성 확인. 이 결과는 SQL source hash, before/after catalog query와 함께 보존해야 한다.


## Membership·provider GET·runtime closure

### membership admission 자체는 이전보다 엄격해졌다

`caption_osk_adapter.py` patch는 membership row에서 tab별 duration/live-status 조합을 제한하고, `streams`에서는 `was_live`만 admitted 집합에 넣으며 `is_live`, `is_upcoming`, `post_live`는 completed-longform admission에 포함하지 않는다. `was_live`에는 positive integer duration을 요구하고 중복 video ID도 invalid 처리한다. 따라서 계획서가 금지한 “진행 중/예정 live를 완료 longform 분모에 넣는 것”은 **보이는 patch 경로에서는 닫혀 있다.** fileciteturn0file0 fileciteturn0file1

다만 이 파일은 `kind=patch`다. 실제 membership 파일을 누가 생성·서명·고정하는지, 원영상 metadata와 membership의 duration/live-status를 실제 provider에서 다시 확인하는지, 같은 byte snapshot에 대한 inventory lineage가 전체 파일에서 어떻게 강제되는지는 이 발췌만으로 완결할 수 없다. 따라서 “membership schema 검사가 source-level로 강화됨”과 “실제 전체 영상 inventory가 옳음”을 구분해야 한다.

### provider GET eligibility에 response lineage equality가 보이지 않는다

**TZ-TH-009 — 중간·조건부 — `backend/knowledge_graph/longform_analysis.py::_known_segment_disposition`.**

변경된 코드는 non-succeeded receipt에서 observation 파일을 읽고 `receipt.observationSha256 == digest(observation)`인지 확인한 다음, validation된 observation에 대해 다음과 같은 의미의 predicate로 provider GET eligibility를 부여한다.

`responseId is not None && operation ∈ {generate, readback}`

이것은 **관찰 파일이 receipt가 기록한 hash와 일치한다는 점**과 **responseId가 존재한다는 점**은 증명하지만, 보이는 patch만으로는 그 responseId가 바로 이 segment/request가 원래 생성한 provider response의 ID와 동일하다는 것을 증명하지 않는다. fileciteturn0file1

반례는 cross-swap이다.

`request A receipt + request B의 valid observation(responseId=B) → receipt의 observationSha256이 B observation에 맞도록 함께 존재 → observation schema 자체는 valid → operation='generate' → providerGetEligible=true`

물론 **전체 파일의 다른 함수가 request identity와 responseId equality를 이미 강제한다면 이 반례는 닫힌다.** 첨부가 patch이므로 그 가능성을 배제하지 않으며, 그래서 TZ-TH-009는 확정 결함이 아닌 CONDITIONAL이다. 그러나 계획서 자체가 “올바른 response ID에 한정”을 명시하고 있으므로, 그 equality가 `_known_segment_disposition`에 전달되는 immutable evidence에서 확인 가능해야 한다. fileciteturn0file0

최소 수정은 최초 generate 결과에서 `(videoId, segment/inputSha256, configSha256, provider responseId, operation/request identity)`를 immutable receipt lineage에 기록하고, GET 허용 시 observation의 `responseId`가 그 값과 **정확히 동일**해야 하도록 만드는 것이다. 단순 파일 hash binding은 “그 파일이 이 hash다”를 증명할 뿐 “provider ID가 이 request에서 나온 것이다”를 자동으로 증명하지 않는다.

회귀는 두 성공 request A/B의 observation을 의도적으로 교환해 A가 B의 response ID로 GET하지 못하는지 검사해야 한다. `responseId=null`, 다른 response ID, operation 이름만 `generate`인 위조 observation, rejected observation, readback observation, receipt/observation hash mismatch도 각각 별도 case가 필요하다. **실제 provider에 유료 GET을 보내는 검사는 여기서 수행하지 않았으며, mock/synthetic 분류를 과금 증거로 승격해서는 안 된다.**

### runtime closure는 이 묶음으로 production 수준까지 확인할 수 없다

`longform_analysis.py` 발췌에서 receipt/observation binding mismatch는 `readback_required`와 `providerGetEligible:false`로 떨어지고, confirmed rejected state는 terminal rejected로 닫히는 fail-closed 방향을 확인할 수 있다. 이는 uncertain provider result를 성공으로 섞는 것을 막는 좋은 경계다. fileciteturn0file1

하지만 R06에서 요구하는 더 넓은 runtime closure, 즉 취소된 attempt, timing-invalid attempt, worker/process 종료, executor closure, CI queue/runner 점유 시간, 생성→마지막 완료 critical path, performance 표본 독립성은 첨부된 `longform_analysis.py` patch 몇십 줄로 검증할 수 없다. 계획서의 “기존 원격 HEAD 주요 CI 성공”도 dirty 수정, 최신 develop CI, 운영 배포, 메뉴 readback과 명시적으로 분리돼 있다. 따라서 이 thesis에서는 **R06에 대한 새로운 확정 결함을 만들지 않는 대신, production/performance closure를 UNVERIFIED로 유지**한다. fileciteturn0file0

어떤 latency·처리량·금액·OCR 정확도 향상도 이번 자료에서 측정하지 않았으므로 그런 수치를 추정하지 않는다.


## 최종 판정과 반대 감사 포인트

### 현재 안전하다고 볼 수 있는 부분

R01에서는 부모가 lease ID를 먼저 정하고 ambiguous partial-output 실패에서 같은 ID를 release하는 방향, 정상 work 종료의 `finally` release, Python release의 idempotent delete, PID뿐 아니라 process-birth identity로 stale owner를 판단하는 설계가 좋다. 첨부 기존 abort test도 **commit된 waiting child를 SIGTERM으로 끝내고 같은 lease를 한 번 논리적으로 정리하는 경로**를 명시적으로 검사한다. 다만 이것이 TZ-TH-001~003의 다른 failure classes를 닫지는 않는다. fileciteturn0file1

R02에서는 사진 교체 시 OCR generation을 invalidate하고 controller를 abort하며 result ref/revision을 함께 비우는 점, 결과 ID 두 개를 검증 후 함께 bind하는 점, AI mode UI에서 분석 중 submit을 막는 점은 안전한 방어다. 리뷰 상한 4,000자를 UI와 submit 경계 양쪽에 도입한 것도 과다 저장을 허용하는 방향의 오류는 아니다. fileciteturn0file1

R03 Sheet 경로의 “focus가 이미 외부 element로 이동했으면 복원하지 않는다”는 ownership 원칙은 계획과 정렬돼 있다. fileciteturn0file1

R04 successor는 trigger enabled 상태, exact definition, exact function identity/body hash, function metadata와 ACL을 함께 보려는 구조라서 이름·부분 문자열 기반 readiness보다 훨씬 강한 fail-closed contract다. fileciteturn0file1

R05의 visible membership patch는 completed longform과 active/upcoming live를 구분하며 중복/부적절한 duration 상태를 거부한다. receipt↔observation hash mismatch도 provider GET을 허용하지 않는다. fileciteturn0file1

### 실제 결함

**TZ-TH-001**은 definite acquire rejection protocol이 commit의 부재를 실제로 증명하지 않는 문제다. 로컬 synthetic에서 commit된 lease가 release 없이 남는 것을 재현했다.

**TZ-TH-002**는 release debt에 broken runner environment까지 고정하여 건강한 다음 runner가 있어도 debt를 drain할 수 없는 문제다. 역시 실제 module로 재현했다.

**TZ-TH-003**은 abort가 spawn-failure error보다 먼저 관측될 때 `childStarted=false` 정보가 사라져 fictitious release debt로 바뀔 수 있는 race다. Node event semantics와 소스 제어 흐름이 맞물린 문제다. citeturn4view0

**TZ-TH-004**는 가장 중요한 application-level 결함이다. readiness await를 사이에 둔 B0/B1 전체 입력 equality가 없고, stale click-time values와 live mode ref가 섞인 채 upload/write가 시작될 수 있다. 사후 `changedDuringSave`는 사용자 경험 회복에는 도움이 되지만 side effect 방지 fence가 아니다. fileciteturn0file1

**TZ-TH-005**는 persisted normalized review와 max-length 검사 기준이 다른 낮은 심각도의 계약 불일치다.

### 조건부 위험

**TZ-TH-006** inline focus는 실제 React/Radix timing을 synthetic render로 재현하기 전까지 조건부다. Sheet의 외부-focus 보존은 source상 양호하다.

**TZ-TH-007**은 실제 대상 DB에서 `postgres`가 superuser인지와 successor의 deny predicate가 실제 어떤 role 집합을 대상으로 하는지에 의존한다. 조건이 성립하면 false-ready가 아니라 **permanent-held** 형태의 admission 결함이다. PostgreSQL superuser의 permission bypass 자체는 공식 동작이다. citeturn3search2

**TZ-TH-009**는 전체 `caption_osk_adapter.py`/`longform_analysis.py`의 생략된 문맥에서 response lineage equality를 이미 검사하는지에 따라 닫힐 수 있다. patch에 보이는 GET predicate만으로는 다른 request의 response ID를 배제한다는 증거가 부족하다. fileciteturn0file1

### 자료 부족으로 미검증인 부분

다음은 이번 첨부만으로 **확정해서는 안 된다**.

실제 PG17.6 catalog replay 성공, 실제 97→102 admission과 rollback/reapply 결과, 별도 develop migration105 ledger의 정확성, 1440/834/390px 실제 focus/rendering, 전체 원본 영상 membership 정확성, 실제 provider response ownership, 실제 Storage upload/readback, 실제 과금·quota, 운영 배포/운영 menu readback, CI의 최신 dirty/develop closure, production latency·비용·정확도 개선은 모두 미검증이다. 계획서에 과거 로컬/clone 결과가 적혀 있다는 사실과 내가 그 결과를 재실행해 확인했다는 것은 전혀 다른 주장이다. fileciteturn0file0

특히 **migration105 ledger는 successor102 ledger와 합치지 않았다.** migration105가 더 최신이라는 사실만으로 successor102의 증거가 보강되거나, 반대로 이번 successor102 finding이 migration105에도 그대로 존재한다고 볼 수 없다.

### Gemini 반대 감사가 가장 먼저 공격해야 할 주장

Gemini 측 반대 감사에서 가장 가치 있는 공격면은 **TZ-TH-001의 “definite” 의미**다. “canonical Python에서는 sentinel이 commit 이후 나올 수 없다”는 반론을 세우고, `db.commit()` 이후 `print()`/flush 오류와 broad `OSError` catch까지 포함해 실제로 이를 증명하거나 깨야 한다. custom `RUN_DAILY_PYTHON`을 신뢰 경계 밖이라고 주장한다면, 그 환경 변수가 production에서 누가 제어하는지와 canonical runner attestation이 어디 있는지 제시해야 한다. fileciteturn0file1

두 번째는 **TZ-TH-004**다. 반대 측은 “React state가 바뀌어도 submit closure가 old draft를 저장하는 것이 의도된 snapshot semantics”라고 주장할 수 있다. 그러나 master plan이 명시적으로 `B0=B1`을 요구하고, readiness 사이 input mutation이면 upload/save를 시작하지 않아야 한다고 정의했기 때문에, 현재의 사후 changed-during-save 처리로는 그 반론이 계획 계약과 양립하지 않는다. 이 finding을 깨려면 실제 full-file에서 readiness 이전 UI mutation을 잠그거나, side effect 직전 모든 input revision을 다시 비교하는 다른 fence를 보여야 한다. fileciteturn0file0 fileciteturn0file1

세 번째는 **TZ-TH-007**이다. 실제 PG17.6 clone의 `pg_roles`·`proacl`·`has_function_privilege` readback을 제시해 `postgres` 조건이 satisfiable함을 보여주면 이 conditional finding은 REJECT할 수 있다. 반대로 `postgres.rolsuper=true`인데 deny predicate에 포함된다면 readiness 결과와 SQL의 boolean logic을 직접 설명해야 한다. PostgreSQL의 superuser permission 모델은 반론으로 바꿀 수 없는 전제다. citeturn3search2turn3search0

네 번째는 **TZ-TH-009**다. 전체 소스에서 provider response ID가 request identity에 이미 cryptographically/hash-bound 되어 있다는 호출 경로를 제시하면 conditional finding은 닫힌다. 단순 `observationSha256` equality만으로는 부족하며, **그 observation 안의 response ID가 어느 generate request에 속하는지**까지 이어져야 한다.

### 최종 역검증 체크리스트

최종 ChatGPT 역검증에서는 다음 순서로 판정하는 것이 가장 효율적이다.

| 역검증 대상 | ACCEPT 조건 | REJECT에 필요한 counter-proof |
|---|---|---|
| **TZ-TH-001** | commit된 lease + definite tuple에서 release가 생략됨 | canonical 모든 code-1/sentinel/empty-stdout 경로가 commit-before-output을 수학적으로 배제하거나, 부모가 그런 경우에도 release함을 실행 증명 |
| **TZ-TH-002** | old broken runner debt가 new healthy runner를 차단 | 새 runner가 옛 scope/lease debt를 실제 drain하는 native test |
| **TZ-TH-003** | abort-before-spawn-error에서 childStarted 정보 유실 | ENOENT+abort race test에서 debt가 생기지 않는 실행 결과 및 해당 소스 경로 |
| **TZ-TH-004** | readiness 중 단일 input mutation 뒤 stale upload/write 발생 | 모든 save-affecting input에 대해 side effect 전 revision/equality fence가 있음을 full-file과 deferred-readiness test로 증명 |
| **TZ-TH-006** | inline unmount/frame timing에서 focus 탈취 | 실제 synthetic DOM/Radix test로 search ownership 유지 |
| **TZ-TH-007** | target catalog role 속성 때문에 readiness permanent-held | PG17 clone의 `rolsuper`, ACL, `has_function_privilege`, capability 결과를 같은 snapshot으로 제시 |
| **TZ-TH-008** | source test만 있고 executable catalog receipt 없음 | hash-bound 실제 PG17 replay artifact와 before/after drift matrix |
| **TZ-TH-009** | 다른 request response ID가 GET eligible이 됨 | expected response ID가 immutable originating request lineage에 묶이고 equality가 GET 전 강제됨을 full context로 증명 |

최종 release 판정에서는 **로컬 native test**, **synthetic rendering**, **실제 PG17 catalog replay**, **실제 provider/Storage readback**, **운영 배포/청구 증거**를 하나의 “tests passed” 항목으로 합치면 안 된다. 각각 다른 실패 모델을 다룬다. 현재 자료 기준으로는 **source-level로 안전한 부분은 적지 않지만, R01과 R02에 실제 수정이 필요한 결함이 남아 있고, R04는 fail-closed 구조가 좋아졌음에도 실제 catalog admission 증거가 이 thesis에 포함되지 않았으므로 production-ready라는 결론은 아직 성립하지 않는다.** fileciteturn0file0 fileciteturn0file1