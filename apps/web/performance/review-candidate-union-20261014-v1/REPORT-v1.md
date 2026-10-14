# 리뷰 후보 묶음 조회 비교 — 2026-10-14

요청 수는 줄었지만 메모리와 입력 지연의 개선은 입증되지 않았다. 종료 heap의 고정20% 회귀 한도를 지지하지 못하므로 fb5fc0c4 후보는 로컬에만 보존하고 승격·배포하지 않는다. 전체 목표는 미완료다.

## 측정 결과

낮을수록 좋은 값의 절대 감소는 Before−After, 상대 감소는 (Before−After)/Before×100이다. 음수 감소는 악화다. MB는10^6B다. A/A4개와 A/B9쌍18개를 구분하며, 내부5632동작을 독립표본으로 세지 않는다. 95% CI는 프로세스 단위 paired percentile bootstrap20000회의 작은 표본 근사이며 동시95% 또는 모집단p95를 주장하지 않는다.

| 흐름 | 환경·표본 수 | 지표 | Before | After | 절대 변화 | 상대 변화 | 노이즈·신뢰구간 | 판정 | 증거 경로 |
|---|---|---|---|---|---|---|---|---|---|
| 반복 탐색 종료 JS heap | 실제 Naver SDK + 합성 REST/Chrome155/CPU4; A/A4+A/B9쌍, 256동작/프로세스 | MB | 45.288 | 40.978 | 4.309 감소 | 9.52% 감소 | 절대 감소 CI [-19.584, 13.985]; A/A 범위/중앙값 63.85% | 개선 입증 안 됨; 회귀 한도 지지 못함 | statistics-v1.json 및 ui-ab-*/raw.json |
| 5초 idle JS heap | 실제 Naver SDK + 합성 REST/Chrome155/CPU4; A/A4+A/B9쌍, 256동작/프로세스 | MB | 46.327 | 35.454 | 10.873 감소 | 23.47% 감소 | 절대 감소 CI [-10.312, 22.676]; A/A 범위/중앙값 61.77% | 개선 입증 안 됨; 회귀 한도 지지 | statistics-v1.json 및 ui-ab-*/raw.json |
| 입력→상세 반영 | 실제 Naver SDK + 합성 REST/Chrome155/CPU4; A/A4+A/B9쌍, 256동작/프로세스 | ms | 176.050 | 175.550 | 0.500 감소 | 0.28% 감소 | 절대 감소 CI [-6.350, 13.000]; A/A 범위/중앙값 17.29% | 개선 입증 안 됨; 회귀 한도 지지 | statistics-v1.json 및 ui-ab-*/raw.json |
| 입력→별칭 리뷰 가시화 | 실제 Naver SDK + 합성 REST/Chrome155/CPU4; A/A4+A/B9쌍, 256동작/프로세스 | ms | 259.250 | 245.100 | 14.150 감소 | 5.46% 감소 | 절대 감소 CI [-15.200, 16.650]; A/A 범위/중앙값 13.38% | 개선 입증 안 됨 | statistics-v1.json 및 ui-ab-*/raw.json |
| 맛집 REST GET | 실제 Naver SDK + 합성 REST/Chrome155/CPU4; A/A4+A/B9쌍, 256동작/프로세스 | 회 | 2434.000 | 1794.000 | 640.000 감소 | 26.29% 감소 | 절대 감소 CI [640.000, 640.000]; A/A 범위/중앙값 0.00% | 요청 감소 입증 (합성 REST 조건) | statistics-v1.json 및 ui-ab-*/raw.json |

종료 heap의 paired regression CI 상한77.206%는20% 한도를 넘었다(개별2/9쌍도20% 초과). Idle heap과 입력 반영은 각20%/15% 한도를 지지하지만 감소 CI가0을 포함한다. A/A 메모리 변동을 회귀 면제 근거로 쓰지 않는다. 요청 수 CI가[640,640]인 것은 정해진 fixture와 반복 흐름이 만드는 동일한 요청 수이며 실제 서비스 모집단의 오차가0이라는 뜻이 아니다.

## 변경 원리와 정확성

기존 비용은 서로 다른 이름n과 주소a에 대해4n+2a개의 병렬 HTTP조회다. 후보는 허용된6컬럼의 정확한eq조건을 하나의or필터로 합치고, exact count가 반환 배열 길이와 같을 때만 사용한다. 일반 단일 이름·주소에서 후보 조회6→1이지만 전체 실제 브라우저 흐름의 감소는26.294%다. 두 개선율을 합산하지 않는다.

전역 캐시·임의 지연·debounce·Worker를 추가하지 않았다. URIencoded필터6000B 초과, count누락/잘림/오류에는 기존 조회를 사용한다. 이 실패 경로는 m+1회 요청이 필요하며 SDK의503기본3retry가 있으면 추가4attempt를 기다린다. 이론 HTTP복잡도는 성공시O(1), 실패시O(m); DB의OR/COUNT 처리시간이나 인덱스 비용이O(1)이라는 주장은 아니다. 배열 병합 임시 비용은 감소할 수 있으나 실제 메모리 개선은 입증되지 않았다.

