# 쯔동여지도 제품 명세서

## 1. 서비스 요약

### 목적
쯔양이 방문한 맛집을 팬들이 함께 리뷰하고 공유하는 구글맵 기반 크라우드소싱 플랫폼

### 타깃 유저
- 쯔양 유튜브 구독자 및 팬
- 맛집 탐방을 좋아하는 일반 사용자
- 쯔양의 맛집 정보를 찾는 사람들

### 핵심 가치 제안
- 쯔양이 방문한 맛집을 지도에서 한눈에 확인
- 팬들의 실제 방문 리뷰로 검증된 정보
- 투명한 커뮤니티 운영 (서버 비용 공개)

### 품질 요구사항
- **성능**: 세계 최고 수준의 웹 성능 구현
- **보안**: 보안약점/취약점이 없는 안전한 플랫폼
- **확장성**: 대한민국 우선 개발, 글로벌 국가 지도 확장 가능

---

## 2. 기능 목록 (우선순위)

### Phase 1: MVP (1-2개월)

#### ✅ 필수 기능
- [x] 구글맵 기반 메인 화면
- [x] 맛집 마커 표시
- [x] 상단 헤더
  - 좌측: 사이드바 토글 버튼 (☰)
  - 우측: 사용자 메뉴, 다크모드 전환, 알림, 전체화면, 로그인/로그아웃
- [x] 좌측 사이드바 (기본: 보임 상태)
  - 로고 (🔥쯔동여지도)
  - 쯔동여지도 홈
  - 쯔동여지도 필터링
  - 쯔동여지도 랭킹
  - 쯔동여지도 리뷰
  - 쯔동여지도 제보 (로그인 사용자만)
  - 관리자 제보 관리 (관리자만)
  - 월 서버 운영 비용
- [x] 로그인/회원가입 모달
  - 로그인: 아이디, 비밀번호 입력
  - 회원가입: 아이디, 비밀번호, 비밀번호 확인, 이메일, 닉네임
  - 회원가입 시 캡챠 인증
- [x] 맛집 상세 정보 패널
  - 쯔양 방문횟수, 사용자 방문횟수, 리뷰수
  - 매장 정보 (주소, 전화번호, 등록일)
  - 쯔양 유튜브 영상 링크
  - 쯔양의 리뷰
  - 길찾기 기능
  - 리뷰 작성하기 버튼
- [x] 관리자 맛집 등록/수정/삭제
  - 맛집 상호명
  - 주소 (자동 좌표 변환)
  - 전화번호
  - 카테고리 (15개)
  - 유튜브 영상 링크
  - 쯔양 리뷰 내용
  - 쯔양 방문횟수

#### 🎯 중요 기능
- [x] 필터링 시스템 (행렬 테이블 구조)
  - 쯔양 방문횟수 (쯔양이 여러번 다녀온 맛집)
  - 사용자 방문횟수 (사용자들이 여러번 다녀온 맛집)
  - 리뷰 수 (리뷰가 많은 맛집)
  - 카테고리 (치킨, 중식, 돈까스·회, 피자, 패스트푸드, 찜·탕, 족발·보쌈, 분식, 카페·디저트, 한식, 고기, 양식, 아시안, 야식, 도시락)
  - 테이블 정렬/필터 기능
  - 맛집명 검색
  - 선택된 필터 태그 표시
  - 실시간 결과 개수 표시
- [x] 쯔동여지도 리뷰 (게시판 형태)
  - 필수 정보 입력
    - 방문 날짜/시간
    - 인증사진 (닉네임 포함 필수)
    - 음식 사진 (다양한 사진)
    - 카테고리 선택
  - 글쓰기, 글삭제, 글수정 기능
  - 에디터 (텍스트 리뷰 작성용)
  - 관리자 기능
    - 글 상단 고정
    - 글 삭제/수정
    - 관리자 수정 표시 (사용자 확인 가능)
- [x] 쯔동여지도 랭킹
  - 리뷰 수
  - 검증된 리뷰 수
  - 신뢰도 점수
  - 배지 시스템
  - 랭킹 집계 (실제 방문 후기 기반)
- [x] 월 서버 운영 비용 페이지
  - 월별 운영 비용 내역 (호스팅, API, AI 비용)
  - 비용 추세 분석 및 전월 대비 증감률
  - 누적 총액 표시
  - 관리자 비용 수정 기능
  - 비고란 (월별 특이사항 기록)
- [x] 쯔동여지도 제보 시스템 (사용자 참여형)
  - 일반 사용자 제보 기능
    - 맛집 이름, 주소, 전화번호, 카테고리 입력
    - 쯔양 유튜브 영상 링크 필수
    - 추가 설명 입력 (선택)
    - 본인 제보 내역 확인
    - 대기 중인 제보 삭제 가능
  - 관리자 제보 관리 기능
    - 모든 제보 확인 (대기/승인/거부)
    - 제보 승인 시 자동으로 레스토랑 테이블에 추가
    - 제보 거부 시 거부 사유 입력
    - 주소로 좌표 자동 검색 기능
    - 쯔양 방문횟수 설정
    - 제보 통계 (대기/승인/거부 개수)

