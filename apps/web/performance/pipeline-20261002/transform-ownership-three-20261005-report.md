# Transform 세 조건 독립 재측정

로컬 transform component 증빙입니다. 전체 pipeline, 실제 provider, 운영 DB 성능·비용 증빙이 아닙니다.

- 후보: `ae9ad574fd38e02caefdaed8c7004ec296d9a7ea088e1353dfcda41b540a1bf4` (시작/종료 일치)
- 기존 구현: `e6c7c97cc6fb9c4ac2e45297e22c2541bd5ad0d4`
- 입력: 3307 files / 23636539 bytes / `71d4a176f6eff028cecf4963f3332f97c14284148b6d769e3617fce8ef8361c9` (시작/종료 일치)
- 각 조건 7쌍, AB/BA 교대, 42개 원시 관측. 다른 조건·이전 소스 결과를 합치지 않았습니다.
- CPU/시간: transform main 호출 범위. import·준비·검증 제외. RSS: import와 출력 검증을 포함한 독립 worker 프로세스 high-water.
- 95% CI: paired bootstrap 10,000회, seed 20261002, nearest-rank 분위수. 7쌍의 p95는 표본 최댓값이며 모집단 tail 추정이 아닙니다.

| 조건 | 지표 | 분위수 | 기존 → 후보 | 절대 변화 [95% CI] | 변화율 [95% CI] | 2×MAD noise |
|---|---|---|---:|---:|---:|---:|
| cold | wallMs (ms) | p50 | 266.973 → 443.599 | +176.626 [+160.650, +210.574] | +66.16% [+60.04, +81.55] | 10.673 |
| cold | wallMs (ms) | p75 | 275.570 → 468.802 | +193.233 [+165.528, +201.829] | +70.12% [+53.79, +75.60] | 10.673 |
| cold | wallMs (ms) | p95 | 307.705 → 473.233 | +165.528 [+165.528, +201.214] | +53.79% [+53.79, +75.20] | 10.673 |
| cold | cpuMs (ms) | p50 | 260.455 → 434.782 | +174.327 [+157.004, +203.405] | +66.93% [+59.85, +80.07] | 16.264 |
| cold | cpuMs (ms) | p75 | 269.646 → 457.451 | +187.805 [+165.136, +196.996] | +69.65% [+55.99, +75.64] | 16.264 |
| cold | cpuMs (ms) | p95 | 295.144 → 460.407 | +165.263 [+165.263, +195.140] | +55.99% [+55.99, +74.39] | 16.264 |
| cold | peakRssMiB (MiB) | p50 | 101.344 → 141.000 | +39.656 [+38.422, +40.844] | +39.13% [+37.71, +40.32] | 1.125 |
| cold | peakRssMiB (MiB) | p75 | 101.891 → 142.141 | +40.250 [+18.281, +41.766] | +39.50% [+14.90, +41.21] | 1.125 |
| cold | peakRssMiB (MiB) | p95 | 122.719 → 143.109 | +20.391 [+18.438, +41.719] | +16.62% [+15.02, +41.15] | 1.125 |
| unchanged | wallMs (ms) | p50 | 249.561 → 113.699 | -135.862 [-142.930, -122.678] | -54.44% [-56.02, -49.95] | 13.531 |
| unchanged | wallMs (ms) | p75 | 255.129 → 122.946 | -132.183 [-147.981, -123.917] | -51.81% [-56.55, -49.85] | 13.531 |
| unchanged | wallMs (ms) | p95 | 261.681 → 125.153 | -136.527 [-141.305, -128.913] | -52.17% [-54.00, -50.74] | 13.531 |
| unchanged | cpuMs (ms) | p50 | 247.581 → 112.935 | -134.646 [-140.634, -121.875] | -54.38% [-55.75, -50.01] | 12.096 |
| unchanged | cpuMs (ms) | p75 | 252.256 → 121.814 | -130.442 [-146.988, -123.081] | -51.71% [-56.55, -49.97] | 12.096 |
| unchanged | cpuMs (ms) | p95 | 259.923 → 123.870 | -136.053 [-140.451, -127.604] | -52.34% [-54.04, -50.74] | 12.096 |
| unchanged | peakRssMiB (MiB) | p50 | 103.031 → 69.875 | -33.156 [-51.188, -33.062] | -32.18% [-42.26, -32.10] | 0.500 |
| unchanged | peakRssMiB (MiB) | p75 | 121.125 → 69.938 | -51.188 [-51.188, -33.094] | -42.26% [-42.26, -32.12] | 0.500 |
| unchanged | peakRssMiB (MiB) | p95 | 121.281 → 70.969 | -50.312 [-51.188, -41.297] | -41.48% [-42.26, -37.13] | 0.500 |
| delta-five | wallMs (ms) | p50 | 261.022 → 212.859 | -48.162 [-59.782, -46.697] | -18.45% [-21.14, -17.10] | 3.564 |
| delta-five | wallMs (ms) | p75 | 282.824 → 226.437 | -56.387 [-70.566, -46.697] | -19.94% [-24.03, -17.10] | 3.564 |
| delta-five | wallMs (ms) | p95 | 293.608 → 232.879 | -60.729 [-70.566, -46.697] | -20.68% [-24.03, -17.10] | 3.564 |
| delta-five | cpuMs (ms) | p50 | 258.197 → 210.439 | -47.758 [-53.743, -47.320] | -18.50% [-19.71, -17.58] | 4.456 |
| delta-five | cpuMs (ms) | p75 | 272.696 → 221.896 | -50.800 [-64.402, -45.160] | -18.63% [-22.73, -16.56] | 4.456 |
| delta-five | cpuMs (ms) | p95 | 283.355 → 227.536 | -55.819 [-64.402, -45.160] | -19.70% [-22.73, -16.56] | 4.456 |
| delta-five | peakRssMiB (MiB) | p50 | 101.250 → 73.219 | -28.031 [-29.188, -27.812] | -27.69% [-28.51, -27.49] | 0.531 |
| delta-five | peakRssMiB (MiB) | p75 | 102.391 → 73.375 | -29.016 [-42.516, -27.031] | -28.34% [-36.69, -26.70] | 0.531 |
| delta-five | peakRssMiB (MiB) | p95 | 115.891 → 74.219 | -41.672 [-42.516, -27.109] | -35.96% [-36.69, -26.75] | 0.531 |

