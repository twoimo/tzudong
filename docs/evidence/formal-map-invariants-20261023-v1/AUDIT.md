# Tzudong 상태·수식 점검

8개 반례를 실제 코드로 재현하고 수정했다. **한정된 입력·순서에 대한 검사이며 전체 시스템의 무오류 증명이 아니다.** 새 운영 배포, 실제 지도 SDK와 PC·모바일·태블릿의 최종 프리뷰, Nightly 통과를 이 결과로 대신하지 않는다.

기준은 최신 develop `56427320a44fdd65a86dc49e7e63d80dd9935c2e`, 수정·검증 코드의 동기화 커밋은 `fe4b73dac510d4670517c7d3eca4f0c2470d4297`다. 원래 작업과 다른 소유자의 변경을 보존했다. 현재 브랜치는 `codex/formal-map-invariants-20261023`이다.

## 반례와 수정

| ID | 판정 | 실제 반례 / 영향 | 수정과 검사 |
| --- | --- | --- | --- |
| FORMAL-01 | ACCEPT | 같은 마커의 이미지 URL 등이 같으면 부분 패치가 성공해 불 등급·SVG나 이미지 설명이 이전 값으로 남았다. | 말풍선을 제외한 **전체** 기존/다음 HTML이 같을 때만 부분 패치. 48종·객체 갱신 2방식의 9,216건의 활성/반환 후 재사용 전이, 실제 Chromium DOM. 말풍선만 바뀌면 이미지 노드는 계속 유지. |
| FORMAL-02 | ACCEPT | `1 / Number.MIN_VALUE` 및 큰 유한 gamma와 여러 방문의 곱이 `Infinity`가 되어 입력의 유한성만으로 결과를 보장할 수 없었다. | 반감기·방문 배수의 결과도 유한성 검사. 정상 계수의 결과는 유지. 두 guard를 각각 제거한 변형 모두 탐지. |
| FORMAL-03 | ACCEPT | 안전 정수인 최대 timestamp에 5,000ms를 더하면 안전 정수 범위를 벗어났다. | 샘플링 창의 끝도 동일한 timestamp 경계로 검사. 실제 함수를 통한 실패/정상 회귀 및 guard 제거 변형 탐지. |
| FORMAL-04 | ACCEPT | `(freshness, visit_multiplier)` 벡터를 scalar 점수로 환산한 정책이 없는데도 운영 점수가 존재하면 `differs=true`, 신호가 모두 있으면 쓰기 가능으로 표시했다. | 비교 미성립을 `comparison_present=false`, `differs=null`, `differ_count=null`로 표현하고 쓰기 차단. 호출자는 현재 내부 테스트뿐임을 검색 확인. 임의 점수식은 도입하지 않음. |
| FORMAL-05 | ACCEPT | metric의 `true`가 `Number(true)=1`, `[123]`이 `123`으로 변환되어 실제 관측 없는 불 등급을 부여할 수 있었다. | 기존 `safeCount` 경계 재사용. boolean·배열·객체 등은 결측으로 남기고 standard 유지. 기존 불필요한 중복 parser를 추가하지 않음. |
| FORMAL-06 | ACCEPT | 같은 video에 서로 다른 관측 수치가 있으면 마지막 행이 승리해 순서에 따라 결과가 달라졌다. | 충돌을 고정 코드로 거부. 두 입력 순서 모두 거부하고 동일 중복은 한 번만 사용. |
| FORMAL-07 | ACCEPT | 초기 모델은 리뷰를 이미지 안에 배치했지만 실제 Naver는 바깥 앵커에 둔다. 기존 리뷰 A→B 갱신이 기존 A를 남기고 B를 안쪽에 추가해 리뷰가 두 개가 됐다. | 실제 wrapper를 기존 리뷰 모듈로 이동해 Naver와 모델이 함께 사용. 기존 리뷰 노드를 제자리 교체하고 구조 변경은 SDK 아이콘 갱신. 수정 전 실제 래퍼에서 bubbles=2/currentReview=false를 재현했고 수정 후 한 개의 최신 리뷰·이미지 보존을 확인. |
| FORMAL-08 | ACCEPT | 리뷰 객체는 같고 content/userName/photoUrl만 바뀌면 wrapper 캐시가 예전 HTML을 반환했다. 기존 필드 감지 render token은 갱신을 알아도 wrapper 캐시는 참조·마커·화면 모드만 비교했다. | 이미 존재하는 필드별 render token을 wrapper 캐시에 연결. 같은 객체 갱신을 탐색에 추가해 202번째 조건의 stale review를 재현했고, 작성자·본문·사진 변경 native 회귀와 guard 제거 변형을 통과. |