### Phase 2: 고도화 (3-6개월)

- [ ] AI 기반 리뷰 진위 판별 (자동 사실/거짓 판별)
- [ ] 유튜브 영상 자동 분석 (실시간 맛집 정보 추출)
- [ ] 실시간 알림 시스템
- [ ] 리뷰 좋아요/댓글
- [ ] 맛집 즐겨찾기
- [ ] 서버 운영 비용 실시간 표시

### Phase 3: 확장 (6-12개월)

- [ ] 모바일 앱
- [ ] 글로벌 지도 확장 (해외 맛집 지원)
- [ ] 다른 유튜버 지도
- [ ] 파트너십 프로그램

---

## 3. 데이터 모델

### 테이블 구조

#### users (사용자)
```sql
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  username VARCHAR(50) UNIQUE NOT NULL,
  email VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  role VARCHAR(20) DEFAULT 'user', -- 'user', 'admin', 'moderator'
  created_at TIMESTAMP DEFAULT NOW(),
  last_login TIMESTAMP,
  profile_picture VARCHAR(500),
  is_verified BOOLEAN DEFAULT FALSE,
  INDEX idx_email (email),
  INDEX idx_username (username)
);
```

#### restaurants (맛집)
```sql
CREATE TABLE restaurants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(200) NOT NULL,
  address VARCHAR(500) NOT NULL,
  phone VARCHAR(20),
  category VARCHAR(50) NOT NULL, -- '치킨', '중식', '돈까스·회', '피자', '패스트푸드', '찜·탕', '족발·보쌈', '분식', '카페·디저트', '한식', '고기', '양식', '아시안', '야식', '도시락'
  youtube_link VARCHAR(500),
  description TEXT, -- 쯔양 리뷰 내용
  created_by_admin_id UUID REFERENCES users(id),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  updated_by_admin_id UUID REFERENCES users(id), -- 수정한 관리자
  lat DECIMAL(10, 8) NOT NULL,
  lng DECIMAL(11, 8) NOT NULL,
  review_count INT DEFAULT 0,
  visit_count INT DEFAULT 0, -- 사용자 방문횟수
  jjyang_visit_count INT DEFAULT 0, -- 쯔양 방문횟수
  INDEX idx_location (lat, lng),
  INDEX idx_category (category),
  INDEX idx_jjyang_visits (jjyang_visit_count DESC),
  INDEX idx_user_visits (visit_count DESC)
);
```

#### reviews (리뷰)
```sql
CREATE TABLE reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  restaurant_id UUID REFERENCES restaurants(id) ON DELETE CASCADE,
  visited_at TIMESTAMP NOT NULL, -- 방문 날짜/시간
  submitted_at TIMESTAMP DEFAULT NOW(),
  content TEXT, -- 리뷰 내용 (에디터로 작성)
  photos JSONB, -- [{"url": "...", "type": "verification|food"}]
  category VARCHAR(50), -- 음식 카테고리
  is_verified BOOLEAN DEFAULT FALSE, -- 사실/거짓 판별
  verification_method VARCHAR(50), -- 'manual', 'ai'
  admin_note TEXT,
  rating_user DECIMAL(2, 1), -- 1.0 ~ 5.0 (사용자 개인 평가)
  likes_count INT DEFAULT 0,
  is_pinned BOOLEAN DEFAULT FALSE, -- 상단 고정 여부
  is_edited_by_admin BOOLEAN DEFAULT FALSE, -- 관리자 수정 여부
  edited_by_admin_id UUID REFERENCES users(id), -- 수정한 관리자
  edited_at TIMESTAMP, -- 수정 시간
  INDEX idx_user (user_id),
  INDEX idx_restaurant (restaurant_id),
  INDEX idx_verified (is_verified),
  INDEX idx_submitted (submitted_at DESC),
  INDEX idx_pinned (is_pinned DESC, submitted_at DESC)
);
```

#### leaderboard (리더보드)
```sql
CREATE TABLE leaderboard (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE UNIQUE,
  review_count INT DEFAULT 0,
  verified_review_count INT DEFAULT 0,
  trust_score DECIMAL(5, 2) DEFAULT 0, -- 0 ~ 100
  badges JSONB, -- [{"name": "첫 리뷰", "earned_at": "..."}]
  last_updated TIMESTAMP DEFAULT NOW(),
  INDEX idx_trust_score (trust_score DESC),
  INDEX idx_review_count (review_count DESC)
);
```

#### server_costs (서버 비용)
```sql
CREATE TABLE server_costs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  year_month VARCHAR(7) NOT NULL, -- 'YYYY-MM'
  hosting_cost DECIMAL(10, 2),
  api_cost DECIMAL(10, 2),
  ai_cost DECIMAL(10, 2),
  total_cost DECIMAL(10, 2),
  notes TEXT,
  updated_by UUID REFERENCES users(id), -- 관리자만 수정/저장 가능
  updated_at TIMESTAMP DEFAULT NOW(),
  INDEX idx_year_month (year_month DESC)
);
```

