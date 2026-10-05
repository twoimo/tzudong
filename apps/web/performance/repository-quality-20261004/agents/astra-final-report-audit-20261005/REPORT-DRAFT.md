작성일 2026-10-05 · 기존 증거 기반 한국어 보고서 초안 · 정식 freeze 전

기존 ca235→34ebbb 측정은 사전에 고정한 latency 15%·natural heap 20% 중앙값 허용치를 통과했다. 그러나 렌더링 속도·메모리 개선은 입증되지 않았다. 기록된 운영 b901에서는 실제 SDK를 사용하는 Chrome의 합성 viewport 기능 검사 20/20이 통과했다. 이는 실기기 성능, field 개선, 전체 저장소 준비 완료를 뜻하지 않는다. 실제 폰은 human hold 중이며 이 감사에서 조작하지 않았다. canonical G003 admission=0을 유지하고 최종 freeze·push 완료를 주장하지 않는다.

증거 경로의 기준 root는 `/Users/twoimo/.codex/worktrees/marker-memory-lifetime-20261001/tzudong/apps/web/performance/repository-quality-20261004`이다. 이번 감사는 저장된 문서·plan·raw·summary만 읽었다. 새 측정, 배포 재조회, 브라우저 실행, hosted write, 소스·기존 증거·map 변경은 수행하지 않았다. 원시 자유형 오류, 원격 URL, 개인 데이터는 보고서에 옮기지 않았다. 표의 값은 원시값으로 계산한 뒤 소수 6자리·상대 변화 3자리로 반올림했다. 미검증은 실패와 구분한다.

버전과 증거의 적용 범위는 다음과 같다.

| 구분 | 해당 소스 | 근거와 적용 한계 |
|---|---|---|
| 최초 cold 및 교정 warm 비교 | Before `ca235e250957c4360ad713ffd29e118c11cc5b7c` → After `34ebbb21092ef7d3240897d048055fd12762b39b` | cold/warm plan과 raw의 plan SHA, 두 측정의 buildId 일치를 확인했다. actual SDK·tiles+synthetic REST이다. 이 감사는 소스를 빌드하거나 build receipt 전체를 재검증하지 않았다. |
| 후속 기능 확인 | source `519c88d1` | `REPRODUCE-integrated-v1.md`의 source 연결과 `integrated-final-interactions-v1/raw.json`, `integrated-final-responsive-v1/raw.json`의 같은 buildId를 확인했다. raw에는 full source SHA가 없어 연결 근거는 문서까지다. 성능 After를 519 또는 b901로 바꾸지 않는다. |
| 기록된 운영 배포 및 기능 | `b90154e22e6b4ba089275c7ae6d53e7274feae98` | `quality-production-ready-status-v1.json`의 READY·production·alias 일치, `live-quality-production-v1/raw.json`의 source SHA, triage SHA가 일치한다. 과거 readback이며 이번 감사 시점의 실시간 재확인은 아니다. |

산식은 낮을수록 좋은 지표에 대해 **절대 변화=Before−After, 상대 변화=(Before−After)/Before×100**이다. 양수는 감소, 음수는 증가다. 고정 guard는 After≤Before×1.15(latency), After≤Before×1.20(natural heap)이며 관측 뒤 변경하지 않았다. Before=0인 지표의 상대 변화는 정의하지 않는다. rAF p95 차이는 0.1ms 보고 한계 미만이므로 상대 변화도 제시하지 않는다.

