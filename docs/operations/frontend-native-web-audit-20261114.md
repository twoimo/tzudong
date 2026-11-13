# 프런트엔드 네이티브 웹 감사 · 2026-11-14

기준은 **2026-11-14 KST의 Baseline Widely available**이다. 변경 전 웹 소스 895개를 열거하고 패턴을 검색했으며, production 직접 의존성 71개 전부의 실제 모듈 참조와 호출 경로를 검토했다. 적용 대상은 IME 입력 보호, 미디어 쿼리 구독, 한국어 절대 날짜 표시, 동적 뷰포트 높이, label·separator, 사용하지 않는 UI 래퍼와 직접 의존성이다. 최종 패키지 선택은 production **71 → 46**, dev **24 → 22**, 총 **27개 직접 선언 제거**다. 직접 import가 없는 `@emnapi` 두 선언은 플랫폼별 WASM 설치 호환성을 위해 보존한다.

**상태: 구현 및 최종 로컬 검증 기록.** 원격 검증은 이 변경을 포함하는 PR의 커밋별 Checks와 [브랜치 CI 기록][branch-ci]를 정본으로 사용한다. 로컬 브라우저 통과는 0건이다. 이 문서는 전체 화면의 수동 시각 검사, 운영 배포 완료 또는 번들·성능 개선 측정의 증빙이 아니다.

## 기준과 출처 고정

| 항목 | 고정 값 |
| --- | --- |
| 조사 전 저장소 | `twoimo/tzudong` · `5103a732af891b0695eb6ef69da95eab0787eb24` |
| 공식 Modern Web Guidance | [`4dd968349e54ca45a05dd5c818fb035c9054b022`][guide-repo] · 2026-11-10 UTC · CLI `1.0.0` |
| 공식 skill 식별자 | [`2026_11_09-5bcc021b`][guide-skill] |
| WebDX web-features | [`6248b5d7613eaba47649700083a04f1815104129`][webdx-repo] · 2026-11-13 UTC |
| 의존성 조사 입력 | `tzudong-native-dependency-inventory.json` · SHA-256 `35dc6481f354b77b114273493082d6e6f56707fa07e9da46f068444f9a689d37` |

[Baseline][baseline]의 Widely 판정은 핵심 브라우저군에서 상호 운용 가능해진 뒤 30개월이 지난 기능을 뜻한다. 이 감사는 해당 API·CSS **하위 기능의** `baseline_high_date <= 2026-11-14`를 확인했다. Chrome·Edge만의 지원이나 Newly available 배지를 통과로 취급하지 않았다. 핵심 브라우저군은 Chrome의 데스크톱·Android, Edge, Firefox의 데스크톱·Android, Safari의 macOS·iOS다.

공식 [SKILL.md][guide-skill]는 기본적으로 Widely 기능의 fallback 생략을 허용하고, 그 밖의 기능에는 guide의 fallback을 요구한다. 이번 사용자의 더 엄격한 Widely 전용 조건을 우선했다. 따라서 guide에 추천된 기능이라는 이유만으로 새 API를 추가하지 않았다. 아래 호환성 링크는 가변 `main` 대신 같은 WebDX 커밋의 생성된 `.yml.dist` 데이터에 고정했다.

## 조사 범위와 재현

소스 분모는 기준 커밋의 `apps/web/{app,components,hooks,contexts,lib,integrations,types,public}` 아래 `.ts`, `.tsx`, `.js`, `.jsx`, `.css`, `.mjs`, `.cjs` 파일이다.

| 디렉터리 | 파일 수 | 조사 내용 |
| --- | ---: | --- |
| `app` | 212 | 공개·관리자 페이지, 레이아웃·CSS, API 경계 |
| `components` | 206 | 사용 UI, 미사용 래퍼, 키보드·레이아웃 처리 |
| `contexts` | 5 | 상태·이벤트 연결 |
| `hooks` | 30 | 뷰포트·장치·데이터 구독 |
| `integrations` | 3 | 외부 서비스 연결 |
| `lib` | 423 | 공유·클라이언트·서버 유틸리티, 영속 저장·검증 |
| `public` | 3 | 해당 확장자의 정적 실행 소스 |
| `types` | 13 | 타입 선언과 SDK 경계 |
| **합계** | **895** | `.ts` 604, `.tsx` 278, `.css` 9, `.js` 2, `.mjs` 2 |

895개는 브라우저 번들 895개라는 뜻이 아니다. Next의 서버·API 코드와 공유 타입도 경계를 확인하기 위해 포함했다. `styles/` CSS와 의존성·lockfile·설정·스크립트·테스트 참조를 별도로 검색했으며, 의존성 삭제 전에는 저장소의 살아 있는 import와 동적 import도 확인했다. 문서·기록·생성물·일반 정적 자산은 이 소스 분모에 포함하지 않았다. **전수 열거·검색과 71개 의존성별 판정**을 수행했으며, 모든 소스 줄의 개별 수동 검토를 했다는 주장은 하지 않는다.

