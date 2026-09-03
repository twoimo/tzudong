# Implementation Plan: 관리자 콘솔 사이드바 재구성

## Overview

이 계획은 설계의 **레지스트리 우선 · 경계가 있는 분해 · 토큰에서만 파생하는 색** 세 판단을 12개 작업 흐름으로 옮긴 것입니다. 정의 계층(레지스트리·계조·시각화 대응·검색 순수 함수)을 먼저 세우고, 파생 계층(라우팅·순서 정규화)과 순서 API를 정정한 뒤, 셸·골격·모듈 그리드·시각화·메뉴별 완성도를 차례로 쌓고, 마지막에 `AdminConsoleOverview.tsx` 배선을 신설 컴포넌트로 교체합니다. 각 정의·파생 작업은 설계의 17개 정확성 속성 중 해당 속성의 성질 기반 시험과 짝을 이룹니다.

구현 언어는 설계가 구체 TypeScript로 서술하므로 TypeScript입니다. 성질 기반 시험은 `fast-check`를 도입하지 않고 저장소 관례(`tests-unit/pin-contract.test.ts`의 결정적 시드 PRNG `mulberry32`)를 따릅니다.

저장소 규칙을 전 작업에 적용합니다. `requireAdmin`이 본문 파싱·서비스 롤 클라이언트 생성·저장소 호출보다 앞서고, 응답은 고정 코드로 한정하며 제공자·저장소 오류 원문을 노출하지 않습니다. 장시간 작업은 `backend`에 위임합니다. 워크트리의 예기치 않은 변경은 사용자 작업으로 보존하며 reset·stash·clean 하지 않습니다. 이 계획은 어떤 병합·배포·호스팅 상태나 시험 통과 사실도 주장하지 않습니다.

## Tasks

- [ ] 0. 기준선 결함 해소 (이 스펙 변경과 분리)
  - [ ] 0.1 `AdminConsoleOverview.tsx`의 중복 `AdminOpsReadbackStrip` import 3줄 제거
    - `apps/web/components/admin/AdminConsoleOverview.tsx` 137~139행의 동일 `import { AdminOpsReadbackStrip } from "@/components/admin/AdminOpsReadbackStrip";` 3줄을 제거한다. 이 식별자는 파일 본문에서 사용되지 않고 `apps/web/components/admin/AdminOpsReadbackStrip.tsx`는 존재하지 않으므로, 제거만으로 컴파일이 복구된다. 새 컴포넌트를 만들지 않는다(설계 결정 (a)).
    - 이 스펙의 다른 변경과 섞지 않고 독립 커밋으로 둔다. 해소 전에는 `npm run typecheck:parity`와 `npm run build`가 이 스펙과 무관하게 실패하므로 요구사항 21-10의 "실패 0건" 형태를 만들 수 없다.
    - 워크트리의 나머지 예기치 않은 변경은 건드리지 않는다.
    - _요구사항 21.10_

