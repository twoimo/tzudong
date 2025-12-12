# 쯔동여지도 인사이트 페이지 구현 계획

> **최종 수정일**: 2025-12-12
> **상태**: 진행 중 (UI 구현 완료, 데이터 연동 필요)

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
- **지도**: Naver Map API (향후 통합 예정)
- **상태 관리**: React Query, useState/useCallback/useMemo
- **성능 최적화**: next/dynamic, React.memo

---

## 3. 파일 구조

```
apps/web/
├── app/admin/insight/
│   ├── page.tsx              # 서버 컴포넌트 진입점 (클라이언트로 변환됨)
│   └── insight-client.tsx    # 메인 클라이언트 컴포넌트
├── components/insight/
│   ├── HeatmapSection.tsx    # 유튜브 히트맵 분석 섹션
│   ├── MapSection.tsx        # 맛집 지도 섹션
│   └── WordCloudSection.tsx  # 워드 클라우드 섹션
└── components/layout/
    └── Sidebar.tsx           # 사이드바 (인사이트 메뉴 추가됨)
```

---

## 4. 구현 상세

### 4.1 페이지 진입점 (`page.tsx`)

- `'use client'` 지시어로 클라이언트 컴포넌트로 설정
- `InsightClient`를 `next/dynamic`으로 동적 임포트 (`ssr: false`)
- `Suspense`를 사용한 로딩 폴백 제공

### 4.2 메인 클라이언트 (`insight-client.tsx`)

- **헤더**: 관리자 데이터 검수 페이지와 동일한 스타일
  - 좌측: 타이틀 + 설명
  - 우측: 압축된 통계 카드 (`CompactStatCard`)
- **탭 구조**: 유튜브 히트맵 / 맛집 지도 / 워드 클라우드
- **관리자 접근 제어**: `useAuth().isAdmin` 확인

### 4.3 유튜브 히트맵 섹션 (`HeatmapSection.tsx`)

- **좌측 패널**: 영상 목록 (썸네일, 제목, 조회수)
- **우측 콘텐츠**:
  - recharts `AreaChart`로 시청 유지율 시각화
  - 가장 많이/적게 본 구간 분석 카드
- **현재 상태**: 모의 데이터 사용

### 4.4 맛집 지도 섹션 (`MapSection.tsx`)

- **좌측 패널**: 맛집 검색 및 목록
  - 필터: 사용자 제보 / 타 유튜버
  - 맛집 카드: 이름, 주소, 카테고리, 별점
- **중앙**: 지도 플레이스홀더 (NaverMap 통합 예정)
- **우측 패널**: 선택된 맛집 상세 정보
- **현재 상태**: 모의 데이터 사용

### 4.5 워드 클라우드 섹션 (`WordCloudSection.tsx`)

- **좌측**: 밥그릇(🍚) 모양 워드 클라우드
  - SVG 기반 나선형 배치 알고리즘
  - 카테고리별 색상 구분
  - 클릭 시 관련 영상 표시
- **우측**: 선택된 키워드의 관련 영상 및 쯔양 리뷰 목록
- **현재 상태**: 모의 데이터 사용

---

## 5. 성능 최적화 전략

| 기법 | 적용 위치 | 효과 |
|------|----------|------|
| `next/dynamic` | 각 섹션 컴포넌트 | 초기 번들 크기 감소, 탭 전환 시 지연 로딩 |
| `React.memo` | StatCard, SectionSkeleton 등 | 불필요한 리렌더링 방지 |
| `useCallback` | 이벤트 핸들러 | 함수 재생성 방지 |
| `useMemo` | 필터링된 데이터, 계산 값 | 비용이 큰 연산 캐싱 |

---

## 6. 다음 단계 (TODO)

### 6.1 데이터 연동

- [ ] YouTube Data API 연동 (영상 목록, 조회수)
- [ ] YouTube Analytics API 연동 (시청 유지율 데이터) - **제한적 접근 확인 필요**
- [ ] `backend/geminiCLI-insight-heatmap` 크롤러 완성
- [ ] Supabase `reviews` 테이블에서 키워드 추출 로직 구현
- [ ] 타 유튜버 맛집 데이터 수집 파이프라인 구축

### 6.2 지도 통합

- [ ] `MapSection`의 플레이스홀더를 실제 `NaverMapView`로 교체
- [ ] 마커 클릭 → 상세 패널 연동
- [ ] 사용자 제보 / 타 유튜버 마커 스타일 구분

### 6.3 UI/UX 개선

- [ ] 반응형 디자인 세밀 조정 (모바일)
- [ ] 로딩 스켈레톤 개선
- [ ] 에러 상태 처리 UI

### 6.4 백엔드 작업 (GitHub Actions 자동화)

> **자동화 전략**: GitHub Actions를 활용하여 주기적으로 백엔드 로직 실행

- [ ] YouTube 히트맵 크롤링 스크립트 (`puppeteer` + SVG 파싱)
- [ ] 키워드 추출 스크립트 (Supabase → 키워드 분석 → 저장)
- [ ] 영상별 히트맵 데이터 저장 테이블 설계
- [ ] GitHub Actions 워크플로우 작성

---

## 8. GitHub Actions 자동화 계획

### 8.1 워크플로우 목록

| 워크플로우 | 파일명 | 실행 주기 | 설명 |
|-----------|--------|----------|------|
| 히트맵 수집 | `insight-heatmap-collect.yml` | 매일 04:00 KST | YouTube 히트맵 데이터 크롤링 |
| 키워드 분석 | `insight-keyword-analyze.yml` | 매일 05:00 KST | 리뷰에서 키워드 추출 및 통계 |
| 영상 목록 동기화 | `insight-video-sync.yml` | 매일 03:00 KST | 새로운 영상 감지 및 메타데이터 수집 |

### 8.2 워크플로우 구조 예시

```yaml
# .github/workflows/insight-heatmap-collect.yml
name: Insight Heatmap Collection

on:
  schedule:
    - cron: '0 19 * * *'  # 매일 04:00 KST (UTC 19:00)
  workflow_dispatch:  # 수동 실행 가능

jobs:
  collect-heatmap:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
      - name: Install dependencies
        run: cd backend/geminiCLI-insight-heatmap && npm ci
      - name: Run heatmap collector
        env:
          SUPABASE_URL: ${{ secrets.SUPABASE_URL }}
          SUPABASE_SERVICE_ROLE_KEY: ${{ secrets.SUPABASE_SERVICE_ROLE_KEY }}
        run: node backend/geminiCLI-insight-heatmap/collect.js
```

### 8.3 필요한 Secrets

- `SUPABASE_URL` - Supabase 프로젝트 URL
- `SUPABASE_SERVICE_ROLE_KEY` - 서비스 역할 키 (백엔드 전용)
- `YOUTUBE_API_KEY` - YouTube Data API 키 (선택)

---

## 7. 참고 자료

- [YouTube Analytics API](https://developers.google.com/youtube/analytics)
- [Naver Map API](https://navermaps.github.io/maps.js/)
- [recharts 문서](https://recharts.org/en-US/)
- 기존 `backend/geminiCLI-insight-heatmap` 폴더 참조
