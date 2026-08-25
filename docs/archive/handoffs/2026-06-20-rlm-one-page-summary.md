# 2026-06-20 RLM 운영 요약

## 상태

이 문서는 **2026-06-20 시점의 역사적 요약본**이며 현재 운영 수치의 source of truth가 아니다. 2026-06-27 G006 refresh는 `artifacts/infra-g006-rlm-current-verification.json`, `artifacts/infra-g006-live-system-status.json`, `artifacts/infra-g006-pending-geocoding-summary.json`을 기준으로 한다. 현재 geocoding backlog 세부 큐는 `artifacts/infra-g006-pending-geocoding-backlog.json` / `artifacts/infra-g006-browser-review-lane.json`을 보고, 현재 코드 기준 운영 상태는 `/admin`의 운영 상태 센터를 기준으로 확인한다.

## 2026-06-27 G006 refresh

- run_daily live manifest: `manifestStatus=missing`, `finalStatus=UNKNOWN`, expected path `backend/log/cron/current-summary.json`; admin status now reports this explicitly instead of treating absent evidence as success.
- data-contract drift: `python -m unittest backend.pipeline.test_data_contracts_unittest` is current green (`19 tests / 0 failures`).
- run_daily regression: `python -m unittest backend.utils.tests.test_run_daily_regression` is current green (`53 tests`, `4 skipped`).
- geocoding backlog: `638` pending rows (`stage 1=317`, `stage 2=320`, `unknown=1`), direct same-name coordinate reuse lane `11`, browser-review lane `627`.
## 우선순위
### P0
1. **run_daily live manifest 수집/노출 복구**
   - 현재 `backend/log/cron` 자체가 없어 live `current-summary.json` 계열을 읽을 수 없다.
   - 운영자는 실제 상태 대신 코드/문서 기반 추론만 가능하다.
2. **evaluation contract drift 정리**
   - `G003` 기준 핵심 수치:
     - weak rule location evidence: **366 / 379**
     - missing pending-state encoding: **639 / 667**
     - LAAJ wrapper/schema drift: **790 / 790** 영향 (`786` wrapper + `4` missing families)
     - null-coordinate pending transforms: **637건**
   - 현재 `python -m unittest backend.pipeline.test_data_contracts_unittest`는 **19 tests / 1 failure**다.

### P1
3. **geocoding backlog 수동 검수 큐 재정렬**
   - backlog: **637 / 1269 (50.2%)**, direct manual review lane **11건**.
   - 즉시 검수 가치가 큰 direct same-name coordinate reuse 후보: **11건**.
   - stage-1은 해외/야시장형 실패가 많고, stage-2는 국내 주소 보유 + 20m miss가 대부분이다.
4. **storyboard local-history readback 복구 + tie-bias 수치화**
   - `qa-history/storyboard` latest/history artifact는 다시 생성됐다.
   - 현재 local readback 수치: `selectedSources=80`, `selectedSingleMarkerSourceCount=0`, `selectedMarkerMedianRelativePeak=0.5`.
5. **thumbnail 운영 규칙 + broad suite 정상화**
   - focused 5개 테스트는 유지 **5/5 pass**.
   - `apps/web/tests-unit/admin-youtube-thumbnail-generator.test.ts` 전체도 현재 **95 pass / 0 fail**다.

## 영역별 핵심 관찰
### 1) Geocoding backlog
- stage 분포: **1단계 317 / 2단계 319**
- 반복 상호는 얕지만, 묶음 검수 포인트는 분명하다.
- 우선 수동 검수 추천:
  - direct suggestion 11건 먼저
  - 그 다음 high-row video bundle

### 2) run_daily 운영
- 현재 live manifest는 **없음**.
- 운영 판독 순서는 고정해야 한다:
  1. `finalStatus` / `finalExitCode`
  2. `failedRequiredSteps`
  3. `downstreamSkips`
  4. `stepEvents`
  5. `gdriveUpload.status + completionProof`
- 특히 `rclone_exit_zero`를 성공으로 오판하면 안 된다.

### 3) crawling → evaluation contract
- 지금 제일 위험한 건 schema/validator 불일치다.
- 우선 수정 순서:
  1. LAAJ payload shape 정리
  2. rule location evidence/pending-state validator 강화
  3. selection-only transform placeholder 정책 명문화
  4. null-coordinate pending guard 강화

### 4) Storyboard heatmap/history
- local history `latest-real-data.json` / `history-real-data.json`는 복구됐고 `STORYBOARD_LOCAL_HISTORY_WRITE` 비생산 경계 안에서만 유지된다.
- tie-bias readback은 현재 `selectedSingleMarkerSourceCount=0`으로 saturation을 벗어났고, `selectedMarkerMedianRelativePeak=0.5`로 기존 `0.63` baseline 아래다.
- fallback fixture 분포 괴리는 별도 후속 과제로 남는다.

### 5) Thumbnail history/release candidate
- focused 5개 hard gate는 유지된다.
- broad file은 retrieval / local-codex provenance / backend-agent command / release-candidate readback 경로를 정리한 뒤 현재 green이다.
- 남은 후속은 회귀 방지용 분류 기록 유지다.

## 바로 실행할 다음 액션
1. `run_daily` live manifest 산출 경로부터 복구 또는 노출
2. `backend.pipeline.test_data_contracts_unittest` 1 failing baseline 원인 정리
3. geocoding backlog 11 direct-suggestion 행을 별도 검수 묶음으로 승격
4. storyboard fallback fixture를 실제 분포에 가깝게 교체하고 tie-bias 회귀 지표를 유지
5. thumbnail green broad suite를 회귀 분류표와 함께 유지

## 근거 리포트
- G001: `.gjc/rlm/2026-06-20-135458669-mb7bzl/report.md`
- G002: `.gjc/rlm/2026-06-20-140542392-vtofue/report.md`
- G003: `.gjc/rlm/2026-06-20-144515585-l767wa/report.md`
- G004: `.gjc/rlm/2026-06-20-141657015-cz60en/report.md`
- G005: `.gjc/rlm/2026-06-20-142428412-lfqn38/report.md`
- current verification: `.gjc/ultragoal/evidence/rlm-current-verification.md`