- [ ] 1. 정의 계층 신설 (React 없음, 서버·클라이언트 공용)
  - [ ] 1.1 메뉴_레지스트리 모듈 작성
    - `apps/web/lib/admin/console-menu-registry.ts`를 신설한다. 15개 메뉴를 ID를 키로 갖는 레코드로 선언하고 `as const satisfies Record<AdminConsoleMenuId, AdminConsoleMenuDefinition>`로 전수성을 강제한다. 각 메뉴에 7개 필드(id, title, purpose, operationalDuty, primarySources, primaryActionLabel, outputKind)와 section을 제공하고, `submissions`·`reviews`에만 `pendingDomains`를 선언한다.
    - 섹션 4개(`판단`, `검수`, `운영`, `콘텐츠 제작`)를 이 순서로, 섹션별 목적 문장과 함께 선언한다. 폐지 섹션 목록(`홈`, `실험실`)을 별도로 보유한다. 섹션 구성은 판단 3 · 검수 4 · 운영 6 · 콘텐츠 제작 2이며 `audit`은 운영에 배치한다.
    - 파생 접근자(`ADMIN_CONSOLE_MENU_LIST`, `getAdminConsoleMenu`, `findAdminConsoleMenu`, `getAdminConsoleSection`, `getAdminConsoleMenuIdsBySection`, `isRetiredAdminSectionLabel`, `getAdminConsoleMenuPendingDomains`)를 노출한다. `findAdminConsoleMenu`는 신뢰할 수 없는 문자열을 받아 `null`을 반환한다.
    - 표기는 맛집·제보·검수·동선 낱말을 쓰고 금지 낱말(식당, 음식점, 업소, 가게, 신청, 문의, 심사, 경로, 루트)을 쓰지 않으며, 로마자는 KPI·OCR만 허용한다. `href`·`priority`·`badge` 필드는 두지 않는다(읽히지 않으므로).
    - _요구사항 1.1, 1.2, 1.3, 1.9, 1.10, 2.4, 2.6, 4.1, 5.1, 5.2, 5.3, 5.4, 5.9, 8.7, 16.1, 16.5, 16.10_

  - [ ] 1.2 콘솔_시각_체계 모듈 작성
    - `apps/web/lib/admin/console-tone-scale.ts`를 신설한다. 중립_계조 6단계를 `--foreground` + 불투명도 조합으로 정의하고 단계별 CSS 변수 이름(`--admin-tone-1`..`6`)과 `fillOnlySafe` 판정을 보유한다. 소스에 16진수·`rgb`·채도 있는 `hsl` 리터럴을 두지 않는다.
    - 상태_색상 3역할(`오류`, `경고`, `성공`)을 선언하고 오류에만 `--destructive`를 배정하며 경고·성공은 `token: null` + 대체 계조 단계로 둔다(요구사항 9-17 경로). 모서리 반경 3단계(카드 24px, 제어 12px, 표식 완전 원형), 실선 두께 1px, 막대 끝 반경 4px, 카드_메타_행 11px·최소 16px 상수를 선언한다.
    - 계열 배정 함수 `getSeriesToneAssignment(seriesCount)`(단계 5·6은 단계 2 경계선 동반, 7 이상이면 `requiresNonToneChannel`)와 명암비 계산 순수 함수 `getToneStepContrastRatio(step, surface, mode)`, 막대 반경 축소 함수 `getBarEndRadius(thickness)`를 노출한다.
    - _요구사항 9.1, 9.2, 9.3, 9.4, 9.5, 9.16, 9.17, 11.1, 11.2, 11.3, 11.4, 11.5, 11.13, 11.14, 12.1, 12.2_

  - [ ] 1.3 시각화 대응표 모듈 작성
    - `apps/web/lib/admin/console-visualization-map.ts`를 신설한다. 11개 (메뉴 ID, 시각화 형태) 조합을 `CONSOLE_VIZ_BINDINGS`로 선언하고 각 조합에 운영 질문(60자 이내), 근거 데이터 라벨(40자 이내), 형태별 최소 점 개수(1 또는 2)를 붙인다. 형태는 10종이며 `activity-heatmap`이 `pipeline`·`audit` 두 메뉴에 배정된다.
    - `getConsoleVizBindings(menuId)`를 노출하고, 대응표에 없는 6개 메뉴(`map-overlays`, `banners`, `routes`, `users`, `storyboard`, `youtube-thumbnail-generator`)는 빈 배열을 반환한다.
    - _요구사항 10.1, 10.2, 10.3, 10.4, 10.11_

  - [ ] 1.4 모듈_그리드 검색 순수 함수 작성
    - `apps/web/lib/admin/console-menu-search.ts`를 신설한다. `filterAdminConsoleMenus({ committedQuery, section })`가 섹션 필터를 먼저, 검색(앞뒤 공백 제거, `ko-KR` 소문자, 표시 제목·목적 문장 부분 문자열)을 뒤에 AND로 적용해 `ADMIN_CONSOLE_MENU_LIST`의 부분 수열을 반환한다. 길이 검사를 함수에 두지 않는다(입력 요소 `maxLength`로 처리).
    - 컴포넌트와 성질 시험이 같은 함수를 쓰도록 순수 함수로 유지한다.
    - _요구사항 13.3, 13.4, 13.11, 13.12, 13.13, 13.16_

  - [ ] 1.5 아이콘 대응·고정 문구 모듈 작성
    - `apps/web/lib/admin/console-menu-icons.ts`를 신설해 메뉴 ID → lucide 아이콘 대응을 `satisfies Record<AdminConsoleMenuId, …>`로 선언한다. 정의 계층과 분리해 서버 번들에 아이콘이 유입되지 않게 한다.
    - `apps/web/lib/admin/console-messages.ts`를 신설해 `CONSOLE_FIXED_MESSAGES` 고정 한국어 문구 집합(데이터 실패·세션 만료·모듈 부재·순서 로드/저장/성공/초기화·레거시 링크·미해석 모듈·시각화 빈/실패/부족·목표 미승인·생성 불가·그리드 빈)을 선언한다. 모델생성 표기는 초안/제안만 쓰고 확정·사실·완성·최종을 쓰지 않는다.
    - _요구사항 2.3, 16.4, 16.6_

  - [ ]* 1.6 메뉴_레지스트리 형태 성질 시험
    - `apps/web/tests-unit/admin-console-menu-registry.test.ts`를 신설한다. 15개 항목을 열거해 단정한다.
    - **Property 1: 레지스트리 형태 불변식** — 항목 수 15, 메뉴 ID 유일, 7개 필드 존재·비공백, 산출물_성격 3값 중 하나, 1차 출처 1~3개, 섹션 4값 중 하나이며 섹션별 개수 3·4·6·2.
    - **Validates: Requirements 1.1, 1.2, 1.3, 1.7, 1.8, 1.9, 1.10, 4.1, 5.1, 5.2, 5.3, 5.4, 21.1, 21.13**

  - [ ]* 1.7 표기 규칙 성질 시험
    - 같은 파일에 표기 성질을 추가한다.
    - **Property 2: 표기 규칙 불변식** — 표시 제목 유니코드 14자 이내·최대 10자·상호 중복 없음, 표시 제목·목적·담당 업무·대표 작업에 한글 1자 이상, 금지 낱말 부재, 로마자는 KPI·OCR만.
    - **Validates: Requirements 1.3, 16.1, 16.2, 16.8, 16.10, 16.11**

  - [ ]* 1.8 중립_계조 구분 가능성 성질 시험
    - `apps/web/tests-unit/admin-console-tone-scale.test.ts`를 신설한다. 토큰 문자열을 파싱해 sRGB 상대 휘도로 명암비를 실측한다.
    - **Property 13: 중립_계조 구분 가능성** — 계열 수 2~6과 라이트·다크 조합에서 배정 단계가 서로 다르고 개수가 계열 수와 같으며 인접 단계 합성 명도 차 8퍼센트포인트 이상, 도형 채움 또는 경계선과 카드 배경 대비 3:1 이상.
    - **Validates: Requirements 9.1, 9.5, 9.11, 12.1, 12.2**

  - [ ]* 1.9 고정 상수·문구 단위 시험
    - `apps/web/tests-unit/admin-console-tone-constants.test.ts`를 신설해 중립_계조 6단계·상태 3역할·반경 3단계(카드 24·제어 12)·실선 1px·막대 반경 4px·메타 행 11px·오류=`--destructive`·경고/성공 슬롯 1개 이하를 단정하고, `getBarEndRadius`의 두께 미만 축소 경계 사례를 확인한다.
    - _요구사항 9.3, 9.4, 11.1, 11.2, 11.4, 11.5, 11.13, 11.14, 21.6_

