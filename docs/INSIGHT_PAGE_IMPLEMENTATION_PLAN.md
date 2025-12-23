# 쯔동여지도 인사이트 페이지 구현 계획

> **최종 수정일**: 2025-12-12
> **상태**: 진행 중 (UI 구현 완료, 유튜브 구독자 연동 완료, 모의 데이터 확장됨)

## 1. 개요

관리자 전용 "쯔동여지도 인사이트" 페이지를 구현하여 다음 분석 기능을 제공합니다:
1. **유튜브 영상 히트맵 분석**: 쯔양 유튜브 영상별 시청자 참여도 분석
2. **타 유튜버 맛집 지도**: 네이버 지도 기반 맛집 마커 및 상세 정보
3. **리뷰 키워드 워드 클라우드**: 쯔양 리뷰에서 추출한 음식 키워드 시각화

---

## 2. 기술 스택

- **프론트엔드**: Next.js 16, React, TypeScript
- **UI 라이브러리**: shadcn/ui, Tailwind CSS
- **차트**: recharts
- **지도**: Naver Map API (컴포넌트 구현됨)
- **상태 관리**: React Query, useState/useCallback/useMemo
- **성능 최적화**: next/dynamic, React.memo, ScrollArea 최적화 (페이지 스크롤 제거)

---

## 3. 파일 구조

```
apps/web/
├── app/admin/insight/
│   ├── page.tsx              # 서버 컴포넌트 진입점
│   └── insight-client.tsx    # 메인 클라이언트 컴포넌트 (탭 관리, 헤더 통계)
├── components/insight/
│   ├── HeatmapSection.tsx    # 유튜브 히트맵 분석 섹션 (AI 심층 분석 포함)
│   ├── MapSection.tsx        # 맛집 지도 섹션 (사용자 제보/타 유튜버 필터)
│   └── WordCloudSection.tsx  # 워드 클라우드 섹션 (밥그릇 모양 SVG)
└── components/layout/
    └── Sidebar.tsx           # 사이드바 (인사이트 메뉴 추가됨)
```

---

## 4. 구현 상세

### 4.1 페이지 진입점 (`page.tsx`)

- `'use client'` 지시어로 클라이언트 컴포넌트로 설정
- `InsightClient`를 `next/dynamic`으로 동적 임포트 (`ssr: false`)
- `GlobalLoader` 및 `Suspense`를 사용한 로딩 처리

### 4.2 메인 클라이언트 (`insight-client.tsx`)

- **헤더**: 관리자 데이터 검수 페이지와 동일한 스타일 적용
  - 좌측: 타이틀 + 설명
  - 우측: **압축된 통계 카드 (`CompactStatCard`)** 스크롤 영역
    - `YoutubeSubscriberCard`: YouTube Data API 연동하여 실시간 구독자 수 표시
    - `YoutubeVideoCountCard`: 실시간 영상 개수 표시
- **탭 구조**: 유튜브 히트맵 / 맛집 지도 / 워드 클라우드
- **레이아웃**: `flex`와 `min-h-0`을 활용하여 전체 페이지 스크롤 없이 내부 스크롤만 동작하도록 최적화

### 4.3 유튜브 히트맵 섹션 (`HeatmapSection.tsx`)

- **영상 목록**: 6개의 모의 데이터 영상 제공 (확장됨)
- **히트맵 차트**: `recharts` AreaChart 커스텀 (그라데이션 효과)
- **AI 심층 분석 리포트 UI**:
  - Peak/Low 구간 원인 분석
  - 종합 인사이트 및 핵심 키워드 태그
- **통계**: 조회수, 게시일, 주간 변화율(%) 표시

### 4.4 맛집 지도 섹션 (`MapSection.tsx`)

- **좌측 패널**: 맛집 검색 및 목록
  - 검색 기능 구현 (이름, 주소, 카테고리)
  - 필터 탭: 전체 / 사용자 제보 / 타 유튜버
- **중앙**: `NaverMapView` 컴포넌트 (실제 로직 구현됨, 데이터 연동 대기)
  - 마커 커스텀 (사용자 제보: 파란색, 타 유튜버: 빨간색)
  - 마커 클릭 시 상세 패널 열림 + 지도 중심 이동 애니메이션
- **우측 패널**: 선택된 맛집 상세 정보 (유튜브 링크 연동)

### 4.5 워드 클라우드 섹션 (`WordCloudSection.tsx`)

- **시각화**: 밥그릇(🍚) 모양 내부에 `d3-cloud` 알고리즘으로 키워드 배치
- **데이터**: 수십 종의 음식 키워드 데이터 확장 (트렌드, 카테고리 포함)
- **인터랙션**:
  - 키워드 클릭 시 우측 패널에 관련 영상 및 리뷰 표시
  - 쯔양의 리뷰 텍스트 하이라이트

---

## 5. 성능 최적화 전략

| 기법 | 적용 위치 | 효과 |
|------|----------|------|
| `next/dynamic` | 각 섹션 컴포넌트 | 초기 번들 크기 감소, 탭 전환 시 지연 로딩 |
| `React.memo` | StatCard, ListItems | 불필요한 리렌더링 방지 |
| `useCallback` | 이벤트 핸들러 | 함수 재생성 방지 |
| `useMemo` | 필터링된 데이터 | 검색/필터 연산 캐싱 |
| `staleTime` | React Query | YouTube API 호출 최소화 (5분 캐싱) |

---

## 6. 다음 단계 (TODO)

### 6.1 데이터 연동

- [x] YouTube Data API 연동 (구독자 수)
- [ ] YouTube Analytics API 연동 or 크롤링 (히트맵 데이터)
- [ ] `backend/geminiCLI-insight-heatmap` 크롤러 완성
- [ ] Supabase `reviews` 테이블에서 키워드 추출 로직 구현

### 6.2 지도 통합 마무리

- [ ] `MapSection`의 마커를 실제 `NaverMapView` API로 렌더링 (현재 컴포넌트는 준비됨)
- [ ] 클러스터링 적용 고려 (맛집 데이터 증가 시)

### 6.3 백엔드 자동화 (GitHub Actions)

- [ ] YouTube 히트맵 크롤링 스크립트 작성
- [ ] 키워드 분석 스크립트 작성
- [ ] `insight-video-sync.yml` 등 워크플로우 설정

---

## 8. GitHub Actions 자동화 계획

### 8.1 워크플로우 목록

| 워크플로우 | 파일명 | 실행 주기 | 설명 |
|-----------|--------|----------|------|
| 히트맵 수집 | `insight-heatmap-collect.yml` | 매일 04:00 KST | YouTube 히트맵 데이터 크롤링 |
| 키워드 분석 | `insight-keyword-analyze.yml` | 매일 05:00 KST | 리뷰에서 키워드 추출 및 통계 |
| 영상 목록 동기화 | `insight-video-sync.yml` | 매일 03:00 KST | 새로운 영상 감지 및 메타데이터 수집 |

### 8.3 필요한 Secrets

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `YOUTUBE_API_KEY` (구독자 수 연동 시 사용됨)

---

## 7. 참고 자료

- [YouTube Data API v3](https://developers.google.com/youtube/v3)
- [Naver Map API](https://navermaps.github.io/maps.js/)
- [recharts 문서](https://recharts.org/en-US/)
- `d3-cloud` 라이브러리 (워드 클라우드용)
