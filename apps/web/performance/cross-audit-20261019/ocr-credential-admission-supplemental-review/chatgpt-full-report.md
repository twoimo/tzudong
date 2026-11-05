# OCR credential-release 및 operating admission 독립 검토 보고서

## 범위와 판정 요약

본 검토는 첨부된 `plan.md`와 UI상 `source_bundle(9).txt`로 표시된 동일 source bundle만을 기준으로, 동결 revision `14a8f5da4268df890c7adf10bf89e99ce071f6f5`의 **두 결정만** 독립적으로 판정했다. 로컬 파일에 대해 확인한 SHA-256은 plan `b46b396329f7958305cb121e9c6db7772b49204a4085093a6af6f5709a85ac2b`, source bundle `90c4e3f0540c90d4be1f9ea1439538e73feddaf79790e0cdb90ebcd179921866`로 요청에 적힌 값과 일치한다. 이후 `7d04fca8`이나 현재 로컬에서 수정 중이라는 반례 수정본은 검증 대상으로 간주하지 않았다. 또한 이 결과는 기존 thesis/Gemini 연구의 재실행도, 그 연구의 “최종 역검증”도 아니다. fileciteturn0file0 fileciteturn0file1

| 결정 | 판정 | 핵심 이유 |
|---|---|---|
| 확정 credential 거절 후 exact-claim release | **REJECT** | SQL의 exact-token·idempotent release 자체는 강하지만, 현재 TypeScript의 `definitiveCredentialRejection`이 **전체 provider/model 이력의 release-safety가 아니라 마지막 credential-rejection 사건을 표현할 수 있다.** 모델 A가 정상 응답을 반환한 뒤 parse 실패하고 모델 B가 credential rejection을 반환하면 frozen source는 `definitiveCredentialRejection=true`에 도달하여 이미 `possibly_dispatched`인 durable claim을 잘못 release할 수 있다. |
| post-seal ACL equality를 operating admission으로 사용하는 것 | **REJECT** | post-seal drift 검출은 작동하지만, migration은 생성 직후의 ACL 자체를 독립 canonical allowlist와 비교하지 않고 그것을 그대로 seal한다. 따라서 creator default ACL로 처음부터 들어간 금지 grant가 seal에 포함되면 이후 equality는 계속 참이고 `ready`가 가능하다. |

첫 번째 결정에서 **REJECT의 원인은 release SQL의 stale-token/ACK 처리 자체가 아니다.** 그 SQL은 exact claim에 대해 상당히 잘 방어되어 있다. 실패 지점은 그 강한 primitive를 호출해도 된다는 애플리케이션 측 증명이다. 두 번째 결정에서도 **REJECT의 원인은 post-seal equality가 drift를 못 잡는다는 것이 아니다.** equality는 실제 post-seal 변조를 잡는다. 문제는 “처음 봉인한 상태가 허용된 상태인가”라는 독립 admission predicate가 없다는 점이다. 이 구분은 source bundle 자체의 독립 검토 evidence가 명시한 경계와도 일치한다. fileciteturn0file1

## 확정 credential 거절 release 판정

### 판정: REJECT

**범위 한 문장:** `release_receipt_ocr_definitive_credential_rejection(result_id, claim_token)`의 DB 상태 전이는 exact-token과 idempotency 면에서는 수용 가능하지만, frozen application source가 그 release를 승인하는 `GeminiOcrError.definitiveCredentialRejection`을 혼합 model history에서 과도하게 참으로 만들 수 있으므로 전체 결정은 **REJECT**다. fileciteturn0file1

### 실제 실행 순서

핵심 호출 경로는 다음과 같다.

```text
/api/ocr/extract 또는 /api/ocr/extract/stream
  └─ executeDurableReceiptOcr(...)
       ├─ store.assertDefinitiveCredentialReleaseReady()
       │    └─ public.get_receipt_ocr_credential_release_capability()
       ├─ store.claim(...)
       │    └─ claim_receipt_ocr_result(...)
       │         processing + reserved + claim_token = τ
       ├─ beforeProvider()
       │    └─ 사용자 extract 경로: reserve_ocr_daily_quota(...)
       ├─ store.markDispatched(...)
       │    └─ processing + possibly_dispatched + τ
       └─ runProvider()
            └─ callGeminiReceiptOcrWithCredentialFallback(...)
                 └─ callGeminiReceiptOcr(...)
                      └─ model A, B, ...

GeminiOcrError(... definitiveCredentialRejection=true)
  └─ executeDurableReceiptOcr catch
       └─ store.releaseDefinitiveCredentialRejection(...)
            └─ public.release_receipt_ocr_definitive_credential_rejection(id, τ)
                 └─ ocr_private.release_receipt_ocr_definitive_credential_rejection(id, τ)
```

