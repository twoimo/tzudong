# 128개 검색·재방문 v7 확인 결과

캐시 후보의 메모리 회귀 해소와 입력 속도 개선은 입증되지 않았다. 자연 heap 20%·입력 지연 15% 기준을 유지한다. 종료 heap 중앙값은 27.933232→33.083332MB(+18.437%), idle은 29.025812→34.229488MB(+17.928%)다. 종료/idle의 짝지은 95% CI는 20% 악화를 배제하지 못하고 각각 4/9·5/9쌍이 20%를 초과했다. 후보21a86dca는 미채택·성능 admission0이며 별도 readiness/전환 소스에 포함하지 않는다.

Before da4c9be17e54733414cc7e1d2f8365d25bee4d87 / After21a86dca974f9bbdeed52d19d2fde0e9cc1fcac6. Next16.3.6 production/Node24.21.0/Chrome154.0.8037.98/Playwright1.63.0/390×844·dpr1/CPU4/HTTP cache disabled·SW bypass/네트워크 무감속. REST735·Auth401은 합성, 원격 Naver SDK/타일은 실제다. SDK SHA802f8c5bb436eeb0014e0e8c72e7f675ae88e102766d2a923cd2c24c7eca74d1과 빌드·helper·lock 해시를 매 실행 확인했다. touch 설정을 켠 데스크톱 자동화이며 mouse click/fill 동작을 사용했다. 물리 Galaxy·삼성 인터넷·실제 touch swipe·운영 field 검증이 아니다.

사전에 고정한 A/A4개 fresh process와 A/B9쌍(18개 process), 실행당256동작(검색128개+동일128개 재방문)을 모두 완료했다. 총5,632동작은 5,632명의 독립 사용자가 아니다. 22/22실행에서 결과·선택 마커·중복 없음·지도1회 생성·표시 상태·overflow 없음이 일치했다. query v7은 alias/address/NULL/JSON 순서를 실제 호출 의미대로 처리하며 v6의 잘못된 fixture 조건을 대체한다. 이전 v6 실패·미채택 기록은 그대로 보존한다.

낮을수록 좋은 지표: 절대 감소량=Before−After, 상대 감소율=(Before−After)/Before×100. 음수는 악화다. 표의 Before/After는 독립 process 요약값 중앙값이며 CI는 쌍별 차이의 중앙값에 대한 bootstrap20,000회(seed20261009)다. 두 estimand가 다르므로 표 중앙값 차이와 CI를 혼동하지 않는다. A/A 잡음은 단2쌍 차이의 최대 절댓값으로 약한 추정이며 실패 면제 기준이 아니다. 인구 p95는 추정하지 않는다. 변동성·범위·MAD·쌍별 상대 CI는 browser-confirm-summary-v7.json에 있다. profiler/forced GC/별도 build는 primary 실행 중 사용하지 않았다. 외부 Mac 부하는 완전히 통제하지 못했다.

