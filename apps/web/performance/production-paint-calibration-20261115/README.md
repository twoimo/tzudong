# 운영 페인트 관측 보정: 별도 진단 시리즈

이 시리즈는 FCP·LCP 누락과 전달 시점, frame callback 기회, 첫 최신 카드 경로를 구분하기 위한 **진단**이다. 이전 `production-attribution-20261115` 원문·채점·유효 표본은 바꾸지 않는다. 개선율·퇴행·TTI·Lighthouse·필드 RUM·G003 편입은 모두 범위 밖이다. 절대·상대·잡음 개선 예산은 `null`이며, “적용 불가”를 0ms 개선 기준으로 바꾸지 않는다.

## 고정 조건

- 정확한 `https://www.tzudong.app/?__perf=paint-calibration`에 새 문서로 방문한다. 예정 방문은 **01, 02, 03**, 예열은 **0회**다. 실패·누락·불리한 수치도 남기며 교체 방문을 추가하지 않는다.
- 첫 20초의 primary 기록을 고정하고, 이후 10초는 기존 observer의 전달만 관찰한다. 30초 종료 후 observer를 해제한 다음 결과를 표시한다. 늦게 전달된 값을 primary로 채우지 않는다.
- sparse rAF는 500ms 간격, 요청 최대 40회, 동시에 pending 한 개다. frame callback은 실제 콘텐츠 페인트나 compositor 표시의 증명이 아니다. 20초 DOM 준비 상태는 단 한 번의 checkpoint 읽기이며 준비 완료 시각이 아니다.
- 세 방문의 실제 CSS viewport·DPR, visibility·focus·입력·resize·URL 상태를 그대로 남긴다. 첫 available planned snapshot의 viewport를 기준으로 변화만 표시한다. 원하는 모바일 크기나 통제된 캐시·CPU·네트워크를 가정하지 않는다.
- 관측 시간 동안 탭 전환·입력·resize·스크롤·locator polling을 하지 않는다. 소스/provider/health 확인과 진단 결과 읽기는 30초 창 밖에서 수행한다. 단순히 `visibilityState=visible`이라고 focus 또는 compositor 활동을 추정하지 않는다.
- 접근 제어에 막히면 중단하고 해당 방문의 `blocked-access` receipt를 남긴다. 남은 ordinal은 `not-executed-access-block`으로 기록한다. 인증·헤더 변경·프록시·보안 설정 변경·접근 우회는 하지 않는다.

## 1. 프로토콜과 소스 식별 고정

모든 스키마·도구·소스를 검토한 다음, **첫 방문 전에** `protocol.json` SHA-256을 별도 기록한다. 아래 placeholder는 실제 값으로 바꾸며 테스트 fixture를 운영 증거로 넣지 않는다.

```bash
cal_root='/workspace/scratch/4a4cd61b759b/tzudong-paint-calibration-20261115/apps/web/performance/production-paint-calibration-20261115'
cal_repo='/workspace/scratch/4a4cd61b759b/tzudong-paint-calibration-20261115'
sha256sum "$cal_root/protocol.json"
```

provider와 public health에서 확인한 실제 full SHA와 배포 ID가 같은지 먼저 확인한다. 정확한 소스 SHA/tree의 checkout임을 담당자가 별도로 확인한다. recorder는 네트워크나 Git에 접근하지 않으며, 해당 checkout의 관측기·milestone 소스 bytes를 hash한다. 이것은 운영 배포 확인을 자동으로 대신하지 않는다.

identity 입력 모양:

```json
{
  "providerIdentity": {
    "observedAtUtc": "ACTUAL_UTC_WITH_MILLISECONDS",
    "observedVia": "vercel-dashboard",
    "gitSha": "ACTUAL_FULL_SOURCE_SHA",
    "deploymentId": "ACTUAL_DEPLOYMENT_ID",
    "projectId": "ACTUAL_PROJECT_ID",
    "target": "production",
    "state": "READY"
  },
  "healthIdentity": {
    "observedAtUtc": "ACTUAL_UTC_WITH_MILLISECONDS",
    "observedVia": "cua-public-health",
    "gitSha": "ACTUAL_FULL_SOURCE_SHA",
    "deploymentId": "ACTUAL_DEPLOYMENT_ID",
    "ok": true
  }
}
```

```bash
node "$cal_root/record.mjs" plan \
  --root "$cal_root" --repository "$cal_repo" \
  --protocol-sha256 'DETACHED_PROTOCOL_SHA256' \
  --source-sha 'ACTUAL_FULL_SOURCE_SHA' --source-tree 'ACTUAL_FULL_TREE_SHA' \
  --identity '/absolute/path/to/actual-identity.json' \
  --frozen-at 'ACTUAL_UTC_AFTER_IDENTITY_READBACKS'
```

`inputs/plan.json`은 write-once이며 세 ordinal·소스·관측기·도구 파일의 hash를 함께 고정한다. 이 시점 이후 소스·도구·프로토콜을 고치지 않는다. 변경이 필요하면 기존 시리즈를 보존하고 새 프로토콜을 선언한다.

## 2. 세 방문을 순서대로 그대로 기록

탐색 직전 UTC를 기록하고 해당 탭을 정상적으로 연다. 30초 창이 끝난 뒤 표시된 진단 JSON 전체와 실제 URL을 읽고 확인 UTC를 기록한다. screenshot OCR이나 수동으로 계산한 값을 JSON에 채우지 않는다. 임시 파일에는 읽은 JSON bytes만 저장한다.

