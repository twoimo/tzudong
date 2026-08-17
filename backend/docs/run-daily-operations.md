# run_daily 운영 런북

## 목적

운영/CI 엔트리포인트는 `python3 -m backend.pipeline_control.worker`입니다.
`backend/run_daily.sh`는 N=3 live 패리티 컷오버 이후 crontab/GHA 경로에서 제거되었습니다.
이 런북은 실행 후 성공/실패를 판정할 때 어떤 증거를 먼저 볼지 정리합니다.

## 1차 증거: summary manifest

가장 먼저 확인할 파일은 `backend/log/cron/current-summary.json`입니다.
로컬/Actions 환경에 따라 경로는 `RUN_DAILY_MANIFEST_PATH`로 바뀔 수
있습니다.

핵심 판정 필드:

- `finalStatus`: 전체 실행 결과입니다. `OK`, `WARN`, `ERROR` 중 하나이며,
  `OK`가 아니면 실패/경고 배열을 함께 확인합니다.
- `finalExitCode`: 프로세스 종료 코드입니다. 필수 단계 실패가 있으면
  non-zero여야 합니다.
- `failedRequiredSteps[]`: 필수 단계 실패 목록입니다.
- `optionalSkips[]`: 선택 단계 skip 목록입니다. 전체 실패와 구분합니다.
- `downstreamSkips[]`: 선행 필수 단계 실패 때문에 실행하지 않은 후속 단계입니다.
- `stepEvents[]`: 단계별 `name`, `status`, `durationSeconds`, 선택적 `reason`
  및 선택적 `upstreamStep`입니다. `status`는 `completed`, `failed`,
  `optional_skipped`, `downstream_skipped` 중 하나여야 합니다.
- `runtime`: GitHub Actions run id/url/ref/event와 실행 브랜치 증거입니다.
- `gdriveUpload`: Actions upload step이 실행 후 append할 수 있는 GDrive
  업로드 상태입니다.
- 브랜치 안전 모드, split data worktree 준비 실패처럼 정상 final-reporting
  구간에 도달하기 전 중단되는 경우에도 producer가 `ERROR` manifest를 먼저
  기록해야 합니다. success 경로에서 manifest를 기록/확인하지 못하면
  프로세스는 non-zero로 내려가야 하며, manifest가 없거나 파싱 실패할
  때만 bounded log-tail fallback을 사용합니다.
Admin `/api/admin/system-status` reads only bounded manifest/log evidence. If `current-summary.json` is missing or unreadable, it exposes `runDaily.manifestStatus=missing|unreadable` and `runDaily.finalStatus=UNKNOWN` rather than treating a stale log tail or absent file as success.

예시 확인 명령:

```bash
python3 - <<'PY'
import json
from pathlib import Path

path = Path("backend/log/cron/current-summary.json")
data = json.loads(path.read_text())
print("finalStatus=", data.get("finalStatus"))
print("finalExitCode=", data.get("finalExitCode"))
print("failedRequiredSteps=", len(data.get("failedRequiredSteps") or []))
print("downstreamSkips=", len(data.get("downstreamSkips") or []))
print("stepEvents=", [(e.get("name"), e.get("status")) for e in data.get("stepEvents") or []])
print("githubRunUrl=", (data.get("runtime") or {}).get("githubRunUrl"))
print("gdriveUploadStatus=", (data.get("gdriveUpload") or {}).get("status"))
PY
```

## 판정 체크리스트

### 정상 완료로 볼 수 있는 경우

- `finalStatus=OK`
- `finalExitCode=0`
- `failedRequiredSteps[]`가 비어 있음
- `downstreamSkips[]`가 비어 있음
- 필수 단계의 `stepEvents[].status`가 `completed`
- 프레임 업로드가 필요한 실행이면 `gdriveUpload.status`가 terminal 상태이고,
  GDrive proof가 `remote_size_check` 또는 `remote_manifest_check`

### 작업 없음 short-circuit

- `noWorkShortCircuit=true`
- `finalExitCode=0`
- 신규 URL/대기 JSONL/잔여 업로드 backlog가 없다는 별도 로그 또는 upload
  manifest 증거가 있어야 안전합니다.

### 경고/후속 조치 필요

- `optionalSkips[]`만 있고 `failedRequiredSteps[]`가 비어 있으면 전체 실패로
  단정하지 않습니다. 선택 단계의 `reason`을 확인합니다.
