# 전환·스크롤과 readiness 소스 전달

설치한 transitions-dev/transitions-polish를 적용한 변경과 리뷰·로그인·미디어 안정성 수정의 보호된 소스 승격을 완료했다. Main056a86600f412eb42df4304e3206841679012f3e이며 PR3147→3192/3193→3172→3194를 정상 검토·현재 head 검사·병합으로 전달했다. Force/admin merge, 검사 생략, protected ref 직접 쓰기는 사용하지 않았다.

메뉴·토스트는150ms 진입/80ms 닫기와 opacity·8px 이동·작은 scale을 사용하고, 큰 지도·핵심 sheet 동작은 즉시 반영한다. Scroll reveal은1회만150ms/8px이며 초기 opacity.96으로 내용이 이미 읽힌다. 모션 감소 설정의 최초 상태와 실행 중 변경을 지원한다. 한 CSS root, 최대40개 대기 대상, added-subtree 탐색, 해제된 observer/타이머 소유 경계를 유지한다. 전환·스크롤의 자세한 구조·실제 SDK 기능·12회 지도 이동에서 whole-document scan24/17/19→0 관측은 이미 고정한 transitions-adoption-20261012/REPORT-v1.md와 scroll-transitions-20261012/REPORT-v1.md에 있다. Timer/scan 수 감소를 field·입력 지연·heap 개선으로 확대하지 않는다.

최신 추가 수정은 과거 GIF 인증 사진의 관리자 표시 경로를 복구한다. Before12 pass/2 fail 재현 → 관련28 pass. 전체 web3452 pass/11 skip/0 fail, lint0, native7.0.2/compat6.0.2 parity0, Next16.3.8 정식 Webpack build 및 실제 named-dist CSS gate를 통과했다. 독립 loopback protocol fixture에서 Chrome154가 실제 합성 GIF1×1을 decode하고 바이트·200·no-store·nosniff와401-before-IO를 확인했다. 실제 관리자 인증/화면/자료 또는 운영 pixel 증명은 아니다. 실패한 shared dependency 검사·비정식 Turbopack 시도와 정확한 범위 정정도 보존했다.

운영 배포는 아직 갱신하지 않았다. www/root 별칭은 READY dpl_EUxJnWmDDozCSMWb2sqNSPgKJLM5, source1884f87e53c4567ead7c9a0fb394b09b91a70396을 제공한다. 실제 www/api/health도 SHA/deployment/project를 일치 확인했다. 이1884가 named rollback이다. 최신 main056a를 운영했다고 보고하지 않는다. 운영 SQL·Storage transfer/delete·env write·수동 production deploy0이다. Git hook의 자동 production attempt dpl_ZF1VsKhzFHk7jbBU3YDkB4episwc는 CANCELED이며 ignored-build 관측/compile 관측 없음까지 확인했다. 구체적인 cancellation 원인을 확인했다고 확대하지 않는다.

현재 G037_WRITE_FREEZE=active이며 .github/workflows/supabase-migration-apply.yml의 apply 조건은 active 상태에서 두 G016 id만 허용한다. Exact PG17 clone/rollback과11개 source hash가 일치한 atomic bundle77b34753c68047d3b479484f156e44044d015c53b8e5d459da4b8d1d97f0d1d3에 한정한 릴리스 예외 승인 답변을 요청했고 아직 받지 못했다. Global freeze/자동 producer는 유지한다. 이 예외의 구현·운영 적용은 미완료다. 승인 없이 다른 실행 경로로 이 게이트를 우회하거나 production approved SHA를 갱신하지 않는다. 기존 사용자 데이터와 serving deployment를 보존한다.

## 별도 캐시 후보의 정량 결과

다음 값은 Next16.3.6의 후보21a86dca와 baselineda4c9be 비교다. 최신 Next16.3.8 전환 소스의 성능 수치가 아니다. AA4 fresh process+AB9쌍18 process, 각256개 종속 동작(검색128개+재방문128개), CPU4/cacheoff/SWbypass/390×844/dpr1, 실제 Naver SDK/타일·합성 REST735/Auth401이다. 물리 전화·Samsung Internet 또는 field가 아니다. 비교 후 guard를 완화하지 않았다.

낮을수록 좋은 값: 절대 감소량=Before−After, 상대 감소율=(Before−After)/Before×100. 표의 중앙값 차이와 쌍 차이 중앙값의 bootstrap95% CI는 다른 estimand다. 고정 seed20261009/20,000회이며 AA 단2쌍은 약한 noise 추정이다.

