# Tzudong CI·운영 delivery 보고서

위치 권한 capability의 fractional monotonic 시간 계산 결함을 재현·수정했고, optional3D의 불필요한 모바일 WebGL/import/animation 자원 생성을 차단했다. 보호된 develop→data→main 승격을 마쳤으며 최종 main `b4eb780c532c9ba02a1af456b17459debc59a757`와 READY production `dpl_5MdWf1WjdpgsTGWzo7SV97u7nFcn`, 실제 www URL의 SHA/alias/readback이 일치한다. 이것은 전체 서비스 무결함·원래 메모리 회귀 해소·physical/field 성과의 증명이 아니다.

작성 시각: 2026-10-18T11:33:39.191669+00:00. 기준 조건과 실패/rollback 판단은 결과 전에 저장한 production-verification-plan-v4.json을 따른다. 전체 성능 개선율을 계산하거나 구성요소 절감률을 합산하지 않았다.

| 흐름 | 환경·표본 수 | 지표 | Before | After | 절대 변화 | 상대 변화 | 노이즈·신뢰구간 | 판정 | 증거 경로 |
|---|---|---|---|---|---|---|---|---|---|
| 위치 capability 발급 | Chromium153, phase별 process1/context4; fractional context3×종속시도3 | 3종 fractional 시점의 발급 성공 | 0/9 | 9/9 | +9건 / +100%p | 0 baseline이므로 계산 안 함 | 합성 clock/fetch; population CI/p95 없음 | 정확성 결함 재현·수정; 전체 UI/실제 위치 미검증 | location-precision-browser-comparison-v1.json; location-precision-browser-v2/ |
| 위치 만료 경계 | 동일 합성 API, after 4context×3시도 | exact expiry 및 rewind 후 거부 | 기존 실패에서는 발급 자체 실패 | 저장된 exact expiry 및 만료 관찰 뒤 rewind 거부 | 비교 불가 | 해당 없음 | 실제 권한 요청/좌표 획득 없음 | 권한 경계 보존 관찰 | location-precision-browser-v2/results-after.json |
| 모바일 optional3D | 실제 React/Nextdynamic/software GL; phase별 process1; 6문제 navigator profile×종속 open3 | WebGL context 생성 수/profile | 3 | 0 | 3 감소 | 100% 감소(구성요소 한정) | UA/CPU/memory 합성, CI/p95 없음 | 불필요한 선택적 자원 생성 차단 | badge-mobile-comparison-v1.json; badge-mobile-capability-v1/ |
| 모바일 optional3D cold import | 같은6문제 profile; profile당 cold1 | 추가 engine script 수/profile | 1 | 0 | 1 감소 | 100% 감소(요청 개수 한정) | 같은 process의 fresh contexts; 실제 CDN bytes 아님 | 무거운 import 차단 관찰 | badge-mobile-comparison-v1.json |
| 모바일 optional3D RAF | 같은6문제 profile; open당220ms window | 관찰 callback 수/window | 13–14 | 0 | 13–14 감소 | 100% 감소(조건부 loop 제거) | 프레임 시간/FPS/CPU/배터리/process memory 미측정 | loop 제거; 서비스 성능 개선 입증 안 됨 | badge-mobile-comparison-v1.json |
| 정상 desktop3D control | 동일 component/process1; 종속 open3 | RAF callback/window | 13,14,13 | 13,14,14 | median 13→14 | 개선율 산출 안 함 | 220ms scheduler 관찰; A/A·랜덤화 없음 | 성능 개선 입증 안 됨 | badge-mobile-comparison-v1.json |
| 실제 지도·상세·리뷰·도장·랭킹 | 운영 Chromium153; 각 버전 process1, 3viewport fresh contexts | 기능 흐름 통과 viewport | 3/3 (00234) | 3/3 (최종 main) | 0 | 0% | 기능 readback; latency/INP/LCP 측정 아님 | 주요 익명 기능 회귀 관찰 안 됨 | live-readback-before-v3.json; live-readback-after-v4.json |
| 운영 pageerror | 동일 실제 URL3viewport | pageerror 수 | 0 | 0 | 0 | 0 baseline이므로 계산 안 함 | 짧은 기능 시나리오3개; 전 사용자 오류율 아님 | 관찰 중0건 | live-readback-after-v4.json |
| 운영 strict 뒤로 가기 | 최초 desktop 시도; baseline과 같은 strict criterion | 원래 marker visibility 계약 | 실패 (before-v1) | failed | 해결 입증 안 됨 | 해당 없음 | diagnostic pass가 strict fail을 대체하지 않음 | 미해결 | live-history-before-v1.json; live-history-after-v3.json; live-history-after-v4.json |
| 전체 UI memory·field·물리 모바일 | 이번 phone-free 범위 표본0 | memory guard/INP/LCP/CLS·고빈도 pixel flicker | 원래 실패/불충분 자료 유지 | 이번 범위 미측정 | 계산 불가 | 계산 불가 | 실기기/field로 외삽 금지 | 개선 입증 안 됨 | production-verification-plan-v4.json; REPRODUCE.md |