| 흐름 | 환경·표본 수 | 지표 | Before | After | 절대 변화 | 상대 변화 | 노이즈·신뢰구간 | 판정 | 증거 경로 |
|---|---|---|---|---|---|---|---|---|---|
| 735행 fixture 클러스터 펼침 | Chrome 154, CPU4, 390×844; variant당 9 fresh 관측+2 warmup, 9 pairs | clickMs (ms) | 486.500000 | 470.400000 | +16.100000 | +3.309% | A/A95 절대차 96.760000; paired95 [-39.400000, 30.900000]; ABBA95 [-20.600000, 31.400000] | 고정 15% 중앙값 guard 통과; 개선 미입증 | `integrated-regression-summary-v2.json#cells.735.metrics.clickMs`; `readiness-mobile-ui-integrated-v2-ab/raw.json` |
| 735행 fixture 클러스터 펼침 | Chrome 154, CPU4, 390×844; variant당 9 fresh 관측+2 warmup, 9 pairs | naturalHeapMB (MB) | 19.106040 | 19.118724 | -0.012684 | -0.066% | A/A95 절대차 3.393712; paired95 [-3.788008, 0.047968]; ABBA95 [-2.460768, 2.231612] | 고정 20% 중앙값 guard 통과; 개선 미입증 | `integrated-regression-summary-v2.json#cells.735.metrics.naturalHeapMB`; `readiness-mobile-ui-integrated-v2-ab/raw.json` |
| 735행 fixture 클러스터 펼침 | Chrome 154, CPU4, 390×844; variant당 9 fresh 관측+2 warmup, 9 pairs | longTaskMs (ms) | 642.000000 | 604.000000 | +38.000000 | +5.919% | paired95 [-63.000000, 79.000000]; ABBA95 [-20.500000, 75.000000] | 보조 지표; 개선 미입증 | `integrated-regression-summary-v2.json#cells.735.metrics.longTaskMs`; `readiness-mobile-ui-integrated-v2-ab/raw.json` |
| 735행 fixture 클러스터 펼침 | Chrome 154, CPU4, 390×844; variant당 9 fresh 관측+2 warmup, 9 pairs | domNodes (nodes) | 5119.000000 | 5116.000000 | +3.000000 | +0.059% | paired95 [-5.000000, 4.000000]; ABBA95 [-5.000000, 4.000000] | 보조 지표; 개선 미입증 | `integrated-regression-summary-v2.json#cells.735.metrics.domNodes`; `readiness-mobile-ui-integrated-v2-ab/raw.json` |
| 2000행 fixture 클러스터 펼침 | Chrome 154, CPU4, 390×844; variant당 9 fresh 관측+2 warmup, 9 pairs | clickMs (ms) | 471.800000 | 485.700000 | -13.900000 | -2.946% | 2000 A/A 없음; paired95 [-53.100000, 13.300000]; ABBA95 [-35.700000, 23.400000] | 고정 15% 중앙값 guard 통과; 개선 미입증 | `integrated-regression-summary-v2.json#cells.2000.metrics.clickMs`; `readiness-mobile-ui-integrated-v2-ab/raw.json` |
| 2000행 fixture 클러스터 펼침 | Chrome 154, CPU4, 390×844; variant당 9 fresh 관측+2 warmup, 9 pairs | naturalHeapMB (MB) | 18.626264 | 18.594340 | +0.031924 | +0.171% | 2000 A/A 없음; paired95 [-0.001440, 6.494900]; ABBA95 [-6.221884, 6.503276] | 고정 20% 중앙값 guard 통과; 개선 미입증 | `integrated-regression-summary-v2.json#cells.2000.metrics.naturalHeapMB`; `readiness-mobile-ui-integrated-v2-ab/raw.json` |
| 2000행 fixture 클러스터 펼침 | Chrome 154, CPU4, 390×844; variant당 9 fresh 관측+2 warmup, 9 pairs | longTaskMs (ms) | 568.000000 | 614.000000 | -46.000000 | -8.099% | 2000 A/A 없음; paired95 [-96.000000, 20.000000]; ABBA95 [-80.000000, 24.000000] | 보조 지표; 개선 미입증 | `integrated-regression-summary-v2.json#cells.2000.metrics.longTaskMs`; `readiness-mobile-ui-integrated-v2-ab/raw.json` |
| 2000행 fixture 클러스터 펼침 | Chrome 154, CPU4, 390×844; variant당 9 fresh 관측+2 warmup, 9 pairs | domNodes (nodes) | 3494.000000 | 3492.000000 | +2.000000 | +0.057% | 2000 A/A 없음; paired95 [-3.000000, 4.000000]; ABBA95 [-1.000000, 3.000000] | 보조 지표; 개선 미입증 | `integrated-regression-summary-v2.json#cells.2000.metrics.domNodes`; `readiness-mobile-ui-integrated-v2-ab/raw.json` |
| 지도 away/return 60회 | Chrome 154, CPU4, 390×844; variant당 2 fresh process×60 종속 cycles, 총 ABBA 4 process | medianHeapMB (MB) | 32.298262 | 32.550954 | -0.252692 | -0.782% | 프로세스 범위 B [31.989312, 32.607212] / A [32.524454, 32.577454]; n2, CI 없음 | 고정 20% 프로세스 요약의 중앙값 guard 통과; 개선 미입증 | `integrated-warm-minimal-summary-v1.json#metrics.medianHeapMB`; `integrated-warm-minimal-v1/raw.json` |
| 지도 away/return 60회 | Chrome 154, CPU4, 390×844; variant당 2 fresh process×60 종속 cycles, 총 ABBA 4 process | peakHeapMB (MB) | 47.323384 | 52.912392 | -5.589008 | -11.810% | 프로세스 범위 B [46.488488, 48.158280] / A [47.147172, 58.677612]; n2, CI 없음 | 고정 20% 프로세스 요약의 중앙값 guard 통과; 개선 미입증 | `integrated-warm-minimal-summary-v1.json#metrics.peakHeapMB`; `integrated-warm-minimal-v1/raw.json` |
| 지도 away/return 60회 | Chrome 154, CPU4, 390×844; variant당 2 fresh process×60 종속 cycles, 총 ABBA 4 process | endpointHeapMB (MB) | 37.179700 | 24.081466 | +13.098234 | +35.230% | 프로세스 범위 B [36.099020, 38.260380] / A [20.762180, 27.400752]; n2, CI 없음 | 고정 20% 프로세스 요약의 중앙값 guard 통과; 개선 미입증 | `integrated-warm-minimal-summary-v1.json#metrics.endpointHeapMB`; `integrated-warm-minimal-v1/raw.json` |
| 지도 away/return 60회 | Chrome 154, CPU4, 390×844; variant당 2 fresh process×60 종속 cycles, 총 ABBA 4 process | frameGapP95Ms (ms) | 16.800000 | 16.800000 | 절대값 <0.1ms | 산출 안 함(0.1ms 미만) | 프로세스 범위 B [16.800000, 16.800000] / A [16.800000, 16.800000]; n2, CI 없음 | 고정 15% 프로세스 요약의 중앙값 guard 통과; 개선 미입증 | `integrated-warm-minimal-summary-v1.json#metrics.frameGapP95Ms`; `integrated-warm-minimal-v1/raw.json` |
| 지도 away/return 60회 | Chrome 154, CPU4, 390×844; variant당 2 fresh process×60 종속 cycles, 총 ABBA 4 process | frameGapMaxMs (ms) | 50.000000 | 91.600000 | -41.600000 | -83.200% | 프로세스 범위 B [50.000000, 50.000000] / A [83.200000, 100.000000]; n2, CI 없음 | 보조 지표 증가; guard 미설정; 원인·모집단 판정 불가 | `integrated-warm-minimal-summary-v1.json#metrics.frameGapMaxMs`; `integrated-warm-minimal-v1/raw.json` |
| 지도 away/return 60회 | Chrome 154, CPU4, 390×844; variant당 2 fresh process×60 종속 cycles, 총 ABBA 4 process | gapsAbove50Ms (개/프로세스) | 0.000000 | 10.000000 | -10.000000 | 산출 안 함(0 기준) | 프로세스 범위 B [0.000000, 0.000000] / A [9.000000, 11.000000]; n2, CI 없음 | 보조 지표 증가; guard 미설정; 원인·모집단 판정 불가 | `integrated-warm-minimal-summary-v1.json#metrics.gapsAbove50Ms`; `integrated-warm-minimal-v1/raw.json` |
| 지도 away/return 60회 | Chrome 154, CPU4, 390×844; variant당 2 fresh process×60 종속 cycles, 총 ABBA 4 process | longTaskMs (ms) | 0.000000 | 242.500000 | -242.500000 | 산출 안 함(0 기준) | 프로세스 범위 B [0.000000, 0.000000] / A [209.000000, 276.000000]; n2, CI 없음 | 보조 지표 증가; guard 미설정; 원인·모집단 판정 불가 | `integrated-warm-minimal-summary-v1.json#metrics.longTaskMs`; `integrated-warm-minimal-v1/raw.json` |

