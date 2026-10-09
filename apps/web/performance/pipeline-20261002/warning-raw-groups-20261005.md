Source ready: raw warning grouping (local verification, 2026-10-05). 운영/배포/provider/secret/commit/push 실행은 0회다. 새 default는 WARNING_RAW_GROUPS이며 배포 전에 아래 두 migration이 필요하다.

측정은 합성 50,000행 × 현재 페이지 200행의 dense(3개 raw 그룹) / unique(50,000개 그룹), 각각 3쌍이다. 실제 PostgreSQL 17.6의 함수와 Node 24.21.0 / ICU 78.3 / Unicode 17.0의 기존 JS 전체 참조를 사용했다. 모든 결과 digest 및 입력 전후 SHA가 일치했다. Apple Silicon macOS의 공유 로컬 호스트 측정이며 HTTP·실 provider·전체 pipeline 성능 증명이 아니다. Node worker는 매번 새로 시작했지만 PG/OS cache는 비우지 않았고 oracle/EXPLAIN이 먼저 실행되었다. cold-disk 성능 측정이 아니다.

| 조건 / 지표 | stream p50 | raw p50 | 변화 | paired bootstrap 95% 구간 | 악화 쌍 |
|---|---:|---:|---:|---:|---:|
| dense / 전체 로컬 처리 (s) | 49.283 | 0.918 | -98.14% | [-98.17%, -97.87%] | 0/3 |
| dense / Node batch CPU (s) | 4.045 | 0.013 | -99.68% | [-99.69%, -99.66%] | 0/3 |
| dense / Node peak RSS (MiB) | 239.188 | 106.328 | -55.55% | [-55.76%, -54.93%] | 0/3 |
| dense / private read batches | 251.000 | 1.000 | -99.60% | [-99.60%, -99.60%] | 0/3 |
| dense / 직렬화 전송 (MiB) | 26.131 | 0.017 | -99.93% | [-99.93%, -99.93%] | 0/3 |
| unique / 전체 로컬 처리 (s) | 49.766 | 49.560 | -0.41% | [-1.14%, +5.45%] | 1/3 |
| unique / Node batch CPU (s) | 4.570 | 5.965 | +30.52% | [+27.73%, +36.44%] | 3/3 |
| unique / Node peak RSS (MiB) | 237.297 | 246.922 | +4.06% | [+3.64%, +4.88%] | 3/3 |
| unique / private read batches | 251.000 | 50.000 | -80.08% | [-80.08%, -80.08%] | 0/3 |
| unique / 직렬화 전송 (MiB) | 26.073 | 27.391 | +5.06% | [+5.06%, +5.06%] | 3/3 |

p50/p75/p95, 절대 변화, 각 원시 관측값은 summary JSON과 frontier 원시 JSON에 보존했다. n=3의 bootstrap은 작은 표본의 기술적 구간이며 운영 tail latency를 입증하지 않는다. bytes는 실제 Node 파이프에 전달한 compact UTF-8 JSON 합계(프레이밍/PG wire/HTTP header 제외)다. Node CPU는 JSON 파싱과 batch 계산이며 PG CPU는 측정하지 않았다. RSS는 Node 전체 worker peak이며 PG backend peak는 측정하지 않았다.

unique에서는 요청만 확실히 줄었고 전체 시간은 거의 같았다. CPU +30.52%, 전송 +5.06%, RSS +4.06% 악화를 보존한다. 앞선 prototype의 unique 시간 +18.75% / CPU +49.98% 등도 warning-raw-groups-final-20261005.json에 그대로 남겼다. packed prototype도 별도 보존했으며 최종 성과에 섞지 않았다. 최종 frontier 소스의 후속 unchanged 반복이나 추가 최적화는 수행하지 않는다.

정확성 및 상한:

