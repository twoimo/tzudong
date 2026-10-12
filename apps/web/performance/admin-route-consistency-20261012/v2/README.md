# 개인정보 사고 헤더 모바일 요약 보정 v2

## 범위

기준 HEAD는 `5f17b5f7dfca60f4b75886052dcb6433e97acba0`이다. v1 CUA 렌더에서 1440px와 1024px은 헤더 57px, 제목 16px/600/24px, 제목 잘림 0건, 문서 overflow 0건이었다. 390px은 헤더 113px, 새로고침 44px, 활성 헤더 버튼 44px 미만 0건이었지만 요약은 `clientWidth=218`, `scrollWidth=248`로 말줄임 1건이었다. 이 v2는 그 결함만 보정한다. v1 빌드·HTTP·소스 영수증과 `privacy-cua-*.png`, `privacy-cua-layout-v1.json`은 이전/실패 증빙으로 보존했고 덮지 않았다.

요약에서 자명한 `개인정보 사고 담당 관리자 전용`을 제거해 합성 fixture 기준 `3건 · 기한 위험 2건`만 표시한다. 문자열은 33자에서 13자로 20자(60.61%) 줄었다. 이는 문자 수의 전수 비교이며 렌더 폭·업무 시간·품질 개선의 통계 추정이 아니다. 상태 전이, 입력, 사람 승인, API, 감사, 읽기검증 의미와 본문의 운영자 책임 경계는 변경하지 않았다. 공통 `AdminPageHeader`와 CSS도 변경하지 않았다.

## 검증

- `bun test tests-unit/privacy-incident-workflow.test.ts tests-unit/public-surface-design-contract.test.ts tests-unit/route-census.test.ts --timeout 30000`: 24 통과, 0 실패, 352 expect.
- 페이지·관련 테스트·census 스크립트와 v2 fixture 스크립트의 대상 ESLint, `--max-warnings=0`: 통과.
- TypeScript native 7.0.2 / compat 6.0.2 parity: 진단 0, 논리 입력 3,144개. 입력 이름 SHA-256은 `911bcdc4b60d7a269d4d13edfa17845c6faf36ba3bf65c8a46e62f184c13f2c3`, 비라이브러리 내용 SHA-256은 `8ff9740ac7210d7ce22e8e8044bf8ee762f3f91400f7f3bc5306d444770d2da6`이다.
- `git diff --check`: 통과.
- 실제 app source census: 공개·계정 page 21개, share handler 1개, admin 물리 page 5개, 총 27개. 이 목록은 소스 존재 증거이고 실행·렌더 증거가 아니다.

동일한 `package-lock.json` SHA-256 `607175eda02d7746caf5593d34835cef317bf197ca6d5428fa1266cdb2aae5f4`의 준비된 로컬 의존성을 사용했다. repository env 파일과 hosted credential은 빌드나 fixture에 넣지 않았다.

## v2 빌드와 루프백 readback

- 분리 dist: `.next-privacy-incidents-v2-20261012`
- BUILD_ID: `RhKCeg5si0XfJQHmHouY3`
- BUILD_ID SHA-256: `0bf464ee7158c0214a6ea158846d9db0352dc38a822ae91f6908557411e9c86b`
- 빌드 source manifest: 421개, SHA-256 `3d0e46c18d443201912bb267f3588e4be3b32775935b617b8dff2cbd2ad5f811`, 전후 동일
- tsconfig 원문 복구 및 빌드 임시 의존성 링크 제거: 통과
- Node 24.21.0 / Next 16.3.8 production bundle: 통과

루프백 fixture는 Next 18950, 합성 Supabase 18951, gateway 18952에만 바인딩한다. `http://127.0.0.1:18952/__fixture/start`의 보이는 **검증 화면 열기** 버튼이 합성 localStorage 표식과 합성 세션 쿠키를 설정하고 `/admin/privacy-incidents`로 이동한다. HTTP readback은 시작 200, 이동 후 페이지 200, 구식 요약 문구 부재, 합성 API 사고 3건 및 `deadlineStatus in {overdue, due_soon}`인 기한 위험 2건을 확인했다. 브라우저 mutation method, 운영 인증, 개인정보 행, 원격 서비스는 사용하지 않았다.