정확한 application source는 `apps/web/lib/ocr/durable-result.ts`의 `createSupabaseDurableReceiptOcrStore()`와 `executeDurableReceiptOcr()`이다. `executeDurableReceiptOcr()`는 먼저 capability getter를 요구하고, claim을 얻은 뒤 `beforeProvider`를 실행하며, 그 다음 **provider를 호출하기 전에** `markDispatched()`를 수행한다. provider 예외가 `GeminiOcrError && error.definitiveCredentialRejection`이면 `releaseDefinitiveCredentialRejection()`을 호출하고, 그 이외의 provider 실패는 `markIndeterminate()`로 보낸다. frozen bundle의 해당 위치는 `durable-result.ts` 약 383–397, 427–459, 587–653이다. fileciteturn0file1

durable predecessor인 `backend/supabase/migrations/20261013190000_durable_receipt_ocr_results.sql`의 상태 전이는 다음처럼 읽힌다. 새 claim은 `processing/reserved/τ`로 들어가고, `mark_receipt_ocr_dispatched`가 exact token에 대해 `possibly_dispatched`로 바꾼다. 불확실한 provider 실행은 `mark_receipt_ocr_result_indeterminate`에서 payload가 없으면 `indeterminate/uncertain`, 기존 성공 payload를 보존한 force refresh라면 `succeeded/uncertain`으로 닫힌다. 또한 이미 `possibly_dispatched`인 processing row에 대한 force refresh는 그것을 uncertain으로 전환하고 다시 provider를 호출하지 않는다. 즉 predecessor의 기본 설계는 “provider dispatch 여부가 불확실하면 replay하지 않는다”는 fail-closed fence다. fileciteturn0file1

이를 식으로 쓰면, definitive release가 안전하려면 적어도 다음 두 조건이 모두 참이어야 한다.

\[
\text{ReleaseSafe}(\tau,H)
=
\underbrace{
(status=\texttt{processing})
\land
(stage=\texttt{possibly\_dispatched})
\land
(claim\_token=\tau)
}_{\text{exact active claim}}
\land
\underbrace{
\forall a\in H,\;
a=\text{definitive credential rejection before provider response}
}_{\text{whole provider history}}
\]

DB 함수는 첫 번째 conjunct를 강하게 검사한다. 현재 application classifier는 두 번째 conjunct를 전체 이력에 대해 증명하지 않는다.

### SQL exact-claim primitive 자체는 stale ACK에 안전하다

`backend/supabase/migrations/20261018152032_receipt_ocr_definitive_credential_rejection_release.sql`의 `ocr_private.release_receipt_ocr_definitive_credential_rejection(uuid,uuid)`는 다음 순서다.

`result_id` 기준 advisory transaction lock을 획득하고, 먼저 `(result_id, claim_token)`의 과거 release receipt가 있는지 찾는다. 있다면 현재 `receipt_results`를 수정하지 않고 저장된 disposition/revision을 `idempotent=true`로 반환한다. 없다면 `receipt_results`를 `FOR UPDATE`로 잠그고, 오직 `processing + possibly_dispatched + exact claim_token`인 경우에만 진행한다. 기존 payload가 없으면 release receipt를 만든 뒤 row를 exact predicate로 DELETE하고, force refresh에서 보존된 payload/revision이 있으면 exact predicate로 `succeeded/completed/claim_token=NULL`로 복원한다. UPDATE/DELETE가 실제로 일어나지 않으면 mismatch exception이다. 이 모든 동작은 한 transaction 안에 있다. fileciteturn0file1

따라서 storage primitive만 떼어 놓으면 다음 세 경우는 잘 방어된다.

| 경우 | frozen SQL 결과 |
|---|---|
| release가 commit됐지만 응답 ACK만 유실 | 같은 `(result_id, τ)` 재호출은 release receipt를 찾아 `idempotent=true`; 상태 재수정 없음 |
| 오래된 release가 새 claim `τ₂`가 활성화된 뒤 도착하고, 과거 receipt가 존재 | 과거 receipt만 반환; 새 claim을 건드리지 않음 |
| 오래된 release가 과거에 commit되지 않았고 현재 token이 `τ₂` | 현재 row의 token 불일치로 `receipt_ocr_claim_mismatch`; 새 claim overwrite 불가 |

`backend/supabase/tests/receipt_ocr_definitive_credential_rejection_release.sql`도 deleted/restored release, repeat/idempotent release, stale ACK 후 second release, wrong state/token과 inter-session race를 직접 다룬다. `apps/web/tests-unit/durable-receipt-ocr.test.ts`에도 “committed definitive release acknowledgement is lost”, “repeated rejected refreshes while a stale release replay cannot overwrite the new claim” 등이 있다. 그러므로 **stale ACK와 exact-token primitive가 REJECT의 원인이 아니다.** fileciteturn0file1

### 결정적인 반례: 모델 A response → parse failure → 모델 B credential rejection

frozen `apps/web/lib/ocr/gemini.ts`가 문제를 만든다.