- [ ] 2. 파생 계층 변경 (라우팅·순서 정규화)
  - [ ] 2.1 메뉴_라우터를 레지스트리에서 파생
    - `apps/web/lib/admin/admin-module-routing.ts`에서 `ADMIN_CONSOLE_MODULE_IDS`를 `ADMIN_CONSOLE_MENU_IDS` 재수출로 대체한다. 공개 함수 시그니처는 전부 유지한다. 정규_링크 생성 질의를 `module`·`video_id`·`issue`·`reason` 4개로 한정하고 `overview`는 `module`을 붙이지 않는다.
    - `getAdminModuleStateWarning`의 미해석 `module` 값이 안내 문구·치환 주소·브라우저 제목 어디에도 새지 않도록 보강한다. `view`/`tab` 레거시 링크는 검수 메뉴로 해석 후 정규_링크로 치환하고 고정 안내 문구를 표시한다.
    - _요구사항 2.1, 2.2, 6.2, 6.3, 6.4, 6.5, 6.10, 6.11, 6.12_

  - [ ] 2.2 순서_정규화기를 레지스트리에서 파생하고 전체 되돌림 추가
    - `apps/web/lib/admin/sidebar-order.ts`에서 `ADMIN_SIDEBAR_SECTIONS`·`ADMIN_SIDEBAR_ITEM_IDS`·`DEFAULT_ADMIN_SIDEBAR_ORDER`를 레지스트리에서 파생한다. 폐지 섹션 이름(`홈`, `실험실`) 감지 시 부분 보존 없이 새 기본 순서 전체를 반환하는 분기를 추가한다.
    - `normalizeAdminSidebarOrder`(기존 시그니처 유지)와 되돌림 사유(`"retired-section"` | `"cross-section-item"` | null)를 함께 반환하는 `normalizeAdminSidebarOrderWithReason`을 노출한다. 결과는 항상 4개 섹션과 15개 메뉴 ID를 각각 1회 포함하고 각 메뉴는 자신의 기본 섹션 아래에만 놓인다.
    - _요구사항 5.5, 5.6, 5.9, 7.8, 7.9_

  - [ ] 2.3 기존 순서 시험을 새 구성에 맞춰 갱신
    - `apps/web/tests-unit/admin-sidebar-order.test.ts`의 섹션 키 단정을 `홈`→`판단`, `실험실`→`콘텐츠 제작`으로 바꾸고 운영 6개·콘텐츠 제작 2개 구성으로 재작성한다. ID 순서 단정을 레지스트리 순서 기준으로 정정한다. 이 갱신 없이는 기존 시험이 깨지므로 필수다.
    - _요구사항 5.1, 5.2, 5.4, 21.9_

  - [ ]* 2.4 순서_정규화기 멱등성 성질 시험
    - `admin-sidebar-order.test.ts`에 추가한다. `mulberry32` 기반 결정적 생성기로 100개 이상 사례(객체 아닌 값·빈 객체·알 수 없는/폐지된 섹션 이름·알 수 없는/중복/누락 메뉴 ID·뒤바뀐 순서·교차 배치를 각각 1개 이상 포함)를 열거한다.
    - **Property 4: 순서_정규화기 멱등성** — 1회 적용 결과와 2회 적용 결과가 같다.
    - **Validates: Requirements 7.10, 21.2**

  - [ ]* 2.5 순서_정규화기 결과 불변식 성질 시험
    - **Property 5: 순서_정규화기 결과 불변식** — 결과가 4개 섹션 전부와 15개 메뉴 ID를 각각 정확히 1회 포함하고 각 메뉴 ID는 자신의 기본 섹션 아래에만 나타난다.
    - **Validates: Requirements 5.5, 5.6, 7.8, 7.9, 21.2**

  - [ ]* 2.6 폐지 섹션·교차 배치 전체 되돌림 성질 시험
    - **Property 6: 폐지 섹션 및 교차 배치 전체 되돌림** — 폐지 섹션 이름을 포함한 저장값과 이동 메뉴(`insights`, `llm`, `routes`, `audit`)를 이전 섹션 키 아래에 담은 저장값에 대해 결과가 새 기본 순서와 완전히 같고 되돌림 사유가 함께 보고된다.
    - **Validates: Requirements 5.5, 5.6, 5.8, 5.11, 21.2**

  - [ ]* 2.7 정규_링크 왕복 성질 시험
    - `apps/web/tests-unit/admin-module-routing.test.ts`를 신설한다. 15개 메뉴 ID와 `video_id`·`issue`·`reason` 조합, 그리고 5개 잘못된 형식 입력(빈 문자열·알 수 없는 ID·앞뒤 공백·대소문자 변형·질의 붙은 값)을 포함한다.
    - **Property 7: 정규_링크 왕복** — 생성 후 재해석한 메뉴 ID가 원래와 같고 보존 질의 값이 원래 문자열과 같으며 질의 이름이 4개를 넘지 않고 `overview`에 `module`이 없다. 잘못된 형식은 해석 실패로 보고된다.
    - **Validates: Requirements 6.2, 6.5, 6.9, 21.5**

  - [ ]* 2.8 정규_링크 멱등성 성질 시험
    - **Property 8: 정규_링크 멱등성** — `/admin` 질의 조합에 대해 정규_링크 생성을 두 번 적용한 결과가 한 번 적용한 결과와 같다.
    - **Validates: Requirements 6.11**

  - [ ]* 2.9 결정적 생성기 헬퍼 작성
    - `apps/web/tests-unit/helpers/deterministic-generator.ts`를 신설한다. `mulberry32(seed)`와 `generateSidebarOrderCases`, `generateSearchQueryCases`, `generateCanonicalHrefCases`를 노출하고 요구사항이 열거한 부류를 각각 1개 이상 포함하도록 구성한다. 성질 시험들이 공유한다.
    - _요구사항 7.10, 7.11, 21.2, 21.7_

- [ ] 3. 순서_설정_API 본문 실패 정정
  - [ ] 3.1 본문 실패 시 저장 생략·고정 코드 응답 적용
    - `apps/web/app/api/admin/preferences/sidebar-order/route.ts`에서 `readBoundedJsonRequest` 실패를 `null`로 흡수하던 경로를 제거한다. 실패 시 상한 초과 413(`ADMIN_BODY_TOO_LARGE`), 매체 유형 415(`ADMIN_UNSUPPORTED_MEDIA_TYPE`), 그 외 400(`ADMIN_BODY_UNREADABLE`)으로 저장 없이 반환한다. 순서 값이 객체가 아니면 400으로 거부한다.
    - `requireAdmin` → 동일 출처 검증 → 본문 판독 → 서비스 롤 클라이언트 생성 순서를 유지해 실패 경로에서 `createSupabaseServiceRoleClient`와 `upsert`가 실행되지 않게 한다. UUID 형식이 아닌 관리자 식별자는 저장소 접근 없이 정규화 결과만 반환한다. 성공·오류 모든 분기에 `Cache-Control: no-store`를 붙이고 상태 코드를 `ADMIN_API_STATUS_CODES` 집합으로 한정한다. 오류 기록은 메뉴/도메인·작업·고정 코드·시각 4항목만 남긴다.
    - _요구사항 7.12, 7.13, 7.14, 7.16, 17.5, 17.7, 17.10, 17.11, 19.3_

  - [ ] 3.2 선호도·트렌드 요청 보안 시험 갱신
    - `apps/web/tests-unit/preference-trend-request-security.test.ts`를 본문 실패 처리 변경에 맞춰 갱신한다. 상한 초과·매체 유형·형식 오류 각각에 대해 저장 생략과 열거된 고정 상태 코드·`no-store`를 단정한다. 기존 시험이 깨지므로 필수다.
    - _요구사항 7.12, 7.16, 17.5, 17.11, 21.9_

  - [ ]* 3.3 순서 저장 왕복 성질 시험
    - `apps/web/tests-unit/admin-sidebar-order-api.test.ts`를 신설한다. 저장소 계층을 모사(in-memory)해 100개 이상 정규화 값을 왕복시킨다.
    - **Property 16: 순서 저장 왕복** — 같은 계정에서 사이 저장이 없을 때 저장 후 조회 결과가 저장한 정규화 값과 같다.
    - **Validates: Requirements 7.11**

  - [ ]* 3.4 순서 저장 실패 시 기존 값 보존 성질 시험
    - **Property 17: 순서 저장 실패 시 기존 값 보존** — 읽을 수 없는 본문(JSON 아님·형식 오류·4096바이트 초과·길이 불일치·순서 값 없음·객체 아님)에 대해 저장을 생략하고 기존 값을 유지하며 열거된 고정 코드를 반환한다.
    - **Validates: Requirements 7.12, 7.16, 17.5, 17.11**

