# IA + Route Mapping

## 1) IA 원칙

- 동일 데이터, 다른 깊이
  - 일반 사용자: 탐색 중심
  - 관리자: 운영/품질 중심
- 기존 라우트 최대 재사용
- 관리자 기능은 URL 레벨에서 권한 차단

## 2) 현재 라우트 인벤토리 (핵심)

### 2.1 사용자/공개

- `/`
- `/feed`
- `/global-map`
- `/leaderboard`
- `/costs`
- `/submissions`
- `/mypage/*`
- `/user/[userId]`

### 2.2 관리자

- `/admin/evaluations`
- `/admin/insight`
- `/admin/submissions`
- `/admin/banners`
- `/admin/costs`

### 2.3 기존 API 라우트(관련)

- `/api/youtube-meta`
- `/api/naver-search`
- `/api/naver-geocode`
- `/api/shorten`

## 3) 목표 IA (BMAD 설계안)

### 3.1 일반 사용자 IA

- `/insights` (신규)
  - Overview
  - 지도
  - 카테고리 트렌드
  - 영상 Drill-down

### 3.2 관리자 IA

- `/admin/insight` (기존 확장)
  - 파이프라인 퍼널
  - 실패 분석
  - 품질 점수 분포
  - 이슈 큐 -> `/admin/evaluations` deep-link
- `/admin/evaluations` (기존 유지)
  - 상세 검수, 승인/보류/삭제, 충돌 해결

## 4) 라우트별 구현 매핑

| Route | 상태 | 권한 | 목적 | 구현 파일(주요) |
|---|---|---|---|---|
| `/insights` | 신규 | Public | 일반 사용자 통합 대시보드 | `apps/web/app/insights/page.tsx` (신규), `apps/web/components/insight/*` 재사용/분리 |
| `/admin/insight` | 기존 확장 | Admin | 운영/품질 대시보드 | `apps/web/app/admin/insight/page.tsx`, `apps/web/app/admin/insight/insight-client.tsx` |
| `/admin/evaluations` | 기존 | Admin | 검수/수정/승인 | `apps/web/app/admin/evaluations/page.tsx` |
| `/global-map` | 기존 연계 | Public | 지도 전용 탐색 보조 | `apps/web/app/global-map/page.tsx` |

## 5) API 설계 제안 (신규)

- `/api/dashboard/summary`
  - KPI 카드용 집계
- `/api/dashboard/funnel`
  - crawling->selection->rule->laaj 퍼널
- `/api/dashboard/failures`
  - notSelection reason, rule falseMessage 분포
- `/api/dashboard/quality`
  - location_match / category / review_faithfulness 품질 지표 집계
- `/api/dashboard/restaurants`
  - 지도/카테고리 필터 결과
- `/api/dashboard/video/[videoId]`
  - 영상 상세 Drill-down

## 6) 권한 정책

- Public API: summary/restaurants/video
- Admin API: funnel/failures/quality + 민감 메타
- 인증 소스: `user_roles` (`AuthContext`의 `isAdmin`)
- Admin 페이지는 SSR/CSR 둘 다 비인가 접근 시 차단

## 7) 기존 코드와의 연결 포인트

- 인사이트 탭 컨테이너:
  - `apps/web/app/admin/insight/insight-client.tsx`
- 목업 데이터 제거 대상:
  - `apps/web/components/insight/HeatmapSection.tsx`
  - `apps/web/components/insight/WordCloudSection.tsx`
  - `apps/web/components/insight/InsightChatSection.tsx`
  - `apps/web/components/insight/SeasonCalendarSection.tsx`
- 실데이터 기반으로 이미 연결 가능한 섹션:
  - `apps/web/components/insight/MapSection.tsx`