Cold의 9 pairs는 각 pair의 Before/After fresh process를 짝지은 단위다. A/A는 735행에서만 22 fresh process(관측 18+warmup 4), A/B는 두 데이터 규모를 합해 44 fresh process(관측 36+warmup 8)다. 프로세스당 trusted cluster click 1회다. 2000은 fixture의 총 데이터 행 수이며 raw의 렌더링 marker count는 Before/After 모두 464다. 735행 조건의 marker count는 양쪽 735다. 독립 사용자 수나 실기기 수로 바꾸어 읽지 않는다.

Cold endpoint는 첫 두 visible rAF 중 첫 표시까지의 clickMs, 그로부터 600ms 뒤 membership serialization 전의 natural heap이다. HTTP cache는 비활성화, service worker는 차단/우회, 원격 SDK·tiles 네트워크는 unthrottled다. natural heap은 transient allocation과 자연 GC 위상의 영향을 포함하며 강제 GC를 사용한 primary가 아니다. MB는 원시 usedSize byte÷1,000,000이다. 실제 프로토콜 조건은 `integrated-regression-plan-v2.json`, `integrated-warm-minimal-plan-v1.json`에 기록되어 있다.

표의 paired95·ABBA95는 기존 summary가 기록한 bootstrap 10,000회/seed 20261004의 감소량 구간이다. 감사에서는 원시값의 중앙값·MAD·범위·증감·A/A noise와 guard를 독립 재계산했고, 기존 CI의 0 포함 및 허용치 해석을 검증했다. bootstrap 구현과 난수 소비 순서를 포함한 **CI endpoint 자체의 독립 재생성은 검증 범위에 포함하지 않았다**. 모든 cold CI가 0을 포함한다. 2000행은 별도 A/A가 없으며 natural heap ABBA95 하한 −6.221884MB는 Before 대비 약 33.404% 증가까지 포함한다. 따라서 중앙값 guard 통과로 20% 초과 모집단 회귀 부재를 보장할 수 없다. n9 사용자 latency p95도 보고하지 않는다.

