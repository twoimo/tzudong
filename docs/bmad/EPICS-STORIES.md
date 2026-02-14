# BMAD Epics + Stories

## Epic 1: 데이터 계약/SSOT 정렬

목표: 대시보드에서 참조하는 데이터 기준을 단일화하고 API 계약을 확정한다.

| Story ID | User Story | Route/File Mapping | Acceptance Criteria | Done 기준 |
|---|---|---|---|---|
| E1-S1 | 개발자로서 평가 데이터 SSOT를 고정하고 싶다, 그래서 지표 불일치를 줄일 수 있다. | `backend/restaurant-evaluation/data/tzuyang/evaluation`, `docs/bmad/PRD.md` | SSOT 경로가 문서/코드에 명시되고, 대시보드 집계는 SSOT 기준으로만 계산된다. | SSOT 외 경로 참조가 제거/차단된다. |
| E1-S2 | 개발자로서 JSONL 포맷 편차를 흡수하는 파서를 원한다, 그래서 집계 실패를 방지할 수 있다. | `apps/web/lib/dashboard/normalizers.ts` (신규) | 단일객체/배열/pretty JSON 입력 모두 파싱되며 예외 파일이 로깅된다. | 샘플 파일 테스트 통과. |
| E1-S3 | PM으로서 공용 API 스키마를 원한다, 그래서 프론트/백 개발 병행이 가능하다. | `apps/web/app/api/dashboard/*` (신규), `apps/web/types/dashboard.ts` (신규) | summary/funnel/failures/restaurants/video API 응답 스키마가 고정되고 타입이 공유된다. | 타입 에러 0, 문서 반영 완료. |

## Epic 2: 일반 사용자 대시보드 구축

목표: 쯔양 데이터를 한눈에 보는 읽기 전용 대시보드 제공.

| Story ID | User Story | Route/File Mapping | Acceptance Criteria | Done 기준 |
|---|---|---|---|---|
| E2-S1 | 일반 사용자로서 메인 대시보드를 보고 싶다, 그래서 핵심 지표를 빠르게 이해할 수 있다. | `apps/web/app/insights/page.tsx` (신규) | KPI 카드 4개 이상, 기간/카테고리 필터, 로딩/오류/빈상태가 표시된다. | 모바일/데스크톱 반응형 확인. |
| E2-S2 | 일반 사용자로서 지도에서 식당을 탐색하고 싶다, 그래서 관심 장소를 바로 찾을 수 있다. | `apps/web/components/insight/MapSection.tsx` | 카테고리/지역 필터, 마커 상세, 영상 링크 이동이 동작한다. | 샘플 QA 시나리오 통과. |
| E2-S3 | 일반 사용자로서 카테고리/영상 트렌드를 보고 싶다, 그래서 콘텐츠 흐름을 이해할 수 있다. | `apps/web/components/insight/HeatmapSection.tsx`, `apps/web/components/insight/WordCloudSection.tsx` | 목업 제거 후 실제 API 데이터 기반 차트가 렌더링된다. | 목업 상수 제거 완료. |
| E2-S4 | 일반 사용자로서 영상별 상세를 보고 싶다, 그래서 영상-식당 연계를 확인할 수 있다. | `apps/web/components/dashboard/VideoDrilldown.tsx` (신규), `/api/dashboard/video/[videoId]` | 영상 선택 시 식당 목록/평가상태/링크가 표시된다. | deeplink(`video_id`) 지원. |

## Epic 3: 관리자 운영 대시보드 고도화

목표: 퍼널/실패 원인/품질을 실데이터로 운영 관점에서 확인.