저장소 루트에서 다음과 같이 같은 분모를 재현할 수 있다.

```sh
python - <<'PY'
from pathlib import PurePosixPath
from collections import Counter
import subprocess
base = '5103a732af891b0695eb6ef69da95eab0787eb24'
roots = {'app', 'components', 'hooks', 'contexts', 'lib', 'integrations', 'types', 'public'}
extensions = {'.ts', '.tsx', '.js', '.jsx', '.css', '.mjs', '.cjs'}
paths = subprocess.check_output(
    ['git', 'ls-tree', '-r', '--name-only', base, '--', 'apps/web'], text=True
).splitlines()
source = [p for p in paths if p.split('/')[2] in roots and PurePosixPath(p).suffix in extensions]
print(len(source), dict(sorted(Counter(p.split('/')[2] for p in source).items())))
PY
```

### 공식 legacy-scan: 3건 → 0건

공식 CLI로 `legacy-scan apps/web --json`과 `retrieve ime-safe-enter-submit`을 실행했다. 당시 `@latest`는 `1.0.0`이었으며 동일 버전 재현 명령은 `npx -y modern-web-guidance@1.0.0 legacy-scan apps/web --json`이다. 변경 전 35개 규칙·33개 guide에서 IME 관련 3건이 나왔고, 각 `keepWhen`·`dropWhen` rubric을 확인한 결과 모두 실제 수정 대상이었다.

| 기준 커밋의 위치 | 확인한 행동과 수정 |
| --- | --- |
| `AdminRestaurantModal.tsx:1023` | 사용자 지정 카테고리의 Enter가 한글 조합 확인을 추가 동작으로 처리했다. 조합 중 추가·초기화를 막고 정상 Enter와 빈 입력 처리를 보존했다. |
| `AdminYoutubeThumbnailGenerator.tsx:5198` | 이름 인라인 편집의 Enter/Escape가 조합 중 편집을 종료했다. 조합 중 commit·종료·캔버스 focus 이동을 막고, 일반 Enter/Escape의 기존 동작을 보존했다. |
| `RestaurantSubmissionModal.tsx:690` | 카테고리 입력에 명시적 Enter keydown 동작이 있었다. 단순한 native form submit이라는 제외 조건에 해당하지 않아 조합 보호를 추가했다. |

후속 전수 Enter 검색에서는 이미 `isComposing`을 검사하여 scanner가 제외한 썸네일 채팅에도 Safari의 `keyCode === 229` 보호가 필요한 것을 확인해 보완했다. 변경 후 공식 검사 결과는 0건이다. **이 결과는 약 20%의 guide에 있는 결정적 패턴 35개를 더 이상 검출하지 않았다는 뜻**이다. 전체 프런트엔드의 호환성·접근성·보안을 증명하지 않는다. 문자열만 맞추기 위한 예외나 scanner 변경은 추가하지 않았다.

## 적용한 네이티브 변경

| 변경 | 구현과 보존한 행동 | 호환성 근거 |
| --- | --- | --- |
| IME-safe 키보드 처리 | 세 입력 경로와 채팅에서 React `nativeEvent.isComposing` 및 `keyCode === 229` 확인. Enter의 기본 submit 중복을 막고 일반 Enter, Shift+Enter, Escape의 기존 의미 보존 | [공식 IME guide][guide-ime]의 Safari 이벤트 순서 보완. `isComposing` 단독 지원을 전제로 하지 않음 |
| 뷰포트·장치 구독 | [useHomeViewportMode](../../apps/web/hooks/useHomeViewportMode.ts), [useDeviceType](../../apps/web/hooks/useDeviceType.ts), [use-mobile](../../apps/web/hooks/use-mobile.tsx), feed·leaderboard·stamp의 분기에서 `matchMedia`와 `change` 구독 사용. resize/orientation 전역 구독·수동 debounce·rAF 제거 | MQL `change`와 EventTarget 상속: **2023-03-16 Widely** [데이터][wd-matchmedia]. width/orientation: **2018-01-29** [데이터][wd-media]. pointer: **2021-06-11** [데이터][wd-interaction] |
| 한국어 절대 날짜 | [date-format.ts](../../apps/web/lib/date-format.ts)의 `Intl.DateTimeFormat('ko-KR')`를 새 맛집·추천·수정 제보 내역 3페이지에서 사용. 기존 로컬 시간대와 자정 `00` 표시를 유지하는 `hourCycle: 'h23'` 선택 | DateTimeFormat: **2020-03-28**, hourCycle 옵션: **2022-03-19 Widely** [데이터][wd-intl] |
| 동적 화면 높이 | 다섯 앱 CSS의 `--full-height`를 `100dvh`로 설정하고 로컬 작업공간 banner 높이는 `calc()`로 차감. `--vh` bootstrap·정적 보정 스크립트·이전 fallback 중복 삭제 | `viewport-unit-variants`: **2025-06-05 Widely** [데이터][wd-viewport] |
| label | [label.tsx](../../apps/web/components/ui/label.tsx)의 기본 요소를 `<label>`로 구현. `htmlFor`, ref, class, 이벤트 합성, 반복 클릭의 텍스트 선택 방지와 내부 interactive 요소 처리를 보존 | 기본 HTML label 동작. `asChild`는 기존 Slot 합성으로 유지 |
| separator | [separator.tsx](../../apps/web/components/ui/separator.tsx)에 작은 로컬 `<div>` 구현. decorative 기본값의 `role="none"`, 의미 있는 구분선의 `role="separator"`, 수직 aria 방향, data 속성·ref·asChild 유지 | 기존 의미·접근성 계약 유지. `<hr>`로 바꾸었다고 보고하지 않음 |

