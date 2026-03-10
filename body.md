## 개요
- Admin Workflow 관리/대시보드 기능 및 Supabase DB 테이블 신규 구축
- 12단계 Daily Crawler 파이프라인의 상태 및 결과 래핑 스크립트 수정 (`run_daily.sh` 및 로그 동기화)

## 변경 내용
- `backend/supabase/migrations/` 내 워크플로우 추적용 DB 테이블 마이그레이션 (`admin_workflow_runs`, `admin_workflow_steps` 등) 추가
- `apps/web/app/api/admin/workflows/*` 라우트 생성 및 `admin` 대시보드 UI 연동, 단위 테스트(`admin-workflows-api-routes.test.ts`) 추가 적용
- `backend/run_daily.sh` 내 단계별 진행 상황을 Supabase DB의 새로 생성된 Workflow 테이블과 실시간 동기화하여 로깅하도록 CURL 통신(emit_signal) 로직 대대적 보강

## 테스트
- Supabase 로컬 DB 마이그레이션 적용 및 단위 테스트 실행 확인 여부
- API 라우팅 정상 응답 테스트

## 관련 이슈
- (없음)
