# 해외 지도 표시 개선 — 로컬 검증 결과

해외 전환 시 지도 시작을 막는 CSP 누락과 MapLibre 워커 설정을 수정했다. 설치된 6.11.2 워커의 상대 import까지 함께 제공하며 파일 원문과 라이선스를 보존한다. 국가 변경은 기존 지도를 재사용하고, 식당 조회가 늦어도 먼저 준비된 지도를 가리지 않는다. 전환 의도에 따른 코드 준비, 청크 로딩 안내, 오류 재시도와 느린 연결의 자동 회복을 추가했다.

현재 소스는 `source-bindings.json`, 외부 검토용 변경분은 `source-delta.txt`에 고정했다. 이 후보에는 이전 상세 헤더·도장 화면 수정도 남아 있으나 해외 지도 감사 범위와 측정에는 포함하지 않았다. 원래 dirty worktree와 봉인된 과거 증거는 변경하지 않았다.

## 실제 관측

| 검증 | 결과 |
| --- | --- |
| 497px 모바일, 별도 브라우저 컨텍스트 5회 | 중앙값 1,599ms, 범위 1,571–2,107ms, MAD 28ms |
| 320/375/497/768/1024/1440px, 총 10회 | 전체 범위 1,511–2,107ms; 5,000ms 절대 예산 모두 충족 |
| 실제 OpenFreeMap 스타일·벡터·글꼴·스프라이트 | 정상 표시; 워커와 shared 모듈 HTTP200, JavaScript MIME |
| 식당 조회를 계속 대기시키는 분기 | 지도는 표시되고 핀 안내만 남음 |
| 헝가리 → 일본 국가 전환 | 동일 canvas 유지; 스타일·워커 재요청 0회 |
| 스타일503 후 국가 변경·재시도 | 이전 canvas 제거, 대체 canvas 1개; 실제 나고야 타일 확인 |
| 스타일 응답을 12초 이상 보류 | 느림 안내 뒤 원래 요청 성공으로 재시도 없이 회복 |
| 포커스에 따른 코드 준비 | 활성화 전 숨은 지도와 제공처 리소스 요청 없음 |
| 실제 전체 홈 앱, 497/1440px | 지도 전환·출처 표기·국내 복귀 통과; 페이지/수화 오류 0 |
| 전체 앱 `npm run build` | 통과; 별도 `.next-overseas-map-20261021`; CSS 경계 검사 포함 |
| 최종 TypeScript parity | 3,242개 입력, diagnostics 0 |
| 변경 파일 ESLint / 관련 설정 단위 검사 | 통과 / 19 pass, 0 fail |
| 실제 앱의 정적 워커·shared·LICENSE 응답 | 모두200, 원문 SHA 일치, immutable 캐시 |

측정은 설치된 Next16.3.8/Webpack·MapLibre6.11.2·Chromium153.0.8010.12의 로컬 실행이다. 각 측정은 새 컨텍스트와 브라우저 HTTP 캐시 비활성화를 사용했다. CDN·OS·GPU 프로세스 캐시와 외부 망 변동은 통제하지 않았다. 식당 조회는 빈 데이터 fixture이고 국내 Naver는 홈 통합 검사에서만 mock이다. 물리 기기, Safari, 운영 망, 실제 식당/위치 데이터 성능이나 Turbopack 런타임을 검증했다는 뜻이 아니다. 절대 예산은5초, 절대 노이즈 바닥은250ms이며 상대 개선율은 산정하지 않았다.

기존 버전은 준비 완료에 도달하지 않고 보안 정책 오류를 냈다. 첫 14-case 실행의 후보13건은 통과했으나 baseline 검사가 page-target CDP 차단 이벤트만 요구해 실패했다. 워커 보안 오류는 console에 기록되어 있었으며, 관측 채널을 보완한 별도2건 실행에서 baseline 재현과 재시도 국가 보존을 확인했다. 원래 실패 결과는 `native-results.json`에 그대로 남겼다. 두 실행 사이 제품 코드는 바뀌지 않았다. 별도 관측 코드의 변경은 `run-native-check.mjs`와 이 설명으로 기록하며, 최초 실행 당시 관측 스크립트의 사전 해시는 수집하지 않았다.