| Story ID | User Story | Route/File Mapping | Acceptance Criteria | Done 기준 |
|---|---|---|---|---|
| E3-S1 | 관리자로서 파이프라인 퍼널을 보고 싶다, 그래서 병목 구간을 즉시 찾을 수 있다. | `apps/web/app/admin/insight/insight-client.tsx`, `/api/dashboard/funnel` | crawling->selection->rule->laaj 단계 수치가 표시된다. | 수치가 PRD 기준과 일치한다. |
| E3-S2 | 관리자로서 실패 원인 분포를 보고 싶다, 그래서 개선 우선순위를 정할 수 있다. | `apps/web/components/insight/AdminFailureBoard.tsx` (신규), `/api/dashboard/failures` | notSelection/rule falseMessage top N이 표시된다. | 클릭 시 필터된 이슈 목록으로 이동. |
| E3-S3 | 관리자로서 품질 지표를 보고 싶다, 그래서 검수 기준의 안정성을 관리할 수 있다. | `apps/web/components/insight/AdminQualityBoard.tsx` (신규) | location_match, review_faithfulness, category 분포가 표시된다. | 기간 필터 반영 확인. |
| E3-S4 | 관리자로서 laaj 누락 건을 확인하고 싶다, 그래서 재처리 대상을 즉시 파악할 수 있다. | `apps/web/components/insight/AdminIssueQueue.tsx` (신규) | 누락 video_id 목록과 심각도 표시, 정렬/검색 제공. | `/admin/evaluations` deep-link 동작. |

## Epic 4: 관리자 검수 연계 강화

목표: 운영 인사이트에서 검수 액션까지 클릭 수를 줄인다.

| Story ID | User Story | Route/File Mapping | Acceptance Criteria | Done 기준 |
|---|---|---|---|---|
| E4-S1 | 관리자로서 인사이트 이슈에서 바로 검수로 이동하고 싶다, 그래서 triage 시간을 줄일 수 있다. | `apps/web/app/admin/evaluations/page.tsx` | `video_id`, `issue`, `reason` 쿼리 파라미터를 받아 초기 필터링된다. | 30초 내 이동 시나리오 통과. |
| E4-S2 | 관리자로서 실패 유형별 프리셋 필터를 쓰고 싶다, 그래서 반복 작업을 줄일 수 있다. | `apps/web/components/admin/CategorySidebar.tsx`, `apps/web/components/admin/EvaluationTableNew.tsx` | 실패 유형 프리셋 버튼으로 상태/평가필터가 즉시 적용된다. | QA 체크리스트 통과. |

## Epic 5: 권한/보안/감사

목표: 일반 사용자와 관리자 접근 범위를 분리하고 운영 행동을 추적.

| Story ID | User Story | Route/File Mapping | Acceptance Criteria | Done 기준 |
|---|---|---|---|---|
| E5-S1 | 보안 담당자로서 관리자 API를 보호하고 싶다, 그래서 비인가 접근을 차단할 수 있다. | `apps/web/app/api/dashboard/funnel/route.ts`, `.../failures/route.ts` | admin role 없으면 403 반환. | 보안 테스트 통과. |
| E5-S2 | 운영자로서 관리자 액션 로그를 남기고 싶다, 그래서 추적 가능성을 확보할 수 있다. | `supabase/migrations/*` (audit table), admin mutation 코드 | 승인/삭제/복구/편집 액션 로그 저장. | 샘플 액션 4종 로그 확인. |

## Epic 6: 품질 보증/배포

목표: 회귀 리스크를 줄이고 대시보드 신뢰도를 확보.

| Story ID | User Story | Route/File Mapping | Acceptance Criteria | Done 기준 |
|---|---|---|---|---|
| E6-S1 | 개발자로서 핵심 집계 로직 테스트가 필요하다, 그래서 수치 회귀를 방지할 수 있다. | `apps/web/lib/dashboard/*.test.ts` (신규) | summary/funnel/failures 집계 단위테스트 추가. | CI 통과. |
| E6-S2 | QA로서 주요 화면 E2E가 필요하다, 그래서 사용자 플로우를 보장할 수 있다. | `apps/web/tests/dashboard.spec.ts` (신규) | `/insights`, `/admin/insight`, `/admin/evaluations` 핵심 경로 검증. | Playwright 통과. |
| E6-S3 | 운영자로서 데이터 신선도 모니터링이 필요하다, 그래서 배치 이상을 빠르게 감지할 수 있다. | `apps/web/components/insight/DataFreshnessBadge.tsx` (신규) | 마지막 수집 시각/지연 경고 표시. | 임계치 경고 동작 확인. |

## 실행 우선순위 (권장)

1. Epic 1
2. Epic 3
3. Epic 4
4. Epic 2
5. Epic 5
6. Epic 6

## 스프린트 분할 예시

1. Sprint A: E1 + E3-S1,S2
2. Sprint B: E3-S3,S4 + E4
3. Sprint C: E2 + E5
4. Sprint D: E6 + 안정화