`callGeminiReceiptOcr()`는 각 model마다 `providerResponseReceived=false`로 시작한다. `generateContent`가 문자열을 반환하는 순간 이를 `true`로 바꾼 뒤 `extractJsonObject()`와 `normalizeReceiptOcrData()`를 실행한다. 따라서 **provider가 정상적으로 응답을 반환했으나 payload parsing이 실패**할 수 있다. catch에서는 `providerResponseReceived`가 true이면 credential rejection으로 보지 않지만, `fallbackSafe = providerResponseReceived || status===400 || status===404`이므로 다음 선언 model로 진행한다. frozen source의 핵심은 `gemini.ts` 약 236–264다. fileciteturn0file1

이제 동일 credential의 다음 model B가 구조화된 API-key rejection을 반환한다고 하자. `isDefinitiveGeminiCredentialRejection()`은 numeric HTTP `400/401/403`과 제한된 structured code/reason 조합만 인정한다. model B에는 아직 provider model response가 없으므로 `!providerResponseReceived && isDefinitive...`가 true가 되고, 함수는 **그 시점까지 누적된 attempts 전체를 담으면서도** `new GeminiOcrError(attempts, true)`를 던진다. 즉 attempts에는 model A의 parse failure가 들어 있지만 boolean은 model B의 마지막 사건만으로 true가 된다. fileciteturn0file1

구체적 순서는 이렇다.

```text
τ claim
  processing/reserved
        │
        ├─ daily quota reservation (일반 extract 경로)
        │
        └─ markDispatched(τ)
              processing/possibly_dispatched
                      │
                      ▼
            model A provider call
                      │
                      ├─ provider response RETURNED
                      ▼
              parsing/normalization fails
                      │
                      └─ fallbackSafe = true
                              │
                              ▼
                    model B provider call
                              │
                              └─ API_KEY_INVALID / definitive rejection
                                      │
                                      ▼
                            GeminiOcrError(..., true)
                                      │
                                      ▼
                    executeDurableReceiptOcr catch
                                      │
                                      ▼
            releaseDefinitiveCredentialRejection(id, τ)
                                      │
                   ┌──────────────────┴──────────────────┐
                   ▼                                     ▼
             no old payload                        force refresh
                DELETE                       restore old succeeded payload
                   │                                     │
                   └──────── replay fence removed ───────┘
```

이 경로는 **현재 frozen source에서 잘못된 definitive release에 도달한다.** model A에서 provider response가 이미 반환되었으므로 해당 durable execution을 “provider가 아무 inference outcome도 반환하지 않은 pure credential rejection”으로 취급할 수 없다. 그런데 model B의 credential rejection이 그 이전 사실을 boolean에서 지워 버린다. 그 결과 no-payload case에서는 row 자체가 삭제되어 차후 동일 durable binding의 새 request가 새 claim을 만들 수 있고, force-refresh case에서는 기존 succeeded payload를 `completed` 상태로 복원하여 uncertainty fence를 제거한다. 이 때문에 durable replay safety에 관한 강한 주장을 유지할 수 없다. fileciteturn0file1

반대로 **credential A definitive rejection → credential B transport/timeout/cancellation** 순서는 현재 코드가 fail-closed다. credential wrapper는 첫 credential rejection에는 rotate하지만 다음 credential이 non-definitive error로 끝나면 최종 `definitiveCredentialRejection=false`를 던지고, durable layer는 `markIndeterminate()`로 간다. `gemini-ocr.test.ts`의 `preserves prior bounded attempts when a rotated credential has an uncertain failure`가 이 경우를 이미 직접 확인한다. fileciteturn0file1

따라서 문제의 본질은 “credential rotation은 모두 위험하다”가 아니라 더 좁다.

> **이미 response-returned/non-definitive history가 존재한다는 사실이, 이후 model/credential의 definitive credential rejection으로 다시 `release-safe=true`가 될 수 있다는 점**이 결함이다.

### 현재 테스트가 반례를 놓치는 이유

`apps/web/tests-unit/gemini-ocr.test.ts`의 `does not rotate after a provider response is received but cannot be parsed`는 유용하지만 **model policy가 단일 model**이다. provider가 non-JSON 응답을 반환하고 parsing이 실패한 뒤 함수가 최종 false가 되는 것은 확인하지만, 그 사이에 같은 credential의 두 번째 model이 존재하는 경우를 만들지 않는다. 따라서 다음 조합은 빠져 있다.

```text
GEMINI_OCR_MODEL="model-a,model-b"

model-a -> returned text -> parse failure
model-b -> structured API_KEY_INVALID
                         ↓
             definitiveCredentialRejection == true   // frozen bug
```

`durable-receipt-ocr.test.ts`의 definitive-release tests도 대부분 `new GeminiOcrError(..., true)`를 합성하여 storage behavior를 검증하므로, 그 `true`가 실제 provider-history invariant를 만족하는지까지 검증하지 않는다. SQL fixture는 당연히 application provider history를 알 수 없다. 즉 현재 suite는 **release mechanism**은 강하게 검증하지만 **release authorization provenance**를 직접 결합 검증하지 않는다. fileciteturn0file1

## credential release의 최소 패치와 검증 gate

### 필요한 최소 source invariant