`score-native-results.py`는 원시 결과의 소스 해시, 예산, 변동성, 상태·오류·복구·출처·홈 전환을 독립 계산한다. `scored.json`은 그 결과다. 원래 실패가 있으므로 첫 실행 전체를 성공으로 재기록하거나 완료 시간의 백분율 개선을 주장하지 않는다.

## 판정과 연결

| ID / 판정 | 실제 적용 및 근거 | 검증 / 잔여 조건 |
| --- | --- | --- |
| OM-01 ACCEPT | `proxy.ts`: 정확한 타일 origin만 connect-src 허용 | 실제 proxy 단위 검사, native CSP 하 자원 로드; strict script 정책 유지 |
| OM-02 ACCEPT | `prepare-maplibre-worker-assets.mjs`, `next.config.mjs`, provider 모듈: 설치 원문 3파일과 내용 해시 URL | 누락 shared404 재현 보존; 원문·멱등성·변경 버전·변조·누락 단위 검사, 실제 앱 응답 SHA 확인 |
| OM-03 ACCEPT | `OverseasMap.tsx`: 국가 이동과 초기화 분리, 소유 마커·리스너·관측자 정리 | canvas 재사용, 재시도 교체, 일본 타일 확인; 빈 데이터 fixture여서 실제 식당 핀 선택은 별도 미측정 |
| OM-04 ACCEPT | 지도 준비와 식당 조회 준비 분리 | 고의로 대기 중인 쿼리에도 지도 표시 |
| OM-05 ACCEPT | loader와 모바일/PC 제어의 intent 이벤트, Suspense 안내 | 활성화 전 지도 인스턴스·제공처 fetch0, 실제 홈 전환 |
| OM-06 ACCEPT | 오류·12초 느림 안내와 명시 재시도 | 503·늦은 성공·정상 교체 분기 통과 |
| OM-07 CONDITIONAL | OpenFreeMap/OSM 유지, 항상 보이는 OpenMapTiles/OSM 출처와 라이선스 원문 | native와 실제 홈에서 출처 노출 확인; 제공처 가용성 보장이나 법적 무위험 판정은 아님 |

[OpenFreeMap](https://openfreemap.org/)은 상업적 이용을 허용하며 출처 표기를 요구한다. [OpenStreetMap](https://www.openstreetmap.org/copyright) 데이터는 ODbL에 따른다. 무저작권/퍼블릭 도메인으로 취급하지 않았다. 표준 OSM 타일 서버 대량 다운로드나 우회 프록시, 유료 제공처 전환은 하지 않았다.

## 미완료 외부 단계와 전달 경계

이 변경의 GPT-6 Pro+Deep Research thesis/delta → Gemini adversarial → GPT reverse 전문은 아직 없다. 정상 공유 예약 결과 `queued`, exit75, 로컬 FIFO 용량1/활성2/빈 슬롯0이다(`external-admission.json`). 질문과 최소 변경분25,457bytes를 준비했으나 업로드·전송·웹 Pro 턴 사용 기록은 발생하지 않았다. 과거 대기열 우회 승인은 이 새 지도 범위에 확대하지 않았다. 슬롯이 제공되면 실제 계정/모드/Deep Research/쿼터와 GitHub 소스 접근부터 새로 확인하고 같은 준비된 질문으로 진행한다. 다른 소유자의 연구를 해제하거나 복제하지 않는다.

정본 스킬의 “Routine fixes can continue while external review is unavailable, but the missing review stays unverified.”에 따라 로컬 구현·검증과 외부 감사 완료를 구분한다. 외부 감사, 운영 배포·보호 승격과 운영 exact-SHA 확인은 미완료다. 이 결과는 기존 배포 완료 또는 Nightly 상태를 변경하지 않는다. 이번 실행에서 Nightly를 재실행하지 않았다.

검증 fixture와 전체 앱의 임시 서버만 종료하고, 사용자 탭의 진단 Network 구독과 지도 선택을 조사 전 상태로 복원한다. 다른 실행·계정·큐·Docker 컨테이너는 보존한다.
