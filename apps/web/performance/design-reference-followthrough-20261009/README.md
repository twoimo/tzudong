# 디자인 레퍼런스 후속 감사 · 2026-10-09

12개 요청 URL 모두 현재 공개 홈 화면에 접근하여 1440×900 브라우저 캡처와 DOM 자료를 확보했다. 선택한 표·사이드바·상태 컴포넌트까지 추가로 읽고 비교했다. 기존 자료에는 **Tremor/shadcn의 채택 방향과 구현 증거**가 있으나, 검색한 source/docs/performance 범위에서 **12개 원본 각각의 탐색 → 선택 이유 → 실제 변경을 연결한 과거 증빙**은 찾지 못했다. 이번 결과는 현재의 대응 관계이며 과거 채택의 인과 증명으로 소급하지 않는다.

제품 소스, 의존성, 목표/Todo, 기존 증빙은 수정하지 않았다. 새 사이트·프로토타입·모델/유료 호출·게시·운영 mutation도 수행하지 않았다. 전체 공개/관리자 디자인 및 운영 검증의 완료를 의미하지 않는다.

## 기존 증빙 감사

| 주장/자료 | 확인한 근거 | 판단 |
| --- | --- | --- |
| 주 레퍼런스는 Tremor 표·차트·필터와 shadcn 메뉴·입력·대화상자 | `docs/operations/active-goal-scope-20261003.md` 디자인 결정, `ui-and-gemini-renewal-20261003.md` 공통 UI 변경 설명 | 명시된 선택 근거 있음. 아래 현재 코드와도 대응 |
| 12개를 열어 비교했다 | active-goal-scope의 서술 | 서술은 존재. 각 원본 캡처/컴포넌트 비교/선택-변경 연결 receipt는 좁은 검색에서 미발견 |
| 실제 심층 탐색 완료 | `project-request-todos-20261009.md` A001 | 해당 문서도 실제 탐색·채택 매핑을 미확인으로 유지 |
| Rare UI가 보안 확인으로 제한되었다 | 당시 active-goal-scope 설명 | 역사적 제한. 이번 공개 홈/컴포넌트 페이지는 접근 가능. 당시 결과를 삭제하거나 현재 제한으로 재사용하지 않음 |
| 기존 화면 증빙으로 원본 탐색을 대체할 수 있다 | 기존 UI artifact-map 및 렌더 증빙 | 쯔동 화면 검증과 외부 원본 탐색은 서로 다른 증거 |

검색은 요청된 12개 정확한 도메인, 디자인 결정/레퍼런스/채택 용어를 source/docs/performance에 한정했다. 검색되지 않은 대화·외부 문서 전체에 증거가 없다고 단정하지 않는다.

## 원본 12개 비교와 현재 구현 연결

각 행의 `NN-reference.png`는 screenshots 아래 실제 현재 홈 캡처다. 추가 컴포넌트 캡처는 아래 파일명으로 연결한다. 코드 경로는 apps/web 기준이다. ‘대응’은 현재 패턴의 적합성 평가이며 코드 복제·역사적 채택을 뜻하지 않는다.