최소 조건은 `definitiveCredentialRejection` 하나에 **두 의미를 겹치지 않는 것**이다.

현재 boolean은 사실상 다음 두 용도로 쓰인다.

1. “현재 credential을 버리고 다음 credential로 rotate해도 되는가?”
2. “전체 durable claim을 exact-claim release해 replay fence를 제거해도 되는가?”

두 질문은 동일하지 않다. 첫 번째는 마지막 provider fault의 분류일 수 있지만, 두 번째는 **전체 provider/model history에 대해 monotonic**해야 한다.

가장 작은 안전 조건은 예를 들어 다음과 같다.

```diff
 export class GeminiOcrError extends Error {
   attempts: ReceiptOcrAttempt[];
   definitiveCredentialRejection: boolean;
+  exactClaimReleaseSafe: boolean;

-  constructor(attempts, definitiveCredentialRejection = false) {
+  constructor(
+    attempts,
+    definitiveCredentialRejection = false,
+    exactClaimReleaseSafe = false,
+  ) {
     ...
   }
 }
```

그리고 model history에서:

```diff
+ let exactClaimReleaseSafe = true;

 for (const model of models) {
   let providerResponseReceived = false;

   try {
     const text = await generate(...);
     providerResponseReceived = true;
     ...
   } catch (error) {
     const definitive =
       !providerResponseReceived
       && isDefinitiveGeminiCredentialRejection(error);

+    if (!definitive) {
+      exactClaimReleaseSafe = false;
+    }

     if (definitive) {
-      throw new GeminiOcrError(attempts, true);
+      throw new GeminiOcrError(
+        attempts,
+        true,                  // credential-rotation predicate
+        exactClaimReleaseSafe // whole-history release predicate
+      );
     }
     ...
   }
 }
```

credential rotation wrapper도 이전 credentials의 history를 AND 방식으로 누적해야 한다.

```diff
+ let aggregateReleaseSafe = true;

 catch (error) {
   if (!(error instanceof GeminiOcrError)) throw error;

+  aggregateReleaseSafe =
+    aggregateReleaseSafe && error.exactClaimReleaseSafe;

   if (!error.definitiveCredentialRejection || isLastCredential) {
     throw new GeminiOcrError(
       [...priorAttempts, ...error.attempts],
       error.definitiveCredentialRejection,
+      aggregateReleaseSafe,
     );
   }

   priorAttempts.push(...error.attempts);
 }
```

마지막으로 durable layer는 **credential rotation flag가 아니라 whole-history release flag**를 사용해야 한다.

```diff
- if (error instanceof GeminiOcrError
-     && error.definitiveCredentialRejection) {
+ if (error instanceof GeminiOcrError
+     && error.exactClaimReleaseSafe) {
     await input.store.releaseDefinitiveCredentialRejection(claimInput);
 }
```

이 diff는 이름과 구체 타입 설계의 예시이며, 필수 조건은 이름 자체가 아니라 다음 invariant다.

\[
releaseSafe_{n+1}
=
releaseSafe_n
\land
definitiveCredentialRejectionBeforeResponse_{n+1}
\]

한 번이라도 response-returned parse failure, transport uncertainty, timeout, cancellation 또는 그 밖의 non-definitive outcome이 들어가면 같은 durable claim에서 release-safe가 다시 `true`로 돌아가서는 안 된다.

여기서는 **provider fallback/credential retry 횟수를 늘리는 패치를 제안하지 않는다.** 기존 retry policy를 넓히지 않고 release admission만 더 엄격하게 만드는 것이 최소 변경이다. fileciteturn0file1

### 필수 직접 regression sequence

최소 gate는 다음 sequence를 실제 provider wrapper 레벨에서 고정해야 한다.

```ts
// 반드시 2개 모델이어야 한다.
models = ['model-a', 'model-b'];

// model A
return 'synthetic non-json provider response';

// model B
throw structuredApiKeyInvalid400();
```

기대값:

```text
provider calls                   = 2
credential rejection last cause  = true
exactClaimReleaseSafe            = false
release RPC calls                = 0
markIndeterminate calls          = 1
```

그리고 같은 sequence를 force refresh에 한 번 더 적용해야 한다.

```text
initial state:
  succeeded/completed
  payload=P
  revision=R

force-refresh claim:
  processing/reserved -> possibly_dispatched

model A:
  provider response returned, parsing fails

model B:
  definitive credential rejection

required terminal state:
  succeeded/uncertain
  payload=P
  revision=R
  retry blocked

forbidden terminal state:
  succeeded/completed   // definitive release "restored"
```

no-payload 최초 분석에서는 terminal state가 `indeterminate/uncertain`이어야 하고 row가 삭제되어서는 안 된다.

기존 `credential1 definitive rejection → credential2 transport uncertainty` test, committed-release ACK-loss test, stale old-token release test는 그대로 유지해야 한다. **이 버그에 SQL patch는 필요하지 않다**는 것이 현재 source에 대한 최소 결론이다. SQL의 exact-token release를 변경하기보다 그 RPC의 호출 자격을 바로잡는 것이 더 작은 수정이다. fileciteturn0file1

