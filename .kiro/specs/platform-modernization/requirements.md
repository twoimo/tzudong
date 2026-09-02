# Requirements Document

## Introduction

이 스펙은 쯔동여지도(Tzudong) 플랫폼의 기술 스택 현대화를 다룬다. 사용자가 요청한 범위는 아홉 갈래다.

1. `backend/` 파이썬 코드의 러스트 이행(크롤러, 평가, 미디어/ffmpeg, 배치, 검증기, 파이프라인)
2. GitHub Actions 기반 의존성 신선도 지속 관리
3. 워크스페이스 폴더 구조 재편
4. 폴더·파일·함수·메소드 명명 리팩터
5. macOS 로컬 환경에서 크롤러 데이터 파이프라인 전체 동작(Supabase Free 사용량 제약 회피)
6. 호스티드 스키마를 미러링하는 로컬 DB와 별도 관리되는 호스티드 게시 대상 테이블의 주기 동기화
7. 로컬 우선 관측·운영 도구 스택(레지스트리, 배포, Grafana, Kafka·kafka-ui, 서비스 메시, Elasticsearch, EFK, Helm, IaC)
8. 서비스 전체 운영 로그 중앙 관리
9. LLM/AI 에이전트가 모니터링 신호를 감시하고 조치하는 지속 운영/통합

### 현재 트리 탐색 결과

이 스펙은 신규 스택의 백지 도입이 아니라 이미 존재하는 자산의 확장·대체·증거화로 정의된다. 탐색으로 확인한 사실은 다음과 같다.

- `backend/pipeline_control/`에 최상위 파이썬 모듈 39개가 있고 하위 `tests/`를 포함하면 51개다. `graph.py`, `state_machine.py`, `worker.py`, `api.py`, `queue.py`, `outbox.py`, `publisher.py`, `es_index.py`, `metrics.py`, `pg_store.py`, `pool.py`, `batch_upsert.py`, `parity.py`, `profiles.py`, `targets.py`, `live_evidence.py`, `manifest.py`, `health.py`, `cutover.py`, `dsn_guard.py`를 포함한다.
- `backend/pipeline-control/`에 컨테이너·관측 스캐폴드가 있다. `Dockerfile`, `docker-compose.kafka.yml`, `docker-compose.elasticsearch.yml`, `docker-compose.observability.yml`, `docker-compose.pipeline.yml`, `otel-collector.yaml`, `prometheus.yml`, `grafana/`, `metrics.v1.json`, `events.v1.json`, `harbor-tags.md`, `lite-gha.md`를 포함한다.
- `backend/pipeline-control/docker-compose.observability.yml`은 이미 `otel/opentelemetry-collector:0.120.0`, `prom/prometheus:v3.2.1`, `grafana/grafana:11.5.2`를 `127.0.0.1` 루프백에 고정 바인딩한다.
- `backend/pipeline-control/harbor-tags.md`는 `harbor.local/tzudong/pipeline-api` 및 `harbor.local/tzudong/pipeline-worker` 태그 규약을 이미 기록한다.
- `backend/supabase/`에 14개 서비스 로컬 Supabase 스택, 85개 항목의 `migrations/`, `baselines/`, `local-inputs/`, `scripts/local-stack.py`, `reset.sh`가 있다.
- `backend/pipeline_control/profiles.py`는 `heavy_local`/`lite_gha` 컴퓨트 프로파일과 `local_db`/`artifact_only`/`hosted_apply` 데이터 싱크를 이미 구분하고, `hosted_apply`를 `hosted_apply_not_admitted`로 차단한다.
- `backend/pipeline_control/batch_upsert.py`는 `pipeline_control.batch_upsert_restaurants` RPC를 통한 최대 200건 배치 업서트와 `readback`을 이미 구현한다.
- `backend/pipeline_control/es_index.py`는 `pipeline-logs-v1`/`pipeline-raw-v1` 인덱스, 필드 허용목록, `local_db` 전용 URL 승인을 이미 구현한다.
- `.github/workflows/`에 20개 워크플로가 있다. `daily-crawler.yml`, `nightly-local-regression.yml`, `nightly-regression.yml`, `supabase-migration-apply.yml`, `release-governance-ci.yml`, `web-admin-ci.yml`, `security-audit.yml`, `ts7-release-evidence.yml`, `privacy-retention.yml`을 포함한다.
- `.github/dependabot.yml`은 github-actions, npm(`/apps/web`, `/backend`), pip(`/backend/pipeline`, `/backend/restaurant-crawling/scripts`, `/backend/pipeline-control`) 갱신과 명시적 보류 목록(`next >=16.3.0`, `eslint` 메이저, `@types/node` 메이저, `typescript-eslint >8.63.0`)을 이미 정의한다.
- `backend/naming-renames.v1.json`은 5개 항목과 `nonGoals`를 가진 명명 교정 원장 형식을 이미 정의한다.
- `backend/utils/privacy_log.py`와 `apps/web/lib/privacy/sanitize.ts`가 각각 백엔드·웹 레다크션 경계다.
- `.local-archive/`를 제외한 첫 번째 당사자 파이썬 파일은 약 360개다.
- 러스트 소스, `Cargo.toml`, Helm 차트, IaC 파일, 쿠버네티스 매니페스트는 현재 트리에 존재하지 않는다.

### 비목표

이 문서의 어떤 요구사항도 다음을 승인하거나 주장하지 않는다.

- 호스티드 프로덕션 적용, 릴리스, 배포, DNS 변경
- 법령 준수, 정책 공표, 신고 접수, 법무 승인
- 브랜치 보호 우회 또는 직렬 PR 경로(`develop -> data -> main`) 생략
- 적용된 Supabase 마이그레이션의 수정 또는 재작성
- 근거 아티팩트 없는 성능 개선 수치 주장
- 더티 원본 워크트리에 대한 reset/stash/clean

## Glossary

- **Platform**: `apps/web`, `backend`, `.github`, `docs`, `scripts`를 포함하는 쯔동여지도 저장소 전체.
- **Web_App**: `apps/web`의 Next.js 16 공개 앱과 보호된 `/admin` 콘솔.
- **Backend_Runtime**: 크롤링, 평가, 미디어 작업, 배치 작업, Supabase 준비를 소유하는 `backend/` 실행 경계.
- **Route_Handler_Boundary**: `apps/web/app` 하위 Next.js 라우트 핸들러 경계. 장시간 크롤러, ffmpeg, Gemini 대량 처리, GDrive 대량 업로드, 장시간 Supabase 배치 삽입을 소유하지 않는다.
- **Rust_Component**: 기존 파이썬 모듈의 동작을 대체하기 위해 새로 도입되는 러스트 크레이트 또는 러스트 바이너리.
- **Migration_Slice**: 하나의 병합 후보로 제출되는 러스트 이행 단위. 대체 대상 파이썬 모듈 경로 집합, 러스트 산출물 경로, 패리티 증거를 함께 갖는다.
- **Migration_Ledger**: 각 Migration_Slice의 대체 대상 경로, 산출물 경로, 패리티 결과, 활성 구현 선택을 기록하는 저장소 소유 JSON 원장.
- **Parity_Harness**: 동일 입력을 파이썬 구현과 Rust_Component에 각각 투입하고 정규화된 출력을 비교하는 저장소 소유 실행기.
- **Parity_Result**: Parity_Harness 1회 실행의 결과. `matched` 불리언, 입력 식별자, 비교 대상 필드 집합, 불일치 필드 목록을 포함한다.
- **Implementation_Selector**: 특정 Migration_Slice에 대해 파이썬 구현과 Rust_Component 중 어느 쪽을 실행할지 결정하는 런타임 스위치.
- **Performance_Evidence_Set**: `apps/web/performance/*` 정규 입력, 스코어러 출력, 검증기 출력, 절대·상대·노이즈 예산, 보존된 원시 아티팩트로 구성된 증거 묶음.
- **Dependency_Freshness_Workflow**: 의존성 최신화 후보를 생성·검증하는 GitHub Actions 워크플로.
- **Pin_Contract**: Node 24.x, npm 11.6.2, `@typescript/native` 별칭 `7.0.2`, 호환 브리지 TypeScript `6.0.2`, `apps/web/package.json`, `apps/web/package-lock.json`으로 구성된 릴리스 패키지 권위 집합.
- **Layout_Manifest**: 재편 후 워크스페이스의 최상위·2단 디렉터리 각각에 대해 소유 책임, 허용 내용, 금지 내용을 기록하는 저장소 소유 문서.
- **Rename_Ledger**: `backend/naming-renames.v1.json` 형식을 따르는 명명 변경 원장. 항목별 이전 이름, 새 이름, 근거, 계약 분류, 검증 내역을 갖는다.
- **Local_Stack**: `backend/supabase/scripts/local-stack.py`가 관리하는 macOS 로컬 14개 서비스 Supabase 스택.
- **Local_Database**: Local_Stack이 제공하는 로컬 PostgreSQL 인스턴스.
- **Hosted_Database**: 호스티드 Supabase 프로젝트의 PostgreSQL 인스턴스.
- **Schema_Mirror_Report**: Local_Database와 Hosted_Database 사이의 스키마 차이를 테이블·컬럼·제약·RPC 단위로 열거하는 산출물.
- **Local_Only_Schema**: Local_Database에만 존재하도록 승인된 분석·스테이징 스키마. Hosted_Database 게시 대상이 아니다.
- **Publication_Set**: Hosted_Database로 게시할 테이블과 컬럼을 명시적으로 열거하는 운영자 승인 목록.
- **Publish_Worker**: Publication_Set에 속한 로컬 변경을 Hosted_Database로 게시하는 Backend_Runtime 워커.
- **Publish_Preview**: Publish_Worker가 적용 전에 생성하는 변경 요약. 안정적 해시를 포함한다.
- **Publish_Readback**: 적용 직후 Hosted_Database에서 다시 읽어 게시 결과를 확인하는 단계.
- **Tooling_Selection_Record**: 운영 도구 후보, 평가 기준, 측정값, 선정 결과, 운영자 승인 참조를 기록하는 저장소 소유 문서.
- **Observability_Stack**: 메트릭, 로그, 트레이스, 대시보드, 알림을 제공하는 로컬 우선 도구 집합.
- **Log_Pipeline**: Platform의 운영 로그를 수집·전달·저장·조회하는 경로 전체.
- **Log_Sink**: Log_Pipeline이 로그를 최종 기록하는 대상. 파일, Elasticsearch 인덱스, 로그 저장소를 포함한다.
- **Log_Record_Class**: 필드 허용목록이 적용되는 로그 레코드 분류 단위.
- **Redaction_Boundary**: `backend/utils/privacy_log.py`와 `apps/web/lib/privacy/sanitize.ts`로 구성된 공유 레다크션·어설션 경계.
- **Forbidden_Log_Field**: 로그와 영속 저장에 기록이 금지된 값 부류. 비밀번호, 자격증명, 쿠키, 세션/온보딩 토큰, 이메일 주소, 전화번호, 주민등록번호, 정밀 위치, 원시 OCR, 임의 요청 본문, 공급자 진단 정보, 자유 형식 오류 문자열을 포함한다.
- **Migration_Readiness_Manifest**: 유료 클라우드·VPS·관리형 DB 이전에 필요한 산출물, 설정 외부화 지점, 미해결 항목을 기록하는 저장소 소유 문서.
- **Deployment_Descriptor_Set**: Helm 차트와 IaC 정의로 구성된 배포 기술 산출물 집합.
- **Ops_Agent**: Observability_Stack 신호를 감시하고 조치를 수행하는 LLM 기반 운영 에이전트.
- **Watch_Rule**: Ops_Agent가 조치 대상 신호를 판정하는 데 사용하는 운영자 승인 감시 규칙. 신호 종류와 심각도 임계값을 갖는다.
- **Agent_Action_Allowlist**: Ops_Agent가 사람의 개별 승인 없이 수행할 수 있는 조치를 명시적으로 열거하는 운영자 승인 목록.
- **Agent_Action_Record**: Ops_Agent 조치 1건의 감사 기록. 조치 식별자, 트리거 신호 식별자, 조치 종류, 결과 코드, 사람 승인 참조를 포함한다.
- **Phase_Gate**: 다음 단계 진입 조건과 되돌림 절차를 정의하는 단계 경계.
- **Rollback_Plan**: 단계 산출물을 되돌리는 절차. 되돌림 대상, 실행 명령, 검증 항목을 포함한다.