### 관리자 권한 정리

#### 일반 사용자
- 맛집 리뷰 작성/수정/삭제 (본인 글만)
- 리더보드 확인
- 필터링 및 검색

#### 관리자 (role='admin')
- **맛집 관리**
  - 맛집 등록/수정/삭제
  - 맛집 정보 입력 (상호명, 주소, 전화번호, 카테고리, 유튜브 링크, 쯔양 리뷰)
- **관리자 리뷰 관리**
  - 모든 리뷰 글 상단 고정
  - 모든 리뷰 글 삭제/수정
  - 수정 시 관리자 수정 표시 (`is_edited_by_admin=true`)
  - 리뷰 진위 판별 (수동)
- **서버 비용 관리**
  - 월별 서버 운영 비용 수정/저장
  - 비용 항목별 입력 (호스팅, API, AI 비용 등)

---

## 4. API 설계

### 인증
모든 API는 JWT 토큰 기반 인증 사용
```
Authorization: Bearer {token}
```

### 주요 엔드포인트

#### 1. 맛집 조회
```http
GET /api/restaurants?bbox={south,west,north,east}&zoom={level}&filters={json}
```

**Request:**
```json
{
  "bbox": "37.4,126.8,37.6,127.0",
  "zoom": 12,
  "filters": {
    "category": ["치킨", "중식", "한식"],
    "minReviews": 10,
    "minJjyangVisits": 0,
    "minUserVisits": 0
  }
}
```

**Response:**
```json
{
  "restaurants": [
    {
      "id": "uuid",
      "name": "홍대 떡볶이",
      "lat": 37.5563,
      "lng": 126.9236,
      "category": "분식",
      "review_count": 128
    }
  ]
}
```

#### 2. 맛집 등록 (관리자)
```http
POST /api/admin/restaurants
Authorization: Bearer {admin_token}
```

**Request:**
```json
{
  "name": "쯔양 떡볶이",
  "address": "서울 마포구 홍익로 123",
  "phone": "02-1234-5678",
  "category": "분식",
  "youtube_link": "https://youtube.com/watch?v=...",
  "description": "쯔양이 3인분 먹은 그 집! 진짜 맛있다고 극찬!",
  "jjyang_visit_count": 2,
  "lat": 37.5563,
  "lng": 126.9236
}
```

**Response:**
```json
{
  "success": true,
  "restaurant": {
    "id": "uuid",
    "name": "쯔양 떡볶이",
    "created_at": "2025-01-15T10:30:00Z"
  }
}
```

#### 3. 리뷰 작성
```http
POST /api/reviews
Content-Type: multipart/form-data
```

**Request:**
```
restaurant_id: uuid
visited_at: 2025-01-10T18:30:00Z
content: "정말 맛있었어요! 쯔양이 왜 이 집을..."
rating_user: 4.5
photos[]: [file1.jpg, file2.jpg]
photo_types[]: ["verification", "food"]
```

**Response:**
```json
{
  "success": true,
  "review": {
    "id": "uuid",
    "is_verified": false,
    "message": "인증사진 검토 중입니다"
  }
}
```

#### 4. 로그인
```http
POST /api/auth/login
```

**Request:**
```json
{
  "email": "user@example.com",
  "password": "password123"
}
```

**Response:**
```json
{
  "success": true,
  "token": "eyJhbGciOiJIUzI1NiIs...",
  "user": {
    "id": "uuid",
    "username": "쯔양팬123",
    "role": "user"
  }
}
```

#### 5. 회원가입
```http
POST /api/auth/register
```

**Request:**
```json
{
  "userId": "jjyang_fan_123",
  "username": "쯔양팬123",
  "email": "user@example.com",
  "password": "password123",
  "passwordConfirm": "password123",
  "captcha_token": "..."
}
```

**Response:**
```json
{
  "success": true,
  "message": "회원가입이 완료되었습니다",
  "user": {
    "id": "uuid",
    "userId": "jjyang_fan_123",
    "username": "쯔양팬123"
  }
}
```

---

## 5. 보안·인증·권한

### 인증 방식
- **JWT 토큰** 기반 (HS256 알고리즘)
- Access Token: 1시간 유효
- Refresh Token: 7일 유효
- 비밀번호: bcrypt (rounds=10)

### 보안 체크리스트

#### ✅ 인증/인가
- [ ] JWT 시크릿 환경변수 관리
- [ ] 토큰 만료 처리
- [ ] Role-based access control (user/admin)
  - user: 리뷰 작성/수정/삭제 (본인 것만)
  - admin: 맛집 관리, 모든 리뷰 관리, 서버 비용 관리