- [ ] 4. 체크포인트 — 정의·파생·순서 API 검증
  - 모든 시험이 통과하는지 확인하고, 의문이 생기면 사용자에게 질문한다.

- [ ] 5. 사이드바 추출
  - [x] 5.1 `AdminConsoleSidebar` 컴포넌트 작성
    - `apps/web/components/admin/console/AdminConsoleSidebar.tsx`를 신설하고 `AdminConsoleOverview.tsx`의 `renderMenuItem`·드롭다운·사이드바 렌더·`getSidebarBadgeClassName`·`sidebarSections`를 이동한다. 데스크톱 목록·접힌 레일·모바일 드롭다운을 레지스트리에서 파생하고 제목·섹션 이름 문자열을 직접 선언하지 않는다.
    - 섹션 배지를 4개 섹션 전부 동일한 중립_계조 단계로, 활성 메뉴 강조를 `bg-primary` 대신 계조 대비로 제공한다. 활성 메뉴에만 `aria-current="page"`를 데스크톱·모바일 각각에서 부여한다. 두께 2px·대비 3:1 이상 초점 표시, 한국어 탐색 랜드마크 이름, 15개 선택 제어에 표시 제목 포함 접근성 라벨, 목적 문장 `aria-describedby` 안내(초점/진입 후 120ms 이내)를 제공한다. 대기_배지는 5.2 훅을 소비한다.
    - _요구사항 1.4, 1.5, 6.6, 9.7, 9.8, 14.1, 14.2, 14.3, 14.4, 14.7, 15.1, 15.3, 16.9_

  - [x] 5.2 대기_배지 훅 작성
    - `apps/web/components/admin/console/use-admin-pending-badges.ts`를 신설한다. `/api/admin/pending-counts`를 60초 이하 간격으로 재조회하고, 레지스트리 `pendingDomains`가 선언한 도메인 건수만 합산한다(`submissions` = `restaurant_submissions` + `restaurant_recommendation_requests`, `reviews` = `reviews`). 나머지 13개는 `hidden`.
    - `PendingBadgeState`를 판별 합집합으로 반환한다: 1~99 정수·100 이상 `99+`, 접근성 라벨에 비축약 정수, 접힌 상태 점 표식, `readiness.status === "degraded"` 부분 집계 표식, `asOf` 180초 이상 과거 지연 표식, 조회 실패 시 전 메뉴 배지 생략. 상태_색상 토큰을 쓰지 않는다.
    - _요구사항 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 8.7, 8.8, 8.9, 8.10, 8.11_

  - [x] 5.3 순서 편집기와 조회·저장 훅 작성
    - `apps/web/components/admin/console/use-admin-sidebar-order.ts`와 `AdminConsoleSidebarOrderEditor.tsx`를 신설하고 기존 순서 편집 렌더·`loadSidebarOrder`·`persistSidebarOrder`를 이동한다. 조회 실패 시 기본 순서 표시·저장 미전송·고정 안내, 진행 중 저장 1건 잠금(이동·초기화 제어 비활성), 실패 시 임시 순서 유지·자동 재시도 없음·고정 안내, 성공 시 응답 순서로 교체·성공 문구를 처리한다.
    - `normalizeAdminSidebarOrderWithReason`으로 되돌림 사유를 판정하고 적재 후 처음 1회만 초기화 안내를 표시한다(`useRef`로 표시 여부 기억, 재수신 시 미표시). 편집 토글 `aria-pressed`와 상태 aria-live 1회 알림, 키보드 한 칸 이동·초점 유지를 제공한다.
    - _요구사항 5.7, 5.10, 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7, 7.15, 14.8, 14.10_

  - [x]* 5.4 대기_배지 합산 성질 시험
    - `apps/web/tests-unit/admin-sidebar-pending-badge.test.ts`를 신설한다. 다양한 대기 건수 응답과 15개 메뉴 조합을 결정적으로 생성한다.
    - **Property 12: 대기_배지 합산 불변식** — 배지 표시 메뉴가 정확히 2개, 표시 건수가 선언 도메인 합과 같은 0 이상 정수, 접근성 라벨에 비축약 정수 포함, 조회 실패 시 15개 전부 미표시.
    - **Validates: Requirements 8.1, 8.2, 8.4, 8.6, 8.7, 8.9**

  - [x]* 5.5 순서 조회·저장 훅 단위 시험
    - 조회 실패 시 저장 미전송, 진행 중 1건 잠금, 실패 시 임시 순서 유지·재시도 없음, 되돌림 안내 1회 표시를 단정한다.
    - _요구사항 7.2, 7.6, 7.15, 5.7, 5.10_

- [ ] 6. 모듈_셸 변경과 15개 적용
  - [x] 6.1 `AdminEmbeddedModuleShell` 계조·레지스트리 적용
    - `apps/web/components/admin/AdminEmbeddedModuleShell.tsx`에서 `hideHeader` 내부 파생을 제거하고, `title`·`summary` 프롭 대신 `menuId`만 받아 레지스트리에서 표시 제목·목적 문장을 조회한다. 제목 그라디언트/투명 텍스트를 단계 1 단색으로, 아이콘 `text-primary`를 단계 2로 바꾼다. 작업 영역 `aria-labelledby`를 제목 요소 식별자와 일치시키고 산출물_성격 데이터 속성을 부여한다. 15개 메뉴 전부가 이 셸을 쓰고 머리말 생략 설정을 제공하지 않는다.
    - _요구사항 3.1, 3.2, 3.6, 3.10, 4.7, 9.9, 15.6, 16.9_

  - [x] 6.2 활성 메뉴 전환 알림과 브라우저 제목 파생
    - `AdminConsoleOverview.tsx`의 aria-live 영역을 활성 메뉴 전환 시 표시 제목 1개로 교체하고 추가 알림 문자열을 만들지 않도록 정정한다. 브라우저 제목(`useDocumentTitle` 등)이 활성 메뉴 ID로 레지스트리를 조회한 표시 제목과 관리자 콘솔 문자열만 포함하도록 `activeModuleLabel` 삼항식 대신 레지스트리 파생으로 교체한다.
    - _요구사항 2.2, 3.8, 6.7_