## 원인과 구현

W001: `(262144.02702702704 + 300000) - 262144.02702702704`가 `299999.99999999994`여서 유효한 capability의 발급까지 거부됐다. 발급 당시의 합을 직접 비교하도록 수정했다. O(1) 연산/공간이며 epsilon·lifetime 연장·새 권한을 도입하지 않았다. 기존 WeakMap identity·finite/safe timestamp·저장된 만료 경계·철회·만료 관찰 뒤 재생 거부를 유지했다. 새 unit은 before9pass/1fail → after10pass/128assertions/0fail. 실제 컴파일된 private API의 Chromium fixture도 재검증했으나 clock/readiness는 합성이다. deadline은 binary64 합 fl(grantedAt+300000)의 half-open 구간이며 실수론적으로 정확한300000ms라는 주장은 하지 않는다. captured performance.now()를 trusted monotonic primitive로 사용하고, 만료 전 비준수 clock의 모든 역행을 자체 탐지하지 않는다. 외부 지적의2000→1500 허용 및 만료 관찰 후1500 거부를 isolated Bun의 실제 private API에서 재현했다(cross-audit-v1/thesis-clock-boundaries-observed-v1.json). 요구되지 않은 state 추가나 시간/권한 완화는 적용하지 않았다.

W002: low flag만 전달하면 caller가 무거운 모듈을 먼저 import하는 문제가 남았다. 순수 tier 계산과 caller gate로 unknown/intermediate mobile/touch를 정적 preview로 보내 import 이전에 차단했다. signal-only와 최종 gate 결과를 별도로 보존했다. 기본 experimental3D off, unpublished cohort는 유지했다. API 미지원 고성능 iPhone도 정적화되는 trade-off가 있다. OS→모델 추정과 전역 map presets는 이 수정으로 검증/재설계되지 않았다. deviceMemory의 반올림·상한·미지원 정책 한계는 [W3C 초안](https://www.w3.org/TR/device-memory/)을 참고하되 실제 기기 성능 판정으로 취급하지 않는다.

그 외 초기화/teardown·포커스 복귀·Escape containment·reduced motion, 등급 cache invalidation 및 legacy cryptographic migration boundary 회복 자료를 보존했다. 적용된 SQL/ledger를 고치거나 새 DB·Storage 쓰기를 실행하지 않았다. source manifest v7의51개 파일은 별도 Git-object byte 검증을 통과했다.

## 검사·승격·배포

source #3319 `{'SKIPPED': 1, 'SUCCESS': 18}`, data #3320 `{'SUCCESS': 30, 'NEUTRAL': 1}`, main #3321 `{'SUCCESS': 29}`. 각각 exact head의 필수 검사·관련 전체 검사 완료, 실패0/미해결리뷰0을 확인했다. 정상 head-matched merge를 사용했고 protection/관리자 우회/force는 없었다. 기존 #3317의 실제 단위 실패는 지우지 않았고 9228의 forward fix로 해결했다.

별도의 sampler gap73.327ms>60ms 실패는 단위 결함과 다르다. 기준/소스 변경 없이 선택된 job을1회 재실행해 성공했고 raw artifact 둘 다 보존했다. 이를 compiler 속도·메모리 개선으로 해석하지 않았다. 로컬 targeted lint, TS parity diagnostics0/3182logicalInputs, production build/CSS, offline production browser3/3을 통과했다. 개발 fixture·production build·실제 운영 URL은 별도다.

운영은 기존 민감 approved-SHA 값만 최종 protected main에 결합했다. current READY rollback은2e5630f/dpl_8vFh…로 fresh preflight했다. exact GitHub SHA로 한 건 생성하고 unknown/cancelled 자동 배포를 먼저 대사했다. project/root/Node/Git 연결/alias/health를 readback했다. DB/Storage/DNS·과금·계정·휴대폰을 변경하지 않았다. 공개 API schema2/unpublished/nullrevision/entries0, four WebP200 및 Git bytes/SHA256 일치를 검증했다. 배지 활성화나 실제 사용자 등급 성과를 주장하지 않는다. 위치 readiness는 before2e와 after최종 모두 available/VERIFIED 응답으로 동일하며 이 패치가 활성화한 상태가 아니다. 해당 코드만으로 독립 법적 승인 증거를 인증하지 않는다.

## 실패·미검증·trade-off

콘솔 error 수(1440/834/430)는00234 기준 [6, 2, 2], 중간2e [7, 2, 2], 최종 [7, 2, 2]이다. 짧고 비무작위인 시나리오이므로 차이를 통계적 증감으로 해석하지 않는다. nelo/eval CSP 및 익명 announcements/ad_banners401을 보존하고 보안 정책을 완화하지 않았다. strict history 원래 marker visibility와 별도 diagnostic detail restoration을 구분하며, 남은 실패를 무결함/launch-ready로 바꾸지 않는다.

정적 map crop3개는 픽셀 검토 자료이고 영상/연속 프레임이 아니다. viewport별 단일 캡처이며 고정 주기 탐지가 없고 바텀 네비게이션은 crop 밖이다. 태블릿에는 모든 음식 아이콘 로드 완료가 보장되지 않았다. 캡처 사이 플리커를 배제할 수 없으며 발생률·지속 시간·완전 제거를 주장하지 않는다. 전체 memory guard, physical Galaxy Chrome/Samsung Internet, 장기 반복 방문 누수, slow CPU/network, field cohort/INP/LCP/CLS와 인증 쓰기는 이번 범위에서 미검증이다. phone-free 지시를 준수했다.

통계: 낮을수록 좋을 때 절대 감소=before−after, 상대 감소=(before−after)/before×100. 성공 지표는 after−before의 건수/%p를 쓴다. 0 기준선 비율은 N/A. phase당 process1과 종속 반복으로 population CI/p95를 만들지 않는다. RAF13↔14 차이는 개선 입증 안 됨이다. 각 구성요소 효과와 최종 기능 회귀 검증은 합산하지 않는다.

## 감사와 증거

Deep Research는 cross-audit-v1/의 단일 canonical plan과9개 공개 소스 bundle을 사용한다. 로그인·Pro/Argon·research 조합·예약·업로드·시작·전문 저장·판정은 별도 receipt로 구분한다. 첫 ChatGPT6 Pro 심층 감사 전문47182bytes와 별도17개 공개 인용URL 매핑을 보존했다. Gemini 반대 감사는 공통 ledger에 대기 중이고 역방향 감사는 미실행이다. 후속 증거는 ../cursor-evidence-cross-audit-20261018-v2/에 추가해 봉인된 이 묶음을 바꾸지 않는다. 외부 보고서 전문/최종 판정 상태는 해당 디렉터리의 최신 status를 확인한다. 로컬 matrix를 외부 감사 완료로 간주하지 않는다.

재현 절차는 REPRODUCE.md 및 REPRODUCE-mobile-capability-v1.md, raw 표본과 실패는 각 하위 폴더에 있다. complete-set map과 별도 docs/evidence SHA pin, 독립 local verifier 및 fresh remote-only Git byte verifier를 사용한다. map 자체는 root map에서 제외하고 remote receipt는 root 밖에 저장한다. 자격증명 패턴 검사는 제한된 탐지이며 전면 보안 인증이 아니다. 원래 dirty checkout과 pre-promotion-checkpoint-v1은 보존했다.