## Requirements

### 요구사항 1: 러스트 이행 범위와 실행 경계 보존

**User Story:** 개발자로서 파이썬 백엔드를 러스트로 점진 이행하고 싶다. 그래야 성능을 끌어올리면서도 기존 실행 경계와 실패 폐쇄 동작을 잃지 않는다.

#### 수용 기준

1. THE Migration_Ledger SHALL 각 Migration_Slice에 대해 저장소 안에서 유일한 슬라이스 식별자, 1개 이상의 대체 대상 파이썬 모듈 경로 목록, 1개 이상의 Rust_Component 산출물 경로, `full_replacement`·`partial_replacement`·`excluded` 중 하나인 대체 범위 분류, 파이썬 구현과 Rust_Component 중 하나인 활성 구현 선택을 기록하고, 하나의 파이썬 모듈 경로가 둘 이상의 Migration_Slice 항목에 나타나지 않게 유지한다.
2. WHEN Migration_Slice가 병합 후보로 제출되면, THE Platform SHALL 해당 슬라이스 식별자의 Migration_Ledger 항목 존재 여부와 1항의 각 필드가 비어 있지 않은지를 검사하고 검사 결과를 병합 후보 산출물에 기록한다.
3. THE Rust_Component SHALL 크롤러 실행, ffmpeg 처리, Gemini 대량 평가, GDrive 대량 업로드, 1회 실행 소요 시간이 10초를 초과할 수 있는 Supabase 배치 삽입을 Backend_Runtime 워커 진입점 안에서만 수행하고 Route_Handler_Boundary 요청 처리 경로에서 수행하지 않는다.
4. WHILE Migration_Slice가 병합 후보 상태이면, IF 3항의 작업 부류 중 하나라도 Route_Handler_Boundary 하위 경로에서 호출되거나 실행되면, THEN THE Platform SHALL 해당 병합 후보를 거부하고 고정 코드 `boundary_violation`을 반환하며 어떤 산출물도 병합하지 않는다.
5. THE Implementation_Selector SHALL 슬라이스 식별자를 명시한 옵트인 입력이 있는 Migration_Slice에서만 Rust_Component를 실행하고, 옵트인 입력이 없거나 해당 슬라이스 식별자를 지정하지 않은 모든 실행에서 파이썬 구현을 실행한다.
6. IF Rust_Component 초기화가 30초 안에 완료되지 않거나 초기화 실패를 반환하면, THEN THE Implementation_Selector SHALL 고정 코드 `rust_component_unavailable`을 반환하고 초기화를 재시도하지 않으며 파이썬 구현으로 자동 대체하지 않고 부분 결과와 대상 데이터 쓰기를 산출하지 않는다.
7. WHERE Migration_Slice가 Node 전용 패키지에 의존하는 브라우저 자동화 또는 Gemini SDK 글루를 포함하면, THE Migration_Ledger SHALL 해당 부분을 제외 대상 경로, 제외 사유 분류, 유지되는 파이썬 구현 경로와 함께 이행 제외 항목으로 기록하고 해당 경로를 대체 대상 파이썬 모듈 경로 목록에서 제외한다.
8. WHEN Migration_Slice가 병합 후보로 제출되면, THE Platform SHALL 기존 파이썬 회귀 스위트(`backend.utils.tests.test_run_daily_regression`, `backend.pipeline.test_validators_unittest`, `backend.pipeline.test_data_contracts_unittest`)를 각각 실행하고 스위트별 실패 건수와 오류 건수를 Migration_Ledger 항목에 기록한다.
9. IF 병합 후보의 Migration_Ledger 항목이 없거나 1항의 필드 중 하나라도 비어 있으면, THEN THE Platform SHALL 해당 병합 후보를 거부하고 고정 코드 `migration_ledger_entry_missing`을 반환하며 어떤 산출물도 병합하지 않는다.
10. IF 8항의 세 스위트 중 하나라도 실패 건수 또는 오류 건수가 1건 이상이거나 30분 안에 실행을 완료하지 못하면, THEN THE Platform SHALL 해당 병합 후보를 거부하고 고정 코드 `regression_suite_failed`를 반환한다.
11. IF 옵트인 입력이 Migration_Ledger에 없는 슬라이스 식별자를 지정하면, THEN THE Implementation_Selector SHALL 고정 코드 `migration_slice_unknown`을 반환하고 파이썬 구현과 Rust_Component 중 어느 것도 실행하지 않는다.

### 요구사항 2: 파이썬-러스트 동작 패리티 증거

**User Story:** 운영자로서 러스트 구현이 파이썬 구현과 같은 결과를 낸다는 증거를 보고 싶다. 그래야 활성 구현을 바꾸는 결정을 근거 있게 내릴 수 있다.

#### 수용 기준

1. WHEN Parity_Harness가 Migration_Slice의 입력 1건에 대해 실행되면, THE Parity_Harness SHALL 그 입력을 파이썬 구현과 Rust_Component에 각각 투입하고, 두 출력에 동일한 사전 선언 정규화 규칙(필드 이름 사전순 정렬, 비결정 필드 제외 목록 적용)을 적용한 뒤 비교하여 Parity_Result 1건을 산출한다.
2. THE Parity_Result SHALL `matched` 불리언, 입력 식별자 1개, 적용된 정규화 규칙 식별자, 비교 대상 Rust_Component 산출물 식별자, 1개 이상의 필드 이름으로 구성된 비교 대상 필드 집합, 불일치 필드 이름 목록을 포함한다.
3. WHEN Parity_Harness가 불일치를 검출하면, THE Parity_Harness SHALL 불일치 필드 이름을 최대 50개까지와 전체 불일치 필드 개수를 기록하고, 필드 값과 Forbidden_Log_Field 값은 기록하지 않는다.
4. THE Platform SHALL Migration_Slice별로 서로 다른 입력 식별자를 갖고 동일한 Rust_Component 산출물 식별자에 대해 기록되었으며 그 사이에 `matched=false` Parity_Result가 없는 3회의 연속 `matched=true` Parity_Result가 Migration_Ledger에 기록된 후에만 Implementation_Selector 기본값을 Rust_Component로 변경하고, 비교 대상 필드 집합이 비어 있는 Parity_Result는 이 3회 계수에 포함하지 않는다.
5. IF Migration_Slice에 대해 4항 계수 조건을 충족하는 `matched=true` Parity_Result가 3회 미만이면, THEN THE Implementation_Selector SHALL 기본값을 파이썬 구현으로 유지하고 기본값 변경 요청에 고정 코드 `parity_evidence_insufficient`를 반환한다.
6. THE Platform SHALL 파이썬 구현 제거를 4항 조건 충족과 별개의 명시적 병합 후보로만 수행하고, 해당 후보에 4항 충족을 증명하는 Migration_Ledger 항목 참조 또는 운영자 승인 참조가 없으면 후보를 거부한다.
7. FOR ALL Migration_Slice의 유효 입력 도메인에서 생성된 최소 100건의 입력에 대해, 사전 선언 정규화 규칙을 적용한 파이썬 구현 출력과 Rust_Component 출력 SHALL 비교 대상 필드 집합의 모든 필드에서 동일하다. (속성 기반 검증 후보)
8. FOR ALL 유효 입력 도메인 밖에서 생성된 최소 100건의 잘못된 입력에 대해, 파이썬 구현과 Rust_Component SHALL 동일한 고정 오류 코드를 반환하고 부분 결과를 산출하지 않는다. (속성 기반 검증 후보)
9. IF 파이썬 구현 또는 Rust_Component가 입력 1건에 대해 600초 안에 결과를 반환하지 않거나 비정상 종료되면, THEN THE Parity_Harness SHALL 해당 Parity_Result를 `matched=false`로 기록하고 부분 비교 결과를 산출하지 않으며 고정 코드 `parity_run_incomplete`를 반환한다.
10. WHEN Migration_Slice의 Rust_Component 산출물 식별자가 변경되면, THE Platform SHALL 해당 Migration_Slice의 연속 `matched` 계수를 0으로 초기화하고 Implementation_Selector 기본값을 파이썬 구현으로 되돌린다.
11. WHEN Implementation_Selector 기본값이 Rust_Component로 변경되면, THE Platform SHALL 근거가 된 3건 Parity_Result의 입력 식별자, Rust_Component 산출물 식별자, 변경 후 활성 구현을 Migration_Ledger에서 다시 읽어 기록하고, 읽기 확인 값이 근거 기록과 다르면 기본값을 파이썬 구현으로 되돌린다.

### 요구사항 3: 러스트 성능 주장 증거 규율

**User Story:** 운영자로서 성능 개선 주장이 보존된 측정 아티팩트로 뒷받침되기를 원한다. 그래야 근거 없는 속도 수치가 문서에 남지 않는다.

#### 수용 기준