| 원본·현재 접근 | 실제 읽은 화면/컴포넌트 | 고밀도 CMS 기준과 대응 | 채택 제외/미확인 |
| --- | --- | --- | --- |
| [Supahero](https://supahero.io/) · 접근 | 히어로 갤러리, 홈 캡처01 | 브랜드·이미지 탐색 보조. 공개 지도/사진 중심은 `components/home/map-panel-chrome.tsx`와 방향상 대응 | 큰 히어로/마케팅 여백을 관리자 본문 규칙으로 채택하지 않음. 각 외부 사례 사이트 전수 탐색 안 함 |
| [Dark Design](https://www.dark.design/) · 접근 | 카테고리·New/Popular, Software 필터 실제 선택(`02-software-filter.png`) | 대비·구분선·작은 필터 묶음. `styles/admin-ui.css` toolbar/경계와 대응 | 갤러리의 검은 배경을 앱 전체 강제하지 않음. 테마 전수 대비 측정 안 함 |
| [Mac App Supply](https://macapp.supply/) · 접근 | macOS 앱 분류/검색과 윈도·목록 미리보기, 캡처03 | 이름 있는 탐색·작업 도구·목록-상세. `AdminOperationsPanel.tsx` desktop inspector/mobile Sheet와 대응 | 네이티브 앱 설치/실행 안 함. 웹 텍스트 fetch timeout을 브라우저 실패로 보고하지 않음 |
| [Layers](https://www.getlayers.ai/) · 접근 | 템플릿·3D/영상/WebGL 소개와 [docs](https://www.getlayers.ai/docs), 캡처04(쿠키 배너 포함) | 브랜드 탐색 보조만. 기존 product motion의 짧은 패널 진입과 구별 | 영상 배경·몰입형 효과·AI 생성은 CMS 표/본문 채택 대상 아님. 유료/생성/템플릿 설치 안 함 |
| [Loadmore](https://loadmo.re/) · 접근 | 모바일 창작 사이트 갤러리·Minimal/Animation 분류, 캡처05 | 작은 필터·모바일 흐름 참고. `admin-ui.css` wrap/44px action과 대응 | 실험적 몰입 내비게이션 제외. 각 갤러리 사이트/실기기 동작 미확인 |
| [Beautiful UI](https://www.beautifului.dev/) · 접근 | 작업/승인/맥락 상태, Records/Filter/Diff 표. `06-records-table-stable.png`, `06-diff-table-stable.png` | 필터와 행 상태, 변경 전후·개수·확인 흐름. `AdminOperationsPanel.tsx` 상태/정렬/표, 관리자의 Preview→Confirm→Apply→Readback→Audit와 대응 | 이번에 확인한 비교 자료. 과거 채택 근거로 단정하지 않음. 데모 수치·confidence·한 번의 Apply를 운영 정책으로 복제하지 않음 |
| [BeUI](https://beui.dev/) · 접근 | Sortable List, 키보드/announcement 설명, tooltip·reduced-motion 자료; `07-sortable-list.png` | focus·키보드·motion 선택권. `components/ui/dialog.tsx`, `ScrollEffects.tsx`와 대응 | 장식 animation/유료 Data Table 코드·구매/설치 제외. 실제 a11y 전수 테스트 아님 |
| [Rare UI](https://www.rareui.com/components) · 접근 | [Bounce Sidebar](https://www.rareui.com/components/bouncesidebar), [Task List](https://www.rareui.com/components/tasklist); `08-bounce-sidebar.png` | 그룹/현재 항목/작업 상태. 관리자 이름 있는 sidebar 및 aria-current와 대응 | spring marker·행 재배치를 데이터 작업 기본값으로 채택하지 않음. 외부 코드 복제/라이브러리 추가 안 함 |
| [Transitions](https://transitions.dev/) · 접근 | panel/modal/menu/icon 전환과 장식 효과, 캡처09 | 짧은 패널·메뉴 전환 범위만 적합. `product-ui.css` 140ms 버튼/240ms reveal, reduced motion 대응 | 전체 페이지/표 행 움직임·confetti/gooey 제외. 모든 transition 실행 미확인 |
| [shadcn/ui](https://ui.shadcn.com/) · 접근 | [Data Table](https://ui.shadcn.com/docs/components/base/data-table) 실제 Columns 메뉴 선택(`10-data-table.png`), [Sidebar](https://ui.shadcn.com/docs/components/base/sidebar)(`10-sidebar.png`) | 필터/정렬/선택/메뉴/페이지·composition. 기존 `ui/table.tsx`, `ui/dialog.tsx`, AdminPageHeader/operations에 직접 대응하는 주 기준 | 현재 docs Base 변형과 기존 pinned Radix를 동일 코드로 주장하지 않음. 새 TanStack/primitive 버전 교체 안 함 |
| [21st.dev](https://21st.dev/) · 접근 | 검색 가능한 components/templates/themes, ShimmerButton/NumberTicker 예시, 캡처11 | 컴포넌트 발견용 보조. 작은 명확한 action과 공통 UI 재사용만 대응 | 균일한 CMS 밀도 표준으로 취급하지 않음. shimmer/counter를 데이터 상태로 쓰지 않음. 가입/설치 안 함 |
| [Tremor](https://www.tremor.so/) · 접근 | [Table](https://www.tremor.so/docs/ui/table)의 행/열·숫자 정렬·상태·footer(`12-table.png`), [공식 blocks](https://blocks.tremor.so/) | table/chart/filter를 주 구조로 선택한 기존 결정과 대응. admin-ui.css table/toolbar/footer, OperationsPanel의 행-상세 구조 | 홈페이지 마케팅 크기/여백은 CMS 기준 아님. 차트 전체·모바일 전수·실데이터 성능 미확인 |

## 적용 기준: 현재 소스에서 확인 가능한 요소

| 기준 | 현재 구현 | 증거의 한계 |
| --- | --- | --- |
| 작업 공간을 설명 카드보다 우선 | AdminPageHeader + AdminEmbeddedModuleShell; admin header desktop 최소57px/mobile61px, toolbar8×12px, gap8px | CSS/source 수치. 모든 화면에서 실측한 생산성 수치 아님 |
| 읽을 수 있는 조밀한 행 | admin table font12px, th32px/td44px, overflow auto, tabular numerals, hover/selected 표시 | 원본 Tremor/shadcn과 목적상 대응. 원본을 그대로 복제한 주장 아님 |
| 목록과 선택 항목을 함께 보기 | desktop inspector360px, mobile Sheet, search/filter/sort | 기존 UI 증빙과 source 존재. 전체 운영 데이터 흐름 완료를 대체하지 않음 |
| 터치·focus·키보드 보존 | mobile action 최소44×44px, 기존 Dialog/Sheet, Escape/focus return, aria-current | 현재 audit은 외부 desktop 공개 자료 읽기. 앱 전체 접근성 전수 증거 아님 |
| 실패/빈 값/실제0을 구별 | OperationsPanel bounded state와 고정 안내, guarded apply 단계 | 데모 상태와 운영 readback을 혼동하지 않음 |
| 효과는 작업을 방해하지 않는 범위 | product-ui 140ms/240ms, ScrollEffects max40/once, prefers-reduced-motion에서 표시/transition 해제 | 움직임 기준 대응. 장치별 성능 개선 수치 없음 |
| 브랜드·밀도·공개 지도 목적 유지 | light-root-tokens, AuthModal 기존 로고, MapPanelHeader 공통 chrome | 마케팅 레퍼런스를 근거로 제품 전체를 재구축하지 않음 |

해당 12개 구현 파일의 읽기 시점 SHA는 `implementation-source-manifest.json`에 있다. 이 감사에서 새로 독립 확인한 제품 UI 결함은 없다. 남은 핵심 공백은 **원본별 과거 선택→변경 연결 증빙**, 그리고 **전체 route의 같은 viewport 밀도/실운영 흐름/접근성·반응형 완료 증거**다. 현재 패턴이 유사하다는 이유로 이 공백을 완료 처리하지 않는다.

## 실제 캡처와 제한

- 공개 원본12개 홈 + 추가 컴포넌트/필터8개 = 채택 가능한20개 PNG. 모두1440×900. `reference-contact-sheet.png`는 원본12개 요약이며 원시 PNG를 보존한다.
- 추가 초기 Beautiful Records/Diff 2개 캡처는 smooth scroll이 끝나기 전 다른 섹션을 찍었다. 보존하되 채택 증거에서 제외한다. stable2개로 대체 확인했다. `beautiful-stability.log`의 heading locator 실패도 실패 그대로 보존한다.
- 공개 화면/DOM·공식 문서와 선택한 공개 control만 확인했다. 전체12개 모든 컴포넌트, 태블릿·모바일·로그인/유료 영역·실사용자의 성공을 주장하지 않는다.
- IAB/Chrome CUA 진입은 사용할 수 없어 설치된 Aside의 지원 REPL(openTab/snapshot/closeTab)을 사용했다. 설치 skill 요구에 따라 vendor updater로 Aside1.26.916.1741→1.26.1008.1938 업데이트했다. 제품 의존성/모델 설정 수정이나 모델 호출은 없었다.
- 각 새 탭은 finally에서 닫았다. 마지막 readback에서 요청12개 host의 잔여 탭0. 사용자 기존 탭은 보존했다. 새 웹 서버/장기 프로세스는 시작하지 않았다. 기존 dev PID57309/port19872는 살아 있으며 유지했다.
- public snapshot 로그의 불필요한 이메일은 마스킹했다. 로그인 상태/기존 사용자 탭 URL은 보고서에 저장하지 않았다.

`requested-references.json`, `records-batch-*.json`, capture scripts/logs와 `artifact-map.json`이 재확인 입력·원시 증거·해시를 연결한다. 앱 build/test를 다시 돌리지 않았다: 제품 소스 변경이 없는 문서/외부 화면 감사이기 때문이다.
