# 운영 DOM 관측 기록 명령

이 도구는 로컬 파일만 읽고 쓴다. 브라우저 접속·인증·배포·네트워크 요청을 실행하지 않는다. 측정은 정상 접근 가능한 CUA 브라우저에서 루트 담당자가 수행한다. 원문은 화면의 `initial-load-diagnostic-result`에 표시된 JSON 전체를 text로 읽은 값이며, screenshot OCR이나 임의로 계산한 값을 채워 넣지 않는다.

## 1. 소스와 배포 확인을 고정

아래 변수는 각자 실제로 확인한 값으로 지정한다. 소스는 운영 배포와 public health에서 따로 읽은 **동일한 전체 40자리 SHA**여야 한다. provider와 health 확인은 타이밍 측정 밖에서 수행한다.

```bash
perf_root='/workspace/scratch/4a4cd61b759b/tzudong-production-attribution-20261115/apps/web/performance/production-attribution-20261115'
repo_root='/workspace/scratch/4a4cd61b759b/tzudong-production-attribution-20261115'
```

임시 identity JSON 입력의 정확한 모양은 아래와 같다. 대문자 placeholder는 유효한 측정값이 아니다. `observedVia` provider 값은 `vercel-dashboard`, `vercel-tool`, `vercel-cli` 중 실제 사용한 하나다. health는 `cua-public-health`다. 아래의 UTC 시각도 실제 확인 시각으로 바꾼다.

```json
{
  "providerIdentity": {
    "observedAtUtc": "ACTUAL_UTC_TIME",
    "observedVia": "vercel-dashboard",
    "gitSha": "ACTUAL_FULL_SHA",
    "deploymentId": "ACTUAL_DPL_ID",
    "projectId": "ACTUAL_PRJ_ID",
    "target": "production",
    "state": "READY"
  },
  "healthIdentity": {
    "observedAtUtc": "ACTUAL_UTC_TIME",
    "observedVia": "cua-public-health",
    "gitSha": "ACTUAL_FULL_SHA",
    "deploymentId": "ACTUAL_DPL_ID",
    "ok": true
  }
}
```

```bash
node "$perf_root/record.mjs" phase \
  --root "$perf_root" --repository "$repo_root" \
  --phase before --source-sha 'ACTUAL_FULL_SHA' \
  --deployment-id 'ACTUAL_DPL_ID' --project-id 'ACTUAL_PRJ_ID' \
  --frozen-at 'ACTUAL_UTC_TIME_AFTER_BOTH_READBACKS' \
  --identity '/absolute/path/to/before-identity.json'
```

도구가 Git tree와 두 계측 파일의 SHA-256을 해당 commit의 blob에서 직접 계산한다. `inputs/phases/before.json`이 이미 있으면 덮어쓰지 않는다. 배포 readback을 확인했다는 사실은 담당자의 실제 관측 기록이며, 이 도구가 provider를 다시 조회했다는 뜻이 아니다.

## 2. 예열 1회, cohort 고정, 측정 5회

새 전경 탭에서 정확히 `https://www.tzudong.app/?__perf=initial-load`로 이동한다. 탐색 직전 UTC 시각을 기록하고, 20초 동안 탭 전환·입력·resize를 하지 않는다. 진단 화면이 나온 뒤 실제 URL과 JSON을 읽고 UTC 확인 시각을 기록한다. JSON bytes를 로컬 임시 파일로 보존한다. 파일에는 JSON 원문 외 설명을 넣지 않는다.

```bash
node "$perf_root/record.mjs" attempt \
  --root "$perf_root" --phase before --ordinal 0 \
  --started-at 'ACTUAL_UTC_BEFORE_NAVIGATION' \
  --observed-at 'ACTUAL_UTC_AFTER_VISIBLE_SNAPSHOT' \
  --observed-url 'https://www.tzudong.app/?__perf=initial-load' \
  --raw '/absolute/path/to/before-warmup-dom.json'

node "$perf_root/record.mjs" cohort \
  --root "$perf_root" --browser-surface cua-cloud-cdp \
  --frozen-at 'ACTUAL_UTC_AFTER_WARMUP_BEFORE_ATTEMPT_1'
```

cohort는 ordinal 0 원문의 실제 `innerWidth`, `innerHeight`, DPR와 SHA에 연결된다. 모양을 추정하거나 viewport 값을 원하는 크기로 기입하지 않는다. 이 사이트에서 desktop panel 완료 조건을 충족하려면 실제 너비가 1280px 이상이어야 한다. 더 좁으면 해당 완성 조건이 실패로 남으며, 모바일·태블릿 비교로 바꾸지 않는다.

같은 방법으로 **새 전경 탭의 ordinal 1, 2, 3, 4, 5**를 각각 기록한다. 예열을 추가하지 않는다. each attempt의 실제 시각과 원문 파일을 넣는다. 이전 ordinal을 덮어쓰거나 6번을 추가하는 동작은 거부된다. 느리거나 불완전한 JSON도 스키마를 만족하면 그대로 보존하며, 유효성 판정은 별도다.

