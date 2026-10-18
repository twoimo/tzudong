# 재현과 검증 범위

소스 기준선 e7e87a3d319f7864f7e4b239da0a83961d6ece9a, 수정 47c39178f74909bf2da59fab2a1950d527bc7573, PR #3306이다. 원본 작업트리를 reset/stash/clean하지 말고 별도 checkout에서 재현한다. npm 11.6.2와 package-lock.json이 설치 권위다. CI Node는 24.21.0, 로컬은 24.22.0이며 이 차이를 숨기지 않는다.

1. 새 checkout의 apps/web에서 npm 11.6.2로 npm ci를 실행한다. Bun은 1.4.0이다.
2. bun test tests-unit/naver-map-marker-visuals.test.ts tests-unit/evidence-engineering-foundation.test.ts tests-unit/evidence-engineering-remaining.test.ts tests-unit/evidence-badge-viewer-session.test.ts --timeout 30000
3. npm run typecheck:parity와 변경 TS 파일 ESLint --max-warnings=0을 실행한다.
4. 기준선에서 source.patch의 테스트 변경만 적용하면 등급 갱신 두 테스트가 실패한다. CSS 안의 선택자 문자열에 의한 거짓 통과를 피하기 위해 실제 wrapper의 class와 data-popularity-tier 속성을 함께 비교한다.
5. production build는 TZUDONG_NEXT_DIST_DIR=.next-cursor-evidence-delivery-20261018-v1, NEXT_PUBLIC_SUPABASE_URL=https://dependency-proof.supabase.co, NEXT_PUBLIC_SUPABASE_ANON_KEY=dependency-modernization-browser-proof-anon-key로 npm run build를 실행했다. dist 이름은 새 경로여야 하며 기존 빌드를 덮어쓰지 않는다.
6. Playwright 프로젝트가 요구하는 chromium headless shell revision 1243을 별도 PLAYWRIGHT_BROWSERS_PATH에 설치한다. 첫 시도는 브라우저 부재로 앱 테스트 실행 전에 실패했고, 설치 후 재시도는 3개가 통과했다.
7. 같은 build와 public fixture 환경에서 PLAYWRIGHT_WEB_SERVER_COMMAND='node node_modules/next/dist/bin/next start --port 18118 --hostname localhost', PLAYWRIGHT_BASE_URL=http://localhost:18118, PLAYWRIGHT_WEB_SERVER_URL=http://localhost:18118/api/health, PLAYWRIGHT_REUSE_EXISTING_SERVER=0을 지정하고 node node_modules/@playwright/test/cli.js test tests/dependency-modernization.spec.ts --project=chromium --reporter=line을 실행한다. 사용 전 포트 소유권을 확인한다.

이 세 브라우저 검사는 실제 production bundle의 초기 화면, 키보드 선택/포커스, 포인터·키보드 패널 크기 조절이다. REST는 합성 1행이고 외부 요청을 차단한다. 실제 Naver SDK, 물리 모바일, 운영 인기 등급, 배지 자산 생성, field 성과나 메모리 허용치 통과를 증명하지 않는다. 이 패킷은 성능 개선율을 주장하지 않으며 성능 측정 채택 수는 0이다.

원래 ZIP이나 원문 OCR·영상·Supabase 응답·사용자 세션은 이 패킷에 복사하지 않았다. 운영 변경 결과는 별도 delivery readback에 기록하며 로컬 검증 결과로 대체하지 않는다.
