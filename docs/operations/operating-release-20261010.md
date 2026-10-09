# 운영 배포와 SQL 적용 검증 — 2026-10-10

새 관리자 UI는 운영에 배포됐다. SQL 적용은 1회 시도했으며 최종 상태 검증 실패로 롤백됐다. 전체 요청 완료나 운영 성능 개선을 주장하지 않는다.

## 현재 실제 상태

- 운영 배포: `dpl_CLEMRdaLUrai3Ph9J2czNRA64pyw`, Git SHA `8257581e09f6f58f72f6e0e2c4aa7e6c72caab43`, READY. `www.tzudong.app`과 `tzudong.app`이 같은 배포를 가리킨다. www health는 HTTP 200, apex는 canonical www로 HTTP 301이다.
- SQL 적용기 소스: PR #3160 → #3161 → #3162, protected `develop → data → main` 병합 완료. 현재 main은 `f55117f878596447f286aece13acf903205af71c`이다. source SHA와 운영 app SHA는 구분한다.
- 관련 소스 검사: 61개 통과, 실패 0, assertions 344. 정확한 80→85→86 전이, 적용 직전 만료 재검사, 실제 rollback project/deployment/Git/alias 검증, M5 원문에서 재구성한 function hash를 검사한다.
- 실제 관리자 로그인으로 sidebar 15개 메뉴를 열었다. 이는 navigation 증빙이다. 사용자 목록은 RPC 부재로 실패하며 Sentry 연결은 미설정이다. 전체 쓰기·공급자 기능 성공을 뜻하지 않는다.
- 맛집 조회: 전체 1,659건, 첫 페이지 50건, 삭제 890건. record mutation은 실제 같은 출처 UI 요청에서 HTTP 423 / `RECORD_ACTION_MAINTENANCE`로 차단됐다.

## 운영 적용 시도와 데이터 보존

2026-10-09 18:04:44–18:04:50 UTC에 reviewed five controller를 1회 실행했다. Node/psql transport는 `MIGRATION_PSQL_EXECUTION_FAILED`로 반환했으며, 같은 시간대 운영 로그의 고정 코드 추출은 DO / SQLSTATE `P0001` / `MIGRATION_TERMINAL_READBACK_FAILED` 1건을 확인했다. 로그의 statement hash는 현재 top-level compiled statements와 직접 일치하지 않았으므로, nested guard 또는 caller 상관관계는 추가 검증 중이다. 입력은 2,464,084 bytes다. 오류 원문, SQL, 개인 데이터, credential은 증빙에 저장하지 않았다.

실행기는 읽기 reconciliation을 수행했고 root도 별도로 다시 읽었다. 장부는 80→80, 대상 SQL은 0건, schema/ledger roots는 동일했다. 자동 재전송하지 않았으며 만료된 admission은 재사용하지 않는다. 사용자·감사 로그 forward는 실행하지 않았다. 데이터 보존 확인 후 다른 탭·터미널의 사용자 writer pause는 해제했다. 관리자 record mutation hold는 유지하며, 다음 적용에는 수정된 실제 compiled 경로와 새 writer-pause 확인이 필요하다.

| 보존 대상 | 전 | 후 | 절대 차이 | 변화율 | 근거 |
| --- | ---: | ---: | ---: | ---: | --- |
| 맛집 | 1,659 | 1,659 | 0 | 0% | 전체 행 hash 동일 |
| 제보 | 3 | 3 | 0 | 0% | 전체 행 hash 동일 |
| 리뷰 | 8 | 8 | 0 | 0% | 전체 행 hash 동일 |
| 프로필 | 20 | 20 | 0 | 0% | 전체 행 hash 동일 |
| 사용자 역할 | 21 | 21 | 0 | 0% | 전체 행 hash 동일 |
| 계정 상태 | 17 | 17 | 0 | 0% | 전체 행 hash 동일 |
| 감사 이벤트 | 14 | 14 | 0 | 0% | 전체 행 hash 동일 |
| 전체 | 1,742 | 1,742 | 0 | 0% | 7개 테이블 모두 동일 |

이 비교는 전수 상태 검증 1쌍이며 확률 표본 실험이 아니다. 95% 신뢰구간은 적용하지 않는다. 실패율·성능·비용 개선으로 해석하지 않는다.

## 증빙의 적용 범위

PG17.6에서 운영 schema/ledger/비개인 계약을 복제한 6단계 재생은 성공했다. 원문 SQL 재생과 실제 2.46MB compiled 적용기의 outer guards까지 성공한 검증은 구분하며, 운영 실패를 근거로 후자의 재생을 추가 진행한다. 8개 로컬 OID vector와 CHECK 괄호 1개 보정은 문서화했고 owner/ACL/function body 검사는 생략하거나 완화하지 않았다. 이 로컬 결과를 운영 성공으로 승격하지 않는다.

표준 HOME과 기존 전역 CA 파일을 보존하면서, source가 지원하는 `TZUDONG_SUCCESSOR_PSQL`에 task-owned adapter를 지정했다. 고정 PostgreSQL 17.11 binary와 public CA SHA를 검증하고 `verify-full`을 유지했다. 기존 adapter에서 큰 stdin과 psql 조기 종료가 SQLSTATE를 가리는 EPIPE 경로는 별도 로컬 재현으로 조사 중이다. 원래 운영 guard 실패의 원인과 구분한다.

개선 전후 screenshot은 viewport가 달라 정량 밀도 비교에 쓰지 않았다. 실제 공급자 생성, 24시간 관측, G003 scorer, 자동 승인 독립 정확도, 실제 청구 절감은 미완료다.

증빙: `apps/web/performance/operating-release-20261010/`. 원래 운영 DB export, private admission, process 환경, 개인 record rows와 원문 로그는 Git에 포함하지 않는다.

## 전체 compiled 적용기의 실패 재현과 최소 보정

Exact stage0의 PG17.6 로컬 복제에서 운영에 전달한 2,464,084-byte compiled plan 자체를 실행했다. 입력 886행의 첫 migration terminal guard가 `P0001 / MIGRATION_TERMINAL_READBACK_FAILED`로 실패했고 전체 트랜잭션은 exact stage0로 돌아왔다. 원인은 `migration 실행 → terminal guard → ledger insert → ledger guard` 순서다. 첫 guard가 기대하는 장부는 81건이지만 그 시점에는 아직 80건이다.

Private 보정 후보는 `migration 실행 → ledger insert → exact ledger guard → terminal guard` 순서만 바꿨다. Expected roots, SQL, ACL/owner/function 검사를 바꾸지 않았다. 후보의 전체 compiled 재생은 5개 stage guard와 final guard를 통과해 exact85에 도달했다. Protected source 구현·관련 회귀 검사·보호 승격을 진행하며, 이 로컬 결과를 운영 적용 완료로 주장하지 않는다.

직접 spawnSync와 8MiB 조기 종료 재현에서는 EPIPE가 SQLSTATE를 가렸다. 이는 guard 실패의 원인과 별개의 transport 오류 분류 문제다. 새로운 bounded stdin adapter는 로컬 검사 후에만 사용한다.

최소 순서 보정을 source에 구현하고 관련 단위 계약 64개를 통과했다. 수정 소스의 PG17.6 전체 compiled 실행에서 five 2,464,084 bytes는 exact85에, forward 331,318 bytes는 exact86에 도달했다. 각각 의도적 terminal mismatch는 장부와 DDL을 exact80/exact85로 롤백했다. sourceRoot, 원문 SQL, expected stage roots, immutable legacy manifest와 권한 검사는 그대로다. source 보호 승격과 새 운영 window는 별도 남아 있다.