1. WHEN Rust_Component 성능 개선 수치가 저장소 문서, 병합 후보 설명, 변경 로그 중 하나에 기재되면, THE Platform SHALL 해당 수치와 1:1로 대응하는 Performance_Evidence_Set 식별자를 같은 위치에 기록한다.
2. THE Performance_Evidence_Set SHALL 측정 단위와 임계값 수치를 가진 절대 예산, 표기 단위와 임계값 수치를 가진 기준선 대비 상대 예산, 절대 단위 수치를 가진 노이즈 예산, 비교 기준선(파이썬 구현) 측정 식별자, 정규 예산 입력이 해당 지표에 요구하는 최소 표본 수 이상의 실제 반복 측정 횟수(백엔드 지표의 경우 7회 이상), 해당 지표 키가 규정하는 요약 통계(백엔드 지표의 경우 p75), 측정 환경 프로파일 식별자를 각각 명시한다.
3. IF 성능 주장에 대응하는 원시 측정 아티팩트, 스코어러 출력, 검증기 출력, `apps/web/performance/*` 정규 예산 입력 참조 중 하나라도 조회되지 않거나 기록된 아티팩트 맵 해시와 일치하지 않으면, THEN THE Platform SHALL 해당 주장을 고정 코드 `performance_claim_not_established`로 표기한다.
4. WHEN 스코어링 실행이 완료되고 관측된 개선폭의 절대값이 해당 지표의 노이즈 예산 이하이면, THE Platform SHALL 결과를 `no_admitted_slice`로 기록하고 해당 실행을 실패 또는 재실행 필요로 표기하지 않는다.
5. THE Platform SHALL 성능 측정 시작 시점과 종료 시점의 동결 트리 식별자를 각각 커밋 식별자와 미변경 여부로 Performance_Evidence_Set에 기록한다.
6. THE Platform SHALL Rust_Component 원시 성능 측정 아티팩트를 `apps/web/performance/*` 정규 입력 경로 밖의 백엔드 전용 경로에만 보존하고 `apps/web/performance/*` 아래에는 어떤 Rust_Component 원시 아티팩트도 기록하지 않는다.
7. IF 병합 후보가 Performance_Evidence_Set 식별자 없는 성능 개선 수치를 포함하거나 `performance_claim_not_established`로 표기된 Performance_Evidence_Set을 참조하는 수치를 포함하면, THEN THE Platform SHALL 해당 병합 후보를 거부하고 고정 코드 `performance_claim_not_established`를 반환한다.
8. IF 측정 시작 시점과 종료 시점의 트리 식별자가 서로 다르거나 어느 한 시점이 미변경 상태가 아니면, THEN THE Platform SHALL 해당 Performance_Evidence_Set을 무효로 표기하고 대응하는 성능 주장을 고정 코드 `performance_claim_not_established`로 표기한다.
9. IF `apps/web/performance/*` 아래에서 Rust_Component 원시 측정 아티팩트가 발견되거나 백엔드 전용 성능 경로에서 정규 예산 입력 파일이 발견되면, THEN THE Platform SHALL 해당 Performance_Evidence_Set을 무효로 표기하고 고정 코드 `performance_evidence_path_violation`을 반환한다.

### 요구사항 4: 의존성 신선도 자동화

**User Story:** 개발자로서 프레임워크와 라이브러리가 지속적으로 최신 상태로 관리되기를 원한다. 그래야 수동 추적 없이 지속 가능한 운영을 유지한다.

#### 수용 기준

1. THE Dependency_Freshness_Workflow SHALL 갱신 대상을 `/apps/web` npm, `/backend` npm, `/backend/pipeline` pip, `/backend/restaurant-crawling/scripts` pip, `/backend/pipeline-control` pip, 저장소 루트 GitHub Actions의 6개 단위로 열거하고 단위별 갱신 후보를 서로 분리하여 생성한다.
2. THE Dependency_Freshness_Workflow SHALL 갱신 후보를 `develop` 브랜치를 대상으로 하는 풀 리퀘스트로만 생성하고, 단위당 동시 열림 후보를 5건 이하로 유지하며, 후보를 자동 병합하지 않고 직렬 PR 경로(`develop -> data -> main`)의 브랜치 보호와 사람 승인에 맡긴다.
3. WHEN Dependency_Freshness_Workflow가 갱신 후보를 생성하면, THE Dependency_Freshness_Workflow SHALL `apps/web`을 작업 디렉터리로 하여 `bun run lint`, `bun run test:unit`, `npm run typecheck:parity`, `npm run build` 4개 검사를 모두 실행하고 검사별 통과·실패 결과와 종료 시각을 해당 후보에 첨부한다.
4. IF 3항의 검사 중 하나라도 실패하거나, 검사 1건의 실행 시간이 30분을 초과하거나, 후보 1건에 4개 검사 결과가 모두 첨부되지 않으면, THEN THE Dependency_Freshness_Workflow SHALL 해당 후보를 병합 불가로 표시하고 고정 코드 `dependency_check_failed`를 기록하며 후보 내용을 자동으로 변경하지 않는다.
5. THE Dependency_Freshness_Workflow SHALL `.github/dependabot.yml`의 보류 항목(`next` `>=16.3.0`, `eslint` 메이저, `@types/node` 메이저, `typescript-eslint` `>8.63.0`)을 변경 없이 유지하고, 보류 해제를 `.github/dependabot.yml` 변경만 포함하는 별도 병합 후보로만 수행한다.
6. THE Dependency_Freshness_Workflow SHALL 1항의 각 단위에 대해 7일 이내 간격으로 실행되고, 실행마다 UTC 기준 실행 시각과 단위별 생성 후보 수를 저장소 소유 산출물에 기록한다.
7. WHEN Dependency_Freshness_Workflow가 메이저 버전 상승을 포함하는 갱신을 검출하면, THE Dependency_Freshness_Workflow SHALL 해당 상승을 마이너·패치 갱신과 같은 풀 리퀘스트에 포함하지 않고 패키지 1개당 1건의 단독 풀 리퀘스트로 생성한다.
8. THE Dependency_Freshness_Workflow SHALL 실행 로그, 풀 리퀘스트 본문, 3항 검사 결과 첨부, 6항 산출물에서 Forbidden_Log_Field를 제외하고 해당 값을 고정 대체 문자열로 치환한다.
9. WHERE Rust_Component 카고 매니페스트가 저장소에 존재하면, THE Dependency_Freshness_Workflow SHALL 해당 카고 의존성을 1항 열거에 7번째 단위로 추가하고 1항부터 8항까지의 후보 생성·검증 규칙을 동일하게 적용한다.
10. IF 갱신 후보의 대상 브랜치가 `develop`이 아니면, THEN THE Dependency_Freshness_Workflow SHALL 해당 후보를 병합 불가로 표시하고 고정 코드 `target_branch_violation`을 기록한다.
11. IF 갱신 후보가 5항 보류 항목의 보류 범위에 해당하는 버전 상승을 포함하면, THEN THE Dependency_Freshness_Workflow SHALL 해당 후보를 병합 불가로 표시하고 고정 코드 `dependency_hold_violation`을 기록한다.

### 요구사항 5: 툴체인 핀과 릴리스 패키지 권위 보호

**User Story:** 운영자로서 자동 갱신이 확정된 툴체인 핀을 깨지 않기를 원한다. 그래야 컴파일러 패리티와 릴리스 패키지 권위가 유지된다.

#### 수용 기준

1. THE Platform SHALL Pin_Contract를 `apps/web/package.json`, `apps/web/package-lock.json`, npm 정확히 11.6.2, Node 24.x(24.0.0 이상 25.0.0 미만), `@typescript/native` 별칭 정확히 `7.0.2`, 호환 브리지 TypeScript 정확히 `6.0.2`의 6개 항목으로 구성하고, 다른 잠금 파일과 값이 충돌할 때 `apps/web/package.json`과 `apps/web/package-lock.json`의 값을 릴리스 패키지 권위로 채택한다.
2. THE Platform SHALL `@typescript/native` 별칭을 정확히 `7.0.2`로, 호환 브리지 TypeScript를 정확히 `6.0.2`로 유지하고, 두 버전을 범위 지정자와 태그 없는 고정 문자열로 `apps/web/package.json` 선언 값과 `apps/web/package-lock.json` 해석 값에서 동일하게 유지한다.
3. IF 갱신 후보가 Pin_Contract 6개 항목 중 하나의 값을 변경하면, THEN THE Dependency_Freshness_Workflow SHALL 해당 후보를 병합 불가로 표시하고 고정 코드 `pin_contract_violation`을 기록하며 트리의 기존 핀 값을 변경하지 않는다.
4. WHEN 잠금 파일 비교 검사가 `bun.lock`과 `apps/web/package-lock.json` 사이의 해석 버전 불일치를 검출하면, THE Platform SHALL `apps/web/package-lock.json`을 권위로 삼아 `bun.lock`만 조정하고 `apps/web/package.json`과 `apps/web/package-lock.json`을 수정하지 않으며 불일치 패키지 이름 목록과 불일치 개수를 검사 결과에 기록한다.
5. THE Platform SHALL 타입 검사를 `npm run typecheck:parity` 스크립트로만 수행하고, 해당 스크립트가 사용하는 컴파일러를 저장소 소유 의존성 트리의 `@typescript/native` 별칭 `7.0.2`로만 해석하며 전역 컴파일러를 사용하지 않는다.
6. THE Platform SHALL Rust_Component 툴체인 버전을 저장소 소유 툴체인 파일에 메이저·마이너·패치 3자리 고정 문자열로 기록하고, 채널 별칭과 부동 범위 지정자를 사용하지 않으며 해당 버전을 Dependency_Freshness_Workflow 검사 대상에 포함한다.
7. WHEN 병합 후보가 제출되거나 Dependency_Freshness_Workflow가 실행되면, THE Platform SHALL Pin_Contract 6개 항목 각각의 선언 값과 해석 값을 검증하고 항목별 일치·불일치 결과를 저장소 소유 산출물에 기록한다.
8. IF Pin_Contract 항목의 선언 값과 해석 값이 다르면, THEN THE Platform SHALL 해당 검사를 실패로 종료하고 고정 코드 `pin_contract_drift`를 반환하며 어떤 핀 값도 자동으로 변경하지 않는다.
9. IF 타입 검사 실행에서 컴파일러가 저장소 소유 의존성 트리 외부 경로로 해석되면, THEN THE Platform SHALL 타입 검사를 실패로 종료하고 고정 코드 `global_compiler_not_admitted`를 반환하며 타입 검사 결과 산출물을 생성하지 않는다.

### 요구사항 6: 워크스페이스 레이아웃 재편

**User Story:** 개발자로서 워크스페이스 구조를 한눈에 파악하고 싶다. 그래야 어느 디렉터리가 무엇을 소유하는지 추측하지 않고 알 수 있다.

#### 수용 기준