뷰포트 구독은 SSR의 home pending·장치 desktop 기본값, 첫 client 렌더의 즉시 모바일 판정, touch-point fallback, listener 해제와 stamp 경로 가드를 유지한다. [viewport-breakpoints.ts](../../apps/web/lib/viewport-breakpoints.ts)의 `min-width: 768px`·`min-width: 1280px`와 그 반대 조건을 공유해 767/1279 정수 경계 사이의 소수 CSS 픽셀 틈도 제거했다. 기존 공개 `BREAKPOINTS` 값은 유지하며 767.25·767.75·1279.25·1279.75px의 실제 iframe 사례를 추가했다. 이 브라우저 사례는 고정 CFT CI에서 실행하며, 로컬 bundle 성공을 실행 성공으로 계산하지 않는다. 화면 픽셀 크기가 실제 필요한 지도 SDK의 resize, `ResizeObserver`, 키보드·bottom sheet의 `visualViewport` 처리는 유지했다.

날짜의 전환 범위는 절대 날짜 표시 3곳이다. `date-fns`의 `formatDistanceToNow`를 쓰는 [Header](../../apps/web/components/layout/Header.tsx), [모바일 알림](../../apps/web/components/home/MobileNotificationMenuButton.tsx), [데스크톱 알림](../../apps/web/components/home/DesktopLeftPanelNotifications.tsx), [공지](../../apps/web/components/announcement/AnnouncementPanel.tsx) 4곳은 유지했다. `Intl.RelativeTimeFormat`만 바꾸면 기존 한국어 단위 선택·반올림·상대 시간 문구까지 같아지는 것은 아니다.

### 사용하지 않는 래퍼 19개 제거

`apps/web/components/ui/`에서 다음 파일은 호출 경로를 확인한 뒤 삭제했다.

```text
accordion.tsx          aspect-ratio.tsx       calendar.tsx
chart.tsx              collapsible.tsx        context-menu.tsx
form.tsx               hover-card.tsx         input-otp.tsx
menubar.tsx             navigation-menu.tsx    progress.tsx
radio-group.tsx         resizable.tsx           sidebar.tsx
skeleton-loaders.tsx    sonner.tsx              toggle-group.tsx
toggle.tsx
```

`resizable.tsx`의 삭제와 `react-resizable-panels`의 삭제는 별개다. 실제 페이지에서 패널 API를 직접 사용하므로 패키지는 유지한다. Recharts 래퍼와 남은 CSS·설정 참조 및 IE 전용 `-ms-overflow-style` 선언·클래스를 제거했으며, 실행 중인 차트는 `ztd-charts`다. 해당 브라우저 검사의 오래된 Recharts 선택자도 현재 차트의 series·크기·키보드·범례·데이터 표 동작으로 맞췄다.

## 직접 의존성 71개 전체 판정

아래 수는 **기준 커밋 소스 895개에서 명시적 import/export-from/require/dynamic import에 해당 패키지 모듈 지정자가 있는 파일 수**다. 타입 import를 포함하며 실행 번들 포함 수는 아니다. 입력 JSON의 따옴표 문자열 후보를 실제 구문·호출과 구별했다. `next`는 후보 206 → 모듈 참조 199, `openai`는 4 → 0, `supercluster`는 6 → 5였다. `three`의 후보 2곳은 실제 import 1곳과 ambient 타입 선언 1곳이다. 특히 OpenAI 공급자 이름 문자열 4곳을 npm SDK 사용으로 오인하지 않았다.