### at-most-once, provider 호출, 과금, quota는 별개다

여기서 네 개 개념을 분리해야 한다.

| 개념 | frozen source가 말해 주는 것 |
|---|---|
| durable at-most-once/replay fence | `possibly_dispatched` 이후 uncertain outcome을 재호출하지 않도록 하는 DB 상태 설계가 있음. 문제의 mixed-history release가 이 fence를 잘못 제거할 수 있음 |
| provider call count | **한 durable execution이 한 provider call이라는 보장은 없음.** model fallback과 credential rotation으로 여러 호출 가능 |
| provider billing/usage | 첨부 source로 확정할 수 없음. credential rejection·returned response·failed parse가 무료/비과금이라는 가정 금지 |
| application daily quota | 일반 `/api/ocr/extract` 및 `/stream`에서는 `beforeProvider`에서 `checkOcrDailyQuota()` → `reserve_ocr_daily_quota(p_operation_id)`를 **provider dispatch 전에 한 번** 호출하고, 그 뒤 하나의 `runProvider` 안에서 여러 model/credential calls가 가능함 |

따라서 일반 extract 요청에서는 **하나의 application quota reservation이 여러 model/credential provider attempts를 포괄할 수 있다.** 이는 application quota accounting에 관한 코드 사실이지 provider billing 횟수나 금액과 동치가 아니다. `apps/web/lib/ocr/quota.ts`의 `checkOcrDailyQuota`, 두 extract route의 `beforeProvider`, 그리고 `gemini.ts`의 model/credential loops가 이를 보여 준다. `apps/web/lib/ocr/admin-receipt-processor.ts`는 동일 durable/provider 경로를 사용하지만 이 bundle에서 user-route의 `checkOcrDailyQuota` 호출과 동일한 daily quota reservation을 호출하는 경로로 나타나지 않으므로, user API quota 결론을 admin 경로까지 일반화하면 안 된다. 금액·속도·quota 절감량은 추정하지 않는다. fileciteturn0file1

## ACL equality와 initial admission 판정

### 판정: REJECT

**범위 한 문장:** 현재 migration/getter는 봉인 이후 owner/definition/ACL/table contract drift를 상당히 강하게 검출하지만, **봉인 당시 ACL이 독립적으로 허용된 ACL인지 검사하지 않으므로 creator default privilege로 처음부터 과권한인 객체도 그 상태 그대로 seal되고 이후 `ready`가 될 수 있다.** fileciteturn0file1

### equality가 실제로 하는 일

`backend/supabase/migrations/20261018152032_receipt_ocr_definitive_credential_rejection_release.sql`은 네 function과 두 table의 contract를 JSON으로 snapshot한다.

Functions:

```text
public.release_receipt_ocr_definitive_credential_rejection(uuid,uuid)
ocr_private.release_receipt_ocr_definitive_credential_rejection(uuid,uuid)
public.get_receipt_ocr_credential_release_capability()
ocr_private.get_receipt_ocr_credential_release_capability()
```

Tables:

```text
ocr_private.receipt_credential_rejection_releases
ocr_private.receipt_credential_release_catalog_contract
```

function snapshot에는 definition SHA-256, language, volatility, owner, normalized ACL이 들어간다. table snapshot에는 owner와 normalized ACL이 들어간다. ACL은 각각 `aclexplode(coalesce(proacl, acldefault('f', proowner)))`, `aclexplode(coalesce(relacl, acldefault('r', relowner)))` 형태로 정규화된다. capability getter는 runtime에서 같은 값을 다시 계산하여 sealed `function_contract` 및 `table_contract`와 exact equality로 비교한다. fileciteturn0file1

PostgreSQL의 `acldefault()`는 ACL catalog 값이 NULL일 때 가정되는 built-in default ACL을 구성하고, `aclexplode()`는 ACL item을 grantor/grantee/privilege/grantable 단위 행으로 전개한다. 따라서 이 표현은 catalog ACL 비교에는 적절하지만, **그 ACL이 애초에 정책상 허용된 ACL인지 자체적으로 정의하지는 않는다.** citeturn1search3

migration 후반의 contract insert는 그 시점의 객체를 그대로 읽어 seal의 초기 snapshot으로 넣는다. successor compiler `apps/web/scripts/receipt-ocr-post105-sql-successor.mjs`의 `buildCatalogSealSql()`은 이후 ledger identity fields와 `sealed_at`를 채운 뒤 getter가 `ready`인지 확인하지만, seal 전에 “현재 ACL = 별도로 하드코딩된 canonical privilege allowlist”라는 검사는 하지 않는다. 즉 논리는 다음과 같다.

\[
Ready =
(CurrentCatalog = SealedCatalog)
\land LedgerMatch
\land OtherChecks
\]

필요한 것은 다음인데 현재 source에는 독립 항이 빠져 있다.