- SQL은 related view에서 id/created_at/video_id만 뺀 원본 attrs를 canonical JSONB text COLLATE C의 바이트 동등성으로 묶는다. 이름 정규화·유사도·거리·언어 collation 판단은 없다. 해시만을 그룹 ID로 사용하지 않으므로 해시 충돌에 따른 누락이 없다.
- created_at DESC, id ASC의 전역 sourceOrder로 그룹 첫 행을 cursor로 삼는다. revision, pageIds, 전체 row/group counts, 누적 row/group offsets, samples의 ID/순번 중복, self membership, self의 실제 비교 필드, 완료 상태를 검증한다. SQL 내부는 한 statement snapshot, 여러 batch와 마지막 page read는 동일 revision이어야 한다.
- 같은 raw attrs 안에서는 ID 제외와 입력 순번을 빼고 기존 판정이 같다. count에서 해당 target의 자기 행 한 개만 뺀다. 각 그룹 top4 실제 행이면 자기 행 제외 후 top3를 항상 포함한다. confidence/name 정렬 후 첫 4개 후보 그룹만 샘플을 펼쳐도 된다. 첫 행을 잃을 수 있는 그룹은 자기 그룹 하나뿐이므로, 다섯 번째 이후 그룹보다 앞서는 실제 행 세 개가 존재한다. 마지막 병합은 confidence DESC, 기존 localeCompare, sourceOrder ASC다.
- 삭제 경고는 기존 isSameVideoSameOriginDeleted의 origin OR candidate union을 한 번만 센다. 삭제 target의 경고 제외와 로컬 identity 경고도 기존 함수를 호출한다. UTF16 edit distance, NFKC/lowercase, 전화, display name, float/haversine 계산은 변경하지 않았다.
- page ≤200, catalog ≤50,000, raw batch ≤1,000그룹 / 2MiB다. SQL raw attrs 전체 64MiB, 단일 attrs 1MiB 초과는 정확한 P0001/EVALUATION_WARNING_RAW_CAPACITY_EXCEEDED로 거절한다. 그 코드와 null data만 전체 stream을 처음부터 재시작한다. stale/transport/권한/누락 RPC/형식/알 수 없는 오류는 fallback하지 않는다.
- 2MiB는 raw RPC 응답 상한이다. 호환 stream은 기존 200행 단위이며 바이트 상한을 새로 부여하지 않았다. SQL은 각 batch마다 N행을 다시 그룹화하므로 대략 O(R·N log N), JS는 O(P·G·classifierCost)다. 모든 값이 고유하면 여전히 최대 200×50k 비교이며 긴 문자열의 기존 quadratic edit distance 비용도 사라지지 않는다. Node는 한 batch, O(N) 샘플 ID/순번 집합, O(P) top3만 유지한다. 전체 raw catalog를 Node에 캐시하지 않는다.

EXPLAIN dense: core query 388.944 ms, root temp written 7040 × 8KiB. N=50k 입력, G=3, 직렬화 후보 ≤1,000. 이 시간은 RPC 전체 preflight나 모든 batch 총시간이 아니다. PostgreSQL work_mem=4MiB에서 disk sort가 관측되었으므로 64MiB 입력 제한을 DB RSS 제한으로 해석하면 안 된다.
EXPLAIN unique: core query 429.508 ms, root temp written 10466 × 8KiB. N=50k 입력, G=50000, 직렬화 후보 ≤1,000. 이 시간은 RPC 전체 preflight나 모든 batch 총시간이 아니다. PostgreSQL work_mem=4MiB에서 disk sort가 관측되었으므로 64MiB 입력 제한을 DB RSS 제한으로 해석하면 안 된다.

검증: 관련 web unit 25개, PG raw 계약 6개(공식 Unicode 17 NormalizationTest의 source column 20,034개 포함), G014 source/owner-helper 계약 5개 통과. 전체 Unicode scalar/conformance의 SQL 재구현 증명은 아니다. 수치 경계·비정상 float·locale 동률·self 안/밖 sample·삭제 union·응답 bytes 분할·oversize·stale·잘못된 membership/offset·ACL·overload·등록 실패 후 clean restart를 포함한다. native/compat TypeScript parity diagnostics=0, logical inputs=3200; 대상 ESLint 및 diff whitespace 검사 통과. 새 raw server 테스트는 기존 isolated admin-evaluation-page-server.test.ts에 넣었으며 공유 test runner를 바꾸지 않았다.