1. THE Layout_Manifest SHALL 저장소가 추적하는 1단 디렉터리 전체와 2단 디렉터리 전체에 대해 각각 정확히 하나의 항목을 두고, 각 항목에 소유 책임 1개, 허용 내용 1개 이상, 금지 내용 1개 이상을 비어 있지 않은 값으로 기록한다.
2. THE Layout_Manifest SHALL `apps/web` 항목의 소유 책임을 Web_App 경계로, `backend` 항목의 소유 책임을 Backend_Runtime 경계로 기록하고, `apps/web` 항목의 금지 내용에 장시간 크롤러 실행, ffmpeg 처리, Gemini 대량 평가, GDrive 대량 업로드, 장시간 Supabase 배치 삽입의 소유를 포함한다.
3. THE Layout_Manifest SHALL `backend/pipeline-control/`을 컨테이너·설정 산출물(`Dockerfile`, `docker-compose*.yml`, `otel-collector.yaml`, `prometheus.yml`, `grafana/`, `metrics.v1.json`, `events.v1.json`) 소유 경로로, `backend/pipeline_control/`을 파이썬 모듈 소유 경로로 기록하고, 두 경로를 서로 다른 항목으로 유지하며 어느 한쪽을 다른 쪽의 별칭으로 기록하지 않는다.
4. WHEN 디렉터리 이동이 병합 후보로 제출되면, THE Platform SHALL 저장소 추적 트리에서 이동 전 경로의 일치 개수가 0이고 이동 후 경로의 일치 개수가 정확히 1인지 검사하고, 두 조건 중 하나라도 만족하지 않을 때 해당 후보를 거부하며 고정 코드 `directory_move_residual_path`를 반환한다.
5. IF 디렉터리 이동 후보가 이동 전 경로를 가리키는 별칭 디렉터리 또는 호환 심링크를 포함하면, THEN THE Platform SHALL 해당 후보를 거부하고 고정 코드 `alias_path_not_admitted`를 반환하며 트리를 변경하지 않는다.
6. IF 디렉터리 이동이 `backend/supabase/migrations/`의 적용된 마이그레이션 파일, `apps/web/app` 하위 공개 라우트 경로, 영속 데이터 경로 중 하나 이상을 대상으로 하면, THEN THE Platform SHALL 해당 이동을 거부하고 고정 코드 `immutable_path_move_rejected`를 반환하며 부분 이동 결과를 트리에 남기지 않는다.
7. WHEN 디렉터리 이동이 병합 후보로 제출되면, THE Platform SHALL `.github/workflows/` 워크플로 참조, `.github/dependabot.yml` 갱신 디렉터리 경로, `docker-compose*.yml` 볼륨 경로, `backend/config/channels.yaml` 상대 경로를 각각 해석하고 미해석 참조 개수를 후보 검사 결과에 기록한다.
8. THE Layout_Manifest SHALL 각 디렉터리 항목에 소스, 빌드 산출물, 로컬 임시 중 정확히 하나의 분류를 부여하고, 빌드 산출물 항목과 로컬 임시 항목에는 버전 관리 추적 제외 여부를 함께 기록한다.
9. IF 트리에 존재하는 1단 또는 2단 디렉터리에 대응하는 Layout_Manifest 항목이 없거나 Layout_Manifest 항목에 대응하는 디렉터리가 트리에 없으면, THEN THE Platform SHALL 해당 병합 후보를 거부하고 고정 코드 `layout_manifest_missing_entry`를 반환한다.
10. IF 7항 검사의 미해석 참조 개수가 1건 이상이면, THEN THE Platform SHALL 해당 병합 후보를 거부하고 고정 코드 `stale_path_reference`를 반환한다.
11. IF 병합 후보가 `backend/pipeline-control/`에 파이썬 임포트 모듈을 추가하거나 `backend/pipeline_control/`에 컨테이너·설정 산출물을 추가하면, THEN THE Platform SHALL 해당 후보를 거부하고 고정 코드 `directory_ownership_violation`을 반환한다.

### 요구사항 7: 명명 리팩터 원장

**User Story:** 개발자로서 폴더·파일·함수·메소드 이름이 직관적이기를 원한다. 그래야 이후 유지보수에서 이름만 보고 책임을 알 수 있다.

#### 수용 기준

1. THE Rename_Ledger SHALL `backend/naming-renames.v1.json` 형식에 따라 각 명명 변경 항목의 이전 이름, 새 이름, 근거, 계약 분류, 검증 내역 다섯 필드를 모두 비어 있지 않은 값으로 기록하고, 원장 수준에서 스키마 버전 `1`과 비목표 목록(공개 라우트·API 이름 변경, 적용된 마이그레이션 이름 변경, 영속 데이터 경로 이름 변경, 별칭·호환 래퍼, 광범위한 번호 스크립트 변경)을 기록한다.
2. THE Rename_Ledger SHALL 각 항목의 계약 분류로 내부 경로, 러너 계약, 테스트 로더 계약, 운영자 CLI 계약, 회귀 픽스처 계약 다섯 값으로 구성된 닫힌 집합에서 1개 이상을 기록하고, 이 집합 밖의 값을 기록하지 않는다.
3. THE Platform SHALL 명명 변경에서 별칭 함수, 호환 래퍼, 재수출 셰임, 이전 이름을 새 이름으로 위임하는 내보내기를 생성하지 않고, 적용 후 이전 이름으로 도달 가능한 진입점이 0건인 상태를 유지한다.
4. IF 명명 변경 후보가 공개 라우트 경로, 공개 API 응답 필드 이름, 적용된 Supabase 마이그레이션 객체 이름, Supabase RPC 이름, 영속 데이터 경로 중 하나를 대상으로 하면, THEN THE Platform SHALL 해당 후보를 거부하고 고정 코드 `rename_scope_violation`을 반환하며 트리를 변경하지 않는다.
5. THE Platform SHALL `privacy_policy_versions`, `privacy_onboarding_challenges`, `privacy_age_profiles`, `privacy_guardian_verifications`, `privacy_consent_events`, `privacy_consent_state`, `privacy_audit_events` 객체 이름과 `get_current_privacy_policy_version`, `create_privacy_onboarding_challenge`, `confirm_privacy_onboarding`, `submit_privacy_consent`, `record_privacy_guardian_verification` RPC 이름을 명명 변경 대상에서 제외하고, 이 이름들에 대한 대체 별칭을 생성하지 않는다.
6. WHEN 명명 변경이 적용되면, THE Platform SHALL `.local-archive/`를 제외한 첫 번째 당사자 트리에서 이전 이름 참조가 0건인지와 새 이름 정의가 정확히 1건인지 검사한다.
7. THE Platform SHALL 명명 변경마다 변경된 이름을 임포트·로드·호출하는 기존 단위 테스트 스위트를 실행하고, 실패 0건일 때에만 이전 이름 부재 확인, 새 이름 유일성 확인, 스위트 식별자·통과 개수·스킵 개수를 포함한 테스트 실행 결과의 최소 3개 검증 항목을 Rename_Ledger 검증 내역에 기록한다.
8. IF 명명 변경 후보가 5항의 객체 이름 또는 RPC 이름을 대상으로 하거나 그 이름에 대한 대체 별칭을 추가하면, THEN THE Platform SHALL 해당 후보를 거부하고 고정 코드 `privacy_contract_violation`을 반환하며 트리와 Rename_Ledger를 변경하지 않는다.
9. IF 6항 검사에서 이전 이름 참조가 1건 이상이거나 새 이름 정의가 정확히 1건이 아니면, THEN THE Platform SHALL 해당 명명 변경을 적용 전 상태로 되돌리고 고정 코드 `rename_verification_failed`를 반환하며 Rename_Ledger 항목을 기록하지 않는다.
10. IF 7항의 단위 테스트 실행에서 실패가 1건 이상이거나 대상 스위트가 실행되지 않으면, THEN THE Platform SHALL 해당 명명 변경을 거부하고 고정 코드 `rename_test_failure`를 반환하며 Rename_Ledger 항목을 기록하지 않는다.

### 요구사항 8: macOS 로컬 우선 크롤러 파이프라인

**User Story:** 운영자로서 크롤러 데이터 파이프라인 전체를 로컬 맥에서 돌리고 싶다. 그래야 Supabase Free 플랜 사용량 제약에 걸리지 않는다.

#### 수용 기준

1. WHEN macOS 로컬 환경에서 `python3 -m backend.pipeline_control.worker` 계열 워커 진입점이 `heavy_local` 컴퓨트 프로파일과 `local_db` 데이터 싱크로 호출되면, THE Backend_Runtime SHALL 크롤링, 평가, 미디어 처리, 삽입 4개 단계 부류를 모두 실행 대상으로 편성하고 각 단계에 성공, 실패, 건너뜀 중 정확히 하나의 종료 상태를 부여한다.
2. WHILE 데이터 싱크가 `local_db`이면, THE Backend_Runtime SHALL 파이프라인 쓰기를 Local_Database로만 수행하고 해당 실행 전체의 Hosted_Database 쓰기 요청 수를 0으로 유지한다.
3. IF 데이터 싱크가 `hosted_apply`로 요청되면, THEN THE Backend_Runtime SHALL 고정 코드 `hosted_apply_not_admitted`를 반환하고 어떤 단계도 시작하지 않으며 Local_Database와 Hosted_Database 상태를 요청 이전과 동일하게 유지한다.
4. WHEN 로컬 실행이 종료되면, THE Backend_Runtime SHALL 해당 실행에서 발생한 Hosted_Database 읽기 요청 수와 쓰기 요청 수를 각각 0 이상의 정수로 실행 요약에 기록하고 요약에서 Forbidden_Log_Field를 제외한다.
5. WHEN 로컬 실행이 종료되면, THE Backend_Runtime SHALL 성공 단계 이름 목록, 실패 단계 이름 목록, 건너뛴 단계 이름 목록과 각 건너뜀 항목의 사유 코드를 실행 요약에 기록하고 사유 코드를 고정 코드 집합으로 제한한다.
6. THE Backend_Runtime SHALL 로컬 실행 진입점을 `python3 -m backend.pipeline_control.worker` 계열 워커 진입점으로만 제공하고 Route_Handler_Boundary를 진입점으로 사용하지 않는다.
7. THE Platform SHALL macOS 로컬 환경에서 파이프라인 실행에 필요한 각 도구를 도구 이름, 사람 입력 없이 실행되는 설치 확인 명령, 해당 명령의 부재 판정 기준의 3개 항목과 함께 문서화한다.
8. IF `python backend/bin/check_env_contract.py --profile daily` 검사에서 필수 운영자 시크릿 중 하나라도 부재로 판정되면, THEN THE Backend_Runtime SHALL 실패 결과를 반환하고 부재로 판정된 환경 변수 이름만 보고하며 대체값과 자리표시자 값을 생성하지 않는다.
9. IF `heavy_local` 컴퓨트 프로파일 실행에 필요한 로컬 도구 중 하나라도 확인 명령에서 부재로 판정되면, THEN THE Backend_Runtime SHALL 첫 단계 실행 전에 실행을 중단하고 고정 코드 `heavy_local_runtime_missing`을 반환한다.
10. IF 필수 단계가 실패하면, THEN THE Backend_Runtime SHALL 해당 단계에 의존하는 후속 단계를 건너뜀으로 표기하고 실행 요약의 최종 상태를 실패로 기록하며 실패한 단계의 쓰기를 Local_Database에 확정하지 않는다.
11. WHILE 데이터 싱크가 `local_db`이면, IF 파이프라인 단계가 Hosted_Database 쓰기를 시도하면, THEN THE Backend_Runtime SHALL 해당 실행을 고정 코드 `supabase_data_boundary_rejected`로 종료하고 공급자 진단 정보와 데이터베이스 오류 문자열을 응답에서 제외한다.