\[
Ready_{required} =
(CurrentCatalog = SealedCatalog)
\land
(CurrentACL \in CanonicalAllowlist)
\land
(ExpectedOwner)
\land
LedgerMatch
\land OtherChecks
\]

fileciteturn0file1

### creator default ACL과 post-seal drift가 다른 이유

PostgreSQL `ALTER DEFAULT PRIVILEGES`는 **미래에 생성되는 객체**의 초기 권한을 바꾼다. 특히 객체 생성 시에는 그 순간 **current role의 default privileges**가 적용되며, current role이 다른 role의 member라고 해서 member role들의 default privilege가 합쳐지는 것은 아니다. 또한 functions의 기본 privilege는 일반적으로 `PUBLIC EXECUTE`이고 이를 `ALTER DEFAULT PRIVILEGES`로 변경하거나 추가할 수 있다. citeturn1search0turn1search2turn1search9

이 migration은 wrapper 생성 전에 실제로:

```sql
SET LOCAL ROLE privacy_workflow_owner;
```

를 수행한 다음 두 `public.*` wrapper를 생성한다. 따라서 `privacy_workflow_owner`의 function default privileges가 wrapper의 **생성 순간** ACL에 영향을 줄 수 있다. 그 뒤 migration은 wrapper에 대해 다음과 같이 특정 역할만 revoke한다.

```sql
REVOKE ALL ... FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ... TO service_role;
```

예를 들어 creator default가 이미 `supabase_admin`에게 EXECUTE를 부여하고 있었다면, 위 REVOKE는 `supabase_admin`을 대상으로 하지 않으므로 해당 ACL item은 남을 수 있다. PostgreSQL의 GRANT/REVOKE는 기존 개별 role privilege를 별도로 다루며, 특정 role들에 대한 revoke가 다른 arbitrary grantee의 grant를 제거하지 않는다. citeturn1search0turn1search5

두 private table과 private helper functions도 같은 종류의 문제를 가진다. 이들은 `postgres`가 생성하고, migration은 table ACL에서 `PUBLIC, anon, authenticated, service_role, privacy_workflow_owner`를 revoke하며 private functions에서도 제한된 principal 집합을 revoke한다. **postgres creator default ACL에 다른 principal의 grant가 이미 추가되어 있으면 그 principal은 source의 제한된 REVOKE 집합에 포함되지 않을 수 있다.** 그 grant는 이후 seal snapshot의 정상 baseline이 된다. fileciteturn0file1

따라서 다음 두 상황은 전혀 다른 속성이다.

```text
A. clean ACL at seal
   └─ later GRANT supabase_admin EXECUTE
        → current ACL != sealed ACL
        → held
        → current tests prove this

B. creator default ACL already grants supabase_admin EXECUTE
   └─ function is born over-privileged
        └─ migration does not revoke supabase_admin
             └─ over-privileged ACL itself becomes sealed ACL
                  └─ current ACL == sealed ACL
                       → equality alone does not reject it
```

source bundle에 포함된 독립 검토도 정확히 이 한계를 명시한다. “snapshot equality는 seal 이후 변경을 잡지만, initial snapshot이 독립적으로 정의된 privilege allowlist와 일치한다는 것은 증명하지 않는다”는 결론이며, creator default ACL의 forbidden explicit grant가 baseline에 들어갈 수 있다는 조건을 별도로 보존하고 있다. fileciteturn0file1

### 현재 post-seal ACL test는 유효하지만 initial-default 반례를 검증하지 않는다

`backend/supabase/tests/receipt_ocr_credential_release_catalog_readiness.sql`의 corrected wrapper ACL fixture는 의미가 있다. savepoint 안에서 `postgres`가 `privacy_workflow_owner`로 `SET ROLE`할 수 있게 임시 lease를 만들고, 실제 owner identity로:

```sql
GRANT EXECUTE ON FUNCTION
  public.release_receipt_ocr_definitive_credential_rejection(uuid,uuid)
TO supabase_admin;
```

을 실행한다. 이어 `aclexplode(...)`로 `supabase_admin EXECUTE` ACL item이 실제 생겼음을 확인한 다음 capability가 `held`인지 검사하고 rollback한다. 즉 **post-seal wrapper ACL mutation → held**는 검증되어 있다. table ACL drift와 두 table owner drift도 같은 fixture에서 negative test가 있다. fileciteturn0file1

하지만 이는 다음을 검증하지 않는다.

```text
default privilege 설치
  → object creation
  → over-privileged object
  → initial contract capture
  → ledger seal
  → capability getter
```

따라서 현재 test suite로 “installation admission이 pre-existing/default-generated forbidden ACL을 거절한다”는 주장은 할 수 없다.

### explicit ACL, effective privilege, role membership, owner, RLS를 섞으면 안 된다

