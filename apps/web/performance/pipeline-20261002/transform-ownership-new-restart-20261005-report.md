# Transform ownership 수정 후 2조건 실측 — 2026-10-05

확정 source `ae9ad574fd38e02caefdaed8c7004ec296d9a7ea088e1353dfcda41b540a1bf4`의 로컬 transform component checkpoint다. 시작·종료 SHA 및 관련 helper/의존 파일 SHA가 같다. 이전 `7a4b5885…` 측정은 보류로 유지하며 이번 표본에 합치지 않았다. 기존 cold/unchanged/delta-five 측정은 재실행하지 않았다. 전체 pipeline·실제 provider·운영 성능 또는 G003 정식 성능 승인은 입증하지 않는다.

코드 변경은 새 benchmark helper뿐이며 production transform은 다른 agent가 확정한 source를 읽었다. 유료/provider 호출·DB 호출·커밋 0. 원본 .env를 읽거나 변경하지 않았다.

가설/이론: baseline의 전체 입력 parse/transform과 비교해 candidate는 N개 그룹 fingerprint 검사, K개 변경 그룹 변환, R개 결과 파싱/전체 publication으로 동작한다. 이론상 재사용 효과를 기대할 수 있지만 디렉터리 검사·출력 직렬화 비용은 남는다. 실제 요청 비용/요금 절감이나 전체 pipeline 가속도는 측정하지 않았다. 아래는 해당 corpus에서 얻은 실측이다.

원본 corpus: 3,307파일 / 23,636,539 bytes, 전후 SHA256 `71d4a176f6eff028cecf4963f3332f97c14284148b6d769e3617fce8ef8361c9`. 실제 영상 `-1OU4tkFJns`의 meta/rule/laaj 3파일을 priming에서 제외하고 원본 읽기 전용 symlink로 추가했다. 영상 그룹 1개, 레코드 1개 증가(1,256 → 1,257); candidate는 매회 1,249개 기존 그룹을 재사용했다.

환경: Apple M5 Max / 18 CPU / 128 GiB RAM / macOS 26.6.2 arm64 / Python 3.14.8. 조건마다 7쌍, AB/BA 교대(관측 28개·timed phase 42개). Imports/priming/digest 검사는 시간에서 제외했다. worker 원본 쓰기·.env 읽기·network/subprocess audit guard의 비용은 포함한다. 별도 guard 검사에서도 외부 쓰기/.env 읽기/network가 차단됨을 확인했다.

아래는 p75. 변화는 candidate − baseline, 음수는 감소다. 95% CI는 10,000 paired percentile bootstrap(seed 20261002). raw/summary는 모든 표본, p50/p75/p95, 절대 변화 CI 및 2×MAD 잡음 예산을 포함한다.

| 조건 | 지표 | baseline → candidate | 절대 변화 | 상대 변화 [95% CI] | 악화 표본 |
|---|---|---:|---:|---:|---:|
| new-input | wallMs | 531.021 → 212.044 ms | -318.977 ms | -60.07% [-64.93, -53.61] | 0/7 |
| new-input | cpuMs | 466.753 → 188.999 ms | -277.754 ms | -59.51% [-63.52, -52.82] | 0/7 |
| new-input | peakRssMiB | 103.500 → 72.109 MiB | -31.391 MiB | -30.33% [-30.59, -28.95] | 0/7 |
| failure-restart | wallMs | 936.374 → 386.303 ms | -550.071 ms | -58.74% [-72.70, -54.60] | 0/7 |
| failure-restart | cpuMs | 852.119 → 344.167 ms | -507.952 ms | -59.61% [-64.46, -55.53] | 0/7 |
| failure-restart | peakRssMiB | 103.422 → 73.828 MiB | -29.594 MiB | -28.61% [-29.37, -27.93] | 0/7 |

실패 모델: candidate는 4,784,992 bytes 임시 출력을 작성·fsync한 다음, 보관한 기존 output의 자리에 임시 디렉터리를 두어 실제 `os.replace` EISDIR(21)을 발생시켰다. finally에서 기존 파일을 복원했다. baseline은 atomic writer가 없으므로 native append-open에서 같은 EISDIR를 유도했다. 따라서 내부 저장 알고리즘의 동일한 실패 지점을 비교한 것은 아니다.

candidate 7/7 실패 후 이전 output/receipt SHA가 보존되고 holdout group은 receipt에 없었으며 .transform 잔여 파일은 0개였다. 별도 worker 재시작 7/7에서 결과 및 완료 receipt가 oracle과 일치했다. baseline append 실패/재시작도 7/7이었다. failure-restart 시간·CPU는 실패 시도+재시작의 합이고 RSS는 두 프로세스 high-water 중 최댓값이다.

최종 28/28 출력은 중복 trace ID가 없고 1,257개 레코드 의미상 SHA256 `aca09c4d4e468167f3f2e0a80d994a588742bc043a057127972b028ed3da8671`가 동일하다. raw bytes SHA는 따로 기록하며 출력 순서까지 같다는 주장은 하지 않는다.

한계: 현재 입력과 receipt 양쪽에 video 소유권 근거가 없는 legacy 행은 삭제 근거가 없어 보존된다. 이번 두 조건이 그러한 행의 정리를 입증하지 않는다. EISDIR는 통제한 오류이며 disk-full/power-loss/실제 장애율을 증명하지 않는다. OS 캐시를 비우지 않았고 host 부하를 격리하지 않았다. RSS는 imports 포함 프로세스 최대치다. 7쌍의 탐색적 CI이며 특히 p95는 일반적 tail latency 근거가 아니다. 표본별 악화 수가 0이어도 다른 조건의 악화 부재를 뜻하지 않는다.

재현: `python3 backend/bin/benchmark_pipeline_transform_followup.py --work-root tmp/<fresh-owned-directory> --output apps/web/performance/pipeline-20261002/<fresh-report>.json`. 결과/cache는 `tmp/transform-followup-ownership-20261005-astra`에 보관했다. 기존 측정 결과는 덮어쓰지 않았다.