Warm은 variant당 fresh process 2개, 각 60개의 종속 away/return cycle이다. 총 240 cycle을 n240 독립 표본으로 취급하지 않는다. 350ms away/1000ms return 조건과 양쪽 minimal probe를 맞췄다. primary는 각 process의 60 natural heap endpoint 중앙값이며 표의 Before/After는 process 요약 2개의 중앙값이다. peak 및 endpoint도 각각 process별 값을 먼저 구한 뒤 두 process의 중앙값으로 요약한다. 모집단 CI와 독립적으로 맞춘 warm A/A는 없다.

개별 warm peak는 Before 48.158280/46.488488MB, After 58.677612/47.147172MB다. After 최대 **58.677612MB**는 두 Before peak보다 각각 21.843%/26.220% 높다. peak의 process 중앙값 증가 11.810%가 guard 안이라는 사실과 개별 peak 20% 초과는 함께 공개한다. endpoint의 35.230% 감소는 n2의 특정 종료 시점 차이여서 leak 해소나 개선 입증으로 판정하지 않는다. After의 initial→endpoint 자연 heap 증가는 각각 2.837116/7.749220MB로 남아 있다.

Warm 보조 지표도 숨기지 않는다. 최대 rAF gap의 process 중앙값은 50→91.6ms, 50ms 초과 gap 수는 0→10개/process, long task 합계는 0→242.5ms/process로 증가했다. 이 세 지표에는 고정 guard가 없어 전체 통과로 대체할 수 없다. rAF p95 16.8ms는 각 finite process window의 약 5천 frame gap에서 계산한 값이며 사용자 latency p95가 아니다.

