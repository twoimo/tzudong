# run_daily 운영 런북

## 목적

`backend/run_daily.sh`는 GitHub Actions와 로컬 운영자가 호출하는 안정적인
배치 엔트리포인트입니다. 이 런북은 실행 후 성공/실패를 판정할 때 어떤
증거를 먼저 볼지 정리합니다. 장기 목표는 `run_daily.sh`를 한 번에
재작성하지 않고, 작은 helper 추출과 회귀 테스트로 안전하게 얇게 만드는
것입니다.

## 1차 증거: summary manifest

가장 먼저 확인할 파일은 `backend/log/cron/current-summary.json`입니다.
로컬/Actions 환경에 따라 경로는 `RUN_DAILY_MANIFEST_PATH`로 바뀔 수
있습니다.

핵심 판정 필드:

- `finalStatus`: 전체 실행 결과입니다. `success`가 아니면 실패/경고 배열을
  함께 확인합니다.
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

- `finalStatus=success`
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

- `run_daily.sh`는 안정적인 cron/CI entrypoint로 유지합니다.
- 새로운 파싱/집계 로직은 가능한 한 `backend/utils/run_daily_helpers.py`로
  이동합니다.
- 실패 정책, skip 정책, manifest schema 변경은 회귀 테스트를 먼저 둡니다.
- secret 값, 전체 raw log, 민감한 절대 경로를 admin/status 응답이나 Step
  Summary에 노출하지 않습니다.
