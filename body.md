## 개요
- 반응형(Responsive) E2E 테스트 안정화 및 인증 수단 보강 방어 로직 추가

## 변경 내용
- `apps/web/playwright.config.ts`, `tests/responsive-overflow.spec.ts`: `webServer` 타임아웃/의존성 누락으로 인한 Playwright 기동 터짐 방지를 위해 `scripts/run-responsive-tests.mjs` 래퍼 스크립트 작성 및 툴체인 분리
- `apps/web/tests/setup/admin.setup.ts`: 로컬 E2E 테스트에서 Admin 계정 인증 정보가 없을 경우, 이전 세션 쿠키(`sb-*-auth-token`)나 `INSIGHTS_CHAT_ADMIN_COOKIE` 헤더를 기반으로 Soft Auth Fallback 수행
- `.gitignore`: 로컬 실행 결과물(`apps/web/.cache` 등) 및 로컬 기록용 워크로그(`OMX_MODERNIZATION_WORKLOG.md`) 반영 제외

## 테스트
- `run_responsive_tests.mjs` 래퍼 단독 구동 시 skip 모드 동작 여부 및 E2E 타임아웃 완주 확인 완료
- `npm run lint`, `type-check` 이상 없음 파악

## 관련 이슈
- (없음)