### 요구사항 9: 로컬 DB 스키마 미러링

**User Story:** 운영자로서 로컬 DB가 호스티드 DB와 같은 스키마를 갖기를 원한다. 그래야 로컬에서 검증한 동작이 호스티드에서도 같은 형태로 성립한다.

#### 수용 기준

1. THE Platform SHALL Local_Database 스키마를 `backend/supabase/migrations/`의 전체 마이그레이션 항목(현재 85개)을 파일명 오름차순으로 빠짐없이 적용한 결과로만 구성하고, 마이그레이션 파일에 대응하지 않는 수동 DDL로 Local_Database 스키마를 변경하지 않는다.
2. IF 적용된 Supabase 마이그레이션 파일의 내용 또는 파일명 변경이 요청되면, THEN THE Platform SHALL 해당 변경을 거부하고 고정 코드 `applied_migration_immutable`을 반환하며 교정을 새 마이그레이션 파일 추가로만 허용한다.
3. WHEN Schema_Mirror_Report가 생성되면, THE Schema_Mirror_Report SHALL Local_Database에만 있는 테이블, Hosted_Database에만 있는 테이블, 양쪽에 있으나 컬럼 집합이 다른 테이블, 양쪽에 있으나 제약이 다른 테이블, RPC 이름 차이의 5개 부류를 각각 열거하고, 각 항목에 스키마 이름, 객체 이름, 차이 분류를 포함하며, 항목이 없는 부류도 건수 0으로 기록한다.
4. IF Schema_Mirror_Report에 Hosted_Database에만 존재하는 테이블·컬럼·제약·RPC 항목이 1건 이상 나타나거나 Local_Database에만 존재하는 테이블이 Local_Only_Schema에 열거되어 있지 않으면, THEN THE Platform SHALL 해당 항목을 미러링 결함으로 표기하고 고정 코드 `schema_mirror_defect`를 반환하며 미러링 판정을 실패로 기록한다.
5. WHERE 테이블이 Local_Only_Schema에 속하면, THE Schema_Mirror_Report SHALL 해당 테이블을 운영자 승인 참조와 함께 승인된 로컬 전용 항목으로 표기하고 미러링 결함으로 취급하지 않는다.
6. THE Platform SHALL Local_Only_Schema와 Publication_Set에 함께 열거된 테이블 수를 0으로 유지하고 해당 교집합 검사 건수를 Schema_Mirror_Report에 기록한다.
7. THE Platform SHALL Local_Database 접근을 브라우저용 `apps/web/integrations/supabase/client.ts`, 세션 인식 서버용 `apps/web/lib/supabase/server.ts`, 권한 상승 서버 전용 `apps/web/lib/supabase/service-role.ts`의 세 진입점으로만 수행하여 Hosted_Database와 동일한 진입점 구분을 유지하고 네 번째 진입점이나 직접 연결 경로를 추가하지 않는다.
8. THE Platform SHALL Local_Database 시드 픽스처의 모든 레코드에 `LOCAL_TEST_ONLY:NOT_PRODUCTION` 표기를 유지하고 해당 표기를 가진 레코드를 Publication_Set 게시 입력에서 제외한다.
9. WHEN Local_Database에 마이그레이션 적용이 완료되면, THE Platform SHALL 동일 실행 안에서 Schema_Mirror_Report를 생성하고 비교를 위한 Hosted_Database 접근을 스키마 읽기 조회로만 수행한다.
10. IF Hosted_Database 스키마 읽기 조회가 실패하거나 완료되지 않으면, THEN THE Platform SHALL 고정 코드 `hosted_schema_read_unavailable`을 반환하고 Schema_Mirror_Report를 미완성으로 표기하며 미러링 판정을 통과로 기록하지 않는다.
11. IF `LOCAL_TEST_ONLY:NOT_PRODUCTION` 표기가 없는 시드 픽스처의 Local_Database 적재가 요청되면, THEN THE Platform SHALL 어떤 행도 적재하지 않고 고정 코드 `seed_fixture_marker_missing`을 반환한다.

### 요구사항 10: 게시 대상 집합과 로컬-호스티드 동기화

**User Story:** 운영자로서 로컬에서 만든 데이터 중 정해진 테이블만 주기적으로 호스티드 DB로 올리고 싶다. 그래야 호스티드 사용량을 통제하면서 서비스 데이터를 갱신할 수 있다.

#### 수용 기준

1. THE Publication_Set SHALL 게시 대상 테이블 이름, 각 테이블의 게시 대상 컬럼 이름, 각 테이블의 행 식별 키 컬럼 집합, 운영자 승인 참조를 명시적으로 열거하고 와일드카드 표기를 사용하지 않는다.
2. THE Publish_Worker SHALL Publication_Set에 열거되지 않은 테이블과 컬럼을 게시 대상에서 제외하고 Hosted_Database의 해당 컬럼 값을 게시 이전 값과 동일하게 유지한다.
3. IF 게시 요청이 Publication_Set에 열거되지 않은 테이블 또는 컬럼을 하나라도 포함하면, THEN THE Publish_Worker SHALL 고정 코드 `publication_target_not_admitted`를 반환하고 어떤 행도 적용하지 않으며 Hosted_Database 상태를 요청 이전과 동일하게 유지한다.
4. WHEN 게시가 요청되면, THE Publish_Worker SHALL 대상 테이블별 삽입 예정 행 수, 갱신 예정 행 수, 총 대상 행 수와 행 식별 키·게시 대상 컬럼 값에서 결정적으로 산출한 안정적 해시를 포함하는 Publish_Preview를 생성하고, 동일 입력 집합에 대해 동일한 해시를, 값이 하나라도 다른 입력 집합에 대해 다른 해시를 산출한다.
5. WHEN 확인 단계 요청이 접수되면, THE Publish_Worker SHALL 제시된 해시가 Publish_Preview 해시와 같고 Publish_Preview 생성 후 경과 시간이 900초 이하인 경우에만 적용 단계를 시작한다.
6. IF 확인 단계에서 제시된 해시가 Publish_Preview 해시와 다르거나 Publish_Preview 생성 후 900초를 초과했으면, THEN THE Publish_Worker SHALL 해시 불일치에 대해 고정 코드 `preview_hash_mismatch`를, 유효 기간 초과에 대해 고정 코드 `preview_expired`를 반환하고 어떤 행도 적용하지 않는다.
7. WHEN 적용이 완료되면, THE Publish_Worker SHALL 적용된 모든 행 식별 키에 대해 Publish_Readback을 수행하고 테이블별 읽어온 행 수, 일치 행 수, 불일치 행 수를 기록한다.
8. THE Publish_Worker SHALL 단일 게시 작업 식별자 아래에 미리보기, 확인, 적용, 읽기 검증 각 단계의 시각, 대상 테이블 이름, 테이블별 행 수, 종료 고정 코드를 추가 전용 감사 기록에 남기고 기록된 항목을 수정하거나 삭제하지 않으며 해당 기록에서 Forbidden_Log_Field를 제외한다.
9. THE Publish_Worker SHALL 1회 적용 호출당 행 수를 200행 이하로 제한하고, 200행을 초과하는 입력을 200행 이하의 순차 배치로 분할하며, 단일 호출 행 수가 200행을 초과하면 고정 코드 `batch_upsert_limit`을 반환하고 해당 호출의 어떤 행도 적용하지 않는다.
10. THE Publish_Worker SHALL 게시의 적용 단계와 읽기 검증 단계를 Backend_Runtime 워커 프로세스에서 실행하고 Route_Handler_Boundary에서 실행하지 않는다.
11. FOR ALL 게시 입력 집합에 대해, 동일 입력 집합을 200행 이하 배치로 2회 연속 적용한 후 Hosted_Database의 행 식별 키별 Publication_Set 컬럼 값과 대상 테이블 행 수 SHALL 1회 적용한 후의 값과 행 수와 동일하다. (속성 기반 검증 후보)
12. FOR ALL 게시 입력 집합에 대해, 게시 후 Publish_Readback 결과의 행 식별 키별 Publication_Set 열거 컬럼 값 SHALL Local_Database 원본의 동일 행 식별 키 값과 동일하다. (속성 기반 검증 후보)
13. IF 게시가 실패하면, THEN THE Publish_Worker SHALL `publication_target_not_admitted`, `preview_hash_mismatch`, `preview_expired`, `batch_upsert_limit`, `publish_readback_mismatch`, `publish_apply_aborted`, `publish_schedule_not_approved`로 한정된 고정 코드 집합 중 하나만 반환하고 공급자 진단 정보, 데이터베이스 오류 문자열, 자유 형식 오류 문자열을 응답에서 제외한다.
14. THE Platform SHALL 게시 주기를 운영자 승인된 일정 값에서만 읽고 코드에서 주기 값을 생성하거나 기본값으로 대체하지 않는다.
15. IF Publish_Readback 결과가 적용 요청의 행 식별 키 또는 게시 대상 컬럼 값과 하나라도 다르면, THEN THE Publish_Worker SHALL 고정 코드 `publish_readback_mismatch`를 반환하고 해당 게시 작업을 성공으로 표기하지 않으며 불일치 테이블 이름과 불일치 행 수를 감사 기록에 남긴다.
16. IF 하나의 적용 배치가 실패하면, THEN THE Publish_Worker SHALL 후속 배치를 시작하지 않고 고정 코드 `publish_apply_aborted`를 반환하며 적용 완료 배치 수와 미적용 배치 수를 감사 기록에 남기고 새 Publish_Preview 생성 없이 적용을 재개하지 않는다.
17. IF 운영자 승인된 게시 일정 값이 부재하면, THEN THE Publish_Worker SHALL 게시 미리보기와 적용을 시작하지 않고 고정 코드 `publish_schedule_not_approved`를 반환한다.

### 요구사항 11: 운영 도구 조사와 선정 기록

**User Story:** 운영자로서 도입할 운영 도구가 우리 서비스 실정에 맞는 근거로 선택되기를 원한다. 그래야 도구가 유지 부담만 늘리는 상황을 피할 수 있다.

#### 수용 기준

