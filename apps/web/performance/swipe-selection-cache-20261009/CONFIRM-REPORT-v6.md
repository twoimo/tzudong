# 128검색 재방문 확인 실행 결과

메모리 회귀 해소와 속도 개선은 입증되지 않았다. 원래의 자연 heap 20%·입력 지연 15% 회귀 기준을 유지한다. 주요 중앙값은 기준 안에 있지만 종료·idle heap의 짝지은 신뢰구간은 20% 증가를 배제하지 못하고, 각각 9쌍 중 4쌍이 그 기준을 초과했다. 후보는 성능 admission 0, 미승격·미배포로 유지한다. 이 보고서는 완료된 실험의 결과이며 전체 사용자 목표의 완료 보고서가 아니다.

Before `da4c9be17e54733414cc7e1d2f8365d25bee4d87`, After `21a86dca974f9bbdeed52d19d2fde0e9cc1fcac6`. A/A 4개 fresh browser process, A/B 9쌍(18개 process), 전체 22개 process의 입력·SDK·기능 동등성 검사를 완료했다. 각 process 안의 256동작은 종속 표본이며 256명의 사용자가 아니다. 사전 계획의 순서를 따랐고 측정 중 별도 build/profiler/forced GC를 실행하지 않았다. 외부 호스트 부하는 완전히 통제하지 못했다.

Node 24.21.0 / Bun 1.4.0 / Next 16.3.6 production build / native Chrome 154.0.8037.98 / 390×844·dpr1·touch emulation / CPU4 / HTTP cache disabled·SW bypass / 네트워크 무감속이다. REST735·Auth401은 합성이고 원격 Naver SDK와 타일은 실제다. SDK 코드 SHA256 `802f8c5bb436eeb0014e0e8c72e7f675ae88e102766d2a923cd2c24c7eca74d1`이 동일했다. 개발 모드·물리 Samsung·운영 field 측정으로 확대하지 않는다.

낮을수록 좋은 지표의 절대 감소량 = Before − After, 상대 감소율 = (Before − After) / Before × 100이다. 음수는 악화다. 표의 Before/After는 각 process 요약값의 중앙값이다. CI는 같은 쌍의 차이/상대 차이에 대한 고정 seed 20261009의 20,000회 bootstrap이며, 중앙값끼리 뺀 수치와 다른 estimand이다. A/A 잡음은 단 2쌍 차이의 절댓값 최댓값이어서 약한 추정이며 메모리 실패를 면제하지 않는다. 충분한 독립 사용자 표본이 없으므로 인구 p95를 보고하지 않는다.

| 흐름 | 환경·표본 수 | 지표 | Before | After | 절대 변화 | 상대 변화 | 노이즈·신뢰구간 | 판정 | 증거 경로 |
|---|---|---|---|---|---|---|---|---|---|
| 검색128개×2회 | CPU4/production, 9쌍 독립 process | 초기 자연 heap(MB) | 12.169148 | 12.451424 | -0.282276 | -2.320% | A/A≤0.077864; paired95% CI [-0.481476,-0.214052] | 작은 메모리 비용 증가; 20% 내 | browser-confirm-summary-v6.json / ui-ab-confirm-v6-*/raw.json |
| 검색128개×2회 | CPU4/production, 9쌍 독립 process | 256동작 종료 자연 heap(MB) | 33.282776 | 37.843264 | -4.560488 | -13.702% | A/A≤2.232148; paired95% CI [-14.026492,11.118224] | 회귀 해소 미입증; 4/9쌍 >20% | browser-confirm-summary-v6.json / ui-ab-confirm-v6-*/raw.json |
| 검색128개×2회 | CPU4/production, 9쌍 독립 process | 5초 idle 자연 heap(MB) | 34.444908 | 38.999076 | -4.554168 | -13.222% | A/A≤2.223848; paired95% CI [-13.965228,11.033292] | 회귀 해소 미입증; 4/9쌍 >20% | browser-confirm-summary-v6.json / ui-ab-confirm-v6-*/raw.json |
| 검색128개×2회 | CPU4/production, 9쌍 독립 process | 표본 시점 peak heap(MB) | 56.348624 | 59.300660 | -2.952036 | -5.239% | A/A≤3.080016; paired95% CI [-6.169352,-1.981444] | 개선 입증 안 됨 | browser-confirm-summary-v6.json / ui-ab-confirm-v6-*/raw.json |
| 검색128개×2회 | CPU4/production, 9쌍 독립 process | 입력→화면 관찰 중앙값(ms) | 190.550000 | 189.950000 | 0.600000 | 0.315% | A/A≤1.700000; paired95% CI [-4.050000,12.350000] | 개선 입증 안 됨 | browser-confirm-summary-v6.json / ui-ab-confirm-v6-*/raw.json |
| 검색128개×2회 | CPU4/production, 9쌍 독립 process | 첫 검색 중앙값(ms) | 207.000000 | 210.000000 | -3.000000 | -1.449% | A/A≤12.650000; paired95% CI [-22.450000,0.400000] | 개선 입증 안 됨 | browser-confirm-summary-v6.json / ui-ab-confirm-v6-*/raw.json |
| 검색128개×2회 | CPU4/production, 9쌍 독립 process | 재방문 중앙값(ms) | 174.250000 | 159.900000 | 14.350000 | 8.235% | A/A≤15.300000; paired95% CI [1.200000,15.050000] | 개선 입증 안 됨 | browser-confirm-summary-v6.json / ui-ab-confirm-v6-*/raw.json |
| 검색128개×2회 | CPU4/production, 9쌍 독립 process | 세션 내부 p95(ms) | 264.650000 | 271.800000 | -7.150000 | -2.702% | A/A≤33.400000; paired95% CI [-21.875000,19.025000] | 개선 입증 안 됨 | browser-confirm-summary-v6.json / ui-ab-confirm-v6-*/raw.json |
| 검색128개×2회 | CPU4/production, 9쌍 독립 process | restaurant 요청 수 | 2690.000000 | 2690.000000 | 0.000000 | 0.000% | A/A≤0.000000; paired95% CI [0.000000,0.000000] | 변화 없음 | browser-confirm-summary-v6.json / ui-ab-confirm-v6-*/raw.json |

