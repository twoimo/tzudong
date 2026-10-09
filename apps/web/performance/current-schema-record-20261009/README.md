# 현재 스키마 관리자 승인 경로 검증

상태: 후보 소스와 격리 PG17 부분 검증. 운영 적용·전체 목표 완료는 아니다.

기존 제보 승인 RPC는 현재 스키마에서 제거된 `name`, `unique_id`, `resource_type`을 참조했다. private workflow owner에 여섯 helper 권한을 되돌리는 실험은 추가 DML 권한을 요구하고 다른 legacy 경로도 활성화하므로 채택하지 않았다. 해당 초안은 `docs/operations/proposals/`에 보존하고 실행 migration inventory 126개에서 제외한다.

새 승인 경로는 기존 service-only atomic action 안에서 현재 컬럼을 갱신한다. 신규의 `source_type=user_submission_new`와 제출자 `created_by`, 수정의 기존 status/is_missing/평가/출처, frozen snapshot·CAS·멱등성·audit·readback을 보존한다. 활성 관리자 판정은 disabled_at NULL도 요구한다. 익명·일반 사용자에게 새 권한을 추가하지 않았다.

| 확인 항목 | 결과 | 환경·한계 |
| --- | --- | --- |
| 순차 SQL 3개 / G014 | 4개 assertion 통과 | PG17.6, hosted read-only schema/contract snapshot 복원; 사용자 행 복사 0 |
| rollback | 전후 schema SHA 동일 | 선언된 snapshot 복원 projection 있음; 운영 rollback 실행 아님 |
| 실제 action SQL | 6개 synthetic 흐름 통과 | 원본 trigger/RLS/function 유지, BEGIN/ROLLBACK; 동시 race는 아직 포함하지 않음 |
| 확장 승인·실패·actor 검사 | 27개 통과 (guarded runtime 26개 + enum 경계 1개) | 신규 provenance/trace, edit pending/hold/approved 보존, NULL/누락/외부 item, reject/mixed, 전량 rollback, CAS/멱등성/claims/비활성 actor; 실제 2연결 race는 별도 |
| trace 알고리즘 동등성 | 512/512 일치, 불일치 0 | NULL·빈값·한글·emoji·구분자·Unicode 조합·영상 URL의 8³ 고정 경계 조합 |
| legacy owner helper 권한 | 6개 모두 EXECUTE=false 유지 | blanket 권한 복구 실험이 없는 pristine clone |
| 웹 저장/제보 소비자 회귀 | 63 pass, 0 fail / 7파일 | local Bun; 실제 브라우저·운영 저장 증거 아님 |

위 수치는 결정적 경계 검사이며 통계 표본으로 측정한 속도/비용 개선이 아니다. 95% 신뢰구간은 적용하지 않는다. source hash와 실패한 test query 준비 시도도 함께 보존했다. 실제 생성·모델 품질·운영 비용·전체 성공률은 별도 검증한다.

현재 함수 권한과 empty search_path는 [Supabase 공식 함수 문서](https://supabase.com/docs/guides/database/functions)의 실행 권한 경계를 대조했다. 설치된 프로젝트 핀과 원본 catalog 정책을 유지했다.

재현에는 private bound snapshot과 pinned Supabase image가 필요하다. private 입력을 이 폴더에 복사하지 않았다. `pg17/*fixture.sql`은 정확한 task-owned DB admission과 synthetic 입력만 포함한다. 외부/운영 DB에 실행하면 안 된다.

PG15 첫 실행은 adapter에 고정된 이전 source SHA 때문에 실패했다. `15d82aa12680b3b3609c8c41aa3599bed82837db`에서 현재 source SHA만 갱신했고 관련 17개 검사가 통과했다. 변환 anchor·역변환의 byte 일치·변경 source 거부·PG15 한정·owner/ACL/G014 postcondition은 그대로다. 독립 canonical 두 실행의 성공은 별도로 기록한다.

현재 고정 source의 canonical PG15.8 재구축 두 실행과 비교가 통과했다: 1,917 catalog 행과 56개 artifact의 비교 해시가 일치했다. 실행 143.065초/131.305초는 재현 작업 시간이며 제품 성능 개선율로 계산하지 않는다. generator-owned 컨테이너 정리를 확인했다. 운영 PG17 적용·실제 사용자 데이터 검증은 별도다.

실제 두 PostgreSQL 연결의 경합도 2개 시나리오에서 통과했다. 다른 operation의 같은 대상 승인은 한쪽만 적용·audit1개이며 다른쪽은 STALE/audit0개다. 같은 operation 재전송은 동일 receipt/audit1개/신규 맛집1개다. task-owned 일회성 template DB에서 실행하고 해당 DB만 삭제해 부재를 확인했다. 원본 clone의 12개 행 집계는 전후0이고 schema·functions·roles·memberships·triggers/G014는 유지됐다. 두 시나리오의 성공을 실제 운영 오류 확률0이나 일반적 승률로 해석하지 않는다.

이번 웹 변경의 Next16.3.8 프로덕션 build와 50개 페이지 생성·route CSS boundary 검사가 통과했다. 기존 dev 출력과 분리한 디렉터리를 사용했고 compiler가 추가한 두 include만 검사 후 제거하여 tsconfig 원래 bytes를 복원했다. 배포 증빙은 아니다.