- `gdriveUpload.status`가 `partial` 또는 `backfill_required`이면 파이프라인
  본체가 성공했더라도 업로드/검증 후속 작업이 남아 있습니다.
- `completionProof=rclone_exit_zero`는 전달 증거일 뿐 terminal 검증 증거가
  아닙니다. `docs/gdrive-upload.md`의 backfill 절차를 따릅니다.

### 실패로 봐야 하는 경우

- `finalExitCode`가 non-zero
- `failedRequiredSteps[]`가 비어 있지 않음
- 필수 단계의 `stepEvents[].status=failed`
- success 경로에서 summary manifest 기록/확인이 실패함
- 필수 선행 단계 실패 뒤 후속 단계가 계속 실행된 정황이 있음

이 경우 기존 동작을 우회하지 말고 `backend/utils/tests/test_run_daily_regression.py`
회귀 테스트를 먼저 추가/갱신한 뒤 작은 패치로 수정합니다.

## 보조 증거

- GitHub Actions 로그: `runtime.githubRunUrl` 또는 Actions run 페이지
- GitHub Actions artifact:
  - `current-upload-expected.json`
  - `current-upload-status.json`
  - `current-upload-batches.json`
  - residual/staging artifacts
- 로컬 log tail: manifest가 없거나 파싱 실패할 때만 bounded fallback으로 사용합니다.

## 변경 원칙

- crontab/GHA는 `python3 -m backend.pipeline_control.worker`를 호출합니다.
- 새로운 파싱/집계 로직은 가능한 한 `backend/utils/run_daily_helpers.py`로
  이동합니다.
- 실패 정책, skip 정책, manifest schema 변경은 회귀 테스트를 먼저 둡니다.
- timeout/fail-closed 운영자 문구는 `run_daily_helpers.py`의
  `render-timeout-guard-message`, `render-policy-unknown-warning`,
  `render-policy-summary-note`를 우선 갱신하고 shell fallback 문구와
  동기화합니다.
- Step 08 prerequisite/quota/downstream skip 문구는
  `render-step08-message`를 우선 갱신하고 shell fallback 문구와
  동기화합니다.
- secret 값, 전체 raw log, 민감한 절대 경로를 admin/status 응답이나 Step
  Summary에 노출하지 않습니다.

## Step 08 Gemini 운영 판정

Step 08은 API quota, Web fallback 로그인, Node 패키지 prerequisite이 모두 같은
후속 평가 skip으로 이어질 수 있으므로 `stepEvents`와 `failedRequiredSteps`를
같이 봅니다.

- `Gemini quota 초과 (exit=42)`: pending Step08 work가 있으면 end-to-end
  정책에서 required failure입니다. quota 상태를 확인하고 다음 실행/키 교체를
  결정합니다. quota exhaustion을 일부러 소모해 live 재현하지 않습니다.
- `Google 로그인 세션 만료 (exit=44)`: Web fallback 세션 문제입니다.
  `python backend/restaurant-crawling/scripts/gemini_scrapling_fallback.py --login`
  으로 수동 로그인 후 재실행합니다.
- `Step 08 Node prerequisite 미충족`: `cd backend && npm ci`로
  `@google/genai` 등 Node runtime을 복구합니다.
- `Step 09~13 (Evaluation)` downstream skip은 Step 08 fail-closed가 의도대로
  작동했다는 증거입니다. 선행 실패 뒤 후속 평가가 계속 실행되면 회귀입니다.

로컬에서 API quota live 검증을 시도하기 전에는 secret 값을 출력하지 말고 다음
사실만 확인합니다.

```bash
python3 - <<'PY'
import os, pathlib
print('GEMINI_API_KEY present=', bool(os.environ.get('GEMINI_API_KEY') or os.environ.get('GEMINI_API_KEY_BYEON') or os.environ.get('GOOGLE_API_KEY')))
print('backend @google/genai installed=', pathlib.Path('backend/node_modules/@google/genai').exists())
PY
```

## Production fixture / schema drift guardrail

Actions는 `backend/bin/check_production_contract_fixtures.py`로 repo에 포함된
production-shaped transform JSONL을 bounded sample로 검증합니다. 결과는
`backend/log/cron/production-contract-fixture-status.json`에 남습니다.

```bash
python3 backend/bin/check_production_contract_fixtures.py \
  --output backend/log/cron/production-contract-fixture-status.json \
  --max-records 200
```