- [ ] 리프레시 토큰 로테이션
- [ ] 회원가입 시 캡챠 인증

#### ✅ 입력 검증
- [ ] SQL Injection 방어 (Prepared Statements)
- [ ] XSS 방어 (입력 sanitization)
- [ ] CSRF 토큰
- [ ] Rate limiting (로그인: 5회/10분, API: 100회/분)
- [ ] 파일 업로드 검증
  - 이미지 타입만 허용 (JPEG, PNG, WebP)
  - 최대 크기 5MB
  - 파일명 sanitization

#### ✅ 데이터 보호
- [ ] HTTPS 강제
- [ ] 민감 정보 암호화 (email, phone)
- [ ] 비밀번호 정책 (최소 8자, 영문+숫자+특수문자)
- [ ] 개인정보 처리방침 동의

#### ✅ OWASP Top 10
- [x] A01: Broken Access Control → RBAC 구현
- [x] A02: Cryptographic Failures → bcrypt, HTTPS
- [x] A03: Injection → Prepared statements
- [x] A04: Insecure Design → 보안 설계 검토
- [x] A05: Security Misconfiguration → 환경변수 관리
- [x] A06: Vulnerable Components → 의존성 업데이트
- [x] A07: Authentication Failures → JWT + 2FA 준비
- [x] A08: Software/Data Integrity → 파일 무결성 검증
- [x] A09: Security Logging → 로그 모니터링
- [x] A10: SSRF → URL 검증

---

## 6. 성능·운영

### 성능 목표 (한국 사용자 기준)
- **TTFB**: < 200ms
- **LCP**: < 1.5s
- **FID**: < 100ms
- **CLS**: < 0.1

### 최적화 전략

#### 1. 캐싱 전략
- **CDN**: 정적 파일 (CloudFlare)
- **Redis**: 
  - 맛집 목록 (TTL: 5분)
  - 리더보드 (TTL: 10분)
  - 사용자 세션 (TTL: 1시간)
- **브라우저 캐시**: 
  - 이미지: 1개월
  - JS/CSS: 1주일 (버전닝)

#### 2. DB 인덱싱
```sql
-- 필수 인덱스
CREATE INDEX idx_restaurants_location ON restaurants USING GIST(ll_to_earth(lat, lng));
CREATE INDEX idx_reviews_restaurant_verified ON reviews(restaurant_id, is_verified);
CREATE INDEX idx_leaderboard_score ON leaderboard(trust_score DESC, review_count DESC);
```

#### 3. 이미지 최적화
- WebP 포맷 사용
- Lazy loading
- Thumbnail 생성 (150x150, 300x300, 600x600)
- CDN 배포

### 모니터링

#### 1. 에러 추적
- **Sentry**: 프론트엔드/백엔드 에러
- **Slack 알림**: 치명적 에러 발생 시

#### 2. 메트릭
- **Prometheus + Grafana**:
  - API 응답 시간
  - DB 쿼리 시간
  - 사용자 활동 (DAU, MAU)
  - 리뷰 등록/검증 비율

#### 3. 로그
```
[2025-01-15 10:30:00] INFO user_id=uuid action=review_submit restaurant_id=uuid
[2025-01-15 10:30:05] WARN user_id=uuid action=login_failed reason=invalid_password
[2025-01-15 10:30:10] ERROR user_id=uuid action=file_upload error=size_exceeded
```

---

## 7. UI/UX 세부 사항

### 메인 화면 레이아웃

```
┌──────────┬──────────────────────────────────────────────┐
│          │ [☰]              [👤] [🌙] [🔔] [⛶] [로그인] │ ← Header
│ 🔥쯔동여지도├──────────────────────────────────────┬───────┤
│──────────│                                      │       │
│  홈 🏠   │                                      │ 맛집   │
│  필터 🔍  │           Google Map                 │ 상세   │
│  리더보드 │                                      │       │
│  리뷰 ✍️  │        🔥 🔥 ⭐                     │ ━━━  │
│  서버비 💰│      ⭐                          │ 사진   │
│          │                                      │ ━━━  │
│          │   🔥 ⭐ ⭐                           │ 정보   │
│          │                                      │ ━━━  │
│  © 2025  │                                      │ 리뷰   │
└──────────┴──────────────────────────────────────┴───────┘
  Sidebar (264px)     Map (flex-1)              Panel (320px)
  (전체 높이)
```

### 필터 테이블 (행렬 구조)

| 컬럼            | 정렬 | 필터                                                                                                                            |
| --------------- | ---- | ------------------------------------------------------------------------------------------------------------------------------- |
| 맛집명          | ▲▼   | 검색                                                                                                                            |
| 카테고리        | ▲▼   | 다중선택 (치킨, 중식, 돈까스·회, 피자, 패스트푸드, 찜·탕, 족발·보쌈, 분식, 카페·디저트, 한식, 고기, 양식, 아시안, 야식, 도시락) |
| 쯔양 방문횟수   | ▲▼   | 범위 (쯔양이 여러번 다녀온 맛집)                                                                                                |
| 사용자 방문횟수 | ▲▼   | 범위 (사용자들이 여러번 다녀온 맛집)                                                                                            |
| 리뷰수          | ▲▼   | 범위 (리뷰가 많은 맛집)                                                                                                         |

