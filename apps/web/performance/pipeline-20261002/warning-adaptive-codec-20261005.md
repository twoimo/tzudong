# Adaptive warning codec — local source/evidence

기본 경로는 `WARNING_STREAM`이다. `ADMIN_EVALUATION_WARNING_READ_PATH=raw`에서만 새 codec을 사용한다. `rpc`는 기존 Unicode/ICU admission을 그대로 유지한다. 이 문서는 아직 운영 적용·서비스 인증·provider·배포 증거가 아니다.

## 변경과 수학적 계약

- 단일 첫 RPC에 mode, 전체 관련 행 수, page IDs, revision, 첫 데이터와 cursor가 함께 나온다. 계획 전용 추가 요청은 없다.
- `N≤200`은 grouping을 실행하지 않고 flat tuple 최대 200개를 한 응답에 반환한다. 2MiB에 담기지 않으면 명시적으로 capacity를 거절한다.
- `N>200`은 첫 요청에서 raw attrs의 canonical JSON 문자열을 `COLLATE "C"`로만 비교한다. `G≤200 ∧ G/N≤0.01`인 경우만 grouped, 나머지는 flat이다. 이 값은 보수적인 선택 한계이며 모든 데이터에서 최적이라는 주장이 아니다.
- flat은 view의 **17개 모든 열**을 고정 순서로 보존한다. JS가 동일한 normalize/display 함수를 적용하고 기존 `EvaluationWarningStream`에 최대 200개씩 전달한다. SQL은 Unicode 정규화, 이름 collation, similarity 또는 float 판정을 하지 않는다.
- flat SQL keyset은 `restaurants.created_at DESC NULLS FIRST, id ASC`를 사용한다. 기존 밀리초 descriptor를 사용하지 않는다. 새 index가 같은 원본 순서를 지원한다. NULL, microsecond, 동일 timestamp, `±infinity`를 실제 PG에서 비교했다.
- cursor는 revision, 정렬된 page IDs, mode, totalRows, offset, 실제 boundary ID/created_at을 포함한다. SQL이 boundary membership과 원래 순번을 다시 확인한다. decoder는 mode 고정, offset 연속성, 전체 count, UUID 중복, 최종 self membership을 검증한다. cursor는 외부 admission 권한 토큰이 아니라 서버 내부 service-role continuation이다.
- grouped는 동일 raw attrs의 정확한 count, page self IDs와 global source order를 가진 실제 첫 4개 sample을 전달한다. 자기 행 제외는 최대 1행이므로 첫 4개가 모든 가능한 top 3을 포함한다. JS의 기존 confidence/name 비교에 source order를 추가해 locale 동률을 원래 stable ordering으로 복구한다. 삭제 경고는 원래 OR-union 함수를 사용해 중복 가산하지 않는다.
- 요청당 최대 1000개 tuple/group, JSONB 응답 2MiB, 단일 raw row 1MiB, materialized input 64MiB, 전체 catalog 50k, page 200 제한이 있다. 최초 전체 size preflight와 continuation의 group/batch size 검사를 유지한다. 실제 DB peak RSS를 제한/측정했다고 주장하지 않는다.
- `EVALUATION_WARNING_RAW_CAPACITY_EXCEEDED`라는 정확한 P0001/null-data 거절만 처음부터 기존 stream을 다시 읽는다. 누락된 RPC, 권한, transport, 잘못된 응답, unknown 및 stale 오류는 숨기지 않는다. 기존 stream은 200행 제한이며 byte 제한을 새로 보장하지 않는다.
- 모든 읽기 뒤 revision을 다시 확인한다. `STABLE` RPC 내부 snapshot 및 증가하는 revision을 결합하므로 읽기 사이 변경은 결과 반환을 거절한다.

## Source 및 적용 조건

새 미적용 함수 signature는 `public.admin_evaluation_raw_warning_groups(uuid[],text,jsonb,integer)`다. 이전 초안의 integer cursor와 다르므로 클라이언트/SQL/allowlist를 함께 검토해야 한다.

1. `20261004192657_admin_evaluation_raw_warning_groups.sql`: 원본 restaurant 행을 바꾸지 않는 forward video helper/index repair, revision bump, 정확한 source-order index, invoker RPC/service-role-only ACL.
2. `20261004194715_admin_evaluation_raw_warning_invoker_contract.sql`: 정확한 assertion source preimage와 선택적 record-action 한 줄 확장만 허용하는 owner 등록 및 즉시 제거되는 private helper. canonical 및 hosted preimage를 유지하고 영구 role/grant를 만들지 않는다.

