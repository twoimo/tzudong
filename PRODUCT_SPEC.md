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
- AI 기반 별점과 신뢰도 시스템
- 투명한 커뮤니티 운영 (서버 비용 공개)

---

## 2. 기능 목록 (우선순위)

### Phase 1: MVP (1-2개월)

#### ✅ 필수 기능
- [x] 구글맵 기반 메인 화면
- [x] 맛집 마커 표시 (🔥 별점 ≥4, ⭐ 그 외)
- [x] 줌 레벨별 클러스터링
- [x] 상단 헤더
  - 사이드바 토글
  - 사용자 메뉴
  - 다크모드 전환
  - 알림
  - 전체화면
  - 로그인/로그아웃
- [x] 좌측 사이드바
  - 로고
  - 홈
  - 필터링
  - 리더보드
  - 리뷰 작성
  - 월 서버비용
- [x] 로그인/회원가입 모달
- [ ] 맛집 상세 정보 패널
- [ ] 관리자 맛집 등록/수정/삭제

#### 🎯 중요 기능
- [ ] 필터링 시스템
  - 방문횟수
  - 리뷰 수
  - 카테고리 (한식, 중식, 일식, 양식, 분식, 디저트, 기타)
  - AI 점수 (1-10)
- [ ] 리뷰 작성
  - 방문 날짜/시간
  - 인증사진 (닉네임 포함 필수)
  - 음식 사진
  - 카테고리 선택
  - 텍스트 리뷰
- [ ] 사용자 리더보드
  - 리뷰 수
  - 신뢰도 점수
  - 배지 시스템

### Phase 2: 고도화 (3-6개월)

- [ ] AI 기반 리뷰 진위 판별
- [ ] 유튜브 영상 자동 분석
- [ ] 실시간 알림 시스템
- [ ] 리뷰 좋아요/댓글
- [ ] 맛집 즐겨찾기

### Phase 3: 확장 (6-12개월)

- [ ] 모바일 앱
- [ ] 글로벌 지도 확장
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
  category VARCHAR(50) NOT NULL, -- '한식', '중식', '일식', '양식', '분식', '디저트', '기타'
  youtube_link VARCHAR(500),
  description TEXT,
  created_by_admin_id UUID REFERENCES users(id),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  lat DECIMAL(10, 8) NOT NULL,
  lng DECIMAL(11, 8) NOT NULL,
  rating_ai DECIMAL(3, 1), -- 1.0 ~ 10.0
  review_count INT DEFAULT 0,
  visit_count INT DEFAULT 0,
  cluster_id VARCHAR(50), -- 클러스터링용
  INDEX idx_location (lat, lng),
  INDEX idx_rating (rating_ai),
  INDEX idx_category (category)
);
```

#### reviews (리뷰)
```sql
CREATE TABLE reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  restaurant_id UUID REFERENCES restaurants(id) ON DELETE CASCADE,
  visited_at TIMESTAMP NOT NULL,
  submitted_at TIMESTAMP DEFAULT NOW(),
  content TEXT,
  photos JSONB, -- [{"url": "...", "type": "verification|food"}]
  is_verified BOOLEAN DEFAULT FALSE,
  verification_method VARCHAR(50), -- 'manual', 'ai'
  admin_note TEXT,
  rating_user DECIMAL(2, 1), -- 1.0 ~ 5.0 (사용자 개인 평가)
  likes_count INT DEFAULT 0,
  INDEX idx_user (user_id),
  INDEX idx_restaurant (restaurant_id),
  INDEX idx_verified (is_verified),
  INDEX idx_submitted (submitted_at DESC)
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
  updated_by UUID REFERENCES users(id),
  updated_at TIMESTAMP DEFAULT NOW(),
  INDEX idx_year_month (year_month DESC)
);
```

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
    "category": ["한식", "중식"],
    "minRating": 4.0,
    "minReviews": 10
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
      "rating_ai": 4.5,
      "review_count": 128,
      "marker_type": "fire" // "fire" or "star"
    }
  ],
  "clusters": [
    {
      "lat": 37.5,
      "lng": 127.0,
      "count": 15,
      "avg_rating": 4.2
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
  "description": "쯔양이 3인분 먹은 그 집!",
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
  "username": "쯔양팬123",
  "email": "user@example.com",
  "password": "password123",
  "captcha_token": "..."
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
- [ ] Role-based access control (user/admin/moderator)
- [ ] 리프레시 토큰 로테이션

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

#### 1. 맵 클러스터링
```javascript
// 서버 측 클러스터링 (zoom level < 10)
function clusterRestaurants(restaurants, zoomLevel) {
  const precision = 10 - zoomLevel; // Geohash precision
  const clusters = new Map();
  
  restaurants.forEach(r => {
    const hash = geohash.encode(r.lat, r.lng, precision);
    if (!clusters.has(hash)) {
      clusters.set(hash, { count: 0, avgRating: 0, restaurants: [] });
    }
    const cluster = clusters.get(hash);
    cluster.count++;
    cluster.restaurants.push(r);
  });
  
  return Array.from(clusters.values());
}
```

#### 2. 캐싱 전략
- **CDN**: 정적 파일 (CloudFlare)
- **Redis**: 
  - 맛집 목록 (TTL: 5분)
  - 리더보드 (TTL: 10분)
  - 사용자 세션 (TTL: 1시간)
- **브라우저 캐시**: 
  - 이미지: 1개월
  - JS/CSS: 1주일 (버전닝)

#### 3. DB 인덱싱
```sql
-- 필수 인덱스
CREATE INDEX idx_restaurants_location ON restaurants USING GIST(ll_to_earth(lat, lng));
CREATE INDEX idx_reviews_restaurant_verified ON reviews(restaurant_id, is_verified);
CREATE INDEX idx_leaderboard_score ON leaderboard(trust_score DESC, review_count DESC);
```

#### 4. 이미지 최적화
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
┌─────────────────────────────────────────────────────────┐
│ [☰] 쯔동여지도 🔥               [👤] [🌙] [🔔] [⛶] [로그인] │ ← Header
├──────────┬──────────────────────────────────────┬───────┤
│          │                                      │       │
│  [로고]   │                                      │ 맛집   │
│  홈 🏠   │           Google Map                 │ 상세   │
│  필터 🔍  │                                      │       │
│  리더보드 │        🔥 🔥 ⭐                     │ ━━━  │
│  리뷰 ✍️  │      ⭐   (클러스터 15)              │ 사진   │
│  서버비 💰│                                      │ ━━━  │
│          │   🔥 ⭐ ⭐                           │ 정보   │
│          │                                      │ ━━━  │
│  © 2025  │                                      │ 리뷰   │
└──────────┴──────────────────────────────────────┴───────┘
  Sidebar (264px)     Map (flex-1)              Panel (320px)
```