HTTP 200과 소스 문자열 자체는 계산된 렌더 geometry를 입증하지 않는다. 별도 Root CUA 검증은 같은 BUILD_ID와 페이지 소스 SHA에 결합해 다음을 확인했다.

- 1440/1024/390px에서 H1은 각각 1개, 제목은 16px/600/24px, 잘림 0건, document overflow 0px였다.
- 헤더 높이는 각각 57/57/113px였다.
- 390px 요약은 `clientWidth=218`, `scrollWidth=218`이었다. v1의 말줄임 1건에서 0건으로 1건(100%) 감소했고, scroll overflow는 30px에서 0px로 30px(100%) 감소했다.
- 모바일 새로고침은 87.48×44px였고, 활성 버튼 44px 미만은 0개였다.
- Shift+Tab으로 새로고침에 `:focus-visible`이 표시됐고 Enter 입력 뒤 `GET /api/admin/privacy-incidents` 1건과 200 응답 1건을 관측했다. 외부 요청과 쓰기 요청은 0건이었다.
- 캡처 구간의 console error/warn은 각각 0건이었다.

각 폭은 고정 fixture의 결정적 관측 1회이므로 95% 신뢰구간을 적용하지 않는다. 이 결과는 렌더·키보드 진입점 범위이며 운영 OAuth, 운영 DB 행, 외부 제출, 저장·승인, 배포를 입증하지 않는다.

## 소스 결합

- `app/admin/privacy-incidents/page.tsx`: `572ac666db2f7f66a852557bacab63b64851056838ef11efa7dbd60a2db057a2`
- `tests-unit/privacy-incident-workflow.test.ts`: `a65145340405b233bc81ab541ac85dd8ac59f4c79681d9e7fd2e7028b9d2b99f`
- `components/admin/AdminPageHeader.tsx`: `ac2621a32fbed7b801798675683a439b8900621ef86e6116034d71a1cfb40a73`
- `styles/admin-ui.css`: `b0741acb28a35b16f4bcab415b5549bf30924c19efba86a8048ced2456d4c307`
- `build-privacy-fixture.mjs`: `de562bd5d53bbd06140fab0cfe48615221c36a9dbcda047aa8f71893aa60d870`
- `fixture-server.mjs`: `3b9684c3dda38715b788c564fbaed8f0e002edbf9a46821a65b574bb602d8e09`
- `start-loopback.mjs`: `4974d2c55e1dd6b0270c525e61ce07c29ae5db5bc307d870ccf0fa6f5f5dc4d7`
- `privacy-build-receipt.json`: `cecaa6934e6e35caae03d78aa7bbfeec580b4e362af6dea7a72a400a675819ea`
- `privacy-runtime-start.json`: `2ca009aa49ccf9d56a1f8b00a3a47d9ab8630089ccfa7a667cc159620e1f8082`
- `privacy-http-readback.json`: `4e2bb7569cf6db52d1c56277891046e5cb28058135fb15f094f5980253d05c50`
- `privacy-cua-layout.json`: `aeee8de6e7898e036dea39208a14d59677cd35221441649e473bd993b2fddc13`
- `privacy-cua-1440.png`: `806d9e8260144d24e08e300e58d9b36abcb18cf733032b8d7f6c3d576965bb68`
- `privacy-cua-1024.png`: `babc3aa44071311dc4c71f6952a008d81d0715d6b698316e72759c239e5b9d2d`
- `privacy-cua-390.png`: `a2d6c73ca3990ec04aacea29ef8e0be41fdd46bc0f11360b5ec60d079d78f426`
- `privacy-runtime-stop.json`: `52f8257701d46a803f1def2ca05e66e85e873735da91f0744f19ad7afe32c673`
- `route-census.json`: `f5e769330d887b58aa5ff3d207aa732a091891807127b3555000520d21a6ffe1`

정상 종료 뒤 launcher·Next·gateway PID는 모두 종료됐고 18950/18951/18952 listener는 0개다. 임시 `node_modules` 링크도 제거됐다.