재방문 지연의 중앙값은 14.35ms 줄었고 짝지은 95% CI가 [1.20,15.05]ms지만, 제한적으로 관측한 A/A 잡음 15.30ms보다 작아 개선을 인정하지 않는다. 샘플 peak는 오히려 2.95MB 늘었다. 종료/idle의 넓은 범위, DOM·리스너 변동과 자연 GC phase는 원인 진단 대상이며 20% guard의 대체 근거가 아니다. 초기 heap은 약 0.282MB 증가해 제한적으로 관측한 A/A보다 컸다. 성과를 겹쳐 합산하지 않는다.

정확성 6개 경로(동일 배열/객체의 관련 값 변경)를 재현했고 상품 관련 Bun 34개 검사가 통과했다. per-row WeakMap은 동일 값의 원본 객체별 불변 키를 공유하고 값 변경 시 새 키를 만든다. 목록별 이전 키는 변경 감지를 위해 보존한다. 이론상 검증 O(N+M), 키 보유 O(U), 목록 참조 O(sum N)이다. 프로파일의 13,505키·735개 원본 및 약927KB 구조 보유는 이전 후보의 진단이며 전체 heap, 누수, 최종 실측 감소량이 아니다. GC 유발 진단으로 자연 guard를 면제하지 않는다.

22개 process 각각 256동작에서 상세/선택 마커 연결, 중복 마커 0, 지도 생성 1, overflow 0의 DOM 검사가 통과했다. 제한된 4장 화면 캡처는 연속 프레임/플리커 발생률, 핀치, 물리 기기 또는 전체 사용자 흐름 검증이 아니다. provider identity/타일의 실제 픽셀 공백을 해당 조건에서 완전히 제거했다고 말하지 않는다. page error 0, console 2/process와 취소된 provider 요청을 원자료에 보존했다. connect-src 차단 대상 kr-col-ext.nelo.navercorp.com은 같은 공식 SDK의 NELO·/_store 코드에 등장해 로그 수집기라는 해석을 지지한다. 정책 확대나 오류 숨김은 하지 않았다.

초기 v2 후보의 자연 종료·idle +약67% 실패, projection/IN/숫자 정렬이 잘못되었던 fixture, detached ordinal 분류 정정, allocation sampling과 failed setup을 모두 보존한다. 이들의 불완전 조건은 현재 v6 입력의 성능 근거로 채택하지 않는다. warm60·cold735/2000·물리 Galaxy Chrome/삼성 인터넷·viewport/회전/키보드/백그라운드 복귀·필드 신규 cohort/분모/사전 계획·source delivery/deploy/readback은 별도 미완료다. 휴대폰 사용 보류는 유지한다. PR3138의 다른 marker 후보와 섞지 않는다.

원시22 실행은 browser-confirm-plan-v6.json, browser-series-final-v6.json, 각 series-*-receipt.json 및 ui-*/raw.json, 통계 계산은 aggregate-browser-v6.py에 있다. 기존 REPORT-PILOT-20261009-v1.md는 당시 단계의 기록으로 남기고 현재 판정은 이 파일로 구분한다. 완전한 artifact-map/별도 해시/독립 verifier/Git 증거 저장과 canonical scorer·validator의 0 admission 영수증은 아직 남아 있다.
