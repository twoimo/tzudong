# 쯔둥 (Tzudong)

쯔양의 맛집 정보를 기반으로 한 레스토랑 검색 및 관리 플랫폼

## 🎯 주요 기능

### 사용자 기능
- 🗺️ **지도 기반 맛집 검색**: Google Maps 또는 Naver Maps 통합
- 🔍 **다양한 필터링**: 지역, 카테고리, 평가 점수 기반 검색
- 📺 **YouTube 영상 연동**: 쯔양의 방문 영상 바로 보기
- 📱 **반응형 디자인**: 모바일/데스크톱 최적화

### 관리자 기능
- ✅ **데이터 검수 시스템** (신규!)
  - YouTube 영상에서 추출한 레스토랑 정보 검토 및 승인
  - 7가지 평가 지표 기반 품질 관리
  - 일괄 처리 및 상태 관리

## 📋 관리자 데이터 검수 (Admin Evaluation Management)

새로 추가된 **관리자 데이터 검수** 기능은 사이드바에서 접근 가능하며, YouTube 영상에서 자동 추출한 레스토랑 정보를 검토하고 승인하는 워크플로우를 제공합니다.

### 7가지 평가 지표

| 항목 | 설명 | 평가 범위 |
|------|------|-----------|
| **1️⃣ 방문 여부 정확성** (Visit Authenticity) | 실제 방문 여부 및 정확도 | 0-4점 |
| **2️⃣ 추론 합리성** (Reasoning Quality) | 추론 과정의 논리성 | 0-2점 |
| **3️⃣ 실제 근거 일치도** (Grounding Accuracy) | 영상 내용과 추출 정보의 일치도 | True/False |
| **4️⃣ 리뷰 충실도** (Review Faithfulness) | 음식 리뷰의 정확성 | 0-1점 |
| **5️⃣ 주소 정합성** (Location Match) | 주소 정보의 정확성 | True/False/Failed |
| **6️⃣ 카테고리 유효성** (Category Validity) | 카테고리 파싱 성공 여부 | True/False |
| **7️⃣ 카테고리 정합성** (Category Consistency) | 카테고리 분류의 적절성 | True/False |

### 주요 기능

#### 📊 평가 테이블
- **필터 리셋 버튼**: 왼쪽 상단에 위치하여 모든 필터를 한 번에 초기화
- **필터 활성화 표시**: 필터가 적용된 컬럼의 메뉴 버튼은 초록색 배경으로 표시
- **고정 컬럼**:
  - 왼쪽: 필터 리셋 버튼, 영상 정보 (YouTube 썸네일 클릭 가능)
  - 오른쪽: 상태 관리 및 액션 버튼
- **인라인 필터링**: 각 컬럼 헤더에서 직접 필터 적용
- **시각적 표시**:
  - True: 🟢 녹색 배지
  - False: 🔴 빨간색 배지
  - Failed: 🟡 노란색 배지

#### 🔄 상태 관리
- `pending`: 검토 대기
- `approved`: 승인됨
- `hold`: 보류
- `missing`: 정보 누락
- `db_conflict`: DB 충돌
- `geocoding_failed`: 지오코딩 실패

#### ⚡ 액션 및 내부 로직
- **승인 (Approve)**: 
  - ✅ 지오코딩 성공 여부 자동 체크
  - ✅ 지번주소로 기존 음식점 검색
  - ✅ **자동 병합**: 같은 주소의 같은 이름 → YouTube 링크, 리뷰 자동 병합
  - ✅ **충돌 감지**: 같은 주소에 다른 이름 → `db_conflict` 상태로 변경
  - ✅ **신규 등록**: 새 음식점 자동 등록 및 `approved` 상태 업데이트
  - ⚠️ Missing 음식점은 승인 불가 (수동 등록 필요)
- **보류 (Hold)**: 
  - 추가 검토가 필요한 경우 상태만 `hold`로 변경
  - DB에는 등록하지 않음
- **삭제 (Delete)**: 
  - 확인 후 evaluation_records에서 영구 삭제
  - 실수 방지를 위한 확인 다이얼로그 표시
- **수동 등록**: Missing 레스토랑 정보를 수동으로 입력하여 등록

> 💡 **Optimistic Locking**: 동시 수정 방지를 위해 `updated_at` 기반 낙관적 잠금 적용

### 사용 방법

1. **사이드바**에서 "관리자 데이터 검수" 클릭
2. **상태 필터**: 상단 카테고리 바에서 pending, approved, hold 등 선택
3. **컬럼 필터**: 각 컬럼 헤더의 메뉴 버튼(≡)으로 조건 설정
   - 필터 적용된 컬럼은 초록색 배경으로 표시됨