기존 applied SQL은 수정하지 않았다. G014/G024 전체 replay/shared manifest 및 hosted non-superuser owner 창 검증/실제 적용은 별도 root release 단계다. missing RPC에 자동 fallback이 없으므로 두 SQL과 정확한 allowlist readback이 완료되기 전에 raw opt-in을 활성화하면 안 된다.

## 실험 경계

최종 채택 가능한 측정 파일은 `warning-adaptive-codec-frozen-20261005.json`과 해당 summary다. 실행 closure를 별도 소유 snapshot에 복사하고 시작/종료 SHA와 실제 작업 트리를 모두 대조한다. 각 관측은 새 Node 프로세스이며 Python 생산자가 decoder ACK를 받은 후에만 다음 SQL 요청을 보낸다. 이는 실제 서버의 순차 RPC/decode 동작에 맞춘다. 실제 PG17.6/ICU78 Unix socket, Node24.21/ICU78.3/Unicode17 및 합성 fixture를 사용한다. OS/PG buffer cache를 비우지 않았고 oracle/EXPLAIN은 DB를 따뜻하게 한다. cold는 application process/cache cold이며 disk-cold라는 뜻이 아니다.

`warning-adaptive-codec-20261005.json`은 이전 pipelined harness의 중단된 결과다. small/cold 기록을 보존하지만 최종 성능 판단에서 제외한다. pipe 생산자가 앞서 보내면서 여러 배치가 Node readline queue에 쌓일 수 있었으므로 실제 서버의 순차 소비와 다른 RSS/latency였다. `tmp/warning-adaptive-pilot-20261005.json`, `tmp/warning-adaptive-boundary-20261005.json`도 탐색 기록이며 최종 7쌍에 섞지 않는다.

`warning-adaptive-codec-serial-20261005.json`은 56회 비교와 100회 workflow/1,325회 HTTP/RPC를 모두 완료했지만, 종료 시 다른 소유자의 normalizer runtime 변경 SHA `8f4d1402…→4163901d…`를 감지하여 채택을 거절했다. 이 회차도 최종 수치에서 제외한다. 해당 코드를 수정하거나 guard를 느슨하게 하지 않고 snapshot 기반으로 전체 source binding을 다시 측정했다.

밀도 임계값 선택 근거: 경계 탐색 `N=20k,G=200`에서는 grouped가 stream 대비 시간 8300.813→722.181ms, Node 작업 CPU 1892.461→79.249ms, bytes 10,889,102→174,228이었다. `G=201`은 flat으로 선택되었고 시간 7084.957→1994.730ms, CPU 1774.353→1596.082ms, bytes 10,889,102→6,986,939였다. 이는 단일 탐색 pair이며 특히 당시 pipelined harness의 메모리/시간을 최종 개선 수치로 일반화하지 않는다. 1% 이하의 보수적 grouped 허용과 바로 바깥의 flat 전환을 확인한 근거다. SQL 별도 EXPLAIN은 실제 density aggregate 및 bounded projection 단계의 행 수, buffers, temp spill, 시간을 원시 JSON에 기록한다.

Loopback harness는 실제 PG RPC 한 배치마다 `127.0.0.1` GET 응답을 보내며 2MiB를 검증한다. 실제 JS decoder가 완료한 뒤 다음 요청을 보낸다. 4조건×25회 전체 page read는 100개 workflow이며 HTTP batch 호출 수는 별도로 센다. 이는 product API/PostgREST/인증 자체의 성능은 아니다. 실제 Next route의 별도 100회 검사는 synthetic auth/client를 쓰며 fixed errors와 보호된 호출 순서의 회귀 증거다.

분류기 비용은 flat에서 여전히 최악 `P×N`이며 UTF16 edit distance의 문자열 길이 비용도 기존 그대로다. grouped도 skew/큰 attrs 때문에 여러 배치이면 grouping stage를 반복할 수 있다. CPU는 Node parsing/classification 작업 구간, RSS는 Node process high-water mark이고 DB CPU/RSS는 측정하지 않았다. 계획 비용은 각 전체 읽기마다 다시 들므로 revision 간 캐시 상각을 주장하지 않는다. 작은 데이터/일부 CPU/RSS 악화와 7쌍의 불확실성은 summary에 그대로 기록한다.

