# 실제 로컬 미디어/FFmpeg 검증 — 2026-10-09

기존 F93TnnxCNvY 영상의 첫 9초를 격리 stream-copy clip으로 사용했다. 원본 84 MiB 영상은 읽기만 했으며 다운로드·provider/model·DB·queue·vault·deployment 변경은 없었다. 소유 임시 디렉터리만 만들고 종료 후 제거했다. 후보 소스 수정은 없다.

7 alternating pairs × cold/restart = **28 observations**에서 48 JPEG의 manifest/hash와 실패 구간0이 모두 일치했다. baseline e6c7c97cc6fb9c4ac2e45297e22c2541bd5ad0d4의 frame component와 현재 후보를 비교했다. 네 historical component + 현재 support helper의 기존 freeze 방식을 유지했으며 media 단계만 실행했다. provider/LAAJ/transform 성능은 측정하지 않았다.

| 조건·metric | Baseline mean | Candidate mean | 95% paired-t CI (baseline−candidate) |
| --- | ---: | ---: | --- |
| cold wallMs | 512.17 | 614.02 | -284.08 to 80.38 |
| cold cpuMs | 3683.39 | 4049.50 | -428.01 to -304.21 |
| cold peakTreeRssMiB | 1227.35 | 348.19 | 814.95 to 943.36 |
| restart wallMs | 166.72 | 184.85 | -44.42 to 8.16 |
| restart cpuMs | 155.51 | 173.53 | -26.26 to -9.78 |
| restart peakTreeRssMiB | 51.54 | 64.76 | -15.88 to -10.54 |

성능 개선은 admission하지 않는다. Cold wall baseline CV37.54%는 기존20% noise 기준을 넘고 wall CI는0을 포함한다. Cold CPU는 증가했다. Cold sampled tree RSS 감소, restart RSS 증가도 원자료와 CI에 보존했다. wait4 CPU와 최소20ms ps sampling에는 계측 오버헤드·짧은 process 누락·공유 host 간섭이 있다. 결과는 이 로컬 bounded 미디어 component이며 실제 공급자·전체 crawler/evaluation pipeline 성능이 아니다. paired t(df6)와 seed 고정 bootstrap을 모두 보존했다.

관측된 resource 계약: 같은 Node의 영상3개×구간4개 중첩 실행에서 cold actual FFmpeg command peak baseline12→candidate4, calls는 양쪽12다. restart는 양쪽0 calls였다. 후보2개 Node를 독립 output으로 동시에 실행하면 합산 peak8/calls24였고 출력은 동일했다. 현재 Semaphore는 process-wide이므로 host-wide4 cap이라고 주장하지 않는다. 실제 worker 다중 process를 host-wide cap으로 운영하려면 별도 설계/승인/검증이 필요하다. 모델/네트워크 quota나 operator 환경은 바꾸지 않았다.

cleanup 첫 probe는 root/meta/frame 디렉터리가 없는 fixture 초기화로 exit1이었다. 원자료는 cleanup-initial-failure.json에 남겼다. 실제 source 결함으로 분류하지 않는다. passing paired/two-process runs는 반복하지 않고 cleanup-only로 전제를 준비했다. 실제 invalid own video의 FFmpeg 실패는 함수 rejection·cache 보존으로 이어졌고, 같은 owned cache를 valid clip으로 바꾼 뒤 실제 성공은 own cache 삭제로 이어졌다. 별도 cache sentinel은 보존됐다. acquireVideo/loadSegments만 로컬 source와 synthetic 구간으로 공급했고 extractFrames/FFmpeg/receipt/cleanup은 실제 source를 실행했다. 실제 remote acquisition은 미검증이다. 소유 work directory 종료 제거와 production success cache 삭제는 별도 확인이다.

초기 fixture 실패 탓에 최초 paired clip의 SHA를 실행 전에 durable하게 남기지 못했다. 최초 frozen source/28 raw/output manifests는 보존했으나 configuration의 original/재구성 clip hash는 cleanup-only recovery에서 기록됐다. 이를 초기 input preimage의 완전한 증빙으로 소급하지 않는다. 따라서 input-hash-complete performance claim도 admission하지 않는다. 강한 prospective 성능 claim에는 실행 전 persisted input/source manifest와 독립 A/A noise 구간이 추가로 필요하다. 이미 passing 관측을 지우거나 좋은 결과로 대체하지 않았다.

후속 gap: 원본 전체 롱폼/다양한 codec·duration·resolution coverage, 실제 acquisition·provider pacing/비용/정확도, whole-worker graph interruption/restart, 다른 worker와 host 전체 resource admission, 운영 배포는 미확인이다.