4. **필터 초기화**: 왼쪽 상단 새로고침 아이콘(↻) 버튼으로 모든 필터 리셋
5. **상세 보기**: 행 왼쪽 확장 버튼(▼) 클릭
6. **검토**: 7가지 평가 지표 확인 및 YouTube 영상 클릭하여 검증
7. **액션 실행**:
   - **승인**: 지오코딩 성공 + 유효한 주소 → 자동 처리 (병합/충돌감지/신규등록)
   - **보류**: 추가 검토 필요 시 상태만 변경
   - **삭제**: 불필요한 레코드 영구 삭제 (확인 다이얼로그)
   - **수동 등록**: Missing 음식점 정보 직접 입력

### 데이터 소스

평가 데이터는 `backend/perplexity-restaurant-evaluation/`에서 수집 및 처리됩니다:
- YouTube 영상 URL 목록
- Perplexity AI 기반 정보 추출
- 네이버 지오코딩 API 주소 검증

## 🚀 시작하기

### 필수 조건

- Node.js 18+
- Bun (권장) 또는 npm
- Supabase 계정

### 설치

```bash
# 저장소 클론
git clone <repository-url>
cd tzudong

# 의존성 설치
bun install

# 환경 변수 설정
cp .env.example .env
# .env 파일 편집하여 Supabase 키 입력
```

### 환경 변수

`.env` 파일에 다음을 설정하세요:

```env
VITE_SUPABASE_URL=your_supabase_url
VITE_SUPABASE_ANON_KEY=your_supabase_anon_key
VITE_GOOGLE_MAPS_API_KEY=your_google_maps_key
VITE_NAVER_MAPS_CLIENT_ID=your_naver_maps_client_id
```

### 개발 서버 실행

```bash
bun run dev
# 또는
npm run dev
```

브라우저에서 `http://localhost:8080` 접속

## 📁 프로젝트 구조

```
tzudong/
├── src/
│   ├── components/
│   │   ├── admin/           # 관리자 컴포넌트
│   │   │   ├── EvaluationTableNew.tsx  # 평가 테이블
│   │   │   └── EvaluationRowDetails.tsx # 상세 정보
│   │   ├── map/             # 지도 컴포넌트
│   │   ├── filters/         # 필터 컴포넌트
│   │   └── ui/              # shadcn/ui 컴포넌트
│   ├── pages/
│   │   ├── AdminEvaluationPage.tsx  # 데이터 검수 페이지
│   │   └── FilteringPage.tsx        # 메인 검색 페이지
│   ├── contexts/            # React Context
│   ├── hooks/               # Custom Hooks
│   └── integrations/        # Supabase 연동
├── backend/
│   └── perplexity-restaurant-evaluation/
│       ├── src/             # 데이터 수집 로직
│       └── scripts/
│           └── db-migration/  # DB 마이그레이션 스크립트
└── supabase/
    └── migrations/          # Supabase 스키마
```

## 🗄️ 데이터베이스 마이그레이션

평가 데이터를 Supabase에 로딩하려면:

```bash
cd backend/perplexity-restaurant-evaluation/scripts/db-migration
python3 load_data_in_batches.py
```

자세한 내용은 [DB Migration Guide](./backend/perplexity-restaurant-evaluation/scripts/db-migration/README.md)를 참조하세요.

## 🛠️ 기술 스택

### Frontend
- **Framework**: React 18 + TypeScript
- **Build Tool**: Vite 5.4
- **UI Library**: shadcn/ui (Radix UI)
- **Styling**: Tailwind CSS
- **Maps**: Google Maps API / Naver Maps API

### Backend
- **Database**: Supabase (PostgreSQL)
- **Authentication**: Supabase Auth
- **Storage**: Supabase Storage

### Dev Tools
- **Package Manager**: Bun
- **Linting**: ESLint
- **Data Crawling**: Playwright (Perplexity AI)

## 📝 주요 컴포넌트

### EvaluationTableNew.tsx
- 평가 레코드 표시 및 관리
- 7개 평가 지표 컬럼 + 상태/액션
- 인라인 필터링 (드롭다운)
- Sticky 컬럼 (왼쪽: 영상 정보, 오른쪽: 상태/액션)
- YouTube 썸네일 통합

### AdminEvaluationPage.tsx
- 평가 데이터 로딩 및 상태 관리
- 필터 로직 구현
- 승인/보류/삭제 액션 처리

## 🐛 알려진 이슈

- [ ] 마지막 레코드 스크롤 잘림 현상 (확인 필요)

## 📚 추가 문서

- [제품 명세서](./docs/PRODUCT_SPEC.md)
- [설치 가이드](./docs/SETUP_GUIDE.md)
- [네이버 지오코딩 설정](./docs/NAVER_GEOCODING_SETUP.md)

## 🤝 기여

이슈 및 PR은 언제든 환영합니다!

## 📄 라이선스

MIT License