같은 source에서 probe를 바꾼 관찰 영향 실험은 아래와 같다. 여기의 Before/After는 제품 버전이 아니라 full/minimal probe다.

| 흐름 | 환경·표본 수 | 지표 | Before | After | 절대 변화 | 상대 변화 | 노이즈·신뢰구간 | 판정 | 증거 경로 |
|---|---|---|---|---|---|---|---|---|---|
| 관찰 도구 full→minimal | 동일 34ebbb; probe당 2 fresh process×60 종속 cycles | medianMB natural heap (MB) | 64.104481 | 34.843139 | +29.261342 | +45.646% | full [63.340098, 64.868864] / minimal [34.772972, 34.913306]; CI 없음 | 같은 소스의 probe 차이; 앱 개선 수치로 사용 불가 | `warm-probe-effect-summary-v1.json`; `warm-probe-effect-v1/raw.json`; `warm-probe-effect-plan-v1.json` |
| 관찰 도구 full→minimal | 동일 34ebbb; probe당 2 fresh process×60 종속 cycles | endMB natural heap (MB) | 85.444820 | 32.513112 | +52.931708 | +61.948% | full [84.057340, 86.832300] / minimal [32.499732, 32.526492]; CI 없음 | 같은 소스의 probe 차이; 앱 개선 수치로 사용 불가 | `warm-probe-effect-summary-v1.json`; `warm-probe-effect-v1/raw.json`; `warm-probe-effect-plan-v1.json` |
| 관찰 도구 full→minimal | 동일 34ebbb; probe당 2 fresh process×60 종속 cycles | peakMB natural heap (MB) | 106.232190 | 51.679006 | +54.553184 | +51.353% | full [105.206740, 107.257640] / minimal [47.576328, 55.781684]; CI 없음 | 같은 소스의 probe 차이; 앱 개선 수치로 사용 불가 | `warm-probe-effect-summary-v1.json`; `warm-probe-effect-v1/raw.json`; `warm-probe-effect-plan-v1.json` |
| 관찰 도구 full→minimal | 동일 34ebbb; probe당 2 fresh process×60 종속 cycles | post-final diagnosticGC heap (MB) | 18.650762 | 18.658344 | -0.007582 | -0.041% | full [18.642868, 18.658656] / minimal [18.623512, 18.693176]; CI 없음 | 별도 GC 진단; primary·guard 대체 불가 | `warm-probe-effect-summary-v1.json`; `warm-probe-effect-v1/raw.json`; `warm-probe-effect-plan-v1.json` |

Full probe의 개별 natural endpoint는 86.832300/84.057340MB, minimal은 32.526492/32.499732MB다. 각 run의 restaurant 요청 2, otherFixture 요청 63 및 정확한 735 membership을 raw와 대조했다. 마지막 자연 heap 뒤의 diagnosticGC 18.623512–18.693176MB는 별도 진단이며 primary 값을 낮춘 근거로 사용하지 않는다. 교정 warm A/B에도 post-final diagnosticGC가 별도로 존재하고 primary guard 계산에는 포함하지 않았다. PROGRESS에 남은 이전 full-probe warm 증가 기록은 보존 대상이며 이 새 진단으로 삭제·성공 재분류·budget 면제하지 않는다. 이전 warm 원본 전체는 이번 산술 감사의 대상이 아니다.

배포·브라우저·field 증거는 다음과 같이 구분한다.