### 리뷰 작성 모달

```
┌─────────────────────────────────────┐
│  리뷰 작성하기                        │
│                                     │
│  맛집: 홍대 떡볶이 🔥                 │
│  ────────────────────────────────  │
│  방문 날짜 *                         │
│  [📅 2025-01-10] [🕐 18:30]        │
│                                     │
│  카테고리 *                          │
│  (•) 분식 ( ) 치킨 ( ) 중식 ...    │
│  (치킨, 중식, 돈까스·회, 피자,       │
│   패스트푸드, 찜·탕, 족발·보쌈,      │
│   분식, 카페·디저트, 한식, 고기,     │
│   양식, 아시안, 야식, 도시락)        │
│                                     │
│  인증사진 * (닉네임 포함 필수)        │
│  [📷 업로드] verification.jpg       │
│                                     │
│  음식 사진 * (다양한 사진)            │
│  [📷 업로드] [📷 업로드] [📷 업로드] │
│                                     │
│  리뷰 (에디터 사용)                   │
│  ┌───────────────────────────────┐ │
│  │ 정말 맛있었어요!               │ │
│  │ 쯔양이 먹던 그 메뉴 주문했는데  │ │
│  │ 양도 많고 맛도 좋았습니다!      │ │
│  └───────────────────────────────┘ │
│                                     │
│  [취소]            [등록하기 →]     │
└─────────────────────────────────────┘
```

### 리뷰 게시판 (맛집 리뷰 페이지)

```
┌──────────────────────────────────────────────────────┐
│  맛집 리뷰                            [글쓰기 +]       │
├──────────────────────────────────────────────────────┤
│                                                      │
│  📌 [관리자] 리뷰 작성 가이드            (상단 고정)   │
│     인증사진 필수! 닉네임 포함해주세요...             │
│     작성자: 관리자 | 2025-01-10                      │
│     ⚠️ 관리자가 수정함                                │
│                                                      │
│  ──────────────────────────────────────────────      │
│                                                      │
│  🔥 홍대 떡볶이 진짜 맛있어요!                         │
│     [인증사진] [음식사진1] [음식사진2]                │
│     분식 | 방문: 2025-01-10 18:30                    │
│     작성자: 쯔양팬123 | ✅ 인증완료                    │
│     내용: 쯔양이 추천한 그 메뉴 먹었는데...           │
│     [수정] [삭제]                                    │
│                                                      │
│  ──────────────────────────────────────────────      │
│                                                      │
│  ⭐ 강남 파스타집 후기                                 │
│     [인증사진] [음식사진1] [음식사진2] [음식사진3]    │
│     양식 | 방문: 2025-01-09 12:00                    │
│     작성자: 맛집러버 | ⏳ 검토중                       │
│     내용: 맛은 괜찮은데 가격이 좀...                  │
│     [수정] [삭제]                                    │
│                                                      │
│  [1] [2] [3] ... [10] →                             │
└──────────────────────────────────────────────────────┘
```

**게시판 기능:**
- 글쓰기: 리뷰 작성 모달 열기
- 글삭제: 본인 글만 삭제 가능 (관리자는 모든 글 삭제 가능)
- 글수정: 본인 글만 수정 가능 (관리자는 모든 글 수정 가능)
- 상단 고정: 관리자만 가능
- 관리자 수정 표시: 관리자가 수정한 글은 "⚠️ 관리자가 수정함" 표시

---

## 8. AI 연동 (중기)

### 1. 유튜브 영상 자동 분석

**파이프라인:**
```
YouTube 영상 → 자막 추출 → NER (맛집명, 위치) → 검증 → 관리자 승인 → DB 등록
```

**기술 스택:**
- YouTube Data API v3
- Google Cloud Speech-to-Text
- NER 모델: KoBERT + CRF
- Geocoding: Google Maps Geocoding API

**예시 워크플로우:**
```python
def analyze_youtube_video(video_id):
    # 1. 자막 추출
    captions = youtube.get_captions(video_id)
    
    # 2. 엔티티 추출
    entities = ner_model.extract(captions)
    # entities = [
    #   {"type": "restaurant", "name": "홍대 떡볶이", "confidence": 0.92},
    #   {"type": "location", "name": "서울 마포구", "confidence": 0.88}
    # ]
    
    # 3. 위치 검증
    for entity in entities:
        if entity['type'] == 'restaurant':
            places = geocoding_api.search(entity['name'], entity['location'])
            if places:
                # 관리자 승인 대기열에 추가
                admin_queue.add({
                    "restaurant": entity,
                    "place": places[0],
                    "video_id": video_id,
                    "confidence": entity['confidence']
                })
```

