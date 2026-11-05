# Tzudong — GPT-6 일반 추론 역검증 보고서

후보: `8d47c225afcff1aa1cc5d4a2d8578911c945e217` 현행 프로덕션: `ac80e35da566db242420a62bbf3e3320b5c00e76` 연구 방식: 일반 추론, Deep Research 미사용

## 1. 소스 접근 영수증

7개 첨부의 표시된 실제 본문을 대조했다. 다음은 해시가 아닌 내용 확인 표본이다.

| 첨부                                 | 확인한 내용                                                                                                    |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Gemini 원문                          | `TH-P-02`에서 merge 이후 `(0,0)` 좌표 변환 문제 제기, `GEM-E-01`에서 프레임 충돌과 `image_url` SELECT 문제 제기                   |
| `reverse-brief.md`                 | 비승인·결측 좌표를 추정 분류하지 않고 게시 입력 전체를 거부한다는 결정                                                                  |
| `reverse-runtime-a.txt`            | `OverseasMap`의 `element.onclick = ...`, `marker.setLngLat(...)`, `approvedEvidenceFramesOrEmpty` 사용       |
| `reverse-runtime-b.txt`            | `restaurantsToGeoJSON`의 등급·좌표 비교와 서울 클러스터의 `popularityTier` stamp                                         |
| `reverse-native-tests.txt`         | `n=19`와 `n=20` 백분위 반례, 404 이미지 복구, retained marker 클릭 검증                                                  |
| `reverse-domestic-integration.txt` | `RESTAURANT_EVIDENCE_FRAME_EMBED`에 `image_url`이 없고, `mergeRestaurants`의 `lat: restaurant.lat \\|\\| 0` 확인 |
| `reverse-verification.txt`         | `83 pass`, `1252 expect()`, typecheck 진단 0건, 기존 운영 WebP 12개 해시·소유권 readback 기록                            |

소스는 후보 커밋의 본문으로 제공됐으나, GitHub에서 해당 커밋을 독립 재조회하거나 로컬 테스트를 실행하지 않았다. 따라서 파일 본문은 `SOURCE_OBSERVED`, 저장된 네이티브 로그는 실행 환경에 따라 `SYNTHETIC_MOCK_TESTED` 또는 `HOST_TESTED`로 구분한다.&#x20;

gemini_4_argon_deescalated_report.md

reverse-brief.md

reverse-runtime-a.txt

reverse-runtime-b.txt

reverse-native-tests.txt

reverse-domestic-integration.txt

reverse-verification.txt



## 2. 기존 TH/GEM 판정

| ID                    | Severity | 최종 판정       | 근거와 잔여 조건                                                      |
| --------------------- | -------- | ----------- | -------------------------------------------------------------- |
| `TH-M-01`             | MEDIUM   | CONDITIONAL | 국내 마커 등급·클러스터 갱신 경로 확인. 실제 Naver SDK 및 운영 UI는 별도 검증            |
| `TH-M-02`, `GEM-M-01` | HIGH     | ACCEPT      | 최신 HTML·클릭 콜백·좌표·선택 상태 갱신 적용. 실제 컴포넌트+SDK stub 브라우저 fixture 통과 |
| `TH-M-03`             | MEDIUM   | ACCEPT      | GeoJSON과 서울 클러스터 캐시에 등급 freshness 비교 추가                        |
| `TH-P-01`             | HIGH     | CONDITIONAL | 735개 재현 로그 존재. 원시 입력의 독립 재계산은 수행하지 않음                          |
| `TH-P-02`             | HIGH     | ACCEPT      | 승인·이름·좌표를 merge 전에 검증하고 전체 입력 fail-closed                      |
| `GEM-P-01`            | MEDIUM   | ACCEPT      | `approved_name` 보존 및 위도 33\~39 기준 정렬                           |
| `TH-P-03`             | MEDIUM   | CONDITIONAL | 6\~7월 메트릭 범위 기록 확인. 실시간 조회수·음식 품질 아님                           |
| `TH-P-04`             | LOW      | ACCEPT      | 멤버십 충돌 시 `standard` 강등 유지. 임의 최고 등급 승격설 REJECT                 |
| `TH-E-01`             | MEDIUM   | ACCEPT      | 맥락 프레임만 있을 때 간판을 주장하지 않는 제목 적용                                 |
| `TH-E-02`             | HIGH     | CONDITIONAL | 4개 맛집·12개 프레임 소유권 readback 기록. 전체 맛집으로 확대 불가                   |
| `GEM-E-01.conflict`   | HIGH     | ACCEPT      | 공개 읽기 경계 둘 다 계약 충돌 시 빈 프레임으로 처리, strict union은 예외 유지           |
| `GEM-E-01.image_url`  | MEDIUM   | REJECT      | 제공된 마이그레이션에는 해당 컬럼 없음. SELECT 추가는 기존 DB 계약과 불일치                |
| `TH-E-03`             | MEDIUM   | ACCEPT      | 이미지 404 시 원본 영상 안내, URL 변경 시 이미지 상태 복구                         |
| `TH-S-01`, `GEM-S-01` | MEDIUM   | CONDITIONAL | 현재 정규화된 단일 하위 경로의 탈출 쓰기 주장은 반증. 동시 파일시스템 변경·부분 게시 원자성은 미보장     |
| `TH-R-01`             | HIGH     | DEFER       | 후보 커밋의 보호 브랜치 병합·READY·alias·운영 readback 미완료                   |
| `TH-R-02`             | LOW      | ACCEPT      | 기존 Nightly 실패와 프로덕션 배포를 별도 유지                                  |

