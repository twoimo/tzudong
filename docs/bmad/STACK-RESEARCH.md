# 실무 대시보드 기술 스택 조사 (2026-02 기준)

목표: “쯔양 데이터 대시보드”를 **BMAD 문서 세트(PRD/IA/Wireframe/Epics)** 와 결합해, 실무에서 흔히 쓰이는 프레임워크/라이브러리를 근거 기반으로 선택한다.

이 레포는 이미 `apps/web`에서 Next.js + Supabase + Tailwind/Radix + TanStack Query + Recharts 등을 사용 중이므로, “갈아엎기”가 아니라 **검증된 기본 스택을 강화**하는 방향을 권장한다.

## 1) 프론트엔드 프레임워크

### Next.js (React)

- 실무 채택 지표(서베이): State of JS 2024에서 Meta-Framework 사용률이 가장 높게 나타남.
- 다운로드 지표(npm): next 패키지 주간 다운로드가 매우 큼(대규모 생태계/운영 사례 다수).

권장:
- 현재처럼 Next.js App Router 유지
- 대시보드 API는 App Router의 Route Handler(`/app/api/...`)로 구성

참고 링크:
- https://2024.stateofjs.com/en-US/libraries/meta-frameworks/
- https://www.npmjs.com/package/next

## 2) 데이터/백엔드(서비스)

### Supabase (Postgres + Auth + Storage)

- JS 클라이언트(@supabase/supabase-js)는 npm 주간 다운로드 기준으로도 규모가 큼.
- SSR 프레임워크용 패키지(@supabase/ssr)도 별도로 유지됨.

권장:
- Public(일반 사용자) = `anon key`
- Admin(관리자) = 서버에서만 `service role key` 사용
- 관리자 접근 제어는 “API 레벨 + DB RLS 레벨” 모두로 방어(이중화)

참고 링크:
- https://www.npmjs.com/package/@supabase/supabase-js
- https://www.npmjs.com/package/@supabase/ssr

## 3) UI/CSS 컴포넌트

### Tailwind CSS

- npm 주간 다운로드가 매우 큰 편(유틸리티 기반 스타일링의 사실상 표준급).
- 디자인 시스템(변수/토큰) + 컴포넌트 조합에 유리.

참고 링크:
- https://www.npmjs.com/package/tailwindcss

### Radix UI (Primitives)

- shadcn/ui 계열에서도 많이 쓰이는 저수준 접근성 컴포넌트 기반.
- npm 주간 다운로드가 큰 편(실무 채택 신호로 참고 가능).

참고 링크:
- https://www.npmjs.com/package/@radix-ui/react-dialog

대안(관리자 백오피스 성격 강할 때):
- MUI(기업 백오피스) / Ant Design(엔터프라이즈 UI) / Chakra UI(컴포넌트 중심) 등.

참고 링크:
- https://www.npmjs.com/package/@mui/material
- https://www.npmjs.com/package/antd
- https://www.npmjs.com/package/@chakra-ui/react

## 4) 서버 상태/데이터 패칭

### TanStack Query vs SWR

- TanStack Query는 “대시보드(필터/캐시/페이지네이션/무한스크롤/리페치)”에 강점.
- SWR은 단순 fetch 패턴에 가볍게 쓰기 좋음.

권장:
- 프로젝트 전반에서 “하나로 표준화”하면 유지보수성이 올라감.
  - 현재 repo는 둘 다 존재하므로, 대시보드 영역은 TanStack Query로 고정 권장.

참고 링크:
- https://www.npmjs.com/package/@tanstack/react-query
- https://www.npmjs.com/package/swr

## 5) 차트/시각화

### Recharts (React + D3 기반)

- React 대시보드에서 흔히 선택되는 라이브러리 중 하나.
- 단순 KPI/분포/라인 차트에 빠른 생산성.

참고 링크:
- https://www.npmjs.com/package/recharts

### ECharts (Canvas 기반, 기능 풍부)

- 복잡한 상호작용/대규모 시각화에 강점.

참고 링크:
- https://www.npmjs.com/package/echarts

### Chart.js (가벼운 범용)

참고 링크:
- https://www.npmjs.com/package/chart.js

권장:
- 현재 `recharts`가 이미 설치되어 있으므로, MVP는 Recharts 중심으로 가고
- “히트맵/워드클라우드/복잡한 인터랙션”이 필요하면 ECharts(또는 D3/visx)로 보완 검토.

## 6) 테이블(관리자 데이터 그리드)

### TanStack Table

- Headless 테이블로 자유도가 높아 커스텀 UI에 적합.

참고 링크:
- https://www.npmjs.com/package/@tanstack/react-table

### AG Grid

- 엔터프라이즈 기능(그룹핑/피벗/대용량/고급 편집)에 강함.
- 단, 상용 기능/번들 고려 필요.

참고 링크:
- https://www.npmjs.com/package/ag-grid-react

권장:
- 관리자 화면의 “정렬/필터/페이징” 정도면 TanStack Table로 충분
- 엑셀 수준 그리드 기능이 필요해지면 AG Grid 검토

## 7) 지도

### MapLibre GL JS

- Mapbox GL JS(구 OSS) 계열 오픈소스 포크로, 벡터타일 기반 지도가 필요할 때 실무에서 자주 선택.

참고 링크:
- https://www.npmjs.com/package/maplibre-gl

## 8) 이 레포 기준 결론(추천 스택)

- Frontend: Next.js(App Router) + React
- UI: Tailwind CSS + Radix UI(현재 유지)
- Data: Supabase(Postgres/Auth) + @supabase/supabase-js (+ @supabase/ssr)
- Fetch: TanStack Query(대시보드 영역 표준)
- Charts: Recharts(MVP) + 필요 시 ECharts 보완
- Map: MapLibre GL

## 9) BMAD 결합 포인트

- PRD/IA/Wireframe/Epics에서 “기술 선택”은 **Acceptance Criteria**로 고정한다.
  - 예: “E2-S1 KPI 카드는 Recharts로 렌더링, 데이터는 `/api/dashboard/summary`에서 Supabase 기반 응답으로만 로드”
  - 예: “E5-S1 관리자 API는 service role key로 fetch하되, 반드시 서버에서 role 체크 후 반환”