### 필터 테이블

| 컬럼 | 정렬 | 필터 |
|------|------|------|
| 맛집명 | ▲▼ | 검색 |
| 카테고리 | ▲▼ | 다중선택 |
| 방문횟수 | ▲▼ | 범위 |
| 리뷰수 | ▲▼ | 범위 |
| AI 점수 | ▲▼ | 슬라이더 (1-10) |

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
│  (•) 분식 ( ) 한식 ( ) 중식 ...    │
│                                     │
│  인증사진 * (닉네임 포함 필수)        │
│  [📷 업로드] verification.jpg       │
│                                     │
│  음식 사진                           │
│  [📷 업로드] [📷 업로드]             │
│                                     │
│  리뷰                                │
│  ┌───────────────────────────────┐ │
│  │ 정말 맛있었어요!               │ │
│  └───────────────────────────────┘ │
│                                     │
│  [취소]            [등록하기 →]     │
└─────────────────────────────────────┘
```

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

### 2. 리뷰 진위 판별 AI

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
- [ ] 줌 레벨별 클러스터링 동작
- [ ] 별점 ≥4인 경우 🔥 마커 표시

#### ✅ 리뷰
- [ ] 인증사진 미업로드 시 등록 차단
- [ ] 방문 시간 미입력 시 등록 차단
- [ ] 사진 크기 제한 (5MB) 동작
- [ ] 리뷰 등록 후 review_count 증가
- [ ] 관리자 승인 후 is_verified 업데이트

#### ✅ 필터링
- [ ] 카테고리 필터 적용
- [ ] AI 점수 슬라이더 동작 (1-10)
- [ ] 방문횟수/리뷰수 범위 필터
- [ ] 여러 필터 동시 적용

#### ✅ 성능
- [ ] 맵 로딩 시간 < 2초
- [ ] API 응답 시간 < 300ms
- [ ] 이미지 lazy loading 동작
- [ ] 1000개 마커 표시 시 프레임 드롭 없음

### 보안 테스트

- [ ] SQL Injection 공격 방어
- [ ] XSS 공격 방어
- [ ] CSRF 토큰 검증
- [ ] Rate limiting 동작
- [ ] 권한 없는 API 접근 차단
- [ ] 파일 업로드 취약점 테스트

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
  │                                              │
  │                                              │
  └─> (1:1) leaderboard                         │
                                                 │
server_costs (N) >────── (1) users (admin)      │
                                                 │
                              cluster_id ────────┘
```

---

## 예시 요청/응답

### 맛집 목록 조회 (클러스터링)
```bash
curl -X GET "https://api.jjdong-map.com/api/restaurants?bbox=37.4,126.8,37.6,127.0&zoom=10" \
  -H "Authorization: Bearer eyJhbGc..."
```

**Response:**
```json
{
  "type": "cluster",
  "data": [
    {
      "lat": 37.5,
      "lng": 127.0,
      "count": 15,
      "avg_rating": 4.2,
      "categories": ["한식", "중식", "분식"]
    }
  ]
}
```

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

**문서 버전**: 1.0  
**최종 수정**: 2025-01-15  
**작성자**: 제품팀