### 백분위 수학 반증

Gemini의 `n ≤ 20`이면 P95와 P98이 항상 같다는 주장은 REJECT한다.

\\[ n=19:\quad \lceil .95n\rceil=19,\quad \lceil .98n\rceil=19 \\]

\\[ n=20:\quad \lceil .95n\rceil=19,\quad \lceil .98n\rceil=20 \\]

20개의 서로 다른 조회수가 있으면 P95와 P98이 분리되어 Ember가 1개 생길 수 있다. `LOCAL-AUDIT-MATH-01`은 기존 코드 결함이 아니라 감사 주장에 대한 반증이다. 저장된 네이티브 테스트에도 19/20 경계가 포함된다.

## 3. 핵심 수정의 독립 판정

마커: 현재 `OverseasMap`은 기존 SDK 마커를 유지하면서 `markerHtmlRef`의 HTML 차이만 교체하고, `onclick`을 최신 레코드·콜백으로 재설정한다. 390/820/1440 fixture에서 동일 DOM, 좌표 변경, 클릭 중복 없음, 선택 상태를 검증했다. 다만 실제 MapLibre 공급자 전체 동작이나 물리 기기 성능을 입증하지 않는다.

공개 데이터: 후보 빌더는 비승인 행·잘못된 좌표·빈 이름을 merge 전에 거부한다. 이는 이전 제안의 단순 `Number.isFinite(0)` 검사보다 엄격하다. 저장된 결과는 승인 행 763개, 메트릭 1,098개로 기존 735개 게시 그룹과 `15/21/71/628` 분포를 재현했다고 기록한다. 현재 공개 JSON은 변경하지 않았다.

프레임: `approvedEvidenceFramesOrEmpty`는 `EvidenceContractError`만 포착한다. 일반 프로그래밍 오류를 숨기지 않으며, `unionApprovedEvidenceFrames`의 엄격한 충돌 거부도 유지한다. 실제 404 이미지 실패 시 링크가 살아 있고 새 URL에서는 복구된다.

게시 파일: canonical 저장 키가 `videoId/timestamp_hash.webp` 한 단계 구조이고, 파일 쓰기 전 부모의 `realpath`를 검사하므로 Gemini의 일반적인 임의 경로 탈출 주장은 현재 입력 계약에 적용되지 않는다. 단, 신뢰할 수 없는 동시 파일시스템 변경자가 없는 staging 환경을 전제로 한다.

## 4. 신규 REV 판정

`REV-M-01` — 선택 레코드의 지도 이동 좌표 검증 / LOW / DEFER

`OverseasMap`의 마커 생성은 잘못된 좌표를 필터링하지만 `moveToRestaurant`는 전달된 레코드의 좌표를 직접 `Number(...)`로 변환한다. 외부 선택 경로에서 결측 좌표가 들어오면 부적절한 `jumpTo` 인자가 만들어질 수 있다.

재현 조건:

```
moveToRestaurant({
  id: "invalid",
  lat: null,
  lng: null
} as Restaurant);
```

마커 필터는 이 호출 경로를 보호하지 않는다. 최소 조치는 지도 이동 직전에 동일한 좌표 유효성 검사를 적용하는 것이다.

필수 검증: 외부 선택·검색 결과에서 결측 좌표, `(0,0)`, 범위 초과 값을 전달해 `jumpTo`가 호출되지 않는지 확인한다. 현재 실제 사용자 경로의 재현 증거는 없어 `DEFER`, 코드상 방어 공백은 `SOURCE_OBSERVED`다.

## 5. 릴리스 판정

저장된 원시 결과는 다음 범위까지 뒷받침한다.

- 83 tests / 12 files / 1,252 assertions / 실패 0건
- 타입 검사 진단 0건, lint 종료 코드 0
- Next.js 16.3.8 webpack 빌드, TypeScript, 정적 경로 56개 및 CSS 경계 검사 성공
- 기존 프로덕션의 공개 WebP 12개에 대해 SHA-256 및 승인 소유자·영상 관계 일치 기록

그러나 로컬 전체 데이터 경로는 공개 키 placeholder로 인한 Supabase 401, Naver 인증 401 때문에 확인되지 않았다. 실제 프로덕션 readback은 `ac80e35...`의 증거이며 후보 `8d47c225...`의 배포 증거가 아니다.

릴리스에는 보호된 `develop → data → main`, 필수 CI, 후보 SHA의 READY 배포, alias 연결, 실제 API·12개 자산 readback이 여전히 필요하다. Nightly `39457197351` 실패도 별도 미해결 상태다.

## 최종 판정

CONDITIONAL ACCEPT — 후보 소스 수정과 저장된 네이티브 경계 검증은 수용 가능하나, 운영 배포 완료 판정은 DEFER.

735개 게시 그룹과 네 맛집의 맥락 프레임 12개는 기존 상태 그대로 유지된다. L1 신원, 전체 맛집 커버리지, 음식 품질, 물리 기기 성능 또는 현장 안정성으로 확대하지 않는다.

이 보고서는 읽기 전용 검토 증거이며, 배포·게시·권한·계정·비용 변경을 승인하지 않는다.