capability getter에는 `has_function_privilege()` 및 `has_table_privilege()` checks도 있다. 이것은 특정 principal의 **effective privilege**를 확인하는 데 유용하지만, explicit ACL allowlist와 같은 개념은 아니다. PostgreSQL에서는 한 role의 유효 권한이 직접 grant뿐 아니라 role membership과 `PUBLIC` grant 등 여러 경로의 합일 수 있다. 따라서 initial canonical ACL을 검증할 때는 `proacl`/`relacl`을 default expansion 후 `aclexplode()`하여 **실제 ACL entries를 비교**하는 것이 맞고, superuser session에서 `has_function_privilege()`가 true라는 사실을 forbidden explicit grant 증거로 쓰면 안 된다. citeturn1search3turn1search5

RLS 또한 독립 축이다. PostgreSQL에서 superuser와 `BYPASSRLS` role은 RLS를 항상 우회하고, table owner도 보통 우회하지만 `FORCE ROW LEVEL SECURITY`로 owner를 적용 대상으로 만들 수 있다. 다만 superuser bypass는 그대로다. 따라서 PG17 local privileged harness에서 superuser의 effective access는 operating principal의 ACL admission 증거로 대체할 수 없다. citeturn1search1turn1search10

## ACL admission의 최소 패치와 직접 negative test

### 최소 independent allowlist

전체 G014 시스템을 재설계할 필요는 없다. 이 successor가 새로 만드는 **정확히 여섯 객체**만 대상으로, snapshot equality와 별개인 canonical owner/ACL predicate를 하나 두는 것으로 충분하다.

최소 owner contract는 다음이어야 한다.

| 객체 | canonical owner |
|---|---|
| `public.release_receipt_ocr_definitive_credential_rejection(uuid,uuid)` | `privacy_workflow_owner` |
| `public.get_receipt_ocr_credential_release_capability()` | `privacy_workflow_owner` |
| `ocr_private.release_receipt_ocr_definitive_credential_rejection(uuid,uuid)` | `postgres` |
| `ocr_private.get_receipt_ocr_credential_release_capability()` | `postgres` |
| `ocr_private.receipt_credential_rejection_releases` | `postgres` |
| `ocr_private.receipt_credential_release_catalog_contract` | `postgres` |

최소 ACL policy는 “현재 snapshot과 같음”이 아니라 **허용 principal 집합 외의 aclitem이 0개**여야 한다.

```text
public wrappers:
  owner = privacy_workflow_owner
  non-owner EXECUTE grantee = service_role only
  PUBLIC / anon / authenticated / supabase_admin / any other role: forbidden

private helpers:
  owner = postgres
  intended non-owner EXECUTE grantee = privacy_workflow_owner only
  service_role / PUBLIC / anon / authenticated / supabase_admin / others: forbidden

private tables:
  owner = postgres
  no non-owner table privilege ACL item
  service_role / privacy_workflow_owner / PUBLIC / anon /
  authenticated / supabase_admin / arbitrary other role: forbidden
```

owner의 정상 implicit/default privileges는 normalized representation에서 허용해야 한다. 중요한 것은 “특정 known-bad role 몇 개를 blacklist”하는 것이 아니라 **owner와 source가 명시한 required grantee만 allowlist하고 나머지 grantee를 모두 거절**하는 것이다.

이 assertion은 두 위치에 필요하다.

```diff
 migration:
   create objects
   apply REVOKE/GRANT
+  assert_exact_initial_owner_and_acl_allowlist()
   capture function_contract/table_contract

 compiler seal:
+  assert_exact_initial_owner_and_acl_allowlist()
   write ledger seal
   require getter == ready

 capability getter:
   current_contract == sealed_contract
+  AND exact_current_owner_and_acl_allowlist()
   AND ledger identity matches
   AND existing RLS/policy/function-definition checks
```

이렇게 해야 post-seal equality와 operating admission이 독립 증명이 된다. fileciteturn0file1

### 직접 negative fixture

가장 직접적인 regression은 **객체를 만들기 전에 creator default privileges를 오염시키는 것**이다.

wrapper 쪽:

```sql
ALTER DEFAULT PRIVILEGES
  FOR ROLE privacy_workflow_owner
  GRANT EXECUTE ON FUNCTIONS TO supabase_admin;
```

table 쪽도 독립적으로:

```sql
ALTER DEFAULT PRIVILEGES
  FOR ROLE postgres
  IN SCHEMA ocr_private
  GRANT SELECT ON TABLES TO supabase_admin;
```

PostgreSQL 문서상 default privileges는 미래 객체 생성 시 current creator role에 적용되므로, 이 fixture는 post-seal mutation이 아니라 바로 문제의 initial-ACL 경계를 겨냥한다. citeturn1search0

fixture는 mutation이 실제 적용되었음을 catalog로 먼저 증명해야 한다.

```sql
-- wrapper가 생성된 뒤, seal 전에
SELECT ...
FROM pg_proc p
CROSS JOIN LATERAL aclexplode(
  coalesce(p.proacl, acldefault('f', p.proowner))
) acl
WHERE p.oid =
  'public.release_receipt_ocr_definitive_credential_rejection(uuid,uuid)'::regprocedure
  AND acl.grantee = 'supabase_admin'::regrole
  AND acl.privilege_type = 'EXECUTE';

-- table도 같은 식으로 relacl/acldefault('r', ...)
```