1. THE Tooling_Selection_Record SHALL 컨테이너 레지스트리, 이미지 레지스트리 주소 체계, 배포 도구, 대시보드 도구, 메시지 브로커, 브로커 관리 UI, 서비스 메시, 검색·로그 저장소, 로그 수집기, 패키지 매니저 차트(Helm), IaC 도구의 11개 범주를 모두 열거하고 각 범주마다 서로 구별되는 후보를 2개 이상 6개 이하로 기록하며 후보마다 고유 식별자를 부여한다.
2. THE Tooling_Selection_Record SHALL 각 후보에 대해 macOS 로컬 설치 성공 여부 불리언과 설치 확인 명령 및 그 관측 결과, 동일 macOS 워크스테이션에서 요청 부하 없이 기동 후 300초 시점의 상주 메모리를 MiB 단위 정수로, 유료 이전 시 대상 형태와 미해결 항목 목록, 대체가 필요한 기존 트리 파일 경로 개수, 상시 실행 프로세스 개수와 버전 갱신 주기와 장애 복구에 필요한 운영자 수동 조치 단계 수를 기록한다.
3. THE Tooling_Selection_Record SHALL 각 후보에 대해 이미지 태그 또는 패키지 버전 문자열을 정확히 하나 기록하고 `latest`, 부동 태그, 버전 범위 표기를 기록 값으로 사용하지 않는다.
4. THE Tooling_Selection_Record SHALL 각 범주의 선정 결과마다 승인자 이름, 승인 일시, 대상 범주 이름, 선정된 후보 식별자, 승인 상태(승인·보류·거부 중 하나)를 포함하는 운영자 승인 참조를 기록한다.
5. IF 도구 범주에 승인 상태가 승인인 운영자 승인 참조가 없으면, THEN THE Platform SHALL 해당 범주의 도구를 기본 실행 대상에서 제외하고 고정 코드 `tooling_approval_missing`을 반환하며 해당 범주 서비스를 부분 기동하지 않는다.
6. THE Tooling_Selection_Record SHALL `backend/pipeline-control/docker-compose.observability.yml`이 고정한 `otel/opentelemetry-collector:0.120.0`, `prom/prometheus:v3.2.1`, `grafana/grafana:11.5.2`, 그리고 `backend/pipeline-control/docker-compose.kafka.yml`, `backend/pipeline-control/docker-compose.elasticsearch.yml`, `backend/pipeline-control/harbor-tags.md`의 `harbor.local/tzudong/pipeline-api`·`harbor.local/tzudong/pipeline-worker` 태그 규약을 현행 자산으로 열거하고 각 자산마다 유지·대체·폐기 중 하나의 결정, 대체 시 대체 후보 식별자, 되돌림 절차를 기록한다.
7. THE Tooling_Selection_Record SHALL 채택하지 않은 후보마다 2항의 평가 항목 중 하나 이상을 인용한 미채택 사유와 그 항목의 측정값을 기록하고 측정값 없는 서술만으로 미채택 사유를 기록하지 않는다.
8. IF 특정 범주에 macOS 로컬 설치 성공 여부가 참인 후보가 하나도 없으면, THEN THE Platform SHALL 해당 범주를 미해결 항목으로 기록하고 기본 실행 대상에서 제외하며 고정 코드 `local_install_unverified`를 반환한다.
9. WHEN Tooling_Selection_Record가 검토 후보로 제출되면, THE Platform SHALL 11개 범주의 존재 여부, 각 범주의 후보 개수, 기록된 이미지 태그와 컴포즈 파일 경로가 현재 트리에서 해석되는지를 검사하고 불일치 항목이 하나 이상이면 후보를 거부하고 고정 코드 `tooling_record_mismatch`를 반환한다.
10. THE Tooling_Selection_Record SHALL 자격증명 값, 토큰 값, 레지스트리 접속 비밀, Forbidden_Log_Field 값을 포함하지 않는다.

### 요구사항 12: 로컬 macOS 운영 스택 상호연동

**User Story:** 개발자로서 운영 도구들이 로컬 맥에서 먼저 뜨고 서로 연결되기를 원한다. 그래야 클라우드 비용 없이 전체 운영 흐름을 검증할 수 있다.

#### 수용 기준

1. WHEN 운영자가 macOS 로컬 환경에서 Observability_Stack 기동 명령을 1회 실행하면, THE Observability_Stack SHALL 수집기 서비스, 지표 저장 서비스, 대시보드 서비스 각각에 대해 준비 점검을 개별 수행하고 서비스당 최대 120초까지 5초 간격으로 재점검한다.
2. THE Observability_Stack SHALL 모든 서비스의 호스트 포트 공개를 `127.0.0.1` 루프백 주소로만 선언하고 `0.0.0.0`, `::`, 사설망 주소, 공개 주소로의 공개 선언을 포함하지 않는다.
3. IF 서비스 설정이 `127.0.0.1` 외 인터페이스 바인딩을 요청하면, THEN THE Observability_Stack SHALL 어떤 서비스도 기동하지 않은 상태로 기동을 중단하고 고정 코드 `non_loopback_bind_rejected`를 반환한다.
4. WHEN Backend_Runtime이 메트릭 1건을 내보내면, THE Observability_Stack SHALL 해당 메트릭을 수집기에서 수용하고 수용 시각으로부터 60초 이내에 대시보드 조회 결과에 노출한다.
5. THE Observability_Stack SHALL `backend/pipeline-control/metrics.v1.json`이 열거한 카운터 4개, 추가 카운터 1개, 게이지 8개를 누락 없이 전부 대시보드 조회 대상으로 노출한다.
6. WHERE 메시지 브로커 구성요소가 기동된 상태이면, THE Observability_Stack SHALL `backend/pipeline-control/metrics.v1.json`이 열거한 브로커 지연 지표와 큐 적체 지표를 대시보드에 노출한다.
7. THE Observability_Stack SHALL 대시보드 도구의 익명 인증과 자체 가입을 비활성 상태로 유지하고 관리자 자격증명을 환경 변수에서만 읽으며 트리 내 파일, 이미지 레이어, 설정 리터럴에서 읽지 않는다.
8. IF 대시보드 관리자 자격증명 환경 변수가 부재하거나 빈 값이면, THEN THE Observability_Stack SHALL 대시보드 서비스를 기동하지 않고 고정 코드 `dashboard_credential_missing`을 반환하며 기본값 또는 임시 자격증명을 생성하지 않는다.
9. WHEN Observability_Stack 기동 절차가 종료되면, THE Observability_Stack SHALL 서비스별 이름, 참조 이미지 태그, 준비 상태(`ready` 또는 `not_ready`), 준비까지 경과 초를 기동 결과 산출물에 기록하고 해당 산출물에서 Forbidden_Log_Field를 제외한다.
10. THE Observability_Stack SHALL 컨테이너 이미지를 `otel/opentelemetry-collector:0.120.0`, `prom/prometheus:v3.2.1`, `grafana/grafana:11.5.2` 고정 태그로만 참조하고 `latest`, 태그 없는 참조, 이동 가능한 별칭 태그를 사용하지 않는다.
11. IF Observability_Stack 기동 요청이 로컬 도커 컨텍스트가 아닌 원격 컨텍스트를 대상으로 하면, THEN THE Platform SHALL 기동을 거부하고 고정 코드 `remote_context_rejected`를 반환한다.
12. THE Observability_Stack SHALL 대시보드 iframe 임베딩 허용 오리진을 운영자 승인 목록에 열거된 로컬 루프백 관리자 오리진으로만 제한하고 목록 외 오리진, 비루프백 오리진, 와일드카드 오리진의 프레임 삽입을 차단한다.
13. IF 어느 서비스가 기동 후 120초 내에 준비 상태에 도달하지 못하면, THEN THE Observability_Stack SHALL 기동 결과를 실패로 표시하고 고정 코드 `service_readiness_timeout`과 미준비 서비스 이름 목록을 반환한다.
14. IF 5항이 열거한 지표 중 하나라도 대시보드 조회 결과에서 부재하면, THEN THE Observability_Stack SHALL 고정 코드 `metrics_contract_incomplete`와 부재 지표 이름 목록을 반환한다.
15. IF 메시지 브로커 구성요소 또는 로그 검색 구성요소가 미기동 상태이면, THEN THE Observability_Stack SHALL 나머지 서비스의 기동 결과를 성공으로 유지하고 해당 지표 패널을 데이터 없음 상태로 표시하며 기동 결과 산출물에 미기동 사유 코드를 기록한다.

### 요구사항 13: 중앙 운영 로그 관리와 레다크션 불변식

**User Story:** 운영자로서 서비스 전체 운영 로그를 한 곳에서 조회하고 싶다. 그래야 문제 발생 시 어느 구성요소에서 무슨 일이 있었는지 추적할 수 있다.

#### 수용 기준