- [x] 7. 골격 화면과 모듈_패널 대응 추출
  - [x] 7.1 `AdminConsoleModuleSkeleton` 전수 대응 작성
    - `apps/web/components/admin/console/AdminConsoleModuleSkeleton.tsx`를 신설하고 기존 골격 화면 로직을 이동한다. 메뉴 ID → 골격 형태를 `satisfies Record<AdminConsoleMenuId, ModuleSkeletonShape>`로 선언하고, `regions`를 완료 화면 주요 영역과 1:1로 데이터 선언해 시험이 같은 값을 읽게 한다. 머리말 하단 기준선 변화 4px 이내를 유지한다.
    - _요구사항 3.3, 3.4, 3.13_

  - [x] 7.2 `module-panel-registry` 지연 로딩 대응 작성
    - `apps/web/components/admin/console/module-panel-registry.tsx`를 신설하고 15개 `dynamic()` 선언을 `satisfies Record<AdminConsoleMenuId, …>`로 모은다. `loading: () => null`인 7개 모듈을 `loading: () => <AdminConsoleModuleSkeleton menuId="…" />`로 교체한다. 활성 메뉴에 대응 항목이 없으면 `CONSOLE_FIXED_MESSAGES.modulePanelMissing`을 표시하고 사이드바 선택 기능을 유지한다.
    - _요구사항 2.3, 2.11, 3.4_

  - [x]* 7.3 골격·패널 대응 소스 계약 시험
    - `apps/web/tests-unit/admin-console-module-panel-source.test.ts`를 신설해 15개 `dynamic()` 선언 존재, `loading: () => null` 부재, 골격 대응·패널 대응 키가 15개 메뉴 ID와 동일함을 단정한다.
    - _요구사항 3.4, 2.3, 21.3_

- [x] 8. 공통 완성도 상태와 산출물_성격 표식
  - [x] 8.1 15개 패널 상태 표식 규약 적용
    - 15개 모듈_패널이 로딩·빈·오류·권한 상태와 대표 작업 제어를 갖도록 상태 표식 데이터 속성(`data-admin-module-state`, `-menu`, `-output-kind`)을 부여한다. 오류는 고정 한국어 문구 + 다시 시도(같은 대상·조건 재발행), 권한 실패는 고정 안내 + 활성 메뉴 정규_링크 복귀 재로그인 제어를 제공한다. 한 시점 상태 표식은 최대 1개, 대표 작업은 360·1280px 최초 화면에서 세로 스크롤 없이 도달 가능하게 둔다.
    - _요구사항 3.5, 3.6, 3.7, 3.9, 3.11, 3.12, 4.2, 4.3, 4.7, 16.4, 19.1_

  - [x]* 8.2 파생 집합 동일성 성질 시험
    - `admin-console-menu-registry.test.ts`에 추가한다. 라우팅·사이드바·정규_링크·셸 머리말·모듈_그리드·순서 정규화기 허용·골격 대응·패널 대응 키 집합을 모두 수집한다.
    - **Property 3: 파생 집합 동일성** — 각 집합이 15개 원소를 갖고 순서 무관하게 레지스트리 메뉴 ID 집합과 동일하다.
    - **Validates: Requirements 2.1, 2.4, 2.7, 2.10, 21.1**

- [x] 9. 모듈_그리드 신설
  - [x] 9.1 `AdminConsoleModuleGrid` 작성
    - `apps/web/components/admin/console/AdminConsoleModuleGrid.tsx`를 신설한다. 15개 카드를 레지스트리 순서로, 표시 제목·목적 문장·섹션 이름·대표 작업 이름을 표시한다. `filterAdminConsoleMenus`를 소비하고 검색 입력(`maxLength=64`)과 섹션 필터를 AND 결합한다. 한글 IME 조합 중에는 `committedQuery`를 갱신하지 않는다(`compositionStart/End` + `onChange` 플래그 보호).
    - 표시 카드 수 변경 시 현재 수·전체 15를 포함한 문장을 `aria-live="polite"`로 200ms 이내 알린다. 결과 0건이면 빈 상태 문장과 필터 해제 제어를 표시한다. 반응형 열(767px 이하 1열·768~1279 2열·1280 이상 3열), 360px 가로 넘침 없음, 대표 작업 접근성 이름에 표시 제목+작업 이름 포함, 대시보드 지표 요약 아래 배치를 적용한다. 전환은 CSS(`motion-reduce:transition-none`)만 쓴다.
    - _요구사항 13.1, 13.2, 13.3, 13.4, 13.5, 13.6, 13.7, 13.8, 13.9, 13.10, 13.14, 13.15, 12.6, 12.7, 12.13_

  - [x]* 9.2 모듈_그리드 결과 크기 성질 시험
    - `apps/web/tests-unit/admin-console-module-grid.test.ts`를 신설한다. `generateSearchQueryCases`로 100개 이상(빈·공백만·1자·일치 없음·부분 일치·대소문자 변형·64자 초과·한글·로마자 혼용) 생성한다.
    - **Property 9: 모듈_그리드 결과 크기 한계** — 표시 카드 수가 0~15이고 검색 빈·공백만 + 섹션 미선택이면 정확히 15.
    - **Validates: Requirements 13.11, 13.12, 21.7**

  - [x]* 9.3 모듈_그리드 결과 부분집합 성질 시험
    - **Property 10: 모듈_그리드 결과 부분집합** — 표시 카드 메뉴 ID 집합이 레지스트리 집합의 부분집합이고 섹션 필터 시 모든 카드 섹션이 선택 섹션과 같다.
    - **Validates: Requirements 13.4, 13.13, 21.7**

  - [x]* 9.4 검색 단조성 성질 시험
    - **Property 11: 검색 단조성** — 문자열 A와 접두사 관계 B, 동일 섹션 필터에서 B의 카드 집합이 A의 부분집합이다.
    - **Validates: Requirements 13.16**