19개 관련 unit, 추가7개 관련 suite110개, targeted lint·native7.0.2/compat6.0.2 parity 및 Next16.3.8 production build/CSS gate를 통과했다. 검사 수를 중복된 전체검사와 합산하지 않는다. 전체 CI·보호 source promotion·배포는 이 새 후보에서 수행하지 않았다.

실제 Naver SDK와735승인+735삭제별칭+735합성인증리뷰를 사용해22프로세스 모두 선택·리뷰 표시·마커 연결·중복0·지도 생성1을 확인했다. 모든 조건과 wrapper해시는 PLAN-v4.json에 결속돼 있다. Node24.21.0, Chrome155.0.8059.40, 390×844/DPR1/touch emulation, CPU4, cache off/SW bypass, forced GC 없는 primary 조건이다. 기준선은 실제9fba35f9 build이며 protected main3d7919d6와 runtime입력 동등성을 확인했다. 후보는 fb5fc0c4 build다. 새 complete-count/리뷰 fixture여서 과거735/no-review 수치와 직접 비교하지 않는다.

## 실제 DB 및 복구 검증

공개 publishable key·anonymous·사용자 세션 없이 실제 DB에서 6개 비교, 총43GET(모두200)을 수행했다. 두 공개 맛집과 예약문자 포함 존재하지 않는 literal에서 기존/묶음 후보ID집합이 일치하고 exact count가 완전했다. 실제 DB의 row·이름·주소·ID·자격 증명은 저장하지 않았다. 2회/사례의 API wall은 네트워크·클라이언트 비용을 포함한 진단이며 서버COUNT시간 또는 UI latency 개선의 증거가 아니다.


503모바일390×844, count누락태블릿834×1112, 응답잘림데스크톱1440×900에서 실제 production 후보·remote SDK의 관련 삭제리뷰 표시·선택/지도1 보존을 확인했다. 모든 너비에서 touch/mobile context를 유지한 CSS breakpoint 검사이며 물리 기기나 desktop pointer환경 전체 검사로 부르지 않는다. 결과는 fallback-functional-readback-v1.json에 있다.

첫 검사 v1/v2는 기존 SDK의3retry를 빠뜨린1attempt가정으로 실패했고, 리뷰 자체는 이미 표시됐다. 설치된@supabase/postgrest-js2.117.2의3retry를 source hash로 확인하고 v3에서4attempt를 기대했다. v3의desktop실패는 모바일 전용 opener를 찾은 검사 오류였다. 실제desktop검색 input을 사용한 v4에서 해당 실패경로1개를 검증했다. 기존 실패와 화면을 모두 보존했다. 제품 retry설정이나 판정기준을 완화하지 않았다.

## 한계·미완료

primary 실행마다 Naver-family connect-src CSP console1건(총22)을 관측했다. 타일 이동의 취소·네트워크 incident는 별도 원자료에 보존했으며 모두 운영 장애라고 해석하지 않는다. Canonical scorer와 독립 validator는 통과했지만 items0/admitted0/releaseBlocked=true다. 현 budget에 heap 지표가 없어 가짜 slice를 만들지 않았다.

이 자료는 원격 SDK를 쓰는 로컬 production build와 합성 REST 흐름이다. 운영 배포, 실제 사용자 field, 물리 Galaxy·삼성 인터넷, 2000행 UI, 빈 결과/느린 네트워크/데이터 갱신 전체 매트릭스, 픽셀 플리커 제거, 최악 APICOUNT비용은 입증하지 않는다. 스크린샷은 정지 화면3개이며 프레임별 검은 사각형 검출 또는 완전 제거 증거가 아니다. 원래 운영 SQL·private verification 이전·배포는 직접 PostgreSQL 연결 설정과 fresh fences가 남아 있으며 작업0이다.

메모리 원인은 후속 별도 marker/forced-GC 구조 진단에서 조사한다. 그 진단은 primary표본을 대체하지 않으며 heap 원문·문자열·credential을 저장하지 않는다. 원인과 한계는 해당 raw.json의 diagnostic fields로 확인한다.

## 재현

의존성·확정된 두 build·Naver의 원래 허용origin·유효한 로컬TLS·공개 runtime 설정이 필요하다. build-receipts-v1.json과 candidate-build-v1.json, candidate-source.patch를 확인하고 PLAN-v4 해시·fixture/harness 해시를 검증한다. 기존 evidence폴더의 배타적 출력에 덮어쓰지 말고 별도 복사본에서 Node24.21.0로 run-series-v1.mjs를 실행한다. analyzer와 Python validator를 차례로 실행한다. 복구 검사 v3는desktop모바일-opener 실패를 의도적으로 보존한 원본이며, 최종desktop검사는 v4다. 실제DB검사는 read-live-database-v1.mjs이고100GET 예산이 고정돼 있다. 자격 증명은 기존 환경에서RAM으로만 읽는다.

새로 실행할 때 공식 SDK가 바뀌거나TLS가 만료되면 이전 SDK해시와 동등한 실행으로 간주하지 않는다. 재생을 위해 권한·도메인·CSP를 해제하지 않는다. 부모 artifact-map과 docs/evidence의 detachedpin 및 독립 complete-set validator로 파일 전체 바이트를 확인한다.