### 2. 리뷰 진위 판별 AI (사실/거짓 판별)

**Phase 1: 관리자 수동 검증**
- 관리자가 인증사진 확인
- 닉네임 포함 여부 확인
- 방문 날짜/시간 확인
- 음식 사진 품질 확인
- 수동으로 is_verified 업데이트

**Phase 2: AI 자동 검증 (향후)**

**검증 요소:**
1. **사진 메타데이터 매칭**
   - GPS 좌표 vs 맛집 위치 (오차 500m 이내)
   - 촬영 시간 vs 방문 시간 (오차 ±2시간)

2. **닉네임 인증**
   - OCR로 사진 속 닉네임 추출
   - 사용자 닉네임과 일치 여부

3. **텍스트 신뢰도**
   - 스팸 패턴 감지
   - 과도한 이모지/광고성 키워드
   - 리뷰 길이/품질 분석
   - 쯔양 유튜브 내용과 일치성 분석

**모델:**
```python
class ReviewVerifier:
    def verify(self, review, photos):
        scores = []
        
        # 1. 사진 검증
        if photos['verification']:
            metadata = extract_metadata(photos['verification'])
            location_score = check_gps_match(metadata['gps'], review.restaurant.location)
            time_score = check_time_match(metadata['datetime'], review.visited_at)
            nickname_score = ocr_check_nickname(photos['verification'], review.user.username)
            scores.extend([location_score, time_score, nickname_score])
        
        # 2. 텍스트 검증
        text_score = text_classifier.predict(review.content)
        scores.append(text_score)
        
        # 최종 점수 (0-100)
        final_score = sum(scores) / len(scores) * 100
        
        return {
            'is_verified': final_score >= 70,
            'confidence': final_score,
            'method': 'ai'
        }
```

---

## 9. QA·수용 기준

### 기능 테스트

#### ✅ 인증
- [ ] 회원가입 시 캡챠 동작
- [ ] 이메일 중복 체크
- [ ] 비밀번호 암호화 저장
- [ ] 로그인 성공/실패 처리
- [ ] JWT 토큰 발급/검증
- [ ] 로그아웃 시 토큰 무효화

#### ✅ 맛집 관리
- [ ] 관리자만 맛집 등록 가능
- [ ] 등록 시 지도에 즉시 반영
- [ ] 마커 클릭 시 상세 패널 표시

#### ✅ 리뷰 (게시판)
- [ ] 인증사진 미업로드 시 등록 차단
- [ ] 닉네임 미포함 시 등록 차단
- [ ] 방문 시간 미입력 시 등록 차단
- [ ] 음식 사진 미업로드 시 등록 차단
- [ ] 사진 크기 제한 (5MB) 동작
- [ ] 리뷰 등록 후 review_count 증가
- [ ] 관리자 승인 후 is_verified 업데이트
- [ ] 글쓰기/글삭제/글수정 기능 동작
- [ ] 에디터 정상 동작
- [ ] 관리자 상단 고정 기능
- [ ] 관리자 모든 글 삭제/수정 가능
- [ ] 관리자 수정 시 "관리자가 수정함" 표시
- [ ] 본인 글만 수정/삭제 가능 (일반 사용자)

#### ✅ 필터링 (행렬 테이블)
- [ ] 카테고리 필터 적용 (15개 카테고리)
- [ ] 쯔양 방문횟수 필터
- [ ] 사용자 방문횟수 필터
- [ ] 리뷰수 범위 필터
- [ ] 여러 필터 동시 적용
- [ ] 테이블 정렬 기능 (각 컬럼별)
- [ ] 검색 기능 (맛집명)

#### ✅ 성능 (세계 최고 수준)
- [ ] 맵 로딩 시간 < 2초
- [ ] API 응답 시간 < 300ms (최적: < 200ms)
- [ ] TTFB < 200ms
- [ ] LCP < 1.5s
- [ ] FID < 100ms
- [ ] CLS < 0.1
- [ ] 이미지 lazy loading 동작
- [ ] 1000개 마커 표시 시 프레임 드롭 없음
- [ ] 모바일 최적화 (반응형)

### 보안 테스트 (보안약점/취약점 제거)

- [ ] SQL Injection 공격 방어
- [ ] XSS 공격 방어
- [ ] CSRF 토큰 검증
- [ ] Rate limiting 동작
- [ ] 권한 없는 API 접근 차단 (RBAC)
- [ ] 관리자 권한 확인 (맛집 등록/수정/삭제)
- [ ] 파일 업로드 취약점 테스트
- [ ] 세션 하이재킹 방어
- [ ] OWASP Top 10 대응
- [ ] 캡챠 인증 동작 (회원가입)
- [ ] 비밀번호 암호화 (bcrypt)

---

## 10. 배포 로드맵

### Phase 1: MVP (1-2개월)

**목표**: 한국 내 쯔양 맛집 100개 등록, 1000명 사용자

