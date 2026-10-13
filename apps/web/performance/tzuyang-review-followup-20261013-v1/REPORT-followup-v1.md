# 쯔양 리뷰 전수 검사 후속 검사 보고서 (2026-10-13)

## 1. 실행 환경 및 모델 메타데이터 확인

- 실행 모델: `google-antigravity/gemini-3.8-flash`
- 추론 강도(reasoning_effort): `high`
- 세션 롤아웃 메타데이터 출처: `/Users/twoimo/.codex/sessions/2026/10/13/rollout-2026-10-13T22-06-32-01a1355f-2bc7-7061-9aa4-2f430ec73b0d.jsonl`
- 스레드 ID: `01a1355f-2bc7-7061-9aa4-2f430ec73b0d`
- 확인 결과: 부모 세션 요청 및 자식 롤아웃 turn_context 메타데이터가 일치하여 승인된 범위 내에서 후속 검사를 완결함.

---

## 2. 참조 소스 및 전수 분모/표본 체계

반복적인 외부 API 호출 및 생성 비용을 전혀 사용하지 않고, `/Users/twoimo/.codex/worktrees/mobile-nav-read-20261012/tzudong`의 동결된 전수 결과와 계약 문서를 재사용했습니다.

- `apps/web/performance/tzuyang-review-census-20261009/REPORT-complete-v7.md`
- `apps/web/performance/tzuyang-review-source-20261011/REPORT-v2.md`
- `apps/web/performance/tzuyang-review-minimal-20261011/REPORT-v1.md`
- `apps/web/lib/tzuyang-review-display.ts`
- `apps/web/lib/admin/restaurant-review-automation.ts`
- `docs/agents/privacy.md`

### 전수 분모 및 표본 축소 단계

| 단계 | 모수(분모) | 세부 내역 | 근거 및 상태 |
|---|---:|---|---|
| 전체 동결 레코드 (Census) | 1,659 | 실제 텍스트 보유 1,437 / 실제 빈 리뷰 222 (ok 1,046, fix 205, needs_source 408) | 동결 census 완료 (Gemini 3.8 Flash HIGH) |
| 승인 레코드 (Approved) | 763 | 실제 텍스트 보유 741 / 빈 리뷰 22 (ok 600, fix 93, needs_source 70) | 운영 승인 상태 |
| 승인 + tzuyang 채널 확인 | 751 | 실제 텍스트 보유 729 / 빈 리뷰 22 (ok 590, fix 92, needs_source 69) | 타 채널 및 미확인 승인건 제외 |
| 자막 2차 대조 표본 | 161 | 137개 자막 작업 요청 → 134 응답/156 레코드 인정, 3 응답/5 레코드 거부 | 자막 exact quote 대조 완료 |
| 자막 단계 모델 제안 | 78 | 수정 제안 78건 (기존 관리자 편집 47, 비잠금 31) | 156건 중 propose 78, visual 36, insufficient 35, keep 7 |
| 후보 분리 및 선별 | 78 | 관리자 편집 보존 47건, 문맥·화면 미확정 보류 8건, **최소 초안 23건** | `minimal-review-plan-v1.json` |
| **후속 검사 대상 (본 작업)** | **23** | **문체/오탈자(editorial) 15건, 좁은 원문 수정(source_correction) 8건** | 5대 차원 정밀 검증 수행 |

---

## 3. 23개 최소 수정 초안 5대 차원 정밀 검증

초안 23건에 대해 (1) 근거 없는 새로운 주장, (2) 인용 삭제, (3) 관리자 편집 충돌, (4) timestamp 제거 후 문장/의미 훼손, (5) 중복 및 어투 일관성 문제를 전수 검증했습니다.

### 5대 검증 차원별 분석 결과

1. **근거 없는 새로운 주장 유무**:
   - `r0607`, `r1123`, `r1135`, `r1338`, `r1448`, `r1611` 등 6건의 원문 수정은 자막 세그먼트에 정확히 부합하는 사실 교정입니다. (예: r1135의 '식당이 직접 게를 공급'한 것이 아니라 '쯔양이 게를 가져와 조리 요청'한 사실 반영, r1448의 '식당 역사상 최고 기록'이라는 근거 없는 과장을 '사장님이 최다 주문 손님이라고 언급'으로 정정).
   - 반면 `r1300`은 원문에 없던 손님 권고사항("소금을 덜 짜게 해달라고 요청하면 좋겠다") 및 치즈케이크 단맛에 대한 보조적 서술(+81자)을 추가하여 최소 수정 범위를 이탈했습니다.