| production 직접 의존성 | 기준 참조 파일 | 판정·이유 |
| --- | ---: | --- |
| `@emnapi/core` | 0 | 유지. npm·전이 WASM 설치 호환성을 위한 기존 직접 제약; resolved 1.11.3 |
| `@emnapi/runtime` | 0 | 유지. npm lock 정리 시 필요한 전이 항목 유실을 막는 기존 직접 제약; resolved 1.11.3 |
| `@ffmpeg/ffmpeg` | 0 | 미사용 직접 의존성 제거 |
| `@ffmpeg/util` | 0 | 미사용 직접 의존성 제거 |
| `@google/genai` | 5 | 유지. 서버 OCR·미디어 공급자 SDK |
| `@radix-ui/react-accordion` | 1 | 미사용 UI 래퍼와 함께 제거 |
| `@radix-ui/react-alert-dialog` | 1 | 유지. 확인 흐름·초점·키보드·취소 계약 |
| `@radix-ui/react-aspect-ratio` | 1 | 미사용 UI 래퍼와 함께 제거 |
| `@radix-ui/react-avatar` | 1 | 유지. 사용 중인 이미지 로드·fallback 상태 |
| `@radix-ui/react-checkbox` | 1 | 유지. controlled·indeterminate·키보드 계약 |
| `@radix-ui/react-collapsible` | 1 | 미사용 UI 래퍼와 함께 제거 |
| `@radix-ui/react-context-menu` | 1 | 미사용 UI 래퍼와 함께 제거 |
| `@radix-ui/react-dialog` | 3 | 유지. 활성 modal의 focus·portal·닫힘 가드 동등성 필요 |
| `@radix-ui/react-dropdown-menu` | 1 | 유지. 메뉴의 방향키·초점·선택 동작 |
| `@radix-ui/react-hover-card` | 1 | 미사용 UI 래퍼와 함께 제거 |
| `@radix-ui/react-label` | 2 | 기본 HTML label 및 기존 Slot 합성으로 대체 |
| `@radix-ui/react-menubar` | 1 | 미사용 UI 래퍼와 함께 제거 |
| `@radix-ui/react-navigation-menu` | 1 | 미사용 UI 래퍼와 함께 제거 |
| `@radix-ui/react-popover` | 1 | 유지. placement·portal·focus 계약; Popover 전체는 Widely 아님 |
| `@radix-ui/react-progress` | 1 | 미사용 UI 래퍼와 함께 제거 |
| `@radix-ui/react-radio-group` | 1 | 미사용 UI 래퍼와 함께 제거 |
| `@radix-ui/react-scroll-area` | 1 | 유지. 기존 viewport·스크롤바 동작 |
| `@radix-ui/react-select` | 1 | 유지. controlled 선택·typeahead·focus·표시 계약 |
| `@radix-ui/react-separator` | 1 | 의미·방향·decorative 상태를 보존하는 로컬 요소로 대체 |
| `@radix-ui/react-slider` | 1 | 유지. 값·키보드·포인터 상호작용 |
| `@radix-ui/react-slot` | 3 | 유지. Button 및 label·separator의 asChild 합성 |
| `@radix-ui/react-switch` | 1 | 유지. controlled 상태·키보드·label 연결 |
| `@radix-ui/react-tabs` | 1 | 유지. 선택·방향키·focus·ARIA 계약 |
| `@radix-ui/react-toast` | 1 | 유지. 표시 수명·닫힘·알림 동작 |
| `@radix-ui/react-toggle` | 1 | 미사용 UI 래퍼와 함께 제거 |
| `@radix-ui/react-toggle-group` | 1 | 미사용 UI 래퍼와 함께 제거 |
| `@radix-ui/react-tooltip` | 1 | 유지. hover·focus·delay·placement·접근성 계약 |
| `@sentry/nextjs` | 6 | 유지. Next 통합 관측·오류 보고 |
| `@supabase/ssr` | 10 | 유지. 서버·브라우저 세션과 쿠키 경계 |
| `@supabase/supabase-js` | 26 | 유지. auth·DB·realtime 서비스 계약 |
| `@tanstack/react-query` | 55 | 유지. 캐시·무효화·재검증·동시 요청 상태 |
| `@vercel/speed-insights` | 1 | 유지. 제품 관측 연동 |
| `browser-image-compression` | 3 | 유지. 업로드 크기·해상도 처리 흐름 |
| `class-variance-authority` | 10 | 유지. 컴포넌트 스타일 variant 합성 |
| `clsx` | 1 | 유지. 조건부 class 합성 |
| `cmdk` | 1 | 유지. 검색·선택·키보드 command UI |
| `d3-cloud` | 0 | 미사용 직접 의존성 제거 |
| `d3-hierarchy` | 0 | 미사용 직접 의존성 제거 |
| `date-fns` | 7 | 부분 축소. 절대 날짜 3곳 native Intl, 상대 시간 4곳 유지 |
| `embla-carousel-react` | 1 | 유지. 실제 영상 carousel의 선택 키·late frame·썸네일 동기화 |
| `framer-motion` | 0 | 미사용 직접 의존성 제거 |
| `idb` | 3 | 유지. draft DB의 migration·index·transaction·경쟁 처리 |
| `input-otp` | 1 | 미사용 UI 래퍼와 함께 제거 |
| `lucide-react` | 122 | 유지. 사용하는 SVG 아이콘 자산 |
| `maplibre-gl` | 1 | 유지. 실제 지도 렌더러 |
| `next` | 199 | 유지. 라우팅·SSR·서버 경계·빌드 프레임워크 |
| `openai` | 0 | 미사용 npm SDK 제거. 공급자 문자열과 자체 HTTP 클라이언트는 유지 |
| `react` | 247 | 유지. 렌더링·상태·컴포넌트 프레임워크 |
| `react-day-picker` | 1 | 미사용 calendar 래퍼와 함께 제거 |
| `react-dom` | 8 | 유지. 렌더링·portal·SSR API |
| `react-error-boundary` | 1 | 유지. 오류 fallback·복구 경계 |
| `react-hook-form` | 1 | 미사용 form 래퍼와 함께 제거 |
| `react-markdown` | 0 | 미사용 직접 의존성 제거 |
| `react-resizable-panels` | 3 | 유지. 활성 페이지의 패널 크기·collapse·keyboard; 미사용 래퍼만 제거 |
| `recharts` | 1 | 미사용 chart 래퍼와 함께 제거. 활성 차트는 ztd-charts |
| `remark-gfm` | 0 | 미사용 직접 의존성 제거 |
| `server-only` | 13 | 유지. privileged·서버 코드의 client 유입 방지 경계 |
| `sharp` | 9 | 유지. 서버 이미지 처리 |
| `skullet` | 1 | 유지. 사용 중인 loading UI 공급자 |
| `supercluster` | 5 | 유지. 지도 point clustering 알고리즘 |
| `swr` | 2 | 유지. 사용하는 캐시·재검증 흐름 |
| `tailwind-merge` | 1 | 유지. 충돌하는 Tailwind class 합성 |
| `three` | 1 + 타입 선언 1 | 유지. 3D 렌더링과 대응 타입 |
| `web-vitals` | 1 | 유지. 측정·보고 지표 계약 |
| `zod` | 29 | 유지. 클라이언트·서버 데이터 검증 |
| `ztd-charts` | 2 | 유지. 실제 대시보드의 차트·축·상호작용 |

