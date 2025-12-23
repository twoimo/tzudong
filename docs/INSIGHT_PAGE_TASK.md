# 쯔동여지도 인사이트 페이지 작업 목록

> **최종 수정일**: 2025-12-12
> **진행률**: 약 60% (UI 구조 완료, 일부 데이터 연동 및 모의 데이터 확장)

---

## 1단계: 기본 구조 및 라우팅 ✅

- [x] 사이드바에 "쯔동여지도 인사이트" 메뉴 항목 추가
- [x] `/admin/insight` 페이지 라우트 생성
- [x] 서버/클라이언트 컴포넌트 분리 구조 설정
- [x] 관리자 접근 권한 체크 로직 구현
- [x] 헤더 스타일을 관리자 데이터 검수 페이지와 일치시킴
- [x] 헤더에 압축된 통계 카드 (`CompactStatCard`) 구현
- [x] YouTube 구독자 수 및 동영상 수 실시간 연동 (Header)

---

## 2단계: 유튜브 히트맵 분석 UI ✅

- [x] `HeatmapSection.tsx` 컴포넌트 생성
- [x] 영상 목록 패널 UI 구현과 모의 데이터 확장 (6개 영상)
- [x] recharts 기반 히트맵 차트 구현
- [x] 가장 많이/적게 본 구간 분석 카드 UI
- [x] AI 심층 분석 리포트 UI 구현 ("Gemini 심층 분석 리포트")
- [x] 모의 데이터로 UI 동작 확인
- [/] 실제 YouTube 데이터 연동 (구독자 수 완료, 히트맵 데이터 대기 중)
- [ ] 일주일 단위 변화 비교 기능

---

## 3단계: 맛집 지도 UI ✅

- [x] `MapSection.tsx` 컴포넌트 생성
- [x] 맛집 목록 패널 UI (검색, 필터)
- [x] 지도 플레이스홀더 UI
- [x] 맛집 상세 정보 우측 패널 UI
- [x] 사용자 제보 / 타 유튜버 구분 표시 및 마커 스타일링
- [ ] NaverMapView 실제 통합 (현재 컴포넌트 구조는 잡혔으나 API 연동 확인 필요)
- [x] 마커 클릭 인터랙션 구현
- [ ] 실제 맛집 데이터 연동

---

## 4단계: 워드 클라우드 UI ✅

- [x] `WordCloudSection.tsx` 컴포넌트 생성
- [x] 밥그릇(🍚) 모양 워드 클라우드 구현 (SVG 기반)
- [x] 카테고리별 색상 구분
- [x] 키워드 클릭 시 관련 영상 목록 표시
- [x] 쯔양의 리뷰 표시 UI
- [x] 모의 데이터 대폭 확장 (다양한 음식 카테고리 수십 종)
- [ ] 실제 키워드 데이터 추출 로직
- [ ] 키워드 빈도 통계 API

---

## 5단계: 성능 최적화 ✅

- [x] 각 섹션 컴포넌트 동적 임포트 (`next/dynamic`)
- [x] `React.memo`로 불필요한 리렌더링 방지
- [x] `useCallback`, `useMemo` 적용
- [x] 로딩 스켈레톤 컴포넌트 구현 (텍스트 로딩 제거, 스피너 적용)
- [x] 전체 페이지 레이아웃 최적화 (스크롤 제거, 반응형)

---

## 6단계: 데이터 연동 ⏳ (진행 예정)

- [x] YouTube Data API 설정 (구독자 수 조회용)
- [ ] 히트맵 크롤러 (`backend/geminiCLI-insight-heatmap`) 완성
- [ ] Supabase `reviews` 테이블에서 키워드 추출
- [ ] 타 유튜버 맛집 데이터 수집 파이프라인
- [ ] API 엔드포인트 생성:
  - [ ] `/api/insight/videos` - 영상 목록
  - [ ] `/api/insight/heatmap/[videoId]` - 영상별 히트맵
  - [ ] `/api/insight/keywords` - 키워드 통계
  - [ ] `/api/insight/restaurants` - 맛집 데이터

---

## 6.5단계: GitHub Actions 워크플로우 ⏳ (진행 예정)

> **자동화 전략**: GitHub Actions로 백엔드 로직을 주기적으로 실행

- [ ] `.github/workflows/insight-video-sync.yml` - 영상 목록 동기화 (매일)
- [ ] `.github/workflows/insight-heatmap-collect.yml` - 히트맵 수집 (매일)
- [ ] `.github/workflows/insight-keyword-analyze.yml` - 키워드 분석 (매일)
- [ ] Secrets 설정:
  - [ ] `SUPABASE_URL`
  - [ ] `SUPABASE_SERVICE_ROLE_KEY`
  - [ ] `YOUTUBE_API_KEY` (선택)

---

## 7단계: 지도 통합 ⏳ (진행 예정)

- [ ] `MapSection` 내 NaverMapView 통합
- [ ] 마커 데이터 바인딩
- [ ] 마커 클릭 → 상세 패널 연동
- [ ] 클러스터링 적용 (맛집 수가 많을 경우)

---

## 8단계: 테스트 및 배포 ⏳

- [ ] TypeScript 빌드 오류 확인
- [ ] 반응형 디자인 테스트
- [ ] 에러 핸들링 및 빈 상태 UI
- [ ] 프로덕션 배포

---

## 참고 사항

### 현재 사용 중인 모의 데이터 위치
- `HeatmapSection.tsx`: `MOCK_VIDEOS` (6개), `MOCK_HEATMAP_DATA` (각 비디오별 포함)
- `MapSection.tsx`: `MOCK_USER_REPORTS`, `MOCK_YOUTUBER_SPOTS`
- `WordCloudSection.tsx`: `MOCK_KEYWORDS` (대량), `MOCK_VIDEOS_BY_KEYWORD`

### 관련 백엔드 작업
- `backend/geminiCLI-insight-heatmap/` - 히트맵 크롤링
- `supabase/backup-db/` - 리뷰 데이터 참조

### 의존성
- `recharts` - 차트 시각화 (이미 설치됨)
- `lucide-react` - 아이콘 (이미 설치됨)
- Naver Map API - 환경변수 설정 필요