| 흐름 | 환경·표본 수 | 지표 | Before | After | 절대 변화 | 상대 변화 | 노이즈·신뢰구간 | 판정 | 증거 경로 |
|---|---|---|---|---|---|---|---|---|---|
| 검색128개×2회 | production CPU4, 독립9쌍 | 종료 자연 heap MB |27.933232|33.083332|-5.150100|-18.437%|AA≤5.539700; paired95% CI[-8.234268,18.178284]|회귀 해소 미입증;4/9쌍 >20%|swipe-memory-confirm-v7-20261012/browser-confirm-summary-v7.json|
| 같은 흐름 | 같은9쌍 |5초 idle heap MB|29.025812|34.229488|-5.203676|-17.928%|AA≤5.547908; paired95% CI[-8.215704,12.971836]|회귀 해소 미입증;5/9쌍 >20%|동일 summary / ui-ab-confirm-v7-*/raw.json|
| 검색 선택 클릭 | 같은9쌍 |클릭→화면 관찰 median ms|160.400000|160.300000|0.100000|0.062%|AA≤1.500000; paired95% CI[-5.650000,13.200000]|개선 입증 안 됨|동일 summary / measure-ui-v7.mjs|

후보는 source에 포함하지 않았다. Natural memory guard20%와 input15%를 유지하며 paired CI가 memory20% 초과를 배제하지 못한다. Snapshot shape 진단은 별도1회씩/possibleGC로867개의 selection-key 형태와133개 list snapshot 형태를 확인했지만 독점 retained bytes·전체5.15MB 원인·leak 증명이 아니다. Primitive 공간 모델은O(R+Σ list길이)이며64-entry cache만으로 살아 있는 query-list history 전체가 제한되지 않는다. 추가 보유 경로·causal trace와 새 후보의 동일 조건 재측정이 남는다.

Primary evidence188개 파일, 진단20개, GIF source/검증25개를 각각 고정했고 총240개 관련 Gitblob ids가 원격 evidence commit6df232d1599bdf7a477c379474f852fe8370daee와 일치했다. Primary explicit verifier는 normal/-O/relocation/tamper를 확인했다. Canonical scorer/독립 validator는 실행 PASS지만 items0/admitted0/releaseBlocked=true다. Budget에 heap metric이 없으며 fake metric/admission을 만들지 않았다. Console44+network63은 중복될 수 있는 관측이다. Source health 또는 구조·timer 감소가 전체 성능 통과는 아니다.88장의 정지 캡처는 플리커 빈도·지속 시간을 판정하지 않는다.

Current FULL npm audit는 dev421을 포함해 모든 severity0이다. 이전 high7 기억은 현재 상태가 아니다. 현재 프로젝트는 기존 유지보수된 명시적 private fork @tzudong/braces3.0.3-tzudong.1을 사용하며, depth128/node50000·ordinary patterns·deep strings·AST/cycle3 tests가 전체 suite에서 통과했다. 공식 upstream patched release는 아직 없다는 [GitHub 권고](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm)를 새로 확인했다. Audit0을 공식 upstream patch 또는 모든 exposure/보안 인증으로 해석하지 않는다. 이 fork는 이번 턴에 새로 도입한 변경이 아니다.

Field readback은35개 cohort group/224개 지표 관측이며 독립 사용자 수가 아니다. 방문 분모·브라우저 구분·세션 의존성 정보가 없고 현재1884 cohort는 이 snapshot에서0 관측이다. Collector 고장·무방문으로 단정하지 않는다. Prospectivev2 collection/분모·browser cohort·사전 기준·충분한 기간과 표본 평가가 아직 남고 field 개선은 미입증이다. 휴대폰은 사용자 지시대로 사용하지 않았으며 물리 검사로 확장하지 않는다.

다음 단계는 승인된 좁은 DB 릴리스 예외의 보호된 소스 전달, fresh main/catalog/ledger/rollback admission, coherent11 SQL/readback, unchanged8-photo ref/byte plan 확인과 private copy→원본 제거→public denial/admin image 검증, production guard/exact SHA/aliases/실제 흐름 재검증이다. 기존 expired review Apply6a560d...는 다시 보내지 않고 authoritative GET으로만 먼저 reconciliation한다. 메모리·픽셀·field 남은 작업을 삭제하거나 전체 goal 완료로 표시하지 않는다.