- [x] 10. 데이터_시각화 계층 신설
  - [x] 10.1 공통 카드·메타행·요약·계조 훅·상태 판별 작성
    - `apps/web/app/globals.css`에 `[data-admin-console-tone-scale="v1"]` 계조 변수 블록을 추가한다(토큰 참조만, 리터럴 없음). `apps/web/hooks/use-console-tone-scale.ts`를 신설해 `getComputedStyle`로 8개 값을 읽고 `MutationObserver`로 `dark` 토글에 반응하며 해석 전에는 recharts 도형을 렌더링하지 않는다(문자열 요약은 표시).
    - `components/admin/viz/ConsoleVizCard.tsx`, `ConsoleCardMetaRow.tsx`, `ConsoleVizSummary.tsx`와 `lib/admin/console-viz-state.ts`(`resolveConsoleVizState` 순수 함수, 판별 합집합 로딩/오류/빈/부족/정상)를 신설한다. 카드 24px 반경·1px 경계선·운영 질문 문장·근거 라벨·도형 슬롯(`aria-hidden`, 내부 초점 요소 0)·최하단 카드_메타_행(좌 24자 말줄임·우 `tabular-nums` 비축약)을 제공한다. 값 안내는 한 번에 하나, 초점 시 동일 내용, Esc 시 제거·초점 유지로 처리한다.
    - _요구사항 9.5, 9.6, 9.10, 9.11, 10.5, 10.6, 10.7, 10.8, 11.6, 11.7, 11.8, 11.9, 11.10, 11.11, 11.15, 12.4, 12.5, 12.8, 12.9, 12.10, 12.14, 15.8_

  - [x] 10.2 운영-필수 시각화 형태 작성
    - `components/admin/viz/` 아래에 운영 판단에 직접 쓰이는 형태를 작성한다: KPI 스파크라인 카드, 반원 게이지 호, 단계 퍼널, 불릿 바(목표 승인 게이트 — 미승인 시 `ReferenceLine` 미렌더·미승인 문장 표시), 활동 히트맵, 컴팩트 스파크라인 행. 목표 기준값은 `ReviewThroughputTarget` 판별 합집합으로 모델링하고 소스에 상수 목표값을 두지 않는다.
    - 형태별 최소 점 개수 미달 시 도형 생략·문자열 요약·안내만, 일부 계열만 충족 시 충족 계열만 계조 렌더·0점 계열 이름 요약 표시를 적용한다.
    - _요구사항 10.1, 10.9, 10.10, 10.12_

  - [x]* 10.3 보조·분석 시각화 형태 작성 (선택)
    - 운영-필수 밖의 분석 형태를 작성한다: `insights` 트리맵 타일·범위 밴드 영역, `restaurants` 계조 누적 막대, `restaurant-refresh-history` 워터폴 델타 단계. 요구사항 10-9의 11개 조합 전수 일치와 요구사항 21-10 전체 통과에는 이 작업 완료가 필요하다.
    - _요구사항 10.1, 10.9_

  - [x] 10.4 차트 색을 계조로 교체하고 카드 기하 통일
    - `AdminConsoleOverview.tsx`의 `adminDashboardFocusPalette` 8개 16진수와 트리맵 `#cbd5e1`·`#e2e8f0`을 `useConsoleToneScale()` 반환값으로 전면 대체한다. 이미 토큰 참조인 격자·축 색은 계조 모듈로 이관만 한다. 막대 끝 4px·선 끝 둥근 마감·카드 24px 반경을 데이터_시각화 카드 전체에 적용한다. `#f59e0b`·`#f43f5e`가 표현하던 경고·위험 의미는 상태_색상 역할로 옮긴다.
    - _요구사항 9.14, 9.15, 11.2, 11.5, 11.6, 12.1, 12.2_

  - [x]* 10.5 시각화 상태 배타성 성질 시험
    - `apps/web/tests-unit/admin-console-viz-state.test.ts`를 신설한다. 요청 상태와 계열 집합 조합을 결정적으로 생성한다.
    - **Property 15: 시각화 상태 배타성** — 판별 결과가 로딩·오류·빈·부족·정상 중 정확히 하나이고 정상에서만 도형 렌더, 일부 계열만 충족 시 빈이 아니라 정상이며 0점 계열 이름이 요약에 포함된다.
    - **Validates: Requirements 3.11, 10.5, 10.6, 10.11, 10.12**

  - [x]* 10.6 시각화 색조 리터럴 부재 소스 계약 시험
    - `apps/web/tests-unit/admin-console-viz-source.test.ts`를 신설해 계열 색 지정에 16진수·`rgb`/`rgba`·채도 있는 `hsl`/`hsla`·색조 이름 유틸리티 클래스 4부류가 없음과, 셸 색 사용이 6단계+3역할 허용 목록에 한정됨을 단정한다. `hsl(var(--…))`는 허용한다.
    - _요구사항 9.14, 9.15, 21.6_