**제거 25개, 유지 46개**로 판정했다. `@emnapi` 두 선언을 제거한 실험에서는 npm 11.6.2가 기존 설치와 비어 있는 독립 lock-only 작업공간 양쪽에서 필요한 WASM 전이 항목을 정리했다. 원래 직접 제약을 유지하면 완전한 그래프가 보존되어 기존 선언과 resolved 1.11.3을 유지했다. 직접 import가 없다는 이유만으로 이 설치 호환성 제약을 제거하지 않았으며 lockfile을 수동으로 불완전하게 만들지 않았다.

개발 의존성에서는 사용처가 없어진 `@types/d3-cloud`, `@types/d3-hierarchy` 2개를 제거했다. 나머지 22개는 `@next/bundle-analyzer`, `@playwright/test`, `@tailwindcss/cli`, `@tailwindcss/postcss`, `@types/google.maps`, `@types/node`, `@types/react`, `@types/react-dom`, `@types/supercluster`, `@typescript/native`, `@typescript/old`, `baseline-browser-mapping`, `braces`, `dotenv`, `eslint`, `eslint-config-next`, `minimatch`, `postcss`, `supabase`, `tailwindcss`, `typescript`, `typescript-eslint`이며 빌드·컴파일러·타입·검사·CLI·기존 의존성 제약을 유지한다. native browser API 전환의 대상으로 보지 않았다.

패키지가 native primitive 위에 구현됐다는 사실만으로 제거하지 않았다. 특히 다음 실제 행동을 비교했다.

- [RestaurantVideoCarousel](../../apps/web/components/restaurant/RestaurantVideoCarousel.tsx)은 `loop: false`지만, 늦게 삽입되는 frame 사이에서 선택 키 보존, `selectedScrollSnap`·select 이벤트, 썸네일 정렬, 이전·다음 이동, reduced motion과 focus 처리가 있다. CSS scroll snap의 지원 여부만으로 이 계약이 대체되지는 않는다.
- modal·메뉴·select는 현재의 controlled 상태, 취소 가드, portal, focus 복원과 중첩 상호작용을 갖는다. `<dialog>.showModal()` 자체는 Widely이므로 향후 전환 후보지만, 이번에 동등성 검증 없이 Radix 전체를 교체하지 않았다.
- `idb`는 브라우저 IndexedDB를 사용하는 얇은 계층이지만, draft 저장의 transaction·migration·owner/epoch·readback·abort 계약이 걸려 있다. `fetch`도 React Query/SWR의 캐시 수명과 Supabase의 인증·DB 프로토콜을 자동으로 제공하지 않는다.
- Canvas·SVG·WebGL의 존재만으로 지도 clustering·3D·차트·이미지 업로드 처리 라이브러리가 동등하게 대체되지는 않는다. `openai` 제거는 자체 HTTP 구현과 Python backend의 별도 SDK를 바꾸지 않는다.

