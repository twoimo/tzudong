# 관리자 독립 경로 일관성 및 전체 경로 census

## 범위

기준 HEAD는 `5f17b5f7dfca60f4b75886052dcb6433e97acba0`이다. 이 증빙은 `/admin/privacy-incidents`의 소스 수준 헤더·밀도 보정과 실제 `app` 소스에서 계산한 경로 목록만 다룬다. 네트워크, 공급자, 운영 DB, 개인정보 행, 저장, 승인, 배포에는 접근하지 않았다.

`/admin/privacy-incidents`는 공통 `AdminPageHeader`를 사용하고 제목·건수·기한 위험·새로고침을 한 헤더에 모았다. 본문의 수직 간격 토큰은 `space-y-6`에서 `space-y-3`으로, 모바일 패딩은 `p-4`에서 `p-3`으로, 중간 화면 패딩은 `md:p-8`에서 `md:p-5`로 줄였다. 새로고침 진입점은 2개에서 1개로 1개(50%) 줄었다. 이는 소스 토큰과 컨트롤 수 비교이며 렌더 높이·업무 시간 개선 측정이 아니다.

사고 상태 전이, 탐지·판단 입력, 사람 승인, 미리보기 → 정확 확인 → 적용 → 읽기검증 → 감사 순서, 외부 제출의 사람 책임, API 호출 형식은 변경하지 않았다. 운영자 경계 문구는 압축했지만 신고 대상·법적 적용·외부 수리·승인은 사람이 결정하고 자동 외부 제출은 없다는 의미를 유지한다.

## 경로 census

`scripts/audit-route-census.mjs`는 `app/**/page.tsx`와 `app/s/[code]/route.ts`를 재귀적으로 읽고 각 소스의 SHA-256을 기록한다. 결과는 `route-census.json`이다.

- 공개·계정 `page.tsx`: 21개
- 공유 핸들러: 1개
- 관리자 물리 `page.tsx`: 5개
- 전체: 27개
- 과거 공개 행렬이 가진 경로: 22개, 현재 공개·계정 및 공유 경로 포함 22/22
- 과거 공개 행렬의 운영 인증 데이터 검증: 0/22
- 현재 관리자 합성 증빙의 사이드바 모듈: 15개

이는 모집단 27개를 전수 수집한 소스 목록이므로 표본 신뢰구간을 적용하지 않는다. 경로 파일 존재나 과거 행렬 행은 현재 렌더, OAuth, 운영 DB, 저장·승인 또는 프로덕션 동작을 입증하지 않는다.

동적 경로 입력은 과거 캡처에 실제 기록된 값만 재사용했다.

- `/s/[code]`: `/s/audit-invalid-code`
- `/user/[userId]`: `/user/00000000-0000-4000-8000-000000000009`

관리자 증빙 범위도 경로별로 분리했다. `/admin`은 현재 소스에 묶인 15개 모듈의 합성 레이아웃·이동 증빙만 있고, `/admin/banners`, `/admin/evaluations`, `/admin/submissions`는 내장 모듈 또는 리다이렉트 대상 증빙만 있다. `/admin/privacy-incidents`는 이번 소스 변경 후 실제 렌더 증빙이 없으며 Root의 후속 렌더 확인이 필요하다.

## 검증

- `bun test tests-unit/privacy-incident-workflow.test.ts tests-unit/public-surface-design-contract.test.ts tests-unit/route-census.test.ts --timeout 30000`: 24 통과, 0 실패, 349 assertions.
- 대상 ESLint 4개 파일, `--max-warnings=0`: 통과.
- TypeScript native 7.0.2 / compat 6.0.2 parity: 진단 0, 논리 입력 3,144개, 입력 이름 SHA-256 `911bcdc4b60d7a269d4d13edfa17845c6faf36ba3bf65c8a46e62f184c13f2c3`.
- census를 서로 다른 출력 경로에 두 번 생성한 결과 바이트가 일치했다.
- `git diff --check`: 통과.

검증에는 동일한 `package-lock.json` SHA-256 `607175eda02d7746caf5593d34835cef317bf197ca6d5428fa1266cdb2aae5f4`를 가진 준비된 로컬 `node_modules`를 임시 링크로 사용했고 검사 후 제거했다.

