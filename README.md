# 🔥 쯔동여지도 (Tzudong Map)

쯔양이 방문한 맛집을 팬들이 함께 리뷰하고 공유하는 크라우드소싱 맛집 지도

## ✨ 주요 기능

### Phase 1: MVP (완료)
- ✅ Google Maps 기반 지도 인터페이스
- ✅ Supabase 인증 시스템 (회원가입/로그인)
- ✅ 맛집 마커 표시 (🔥 별점 ≥4, ⭐ 그 외)
- ✅ 맛집 상세 정보 패널
- ✅ 필터링 시스템
  - 카테고리 필터 (15개 카테고리)
  - AI 점수 필터 (1-10점)
  - 리뷰 수 / 방문 횟수 필터
- ✅ 리뷰 작성 시스템
  - 인증사진 필수 (닉네임 포함)
  - 음식 사진 최대 5장
  - 관리자 승인 시스템
- ✅ 관리자 기능
  - 맛집 등록/수정/삭제
  - 주소 → 좌표 자동 변환
  - 리뷰 검증

## 🛠️ 기술 스택

### Frontend
- **Framework**: React 18 + TypeScript
- **Build Tool**: Vite
- **UI Components**: Shadcn UI + Radix UI
- **Styling**: Tailwind CSS
- **State Management**: TanStack Query
- **Map**: Google Maps JavaScript API

### Backend
- **Database**: Supabase (PostgreSQL)
- **Authentication**: Supabase Auth
- **Storage**: Supabase Storage
- **Real-time**: Supabase Realtime

## 📦 설치 및 실행

### 1. 환경 변수 설정

`.env.local` 파일을 생성하고 다음 값들을 입력하세요:

```env
# Supabase
VITE_SUPABASE_URL=your-supabase-project-url
VITE_SUPABASE_ANON_KEY=your-supabase-anon-key

# Google Maps
VITE_GOOGLE_MAPS_API_KEY=your-google-maps-api-key
```

### 2. 의존성 설치

```bash
npm install
```

### 3. Supabase 마이그레이션 실행

```bash
# Supabase CLI 설치 (최초 1회)
npm install -g supabase

# Supabase 프로젝트와 연결
supabase link --project-ref your-project-ref

# 마이그레이션 실행
supabase db push
```

### 4. 개발 서버 실행

```bash
npm run dev
```

브라우저에서 `http://localhost:5173` 열기

## 🗄️ 데이터베이스 스키마

### 주요 테이블
- **users**: 사용자 정보
- **user_roles**: 사용자 권한 관리
- **profiles**: 사용자 프로필
- **restaurants**: 맛집 정보
- **reviews**: 리뷰 (인증사진, 음식사진, 내용)
- **user_stats**: 사용자 통계 (리더보드용)
- **server_costs**: 서버 비용 투명성

## 🎨 UI/UX 특징

### 반응형 디자인
- Mobile-first 접근
- 태블릿/데스크톱 최적화

### 다크모드 지원
- 시스템 테마 감지
- 수동 전환 가능

### 접근성
- ARIA 레이블
- 키보드 네비게이션
- 스크린 리더 지원

## 🔐 보안

- Row Level Security (RLS) 정책 적용
- JWT 기반 인증
- 파일 업로드 검증 (5MB 제한)
- SQL Injection 방어
- XSS 방어

## 🚀 배포

### Vercel (추천)
```bash
npm run build
vercel --prod
```

### 환경 변수 설정
Vercel 대시보드에서 환경 변수 설정:
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`
- `VITE_GOOGLE_MAPS_API_KEY`

## 📝 라이선스

MIT License

## 👥 기여

기여는 언제나 환영합니다!

1. Fork the Project
2. Create your Feature Branch (`git checkout -b feature/AmazingFeature`)
3. Commit your Changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the Branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

## 📧 문의

프로젝트 관련 문의사항은 Issue를 통해 남겨주세요.

---

**Made with ❤️ for Tzuyang fans**