## 이미 네이티브인 경로와 이번에 제외한 기능

기존 소스에는 `structuredClone`, `AbortSignal.any/timeout`, `ResizeObserver`·`IntersectionObserver`, `navigator.clipboard.writeText`, `CustomEvent`가 이미 사용되고 있다. 단순히 native API 사용 건수를 늘리기 위한 재작성을 하지 않았다. 지도 SDK의 `addListener`는 `MediaQueryList.addListener`가 아니므로 문자열이 같다는 이유로 바꾸지 않았다.

### 보존한 deprecated 편집 명령 예외

[썸네일 인라인 편집기](../../apps/web/components/admin/thumbnail-generator/AdminYoutubeThumbnailGenerator.tsx)의 `onPaste`는 `text/plain`을 읽어 한 줄로 정규화하고 `document.execCommand('insertText', false, text)`로 선택 범위를 교체한다. 이는 clipboard에 쓰는 `execCommand('copy')`가 아니다. pending undo snapshot, `onInput`의 layer 상태 동기화, Ctrl/Cmd+Z와 `beforeinput`의 `historyUndo` 처리도 연결되어 있다.

[공식 copy-button guide][guide-copy]의 `navigator.clipboard.writeText`는 복사 API이며 이 편집 명령의 대체가 아니다. [MDN][mdn-execcommand]은 `execCommand`를 deprecated·non-standard로 분류하면서도 직접 DOM 조작과 다른 edit history 보존을 유효한 예외로 설명한다. 따라서 Range/textContent 치환만으로 selection·input 이벤트·undo 동등성을 입증할 수 없어 이번에 보존했다. 이는 레거시가 0개라는 결론을 제한하는 **명시적 잔존 항목**이다. 향후 전환은 선택 영역 붙여넣기, 한글 조합, blur/commit, app undo와 브라우저 undo를 실제 브라우저에서 검증해야 한다. 브라우저별 `input` 발생 차이와 명령 실패 가능성도 남은 검증 대상이다. 더 간단한 `contenteditable="plaintext-only"`는 아래 기준일에 아직 Widely가 아니므로 도입하지 않았다.

| 확인한 API | 기준일 판정·주의 | 결정 |
| --- | --- | --- |
| `structuredClone` | **2024-09-14 Widely** [데이터][wd-clone] | 기존 사용 유지. JSON 직렬화와 값·객체 의미가 같다고 가정하지 않음 |
| `AbortSignal.any` / `timeout` | 각각 **2026-09-19 / 2026-10-18 Widely** [any][wd-abort-any]·[timeout][wd-abort-timeout] | 기존 사용 허용. 단순 timer 치환으로 취소·timeout 의미를 바꾸지 않음 |
| `ResizeObserver` 기본 기능 | **2023-01-28 Widely** [데이터][wd-resize] | 요소 크기가 필요한 지도 등에서 유지. 새 하위 옵션에 전체 상태를 확대 적용하지 않음 |
| `Clipboard.writeText` | **2022-09-24 Widely**; 전체 async clipboard 묶음은 Newly [데이터][wd-clipboard] | 기존 텍스트 복사 유지. 모든 MIME read/write가 같은 지원이라고 보지 않음 |
| `<dialog>` 기본 API | **2024-09-14 Widely** [데이터][wd-dialog] | 사용 가능하나 현재 modal 행동의 동등성 때문에 전체 교체 보류 |
| CSS scroll snap | 기본 묶음 **2022-07-15 Widely**, 하위 기능별 날짜 구별 [데이터][wd-snap] | 단순 carousel의 후보. 현재 Embla 계약을 삭제할 근거로 사용하지 않음 |
| Popover 전체 | **Newly**, low date **2025-01-27** [데이터][wd-popover] | 이번 전환에 도입하지 않음. 일부 attribute·메서드의 2026-10-16 high date를 전체 API에 일반화하지 않음 |
| CSS anchor positioning | 전체 **Limited**, 일부 기본 기능은 2026년 Newly [데이터][wd-anchor] | 도입하지 않음 |
| `Temporal` | **Limited**, 핵심 브라우저 전체 지원 미충족 [데이터][wd-temporal] | Date/Intl을 무조건 Temporal로 바꾸지 않음 |
| `scrollend` | **Newly**, low date **2025-12-12** [데이터][wd-scrollend] | 새 carousel 의존 기능으로 도입하지 않음 |
| dialog `closedby` | **Limited** [데이터][wd-closedby] | 기본 `<dialog>`의 Widely 상태와 구분하여 도입하지 않음 |
| `contenteditable="plaintext-only"` | **Newly**, low date **2025-03-04** [데이터][wd-plaintext] | 현재 편집기의 붙여넣기 대체로 도입하지 않음 |

