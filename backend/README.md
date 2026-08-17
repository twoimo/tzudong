# tzudong backend 운영 가이드

이 백엔드는 `restaurant-crawling/`, `restaurant-evaluation/`, `pipeline-api` + `pipeline-worker`가 함께 움직이는 데이터 파이프라인입니다. `run_daily.sh`는 isolated 컷오버 이후 운영 엔트리포인트가 아닙니다.

## 구조 원칙

- 운영/CI 엔트리포인트는 `python3 -m backend.pipeline_control.worker` (또는 `POST /v1/runs`)입니다. 레거시 `.sh`는 `backend/utils/tests/fixtures/` 스냅샷으로만 남습니다.
- 새 로직은 가능한 한 `backend/utils/run_daily_helpers.py` 또는 `backend/bin/*`의 작은 stdlib 도구로 분리합니다.
- 데이터 경계는 `ARCHITECTURE.md`와 `DATA_CONTRACTS.md`에 먼저 기록하고, 동작 변경은 회귀 테스트로 잠급니다.
- 물리적 디렉터리 재편은 현재 우선순위가 아닙니다. 운영 안정성이 확인된 뒤 단계적으로 검토합니다.

## CI/runtime 환경변수 계약

GitHub Actions에 등록하는 외부 secret은 canonical 이름을 기준으로 정리합니다.

필수 운영 secret:

- `YOUTUBE_API_KEY`
- `GEMINI_API_KEY`
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `NAVER_CLIENT_ID_BYEON`
- `NAVER_CLIENT_SECRET_BYEON`
- `NCP_MAPS_KEY_ID_BYEON`
- `NCP_MAPS_KEY_BYEON`
- `GDRIVE_RCLONE_CONFIG`

워크플로우 내부에서는 legacy script 호환을 위해 `YOUTUBE_API_KEY`를 `YOUTUBE_API_KEY_BYEON`으로, `GEMINI_API_KEY`를 `GEMINI_API_KEY_BYEON`으로 mirror할 수 있습니다. 단, `GEMINI_API_KEY_BYEON`과 OAuth credential류를 별도 repository secret으로 다시 등록하지 않습니다.

계약 검증 도구:

```bash
python3 backend/bin/check_env_contract.py --profile daily
python3 backend/bin/check_env_contract.py --profile gdrive-backfill
```

이 도구는 secret 값은 출력하지 않고, env 이름의 존재 여부와 금지된 legacy env 존재 여부만 보고합니다.

## run_daily 요약 manifest

`pipeline-worker`는 종료 직전에 `backend/log/cron/current-summary.json` 형식의 요약 manifest를 씁니다. 핵심 필드:

- `finalStatus`, `finalExitCode`
- `failedRequiredSteps[]`, `optionalSkips[]`, `downstreamSkips[]`
- `stepEvents[]`: 단계별 `name`, `status`, `durationSeconds`, 선택적 `reason`
- `latestLogPath`, `summaryPath`, `noWorkShortCircuit`, `policyMode`
- `runtime`: GitHub Actions run id/url/workflow/ref/event, 실행 브랜치, 데이터 동기화 대상 브랜치
- `gdriveUpload`: GitHub Actions의 GDrive upload step이 후속으로 append할 수 있는 업로드 상태

Admin ops status는 manifest를 우선 읽고, 없거나 파싱 실패하면 bounded log-tail fallback을 사용합니다.
운영자가 수동으로 판정할 때는 [`docs/run-daily-operations.md`](docs/run-daily-operations.md)의
체크리스트를 먼저 확인합니다.

## 검증 명령

백엔드 변경 후 최소 검증:

```bash
python -m unittest backend.pipeline_control.tests.test_slice0_control_plane
python3 backend/bin/check_env_contract.py --profile pipeline-control --json
python3 backend/bin/check_env_contract.py --profile daily --json
```

web admin ops 상태까지 건드렸다면 repo root에서:

```bash
cd apps/web
bun test tests-unit/admin-system-status.test.ts
```

## 운영 주의사항

- secret 값은 로컬 로그, 테스트 출력, GitHub Step Summary에 쓰지 않습니다.
- daily workflow와 GDrive backfill workflow는 Actions 분 예산을 공유하므로 schedule 추가 전 월간 budget을 다시 확인합니다.
- GDrive frame upload는 `rclone exit 0`만으로 완료 판정하지 않고, remote size/check 기반 proof와 residual/backfill queue를 함께 봅니다.