#### 주요 기능
- ✅ 구글맵 기본 UI
- ✅ 관리자 수동 맛집 입력
- ✅ 사용자 회원가입/로그인
- ✅ 리뷰 작성 (수동 검증)
- ✅ 기본 필터링

#### 배포 환경
- **Frontend**: Vercel
- **Backend**: AWS EC2 (t3.medium)
- **Database**: AWS RDS PostgreSQL (db.t3.micro)
- **Storage**: AWS S3
- **CDN**: CloudFlare

#### 체크리스트
- [ ] HTTPS 설정
- [ ] 도메인 연결 (jjdong-map.com)
- [ ] 환경변수 설정
- [ ] DB 마이그레이션
- [ ] 초기 데이터 시드
- [ ] 모니터링 설정 (Sentry)
- [ ] 백업 설정 (일 1회)

---

### Phase 2: 고도화 (3-6개월)

**목표**: 맛집 500개, 사용자 10,000명, AI 자동화 PoC

#### 추가 기능
- AI 리뷰 진위 판별 (베타)
- 유튜브 영상 분석 파이프라인
- 리더보드 고도화
- 알림 시스템
- 모바일 최적화

#### 인프라 업그레이드
- **Backend**: AWS ECS (Auto Scaling)
- **Database**: RDS PostgreSQL (db.t3.small)
- **Cache**: Redis (ElastiCache)
- **AI**: AWS Lambda (Python)

---

### Phase 3: 확장 (6-12개월)

**목표**: 글로벌 확장, 다른 유튜버 지도

#### 추가 기능
- 다국어 지원 (영어, 일본어)
- 모바일 앱 (React Native)
- 파트너십 프로그램
- 프리미엄 기능 (광고 제거 등)

#### 비즈니스 모델
- 광고 수익
- 프리미엄 구독 (월 ₩3,900)
- 맛집 파트너십

---

## 11. 산출물

### 문서
- ✅ 제품 명세서 (이 문서)
- [ ] API 문서 (Swagger/OpenAPI)
- [ ] 사용자 가이드
- [ ] 관리자 매뉴얼

### 코드
- ✅ 프론트엔드 (React + TypeScript)
- [ ] 백엔드 (Node.js + Express)
- [ ] DB 스키마 (PostgreSQL)
- [ ] AI 모델 (Python)

### 디자인
- ✅ 와이어프레임
- [ ] UI 디자인 (Figma)
- [ ] 브랜드 가이드

---

## ERD (텍스트)

```
users (1) ──────< (N) reviews (N) >────── (1) restaurants
  │                                              
  │                                              
  └─> (1:1) leaderboard                         
                                                 
server_costs (N) >────── (1) users (admin)
```

---

## 예시 요청/응답

### 맛집 목록 조회
```bash
curl -X GET "https://api.jjdong-map.com/api/restaurants?bbox=37.4,126.8,37.6,127.0&zoom=10" \
  -H "Authorization: Bearer eyJhbGc..."
```

**Response:**
```json
{
  "data": [
    {
      "id": "uuid",
      "name": "홍대 떡볶이",
      "lat": 37.5563,
      "lng": 126.9236,
      "category": "분식",
      "review_count": 128,
      "categories": ["한식", "중식", "분식", "치킨"]
    }
  ]
}
```

---

## 추가 기술 요구사항

### 카테고리 시스템
**전체 15개 카테고리:**
1. 치킨
2. 중식
3. 돈까스·회
4. 피자
5. 패스트푸드
6. 찜·탕
7. 족발·보쌈
8. 분식
9. 카페·디저트
10. 한식
11. 고기
12. 양식
13. 아시안
14. 야식
15. 도시락

### 필수 초기 설정
- 사이드바: 기본 "보임" 상태로 설정
- 로그인: 아이디(userId), 비밀번호 입력
- 회원가입: 아이디, 비밀번호, 비밀번호 확인, 이메일, 닉네임, 캡챠 인증

### 접근 권한 체계
**비로그인 사용자:**
- 지도 조회만 가능
- 필터링, 리뷰 작성, 맛집 제보 불가

**로그인 사용자 (role='user'):**
- 지도 조회
- 필터링 페이지 접근
- 맛집 리뷰 작성/수정/삭제 (본인 글만)
- 리더보드 확인
- 쯔동여지도 제보 (유튜브 링크 포함)
- 본인 제보 내역 확인 및 대기 중인 제보 삭제

**관리자 (role='admin'):**
- 모든 사용자 기능
- 맛집 등록/수정/삭제
- 모든 리뷰 관리 (상단 고정, 삭제, 수정)
- 맛집 제보 관리 (승인/거부, 통계 확인)
- 서버 운영 비용 관리

---

## 보안 체크리스트 (배포 전)