응답 bytes는 compact JSON payload만 센다. 요청 URL/body, HTTP headers, gzip, page/stats/revision bootstrap 호출 및 provider 비용은 포함하지 않는다. 소유한 loopback HTTP 서버와 테스트 DB만 사용하고 종료 후 정리한다.

## 최종 측정 결과

동일 snapshot 및 최종 작업 트리 SHA 일치. 4조건 각각 7쌍, page target 200개다. p50은 각 모드의 중앙값이며 변화율/CI는 pair별 변화율의 평균과 deterministic paired bootstrap 20,000회(seed 20261005)다. n=7의 로컬 shared-host 실험이며 hosted population 보장은 아니다.

|조건|N/G|시간 p50 ms (stream → codec)|pair 평균 변화율 [95% CI]|요청|응답 bytes|
|---|---:|---:|---:|---:|---:|
|cold / flat|1000/1000|325.349 → 264.525|-20.33% [-22.94, -18.10]|6 → 1|544897 → 349782|
|small / flat|200/200|140.016 → 140.754|+0.93% [-6.24, +8.65]|2 → 1|108893 → 82579|
|dense / grouped|50000/3|38465.521 → 1047.238|-97.31% [-97.44, -97.18]|251 → 1|27400252 → 25993|
|unique / flat|50000/50000|47048.681 → 7934.850|-82.26% [-84.16, -80.28]|251 → 50|27339142 → 17583869|

|조건|Node 작업 CPU p50 ms|CPU pair 변화율 [CI], 악화 pair|RSS p50 KiB|RSS pair 변화율 [CI], 악화 pair|
|---|---:|---:|---:|---:|
|cold|130.266 → 140.223|+2.90% [-2.37, +7.97], 4/7|124768 → 115952|-6.74% [-7.68, -5.67], 0/7|
|small|37.441 → 37.442|+2.18% [-4.98, +11.92], 4/7|113712 → 114000|+0.20% [-0.91, +1.21], 4/7|
|dense|3790.237 → 11.270|-99.70% [-99.72, -99.69], 0/7|247040 → 110304|-55.18% [-55.57, -54.80], 0/7|
|unique|4375.871 → 4353.917|-1.71% [-7.13, +4.69], 3/7|246384 → 249840|+1.84% [+1.27, +2.64], 7/7|

small 시간은 평균 +0.93%, 4/7 pair 악화로 개선이 입증되지 않았다. cold CPU도 평균 +2.90%, 4/7 pair 악화다. unique CPU 변화의 CI는 0을 포함하고 RSS는 평균 +1.84%, 7/7 pair 모두 악화했다. 응답 bytes와 큰 데이터 시간의 감소를 모든 자원의 감소라고 표현하지 않는다. p75/p95와 절대 차이 CI는 summary JSON에 있다.

계획 비용은 매 읽기마다 지불하므로 반복 횟수에 따른 별도 상각 캐시는 없다. 관측된 p50 시간 이득은 cold/dense/unique에서 1회 읽기부터 발생했고 small은 반복해도 이 모델에서 상각되는 이득이 없다.

|SQL 단계 (독립 EXPLAIN)|density ms|temp written 8KiB blocks|bounded projection ms / rows|
|---|---:|---:|---:|
|cold|13.259|0|3.621 / 1000|
|small|미실행; 별도 counterfactual 2.443|0|0.68 / 200|
|dense|689.783|3706|13.141 / 1000|
|unique|825.675|3698|12.861 / 1000|

EXPLAIN의 aggregate 출력은 1행이나 입력은 각 N행이다. 원시 plan에 scan rows/loops와 buffers가 있다. projection만의 시간은 전체 RPC 시간이 아니며 admission/count/cursor 검증 비용은 별도로 실제 dbReadMs에 포함되어 있다. work_mem=4MB에서 temp spill이 관측되었으며 DB peak RSS는 미측정이다.

