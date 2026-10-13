# 128개 검색 재방문: 문자열 비교 제거 후보 — 개선 입증 안 됨

Before `9fba35f9` → candidate `ca7674c5`. Node24.21.0/Next16.3.8/Chrome155.0.8059.40 production build, 실제 원격 Naver SDK·타일과 합성 REST735/Auth401, CPU4배, 캐시 비활성·SW 우회, 390×844/DPR1 데스크톱 터치 에뮬레이션이다. 물리 기기·운영·field 성과가 아니다.

A/A4개 독립 프로세스와 A/B9쌍(18개 프로세스), 총22개 프로세스가 각128개 검색을2회 반복했다. 총5632개 동작은 프로세스 안에서 종속된 반복이다. 별도16회씩의 파일럿2개는 아래 분석에서 제외했다. 모든 실행은 보존했고 대체·재선택하지 않았다.

| 흐름 | 환경·표본 수 | 지표 | Before | After | 절대 감소 Before−After | 상대 개선율 | 노이즈·95% CI | 판정 | 증거 경로 |
|---|---|---|---:|---:|---:|---:|---|---|---|
| 검색·선택128×2 | 위 조건,9쌍 | 종료 JS heap | 33.245MB | 35.616MB | −2.371MB | −7.13% | 감소량 CI[−13.142,+12.124]MB | 개선 입증 안 됨·guard 미충족 | statistics-v1.json·ui-ab-*/raw.json |
| 검색·선택128×2 | 위 조건,9쌍 | idle5s JS heap | 34.057MB | 33.118MB | +0.940MB | +2.76% | 감소량 CI[−7.950,+10.523]MB | 개선 입증 안 됨·guard 미충족 | statistics-v1.json·ui-ab-*/raw.json |
| 검색·선택128×2 | 위 조건,9쌍 | 선택→상세 반영 중앙값 | 175.400ms | 176.500ms | −1.100ms | −0.63% | 감소량 CI[−14.350,+5.250]ms | 개선 입증 안 됨·지연guard 지원 | statistics-v1.json·ui-ab-*/raw.json |

MB는10^6bytes다. 상대 개선율=(Before−After)/Before×100이며 낮을수록 좋다. 각 프로세스의 종료/idle 값 또는256개 지연의 중앙값을9쌍에서 다시 집계했다. paired bootstrap20000회(seed20261014)의 percentile95%구간은 소표본 근사이며 동시95%보장을 주장하지 않는다.9개 독립 쌍으로 population p95를 보고하지 않는다. 프로세스 내 p95는 저장됐지만 독립 사용자 tail로 해석하지 않는다. A/A4의 range·MAD도 statistics-v1.json에 보존했다.

기존 end/idle20%, 지연15% 회귀 기준을 유지했다. paired ratio 회귀 구간 상한은 종료72.89%, idle24.62%, 지연8.40%다. 종료와idle은20%상한을 배제하지 못하므로 두 guard는 충족되지 않았다. 각각2/9쌍에서 점 추정이20%를 넘었다. 지연guard만 지원되며 개선은 입증되지 않았다. 결과를 보고 기준을 넓히거나 GC를 강제하지 않았다.

후보는 새 배열의ID join과WeakMap string 값 대신, 순서 비교 및 국내/해외 두 committed ID vector와 한 contextual vector를 쓴다. 새 join은O(n·L) 문자열/임시 포인터를 만들지만 같은 배열의 cachehit는O(1)이다. 후보의 비교는O(n), 비교 중 임시 할당은O(1), 변경commit에서만O(n)ID vector다. cachehit 경로에서는 비교 비용이 늘 수 있다. 이론적 할당 절감과 실제UI 이득은 다르며 이번 실측으로 도입 이득이 증명되지 않아 후보를 승격하지 않는다.

검증: 관련33 unit/0fail, changedlint0, native7.0.2/compat6.0.2 parity0, production build/CSS gate0, 파일럿32동작과 본 실험5632동작에서 선택상세·선택마커·중복마커0·map생성1 조건 통과. camera·마커수는 중간상태로 기록됐지만 settled geometry·모든swipe/빈결과/2000행/데이터무효화·전체viewport 동등성을 별도로 증명하지 않았다.

원본에 inherited `diagnosticOnly=true`와 `performanceAdmission=0`이 남아 있다. 이 메타데이터를 바꾸지 않았고 preregistered PLAN-v1의 동일조건 자연측정으로 회귀를 평가했다. canonical·운영 성능 admission은0, 배포0, field0다. JS heap은 프로세스/GPU/이미지 전체메모리가 아니다. 매실행 SDK connect-src CSP console1회가 관찰돼 숨기지 않았다.

이전 메모리 회귀는 해소됐다고 판정할 수 없다. 다음 진단은 작은signature할당보다 큰 네트워크/데이터처리·SDK bind/unbind·회수시점의 비용을 연결해야 한다. 새 후보도 기존budget으로 검증한다. 이번 실패를 좋은 표본으로 교체하지 않는다.

독립 Python validator가22개 원자료의 중앙값·bootstrap구간·guard·SHA를 재구성했다. statistics SHA256은 `4eed85ce10106bd8d7f1f573d5c27f9cbc1202fbfc71ab0793ecb4dd5b0d5531`이다. PLAN-v1/series-plan-v1/두 분석script/원자료를 함께 보존한다.
