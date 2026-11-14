# 초기 접속 성능 측정 방법 — 2026-11-14

이 디렉터리는 `https://www.tzudong.app/`의 초기 탐색을 최적화 전후에 비교하는 **작업 범위의 lab 진단**이다. 이 문서는 측정 방법과 재현 명령이며 결과 보고서가 아니다. 실제 개선 수치는 보존된 관측 자료, `scored.json`, `validated.json`이 있을 때만 보고한다. 실사용(field) 및 G003 admission은 항상 **0**이다.

이 측정 도구를 처음 고정하는 시점에는 앱 코드 최적화를 적용하지 않았으며, 실제 before/after 수치는 수집 대기 상태다. 이후 앱 변경·배포·측정 결과는 별도의 결과 보고서와 immutable source 기록으로 제시한다.

요청된 [Addy Osmani 웹 성능 감사자](https://github.com/addyosmani/agent-skills/blob/main/agents/web-performance-auditor.md)의 측정 → 병목 확인 → 수정 → 재측정 순서를 따른다. 정적 코드 추정과 실제 측정값을 혼합하지 않는다.

## 사전에 고정한 조건

`protocol.json`은 baseline 수집 전에 고정했다. 그 정확한 바이트의 SHA-256은 다음과 같고 scorer와 독립 validator에 같은 값이 고정되어 있다.

```text
1d105370c00603d3539e7e82355c3e46647dd6ff5af49901595ad01951efb851
```

초기 baseline 소스는 `9316871f4220cd487b0e9575415ed2d760de8997`이다. 각 phase는 실제 배포 ID, source SHA, Git tree SHA와 공개 health readback을 별도로 보존한다. 소스가 바뀐 중간 샘플을 하나의 phase에 합치지 않는다.

### 유효 측정 이전의 배포 확인 transport 수정

보존된 초기 실행 `43598614632`와 `43599036723`은 각각 `HEALTH_READBACK_HTTP_ERROR`, `HEALTH_READBACK_HTTP_403`으로 종료됐고 두 실행 모두 `trials: []`였다. 따라서 유효 성능 수치는 **0개**이며 결과를 보고 개선 기준을 조정한 것이 아니다. 기존 실패 기록을 유지하고 배포 identity를 확인하는 transport만 수정했다. 지표, timing·cache 조건, 표본 수, 절대·상대·noise budget은 그대로다.

Identity 확인은 `browser-public-navigation`으로 기록한다. 별도의 새 익명 pinned Chrome process/profile에서 공개 `/api/health`로 정상 GET 탐색하고, source·deployment JSON의 허용된 필드만 보존한다. 자격 증명, 재사용 로그인 세션, custom UA/header, proxy, 웹사이트·호스트·계정의 접근 권한 설정 변경을 사용하지 않는다. 브라우저에서도 거부되거나 identity가 일치하지 않으면 실패로 종료한다. 일회용 측정 프로세스의 sandbox 정책은 아래에 별도로 명시한다.

이 readback은 Lighthouse timed trace 밖에서 수행한다. 사전 확인용 브라우저를 완전히 닫은 뒤 측정 브라우저를 시작하고, 사후 확인은 timed trace가 끝난 뒤 수행한다. 확인용 profile과 측정용 profile을 분리하므로 확인 과정이 **측정 profile의 resource cache를 데우지 않는다**. 이는 CDN·서버·OS 수준의 모든 warming이 없다는 뜻은 아니며 기존의 server-cache 관찰 범위는 유지한다. 각 receipt에는 `transport`, `isolatedFromMeasuredBrowser`, `credentialsUsed`, 실제 browser product/version/executable을 남겨 scorer와 독립 validator가 대조한다.

### 유효 측정 이전의 브라우저 실행 정책 수정

이후 실행 `43599674200`도 HTTP 응답 이전에 실패했고, 진단 실행 `43600158140`에서 `stage: launch`, `HEALTH_BROWSER_SANDBOX_UNAVAILABLE`이 확인됐다. 위 네 실행 모두 성능 trial은 0개였다. 원래 실패 증거는 유지한다.

일회용 GitHub-hosted runner의 browser process에 한해 `--no-sandbox`를 적용한다. 이는 같은 runner에서 성공한 저장소의 pinned Playwright probe와 일치하는 process launch 정책이다. `GITHUB_ACTIONS=true` 및 `RUNNER_ENVIRONMENT=github-hosted`일 때만 활성화하며, health 확인과 측정 Chrome에 동일하게 적용한다. 기존 측정용 `--lang=ko-KR`도 유지한다. **Chrome 프로세스의 sandbox가 비활성화된 조건**을 숨기지 않고 전후에 고정한다.

앱·OS·firewall·계정 권한을 바꾸거나 HTTP 접근 거부를 우회하는 변경은 없다. 정상 공개 탐색이 거부되면 계속 실패로 종료한다. 브라우저에 앱 비밀값이나 인증 상태를 전달하지 않으며 기존 환경변수 allowlist를 유지한다. 실제 process `spawnargs`에 `--no-sandbox`가 있는지 확인한 `noSandboxObserved`와 제한된 explicit flags만 보존한다. 원시 argv는 저장하지 않는다. Run·trial·관측·health receipt의 `browserLaunch`가 protocol과 다르면 비교 대상이 될 수 없다. Timing·profile·cache·표본 수·성능 budget은 바꾸지 않았다.

| 항목 | 고정 조건 |
| --- | --- |
| 측정 URL | `https://www.tzudong.app/?__qa=render-flow` |
| QA query 의미 | 기존 앱 동작에 따라 합성 트래픽의 field telemetry 유입을 제외한다. 일반 사용자의 RUM 관측이 아니다. 정제된 LHR URL에서는 query를 제외한다. |
| 로그인 | 비로그인, 새 profile, 자격 증명 없음 |
| Chrome | 저장소에 고정된 Google Chrome for Testing `156.0.8078.4` |
| Playwright | 저장소 pin `1.64.1`; Chrome 경로·제품·전체 버전 검증 |
| Lighthouse | 작업 전용으로 고정한 `13.5.0` |
| Node / npm | 저장소 기준 Node 24 / npm `11.6.2` |
| Throttling | `devtools`: 실제 관측 trace와 같은 조건의 request-level emulation |
| Cache | 각 trial에서 새 Chrome process와 profile. Browser cold이며 CDN·backend cold를 뜻하지 않는다. |
| 표본 | 각 phase·viewport당 유효한 5회. 한 runner에서 한 번에 하나씩 실행 |
| 전후 순서 | 같은 GitHub Actions job·runner·attempt에서 before 전체 → 배포 대기 → after 전체 |
| 실험 형태 | Unpaired. 교차 AB/BA 실행이나 무작위 대조 실험이 아니다. |

| Viewport | CSS px | DPR | CPU | Network |
| --- | --- | --- | --- | --- |
| Mobile | 390 × 844 | 2 | runner 대비 4배 slowdown | slow 4G emulation |
| Tablet | 820 × 1180 | 2 | runner 대비 4배 slowdown | slow 4G emulation |
| Desktop | 1440 × 900 | 1 | 1배 | 명시적으로 unthrottled |

Mobile/tablet의 Lighthouse request-level 설정은 latency `562.5 ms`, download `1474.56 Kbps`, upload `675 Kbps`다. 이는 Lighthouse slow 4G의 모델값 `150 ms RTT / 1638.4 Kbps`와 DevTools 보정 계수를 사용한다. Desktop의 network throttle 필드는 모두 0이다. 실제 `innerWidth`, `innerHeight`, `devicePixelRatio`를 관측해 설정값과 대조하며, viewport emulation을 실제 휴대전화나 태블릿 hardware 측정이라고 부르지 않는다.

[Lighthouse 13.5.0 릴리스](https://github.com/GoogleChrome/lighthouse/releases/tag/v13.5.0)는 Chrome 156을 대상으로 한다. 최신 버전으로 실행 중에 변경하지 않는다. 기본 `simulate` 방식은 원본 trace와 다른 모델 기반 결과를 계산하므로 이번 관측 방식과 섞지 않는다. 자세한 차이는 [공식 throttling 문서](https://github.com/GoogleChrome/lighthouse/blob/v13.5.0/docs/throttling.md)에 따른다.

## 수치의 의미와 추출

| 지표 | 원본 위치 | 의미 |
| --- | --- | --- |
| TTFB | `observations.navigation.responseStart - startTime` | 탐색 시작부터 첫 응답 바이트까지 |
| FCP | `lhr.audits['first-contentful-paint'].numericValue` | 첫 콘텐츠가 화면에 나타나는 시점 |
| LCP | `lhr.audits['largest-contentful-paint'].numericValue` | viewport의 가장 큰 적격 콘텐츠 표시 시점 |
| TTI | `lhr.audits.interactive.numericValue` | 기존 Lighthouse 계산 방식의 보조 진단값 |
| TBT | `lhr.audits['total-blocking-time'].numericValue` | 관측 구간 long task의 50 ms 초과 부분 합계 |
| CLS | `lhr.audits['cumulative-layout-shift'].numericValue` | 단위 없는 layout shift 점수 |
| Controls ready | `observations.timings.controlsReadyMs` | 실제 조작 UI가 준비된 첫 관측 시점 |
| Map ready | `observations.timings.mapReadyMs` | 보이는 지도 tile과 marker가 함께 준비된 첫 관측 시점 |

TTFB는 Lighthouse의 `server-response-time` audit와 같은 값으로 간주하지 않는다. 서버 응답 audit는 문서 응답 지연의 진단이며 전체 navigation의 연결·리다이렉트 시간을 동일하게 포함하지 않는다. Chrome 133 이후 `responseStart`는 103 Early Hints를 포함할 수 있으므로 제공되는 `finalResponseHeadersStart`도 맥락 자료로 보존한다. [공식 TTFB 정의](https://web.dev/articles/ttfb).

TTI는 Lighthouse 10 이후 주요 표시·점수 지표에서 제외됐지만, 고정한 13.5.0에는 `interactive` hidden audit가 weight 0으로 남아 있다. 실제 유효한 numeric value만 보고하며 TBT, INP, DOMContentLoaded, `domInteractive`로 대체하지 않는다. 충분한 quiet 구간이 없거나 audit가 실패하면 측정 불가로 기록한다. [공식 TTI 설명](https://web.dev/articles/tti), [고정 버전 설정](https://github.com/GoogleChrome/lighthouse/blob/v13.5.0/core/config/default-config.js), [계산 소스](https://github.com/GoogleChrome/lighthouse/blob/v13.5.0/core/computed/metrics/interactive.js).

LCP가 빠르더라도 skeleton이 가장 큰 요소였을 수 있으므로 usable UI와 지도 준비 시간도 함께 본다. [LCP 정의](https://web.dev/articles/lcp)는 화면의 적격 콘텐츠를 다루며 앱 기능 완료 전체를 보장하지 않는다. [FCP](https://web.dev/articles/fcp), [TBT](https://web.dev/articles/tbt) 역시 각각 다른 사용자 경험을 진단한다.

### 앱별 준비 시간

초기 app script 이전에 읽기 전용 관측을 설치하고 100 ms마다 DOM 상태를 확인한다. 최초 충족을 관측한 `performance.now()` 값이므로 실제 준비 시점보다 sampling·main-thread scheduling만큼 늦을 수 있다.

- Mobile/tablet controls: `homeMobileChromeReady=true`.
- Desktop controls: `homeChromeReady=true`, 보이는 실제 Radix menu trigger(`aria-haspopup=menu`, `aria-expanded`), 보이는 desktop restaurant search input을 모두 만족. Wrapper flag만으로 인정하지 않는다.
- Map: 보이는 Naver provider tile 이미지가 로드 완료(`complete`, `naturalWidth > 0`)이고 보이는 cluster/restaurant marker도 있어야 한다. `window.naver` 존재만으로 준비를 선언하지 않는다.
- Desktop panel은 ready flag와 보이는 panel을 만족하고, visible alert가 없으며 인기·최신 식당 항목이 각각 1개 이상이어야 유효하다. Skeleton 잔존, marker/tile 수 역시 기능 유효성 근거로 남긴다.

준비 timestamp가 LHR의 `metrics.details.items[0].observedTraceEnd`를 넘으면 **비교 수치에서 제외**한다. Lighthouse가 수집 종료 후 CPU/network throttling을 해제할 수 있기 때문이다. 이후 관측은 화면 상태의 맥락으로만 남긴다. 관측되지 않은 시간은 `null`이며 timeout이나 TTI를 대신 넣지 않는다.

## 개선 판정과 성능 목표는 별도

다음 목표는 task의 engineering budget이다. 특히 TTI·앱별 준비 시간은 현재 Core Web Vitals의 공식 통과 기준이 아니다. Field에서의 좋은 FCP/LCP 평가는 device별 p75이며, 여기의 5회 lab median과 같은 통계가 아니다.

| 지표 | Good target | 최소 절대 감소 |
| --- | --- | --- |
| TTFB | 800 ms | 100 ms |
| FCP | 1800 ms | 100 ms |
| LCP | 2500 ms | 100 ms |
| Legacy TTI | 3500 ms | 200 ms |
| TBT | 200 ms | 50 ms |
| CLS | 0.1 | 0.01 |
| Controls ready | 3500 ms | 100 ms |
| Map ready | 3500 ms | 100 ms |

각 phase의 median과 **unscaled MAD**를 계산한다. 모든 지표는 낮을수록 좋다.

```text
reduction = beforeMedian - afterMedian
relativeReduction = reduction / beforeMedian
MAD = median(abs(sample - median(samples)))
noise = 2 * max(beforeMAD, afterMAD)

improved:
  reduction >= minimumReduction
  AND reduction >= 0.10 * beforeMedian
  AND reduction > noise
```

절대·상대 경계는 inclusive, noise 경계는 strict다. 회귀도 같은 크기의 증가를 대칭으로 판정한다. Baseline이 0이면 상대 백분율을 `null`로 표시하며 무한대나 임의의 개선율을 만들지 않는다. 기준을 넘지 않는 작은 변화는 `no-confirmed-change`, 표본·환경·출처가 불충분하면 `not-comparable`이다.

예를 들어 LCP가 10초에서 5초가 되고 noise gate도 넘었다면 개선으로 기록하지만, 2.5초 목표는 여전히 미달이다. 목표 충족을 개선 판정의 전제 조건으로 삼지 않는다. 모든 valid sample을 보존하고 median에 유리한 run만 선택하지 않는다. 추가 run은 구체적인 invalidity나 instability를 해결할 때만 수행하며 기존 실패와 이유를 유지한다.

[Lighthouse 변동성 문서](https://github.com/GoogleChrome/lighthouse/blob/v13.5.0/docs/variability.md)는 반복 측정과 집계를 권고하고 한 기계의 동시 실행을 경고한다. 이 task의 5회는 저장소의 global admission 표본 요건을 대체하지 않는다.

## 유효성·출처·무결성

`collector.mjs`는 각 시도에서 화면, navigation timing, Lighthouse 숫자, trace의 허용된 수치, network 요약, browser pin, source·deployment readback을 기록한다. 실패한 시도도 삭제하지 않는다. Page exception, first-party HTTP 실패, 잘못된 viewport, 준비되지 않은 map/controls, 남은 초기 skeleton 등은 실패 사유다. Console 오류·취소된 request 수는 맥락 자료이며 functional failure와 구분한다.

개인 데이터, 자격 증명, cookie/header, response body, DOM 텍스트, query 값, script 원문, raw exception 등은 보존하지 않는다. 따라서 retained trace와 LHR은 **정제한 관측 자료**이며 전체 원본을 다시 Lighthouse에 넣을 수 있는 재감사용 trace가 아니다. Numeric audit fields·설정·trace timestamp·정적 resource URL을 보존해 이번 계산과 병목 해석을 검증한다. 분석에 빠진 원본 정보는 확인한 것처럼 추정하지 않는다.

독립 `validate.mjs`는 `score.mjs`를 import하지 않는다. Detached hash로 고정한 artifact map을 검증한 후 raw numeric inputs에서 eligibility, sample count, median, MAD, 목표 상태와 개선 gate를 다시 도출한다. 모든 실패 시도의 보존 파일도 hash 검증 대상이다. `sourceSha^{tree}`를 실제 저장소 Git object와 대조하고 공개 배포 identity 및 시도 전후의 readback과 연결한다.

Validator의 `evidence-and-calculation-verified`는 **자료와 계산의 일치**를 의미한다. 성능 전체 통과, 실제 사용자 개선, 인과관계 입증을 의미하지 않는다. 비교 가능한 지표가 0개인 불완전한 결과도 정직하게 검증할 수 있다.

## 입력 파일과 재현 명령

`experiment.json`은 root 상대 경로만 사용한다. `after`가 아직 없으면 명시적으로 `null`을 넣어 baseline-only 결과를 만들 수 있다.

```json
{
  "schemaVersion": "initial-load-experiment.v1",
  "protocol": "protocol.json",
  "collector": "collector.mjs",
  "toolLock": "tools/package-lock.json",
  "toolManifest": "tools/package.json",
  "phases": {
    "before": {"run": "before/run.json", "frozenSource": "before/frozen-source.json"},
    "after": {"run": "after/run.json", "frozenSource": "after/frozen-source.json"}
  }
}
```

각 frozen source record에는 `schemaVersion: initial-load-frozen-source.v1`, `phase`, immutable `sourceSha`, `sourceTreeSha`, `deploymentId`, `canonicalUrl`, `verifiedAt`, task-root 상대 `identityEvidence`가 필요하다. Identity evidence는 실제 공개 health 응답의 `ok`, `gitSha`, `deploymentId`, `host` 및 위의 실제 browser-navigation provenance를 보존한다. Phase 전후와 각 trial 전후의 receipt도 같은 transport 검증을 통과해야 한다. 예시 값을 측정 자료로 만들지 않는다.

Task directory에서 실행한다. 파일을 덮어쓰지 않으므로 실패 시 원인을 고친 후 별도의 output/map 이름을 지정한다. Map에 기록한 입력·script가 바뀌면 새 map과 독립적으로 기록한 새로운 hash가 필요하다.

```sh
node --test score.test.mjs

node score.mjs map --input experiment.json --output artifact-map.json

node score.mjs --input experiment.json --artifact-map artifact-map.json \
  --artifact-map-sha256 EXPECTED_SHA256_FROM_THE_PRIOR_STEP --output scored.json

node validate.mjs --input experiment.json --artifact-map artifact-map.json \
  --artifact-map-sha256 EXPECTED_SHA256_FROM_THE_PRIOR_STEP \
  --scored scored.json --output validated.json
```

`EXPECTED_SHA256_FROM_THE_PRIOR_STEP`는 실제 출력된 64자리 digest를 **별도로 기록한 값**으로 치환한다. Validator가 map 내부의 self-reported hash를 신뢰하게 만들지 않는다. 이 디렉터리를 다른 위치에 내려받았다면 `--root`와 immutable source objects가 있는 `--repository`를 명시한다.

`score.test.mjs`의 수치는 임시 디렉터리에 생성하는 synthetic software test fixture이며 실제 브라우저 측정이 아니다. Threshold 경계, regression, 불완전 표본, raw artifact 변경, 독립 계산 불일치와 field admission 위조를 검증하고 임시 fixture를 삭제한다.

## 보고 범위의 한계

같은 runner를 사용해도 배포 전후 시간, CDN 상태, backend load, 공개 콘텐츠, 외부 provider 응답은 변할 수 있다. 전후 차이를 task-local lab 관측으로 제시하고 코드만의 확정적 인과 효과로 확대하지 않는다. 전체 사이트·다른 route·실제 모바일 hardware의 결과로 일반화하지 않는다.

[CrUX API](https://developer.chrome.com/docs/crux/api)는 28일 이동 집계이며 약 2일 지연된다. 같은 날 재조회한 field p75를 즉각적인 after로 사용하지 않는다. URL 또는 origin 범위, form factor, collection period를 구분한다. [PSI](https://developers.google.com/speed/docs/insights/v5/about)는 URL 표본이 부족하면 origin으로 fallback할 수 있다. Field data가 없으면 없는 상태로 보고하고 lab 수치를 채워 넣지 않는다.

## 별도 실험: 고정 데이터로 실행하는 프런트엔드 비교

운영 사이트의 측정은 유효한 performance trial을 얻지 못했다. 처음 두 시도는 Node 공개 health readback에서 실패했고, 다음 두 시도는 브라우저 시작 단계 문제를 기록했다. 마지막 `43600568543` 시도는 고정한 Chrome이 정상 실행된 뒤 공개 탐색에서 HTTP 403 challenge를 받았다. 다섯 시도 모두 표본 0이며 운영 TTFB·FCP·LCP·TTI의 before/after는 **N/A**다. 실패 기록을 보존하고 운영 접속 재시도는 종료했다. 이 절의 별도 실험으로 그 빈칸을 채우지 않는다.

`fixture-protocol.json`은 기존 운영 `protocol.json`을 변경하지 않은 독립 프로토콜이다. 다음 실행 전에 고정한 최신 SHA-256은 `e25f17e98b2e691390a13120f853663fd239c49fc6192577a0086bf190637bf3`이다. 첫 fixture 실행 `43601663509`은 실제 시도 1회, invalid 1회, 유효 표본 0개이며 after가 없다. 캡처한 기존 harness로 map·score·독립 validation을 마쳤고 비교 가능한 지표는 0개다. 아래 software test의 숫자는 브라우저 관측치가 아니다. 후보 코드는 유효한 실제 비교를 거쳐 평가하고 운영 반영 여부를 판단한다.

| 항목 | 프런트엔드 fixture 실험 조건 |
|---|---|
| 대상 | `/` 초기 접속, 로그아웃, `http://localhost:8080/?__qa=render-flow` |
| 코드 | immutable baseline `9316871f4220cd487b0e9575415ed2d760de8997`과 별도 고정 candidate SHA |
| 빌드 | 두 소스의 production build를 모두 완료하고 SHA·tree·dependency lock·asset manifest를 기록한 다음 측정 시작 |
| 환경 | 같은 GitHub-hosted runner/job/attempt; Node 24, npm 11.6.2, Chrome for Testing 156.0.8078.4, Lighthouse 13.5.0 |
| 화면 | 390×844, 820×1180, 1440×900 CSS px; 실제 `innerWidth`·`innerHeight`·DPR 및 Lighthouse 설정 검증 |
| 반복 | 화면별 before 5회와 after 5회, 총 30회; 모든 before 후 모든 after; 동시 실행 없음 |
| 캐시 | trial마다 새 browser process/profile; phase마다 새 local server, 시작 확인 GET은 측정 밖에서 실행 |
| 데이터 | 기존 `installMobileHomeMapTestMocks`의 동일한 3개 식당과 mock Naver SDK |
| 네트워크 | 브라우저 HTTP/resource 요청은 로컬 GET/HEAD와 정확히 지정한 fixture 응답만 허용; 다른 routed 요청과 WebSocket 차단 |
| 판정 | 앞 절과 같은 median·MAD, 절대 감소량·10%·strict noise gate; 목표 달성과 개선 판정 분리 |
| 인정 범위 | task-local `frontend-fixture`만; production·field·G003 admission 모두 0 |

모바일·태블릿은 기존의 4× CPU 및 DevTools 4G 설정을 유지하고 데스크톱은 1× CPU와 무제한 로컬 네트워크를 사용한다. DevTools가 실제로 적용한 지연을 포함하더라도 로컬 응답은 운영 서버나 CDN의 응답을 재현하지 않는다. Server cache를 purge하거나 cold server라고 주장하지 않는다. 두 phase는 순차 실행이므로 동일 runner에서도 시간 경과와 scheduling에 따른 차이가 남는다.

HTTP/resource 및 WebSocket interception이 전체 네트워크 격리를 증명하지는 않는다. 기존 layout의 resource hint가 DNS/TCP/TLS 연결을 시도할 수 있으며, 그 시도는 이번 counter에 잡히지 않아 외부 연결이 전혀 없었다고 단정하지 않는다. 두 build 모두 기존 dependency fixture 환경을 유지한다. `NEXT_PUBLIC_TZUDONG_LOCAL_RUNTIME=1`은 app wrapper의 flex·overflow·transform 및 지도 mode까지 바꾸므로 사용하지 않는다. 별도의 DOM/CSS 수정이나 browser network flag 변경도 하지 않는다. 이 한계를 명시하기 위한 0표본 시점의 protocol revision에만 해당하며 지표·기준·표본 수는 그대로다.

수집 지표는 **loopback TTFB**, FCP, LCP, legacy TTI, TBT, CLS, `controlsReady`다. TTI는 Lighthouse 13.5.0의 `interactive` numeric audit를 그대로 사용하고 TBT나 INP로 대체하지 않는다. `controlsReady`는 모바일·태블릿의 실제 mobile chrome readiness, 데스크톱의 chrome readiness와 보이는 메뉴 trigger 및 검색 input을 함께 확인한다. 100ms 간격으로 처음 관측한 시각이며 Lighthouse trace가 끝난 뒤 얻은 값은 지표 표본에서 제외한다.

지도는 mock overlay와 실제 렌더링된 marker가 보이는지 기능 확인만 한다. **실제 지도 로딩 시간 또는 mapReady 개선 수치를 산출하지 않는다.** 데스크톱 fixture는 인기 목록에 식당 3개가 모두 들어가고 최신 목록은 인기 ID를 제외하므로 최신 항목 0개가 정상이다. 패널 준비, 인기 항목 3개, 최신 section 존재, alert와 skeleton 부재를 확인해 빈 정상 상태와 loading/error를 구분한다.

### 원자료 연결 및 독립 재계산

`fixture-collector.mjs`가 두 source tree, build asset manifest, fixture bundle과 원본 helper 파일, 실제 browser/tool/viewport 설정, 모든 시도의 정제한 LHR·trace·network·observation·screenshot을 연결한다. Build manifest는 실제 빌드 산출물의 이름·크기·SHA-256을 기록하지만 모든 build binary 자체를 보관하는 것은 아니다. Fixture source는 두 Git tree의 파일과도 대조한다. 저장된 자료는 운영 배포 identity나 Vercel receipt를 포함하지 않는다.

`fixture-score.mjs`와 `fixture-validate.mjs`는 공통 `fixture-evidence.mjs`를 파일 경로·byte hash 읽기에만 사용한다. 각각 원자료의 적격 조건과 metric numeric fields를 별도로 읽는다. 통계는 기존 scorer의 순수 비교 함수와 기존 validator의 독립 비교 함수를 각각 사용한다. Validator는 scorer 결과를 신뢰해 재사용하지 않는다. 실제 viewport, source/build/fixture binding, 두 build의 완료 순서, 같은 runner, trial 순서, 기능 준비 상태를 재확인한다. 전체 파일 map의 detached SHA-256과 실행 중인 scorer/validator bytes도 대조한다.

적격한 after가 없으면 `after:null`을 유지하고 모든 비교는 `not-comparable`이다. Trace 종료 뒤의 controls 관측은 `null`로 두며, 아래의 최신 관측 기준에서 trace 안의 기능 준비를 입증하지 못하면 trial 전체가 제외된다. 검증 결과 `evidence-and-calculation-verified`는 자료와 계산이 일치한다는 뜻이며, 성능 통과나 운영 개선 입증이라는 뜻이 아니다.

첫 fixture 시도에서는 Lighthouse 종료 뒤 읽은 화면 크기가 요청한 390×844/DPR 2와 달리 780×493/DPR 1이었고 marker 준비 조건도 충족하지 못했다. 그 시도를 재분류하지 않고 기존 artifact map hash `cbfb6df28b350b27bb26055afdea4374195243796af91e418b64dcf862bec50f`와 원자료·계산 결과를 그대로 보존한다. 새 protocol의 method revision은 **실제 시도 1회·유효 표본 0개·비교 지표 0개**를 명시하며 0회 시도라고 기록하지 않는다.

새 관측 방법은 최대 1,000개의 100ms 간격 snapshot에 timestamp·viewport·준비 상태를 남긴다. Lighthouse `observedTraceEnd` 이하인 마지막 snapshot을 실제 측정 상태로 선택하고, **trace 안의 모든 viewport snapshot**이 정확한 요청 크기와 DPR을 만족해야 한다. 선택한 snapshot의 controls·marker·skeleton·desktop panel 조건을 그대로 검사한다. 종료 뒤에만 marker가 나타나면 invalid다. Controls 시각도 trace 안에서 처음 조건을 충족한 snapshot timestamp와 일치해야 한다. `postCleanupViewport`와 `postCleanupReadiness`는 별도 맥락이며 판정에 사용하지 않는다. 이 기준에서는 trace 안의 기능 준비를 입증하지 못한 trial 전체가 제외된다.

화면 증거는 Lighthouse가 cleanup 전에 캡처한 `final-screenshot`만 사용한다. 이미지의 시각·pixel 크기·MIME type과 출처를 기록하고 해당 시각이 trace 경계 안에 있는지 검증한다. 이미지가 없거나 잘못되면 다른 numeric/raw artifacts를 먼저 보존하고 명시적 실패로 처리한다. 종료 뒤 화면 설정을 복원해 찍은 이미지를 측정 당시 화면으로 대체하지 않는다. 앱 코드·fixture 데이터·화면 설정·표본 수·예산은 이 method repair로 바꾸지 않았다.

Artifact를 내려받은 뒤 실행할 때 `FIXTURE_EVIDENCE_ROOT`는 실제 artifact root로, `FIXTURE_REPOSITORY`는 두 source Git objects를 가진 checkout으로 지정한다. 아래 명령의 도구 소스는 artifact에 복사된 source와 byte 단위로 일치해야 한다.

```sh
node --test apps/web/performance/initial-load-20261114/fixture-score.test.mjs

node apps/web/performance/initial-load-20261114/fixture-score.mjs map \
  --root "$FIXTURE_EVIDENCE_ROOT" --output fixture-artifact-map.json

node apps/web/performance/initial-load-20261114/fixture-score.mjs \
  --root "$FIXTURE_EVIDENCE_ROOT" --repository "$FIXTURE_REPOSITORY" \
  --artifact-map-sha256 EXPECTED_DETACHED_SHA256 --output fixture-scored.json

node apps/web/performance/initial-load-20261114/fixture-validate.mjs \
  --root "$FIXTURE_EVIDENCE_ROOT" --repository "$FIXTURE_REPOSITORY" \
  --artifact-map-sha256 EXPECTED_DETACHED_SHA256 \
  --scored fixture-scored.json --output fixture-validated.json
```

실제로 출력된 map hash를 별도로 기록해 `EXPECTED_DETACHED_SHA256`에 사용한다. 동일 파일을 덮어쓰지 않으며 수정된 증거는 새 map 이름과 새 detached hash를 필요로 한다. `fixture-score.test.mjs`는 synthetic software fixture로 21개 지표의 독립 재계산, 정상적인 빈 최신 목록, cleanup 뒤 viewport 변경과 측정 상태의 분리, trace 안의 잘못된 viewport 및 늦게 나타난 marker 거부, controls 시각의 출처, build 순서 위반, after 부재, raw artifact 변경과 production admission 위조 거부를 검증한다. SHA-256 CLI option 이름의 숫자 처리도 확인한다. 이 테스트의 성공은 실제 browser sample 수를 늘리지 않는다.