Actions 기본값은 기존 production-shaped 데이터의 drift를 관측/기록만 하며 배포를
차단하지 않습니다. 정책을 강화할 때만 `--fail-on-error`를 추가하여 validator
`ERROR` 또는 JSONL parse error를 failure로 승격합니다.

## GitHub Actions budget posture guardrail

월 3000분 자체보다 더 위험한 것은 수동 재실행, backfill burst, repository
visibility 변경을 놓치는 것입니다. `check_actions_budget.py`는 최근 run wall-clock
기반 private-equivalent minutes를 산출하고, 수동 실행/재실행/Backfill 시간을
ledger로 남깁니다.

```bash
GITHUB_TOKEN=... python3 backend/bin/check_actions_budget.py \
  --repository twoimo/tzudong \
  --workflow daily-crawler.yml \
  --workflow gdrive-frame-backfill.yml \
  --output backend/log/cron/actions-budget-posture.json
```

기본 운영에서는 non-blocking 관측값으로 남기고, 정책을 강화할 때만
`--fail-on-soft-gate watch|high|critical`를 사용합니다.

## 2026-05-07 후속 완화: 남은 실제 리스크 처리

### Transform `lat`/`lng` drift 판정
- `status=pending`, `source_type=geminiCLI`, `geocoding_success=false`인 target record의 `lat`/`lng=null`은 schema 파손이 아니라 **미해결 geocoding backlog**로 판정한다.
- validator는 이 경우 `pending_geocoding` warning을 남긴다. `approved` 등 ready 상태에서 좌표가 비어 있으면 계속 error로 막는다.
- fixture drift report가 `warn`이면 operator는 좌표 보정/backfill 후보로 관리하고, `error`이면 transform contract 파손으로 triage한다.

### Actions budget hard stop
- `daily-crawler.yml`의 default-branch `workflow_dispatch`는 budget posture가 `critical`이면 기본적으로 early-fail한다.
- 정말 필요한 운영 수동 실행만 `allow_budget_risk=true`로 명시 override한다.
- `gdrive-frame-backfill.yml`은 scheduled/automatic run에서 `softGate=critical`이면 expensive backfill step을 skip하고 summary/artifact만 남긴다. Manual `workflow_dispatch`는 operator override로 간주한다.

### Gemini / Antigravity quota preflight
- `Run Daily Pipeline` 전에 `backend/bin/check_gemini_runtime.mjs --require-api-available`를 실행한다.
- Gemini API quota/auth/missing-key가 실패하면 비디오 처리 전 `backend/bin/run_agy_prompt.py`로 Antigravity CLI OAuth를 먼저 확인하고, 그래도 실패하면 Gemini CLI OAuth를 확인한다.
- LAAJ Step 11의 runtime fallback 순서는 `Node Gemini API -> Antigravity CLI(현재 활성 OAuth 계정, settings model) -> Gemini CLI OAuth`이다. Gemini CLI OAuth는 `~/.gemini/oauth_creds.json`와 `~/.gemini/oauth_creds_*.json`를 `backend/bin/gemini` wrapper가 quota 시 rotation한다.
- GitHub Actions secret contract:
  - `GEMINI_API_KEY`: canonical Gemini API key.
  - `GEMINI_CREDENTIALS_BASE64`: optional Gemini CLI OAuth primary account JSON, base64 encoded.
  - `GEMINI_CREDENTIALS_BASE64_2`: optional Gemini CLI OAuth backup account JSON, base64 encoded.
  - `AGY_SETTINGS_JSON`: optional Antigravity CLI settings JSON, for example `{"model":"Gemini 3.5 Flash (High)","enableTelemetry":false}`. It configures model/telemetry only; Antigravity OAuth auth itself is OS-keyring backed and must be validated by the preflight.
- Preflight reports are written under `backend/log/cron/*runtime-preflight*` and uploaded as artifacts. Secret values must never be printed.

### Pending geocoding backlog export/correction

Use the dedicated backlog exporter before changing any transform JSONL data:

```bash
python3 backend/bin/export_pending_geocoding_backlog.py \
  --output /tmp/tzudong-guardrails/pending-geocoding-backlog.json \
  --csv /tmp/tzudong-guardrails/pending-geocoding-backlog.csv
```

Corrections must be reviewed and keyed by `traceId`; the tool writes a new JSONL output and does not overwrite production data in place:

```bash
python3 backend/bin/export_pending_geocoding_backlog.py \
  --apply-corrections reviewed-pending-geocoding-corrections.csv \
  --corrected-output /tmp/tzudong-guardrails/transforms.corrected.jsonl
```
