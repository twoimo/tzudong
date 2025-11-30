# 🚀 쯔동여지도여지도 설치 가이드

## 📋 사전 준비사항

### 필수 도구 설치
1. **Node.js** (v18 이상) - https://nodejs.org/
2. **Git** - https://git-scm.com/
3. **Supabase CLI** - `npm install -g supabase`

### 계정 생성
1. **Supabase** - https://supabase.com/
2. **Google Cloud Platform** - https://console.cloud.google.com/

---

## 1️⃣ Google Maps API 설정

### 1.1. Google Cloud Console 접속
https://console.cloud.google.com/

### 1.2. 새 프로젝트 생성
- 프로젝트 이름: `tzudong-map`
- 위치: 조직 없음

### 1.3. 필수 API 활성화
다음 API들을 모두 활성화해야 합니다:

#### Maps JavaScript API
1. **API 및 서비스** → **라이브러리**
2. **Maps JavaScript API** 검색
3. **사용** 버튼 클릭

#### Geocoding API (주소 → 좌표 변환용)
1. **API 및 서비스** → **라이브러리**
2. **Geocoding API** 검색  
3. **사용** 버튼 클릭

#### Places API (선택사항, 향후 기능용)
1. **API 및 서비스** → **라이브러리**
2. **Places API** 검색
3. **사용** 버튼 클릭

### 1.4. API 키 생성
1. **API 및 서비스** → **사용자 인증 정보**
2. **사용자 인증 정보 만들기** → **API 키**
3. 생성된 키 복사
4. (권장) **API 키 제한** 설정
   - 애플리케이션 제한사항: HTTP 리퍼러
   - 리퍼러: 
     - `http://localhost:5173/*`
     - `http://localhost:*/*`
     - `https://yourdomain.com/*`
   - API 제한사항: 다음 API만 허용
     - Maps JavaScript API
     - Geocoding API
     - Places API (선택사항)

### 1.5. 빌링 설정 (필수)
Google Maps Platform은 무료 크레딧($200/월)을 제공하지만 빌링 계정 연결이 필수입니다:
1. **결제** → **결제 계정 만들기**
2. 카드 정보 입력 (무료 크레딧 소진 전까지는 과금되지 않음)
3. 월별 할당량 초과 알림 설정 권장

---

## 2️⃣ Supabase 프로젝트 설정

### 2.1. Supabase 프로젝트 생성
1. https://supabase.com/dashboard 접속
2. **New Project** 클릭
3. 프로젝트 정보 입력:
   - Name: `tzudong-map`
   - Database Password: 강력한 비밀번호
   - Region: Northeast Asia (Seoul) 추천

### 2.2. 프로젝트 정보 확인
프로젝트 생성 후 **Settings** → **API**에서 확인:
- Project URL: `https://xxxxx.supabase.co`
- Project API keys → `anon public` 키 복사

### 2.3. Supabase CLI 로그인
```bash
supabase login
```

### 2.4. 로컬 프로젝트와 연결
```bash
cd tzudong
supabase link --project-ref your-project-ref
```

> **Project Reference**는 Supabase Dashboard → Settings → General에서 확인

---

## 3️⃣ 프로젝트 설정

### 3.1. 저장소 클론
```bash
git clone https://github.com/yourusername/tzudong.git
cd tzudong
```

### 3.2. 의존성 설치
```bash
npm install
```

### 3.3. 환경 변수 설정
`.env.local` 파일 생성:

```env
# Supabase
VITE_SUPABASE_URL=https://xxxxx.supabase.co
VITE_SUPABASE_ANON_KEY=your-supabase-anon-key

# Google Maps
VITE_GOOGLE_MAPS_API_KEY=your-google-maps-api-key
```

### 3.4. 데이터베이스 마이그레이션
```bash
supabase db push
```

마이그레이션 파일들 (`supabase/migrations/`):
- `20251021075749_*.sql` - 기본 테이블 생성 (users, profiles, restaurants, reviews, etc.)
- `20251021075837_*.sql` - 함수 보안 설정
- `20251021140000_add_helper_functions.sql` - 헬퍼 함수 및 Storage 설정
- `20251021180000_add_missing_columns.sql` - 추가 컬럼 (jjyang_visit_count, description, etc.)

### 3.5. 마이그레이션 확인
```bash
supabase migration list
```

모든 마이그레이션이 ✓ 표시되어 있어야 합니다.

---

## 4️⃣ 개발 서버 실행

```bash
npm run dev
```

브라우저에서 `http://localhost:5173` 접속

---

## 5️⃣ 관리자 계정 설정

### 5.1. 회원가입
1. 개발 서버에서 회원가입
2. 이메일/비밀번호로 계정 생성

### 5.2. 관리자 권한 부여
Supabase Dashboard → **SQL Editor**에서 실행:

```sql
-- 사용자 이메일로 user_id 확인
SELECT id, email FROM auth.users WHERE email = 'your-email@example.com';

-- 관리자 권한 추가
INSERT INTO user_roles (user_id, role)
VALUES ('사용자-id', 'admin');
```

### 5.3. 확인
로그아웃 후 다시 로그인하면 헤더에 **관리자 설정** 메뉴가 표시됩니다.

---

## 6️⃣ 초기 데이터 입력