```bash
node "$cal_root/record.mjs" attempt \
  --root "$cal_root" --repository "$cal_repo" \
  --protocol-sha256 'DETACHED_PROTOCOL_SHA256' --ordinal 1 \
  --started-at 'ACTUAL_UTC_BEFORE_NAVIGATION' \
  --observed-at 'ACTUAL_UTC_AFTER_RESULT_READBACK' \
  --observed-url 'https://www.tzudong.app/?__perf=paint-calibration' \
  --raw '/absolute/path/to/01-dom-json.json'
```

같은 방법으로 2, 3을 순서대로 기록한다. raw bytes와 receipt는 각각 즉시 SHA-256을 출력한다. 기존 ordinal의 덮어쓰기, 0번 예열, 4번 추가 방문은 거부한다. 관측기 JSON이 정상 스키마여도 paint·focus·frame 신호가 불완전하면 그대로 보존하고 분석에서 한계를 표시한다.

JSON을 얻지 못하면 `--raw` 없이 `--outcome collector-unavailable`, `capture-unavailable`, `blocked-access` 중 실제 결과를 기록한다. 숫자·고정 enum 외 payload는 저장을 거부한다. 이 경우 일반 화면·에러 원문을 저장하지 말고 `invalid-diagnostic-payload` receipt를 남긴다. 다른 URL은 `--observed-url other`로 분류한다. 접근 차단 후 방문하지 않은 ordinal은 `--outcome not-executed-access-block --observed-url not-navigated`이며 `--started-at`을 생략한다. 확인 시각은 실제 중단 결정 시각이다.

원문 쓰기 후 receipt 쓰기가 중단되는 등 불완전한 파일이 있으면 즉시 중단한다. 파일 삭제·덮어쓰기로 재방문을 숨기지 않는다.

## 3. 봉인 후 분석과 독립 검증

```bash
node "$cal_root/record.mjs" seal \
  --root "$cal_root" --repository "$cal_repo" \
  --protocol-sha256 'DETACHED_PROTOCOL_SHA256'
```

출력된 artifact-map SHA-256을 별도 기록한 **다음** 분석한다. map은 세 receipt, 실제 확보한 raw, plan, protocol, schema, 도구 파일을 모두 포함한다. SHA를 분석 결과에서 뒤늦게 추정하지 않는다.

```bash
node "$cal_root/analyze.mjs" \
  --root "$cal_root" --repository "$cal_repo" \
  --protocol-sha256 'DETACHED_PROTOCOL_SHA256' \
  --artifact-map-sha256 'DETACHED_ARTIFACT_MAP_SHA256'

python3 -B "$cal_root/validate.py" \
  --root "$cal_root" --repository "$cal_repo" \
  --protocol-sha256 'DETACHED_PROTOCOL_SHA256' \
  --artifact-map-sha256 'DETACHED_ARTIFACT_MAP_SHA256'
```

`analysis.json`과 `validated.json`도 write-once다. Python 검증기는 Node 분석기를 실행하거나 import하지 않는다. 봉인, 원문·receipt, source/tool hash와 분류·수치의 독립 계산 일치를 확인한다. 검증 성공은 진단 증거의 일치이며 일반 성능 PASS가 아니다.

## 신호 해석

20초 안에 발생한 entry라도 boundary drain이 늦으면 delivery 시각은 20초보다 클 수 있다. 따라서 event window, 실제 checkpoint, callback/drain 전달 시각을 따로 본다. primary에 없지만 tail에서 전달된 primary-window entry는 전달 지연의 관측이며, 원인이 브라우저·scheduler·collector 중 무엇인지 그 사실만으로 확정하지 않는다. 20초 뒤 발생한 entry는 별도 late-event이다.

observer 통계는 primary와 late의 독립 구간별 값이다. 반면 context의 focus·visibility·입력·resize 이벤트 수는 setup 이후 누적값이며 late에 primary가 포함된다. 두 context의 수를 합산하지 않는다. frame·focus 주기 샘플은 primary에서 끝나고 tail에는 기존 observer와 수동 lifecycle 이벤트 기록만 남는다. 마지막 경계의 context·Paint Timing 읽기는 별도로 보존한다.

`getEntriesByType('paint')`에서만 확인한 값은 observer와의 불일치 신호다. 이를 observer FCP의 대체값, 0ms, primary 보정값으로 사용하지 않는다. 양쪽에 없으면 “관측되지 않음”이며 “화면이 안 그려짐”이라고 단정하지 않는다. 등록 실패·handler 오류·cap·미지원 API는 판단 한계를 남긴다. focus false, rAF 지연과 paint 누락의 동시 발생도 인과 증명이 아니다.

LCP region은 전달 당시 관측된 고정 범주다. 같은 크기·종류만으로 같은 DOM 요소라고 추정하지 않는다. latest rows는 JSON 수신 경계, KPI ready는 기존 fallback까지 포함한 반환 경계, first card committed는 React effect의 commit 관측이며 이미지 요청·디코딩·paint 완료가 아니다. 최초 query marker가 retry를 공유할 수 있고 각 비동기 경로는 겹치므로 단순 합산하지 않는다.

## 도구 자체 검증

```bash
node --test "$cal_root/evidence.test.mjs"
```

합성 fixture는 임시 디렉터리에만 쓰고 운영 증거에 편입하지 않는다. 보존·덮어쓰기 금지, cap/shape/privacy, 전달 시점 분리, timeline 대체 금지, 변조 거부와 독립 검증 불일치를 확인한다.