| 흐름 | 환경·표본 수 | 지표 | Before | After | 절대 변화 | 상대 변화 | 노이즈·신뢰구간 | 판정 | 증거 경로 |
|---|---|---|---|---|---|---|---|---|---|
| 후속 source519 UI | 실제 SDK+synthetic REST; browser emulation | 기능 / trusted swipe / viewport 전환 | 비교 baseline 없음 | 10/10 / 4 / 6/6 | 해당 없음 | 해당 없음 | 연속 기능·전환 검사; 독립 사용자 표본 아님 | 기록된 기능 검사 통과; 물리 폰·성능 개선 미검증 | `integrated-final-interactions-v1/raw.json`; `integrated-final-responsive-v1/raw.json`; `REPRODUCE-integrated-v1.md` |
| 운영 b901 배포 | 저장된 readback 2026-10-04T20:57:40.266152+00:00 | 배포 상태·alias 연결 | 이번 감사의 Before 없음 | READY, production, alias 일치 | 해당 없음 | 해당 없음 | 단일 과거 상태 영수증; 이번 시점 재조회 없음 | 기록된 운영 배포 확인; 전체 작업 완료 판정 아님 | `quality-production-ready-status-v1.json` |
| 운영 b901 기능 | Chrome 154.0.8037.97; desktop 1440×900, mobile 384×824, tablet 768×1024 | viewport별 검사 통과 수 | 비교 baseline 없음 | 6/6 + 7/7 + 7/7 = 20/20 | 해당 없음 | 해당 없음 | actual SDK, 실제 public 전송; SDK/data/asset interception 없음; 합성 viewport | 지정 기능 통과; 실기기·부하 시험·성능 비교 아님 | `live-quality-production-v1/raw.json` |
| 운영 b901 오류 관찰 | 위 3 viewport case | page error / console error 이벤트 수 | 비교 baseline 없음 | page 0/0/0; console 3/2/2 | 해당 없음 | 해당 없음 | console 합계 7은 case별 이벤트 합; 고유 결함 7개 의미 아님 | page error 0과 console error 부재를 구분 | `live-quality-production-v1/raw.json`; `live-console-triage-v1.json` |
| 별도 운영 console 진단 | fresh QA context 1개 | bounded HTTP 분류 / CSP 이벤트 / field POST | 비교 baseline 없음 | 401 분류 2개; CSP 이벤트 2; field POST 0 | 해당 없음 | 해당 없음 | 원인 일부 미분류; 기존 20check와 별도 측정 | SDK 준비 확인; 보안 정책 완화 없음; console 완전 무오류 미입증 | `live-console-triage-v1.json`; `live-console-diagnostic-v7/raw.json` |
| 운영 field 기존 집계 | anonymous 자기보고; QA 제외; 2026-10-04T17:51:24.902Z | 지표별 sample 수 | 비교 cohort 없음 | LCP 7 / INP 3 / CLS 5 | 산출 불가 | 산출 불가 | distinct users 미측정; 같은 사용자·세션의 중복 여부 불명 | 15 metric samples를 15 사용자로 볼 수 없음; 비교 개선 미입증 | `field-aggregate-readback-20261005-v1.json` |

운영 기능 raw에서 page error는 세 viewport 모두 0이지만 console은 3/2/2다. 별도 진단에서는 announcements/ad_banners의 401이 각 1회, CSP 분류가 2종 기록되었다. triage는 두 401에 기존 bounded fallback이 적용되는 것으로 해석한다. 이 감사는 소스 동작을 다시 실행하지 않았다. 외부 SDK 연결의 세부 원인과 eval 이벤트의 provider/automation 기여가 아직 분류되지 않았으므로 콘솔 문제가 모두 해결됐다고 쓰지 않는다. 자유형 원본 메시지·endpoint URL은 옮기지 않았다.

Field readback 시각은 위 b901 READY readback 시각보다 이르며, field 파일에는 source SHA 연결이 없다. 따라서 이 집계를 b901의 field 결과로 귀속하지 않는다. 두 시각의 순서만으로 실제 배포 전후 cohort 경계를 추정하지 않는다.