### 6.1. 맛집 등록
1. 관리자로 로그인
2. 우측 하단 **+ 맛집 등록** 버튼 클릭
3. 맛집 정보 입력:
   - 이름
   - 주소 (주소 입력 후 Tab 키를 누르면 좌표 자동 입력)
   - 카테고리
   - AI 점수
   - (선택) 유튜브 링크, 쯔양 리뷰

### 6.2. 테스트 데이터
```sql
-- SQL Editor에서 샘플 데이터 삽입
INSERT INTO restaurants (
  name, address, category, lat, lng, ai_rating, 
  jjyang_visit_count, youtube_link, tzuyang_review, description
)
VALUES 
  (
    '홍대 떡볶이', 
    '서울특별시 마포구 홍익로 123', 
    '분식', 
    37.5563, 
    126.9236, 
    8.5,
    2,
    'https://youtube.com/watch?v=example', 
    '정말 맛있었어요!',
    '쯔양이 두 번이나 방문한 떡볶이 맛집'
  ),
  (
    '강남 삼겹살', 
    '서울특별시 강남구 테헤란로 456', 
    '고기', 
    37.4979, 
    127.0276, 
    7.8,
    1,
    NULL, 
    '양이 많고 고기 질이 좋아요',
    '1인분 양이 푸짐한 삼겹살집'
  );
```

---

## 7️⃣ Supabase Storage 설정

### 7.1. Storage Bucket 확인
Supabase Dashboard → **Storage** → `review-photos` 버킷 확인

> 마이그레이션 `20251021140000_add_helper_functions.sql`에서 자동 생성됩니다.

### 7.2. Public Access 설정 확인
- Bucket은 **Public**으로 설정되어 있어야 합니다
- 다음 Policy들이 적용되어 있어야 합니다:
  - `Anyone can view review photos` - 모든 사용자가 사진 조회 가능
  - `Authenticated users can upload review photos` - 로그인한 사용자만 업로드
  - `Users can update own review photos` - 본인 사진만 수정
  - `Users can delete own review photos` - 본인 사진만 삭제

### 7.3. 파일 업로드 테스트
1. 리뷰 작성 모달에서 이미지 업로드 테스트
2. Supabase Dashboard → Storage에서 파일 확인
3. 파일 경로: `review-photos/{user_id}/{timestamp}_{filename}`

### 7.4. Storage 용량 관리
- Free 플랜: 1GB 무료
- Pro 플랜: 100GB 포함, 초과 시 $0.021/GB
- 정기적으로 미사용 파일 정리 권장

---

## 8️⃣ 배포 (Vercel)

### 8.1. Vercel 계정 연결
```bash
npm install -g vercel
vercel login
```

### 8.2. 프로젝트 배포
```bash
npm run build
vercel --prod
```

### 8.3. 환경 변수 설정
Vercel Dashboard → Project → Settings → Environment Variables

**Production** 환경에 추가:
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`
- `VITE_GOOGLE_MAPS_API_KEY`

### 8.4. 재배포
```bash
vercel --prod
```

---

## ⚠️ 문제 해결

### Google Maps가 로딩되지 않아요
- `.env.local`의 API 키가 올바른지 확인
- Google Cloud Console에서 다음 API들이 활성화되었는지 확인:
  - Maps JavaScript API
  - Geocoding API
- **빌링 계정이 연결되었는지 확인** (가장 흔한 원인)
- 브라우저 콘솔에서 에러 메시지 확인
- API 키 제한이 너무 엄격하지 않은지 확인

### 주소 입력 시 좌표 변환이 안 돼요
- Geocoding API가 활성화되었는지 확인
- API 키 제한에 Geocoding API가 포함되어 있는지 확인
- 주소를 더 상세하게 입력 (예: "서울특별시 강남구 테헤란로 152")

### Supabase 연결 오류
- `.env.local` 파일의 URL과 키가 정확한지 확인
- Supabase 프로젝트가 활성화되어 있는지 확인
- 네트워크 연결 확인

### 마이그레이션 실패
```bash
# 마이그레이션 상태 확인
supabase migration list

# 마이그레이션 재실행
supabase db reset
supabase db push
```

### 관리자 메뉴가 안 보여요
- `user_roles` 테이블에 admin 권한이 추가되었는지 확인
- 로그아웃 후 다시 로그인
- 브라우저 캐시 삭제

### 리뷰 사진 업로드가 실패해요
- Supabase Storage에 `review-photos` 버킷이 생성되었는지 확인
- 버킷이 Public으로 설정되어 있는지 확인
- Storage Policy가 올바르게 적용되었는지 확인
- 파일 크기 제한 확인 (Free 플랜: 50MB/파일)
- 지원되는 이미지 포맷: JPG, PNG, GIF, WebP

### 리뷰 작성 후 목록에 안 나타나요
- 리뷰는 기본적으로 `is_verified: false` 상태로 저장됩니다
- 관리자가 검토 후 승인해야 공개됩니다
- 필터에서 "검토 대기" 상태로 확인할 수 있습니다

---

## 📞 지원

문제가 해결되지 않으면:
1. GitHub Issues에 문제 등록
2. [Supabase Discord](https://discord.supabase.com/) 참조
3. [Google Maps Platform Support](https://support.google.com/googleapi/)

---

## 🎉 완료!

모든 설정이 완료되었습니다. 쯔동여지도여지도를 즐겨보세요!

**다음 단계:**
- 실제 맛집 데이터 추가
- 사용자 테스트
- 피드백 수집
- Phase 2 기능 개발