JSON을 얻지 못했을 때는 원문 없는 실패 receipt를 남긴다. 허용 outcome은 `collector-unavailable`, `blocked-access`, `capture-unavailable`, `invalid-diagnostic-payload`다. 다른 URL로 이동했다면 URL 원문 대신 `--observed-url other`로 분류한다. 일반 페이지 텍스트나 오류 화면을 JSON 파일로 저장하지 않는다.

```bash
node "$perf_root/record.mjs" attempt \
  --root "$perf_root" --phase before --ordinal 'FAILED_PLANNED_ORDINAL' \
  --started-at 'ACTUAL_START_UTC' --observed-at 'ACTUAL_END_UTC' \
  --observed-url 'https://www.tzudong.app/?__perf=initial-load' \
  --outcome collector-unavailable
```

## 3. 최적화 선택 전에 baseline 봉인 및 점검

```bash
node "$perf_root/record.mjs" map --root "$perf_root" --stage before
```

이 명령이 출력한 `artifactMapSha256`을 별도 관측 로그에 기록한 **다음**, 그 값을 아래 인자로 전달한다. 원문 JSON의 SHA는 각 attempt 기록 시점에 이미 출력된다. map에는 원문·receipt·cohort·phase identity·고정 protocol·스키마·검증 도구가 묶인다.

```bash
node "$perf_root/score.mjs" \
  --root "$perf_root" --repository "$repo_root" \
  --artifact-map baseline-artifact-map.json \
  --artifact-map-sha256 'DETACHED_BASELINE_MAP_SHA256' \
  --output baseline-scored.json

python3 -B "$perf_root/validate.py" \
  --root "$perf_root" --repository "$repo_root" \
  --artifact-map baseline-artifact-map.json \
  --artifact-map-sha256 'DETACHED_BASELINE_MAP_SHA256' \
  --scored baseline-scored.json --output baseline-validated.json
```

AFTER가 아직 없으므로 baseline report의 비교 상태는 `incomplete-observational-comparison`, 비교 가능한 전후 metric 수는 0이어야 한다. BEFORE 표본의 숫자·유효성·각 방문의 단계별 계산은 남아 원인 분리에 사용한다. `evidence-and-scalars-verified`는 계산 및 근거 일치만 뜻하며 성능 통과가 아니다.

이 시점 이후 baseline 원문과 도구를 수정하지 않는다. 계측 코드도 동일하게 유지한다. 원인에 맞는 최적화 선택은 baseline 관측을 확인한 뒤에 한다.

## 4. AFTER와 최종 비교

AFTER의 새 provider/health identity를 확인하고 phase를 고정한다. `phase --phase after` 명령은 1절과 같은 옵션을 사용한다. cohort를 다시 만들지 않는다. 같은 실제 viewport에서 AFTER 예열 ordinal 0을 한 번 보존하고, 그 뒤 ordinal 1–5를 기록한다.

```bash
node "$perf_root/record.mjs" map --root "$perf_root" --stage final \
  --baseline-map-sha256 'DETACHED_BASELINE_MAP_SHA256'
```

새로 출력된 final map hash도 채점 전에 별도 관측 로그에 기록한다. 최종 map은 baseline map에 봉인된 모든 파일의 동일한 SHA를 요구한다.

```bash
node "$perf_root/score.mjs" \
  --root "$perf_root" --repository "$repo_root" \
  --artifact-map artifact-map.json \
  --artifact-map-sha256 'DETACHED_FINAL_MAP_SHA256' \
  --baseline-map-sha256 'DETACHED_BASELINE_MAP_SHA256' \
  --output scored.json

python3 -B "$perf_root/validate.py" \
  --root "$perf_root" --repository "$repo_root" \
  --artifact-map artifact-map.json \
  --artifact-map-sha256 'DETACHED_FINAL_MAP_SHA256' \
  --baseline-map-sha256 'DETACHED_BASELINE_MAP_SHA256' \
  --scored scored.json --output validated.json
```

검증기는 scorer를 import하거나 실행하지 않는다. Python에서 원문·map hash·Git blob·배포 binding·완료 조건·scalar·median/MAD·개선/회귀 판정을 다시 계산한다. TTI는 항상 null이다. 긴 작업이 cutoff를 넘으면 long-task scalar만 null이 되고, 다른 유효한 관측을 0으로 대체하지 않는다. TAO가 숨긴 값도 null/unknown으로 남는다.

## 자체 검증

```bash
node --test "$perf_root/evidence.test.mjs"
```

테스트는 임시 합성 수치만 사용한다. 운영 측정 증거로 저장하거나 보고하지 않는다. 8개 테스트가 입력·숨김·resize·소스·완성 조건·TAO unknown·긴 작업 경계·미지원 API·지표 산술·0 admission·map 변조 거부를 점검한다.