## 검증 기록과 실행 위치

[저장소 검증 규칙](../agents/verification.md)에 따라 npm의 package-lock을 릴리스 정본으로 사용하고 Bun lock 정합성을 별도로 확인한다. 아래 로컬 결과는 독립 리뷰의 수정과 최종 의존성 선택을 반영한다. 브라우저 동작과 플랫폼별 전체 검증은 PR의 소스 커밋에 연결된 CI job 및 원본 로그에서 확인한다. 중복되는 대상별 검사 수를 합산하지 않는다.

| 항목 | 현재 증빙 | 최종 상태 |
| --- | --- | --- |
| 공식 legacy scanner | 최초 3건, 수정 후 0건. 35개 규칙·33개 guide | 확인한 subset만 통과 |
| production / dev 직접 선언 | 71 → 46 / 24 → 22. 총 27개 제거, @emnapi 두 기존 선언 보존 | 최종 패키지 선택 확인 |
| npm lock 경로 | 루트 `""`를 제외한 경로 913 → 750. 163개 제거, 추가 0, 생존 경로 version·integrity 변경 0 | npm 그래프 체크포인트 확인 |
| Bun lock | npm과 직접·개발 선언 일치. frozen lockfile 검사 통과; 새 package identity 0. 기존 `react-is@16.13.1`의 hoist 이동만 확인 | 정합성 통과; 플랫폼별 clean install은 CI |
| 깨끗한 npm 설치 | npm 11.6.2 `ci --no-audit --no-fund`, 598개 설치, Next patch 적용 | 통과 |
| 통합 로컬 검사 | 날짜·IME·CSP·source·dependency·continuation·관리자 관련 13개 파일, **147 tests / 5,884 assertions**, 실패 0 | 통과 |
| TypeScript parity | 빌드 후 native 7.0.2 / compat 6.0.2, **3,042 logical inputs, 0 diagnostics** | 통과 |
| ESLint | 전체 lint 통과, 이후 수정한 모든 production/test 파일의 focused lint 재검사 통과 | 통과 |
| 실행형 fixture 준비 | 실제 production IME handler 추출·실행, React browser fixture와 관련 bundle 검증 | bundle 성공은 browser 실행 성공이 아님 |
| 브라우저 행동 | 한글 composition, Safari 방식 229, 일반 Enter/Escape, label 활성화·separator 의미, viewport 구독·높이 사례 추가 | 로컬 0 pass; 고정 CFT를 사용하는 8개 unit shard의 원본 실행 결과 참조 |
| Next build | Next 16.4.2 webpack production build, 58개 정적 페이지 생성, route CSS 경계 검사 | **통과** |
| PR / commit / CI run | 브랜치 `refactor/baseline-native-web-20261114`; [CI 기록][branch-ci]에서 해당 소스 head와 8개 unit shard·관련 필수 job 확인 | 원격 커밋의 Checks 및 job 로그가 정본 |

로컬 브라우저 실행은 pinned Chrome 다운로드의 빈 파일·truncated ZIP 실패와 시스템 Chromium의 socket `EPERM` 때문에 완료하지 못했다. 테스트는 기존 고정 Chrome for Testing 도우미·pin을 유지하며 system override나 우회 flag를 커밋하지 않았다. synthetic composition/229 테스트는 입력 handler의 동작을 검증하지만, 실제 OS의 한국어 IME나 Safari 실기기 검증을 대신하지 않는다. 브라우저 실행은 별도의 원격 증빙으로 판정하며, filtered·skip 결과나 bundle 성공을 browser pass로 계산하지 않는다.

의존성 개수와 lock 경로 감소는 설치 그래프 정리의 증빙이다. 다운로드 크기, 브라우저 JS 번들 크기, 메모리, 응답 시간의 개선율은 이 수치로 추정하지 않았다.

### Modern Web Guidance

- **`ime-safe-enter-submit`**: “Pairing `event.isComposing` with `event.keyCode === 229`” 규칙을 적용해 React native event를 확인하고 Safari의 조합 종료 순서에 대비했다. 일반 Enter/Escape와 한글 조합 중 동작을 별도로 검증하도록 구성했다. [고정 원문][guide-ime]
- **`responsive-design`**: “Use dynamic viewport units (`dvh`, `dvw`) instead of `vh`/`vw`”를 적용했다. 해당 기능이 이미 Widely임을 확인한 뒤 높이 bootstrap을 없앴고 작업공간 banner 차감과 실제 geometry 관찰은 보존했다. [고정 원문][guide-responsive]
- **`form-factor-adaptation`**: “Keep media queries for what a container can't know”를 입력 장치 판정에 적용했다. viewport 분기를 `matchMedia` 구독으로 옮긴 것은 상태 변경에 native API를 사용하는 프로젝트별 판단이며, 이 문구가 모든 resize listener의 교체를 명령한다고 해석하지 않았다. [고정 원문][guide-form-factor]