2. **인용 삭제 여부**:
   - 따옴표(`'`, `"`) 및 핵심 인용구 개수는 모든 초안에서 보존되었습니다.

3. **관리자 편집 충돌 (Admin Lock)**:
   - 78개 제안 중 관리자가 수정한 47건은 이미 `preserve_admin_edit`로 분리 보존되었습니다.
   - 23건 초안은 스냅샷 시점 기준 모두 `adminLocked: false`였으나, 운영 Apply 직전에 반드시 optimistic lock (`adminLocked`, `updated_at`, `recordSha256`) 일치 여부를 재검증해야 합니다.

4. **timestamp 제거 후 문장/의미 훼손**:
   - `r0999`에서 `{ts:598-ts:615}` 타임스탬프 마커를 DB 원본에서 영구 삭제하려 시도함.
   - `apps/web/lib/tzuyang-review-display.ts`의 설계 원칙상, `// Internal video references belong to the source data, not the reading surface`이므로 소스 데이터 내부의 타임스탬프는 보존되어야 하며 표출 레이어의 정규식에 의해 포맷팅되어야 합니다. 원본에서 이를 제거하면 출처 시간 추적성이 영구 파괴됩니다.

5. **중복 및 어투 일관성 (Tone & Spacing)**:
   - `r1138`: `[["店家","가게"]]` 단순 치환으로 인해 앞 조사 `은`과 결합하여 `은가게만의`라는 띄어쓰기 오류 발생.
   - `r1294`: 제1문장의 `유튜버 쯔양의 10년 단골집`은 `쯔양이...`로 수정했으나, 제3문장의 `유튜버가 추천하는 히든 메뉴인 제육덮밥은`에는 `유튜버` 호칭이 그대로 잔존하여 동일 리뷰 내 주어 호칭 불일치 발생.

---

## 4. 판정 결과: 수정 가능(Eligible) 19건 vs 보류(Held) 4건

### 수정 가능 (Eligible for Apply): 19건
- **문체/오탈자/존칭 정비 (editorial, 13건)**:
  - `r0409`: ~함/~있음 종결어미를 소개되었습니다/설명했습니다로 정비
  - `r0503`: '겉바속촉' 정석임 -> 정석이라고 평가했습니다, 훌륭하다는 평 -> 평했습니다
  - `r0571`: 평가함/극찬함 -> 평가했습니다/극찬했습니다
  - `r0697`: 극찬함/추천함 -> 극찬했습니다/추천했습니다
  - `r0813`: 오탈자 정정('모든 음정이' -> '모든 음식에') 및 문체 정비
  - `r0870`: 전언 표현 정비(친절하셨다고 전했습니다, 평가했습니다)
  - `r0881`: 평가했습니다, 주문했습니다 문체 정비
  - `r1029`: 구두점 앞 불필요한 공백 제거('~합니다 .' -> '~합니다.') 및 '유튜버' -> '쯔양' 전수 정비
  - `r1169`: 평가했습니다, 전했습니다 문체 정비
  - `r1274`: 반복된 명사형 어미(~함, ~언급)를 다중 서술어(~평가했습니다, ~언급했습니다)로 정비
  - `r1363`: 평가했습니다, 요약했습니다 문체 정비
  - `r1394`: 만족스러워했습니다, 추천했습니다 문체 정비
  - `r1631`: 평가했습니다, 덧붙였습니다 문체 정비
- **좁은 사실 오류 교정 (source_correction, 6건)**:
  - `r0607`: '반드시 오픈런' 단정 표현을 '촬영 당시 하루 2시간 영업 소개'로 정정, '유튜버는' -> '쯔양은'
  - `r1123`: '영하 7도 맥주' 표현을 '영하 7도 슬러시'로 영상 발언에 맞게 교정
  - `r1135`: '식당의 활꽃게 공급' 허위 사실을 '쯔양이 직접 가져온 꽃게 조리'로 핵심 오류 교정
  - `r1338`: '15년째 1,000원 유지' 표현을 촬영 당시 소개 사실로 정정 및 국물 맛 묘사 정비
  - `r1448`: '식당 역사상 최고 기록' 과장 표현을 '사장님이 최다 주문 손님 언급'으로 정확한 발언 반영
  - `r1611`: 미확인된 '처음으로 함께 촬영했던'에서 '처음으로' 수식어 제거