- [x] 11. `llm` 데이터 연결, `audit` 개명, 가드레일과 개인정보 경계
  - [x] 11.1 `AdminOpsAssistPanel` 작성 (`llm` 읽기 전용 데이터 연결)
    - `apps/web/components/admin/console/AdminOpsAssistPanel.tsx`를 신설해 `LlmSessionWorkspace`를 대체한다. `/api/admin/pending-counts`·`/api/admin/system-status`·`/api/admin/audit-events`를 GET으로만 조회하고 변경 호출 경로를 두지 않는다. 각 제안 항목에 초안/제안 표기와 근거 출처 이름을 붙이고, 변경 제안은 담당 메뉴 위험_작업_절차로 위임하며 위임 대상 표시 제목을 표시한다. 생성 준비 불가 시 조회 결과를 유지한 채 생성 제어만 비활성화하고 고정 문구를 표시한다.
    - _요구사항 4.4, 4.5, 4.6, 4.10, 4.11_

  - [x] 11.2 `AdminAuditEventsPanel` 개명·이관
    - `AuditPlaceholder`를 `apps/web/components/admin/console/AdminAuditEventsPanel.tsx`로 이관·개명하고 섹션을 운영으로 옮긴다. 기존 감사 범위 표기(`data-admin-audit-coverage`, `universal: false`, 과장 문구 부재)와 로딩·빈·오류·세션만료 상태를 유지하고, 활동 히트맵과 카드_메타_행(좌: 부분 범위 문구+도메인, 우: 건수 최대 50), 개인정보 사고 대응 링크(자동 신고 완료 미주장)를 추가한다. 응답에 범위 필드가 없거나 전체 아님 표식이 거짓이면 범위 확인 필요 상태만 표시한다.
    - _요구사항 20.1, 20.2, 20.3, 20.4, 20.5, 20.6, 20.8, 20.9, 20.10_

  - [x] 11.3 위험_작업_절차와 관리자_API 가드레일 적용
    - 요구사항 18-1 열거 메뉴(restaurants·submissions·reviews·users·banners·map-overlays·routes·pipeline)의 위험 작업이 미리보기→확인→적용→재확인→감사 기록 5단계를 생략 없이 적용하도록 한다. 미리보기(식별 해시·영향 건수·대상 최대 50·600초 만료), 확인 문구 정확 일치·미리 채우지 않음, 불일치 누적 3회 해시 무효화, 만료·상태 변경 시 새 미리보기 요구, 동일 해시 재요청 시 최초 재확인 값 반환·중복 감사 없음을 구현한다.
    - 관리자_API 공통 순서(`requireAdmin` → 동일 출처 → 본문 상한 → 서비스 롤 클라이언트)와 `adminJson` no-store 헬퍼, `ADMIN_API_STATUS_CODES` 고정 집합, 목록 상한 절단, `backend`·외부 호출 10초 상한(`ADMIN_UPSTREAM_TIMEOUT`)을 적용한다. 크롤링·미디어·대량 생성·GDrive·대량 적재는 `backend`에 위임한다.
    - _요구사항 4.12, 16.3, 17.1, 17.2, 17.3, 17.4, 17.5, 17.6, 17.7, 17.8, 17.10, 17.11, 17.12, 18.1, 18.2, 18.3, 18.4, 18.5, 18.6, 18.7, 18.8, 18.9, 18.10_

  - [x] 11.4 개인정보_경계 적용
    - 표시·기록 경로에 `apps/web/lib/privacy/sanitize.ts`를 통과시킨다. 사용자 관리 화면은 8개 항목만·이메일 마스킹 표식, OCR은 정형 요약·고정 실패 코드만, 시각화 입력은 집계 값·분류 이름만(`ConsoleVizSeries` 타입에 식별자·좌표·OCR 필드 부재), 위치는 저장된 업소 좌표만(기기 위치 요청 없음)을 적용한다. 클라이언트 오류 보고는 메뉴 ID+고정 코드만 쓴다.
    - _요구사항 19.1, 19.2, 19.4, 19.5, 19.6, 19.8, 19.9_

  - [x] 11.5 사용자 관리 소스 계약 시험 갱신
    - `apps/web/tests-unit/admin-user-management-source.test.ts`에 8개 표시 항목 유지와 상태 표식 3종·산출물_성격 표식 단정을 추가한다. 메뉴 구성 변경으로 깨지므로 필수다.
    - _요구사항 4.9, 19.4, 21.3, 21.9_

  - [x] 11.6 맛집 최신화 소스 계약 시험 갱신
    - `apps/web/tests-unit/admin-restaurant-refresh-history-source.test.ts`에 상태 표식 3종과 워터폴 시각화 단정을 추가한다. 필수 갱신이다.
    - _요구사항 21.3, 21.9_

  - [x]* 11.7 가드레일·위험 작업 소스 계약과 단위 시험
    - `apps/web/tests-unit/admin-console-guardrail-source.test.ts`를 신설해 각 관리자_API 경로에서 `requireAdmin` 첫 등장이 `readBoundedJsonRequest`·`createSupabaseServiceRoleClient`·`.from(`·`fetch(`보다 앞섬, 고정 코드·상태 코드 집합·`no-store`, 금지 부류 12개 표시·기록 경로 부재, 감사 컴포넌트 이름에 자리표시 낱말 부재, 과장 감사 문구 6개 부재를 단정한다. 위험_작업_절차 미리보기·불일치·재확인·감사·만료·중복 차단을 단위로 확인한다.
    - _요구사항 17.9, 18.11, 19.7, 20.7, 20.10_

- [x] 12. 밝기 모드 선행 스크립트
  - [x] 12.1 첫 페인트 전 테마 적용 스크립트 추가
    - `apps/web/app/admin/layout.tsx`에 차단 인라인 스크립트를 추가해 `tzudong-admin-theme`를 읽고 첫 페인트 전에 `dark` 클래스를 설정한다. 저장값이 없거나 `light`·`dark`·`system`과 다르면 시스템 모드를 적용하고 그 값을 저장한다. 스크립트는 테마 문자열 1개만 다루고 금지 부류를 읽거나 기록하지 않는다.
    - _요구사항 12.4, 12.5, 12.12_

  - [x]* 12.2 밝기 모드 정보량 동등성 브라우저 시험
    - `apps/web/tests/admin-console-tone-parity.spec.ts`를 신설한다. 계조 해석이 `getComputedStyle` 의존이므로 실제 브라우저에서 확인한다.
    - **Property 14: 밝기 모드 정보량 동등성** — 같은 데이터에서 라이트·다크의 계열 수·라벨 집합·계열별 점 개수가 같다. 어느 표면이라도 계열 수가 다르면 실패.
    - **Validates: Requirements 12.3, 12.11**

- [x] 13. `AdminConsoleOverview` 통합 배선
  - [x] 13.1 삭제 상수 제거와 신설 컴포넌트 배선
    - `AdminConsoleOverview.tsx`에서 `consoleModules`·`sidebarSections`·`activeModuleLabel` 삼항식을 삭제하고 `AdminConsoleSidebar`·순서 편집기·모듈_셸·`module-panel-registry`·`AdminConsoleModuleGrid`를 배선한다. 대시보드 (KPI) 본문에 KPI 스파크라인 카드·반원 게이지 호·모듈_그리드를 지표 요약 아래에 배치한다. 셸 레이아웃·스크롤 소유권·모바일 크롬 로직은 제자리에 둔다.
    - _요구사항 2.5, 2.9, 13.15_

  - [x] 13.2 `AdminOverviewDashboard`를 `insights` 전용으로 확정
    - 이 트리에서 `AdminOverviewDashboard.tsx`는 경로(지도) 모듈이다. 영상 단위 트리맵(계조)·다구간 범위 밴드는 `AdminInsightsVisualizations`가 담당하고 대기 건수 조회를 하지 않는다. 대시보드 (KPI) 시각화는 채널 집계 방향·대기 배분만 다루고 영상 단위 계열 키를 두지 않는다.
    - _요구사항 4.2, 10.1_

  - [x] 13.3 콘솔 UI/UX 소스 계약 시험 갱신
    - `apps/web/tests-unit/admin-console-uiux-source.test.ts`의 삭제 상수 참조 단정을 레지스트리 참조로 바꾸고, 섹션 배지 색·활성 `bg-primary`·제목 그라디언트 단정을 계조 변수 단정으로 반전한다(존재→부재). 15개 셸 사용과 45개 상태 표식(15 메뉴 × 로딩·빈·오류) 단정을 추가한다. 필수 갱신이다.
    - _요구사항 3.9, 9.9, 9.15, 21.3, 21.9_

  - [x] 13.4 야간 회귀 워크플로 시험 갱신
    - `apps/web/tests-unit/nightly-regression-workflow.test.ts`의 회귀 대상 목록에 이 스펙에서 신설한 시험 파일을 등록한다. 필수 갱신이다.
    - _요구사항 21.9_

