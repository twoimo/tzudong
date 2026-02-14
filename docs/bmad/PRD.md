# PRD: 쯔양 데이터 통합 대시보드 (BMAD)

## 1) 문제 정의

쯔양 관련 데이터가 크롤링/평가 파이프라인에 분산되어 있고, 현재 관리자 인사이트 화면 일부는 목업 데이터 중심이라 운영 의사결정과 사용자 가치 전달이 제한적이다.  
목표는 일반 사용자와 관리자 관점에서 동일 데이터를 다른 깊이로 제공하는 통합 대시보드를 구축하는 것이다.

## 2) 목표

- 일반 사용자
  - 쯔양 맛집/영상/카테고리 트렌드를 한 눈에 탐색
  - 지도/카테고리/영상 기준으로 빠르게 탐색 및 공유
- 관리자
  - 파이프라인 건전성(수집->선정->룰->LAAJ)을 실시간 모니터링
  - 실패 원인과 품질 이슈를 빠르게 triage하고 검수 화면으로 이동

## 3) 비목표 (이번 사이클 제외)

- 실시간 스트리밍 분석 파이프라인 구축
- 다채널(쯔양 외) 완전 일반화
- 고급 예측 모델(조회수 예측, 추천 모델) 운영

## 4) 사용자/권한

- 일반 사용자(비로그인 포함)
  - 읽기 전용 지표/지도/트렌드 접근
- 로그인 사용자
  - 일반 사용자 기능 + 개인화(즐겨찾기 연계는 차기)
- 관리자(`user_roles.role = admin`)
  - 파이프라인 품질/검수/오류 triage/운영 지표 접근

## 5) 데이터 현황 스냅샷 (2026-02-13)

### 5.1 원천 볼륨

- 메타 파일: 1,022
- 메타 누적 버전 라인: 4,544 (평균 4.45/version per video)
- 크롤링 파일: 1,023
- 자막 파일: 1,022
- 히트맵 파일: 1,019
- 레스토랑 총 레코드: 1,214
- 주소 누락 레코드: 307
- 좌표 보유 레코드: 861

### 5.2 평가 파이프라인 볼륨

- `selection`: 841
- `notSelection`: 280
- `rule_results`: 758
- `laaj_results`: 756
- `selection ∪ notSelection` 유니크 video_id: 1,023
- `selection ∩ notSelection` 중복 video_id: 98
  - 중복 사유: `address_null` 96, `unknown` 2
- `rule_results`만 있고 `laaj_results`가 없는 video_id: 2
  - `90NJAyFx09A`, `oloeGY3oAVg`

### 5.3 품질/분포

- selection target 합계: true 900 / false 120
- location match: true 546 / false 378
- review_faithfulness 평균 0.9541, 중앙값 1.0
- notSelection 사유:
  - `all_names_null` 177
  - `address_null` 96
  - `no_restaurants` 5
  - `unknown` 2
- rule falseMessage 상위:
  - `1단계 실패: 주소 지오코딩 실패` 149
  - `2단계 실패: 20m 이내 후보 없음` 138
  - `1단계 실패: 검색 결과 없음` 85

### 5.4 카테고리 상위(크롤링 기준)

- 고기 191
- 분식 181
- 한식 177
- 중식 115
- 돈까스·회 115

### 5.5 히트맵 최신 상태(파일별 최신 status)

- success 959
- skipped_shorts 60

### 5.6 문서 임베딩 소스 상태

- transcript-document-with-context: 파일 963, 총 chunk 12,200
- transcript-document-with-meta: 파일 960, 총 chunk 12,203

## 6) 데이터 소스 정책 (중요)

- SSOT: `backend/restaurant-evaluation/data/tzuyang/evaluation`
- 보조 원천: `backend/restaurant-crawling/data/tzuyang/*`
- 이유:
  - 평가 산출물의 최신성이 `restaurant-evaluation`에 집중
  - 특히 `laaj_results`는 crawling 측 1개 vs evaluation 측 756개로 큰 격차 존재

## 7) 제품 요구사항

### 7.1 일반 사용자 대시보드 (MVP)

- KPI 카드: 총 영상, 총 식당, 카테고리 상위, 최근 수집 상태
- 지도 탐색: 카테고리/지역 필터, 식당 상세(영상 링크/리뷰 요약)
- 트렌드 뷰: 카테고리 분포, 시계열 업로드/수집 추이
- 영상 상세 Drill-down: 영상별 식당 목록, 평가 포함 여부

### 7.2 관리자 대시보드 (MVP)

- 파이프라인 퍼널:
  - crawling -> selection/notSelection -> rule -> laaj
- 실패 분석:
  - notSelection reason 분포
  - rule falseMessage 분포
  - laaj 누락 파일 목록
- 검수 연계:
  - 이슈 row에서 `/admin/evaluations`로 deep-link 이동
- 목업 제거:
  - Heatmap/WordCloud/Chat/Season 섹션을 실제 데이터 기반으로 전환

## 8) 성공 지표 (MVP)

- 데이터 신선도: 일일 배치 완료 후 대시보드 갱신 지연 < 24시간
- 관리자 운영 효율:
  - 이슈 탐지 -> 검수 화면 도달 시간 30초 이내
  - 주요 실패 유형 상시 모니터링(빈도/추세)
- 사용자 활용도:
  - 대시보드 페이지 체류시간 및 탐색 전환율(지도 상세 클릭률) 개선

## 9) 리스크 및 대응

- 리스크: 동일 성격 데이터가 2개 경로(crawling/evaluation)에 존재
  - 대응: SSOT 고정 + 원천 동기화 검증 배치 추가
- 리스크: 현재 인사이트 UI의 목업 의존
  - 대응: API 계약 먼저 확정 후 컴포넌트 단위 전환
- 리스크: JSONL 형식 편차(단일 객체/배열/pretty JSON)
  - 대응: ingest 레이어에서 포맷 정규화 파서 통일

## 10) 릴리즈 범위

- Phase 1 (MVP)
  - 사용자 `/insights` 읽기 전용 대시보드
  - 관리자 `/admin/insight` 실데이터 전환 + 퍼널/실패 분석
- Phase 2
  - 개인화(즐겨찾기/관심 카테고리)
  - 관리자 알림(실패 임계치 초과)