그 뒤 patched source의 필수 결과는 둘 중 더 이른 fail-closed 지점이다.

```text
preferred:
  migration/pre-seal assertion aborts
  → no valid sealed contract
  → no ready capability

or, if fixture bypasses pre-seal solely to exercise readback:
  forbidden ACL is deliberately represented in the sealed snapshot as well
  → equality is true
  → independent allowlist still forces capability = held
```

두 번째 variant가 특히 중요하다. 단순히 post-seal `GRANT`만 하고 `held`를 확인하면 기존 equality test를 반복할 뿐이다. **forbidden ACL과 sealed snapshot을 의도적으로 함께 일치시킨 상태에서도 getter가 held여야** 독립 admission predicate가 실제 존재한다는 것이 증명된다.

## 증거 등급과 검증 gate

두 판정은 local source와 제공된 structured evidence의 범위를 넘어 hosted readiness를 주장하지 않는다. 증거 클래스는 다음처럼 분리해야 한다. fileciteturn0file0 fileciteturn0file1

| 증거 | 인정 가능한 결론 | 인정하면 안 되는 결론 |
|---|---|---|
| PG17 Event011 | canonical non-dblink durable core가 local PostgreSQL 17.6에서 `postgres NOSUPERUSER`로 통과 | dblink inter-session race의 NOSUPERUSER 운영 증명, hosted readiness |
| PG17 Event009 | full local constituent/concurrency evidence; catalog mutations 포함 | operating-role race 증명. dblink race는 임시 `postgres SUPERUSER` lease 사용, `operatingRoleEvidence=false` |
| PG15 dual-clean replay | 58개 artifact의 두 clean source-only replay가 deterministic하게 일치 | operating ledger, runtime getter readiness, hosted deployment/readiness |
| current TypeScript/SQL source | 위 두 결함의 정적 실행경로 및 최소 regression 조건 | 현재 로컬 수정본이 이미 고쳐졌다는 주장 |
| hosted environment | **제공된 독립 apply/readback evidence 없음** | deployed/production/hosted ready |

특히 PG17의 경계를 섞으면 안 된다. source bundle의 Event011은 SQL fixture의 canonical non-dblink prefix를 **postgres NOSUPERUSER** 상태에서 성공시킨 local operating-role evidence다. 반면 Event009의 dblink race는 temporary `postgres SUPERUSER` lease를 사용했기 때문에 **privileged local concurrency evidence**로만 유지해야 한다. 이 보고서의 Decision 1에서 exact-claim SQL race logic이 합리적으로 보인다는 사실도 이를 NOSUPERUSER dblink race 증명으로 승격시키지 않는다. fileciteturn0file1

PG15 `b6046e...` dual-clean result 역시 source-only 재생의 deterministic consistency evidence다. bundle이 명시하듯 fixture ledger는 비워져 있고 cleanup 후 runtime getter를 호출하는 operating readback이 아니므로, 여기서 operating ledger나 hosted admission을 추론할 수 없다. fileciteturn0file1

최종 검증 gate는 두 결정에 대해 다음 상태가 되어야 한다.

| gate | 통과 조건 |
|---|---|
| credential mixed-history unit | model A returned/unparseable → model B credential rejection에서 release-safe가 false |
| durable no-payload integration | 같은 반례가 exact-release가 아니라 `indeterminate/uncertain`으로 종결 |
| durable force-refresh integration | 기존 payload/revision 보존 + `succeeded/uncertain`; `completed` 복원 금지 |
| stale ACK regression | committed release ACK loss는 idempotent retry; old token은 replacement claim 변경 불가 |
| initial wrapper ACL negative | creator default `supabase_admin EXECUTE`가 실제 aclitem으로 생성되었음을 증명하고 seal/ready 거절 |
| initial table ACL negative | creator default non-owner table privilege가 실제 생성되었음을 증명하고 seal/ready 거절 |
| getter independent admission | forbidden ACL을 sealed snapshot과 의도적으로 일치시켜도 `held` |
| PG17 operating core | non-race core는 NOSUPERUSER로 유지 |
| PG17 race | 현재로서는 privileged-race 분류 유지; NOSUPERUSER race를 새로 증명했다고 표시하지 않음 |
| hosted | 실제 hosted apply + ledger/catalog/capability readback 전까지 **unverified** |

따라서 동결 source `14a8f5da4268df890c7adf10bf89e99ce071f6f5`에 대한 최종 독립 판정은 **Decision 1 = REJECT, Decision 2 = REJECT**다. 첫 번째는 exact-claim SQL이 아니라 **whole-history release authorization 결함** 때문에 거절되고, 두 번째는 post-seal equality가 아니라 **independent initial ACL admission 부재** 때문에 거절된다. 두 경우 모두 patch 범위는 좁게 유지할 수 있으며, 현재 수정 중인 후속본의 완료·검증·hosted 적용은 이 판정에서 가정하지 않는다.