1. THE Log_Pipeline SHALL Web_App 서버 로그, Backend_Runtime 파이프라인 로그, Publish_Worker 로그, Observability_Stack 구성요소 로그, Ops_Agent 조치 로그를 수집 대상으로 다루고, 각 레코드에 이 5개 구성요소 식별자 값 중 정확히 1개를 부여하여 단일 조회 경로에서 구성요소 식별자별로 조회 가능하게 한다.
2. THE Log_Pipeline SHALL 각 로그 레코드에 열거된 구성요소 식별자 1개, UTC 기준 밀리초 이상 해상도의 발생 시각 1개, 상관 식별자 1개, 열거된 심각도 값(`debug`, `info`, `warn`, `error`) 중 1개를 필수 필드로 포함한다.
3. THE Log_Pipeline SHALL 모든 로그 레코드를 Log_Sink 기록 전에 Redaction_Boundary(`backend/utils/privacy_log.py`, `apps/web/lib/privacy/sanitize.ts`)를 통과시키고, Redaction_Boundary를 통과하지 않은 레코드를 Log_Sink로 전달하지 않는다.
4. THE Log_Pipeline SHALL 로그 레코드 클래스별로 명시적으로 열거된 필드 허용목록을 적용하여 허용목록에 있는 키만 Log_Sink로 전달하고 나머지 키를 전달 전에 제거하며, 클래스가 열거된 클래스 집합에 없는 레코드를 Log_Sink로 전달하지 않는다.
5. IF 로그 레코드가 Forbidden_Log_Field를 포함하면, THEN THE Log_Pipeline SHALL 해당 값을 원본 값의 부분 문자열·길이·해시를 포함하지 않는 고정 대체 표시로 치환한 후 기록하고, 동일한 값 부류에 대해 항상 동일한 대체 표시를 사용한다.
6. FOR ALL 로그 레코드 입력(중첩 깊이 상한 초과 구조, 순환 참조, 직렬화 불가 객체, 빈 레코드, 널 값을 포함한다)에 대해, Log_Sink에 도달한 레코드 SHALL Forbidden_Log_Field 값을 포함하지 않는다. (속성 기반 검증 후보)
7. FOR ALL 로그 레코드 입력에 대해, Log_Pipeline 출력의 키 집합 SHALL 해당 레코드 클래스에 열거된 필드 허용목록의 부분집합이다. (속성 기반 검증 후보)
8. THE Log_Pipeline SHALL 각 문자열 값을 최대 4,096자, 레코드당 항목 수를 최대 100개, 중첩 깊이를 최대 8단계, 직렬화된 레코드 크기를 최대 65,536바이트로 제한하고 상한 초과분을 고정 절단 표시로 대체한다.
9. THE Log_Pipeline SHALL 예외 정보를 최대 128자로 절단된 예외 타입 이름으로만 기록하고 예외 메시지와 스택 문자열을 Log_Sink로 전달하지 않는다.
10. WHERE Log_Sink가 검색 저장소이면, THE Log_Pipeline SHALL 데이터 환경이 Local_Database 환경일 때만 전달을 허용하고 저장소 URL 스킴을 `http` 또는 `https`로, 호스트를 승인된 로컬 호스트 집합(`127.0.0.1`, `localhost`, `::1`, `elasticsearch`)으로 제한하며, 그 외 입력에 고정 코드 `es_url_host_rejected`를 반환하고 전달을 수행하지 않는다.
11. THE Log_Pipeline SHALL 작업 상태 판정과 재실행 결정을 Local_Database 또는 Hosted_Database 조회 결과로만 수행하고, Log_Sink 조회 결과를 작업 상태 판정 입력으로 사용하지 않으며, Log_Sink 전달 실패 또는 조회 불가 상태에서도 작업 상태 조회와 작업 처리를 계속 수행한다.
12. THE Log_Pipeline SHALL 로그 보존 기간과 법적 근거를 활성 상태인 운영자 승인 보존 분류에서만 읽고, 코드 내부에 기간 값을 정의하거나 기본 기간을 생성하지 않는다.
13. WHEN Log_Sink 전달이 실패하면, THE Log_Pipeline SHALL 미전달 레코드를 보류 큐에 유지하고, 전달 성공 확인 후에만 큐에서 제거하고, 레코드별 재시도 횟수를 기록하고, 1회 재시도 배치를 최대 50건으로 제한하고, 점유 후 30초가 지난 미확인 레코드를 재시도 대상으로 되돌리고, 동일 레코드 식별자의 재전달이 Log_Sink에 중복 레코드를 생성하지 않게 한다.
14. IF 로그 레코드에 구성요소 식별자, 발생 시각, 상관 식별자, 심각도 중 하나라도 없거나 심각도가 열거된 값에 없으면, THEN THE Log_Pipeline SHALL 해당 레코드를 Log_Sink로 전달하지 않고 고정 오류 코드를 반환한다.
15. IF Redaction_Boundary 처리가 예외로 종료되거나 결과가 불안전 표시를 포함하면, THEN THE Log_Pipeline SHALL 해당 레코드를 Log_Sink로 전달하지 않고 예외 타입 이름과 고정 오류 코드만 기록한다.
16. IF 활성 상태인 운영자 승인 보존 분류가 없으면, THEN THE Log_Pipeline SHALL 로그 보존·만료·삭제 작업을 수행하지 않고 고정 오류 코드를 반환하며 기본 보존 기간을 적용하지 않는다.

### 요구사항 14: 유료 클라우드와 멀티 클러스터 이전 준비

**User Story:** 운영자로서 나중에 유료 클라우드·VPS·관리형 DB로 옮기기 좋은 상태를 유지하고 싶다. 그래야 이전 시점에 구조를 다시 만들지 않는다.

#### 수용 기준

1. THE Migration_Readiness_Manifest SHALL Web_App, Backend_Runtime, Local_Stack, Observability_Stack, Log_Pipeline 다섯 구성요소 각각에 대해 로컬 실행 설정 항목, 이전 대상 설정 항목, 외부화가 필요한 값 목록을 기록하고 외부화 대상 값을 참조 이름으로만 기록한다.
2. THE Deployment_Descriptor_Set SHALL 1항에 열거된 각 구성요소 정의마다 이미지 참조, 리소스 요청 값, 환경 변수 이름과 출처 참조, 시크릿 참조 이름의 네 항목을 모두 포함하고 네 항목 중 어느 항목도 빈 상태로 두지 않는다.
3. THE Deployment_Descriptor_Set SHALL 자격증명 값, 토큰 값, 접속 문자열의 비밀 구성요소를 파일 내용에서 제외하고 해당 값을 외부 시크릿 참조 이름으로만 지시한다.
4. IF Deployment_Descriptor_Set 파일에서 자격증명 값 리터럴 또는 토큰 값 리터럴이 1건 이상 검출되면, THEN THE Platform SHALL 검사를 실패로 반환하고 고정 코드 `secret_value_in_descriptor`를 반환하며 렌더링 산출물을 생성하지 않는다.
5. THE Deployment_Descriptor_Set SHALL 클러스터 식별자를 렌더링 매개변수로 받아 서로 다른 2개 이상의 클러스터 식별자에 대해 동일한 정의 원본 파일 집합을 재사용하고 렌더링 결과의 차이를 클러스터 식별자에서 파생된 필드로만 한정한다.
6. WHEN Deployment_Descriptor_Set 검사가 클러스터 식별자 매개변수와 함께 요청되면, THE Platform SHALL 정의를 로컬 렌더링 산출물로만 생성하고 원격 대상 적용 시도 건수 0을 검사 요약에 기록한다.
7. IF Deployment_Descriptor_Set 검사가 원격 클러스터 자격증명 또는 원격 적용 권한을 요구하면, THEN THE Platform SHALL 검사를 거부하고 고정 코드 `remote_apply_not_admitted`만 반환하며 부분 렌더링 산출물을 남기지 않는다.
8. THE Migration_Readiness_Manifest SHALL Hosted_Database 이전에 필요한 백업 증거 항목과 시점 복구 증거 항목을 각각 열거하고 각 항목에 증거 종류, 확인 주체, 상태 값을 기록하며 외부 증거 참조가 기록되기 전까지 상태를 `unresolved`로 유지한다.
9. THE Platform SHALL Vercel 관련 동작 실행 전에 Git 연동된 `tzudong` 프로젝트 식별자와 연동 저장소 참조를 확인하고 확인된 식별자를 동작 기록에 리드백으로 남긴다.
10. IF Vercel 관련 동작 요청의 프로젝트 식별자가 Git 연동된 `tzudong` 프로젝트로 확인되지 않거나 `web` 프로젝트를 지시하면, THEN THE Platform SHALL 해당 동작을 수행하지 않고 고정 코드 `vercel_project_not_verified`를 반환한다.
11. IF DNS 레코드 변경 동작이 요청되면, THEN THE Platform SHALL 해당 동작을 이 스펙 자동화 범위 밖으로 처리하여 수행하지 않고 고정 코드 `dns_change_out_of_scope`를 반환한다.
12. THE Migration_Readiness_Manifest SHALL 프로덕션 릴리스가 외부 증거 게이트 충족 전까지 차단 상태임을 명시하고 게이트 항목으로 (1) 공표·승인·배포된 정책 버전·해시·로케일·발효·게시 튜플, (2) 법적 근거·트리거·기간·활성화와 호스티드 백업 및 시점 복구 증거를 갖춘 운영자 승인 보존 분류, (3) 배포 카탈로그와 일치하는 호스티드 마이그레이션·RLS·그랜트·RPC 리드백·생성된 Supabase 타입·카탈로그·키 관리·운영자 접근 증거, (4) 프로덕션 시크릿을 갖춘 승인된 HTTPS 마케팅 공급자, (5) 위치정보사업 신고 또는 문서화된 비해당 확인, (6) 만 14세 미만 지원이 활성일 때 외부 검증된 보호자 공급자, (7) 사람 승인된 사고 통지와 불변 제출·접수 증거, (8) 기록된 한국 법무·프라이버시 책임자 검토 여덟 항목을 열거한다.
13. THE Migration_Readiness_Manifest SHALL 8항 증거 항목과 12항 게이트 항목의 상태를 `unresolved` 또는 `external_evidence_confirmed` 두 값 중 하나로만 기록하고 외부 증거 참조 식별자가 없는 항목을 `external_evidence_confirmed`로 표기하지 않는다.

### 요구사항 15: AI 운영 에이전트 감시와 조치 경계

**User Story:** 운영자로서 AI 에이전트가 모니터링 신호를 감시하고 정해진 범위 안에서 조치하기를 원한다. 그래야 사람이 붙어 있지 않은 시간에도 운영이 이어지고, 동시에 위험한 자동 조치가 발생하지 않는다.

#### 수용 기준