최종 계측 resource counts: paired full reads 56 / warning batch reads 3,941; loopback full-page workflows 100 / HTTP GET 1,325 / RPC 1,325 / 실패 0; 전체 reference와 일치한 결과 156개. 이는 최종 채택 회차의 logical batch 수이며 oracle/setup SQL과 제외된 탐색·중단 회차의 총 DB statement 수는 계측하지 않았다. 운영/provider/paid/commit/push 작업은 0이다.

loopback 25회씩은 조건마다 같은 Node 프로세스를 재사용하므로 그 RSS는 누적 high-water mark이다. fresh-process 7쌍의 RSS와 직접 비교하지 않는다. 이 측정은 장기 heap leak 부재나 동시 요청 p95를 증명하지 않는다.

## 관련 검증

- Bun 관련 파일 3개: 27 tests PASS. 실제 route synthetic auth/client 100회 포함.
- PG17.6 관련 파일 2개: 13 tests PASS. Unicode 17 source vectors 20,034개, microseconds/NULL/±infinity/ties, self/deleted union, body capacity, revision/cursor/role, G014 owner/ACL/cleanup/unknown source/overload 거절을 포함한다.
- Targeted ESLint PASS. native 및 compat 각각 diagnostics 0. 최종 canonical parity logical inputs 3,202개, 이름/비표준-library content SHA 차이 0. canonical parity wrapper 최종 PASS. 앞선 fixed Error 2회는 원인이 입증되지 않았으며 native/compat 및 input 비교 후 최종 wrapper 통과를 따로 기록했다. 공유 스크립트는 변경하지 않았다.
- 최초 source drift는 guard를 약화하지 않고 회차를 분리했다. 기존 raw 보고서 SHA manifest `842d4ddfef3e698c7466c7aec3a081bf840f6fad555370b1a6c298d58f105253`와 모든 원래 artifact가 유지된다.


## 최종 source SHA256

|파일|SHA256|
|---|---|
|`apps/web/lib/admin/evaluation-page-server.ts`|`bb7690e071aee367ca3c9fa6c4197bc16ad362ce33dc4f616e43e6c01c965eb4`|
|`apps/web/lib/admin/evaluation-warning-adaptive-codec.ts`|`9872f35d53c059be7f547b6d9bc11898e6fedf69158cf6e57920f367970c3b88`|
|`apps/web/lib/admin/evaluation-warning-raw-groups.ts`|`a79a1a922fad44a906ebdad24efd12e788cf300568d22b0091635af527798dc8`|
|`apps/web/tests-unit/admin-evaluation-page-server.test.ts`|`cfb3fe042e565a1bfa8dd44e4f6964248b83841d77d40ea975902d6e7e07f362`|
|`apps/web/tests-unit/admin-evaluation-page-api.test.ts`|`f445e3085da64a403e72c86972a3447177ad841f0dffca68057d9018de8ace47`|
|`apps/web/tests-unit/admin-evaluation-raw-warning-groups.test.ts`|`1fe992db852186f4f75be2941af04c8363c8d9d463ffb86442d6e273b6cc8006`|
|`backend/supabase/migrations/20261004192657_admin_evaluation_raw_warning_groups.sql`|`66eace1d6fb0dd55c1d780776bab855cc37690335ad40b0fdc1294c610e07d3a`|
|`backend/supabase/migrations/20261004194715_admin_evaluation_raw_warning_invoker_contract.sql`|`e1c105df82c4f814d3e6adad807ff9d072b8cd42ae770b4b78f75b89a9387020`|
|`backend/supabase/tests/test_admin_evaluation_raw_warning_groups.py`|`51de7f8c94fccb61481e1567d9ea626b3df0e3b8282ffe822faf9c0c0253220f`|
|`backend/supabase/tests/test_raw_warning_invoker_contract.py`|`4f42339727c7e3d3d9e2b5049f7db07501bc0f1a5dcba119d47a76564200ffb8`|
|`backend/bin/benchmark_evaluation_warning_adaptive_codec.py`|`a95ad75b32054874fc3ac77fe401131d12aa50bd87e9871d1de60d5e41587004`|
|`backend/bin/measure_evaluation_warning_codec_http.py`|`dd31bb5b5d30435f99609fb565ab9df236ba5ec7fa264741a33bf428c34d13ec`|
|`backend/bin/summarize_evaluation_warning_adaptive_codec.py`|`7b6f3fdf07721f853965d68a4a69faa739892d91513d6ad267a59d164604651d`|