- [ ] 모든 API 엔드포인트 인증 확인
- [ ] SQL Injection 테스트 완료
- [ ] XSS 테스트 완료
- [ ] CSRF 토큰 적용
- [ ] Rate limiting 설정
- [ ] HTTPS 강제 리다이렉트
- [ ] 민감 정보 환경변수 관리
- [ ] DB 백업 자동화
- [ ] 에러 로그 민감 정보 제거
- [ ] 파일 업로드 검증
- [ ] 의존성 취약점 스캔 (npm audit)
- [ ] 보안 헤더 설정 (HSTS, CSP)

---

## 배포 체크리스트

- [ ] 프로덕션 환경변수 설정
- [ ] DB 마이그레이션 실행
- [ ] 정적 파일 CDN 배포
- [ ] DNS 설정
- [ ] SSL 인증서 설치
- [ ] 모니터링 대시보드 설정
- [ ] 알림 채널 설정 (Slack)
- [ ] 로드 테스트 (k6)
- [ ] SEO 메타 태그 확인
- [ ] 사이트맵 생성
- [ ] robots.txt 설정
- [ ] Google Analytics 연동

---

**문서 버전**: 2.3  
**최종 수정**: 2025-12-11  
**작성자**: 제품팀

## 주요 변경 이력

### v2.2 (2025-10-21)
- ✅ **쯔동여지도 제보 시스템 개발 완료**
  - 일반 사용자용 제보 페이지 (RestaurantSubmissionsPage.tsx)
    - 맛집 정보 및 유튜브 링크 제출
    - 본인 제보 내역 확인 (대기/승인/거부 상태)
    - 대기 중인 제보 삭제 기능
  - 관리자용 제보 관리 페이지 (AdminSubmissionsPage.tsx)
    - 모든 제보 확인 및 상태별 분류 (탭 구조)
    - 제보 승인 시 레스토랑 테이블에 자동 추가
    - 제보 거부 시 거부 사유 입력
    - 주소로 좌표 자동 검색 기능
    - 제보 통계 대시보드 (대기/승인/거부 개수)
  - Supabase `restaurant_submissions` 테이블 생성
    - RLS 정책 적용 (사용자는 본인 제보만, 관리자는 모두 접근)
    - 제보 상태 관리 (pending/approved/rejected)
- ✅ **관리자 맛집 수정/삭제 기능 확인**
  - AdminRestaurantModal에 이미 구현됨

### v2.1 (2025-10-21)
- ✅ **쯔동여지도 리뷰 게시판 페이지 개발 완료** (ReviewsPage.tsx)
  - 리뷰 목록 표시 (게시판 형태)
  - 카테고리, 검색, 인증 상태별 필터링
  - 리뷰 정렬 (고정글 우선, 최신순)
- ✅ **리뷰 작성 모달 개발 완료** (ReviewModal.tsx)
  - 방문 날짜/시간 입력
  - 인증사진 업로드 (닉네임 포함 필수)
  - 음식 사진 다중 업로드
  - 카테고리 선택 (15개)
  - 텍스트 에디터
  - 필수 항목 검증
- ✅ **쯔동여지도 랭킹 페이지 개발 완료** (LeaderboardPage.tsx)
  - TOP 3 사용자 강조 표시
  - 리뷰 수, 검증된 리뷰 수, 신뢰도 점수 표시
  - 배지 시스템
  - 정렬 기능 (리뷰 수/신뢰도)
- ✅ **월 서버 운영 비용 페이지 개발 완료** (ServerCostsPage.tsx)
  - 월별 비용 내역 (호스팅, API, AI)
  - 전월 대비 증감률 표시
  - 누적 총액 표시
  - 관리자 비용 수정 기능
- ✅ **맛집 상세 패널 최근 리뷰 표시 기능 추가**
  - 최근 리뷰 2개 미리보기
  - 인증 뱃지, 별점, 작성 시간 표시
- ✅ **관리자 리뷰 관리 기능 구현**
  - 리뷰 상단 고정/고정 해제
  - 리뷰 수정/삭제
  - 관리자 수정 표시 뱃지

### v2.0 (2025-10-21)
- 카테고리 체계 변경 (7개 → 15개)
- 필터링 시스템 상세화 (행렬 테이블 구조)
- 리뷰 게시판 기능 추가 (글쓰기, 글삭제, 글수정, 에디터)
- 관리자 권한 상세화 (상단 고정, 관리자 수정 표시)
- 사이드바 기본 상태 명시 (보임)
- **레이아웃 변경: 사이드바가 화면 전체 높이 차지 (헤더 영역 포함)**
- **로고 위치 변경: 헤더 → 사이드바 상단**
- 회원가입 필드 명확화 (아이디, 비밀번호, 비밀번호 확인, 이메일, 닉네임)
- 성능 요구사항 명시 (세계 최고 수준)
- 보안 요구사항 강화 (보안약점/취약점 제거)
- 접근 권한 체계 정리 (비로그인/사용자/관리자)
- AI 기반 맛집 점수 시스템 상세화 (1-10개 별점)
- 쯔양/사용자 방문횟수 분리

### v1.0 (2025-01-15)
- 초기 문서 작성
