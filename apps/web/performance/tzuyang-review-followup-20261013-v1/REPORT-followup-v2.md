# 쯔양 리뷰 최소 수정 초안 v2 정밀 트리아지 보고서 (2026-10-13)

## 1. 평가 관점 전환 및 안전 원칙

v1 도구의 `ADMISSION_PASSED`는 런타임 데이터베이스 검증이 없는 정적 분석 단계에서 과도한 보증을 내포할 위험이 있어 이를 전면 수정했습니다.

- **정적 콘텐츠 트리아지(Content Triage)로의 한정**:
  - `expected_before_sha`, `updated_at`, `recordSha256` 및 현재 운영 DB 상태 검증은 실제 트랜잭션 실행 전 프리뷰 단계에서 수행되어야 하므로, 본 정적 분석에서는 일체의 '운영 반영 승인'을 부여하지 않습니다.
  - **운영 `applyReady` 플래그는 23개 전수 대상에 대해 예외 없이 `false`로 확정 유지**합니다.
- **타임스탬프 검증의 문자열 multiset 강화**:
  - 단순 개수 비교(`len`) 방식을 폐기하고, `Counter(ts_orig) == Counter(ts_after)`를 통한 실제 마커 문자열 다중집합(multiset) 일치를 검사합니다.
  - 이를 통해 마커 삭제뿐 아니라 타임스탬프 숫자 임의 변조, 중복 치환, 서식 훼손을 정밀 포착합니다.
- **화자 지칭 결함과 정상 어법의 분리**:
  - 복합명사구인 '유튜버 쯔양'(예: "유튜버 쯔양의 단골집")은 정상 한국어 어법으로 간주하여 실패 처리하지 않습니다.
  - 단일 리뷰 본문 내에서 '쯔양'이 지칭어로 확립된 상태에서 독립 단독형 '유튜버가/는/의'가 혼재되는 지칭어 충돌 결함만 선별적으로 검출합니다.
- **확정 소스 보존 오류와 문체 자문(Advisory)의 분리**:
  - 사후 임의적인 40자 길이 제한을 런타임 게이트에서 제거했습니다.
  - 소스 데이터 계약 위반 및 구두점/문법 충돌은 `SOURCE_INTEGRITY_VIOLATION`(Hard Error)으로 분류하고, 문장 확장이나 권고문 부가 등은 `EDITORIAL_ADVISORY`(Advisory Hint)로 분리 기록합니다.
- **v1 아티팩트 보존**:
  - 기존 v1 파일 및 결과를 덮어쓰지 않고, v2 유틸리티 및 보고서를 독립적으로 구성했습니다.

---

## 2. 결함 확인 4건에 대한 RAM 실측 비식별 대조 분석

메모리(RAM) 상의 원본 스냅샷, 최소 초안 계획, 치환 스펙을 직접 대조하여 추출한 4건 결함의 세부 내역입니다.

| 식별 키 | 분류 | 판정 코드 | 원본 SHA256 (before) | 초안 SHA256 (after) | 길이 증감 | 치환 스펙 (Before → After) |
|---|---|---|---|---|---:|---|
| **r0999** | editorial | `TS_MARKER_MULTISET_MISMATCH` | `3c869c0a...81ca` | `9412cf47...1815` | -15자 | `{ts:598-ts:615}` → `""` |
| **r1138** | editorial | `PARTICLE_SPACING_COLLISION` | `008e9527...36c2` | `07c88f39...27f9` | 0자 | `店家` → `가게` |
| **r1294** | source_correction | `STANDALONE_REFERENT_COLLISION` | `a0e7b399...8a6` | `42187830...3bfa` | +27자 | 제1문장 `유튜버 쯔양의 10년 단골집...` → `쯔양이 고등학생 때...` (제3문장 `유튜버가` 잔존) |
| **r1300** | source_correction | `UNPROMPTED_ADVISORY_EXPANSION` | `a223759d...724f` | `6ffd98bb...4a80` | +81자 | 문장 말미에 염도 조절 요청 권고문 및 치즈케이크 단맛 서술 추가 |

### 세부 결함 분석 및 영향