### 보류 (Held / Admission Rejected): 4건
1. **`r0999` (editorial) - 사유: `TIMESTAMP_DELETED`**
   - `{ts:598-ts:615}` 영상 시간 마커 삭제 시도. 원본 DB 레코드의 시간대 추적성을 파괴하므로 보류. (표출 단 포맷팅 규칙에 위임해야 함)
2. **`r1138` (editorial) - 사유: `SPACING_COLLISION`**
   - `성게알(우니)은가게만의 양념으로` 공백 누락 오류 발생. `은 가게만의`로 사전 교정되기 전까지 보류.
3. **`r1294` (source_correction) - 사유: `ENTITY_INCONSISTENCY`**
   - 제1문장은 `쯔양이`로 변경했으나 제3문장에 `유튜버가 추천하는`이 잔존하여 단일 리뷰 내 주어 호칭 충돌 발생.
4. **`r1300` (source_correction) - 사유: `SCOPE_CREEP`**
   - +81자의 대규모 문장 추가. 손님 대상 염도 조절 권고문 및 치즈케이크 단맛 부연 설명을 임의 추가하여 최소 수정 범위를 초과함.

---

## 5. 운영 Apply 전 필수 사전 검사 체계 (Admission Gate Checklist)

운영 데이터베이스에 반영(Apply)하기 전에 반드시 다음 6단계 검사 파이프라인을 통과해야 합니다.

1. **Optimistic Locking & Preimage 동등성 검사 (Admin Lock Check)**:
   - `adminLocked === false` 확인
   - `updated_at === expectedTargetUpdatedAt` 확인
   - `sha256(tzuyang_review) === expectedBeforeSha256` 확인
   - `sha256(whole_record) === expectedRecordSha256` 확인
   - 스냅샷 이후 관리자 수동 편집이 발생한 레코드는 즉시 거부 및 보존.
2. **원문 타임스탬프 보존 검사 (Timestamp Preservation Check)**:
   - `{ts:...}`, `[ts:...]`, `(ts:...)` 패턴이 수정 전보다 수정 후에 감소하지 않아야 함. 소스 데이터 보존 원칙 준수.
3. **구두점 및 띄어쓰기 결함 검사 (Formatting & Spacing Check)**:
   - 단순 문자열 치환 후 조사-명사 충돌(`은가게`, `는가게` 등) 부재 확인.
   - 구두점 앞 공백(`\s+[.,!?]`) 및 연속 공백 부재 확인.
4. **엔티티 및 어투 일관성 검사 (Entity & Tone Consistency Check)**:
   - 단일 리뷰 내 `유튜버`와 `쯔양` 혼용 금지.
   - 문장 종결어미의 경어체(~습니다/~었습니다) 일관성 유지.
5. **최소 수정 범위 초과 금지 (Scope Boundary Gate)**:
   - 글자 수 증감(|delta|)이 40자를 초과하는 임의 문장 추가나 새로운 권고/주장 생성 금지.
6. **Preview → Confirm → Apply → Readback → Audit 5단계 트랜잭션**:
   - 단순 GET 조회 결과를 승인/적용으로 취급하지 않음.
   - 적용 후 Readback으로 대상 필드만 변경되었는지 확인.
   - `apps/web/lib/privacy/sanitize.ts` 규정에 따라 audit event에 개인정보(PII), 원문 전체, 인증 토큰을 기록하지 않음.

---

## 6. 단위 검증 및 인계 파일 목록

본 작업 공간 `/Users/twoimo/.codex/worktrees/swipe-memory-recovery-20261012/tzudong/apps/web/performance/tzuyang-review-followup-20261013-v1/` 내에 재사용 가능한 검증 유틸리티와 결과를 독점적으로 생성했습니다.

- `review_admission_check.py`: 5대 검사 규칙(AdminLock, Timestamp, Spacing, Entity, Scope)을 자동 판정하는 재사용 검증 모듈
- `test_review_admission.py`: 8개 단위 테스트 케이스(100% 통과, 0.000s)
- `followup-admission-summary-v1.json`: 1659 전수 분모 및 23개 초안의 비식별화 검정 결과 요약
- `REPORT-followup-v1.md`: 본 종합 분석 보고서

