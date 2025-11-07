# 🔍 데이터베이스 구조 검증 가이드

## 📋 목차
1. [테이블 구조 검증](#테이블-구조-검증)
2. [네이밍 규칙 검증](#네이밍-규칙-검증)
3. [제약조건 검증](#제약조건-검증)
4. [인덱스 검증](#인덱스-검증)
5. [성능 테스트](#성능-테스트)

---

## 🗂️ 테이블 구조 검증

### 1. user_roles (사용자 역할)
```sql
-- ✅ 올바른 구조
- id: UUID (PK)
- user_id: UUID (FK → auth.users, UNIQUE)
- role: app_role (ENUM: 'admin', 'user')
- created_at: TIMESTAMPTZ

-- 🔍 검증 쿼리
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_name = 'user_roles'
ORDER BY ordinal_position;
```

### 2. profiles (사용자 프로필)
```sql
-- ✅ 올바른 구조
- id: UUID (PK)
- user_id: UUID (FK → auth.users, UNIQUE, ON DELETE CASCADE)
- nickname: TEXT (UNIQUE, 2-20자)
- email: TEXT (이메일 형식 검증)
- profile_picture: TEXT (nullable)
- created_at: TIMESTAMPTZ (NOT NULL)
- last_login: TIMESTAMPTZ (NOT NULL)

-- 🔍 검증: 닉네임 길이 제약
SELECT * FROM profiles WHERE length(nickname) < 2 OR length(nickname) > 20;
-- 결과가 없어야 함 ✅

-- 🔍 검증: 이메일 형식
SELECT * FROM profiles WHERE email !~* '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$';
-- 결과가 없어야 함 ✅
```

### 3. restaurants (맛집 정보)
```sql
-- ✅ 올바른 구조
- id: UUID (PK)
- name: TEXT (2-100자, NOT NULL)
- phone: TEXT (형식: 02-1234-5678 또는 010-1234-5678)
- lat: NUMERIC (-90 ~ 90, NOT NULL)
- lng: NUMERIC (-180 ~ 180, NOT NULL)
- description: TEXT (nullable)
- category: TEXT[] (1-5개, NOT NULL)
- road_address: TEXT
- jibun_address: TEXT
- english_address: TEXT
- address_elements: JSONB
- youtube_links: TEXT[]
- tzuyang_reviews: JSONB
- youtube_metas: JSONB
- review_count: INTEGER (≥0, NOT NULL)
- created_by: UUID (FK → auth.users, ON DELETE SET NULL)
- created_at: TIMESTAMPTZ (NOT NULL)
- updated_at: TIMESTAMPTZ (NOT NULL)
- updated_by_admin_id: UUID (FK → auth.users, ON DELETE SET NULL)

-- 🔍 검증: 위도/경도 범위
SELECT name, lat, lng FROM restaurants 
WHERE lat < -90 OR lat > 90 OR lng < -180 OR lng > 180;
-- 결과가 없어야 함 ✅

-- 🔍 검증: 카테고리 개수
SELECT name, array_length(category, 1) as cat_count 
FROM restaurants 
WHERE array_length(category, 1) < 1 OR array_length(category, 1) > 5;
-- 결과가 없어야 함 ✅

-- 🔍 검증: 주소 필수
SELECT name FROM restaurants 
WHERE road_address IS NULL AND jibun_address IS NULL;
-- 결과가 없어야 함 ✅

-- 🔍 검증: 전화번호 형식
SELECT name, phone FROM restaurants 
WHERE phone IS NOT NULL AND phone !~ '^\d{2,3}-\d{3,4}-\d{4}$';
-- 결과가 없어야 함 ✅
```

### 4. reviews (리뷰)
```sql
-- ✅ 올바른 구조
- id: UUID (PK)
- user_id: UUID (FK → auth.users, ON DELETE CASCADE, NOT NULL)
- restaurant_id: UUID (FK → restaurants, ON DELETE CASCADE, NOT NULL)
- title: TEXT (2-200자, NOT NULL)
- content: TEXT (≥10자, NOT NULL)
- visited_at: TIMESTAMPTZ (≤ now(), NOT NULL)
- verification_photo: TEXT (NOT NULL)
- food_photos: TEXT[]
- categories: TEXT[]
- is_verified: BOOLEAN (NOT NULL)
- admin_note: TEXT
- is_pinned: BOOLEAN (NOT NULL)
- is_edited_by_admin: BOOLEAN (NOT NULL)
- edited_by_admin_id: UUID (FK → auth.users, ON DELETE SET NULL)
- edited_at: TIMESTAMPTZ
- created_at: TIMESTAMPTZ (NOT NULL)
- updated_at: TIMESTAMPTZ (NOT NULL)

-- 🔍 검증: 제목 길이
SELECT title FROM reviews WHERE length(title) < 2 OR length(title) > 200;
-- 결과가 없어야 함 ✅

-- 🔍 검증: 내용 길이
SELECT content FROM reviews WHERE length(content) < 10;
-- 결과가 없어야 함 ✅

-- 🔍 검증: 방문 일시 (미래 날짜 불가)
SELECT title, visited_at FROM reviews WHERE visited_at > now();
-- 결과가 없어야 함 ✅

-- 🔍 검증: 관리자 수정 일관성
SELECT * FROM reviews 
WHERE (is_edited_by_admin = false AND (edited_by_admin_id IS NOT NULL OR edited_at IS NOT NULL))
   OR (is_edited_by_admin = true AND (edited_by_admin_id IS NULL OR edited_at IS NULL));
-- 결과가 없어야 함 ✅
```

### 5. evaluation_records (평가 기록)
```sql
-- ✅ 올바른 구조
- id: BIGSERIAL (PK)
- unique_id: TEXT (UNIQUE, NOT NULL)
- youtube_link: TEXT (NOT NULL)
- status: TEXT (DEFAULT 'pending', NOT NULL)
- youtube_meta: JSONB
- evaluation_results: JSONB
- name: TEXT
- phone: TEXT
- category: TEXT
- reasoning_basis: TEXT
- tzuyang_review: TEXT
- origin_address: JSONB
- road_address: TEXT
- jibun_address: TEXT
- english_address: TEXT
- address_elements: JSONB
- geocoding_success: BOOLEAN (NOT NULL, DEFAULT false)
- geocoding_false_stage: INTEGER (0, 1, 2 또는 NULL)
- is_missing: BOOLEAN (NOT NULL, DEFAULT false)
- is_not_selected: BOOLEAN (NOT NULL, DEFAULT false)
- admin_notes: TEXT
- created_at: TIMESTAMPTZ (NOT NULL)
- updated_at: TIMESTAMPTZ (NOT NULL)

-- 🔍 검증: 지오코딩 단계 값
SELECT id, geocoding_false_stage FROM evaluation_records 
WHERE geocoding_false_stage NOT IN (0, 1, 2) AND geocoding_false_stage IS NOT NULL;
-- 결과가 없어야 함 ✅

-- 🔍 검증: 지오코딩 일관성
SELECT * FROM evaluation_records 
WHERE (geocoding_success = true AND geocoding_false_stage IS NOT NULL)
   OR (geocoding_success = false AND geocoding_false_stage IS NULL);
-- 결과가 없어야 함 ✅

-- 🔍 검증: 누락되지 않은 레코드의 주소
SELECT * FROM evaluation_records 
WHERE is_missing = false 
  AND road_address IS NULL 
  AND jibun_address IS NULL;
-- 결과가 없어야 함 ✅

-- 📊 통계 조회
SELECT * FROM get_evaluation_records_stats();
```

---

## 📝 네이밍 규칙 검증

### 테이블명 규칙
- ✅ 복수형 사용 (users, restaurants, reviews)
- ✅ 스네이크 케이스 (snake_case)
- ✅ 소문자만 사용
- ✅ 명확하고 직관적

```sql
-- 🔍 모든 테이블명 확인
SELECT table_name 
FROM information_schema.tables 
WHERE table_schema = 'public'
ORDER BY table_name;
```

**예상 결과:**
```
announcements
evaluation_records
notifications
profiles
restaurants
review_likes
reviews
server_costs
user_roles
user_stats
```

### 컬럼명 규칙
- ✅ 스네이크 케이스 (created_at, user_id)
- ✅ 명확한 의미
- ✅ 타입 접미사 (is_*, has_*, *_at, *_count)
- ✅ 외래 키: {테이블명}_id

```sql
-- 🔍 네이밍 규칙 위반 확인
SELECT table_name, column_name 
FROM information_schema.columns 
WHERE table_schema = 'public'
  AND column_name ~ '[A-Z]'  -- 대문자 포함
ORDER BY table_name, ordinal_position;
-- 결과가 없어야 함 ✅
```

### 인덱스명 규칙
- ✅ idx_{테이블명}_{컬럼명}
- ✅ idx_{테이블명}_{조건} (부분 인덱스)

```sql
-- 🔍 모든 인덱스명 확인
SELECT indexname 
FROM pg_indexes 
WHERE schemaname = 'public'
  AND indexname NOT LIKE '%_pkey'
ORDER BY indexname;
```

---

## 🔒 제약조건 검증

### CHECK 제약조건
```sql
-- 🔍 모든 CHECK 제약조건 확인
SELECT 
    tc.table_name,
    tc.constraint_name,
    cc.check_clause
FROM information_schema.table_constraints tc
JOIN information_schema.check_constraints cc 
    ON tc.constraint_name = cc.constraint_name
WHERE tc.table_schema = 'public'
  AND tc.constraint_type = 'CHECK'
ORDER BY tc.table_name, tc.constraint_name;
```

**주요 CHECK 제약조건:**
1. `restaurants_address_required` - 주소 필수
2. `restaurants.lat/lng` - 위도/경도 범위
3. `restaurants.category` - 카테고리 개수 (1-5)
4. `reviews_edited_consistency` - 관리자 수정 일관성
5. `evaluation_records_geocoding_stage_check` - 지오코딩 일관성
6. `user_stats_count_consistency` - 통계 일관성

### FOREIGN KEY 제약조건
```sql
-- 🔍 모든 외래 키 확인
SELECT
    tc.table_name,
    kcu.column_name,
    ccu.table_name AS foreign_table_name,
    ccu.column_name AS foreign_column_name,
    rc.delete_rule,
    rc.update_rule
FROM information_schema.table_constraints AS tc
JOIN information_schema.key_column_usage AS kcu
    ON tc.constraint_name = kcu.constraint_name
JOIN information_schema.constraint_column_usage AS ccu
    ON ccu.constraint_name = tc.constraint_name
JOIN information_schema.referential_constraints AS rc
    ON tc.constraint_name = rc.constraint_name
WHERE tc.constraint_type = 'FOREIGN KEY'
  AND tc.table_schema = 'public'
ORDER BY tc.table_name, kcu.column_name;
```

**ON DELETE 동작:**
- `CASCADE`: 부모 삭제 시 자식도 삭제 (user_id, restaurant_id, review_id)
- `SET NULL`: 부모 삭제 시 NULL로 설정 (created_by, updated_by_admin_id, edited_by_admin_id)

---

## 📊 인덱스 검증

### 인덱스 존재 확인
```sql
-- 🔍 테이블별 인덱스 개수
SELECT 
    tablename,
    COUNT(*) as index_count
FROM pg_indexes
WHERE schemaname = 'public'
GROUP BY tablename
ORDER BY index_count DESC;
```

**예상 인덱스 개수:**
- restaurants: ~15개
- reviews: ~10개
- evaluation_records: ~15개
- notifications: ~8개
- 기타: 각 3-5개

### 인덱스 사용률 확인
```sql
-- 🔍 사용되지 않는 인덱스 찾기
SELECT * FROM v_index_usage
WHERE index_scans < 10
  AND index_name NOT LIKE '%_pkey'
ORDER BY pg_relation_size(indexrelid) DESC;
```

### GIN 인덱스 확인
```sql
-- 🔍 GIN 인덱스 목록
SELECT 
    schemaname,
    tablename,
    indexname,
    indexdef
FROM pg_indexes
WHERE schemaname = 'public'
  AND indexdef LIKE '%USING gin%'
ORDER BY tablename, indexname;
```

**GIN 인덱스가 필요한 컬럼:**
- category (TEXT[])
- categories (TEXT[])
- youtube_meta (JSONB)
- evaluation_results (JSONB)
- address_elements (JSONB)
- data (JSONB)

---

## ⚡ 성능 테스트

### 1. 맛집 위치 검색 성능
```sql
-- 🔍 EXPLAIN ANALYZE로 실행 계획 확인
EXPLAIN ANALYZE
SELECT id, name, lat, lng, category
FROM restaurants
WHERE lat BETWEEN 37.5 AND 37.6
  AND lng BETWEEN 126.9 AND 127.0
  AND category && ARRAY['한식']
LIMIT 20;
```

**기대 결과:**
- Index Scan 사용
- 실행 시간: < 50ms

### 2. 리뷰 조회 성능
```sql
-- 🔍 맛집별 최신 리뷰
EXPLAIN ANALYZE
SELECT r.*, p.nickname
FROM reviews r
JOIN profiles p ON r.user_id = p.user_id
WHERE r.restaurant_id = 'xxx-xxx-xxx'
ORDER BY r.created_at DESC
LIMIT 10;
```

**기대 결과:**
- Index Scan on idx_reviews_restaurant_created
- 실행 시간: < 20ms

### 3. 리더보드 조회 성능
```sql
-- 🔍 Materialized View 사용
EXPLAIN ANALYZE
SELECT * FROM mv_user_leaderboard
ORDER BY rank
LIMIT 100;
```

**기대 결과:**
- Sequential Scan (MV는 작은 크기)
- 실행 시간: < 10ms

### 4. 유사도 검색 성능
```sql
-- 🔍 맛집 이름 유사도 검색
EXPLAIN ANALYZE
SELECT * FROM search_restaurants('떡볶이', NULL, 20);
```

**기대 결과:**
- Bitmap Index Scan (GIN)
- 실행 시간: < 100ms

### 5. 평가 기록 통계 성능
```sql
-- 🔍 통계 조회
EXPLAIN ANALYZE
SELECT * FROM get_evaluation_records_stats();
```

**기대 결과:**
- Sequential Scan (집계 함수)
- 실행 시간: < 200ms

---

## ✅ 검증 체크리스트

### 마이그레이션 후 필수 검증

#### 1단계: 테이블 구조
- [ ] 모든 테이블 생성 확인
  ```sql
  SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = 'public';
  -- 결과: 10개 이상
  ```

- [ ] 모든 컬럼 타입 확인
  ```sql
  SELECT table_name, column_name, data_type
  FROM information_schema.columns
  WHERE table_schema = 'public'
  ORDER BY table_name, ordinal_position;
  ```

#### 2단계: 제약조건
- [ ] CHECK 제약조건 동작 확인
  ```sql
  -- 위도 범위 초과 시도 (실패해야 함)
  INSERT INTO restaurants (name, lat, lng, category, road_address)
  VALUES ('테스트', 100, 0, ARRAY['한식'], '테스트 주소');
  -- ERROR: new row violates check constraint
  ```

- [ ] FOREIGN KEY 제약조건 확인
  ```sql
  -- 존재하지 않는 user_id 시도 (실패해야 함)
  INSERT INTO profiles (user_id, nickname, email)
  VALUES ('00000000-0000-0000-0000-000000000000', 'test', 'test@test.com');
  -- ERROR: violates foreign key constraint
  ```

#### 3단계: 인덱스
- [ ] 모든 인덱스 생성 확인
  ```sql
  SELECT COUNT(*) FROM pg_indexes WHERE schemaname = 'public';
  -- 결과: 50개 이상
  ```

- [ ] GIN 인덱스 확인
  ```sql
  SELECT COUNT(*) FROM pg_indexes 
  WHERE schemaname = 'public' AND indexdef LIKE '%USING gin%';
  -- 결과: 15개 이상
  ```

#### 4단계: 함수
- [ ] 모든 함수 생성 확인
  ```sql
  SELECT COUNT(*) FROM pg_proc 
  WHERE pronamespace = 'public'::regnamespace;
  -- 결과: 24개 이상
  ```

- [ ] 함수 실행 테스트
  ```sql
  SELECT * FROM get_restaurant_stats();
  SELECT * FROM get_user_stats();
  SELECT * FROM get_evaluation_records_stats();
  ```

#### 5단계: RLS 정책
- [ ] RLS 활성화 확인
  ```sql
  SELECT tablename, rowsecurity 
  FROM pg_tables 
  WHERE schemaname = 'public';
  -- 모든 테이블의 rowsecurity = true
  ```

- [ ] 정책 개수 확인
  ```sql
  SELECT COUNT(*) FROM pg_policies WHERE schemaname = 'public';
  -- 결과: 20개 이상
  ```

#### 6단계: Materialized View
- [ ] MV 생성 확인
  ```sql
  SELECT matviewname FROM pg_matviews WHERE schemaname = 'public';
  -- 결과: mv_restaurant_stats, mv_user_leaderboard, mv_popular_reviews
  ```

- [ ] MV 갱신 테스트
  ```sql
  SELECT refresh_materialized_views();
  -- SUCCESS
  ```

#### 7단계: 성능
- [ ] 테이블 크기 확인
  ```sql
  SELECT * FROM v_table_sizes;
  ```

- [ ] 인덱스 사용률 확인
  ```sql
  SELECT * FROM v_index_usage ORDER BY index_scans DESC LIMIT 20;
  ```

- [ ] 느린 쿼리 없는지 확인
  - Supabase Dashboard > Database > Query Performance

---

## 🐛 문제 해결

### 문제 1: 제약조건 위반
```sql
-- 기존 데이터 확인
SELECT * FROM restaurants WHERE lat > 90 OR lat < -90;

-- 데이터 수정
UPDATE restaurants SET lat = 37.5 WHERE lat > 90;
```

### 문제 2: 인덱스 생성 실패
```sql
-- 인덱스 재생성
DROP INDEX IF EXISTS idx_restaurants_name_trgm;
CREATE INDEX idx_restaurants_name_trgm ON restaurants USING GIN(name gin_trgm_ops);
```

### 문제 3: MV 갱신 실패
```sql
-- 수동 갱신
REFRESH MATERIALIZED VIEW CONCURRENTLY mv_restaurant_stats;
REFRESH MATERIALIZED VIEW CONCURRENTLY mv_user_leaderboard;
REFRESH MATERIALIZED VIEW CONCURRENTLY mv_popular_reviews;
```

---

**최종 업데이트:** 2025년 11월 7일  
**버전:** 2.0.0
