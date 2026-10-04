# Transform 추가 2조건 실측 — 2026-10-05

**보류: legacy-ledger stale-row 수정 이전 checkpoint 측정이다. 현재/수정 후 후보 성능 근거로 채택하지 않는다. 시작·종료 소스 SHA는 일치했으나, sourceReady 후 새 두 조건만 재측정해야 한다.**
로컬 transform component 측정이다. 전체 pipeline, 실제 provider, 운영 성능 또는 G003 정식 성능 승인을 입증하지 않는다. 기존 cold/unchanged/delta-five 측정은 다시 실행하지 않았다.

변경 소유 범위는 새 benchmark helper 1개와 이 실험 산출물이다. production transform과 applied SQL은 수정하지 않았다.

가설/계산 모델: baseline은 전체 입력을 변환하고 trace ID 중복을 걸러 append한다. candidate는 입력 fingerprint와 receipt로 변경 없는 그룹을 재사용하되 입력 목록 검사와 최종 파일의 원자적 publication은 수행한다. 새 입력에서 전체 재변환 비용 감소를, 실패/재시작에서 이전 출력과 미완료 receipt 경계 보존을 확인했다.

원본 corpus 3,307파일 / 23,636,539 bytes, SHA256 71d4a176f6eff028cecf4963f3332f97c14284148b6d769e3617fce8ef8361c9가 전후 동일하다. 실제 영상 `-1OU4tkFJns`의 meta/rule/laaj 3파일을 priming에서 제외한 후 읽기 전용 symlink로 추가했다. 영상 그룹 1개, 최종 레코드 1개 증가(1,256 → 1,257).

환경: Apple M5 Max, 18 CPU, 128 GiB RAM, macOS 26.6.2 arm64, Python 3.14.8. 조건마다 AB/BA 순서를 교대해 7쌍(관측 28개, timed phase 42개)을 측정했다. imports·priming·digest 검사는 시간에서 제외했다. worker에 원본 쓰기/.env 읽기/network/subprocess 차단 audit guard가 있으며 그 검사 비용은 포함된다.

아래는 p75다. 변화는 candidate − baseline이며 음수는 감소다. CI는 10,000 paired percentile bootstrap(seed 20261002) 95% 구간이다. raw/summary에는 p50·p75·p95와 절대 변화 CI, 2×MAD 잡음 예산도 있다.

| 조건 | 지표 | baseline → candidate | 절대 변화 | 상대 변화 [95% CI] |
|---|---|---:|---:|---:|
| new-input | wallMs | 514.906 → 209.732 ms | -305.174 ms | -59.27% [-66.55, -52.04] |
| new-input | cpuMs | 466.418 → 193.592 ms | -272.826 ms | -58.49% [-65.42, -52.66] |
| new-input | peakRssMiB | 103.406 → 71.109 MiB | -32.297 MiB | -31.23% [-32.00, -28.42] |
| failure-restart | wallMs | 861.220 → 400.621 ms | -460.600 ms | -53.48% [-63.12, -49.16] |
| failure-restart | cpuMs | 809.087 → 353.030 ms | -456.057 ms | -56.37% [-63.49, -52.20] |
| failure-restart | peakRssMiB | 103.531 → 73.266 MiB | -30.266 MiB | -29.23% [-30.82, -29.01] |

실패 모델: candidate가 4,784,992 bytes 임시 출력을 작성·fsync한 후, 대상 파일을 잠시 디렉터리로 바꿔 실제 `os.replace`의 EISDIR(21)을 발생시켰다. finally에서 원래 출력 위치를 복원했다. baseline은 atomic writer가 없으므로 native append-open 지점에서 같은 EISDIR를 발생시켰다. 두 알고리즘의 동일한 내부 지점 비교는 아니다.

candidate 7/7 실패에서 기존 output/receipt 바이트가 보존됐고 완료되지 않은 holdout group은 receipt에 없었다. 남은 .transform 임시 파일은 0개다. 별도 worker 재시작 7/7에서 1,249 그룹 재사용·1개 레코드 추가 및 완료 receipt를 확인했다. baseline도 실패 출력 보존 7/7, 별도 worker 복구 7/7. failure-restart 시간/CPU는 실패 시도와 재시작의 합, RSS는 두 worker high-water 중 최댓값이다.

최종 28/28 출력의 중복 trace ID는 없고 정렬한 레코드 의미상 SHA256은 `aca09c4d4e468167f3f2e0a80d994a588742bc043a057127972b028ed3da8671`로 같다. raw 파일 bytes SHA는 따로 기록하며, 출력 순서까지 같다고 일반화하지 않는다.

한계: 통제한 EISDIR는 디스크 부족/전원 장애/운영 실패율을 증명하지 않는다. OS 파일 캐시를 비우지 않았고 host 부하를 격리하지 않았다. RSS는 imports를 포함한 프로세스 최대치다. 7쌍의 탐색적 결과이므로 특히 p95 CI를 일반적 꼬리 지연으로 해석하지 않는다. 유료/provider 호출·DB 호출·커밋 0. 원본 .env를 열거나 변경하지 않았다.

재현: `python3 backend/bin/benchmark_pipeline_transform_followup.py --work-root tmp/<fresh-owned-directory> --output apps/web/performance/pipeline-20261002/<fresh-report>.json`. helper는 기존 경로를 재사용하지 않는다. 보관된 출력/cache는 `tmp/transform-followup-20261005-astra` (155 MiB)이며 원본 입력은 symlink 대상이다.