| 흐름 | 환경·표본 수 | 지표 | Before | After | 절대 변화 | 상대 변화 | 노이즈·신뢰구간 | 판정 | 증거 경로 |
|---|---|---|---|---|---|---|---|---|---|
| 검색128개×2회 | production·CPU4, 독립9쌍 | 초기 자연 heap(MB) | 12.301012 | 12.420292 | -0.119280 | -0.970% | A/A≤0.120804; paired95% CI [-0.210228, -0.070116] | 개선 입증 안 됨 | browser-confirm-summary-v7.json / ui-ab-confirm-v7-*/raw.json |
| 검색128개×2회 | production·CPU4, 독립9쌍 | 256동작 종료 자연 heap(MB) | 27.933232 | 33.083332 | -5.150100 | -18.437% | A/A≤5.539700; paired95% CI [-8.234268, 18.178284] | 회귀 해소 미입증; 4/9쌍 >20% | browser-confirm-summary-v7.json / ui-ab-confirm-v7-*/raw.json |
| 검색128개×2회 | production·CPU4, 독립9쌍 | 5초 idle 자연 heap(MB) | 29.025812 | 34.229488 | -5.203676 | -17.928% | A/A≤5.547908; paired95% CI [-8.215704, 12.971836] | 회귀 해소 미입증; 5/9쌍 >20% | browser-confirm-summary-v7.json / ui-ab-confirm-v7-*/raw.json |
| 검색128개×2회 | production·CPU4, 독립9쌍 | 표본 시점 peak heap(MB) | 51.290476 | 48.663960 | 2.626516 | 5.121% | A/A≤7.233412; paired95% CI [0.423352, 4.572928] | 개선 입증 안 됨 | browser-confirm-summary-v7.json / ui-ab-confirm-v7-*/raw.json |
| 검색128개×2회 | production·CPU4, 독립9쌍 | 입력→화면 관찰 중앙값(ms) | 160.400000 | 160.300000 | 0.100000 | 0.062% | A/A≤1.500000; paired95% CI [-5.650000, 13.200000] | 개선 입증 안 됨 | browser-confirm-summary-v7.json / ui-ab-confirm-v7-*/raw.json |
| 검색128개×2회 | production·CPU4, 독립9쌍 | 첫 128개 검색 중앙값(ms) | 176.750000 | 175.850000 | 0.900000 | 0.509% | A/A≤9.450000; paired95% CI [-0.200000, 2.650000] | 개선 입증 안 됨 | browser-confirm-summary-v7.json / ui-ab-confirm-v7-*/raw.json |
| 검색128개×2회 | production·CPU4, 독립9쌍 | 동일 128개 재방문 중앙값(ms) | 155.450000 | 157.400000 | -1.950000 | -1.254% | A/A≤13.550000; paired95% CI [-13.050000, 2.550000] | 개선 입증 안 됨 | browser-confirm-summary-v7.json / ui-ab-confirm-v7-*/raw.json |
| 검색128개×2회 | production·CPU4, 독립9쌍 | 실행 안 256동작 p95 요약(ms) | 228.800000 | 228.075000 | 0.725000 | 0.317% | A/A≤16.300000; paired95% CI [-14.325000, 10.075000] | 개선 입증 안 됨 | browser-confirm-summary-v7.json / ui-ab-confirm-v7-*/raw.json |
| 검색128개×2회 | production·CPU4, 독립9쌍 | 관측 long task 수 | 236.000000 | 236.000000 | 0.000000 | 0.000% | A/A≤7.000000; paired95% CI [-6.000000, 7.000000] | 개선 입증 안 됨 | browser-confirm-summary-v7.json / ui-ab-confirm-v7-*/raw.json |
| 검색128개×2회 | production·CPU4, 독립9쌍 | 관측 long task 합계(ms) | 17691.000000 | 17521.000000 | 170.000000 | 0.961% | A/A≤905.000000; paired95% CI [-837.000000, 1269.000000] | 개선 입증 안 됨 | browser-confirm-summary-v7.json / ui-ab-confirm-v7-*/raw.json |
| 검색128개×2회 | production·CPU4, 독립9쌍 | 관측 최대 프레임 간격(ms) | 149.900000 | 133.400000 | 16.500000 | 11.007% | A/A≤16.800000; paired95% CI [-16.700000, 33.200000] | 개선 입증 안 됨 | browser-confirm-summary-v7.json / ui-ab-confirm-v7-*/raw.json |
| 검색128개×2회 | production·CPU4, 독립9쌍 | 합성 맛집 요청 수 | 2690.000000 | 2690.000000 | 0.000000 | 0.000% | A/A≤0.000000; paired95% CI [0.000000, 0.000000] | 개선 입증 안 됨 | browser-confirm-summary-v7.json / ui-ab-confirm-v7-*/raw.json |
| 검색128개×2회 | production·CPU4, 독립9쌍 | 종료 DOM 노드 수 | 7692.000000 | 2424.000000 | 5268.000000 | 68.487% | A/A≤5726.000000; paired95% CI [877.000000, 10032.000000] | 개선 입증 안 됨 | browser-confirm-summary-v7.json / ui-ab-confirm-v7-*/raw.json |
| 검색128개×2회 | production·CPU4, 독립9쌍 | 종료 JS 리스너 수 | 9764.000000 | 2864.000000 | 6900.000000 | 70.668% | A/A≤8267.000000; paired95% CI [-1390.000000, 14568.000000] | 개선 입증 안 됨 | browser-confirm-summary-v7.json / ui-ab-confirm-v7-*/raw.json |

Console 관측: {'http401': 0, 'blockedClient': 0, 'provider': 0, 'other': 22, 'csp': 22}. 원격 요청 실패 관측: {'other-network-failure': 22, 'net::ERR_ABORTED': 41}. pageerror0은 이22실행의 관측값이다. Console44개와 network63개는 서로 중복될 수 있는 관측이며 107명의 사용자/고유 결함이 아니다. 기존 NELO connect-src 차단은 보안 정책을 넓혀 숨기지 않았다. 실패 코드를 고정 분류만 보존했고 헤더/키/쿠키/실사용자 응답은 보관하지 않았다.

원자료의 frame gap/long task는 이 관찰 도구의 한계 안에서만 해석한다. 실행당4장의 정지 캡처(각 pass 첫/마지막, 총88장)는 연속 영상이 아니며 간헐적 플리커 발생률·지속 시간을 판정하지 못한다. 시각적 플리커 완전 제거, GPU/process memory, memory leak 부재, 현재 Next16.3.8 전환 소스의 heap 안전성으로 확대하지 않는다.

통계는 별도 임시 복사본에서 Python3.12.14 optimized 모드로 재계산했고 최초 Python3.9 계산과 byte-identical(SHA fda2078f6b75c94775c89d3b241a9e00dcc16efeed57a384dad6f8c2e9eadc1e)였다. 원자료는 변경하지 않았다. canonical-zero-v4의 scorer·독립 validator는 통과했지만 items0/admitted0/releaseBlocked=true다. 현재 canonical budget에는 브라우저 heap 지표가 없어 가짜 metric을 만들지 않았다. zero 다른 incident는 운영·field·보안 coverage를 입증하지 않는다. v1 배열 canonical 순서·v2 map sidecar 누락·v3 sidecar 생성 누락의 실패를 함께 보존한다.

재실행: REPRODUCE.md. 전체 artifact map과 별도 SHA pin은 source/evidence 무결성을 확인하며 성능 guard나 운영 승인 대신이 아니다. 남은 작업은 자연 heap 보유 경로 진단과 다른 후보의 동일 조건 확인, cold/warm 확장·지도 픽셀 타임라인, prospective cohort/분모·충분한 field 표본이다. 휴대폰 검증은 사용자 지시에 따라 이번 범위에서 제외한다. 전체 장기 목표는 완료되지 않았다.