적용 순서와 남은 운영 전 조건:

1. 기존 applied SQL은 그대로 둔다. 후보 action migration을 함께 적용한다면 20261004190259_admin_record_guarded_actions.sql이 먼저다. raw 등록의 source admission은 기존 검증된 canonical/hosted 본문 또는 정확한 record-action 한 줄 추가만 허용한다. 반대 순서로 action source를 임의 적용하지 않는다.
2. 20261004192657_admin_evaluation_raw_warning_groups.sql: ASCII video token 6..128 + negative boundary를 forward 수정하고 restaurants lock 아래 private read-index의 video/descriptor.video를 재계산하며 revision을 한 번 증가시킨다. 129자 token 뒤 유효 fallback도 Node와 일치한다. restaurant 행과 기존 helper ACL은 유지한다. 새 RPC는 invoker / 빈 search_path / service_role only다.
3. 20261004194715_admin_evaluation_raw_warning_invoker_contract.sql: 실제 privacy_workflow_owner 권한의 일회성 pg_temp helper로 allowlist와 두 G014 assertion의 정확한 추가 항목을 등록한다. 기존 assertion owner/ACL/metadata와 role memberships를 보존하며 helper를 제거한다. 로컬 superuser PG17의 성공/rollback/실패/재시작을 검증했다. 실제 hosted의 non-superuser 역할 분기 실행은 미검증이며 fresh owner/body/ACL/membership admission 및 정확한 history receipt가 필요하다.
4. root 소유 security manifest/선택형 rollout pack에 두 새 파일의 SHA를 등록하고 실제 전체 G014/G024 replay 및 최종 4개 assertion을 확인해야 한다. 이번 세션은 전체 clean replay를 반복하지 않았다. 새 raw RPC용 합성 gateway fixture 계약도 필요하면 root가 갱신해야 한다. 원래 normalized warning RPC용 ICU guard나 적용 SQL은 변경하지 않았다.
5. 두 migration의 ledger/name/source hash, RPC owner/ACL/proconfig, group counts/self/samples, revision/index 재계산, 레스토랑 기본 행 digest 보존, helper=0, 멤버십 보존을 읽기 확인한 뒤 default raw 소스를 배포한다. 첫 파일만 성공하고 등록이 실패했다면 stream 배포를 유지하고 등록의 실패를 해결한다. 없는 RPC/권한 오류는 현재 BFF의 고정 500이고 숨은 fallback이 아니다.
6. 앱 rollback은 ADMIN_EVALUATION_WARNING_READ_PATH=stream으로 선택한다. 기존 SQL 계산 경로는 rpc 명시 opt-in과 원래 ICU/Unicode gate를 유지한다. 적용된 helper를 과거의 129자 버그로 되돌리거나 원장을 고치지 않는다. 함수 제거가 필요하면 별도 forward migration/정확한 G014 계약이 필요하다.

최종 source readiness: 평가 server의 기본 경로 선택/주석은 측정 완료 뒤 바꾸고 API/단위 검사로 확인했다. SQL과 JS 경고 알고리즘 및 transitive runtime helper의 SHA는 최종 측정 sourceBefore/sourceAfter와 현재 소스에서 일치한다. default 선택 변경은 component 측정 결과에 섞지 않는다. 전후 입력 SHA도 두 fixture 모두 일치한다.

원시 최종 artifact SHA256: 524403025ada031d49f1f079174cb1f6f40af9c30c78dcdf17273b6c2163746a
Summary SHA256: ee01e590762b2728ee62af1adc4c3b8af28dddab64e5811974ea285ab00a7a2d