## 소스 결합

- `app/admin/privacy-incidents/page.tsx`: `a06c2a03e85268f55f85a362d924ef8306d94376205f48fddc3f71797add1050`
- `tests-unit/privacy-incident-workflow.test.ts`: `92405df000e995a08315dc9bbd7f4e5766fbbfdb7c4ed74448afb17c8aeb118f`
- `tests-unit/route-census.test.ts`: `0a506927cdd7d0fa7cbf752b96bb913c758e23c24c65edfb3510725c1b42517b`
- `scripts/audit-route-census.mjs`: `e9e38fdabdd98acc2f98082b55bac0214113921bb994d3273db0976b0a5f79c2`
- `route-census.json`: `73f6125b9ce41058e59c67bc9b100c729b5973f32ad3fb25effcd2d30ff2f3e1`

입력 증빙 SHA-256은 `route-census.json`의 `evidenceInputs`에도 포함되어 있다. 실제 렌더와 운영 동작은 아직 미확인이다.

## standalone 렌더 준비

관리자 segment layout은 `../../styles/admin-ui.css`를 직접 import하므로 `/admin/privacy-incidents`에도 공통 `AdminPageHeader` CSS가 포함된다. 모바일 `max-width: 639px` 규칙은 헤더 액션 버튼에 `min-width: 2.75rem; min-height: 2.75rem`을 적용한다. 따라서 `h-8` 소스 토큰과 별개로 CSS상 44px 하한이 있으나, 계산된 실제 geometry는 Root의 CUA 3폭 검증 전까지 미확인이다.

새 production fixture는 기존 frozen build를 건드리지 않고 `.next-privacy-incidents-20261012`에 생성했다.

- BUILD_ID: `u8JceLpzbDBeZYdF9j5nJ`
- build source manifest: 421개, 전후 동일
- tsconfig 원문 복구: 통과
- 임시 의존성 링크 제거: 통과
- route CSS boundary: 통과
- package lock SHA-256: `607175eda02d7746caf5593d34835cef317bf197ca6d5428fa1266cdb2aae5f4`
- build receipt: `privacy-build-receipt.json`

Loopback runtime은 Node 24.21.0과 Next 16.3.8로 127.0.0.1에만 열려 있다. 보이는 시작 페이지 `http://127.0.0.1:18942/__fixture/start`의 **검증 화면 열기** 버튼은 합성 localStorage 표식을 설정하고 합성 세션 쿠키를 발급한 뒤 `/admin/privacy-incidents`로 이동한다. 포트는 Next 18940, 합성 Supabase 18941, gateway 18942다.

HTTP readback은 시작 페이지 200, 세션 이동 후 페이지 200/24,344 bytes, 제목 포함, 합성 사고 3건·기한 위험 2건을 확인했다. 이는 `privacy-http-readback.json`에 기록했으며 렌더·geometry 증빙으로 취급하지 않는다. 실제 1440/1024/390 렌더, 헤더 높이·잘림·overflow, 모바일 새로고침 버튼 44px 하한은 Root CUA 확인 대상으로 남아 있다.

추가 결합 SHA-256:

- `app/admin/layout.tsx`: `b9263c7a9583237bdc78662718e2f48c7607e78dce245c1f4d4363612b8006b1`
- `components/admin/AdminPageHeader.tsx`: `ac2621a32fbed7b801798675683a439b8900621ef86e6116034d71a1cfb40a73`
- `styles/admin-ui.css`: `b0741acb28a35b16f4bcab415b5549bf30924c19efba86a8048ced2456d4c307`
- `build-privacy-fixture.mjs`: `551f0ce6acfc477e7d5bb7c3fb4f1ab0248ce7cb93345a6945321d7df1295ef3`
- `fixture-server.mjs`: `05b24997c5716d19171b0049462775be00d3f0b5db34b3c7b3260bfb8ec58a2c`
- `start-loopback.mjs`: `fc01cd12a7c6a78936012a2254a52e947f9ab35645c0e866a65988e6de0f0ae8`
- `privacy-build-receipt.json`: `b8355ff194cff412a77d82adde1f82d4e118053b1f5bd0c88d3c7456a117c3b5`