초기 inline 리뷰 모델의 2,048건 통과는 실제 앵커 구조에 대한 검증이 아니었다. 이 correspondence 공백을 발견해 속성을 약화하지 않고 실제 wrapper를 모델에 연결했다. [추가 실패 원문](actual-wrapper-counterexample.txt)과 현재 9,216건 결과를 구분한다. 새 객체만 만들던 다음 모델도 동일 객체 갱신을 다루지 못했다. [동일 객체 캐시 반례](mutable-cache-counterexample.txt) 후 새/동일 객체 갱신 두 방식을 모두 탐색한다. 초기 원시 기록은 Git 커밋 `92bff943925941f047e244090c3ae3bc7615718b`에 그대로 남아 있다.

처음 소유권 모델에서 `A 표시 → A 반환 → 같은 객체로 B 표시 → 예전 A 변수로 클릭`을 A의 클릭으로 해석했다. 실제 객체는 이미 B를 표시한다. 이는 모델의 잘못된 소유권 가정으로 판정했고 제품 버그로 세지 않았다. 현재 모델은 물리 객체의 현재 소유자를 추적한다. 해제 후 아직 재사용되지 않은 객체의 클릭은 차단되어야 하며 guard 제거 변형으로 이 조건의 탐지력을 확인했다.

## 수식의 의미와 한계

`H(t)=1/(1+λt)`의 반감기는 `t=1/λ`다. `λ=0.0015=3/2000`이면 `2000/3 ≈ 666.6667일`이며 460일은 아니다. 460일에는 `100/169 ≈ 0.591716`이다. 기존 반박과 정상 결과를 유지했다.

`D(t)=f+(1-f)/(1+t/h)`에서 `0≤f<1`, `h>0`, `t≥0`이면 `D(0)=1`, `f≤D(t)≤1`이고 도함수는 `-(1-f)/(h(1+t/h)²)≤0`다. `D(h)=(1+f)/2`이므로 h는 **바닥을 뺀 가변 부분의 반감기**다. 전체 값이 0.5가 되는 시각이라는 해석은 일반적으로 성립하지 않는다. 부동소수점 구현에서 극단값의 반올림·underflow까지 실수체의 엄격 부등식으로 확대하지 않는다.

P98/P95/P85는 현행 builder가 포함하는 양의 유효 조회수 표본의 `ceil(pN)`번째 값을 문턱으로 삼는다. 동점이 없는 fire 수는 `N-ceil(0.98N)+1`이며 동점이면 더 많아질 수 있다. 모든 값이 같으면 모두 fire일 수도 있다. 따라서 정확히 상위 2%/5%/15% 인원 할당이라는 주장은 하지 않는다. 현재 JS 식과 정수 순위식을 N=1~5,000에서 비교한 결과는 [순위 계산 기록](rank-enumeration.json)에 있다. 이는 그 유한 범위의 식 비교이며 builder 전체나 모든 분포의 형식 증명은 아니다. 실제 builder에는 n=19/20 경계와 오염·중복 입력 검사가 있다.

방문 수는 고유 video ID만 센다. 수학적으로 유효한 실수 식과 JavaScript에서 표현 가능한 수는 다르므로 결과 overflow를 거부한다. 후보 신호와 운영 점수는 단위·합성 정책이 다르며, 데이터 존재만으로 수치 비교나 운영 변경 정당성을 증명하지 않는다.

## 상태전이와 검증

[상태전이도 Mermaid 원본](state-transitions.mmd)은 **마커 객체 한 개**의 요청 반환 시점 상태를 투영한다. 실제 풀은 공유되므로 두 식당의 재사용·해제를 함께 탐색했다. 그림과 체크가 같다는 사실은 실제 SDK의 refinement 증명이 아니다.

실행 명령은 `apps/web`에서 `bun scripts/verify-marker-formal.mjs --out /tmp/tzudong-formal-check.json`이다. [프로젝트 재검증 스킬](../../../.agents/skills/tzudong-formal-map-check/SKILL.md)을 한 번 실제로 따라 실행했고, [원시 검사·변형 결과](native-and-mutation-checks.json)에 보존했다.