- [x] 14. 체크포인트 — 콘솔 통합 검증
  - 작업 1–13 콘솔 통합 단위 시험 17개 파일 / 131건 통과, 인접 콘솔 경로 시험 17건 통과, 실패 0. 작업 15 브라우저 스펙은 시작하지 않았다. 기존 CI 실패(`guardian.ts`, bun frozen-lockfile, `supabase-gen-types.mjs`)와 `admin-sidebar-order-hook.test.ts` placeholder, 작업 16.1 전체 `test:unit`·typecheck·playwright는 이 체크포인트에서 주장하지 않는다.

- [x] 15. 브라우저 시험 신설
  - [x]* 15.1 모듈 활성화·수화 시험
    - `apps/web/tests/admin-console-module-hydration.spec.ts`를 갱신해 15개 메뉴 활성화 시 골격→결과 전환과 `loading: () => null` 제거를 확인한다.
    - _요구사항 3.4, 4.2, 21.10_

  - [x]* 15.2 사이드바 정보 구조 시험
    - `apps/web/tests/admin-console-sidebar-ia.spec.ts`를 신설해 4개 섹션 이름·15개 제목·`aria-current`·대기_배지·접힌 상태 점 표식을 확인한다.
    - _요구사항 1.4, 5.1, 6.6, 8.1, 8.5_

  - [x]* 15.3 키보드 운용 시험
    - `apps/web/tests/admin-console-keyboard.spec.ts`를 신설해 건너뛰기 링크→사이드바→작업 영역 순서, 15개 초점·활성화, 순서 편집 키보드 조작, 드롭다운 초점 순환·복귀를 확인한다.
    - _요구사항 14.1, 14.5, 14.10, 14.11, 14.12, 21.11_

  - [x]* 15.4 모듈_그리드 브라우저 시험
    - `apps/web/tests/admin-console-module-grid.spec.ts`를 신설해 15개 카드·검색과 섹션 필터 AND·결과 수 알림·빈 상태와 해제·한글 IME 조합을 확인한다.
    - _요구사항 13.1, 13.5, 13.6, 13.14, 21.7_

  - [x]* 15.5 반응형 시험
    - `apps/web/tests/admin-console-responsive.spec.ts`를 신설해 360·768·1280px에서 사이드바 표현·15개 카드 접근·가로 넘침 0·767/768 경계 전환을 확인한다.
    - _요구사항 15.11, 21.12_

  - [x]* 15.6 증거 가드 헬퍼 작성
    - `apps/web/tests/helpers/evidence-guard.ts`를 신설해 증거 저장 전 6종 금지 항목(쿠키·요청 헤더·로컬 저장소·관리자 응답 본문 원문·표 원문·데이터베이스 응답 원문)을 검사하고 1건 이상이면 저장을 생략하고 종류 이름을 포함한 실패를 보고한다. 브라우저 시험이 공유한다.
    - _요구사항 19.10, 21.8_

- [ ] 16. 최종 검증
  - [ ] 16.1 세 검증 실행으로 실패 0·건너뜀 0 확인
    - `apps/web`에서 `bun run test:unit`과 `npm run typecheck:parity`를, 저장소 루트/`apps/web`에서 `npx playwright test`를 실행하고 실패 0건·건너뜀 0건을 확인한다. 선택(`*`) 시험 작업과 작업 10.3을 완료하지 않으면 요구사항 10-9·21-10의 전체 통과 형태에 도달하지 못하므로, 전체 통과를 주장하기 전 그 작업들이 완료되어 있어야 한다. 이 실행은 호스팅 프로덕션 상태나 법적 준수를 증명하지 않는다.
    - 실행 기록: 요구사항 21-10의 실패 0·건너뜀 0 형태는 도달하지 않았다. `bun run test:unit` 1937 pass / 19 fail / 1 error / 0 skip. `npm run typecheck:parity` exit 1이며 native 진단은 `lib/privacy/guardian.ts`(`{"type":"exit"}`) 1파일이다. `npx playwright test`는 시험 시작 전 exit 1(기본 webServer는 :3000 점유 거부; reuse 시 `tests/release-visual.spec.ts`가 `RELEASE_VISUAL_OUTPUT_DIR` 없이 로드 단계에서 중단). 나열된 기존 결함만으로 전체 통과가 성립하지 않아 16·16.1은 체크하지 않는다.
    - _요구사항 21.10_

## Notes

- `*`로 표시한 하위 작업은 선택이며 빠른 MVP를 위해 건너뛸 수 있다. 다만 요구사항 21은 검증_스위트를 산출물로 규정하고 21-10은 건너뜀 0건을 요구하므로, 최종 검증(16.1)의 전체 통과 형태는 선택 시험 작업까지 완료해야 성립한다.
- 기존 시험 파일 6개(21-9)의 갱신(2.3, 3.2, 11.5, 11.6, 13.3, 13.4)은 이 스펙의 구현 변경이 그 시험을 깨뜨리므로 선택이 아니라 필수다.
- 작업 0은 이 스펙의 다른 변경과 분리된 커밋으로 둔다. 파생 계층 변경(작업 2)과 사이드바 추출(작업 5)은 두 정의를 함께 참조하는 구간을 최소화하기 위해 같은 PR로 묶는 것이 안전하다.
- 성질 시험은 각 성질을 단일 시험으로 구현하고 `mulberry32` 결정적 생성기로 100회 이상 반복하며, 시험 상단에 성질 번호와 검증 요구사항을 주석으로 참조한다.
- 콘텐츠 패치는 새 헤드에서 시작해 `develop -> data -> main` 직렬 PR로 이동하며 외부 승인과 브랜치 보호를 따른다. 이 소스 트리는 병합·배포가 일어났다고 주장하지 않는다.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["0.1"] },
    { "id": 1, "tasks": ["1.1", "1.2", "1.3", "1.4", "1.5"] },
    { "id": 2, "tasks": ["1.6", "1.8", "1.9", "2.1", "2.2", "2.9"] },
    { "id": 3, "tasks": ["1.7", "2.3", "2.7", "3.1", "5.2", "5.3", "6.1", "7.1", "9.1", "10.1", "12.1"] },
    { "id": 4, "tasks": ["2.4", "2.8", "3.2", "3.3", "5.1", "6.2", "7.2", "9.2", "10.2", "10.3", "11.1", "11.2", "13.2"] },
    { "id": 5, "tasks": ["2.5", "3.4", "5.4", "5.5", "7.3", "8.1", "9.3", "10.4", "10.5", "11.3"] },
    { "id": 6, "tasks": ["2.6", "9.4", "10.6", "11.4", "11.5", "11.6", "13.1"] },
    { "id": 7, "tasks": ["8.2", "11.7", "12.2", "13.3", "13.4", "15.6"] },
    { "id": 8, "tasks": ["15.1", "15.2", "15.3", "15.4", "15.5"] },
    { "id": 9, "tasks": ["16.1"] }
  ]
}
```