플리커 캡처는 mobile/tablet 각각 navigation crop 정지 PNG 4장, 최소 약 150ms 간격과 screenshot overhead를 가진다. 총 8장은 연속 영상이 아니며 crop 밖 지도 영역과 프레임 사이 transient 현상을 관찰하지 못한다. triage의 mobile 첫 crop 관찰은 기존 작성자의 기록이며 이번 감사가 이미지를 새로 시각 검수한 결과가 아니다. 따라서 플리커 제거·발생률 0·실기기 재현 해소를 주장하지 않는다. qCLS/shift 관측이나 정지 화면도 그 보증을 대신하지 않는다.

독립 감사에서 확인한 문서·환경 한계가 있다. `REPRODUCE-integrated-v1.md`의 Chrome151 표기와 달리 cold raw의 browser user-agent는 HeadlessChrome154, warm/probe 및 운영 raw는 154.0.8037.97이다. 보고서는 해당 raw를 우선했으며 기존 문서는 수정하지 않았다. Node/npm/Bun/Playwright 버전은 문서 서술만 읽었고 런타임 영수증 전체를 대조하지 않았으므로 확정 실행환경으로 추가 인용하지 않는다. Cold 관측 process의 resourceBefore/After 중 heavyOverlap은 A/A 9/18, A/B 25/36에서 true이며 saturated는 양쪽 0이다. 이 표시는 성능 효과의 원인 증명이 아니고, 부하가 일정했다는 가정도 허용하지 않는다. 모든 표본을 보존했으며 사후 제외로 결과를 개선하지 않았다.

남은 작업과 완료로 쓰지 않은 범위는 다음과 같다.

- b901의 최근 빌드·측정은 부모 작업 진행 중이다. 현재 지정 파일에 없는 신규 성능 수치나 검증 결과는 이 초안에 넣지 않았다.
- main Nightly verified bundle은 별도 agent가 읽는 중이다. 해당 bundle을 이번 감사에서 확인하지 않았으며 main publication·issue 완료로 쓰지 않는다.
- Swift3132 source/cfg 승격은 진행 중이라는 작업 경계를 유지한다. 완료·운영 반영을 입증하는 영수증을 이 감사가 확인한 것은 아니다.
- 실제 Galaxy Chrome/Samsung 검증은 human hold 중이다. hold 해제 후의 새 source 실기기 검사, 지도 전체를 포함하는 적절한 플리커 관찰이 남아 있다. 이 감사에서는 예약·자동 실행하지 않았다.
- 비교 가능한 field Before/After cohort, 기간·환경·중복을 해석할 표본 근거가 없다. field/canonical timing 및 G003 성과 admission은 0을 유지한다. 기존 field metric count를 이 실험의 admission으로 전환하지 않는다.
- Chrome 버전 문서 불일치, 기존 CI endpoint 재현의 구현·RNG 확인, 2000행 A/A 부재, n2 warm의 일반화 한계, warm peak·프레임 보조 지표 증가는 추가 해석·검증 대상으로 남는다.
- source/evidence 정식 freeze, 최종 canonical map/scorer/validator, 외부 pin과 Git blob readback 및 최종 push 완료를 이번 결과로 대체하지 않는다. 이번 입력 SHA는 읽은 파일의 추적·변경 탐지용이며 canonical map이나 freeze 영수증이 아니다.
- PROGRESS의 리뷰 fixture, 보안·의존성, 관리형 DB, 전체 repository queue 관련 진술은 이번 raw 산술 검증 범위가 아니다. 이 부분의 전체 해결이나 저장소 전체 완료를 선언하지 않는다. 근거가 없는 최상위 성능·대규모 사용자 준비 완료 문구도 사용하지 않는다.

산술 검증 결과는 같은 폴더의 `ARITHMETIC-VALIDATION.json`과 재계산 코드 `audit_report.py`에 있다. 이 코드는 기존 집계기를 실행하거나 원시 증거를 수정하지 않고 Python 표준 라이브러리로 읽어 계산한다. 모든 입력 파일 SHA와 읽기 전후 동일성, 비교 수식·단위·guard·source 경계, 미검증 항목을 별도로 저장한다. CI 원래 endpoint의 수학적 부호 해석 검증과 endpoint 생성 과정 검증을 구분한다.