- Bun 1.4.0, 실제 관측 Chromium 156.0.8078.47. 프로젝트 기본 Node 24 및 고정 native/compat compiler도 별도 확인.
- 마커 DOM 전이 9,216건: 4등급 × 2이미지 설명 × 2방문 배지 × 3리뷰 상태 = 48종. 모든 순서쌍 × 활성/반환 후 재사용 × 새/동일 리뷰 객체 갱신 두 방식.
- 8행동, 최대 깊이 4: 4,681 trace, 18,056 step. 같은 요청 반환 경계의 현재 콜백 소유권과 활성 수 확인.
- 검증 기반 원본 검사 통과, 의도적 오류 변형 8종 탐지, 원본 파일 hash 유지 및 복원 검사 통과. 실제 버그의 사전 실패 기록도 별도 보존.
- 관련 회귀 검사 86개 통과. 최종 verifier 자체의 baseline은 5파일 19검사, 복원 검사는 2파일 6검사다. 반복 실행 결과를 합쳐 검사 수를 부풀리지 않는다.
- scoped lint 통과. native/compat parity는 진단 0건, 논리 입력 3,382개. 새 도구의 초기 TS 파일은 Bun 타입 선언이 없는 프로젝트 설정과 충돌해 실패했고, 기존 스크립트 방식인 `.mjs`로 정리한 후 통과했다. 의존성이나 전역 타입 설정은 바꾸지 않았다.

미포함: 실제 사진이 있는 리뷰 UI 변형·픽셀 배치, 실제 Naver SDK, 네트워크, SDK의 동기 재진입, 무한 실행, fairness/진행성, 실제 하드웨어, 메모리·field·flicker·측정 성능, strict marker/CSP, 전체 식당 신원 증명. SDK 해제 실패 시 객체 폐기와 클릭 권한 정리는 다루지만 provider 내부 시각·자원 해제 성공은 주장하지 않는다.

## 외부 검토·배포·Nightly

기존 일반 추론 3단계 전문 91,596 bytes와 source hash는 [기존 감사 전달 기록](../marker-evidence-cross-audit-20261023-v1/AUDIT-DELIVERY.md)에 보존되어 있다. 새 8건은 그 보고서의 검토 대상 소스와 다른 delta이므로 이 문서만으로 외부 검토 완료라 하지 않는다. 사용자의 기존 Tzudong 한정 FIFO·슬롯 예외 승인을 재사용했으나, canonical `coordinate.py reserve`의 `dispatch_pending` 직렬화 gate는 선행 전송의 실제 answering 확인 전에는 FIFO·슬롯 예외만으로 통과되지 않았다. 현행 정책의 특정 타 소유 전송 1건에 대한 별도 예외는 그 전송을 명시한 직접 사용자 승인이 필요하며 이번 실행에서 요청하거나 사용하지 않았다. [대기열 체크포인트](external-review-checkpoint.json)의 이전 두 미전송 로컬 계획만 소유자가 withdraw 처리했다. 원격 작업 취소는 없었으며 최신 소스의 단일 delta 요청 `86eb51ad0f69dcedd3c5dd33`는 `queued`이고 업로드·전송은 0회다. 실제 kss2740 UI에서 4 Argon 최고 표시 높음/매우 철저함, Deep Research OFF, 현재 창 0%·주간 8%를 관측했지만 이는 관측 시점의 사실이며 전송 시점 가용성으로 재사용하지 않는다. 선행 전송은 해당 소유자가 실제 answering으로 대조해야 한다. 허용될 때 같은 요청의 신선한 모드·한도·소스 접근을 확인하고 Gemini delta 전문→소유 release→유효 지적 해결→실제 GPT-6 Pro 역검증으로 연결한다. 다른 소유자·계정·예약은 보존한다.

Vercel은 기존 24시간 안내에 따른 2026-10-24 07:37:06 KST 이후 실제 가용성을 다시 확인한다. 이 점검에서 한도를 재조회하거나 빌드 요청을 추가하지 않았다. 새 변경은 최종 프리뷰·보호 develop→data→main·exact-SHA 승인과 운영 readback을 거쳐야 한다. **이 문서는 배포 완료 증거가 아니다.**

Nightly `39457197351`은 기존 역사적 실패다. 이번 native 검사, CI 또는 향후 배포와 합쳐 통과로 표시하지 않는다.

## pstack 출처

공식 `cursor/plugins` pstack 경로의 2026-10-23 실제 확인 리비전은 `4ec7ffa173eaa70d3d9467a627baf0954645a353`, manifest 0.15.30이며 별도 stable release는 관측되지 않았다. [create-formal-verification-skill](https://github.com/cursor/plugins/blob/4ec7ffa173eaa70d3d9467a627baf0954645a353/pstack/skills/create-formal-verification-skill/SKILL.md)의 한정된 속성·반례·변형 검출·코드 동기화 원칙을 적용했다. 새 statechart 설명도 읽었으나 upstream 실행 도구나 설정은 설치하지 않았다. TLA+나 SMT solver는 실행하지 않았으며 현재 TypeScript와 DOM에 직접 연결되는 기존 Bun/Playwright를 선택했다. X 후속편의 bounded web 검색으로 원문 Part 3는 확인하지 못했으며 미발행을 뜻하지 않는다.