1. THE Ops_Agent SHALL Observability_Stack 알림과 Log_Pipeline 심각도 신호를 60초 이하 주기로 조회하고 이 두 원본만 조치 근거 감시 입력으로 사용한다.
2. WHEN 감시 입력에 활성 상태인 운영자 승인 감시 규칙의 신호 종류와 심각도 임계값을 함께 충족하는 신호가 나타나면, THE Ops_Agent SHALL 조치 실행 이전에 Agent_Action_Record를 생성하고 트리거 신호 식별자, 신호 심각도, 조치 종류 식별자를 기록한다.
3. THE Ops_Agent SHALL 활성 상태인 운영자 승인 Agent_Action_Allowlist에 열거된 조치 종류 식별자와 정확히 일치하는 조치만 사람의 개별 승인 없이 수행한다.
4. IF 조치 종류 식별자가 Agent_Action_Allowlist 항목과 정확히 일치하지 않으면, THEN THE Ops_Agent SHALL 조치를 수행하지 않고 고정 코드 `agent_action_not_allowlisted`를 반환하며 해당 결과 코드를 Agent_Action_Record에 기록한다.
5. THE Ops_Agent SHALL Hosted_Database 쓰기, 호스티드 마이그레이션 적용, 배포 실행, 롤백 실행, 브랜치 보호 설정 변경, 시크릿 값 변경, DNS 변경을 조치 식별자와 트리거 신호 식별자에 결속된 명명된 사람 승인 참조가 Agent_Action_Record에 기록된 이후에만 수행한다.
6. IF Ops_Agent 조치 요청이 5항의 동작 부류에 해당하고 결속된 명명된 사람 승인 참조가 없으면, THEN THE Ops_Agent SHALL 조치를 수행하지 않은 상태로 사람 승인 대기 상태를 기록하고 고정 코드 `human_approval_required`를 반환한다.
7. THE Agent_Action_Record SHALL 조치 식별자, 트리거 신호 식별자, 신호 심각도, 조치 종류 식별자, 결과 코드, 명명된 사람 승인 참조만 포함하고 Forbidden_Log_Field를 제외한다.
8. THE Ops_Agent SHALL 동일한 트리거 신호 식별자와 조치 종류 식별자 조합에 대해 조치를 정확히 1회만 수행하고, 이후 동일 조합 요청에는 조치를 수행하지 않고 고정 코드 `agent_action_duplicate`를 반환한다.
9. THE Ops_Agent SHALL 허용 조치 건수와 시간 창 길이를 활성 상태인 운영자 승인 상한에서만 읽어 해당 시간 창의 슬라이딩 집계로 조치 건수를 제한하고, 상한 초과 요청에는 조치를 수행하지 않고 고정 코드 `agent_action_rate_limited`를 반환한다.
10. IF 조치 실행 후 결과 확인이 최대 3회 시도와 총 60초 이내에 성공하지 않으면, THEN THE Ops_Agent SHALL 해당 조치를 실패로 기록하고 고정 코드 `agent_action_unverified`를 반환하며 동일 트리거 신호 식별자에 대한 후속 조치를 중단한다.
11. THE Ops_Agent SHALL 조치 근거 신호를 신호 식별자와 심각도로만 기록하고 신호 원문 본문, 공급자 진단 정보, 자유 형식 오류 문자열을 Agent_Action_Record에 포함하지 않는다.
12. FOR ALL 조치 요청 집합에 대해, Agent_Action_Allowlist에 없는 조치 종류의 수행 건수와 결속된 명명된 사람 승인 참조 없이 수행된 5항 동작 부류의 수행 건수 SHALL 각각 0이다. (속성 기반 검증 후보)
13. THE Ops_Agent SHALL 릴리스 증거, 배포 영수증, 법령 준수 상태, 감독기관 또는 정보주체 통지의 제출·접수 사실을 생성하거나 충족 상태로 표기하지 않는다.
14. IF 활성 상태인 운영자 승인 Agent_Action_Allowlist를 읽을 수 없으면, THEN THE Ops_Agent SHALL 어떤 조치도 수행하지 않고 고정 코드 `agent_allowlist_unavailable`을 반환한다.
15. IF Agent_Action_Record 생성이 확정되지 않으면, THEN THE Ops_Agent SHALL 조치를 실행하지 않고 고정 코드 `agent_action_record_unavailable`을 반환한다.
16. THE Ops_Agent SHALL 릴리스 자체 승인, 감독기관 통지 발송, 정보주체 통지 발송을 어떤 승인 상태에서도 수행하지 않고 해당 항목을 명명된 사람의 결정·실행 대기 상태로만 기록한다.

### 요구사항 16: 단계 순서와 롤백 게이트

**User Story:** 개발자로서 이 큰 범위를 한 번에 전환하지 않고 단계별로 착지시키고 싶다. 그래야 각 단계에서 되돌릴 수 있고 중간 상태에서도 서비스가 동작한다.

#### 수용 기준

1. THE Platform SHALL 이 스펙의 요구사항 1-15를 서로 겹치지 않는 단계 집합으로 분할하고, 각 단계에 유일한 단계 식별자, 1부터 시작하는 유일한 실행 순번, 정확히 1개의 Phase_Gate, 정확히 1개의 단계 산출물을 부여하며, 모든 요구사항 번호를 정확히 1개 단계에 배정한다.
2. THE Phase_Gate SHALL 진입 조건, 완료 조건, 검증 명령, 정확히 1개의 Rollback_Plan 참조를 기록하고, 진입 조건과 완료 조건 각각을 충족·미충족 판정이 가능한 문장과 고유 조건 식별자로 기록하며, 완료 조건에 4항 검증 결과 전체와 10항 확인 결과 전체를 포함한다.
3. IF 단계의 완료 조건 중 하나 이상이 미충족이면, THEN THE Platform SHALL 다음 단계 진입을 차단하고, 미충족 조건 식별자 목록을 단계 산출물에 기록하며, 고정 코드 `phase_gate_not_satisfied`를 반환하고 다음 단계 산출물을 생성하지 않는다.
4. WHEN 단계가 완료 판정 대상이 되면, THE Platform SHALL `bun run lint`, `bun run test:unit`, `npm run typecheck:parity`, `npm run build`, `python -m unittest backend.utils.tests.test_run_daily_regression`, `python -m unittest backend.pipeline.test_validators_unittest`, `python -m unittest backend.pipeline.test_data_contracts_unittest`을 모두 실행하고, 명령별 성공·실패 판정, 실행 시각, 대상 트리 식별자를 단계 산출물에 기록하며, Forbidden_Log_Field 값과 공급자 진단 문자열을 기록에서 제외한다.
5. THE Rollback_Plan SHALL 되돌림 대상 경로 목록, 실행 명령 순서, 되돌림 후 검증 항목으로 4항 명령 전체, 되돌림 성공 판정 기준을 기록하고, 실행 명령의 대상 워크트리를 격리된 복구 후보 워크트리로 한정하며, 더티 원본 워크트리를 대상으로 하는 명령과 reset, stash, clean을 포함하지 않는다.
6. THE Platform SHALL 콘텐츠 패치를 새 헤드에서 시작하여 `develop -> data -> main` 순서의 직렬 풀 리퀘스트 경로로만 이동시키고, 앞 순서 대상 브랜치의 병합이 확인되기 전에는 다음 순서 풀 리퀘스트를 제출하지 않는다.
7. THE Platform SHALL 브랜치 보호 설정을 변경하거나 우회하지 않고, 보호 브랜치에 대한 직접 푸시와 강제 푸시를 수행하지 않는다.
8. THE Platform SHALL 모든 단계의 파일 편집과 검증 명령 실행을 격리된 복구 후보 워크트리에서만 수행하고, 더티 원본 워크트리에 대해 reset, stash, clean, 체크아웃, 파일 삭제를 실행하지 않으며, 사용한 워크트리 식별자를 단계 산출물에 기록한다.
9. IF 단계 시작 시점과 완료 시점 사이에 이 스펙 작업으로 설명되지 않는 워크트리 변경이 발견되면, THEN THE Platform SHALL 해당 변경을 사용자 작업으로 보존한 상태에서 단계를 중단하고, reset, stash, clean, commit, push, 삭제를 수행하지 않으며, 명시적 사용자 승인 전까지 단계를 재개하지 않고, 변경 경로 목록만 파일 내용 없이 단계 산출물에 기록한다.
10. WHEN 단계가 완료 판정 대상이 되면, THE Platform SHALL 단계 산출물에 열거된 Web_App 공개 라우트 전체를 확인하고, 각 라우트가 5초 이내에 서버 오류 없이 응답한 경우만 성공으로 기록하며, 라우트별 판정 결과와 응답 시간을 기록하고, 쿠키, 헤더, 로컬 스토리지, 관리자 본문·표 내용, Supabase 페이로드를 기록에서 제외한다.
11. IF Phase_Gate 기록에 진입 조건, 완료 조건, 검증 명령, Rollback_Plan 참조 중 하나라도 부재하면, THEN THE Platform SHALL 해당 단계 진입을 차단하고 고정 코드 `phase_gate_incomplete`를 반환한다.
12. IF 4항 명령 중 하나 이상이 실패하거나 10항 라우트 확인 중 하나 이상이 실패하면, THEN THE Platform SHALL 해당 단계를 미완료로 표기하고 다음 단계 진입을 차단하며 고정 코드 `phase_verification_failed`를 반환한다.
13. IF 병합 후보에 외부 승인 참조 또는 브랜치 보호 상태 증거 참조가 부재하면, THEN THE Platform SHALL 병합을 수행하지 않고 고정 코드 `merge_approval_missing`을 반환한다.

## 사람 또는 운영자 결정이 필요한 항목

다음 값은 이 문서가 정의하지 않는다. 설계 단계 진입 전 운영자 결정과 승인 참조가 필요하다.

1. **Publication_Set**: 호스티드로 게시할 정확한 테이블 목록과 테이블별 컬럼 목록. (요구사항 10)
2. **게시 주기**: Publish_Worker 실행 간격과 실행 창. (요구사항 10)
3. **게시 배치 상한**: 1회 적용 행 수 상한. 현재 트리의 `BATCH_LIMIT = 200`을 유지할지 여부. (요구사항 10)
4. **Local_Only_Schema**: 로컬에만 둘 분석·스테이징 테이블 집합. (요구사항 9)
5. **Tooling_Selection_Record 승인**: 11개 도구 범주 각각의 후보 채택 결정. (요구사항 11)
6. **Agent_Action_Allowlist**: Ops_Agent가 승인 없이 수행할 조치 목록. (요구사항 15)
7. **Ops_Agent 조치 상한**: 단위 시간당 허용 조치 횟수. (요구사항 15)
8. **로그 보존 분류**: 로그별 보존 기간과 법적 근거. 활성 상태인 운영자 승인 분류에서만 가져온다. (요구사항 13)
9. **러스트 이행 우선순위**: 어느 파이썬 모듈부터 이행할지의 순서. (요구사항 1)
10. **`backend/pipeline-control` 대 `backend/pipeline_control` 경로 소유권**: 두 경로의 최종 책임 분할. (요구사항 6)

## 우선순위와 단계 경계 제안

단계 순서는 설계 단계에서 확정한다. 현재 트리 상태를 근거로 한 제안은 다음과 같다.

| 단계 | 범위 | 관련 요구사항 | 근거 |
| --- | --- | --- | --- |
| 1 | 로컬 우선 파이프라인 정착과 스키마 미러링 | 8, 9 | Supabase Free 사용량 제약이 현재 가장 직접적인 운영 제약이다. 로컬 스택과 프로파일 코드가 이미 존재한다. |
| 2 | 게시 대상 집합과 로컬-호스티드 동기화 | 10 | 1단계 없이는 게시 원본이 성립하지 않는다. `batch_upsert.py`가 이미 배치 업서트와 읽기 검증을 제공한다. |
| 3 | 로그 중앙화와 관측 스택 상호연동 | 12, 13 | 관측 스캐폴드와 레다크션 경계가 이미 존재하므로 확장 비용이 가장 낮다. |
| 4 | 도구 조사·선정 기록과 의존성 신선도 자동화 | 4, 5, 11 | 도구 결정이 이후 배포 기술 산출물의 형태를 정한다. |
| 5 | 레이아웃 재편과 명명 리팩터 | 6, 7 | 경로 변경은 1-4단계 워크플로 참조가 안정된 후 수행하는 편이 되돌리기 쉽다. |
| 6 | 러스트 이행 | 1, 2, 3 | 가장 범위가 크고 패리티 증거 축적에 시간이 필요하다. 앞 단계의 로컬 실행 경로가 패리티 입력 원본이 된다. |
| 7 | 이전 준비와 AI 운영 에이전트 | 14, 15 | 감시 대상 신호와 배포 기술 산출물이 갖춰진 후에만 의미가 있다. |

요구사항 16은 모든 단계에 적용된다.