[guide-repo]: https://github.com/GoogleChrome/modern-web-guidance/tree/4dd968349e54ca45a05dd5c818fb035c9054b022
[guide-skill]: https://github.com/GoogleChrome/modern-web-guidance/blob/4dd968349e54ca45a05dd5c818fb035c9054b022/skills/modern-web-guidance/SKILL.md
[guide-ime]: https://github.com/GoogleChrome/modern-web-guidance/blob/4dd968349e54ca45a05dd5c818fb035c9054b022/skills/modern-web-guidance/guides/forms/ime-safe-enter-submit.md
[guide-responsive]: https://github.com/GoogleChrome/modern-web-guidance/blob/4dd968349e54ca45a05dd5c818fb035c9054b022/skills/modern-web-guidance/guides/css/responsive-design.md
[guide-form-factor]: https://github.com/GoogleChrome/modern-web-guidance/blob/4dd968349e54ca45a05dd5c818fb035c9054b022/skills/modern-web-guidance/guides/user-experience/form-factor-adaptation.md
[guide-copy]: https://github.com/GoogleChrome/modern-web-guidance/blob/4dd968349e54ca45a05dd5c818fb035c9054b022/skills/modern-web-guidance/guides/ui-components/copy-button.md
[mdn-execcommand]: https://developer.mozilla.org/en-US/docs/Web/API/Document/execCommand
[baseline]: https://web-platform-dx.github.io/baseline/
[webdx-repo]: https://github.com/web-platform-dx/web-features/tree/6248b5d7613eaba47649700083a04f1815104129
[wd-matchmedia]: https://github.com/web-platform-dx/web-features/blob/6248b5d7613eaba47649700083a04f1815104129/features/matchmedia.yml.dist
[wd-media]: https://github.com/web-platform-dx/web-features/blob/6248b5d7613eaba47649700083a04f1815104129/features/media-queries.yml.dist
[wd-interaction]: https://github.com/web-platform-dx/web-features/blob/6248b5d7613eaba47649700083a04f1815104129/features/interaction.yml.dist
[wd-intl]: https://github.com/web-platform-dx/web-features/blob/6248b5d7613eaba47649700083a04f1815104129/features/intl.yml.dist
[wd-viewport]: https://github.com/web-platform-dx/web-features/blob/6248b5d7613eaba47649700083a04f1815104129/features/viewport-unit-variants.yml.dist
[wd-clone]: https://github.com/web-platform-dx/web-features/blob/6248b5d7613eaba47649700083a04f1815104129/features/structured-clone.yml.dist
[wd-abort-any]: https://github.com/web-platform-dx/web-features/blob/6248b5d7613eaba47649700083a04f1815104129/features/abortsignal-any.yml.dist
[wd-abort-timeout]: https://github.com/web-platform-dx/web-features/blob/6248b5d7613eaba47649700083a04f1815104129/features/abortsignal-timeout.yml.dist
[wd-resize]: https://github.com/web-platform-dx/web-features/blob/6248b5d7613eaba47649700083a04f1815104129/features/resize-observer.yml.dist
[wd-clipboard]: https://github.com/web-platform-dx/web-features/blob/6248b5d7613eaba47649700083a04f1815104129/features/async-clipboard.yml.dist
[wd-dialog]: https://github.com/web-platform-dx/web-features/blob/6248b5d7613eaba47649700083a04f1815104129/features/dialog.yml.dist
[wd-snap]: https://github.com/web-platform-dx/web-features/blob/6248b5d7613eaba47649700083a04f1815104129/features/scroll-snap.yml.dist
[wd-popover]: https://github.com/web-platform-dx/web-features/blob/6248b5d7613eaba47649700083a04f1815104129/features/popover.yml.dist
[wd-anchor]: https://github.com/web-platform-dx/web-features/blob/6248b5d7613eaba47649700083a04f1815104129/features/anchor-positioning.yml.dist
[wd-temporal]: https://github.com/web-platform-dx/web-features/blob/6248b5d7613eaba47649700083a04f1815104129/features/temporal.yml.dist
[wd-scrollend]: https://github.com/web-platform-dx/web-features/blob/6248b5d7613eaba47649700083a04f1815104129/features/scrollend.yml.dist
[wd-closedby]: https://github.com/web-platform-dx/web-features/blob/6248b5d7613eaba47649700083a04f1815104129/features/dialog-closedby.yml.dist
[wd-plaintext]: https://github.com/web-platform-dx/web-features/blob/6248b5d7613eaba47649700083a04f1815104129/features/contenteditable-plaintextonly.yml.dist

[branch-ci]: https://github.com/twoimo/tzudong/actions?query=branch%3Arefactor%2Fbaseline-native-web-20261114