1. **r0999 (확정 소스 보존 오류 - Hard Error)**:
   - 원인: `{ts:598-ts:615}` 영상 시간 마커 삭제.
   - 영향: `apps/web/lib/tzuyang-review-display.ts`의 첫 주석(`// Internal video references belong to the source data, not the reading surface`)이 명시하듯 내부 타임스탬프 참조는 데이터 계층의 소스 정보에 속하며, 사용자 화면 표출 시 정규식에 의해 포맷팅되어야 합니다. 저장 데이터 원본에서 이를 제거하면 해당 설명문의 영상 구간 추적성이 영구 상실됩니다.
2. **r1138 (문법/서식 결함 - Hard Error)**:
   - 원인: 원문의 `성게알(우니)은店家만의 양념으로`에서 `店家`를 `가게`로 단순 치환하여 `성게알(우니)은가게만의 양념으로`가 됨.
   - 영향: 보조사 `은` 뒤에 공백이 누락되어 한국어 문법 및 가독성 결함(`은가게`) 발생. `은 가게만의`로 사전 수정이 필수적입니다.
3. **r1294 (지칭어 충돌 결함 - Hard Error)**:
   - 원인: 제1문장은 `유튜버 쯔양의 10년 단골집`에서 `쯔양이 고등학생 때 자주 찾다가...`로 수정했으나, 제3문장의 `유튜버가 추천하는 히든 메뉴인 제육덮밥은`은 수정하지 않음.
   - 영향: 복합명사('유튜버 쯔양')가 아닌 단독형 '유튜버가'가 동일 리뷰 본문 내에서 '쯔양'과 동시에 사용되어 화자 지칭 일관성이 깨짐.
4. **r1300 (최소 수정 범위 이탈 - Editorial Advisory Held)**:
   - 원인: 원문 말미에 "다만 쯔양은 한국에서 온 손님이라면 소금을 덜 짜게 해달라고 요청하면 좋겠다고 덧붙였으며, 치즈케이크는 매우 맛있지만 매우 달다고 평가했습니다" (+81자)를 덧붙임.
   - 영향: 영상 자막에는 존재하는 발언이나, 단순 오탈자/사실 왜곡 교정이라는 최소 초안의 본래 범위를 넘어 임의적인 방문 팁/행동 지침을 생성하여 추가함. 본래 리뷰의 논조를 변경하므로 검토 보류 대상으로 분리.

---

## 3. 23개 초안 v2 종합 트리아지 현황

| 트리아지 상태 (triageStatus) | 건수 | 초안 식별 키 목록 | 운영 applyReady |
|---|---:|---|---|
| **CONTENT_TRIAGE_ELIGIBLE** (내용 검증 적격) | **19** | r0409, r0503, r0571, r0607, r0697, r0813, r0870, r0881, r1029, r1123, r1135, r1169, r1274, r1338, r1363, r1394, r1448, r1611, r1631 | **전원 False** |
| **SOURCE_INTEGRITY_VIOLATION** (확정 소스/문법 오류) | **3** | r0999 (타임스탬프 삭제), r1138 (띄어쓰기 결함), r1294 (지칭어 충돌) | **전원 False** |
| **EDITORIAL_ADVISORY_HELD** (문체/범위 검토 보류) | **1** | r1300 (미요청 권고문 부가) | **전원 False** |
| **합계** | **23** | | **적용 준비 완료: 0건** |

---

## 4. 인계 아티팩트 목록 (v2)

기존 v1 아티팩트를 보존한 상태에서 신규 v2 파일들을 독점 작업 폴더에 추가 작성했습니다.

- v2 트리아지 유틸리티: `/Users/twoimo/.codex/worktrees/swipe-memory-recovery-20261012/tzudong/apps/web/performance/tzuyang-review-followup-20261013-v1/review_content_triage_v2.py`
- v2 단위 테스트 (8/8 통과): `/Users/twoimo/.codex/worktrees/swipe-memory-recovery-20261012/tzudong/apps/web/performance/tzuyang-review-followup-20261013-v1/test_review_content_triage_v2.py`
- v2 트리아지 요약 JSON: `/Users/twoimo/.codex/worktrees/swipe-memory-recovery-20261012/tzudong/apps/web/performance/tzuyang-review-followup-20261013-v1/followup-triage-summary-v2.json`
- v2 정밀 트리아지 보고서: `/Users/twoimo/.codex/worktrees/swipe-memory-recovery-20261012/tzudong/apps/web/performance/tzuyang-review-followup-20261013-v1/REPORT-followup-v2.md`