## 관측된 악화와 상각

- cold / wallMs: 악화 7/7쌍, 최대 악화 213.119 ms.
- cold / cpuMs: 악화 7/7쌍, 최대 악화 206.438 ms.
- cold / peakRssMiB: 악화 7/7쌍, 최대 악화 41.812 MiB.
- unchanged / wallMs: 악화 0/7쌍, 최대 악화 0.000 ms.
- unchanged / cpuMs: 악화 0/7쌍, 최대 악화 0.000 ms.
- unchanged / peakRssMiB: 악화 0/7쌍, 최대 악화 0.000 MiB.
- delta-five / wallMs: 악화 0/7쌍, 최대 악화 0.000 ms.
- delta-five / cpuMs: 악화 0/7쌍, 최대 악화 0.000 ms.
- delta-five / peakRssMiB: 악화 0/7쌍, 최대 악화 0.000 MiB.
- wallMs p50: cold 추가비용 176.626 ms; unchanged 2회 또는 delta-five 4회 재실행 후 상각 (분위수 기반 산술모델).
- wallMs p75: cold 추가비용 193.233 ms; unchanged 2회 또는 delta-five 4회 재실행 후 상각 (분위수 기반 산술모델).
- wallMs p95: cold 추가비용 165.528 ms; unchanged 2회 또는 delta-five 3회 재실행 후 상각 (분위수 기반 산술모델).
- cpuMs p50: cold 추가비용 174.327 ms; unchanged 2회 또는 delta-five 4회 재실행 후 상각 (분위수 기반 산술모델).
- cpuMs p75: cold 추가비용 187.805 ms; unchanged 2회 또는 delta-five 4회 재실행 후 상각 (분위수 기반 산술모델).
- cpuMs p95: cold 추가비용 165.263 ms; unchanged 2회 또는 delta-five 3회 재실행 후 상각 (분위수 기반 산술모델).

## 가설과 실제 범위

- Candidate fingerprints, ownership index and atomic output/receipt publication add initial work; no assumption of a cold speedup.
- A verified receipt can reuse all groups while scanning input metadata and validating the existing output.
- Candidate reuses unchanged groups and republishes the complete output; append-only baseline must rebuild from empty output to reflect changed existing rows correctly.

## 한계

- Transform component only; no whole-pipeline, provider, hosted DB or monetary cost claim.
- Cold means no transform output or receipt, not cold OS filesystem cache. Host workload is not isolated.
- Seven paired samples; paired percentile bootstrap with 10000 draws and seed 20261002 is exploratory, particularly p95.
- The original benchmark delta-five uses baseline full rebuild versus candidate primed incremental update; both must equal a fresh delta oracle.
- As in the original benchmark, each pair copies the seed receipt to a fresh evaluation path; absolute-path file-hash memo keys are not all reusable. Stable-path cache speed is not inferred.
- Worker audit guards add instrumentation overhead. RSS is whole-process high-water and cannot be accumulated or amortized.
- Amortization is arithmetic on measured component percentiles, not a measured sequential run or pipeline-wide break-even.
- Legacy rows lacking both current input and receipt ownership remain preserved without deletion evidence. These conditions do not prove cleanup.
- Frozen new-input/failure-restart and earlier-source experiments are retained separately and were not rerun or pooled.

## 환경

```json
{
  "python": "3.14.8",
  "pythonExecutable": "/opt/homebrew/opt/python@3.14/bin/python3.14",
  "platform": "macOS-26.6.2-arm64-arm-64bit-Mach-O",
  "cpuCount": 18,
  "cpuModel": "Apple M5 Max",
  "physicalMemoryBytes": 137438953472,
  "headAtReadback": "344f80e48d104a4a0142ef8d0597fb9bd0d7d631",
  "workRoot": "tmp/transform-three-ownership-20261005-astra",
  "startedAt": "2026-10-04T18:43:18.639357+00:00",
  "finishedAt": "2026-10-04T18:43:36.972670+00:00",
  "elapsedExperimentSeconds": 18.333338022232056,
  "timingScope": "transform main only, imports/preparation/validation excluded",
  "rssScope": "worker high-water including imports and output validation",
  "pairOrder": "AB/BA alternating, A first for repeat 0",
  "networkAndDotenvGuard": true,
  "originalSourceWriteGuard": true,
  "providerCalls": 0,
  "dbCalls": 0
}
```

원시 결과 SHA256: `12ec16a99b1188f3a166cba0c6073346cfa05d47888c3f626314df05a02c6e20`
