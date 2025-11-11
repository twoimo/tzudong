# 🚀 데이터베이스 최적화 가이드

## 📋 목차
1. [최적화 개요](#최적화-개요)
2. [주요 개선사항](#주요-개선사항)
3. [성능 최적화 전략](#성능-최적화-전략)
4. [유지보수 가이드](#유지보수-가이드)
5. [모니터링 방법](#모니터링-방법)
6. [트러블슈팅](#트러블슈팅)

---

## 🎯 최적화 개요

### 적용 날짜
2025년 11월 7일

### 최적화 목표
- ✅ 데이터 무결성 강화
- ✅ 쿼리 성능 향상 (평균 30-50% 개선 예상)
- ✅ 인덱스 효율성 증대
- ✅ 유지보수 편의성 향상

---

## 🔧 주요 개선사항

### 1. 데이터 무결성 강화

#### CHECK 제약조건 추가
```sql
-- 위도/경도 범위 검증
lat NUMERIC CHECK (lat >= -90 AND lat <= 90)
lng NUMERIC CHECK (lng >= -180 AND lng <= 180)

-- 신뢰도 점수 범위 검증 (0-100)
trust_score NUMERIC CHECK (trust_score >= 0 AND trust_score <= 100)

-- 문자열 길이 검증
title TEXT CHECK (length(title) >= 2 AND length(title) <= 200)
content TEXT CHECK (length(content) >= 10)

-- 배열 최소 크기 검증
category TEXT[] CHECK (array_length(category, 1) > 0)
```

#### 외래 키 동작 명확화
```sql
-- 사용자 삭제 시 NULL로 설정
created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL
updated_by_admin_id UUID REFERENCES auth.users(id) ON DELETE SET NULL
edited_by_admin_id UUID REFERENCES auth.users(id) ON DELETE SET NULL

-- 연쇄 삭제
user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE
restaurant_id UUID REFERENCES restaurants(id) ON DELETE CASCADE
```

#### 복합 제약조건
```sql
-- 주소 필수 입력 (도로명 또는 지번 중 하나)
CONSTRAINT restaurants_address_check CHECK (
    road_address IS NOT NULL OR jibun_address IS NOT NULL
)

-- 관리자 수정 일관성
CONSTRAINT reviews_edited_consistency CHECK (
    (is_edited_by_admin = false AND edited_by_admin_id IS NULL) OR
    (is_edited_by_admin = true AND edited_by_admin_id IS NOT NULL)
)

-- 통계 일관성
CONSTRAINT user_stats_count_consistency CHECK (
    verified_review_count <= review_count
)
```

### 2. 인덱스 최적화

#### 복합 인덱스 (자주 함께 조회되는 컬럼)
```sql
-- 맛집별 최신 리뷰
CREATE INDEX idx_reviews_restaurant_created 
ON reviews(restaurant_id, created_at DESC);

-- 사용자별 최신 리뷰
CREATE INDEX idx_reviews_user_created 
ON reviews(user_id, created_at DESC);

-- 사용자별 읽지 않은 알림
CREATE INDEX idx_notifications_user_created 
ON notifications(user_id, created_at DESC);
```

#### 부분 인덱스 (특정 조건만)
```sql
-- 인증된 리뷰만
CREATE INDEX idx_reviews_verified 
ON reviews(restaurant_id, created_at DESC) 
WHERE is_verified = true;

-- 고정된 리뷰만
CREATE INDEX idx_reviews_pinned 
ON reviews(restaurant_id, created_at DESC) 
WHERE is_pinned = true;

-- 읽지 않은 알림만
CREATE INDEX idx_notifications_unread 
ON notifications(user_id, created_at DESC) 
WHERE is_read = false;

-- 리뷰가 있는 맛집만
CREATE INDEX idx_restaurants_popular 
ON restaurants(review_count DESC) 
WHERE review_count > 0;
```

#### GIN 인덱스 (배열 및 JSONB)
```sql
-- 카테고리 배열 검색
CREATE INDEX idx_restaurants_category 
ON restaurants USING GIN(category);

-- 리뷰 카테고리 검색
CREATE INDEX idx_reviews_categories 
ON reviews USING GIN(categories);

-- JSONB 검색
CREATE INDEX idx_restaurants_address_elements 
ON restaurants USING GIN(address_elements);

CREATE INDEX idx_restaurants_youtube_metas 
ON restaurants USING GIN(youtube_metas);

CREATE INDEX idx_notifications_data 
ON notifications USING GIN(data);
```

#### 유사도 검색 인덱스 (pg_trgm)
```sql
-- 맛집 이름 유사도 검색
CREATE INDEX idx_restaurants_name_trgm 
ON restaurants USING GIN(name gin_trgm_ops);

-- 주소 유사도 검색
CREATE INDEX idx_restaurants_road_address_trgm 
ON restaurants USING GIN(road_address gin_trgm_ops);
```

### 3. Materialized View (성능 최적화)

#### 맛집 통계 View
```sql
-- 맛집별 상세 통계 (리뷰 수, 인증 수, 고유 리뷰어 수 등)
CREATE MATERIALIZED VIEW mv_restaurant_stats AS
SELECT 
    r.id,
    r.name,
    COUNT(rv.id) AS actual_review_count,
    COUNT(rv.id) FILTER (WHERE rv.is_verified = true) AS verified_review_count,
    COUNT(DISTINCT rv.user_id) AS unique_reviewers,
    MAX(rv.created_at) AS last_review_at
FROM restaurants r
LEFT JOIN reviews rv ON r.id = rv.restaurant_id
GROUP BY r.id;
```

**사용 예시:**
```sql
-- 일반 쿼리 (느림)
SELECT r.id, COUNT(rv.id) 
FROM restaurants r 
LEFT JOIN reviews rv ON r.id = rv.restaurant_id 
GROUP BY r.id;

-- Materialized View 사용 (빠름)
SELECT * FROM mv_restaurant_stats;
```

#### 사용자 리더보드 View
```sql
-- 사용자 랭킹 및 좋아요 수 포함
CREATE MATERIALIZED VIEW mv_user_leaderboard AS
SELECT 
    p.user_id,
    p.nickname,
    us.trust_score,
    COUNT(rl.id) AS total_likes_received,
    RANK() OVER (ORDER BY us.trust_score DESC) AS rank
FROM profiles p
INNER JOIN user_stats us ON p.user_id = us.user_id
GROUP BY p.user_id, p.nickname, us.trust_score;
```

#### 인기 리뷰 View
```sql
-- 좋아요 수가 포함된 리뷰 목록
CREATE MATERIALIZED VIEW mv_popular_reviews AS
SELECT 
    rv.id,
    rv.title,
    COUNT(rl.id) AS like_count,
    p.nickname AS user_nickname,
    r.name AS restaurant_name
FROM reviews rv
LEFT JOIN review_likes rl ON rv.id = rl.review_id
GROUP BY rv.id, p.nickname, r.name;
```

### 4. 유용한 함수 추가

#### 맛집 검색 함수 (유사도 기반)
```sql
-- 이름 또는 주소로 유사도 검색
SELECT * FROM search_restaurants('홍대 떡볶이', NULL, 20);
SELECT * FROM search_restaurants('강남', ARRAY['한식', '고기'], 30);
```

#### Materialized View 자동 갱신
```sql
-- 모든 Materialized View를 한 번에 갱신
SELECT refresh_materialized_views();
```

#### 오래된 알림 정리
```sql
-- 90일 이상 된 읽은 알림 삭제
SELECT cleanup_old_notifications(90);
```

#### 테이블 통계 업데이트
```sql
-- 쿼리 플래너 최적화를 위한 통계 업데이트
SELECT update_table_statistics();
```

---

## 📊 성능 최적화 전략

### 쿼리 작성 가이드

#### ✅ 좋은 예시

```sql
-- 1. 인덱스 활용
SELECT * FROM restaurants 
WHERE category && ARRAY['한식'] 
AND review_count > 0
ORDER BY review_count DESC
LIMIT 20;
-- ✅ idx_restaurants_category, idx_restaurants_popular 사용

-- 2. Materialized View 활용
SELECT * FROM mv_restaurant_stats
ORDER BY actual_review_count DESC
LIMIT 20;
-- ✅ 집계 쿼리 대신 미리 계산된 View 사용

-- 3. 부분 인덱스 활용
SELECT * FROM reviews
WHERE restaurant_id = 'xxx'
AND is_verified = true
ORDER BY created_at DESC;
-- ✅ idx_reviews_verified 사용
```

#### ❌ 피해야 할 패턴

```sql
-- 1. SELECT * 남용
SELECT * FROM restaurants;
-- ❌ 필요한 컬럼만 선택하세요
SELECT id, name, lat, lng FROM restaurants;

-- 2. LIKE '%검색어%' 시작
SELECT * FROM restaurants WHERE name LIKE '%떡볶이%';
-- ❌ 인덱스를 사용할 수 없음
-- ✅ 유사도 검색 함수 사용
SELECT * FROM search_restaurants('떡볶이', NULL, 20);

-- 3. 복잡한 서브쿼리 반복
SELECT r.*, 
  (SELECT COUNT(*) FROM reviews WHERE restaurant_id = r.id) AS review_count
FROM restaurants r;
-- ❌ 각 행마다 서브쿼리 실행
-- ✅ JOIN 또는 Materialized View 사용
SELECT * FROM mv_restaurant_stats;
```

### 인덱스 선택 가이드

| 쿼리 패턴        | 추천 인덱스 타입 | 예시                               |
| ---------------- | ---------------- | ---------------------------------- |
| 정확한 일치 검색 | B-tree (기본)    | `WHERE id = 'xxx'`                 |
| 범위 검색        | B-tree           | `WHERE created_at > '2024-01-01'`  |
| 배열 포함 검색   | GIN              | `WHERE category && ARRAY['한식']`  |
| JSONB 검색       | GIN              | `WHERE data @> '{"key": "value"}'` |
| 텍스트 유사도    | GIN (pg_trgm)    | `WHERE name % '검색어'`            |
| 특정 조건만      | 부분 인덱스      | `WHERE is_verified = true`         |

---

## 🔄 유지보수 가이드

### 일일 작업 (자동화 권장)

```sql
-- Materialized View 갱신 (매일 새벽 2시)
SELECT refresh_materialized_views();
```

**pg_cron 설정 (Supabase):**
```sql
-- Supabase 대시보드 > Database > Cron Jobs
SELECT cron.schedule(
    'refresh-materialized-views',
    '0 2 * * *',  -- 매일 새벽 2시
    $$SELECT public.refresh_materialized_views()$$
);
```

### 주간 작업 (자동화 권장)

```sql
-- 테이블 통계 업데이트 (매주 일요일 새벽 3시)
SELECT update_table_statistics();
```

**pg_cron 설정:**
```sql
SELECT cron.schedule(
    'update-statistics',
    '0 3 * * 0',  -- 매주 일요일 새벽 3시
    $$SELECT public.update_table_statistics()$$
);
```

### 월간 작업 (자동화 권장)

```sql
-- 오래된 알림 삭제 (매월 1일 새벽 4시)
SELECT cleanup_old_notifications(90);

-- VACUUM 작업
VACUUM ANALYZE restaurants;
VACUUM ANALYZE reviews;
VACUUM ANALYZE notifications;
```

**pg_cron 설정:**
```sql
SELECT cron.schedule(
    'cleanup-notifications',
    '0 4 1 * *',  -- 매월 1일 새벽 4시
    $$SELECT public.cleanup_old_notifications(90)$$
);
```

### 분기별 작업

```sql
-- 인덱스 재구성 (성능 저하 시)
REINDEX TABLE CONCURRENTLY restaurants;
REINDEX TABLE CONCURRENTLY reviews;
REINDEX TABLE CONCURRENTLY review_likes;
REINDEX TABLE CONCURRENTLY notifications;
```

---

## 📈 모니터링 방법

### 1. 테이블 크기 확인

```sql
SELECT * FROM v_table_sizes;
```

**출력 예시:**
```
| schema_name | table_name    | total_size | table_size | index_size |
| ----------- | ------------- | ---------- | ---------- | ---------- |
| public      | reviews       | 150 MB     | 80 MB      | 70 MB      |
| public      | restaurants   | 50 MB      | 30 MB      | 20 MB      |
| public      | notifications | 30 MB      | 20 MB      | 10 MB      |
```

**조치 사항:**
- 테이블이 1GB 이상: 파티셔닝 고려
- 인덱스가 테이블보다 큼: 불필요한 인덱스 제거 고려

### 2. 인덱스 사용 통계

```sql
SELECT * FROM v_index_usage
WHERE index_scans < 10;  -- 사용되지 않는 인덱스
```

**출력 예시:**
```
| table_name | index_name             | index_scans | index_size |
| ---------- | ---------------------- | ----------- | ---------- |
| reviews    | idx_reviews_old_column | 0           | 5 MB       |
```

**조치 사항:**
- index_scans = 0: 인덱스 삭제 고려
- index_size가 큰데 사용 적음: 인덱스 삭제 고려

### 3. 느린 쿼리 찾기

**Supabase 대시보드:**
1. Database > Query Performance
2. Top Queries 확인
3. Execution Time 기준 정렬

**개선 방법:**
- Sequential Scan → 인덱스 추가
- 높은 실행 시간 → Materialized View 사용
- 복잡한 JOIN → 쿼리 단순화 또는 비정규화

### 4. Materialized View 갱신 상태

```sql
-- 마지막 갱신 시간 확인
SELECT 
    schemaname,
    matviewname,
    pg_size_pretty(pg_total_relation_size(schemaname||'.'||matviewname)) AS size
FROM pg_matviews
WHERE schemaname = 'public';
```

---

## 🔍 트러블슈팅

### 문제 1: 쿼리가 느려요

**진단:**
```sql
EXPLAIN ANALYZE
SELECT * FROM restaurants 
WHERE name LIKE '%떡볶이%';
```

**해결책:**
```sql
-- 유사도 검색 함수 사용
SELECT * FROM search_restaurants('떡볶이', NULL, 20);
```

### 문제 2: Materialized View가 최신 데이터를 보여주지 않아요

**원인:** Materialized View는 수동 갱신 필요

**해결책:**
```sql
-- 즉시 갱신
SELECT refresh_materialized_views();

-- 자동 갱신 스케줄 확인
SELECT * FROM cron.job;
```

### 문제 3: 디스크 공간이 부족해요

**진단:**
```sql
-- 테이블 크기 확인
SELECT * FROM v_table_sizes;

-- 오래된 데이터 확인
SELECT COUNT(*), 
       MIN(created_at) as oldest,
       MAX(created_at) as newest
FROM notifications
WHERE is_read = true;
```

**해결책:**
```sql
-- 오래된 알림 삭제
SELECT cleanup_old_notifications(30);  -- 30일 기준

-- VACUUM으로 공간 회수
VACUUM FULL notifications;
```

### 문제 4: 인덱스가 너무 많아요

**진단:**
```sql
-- 사용되지 않는 인덱스 찾기
SELECT * FROM v_index_usage
WHERE index_scans < 100
ORDER BY pg_relation_size(indexrelid) DESC;
```

**해결책:**
```sql
-- 사용되지 않는 인덱스 삭제
DROP INDEX IF EXISTS idx_unused_index;
```

### 문제 5: RLS 정책으로 인한 성능 저하

**진단:**
```sql
EXPLAIN ANALYZE
SELECT * FROM reviews
WHERE user_id = auth.uid();
```

**해결책:**
```sql
-- 적절한 인덱스 추가
CREATE INDEX idx_reviews_user_id ON reviews(user_id)
WHERE user_id = auth.uid();
```

---

## 📚 추가 리소스

### PostgreSQL 공식 문서
- [인덱스 타입](https://www.postgresql.org/docs/current/indexes-types.html)
- [쿼리 성능 튜닝](https://www.postgresql.org/docs/current/performance-tips.html)
- [VACUUM과 ANALYZE](https://www.postgresql.org/docs/current/routine-vacuuming.html)

### Supabase 문서
- [Database Optimization](https://supabase.com/docs/guides/database/database-optimization)
- [Postgres Extensions](https://supabase.com/docs/guides/database/extensions)
- [pg_cron 설정](https://supabase.com/docs/guides/database/extensions/pg_cron)

### 권장 도구
- [pgAdmin](https://www.pgadmin.org/) - PostgreSQL GUI 관리 도구
- [pg_stat_statements](https://www.postgresql.org/docs/current/pgstatstatements.html) - 쿼리 통계 추적
- [EXPLAIN Visualizer](https://explain.dalibo.com/) - 쿼리 플랜 시각화

---

## ✅ 체크리스트

### 마이그레이션 후 확인사항

- [ ] Materialized View 첫 갱신 완료
  ```sql
  SELECT refresh_materialized_views();
  ```

- [ ] pg_cron 스케줄 설정 완료
  - [ ] 일일: Materialized View 갱신
  - [ ] 주간: 통계 업데이트
  - [ ] 월간: 알림 정리

- [ ] 모니터링 뷰 확인
  ```sql
  SELECT * FROM v_table_sizes;
  SELECT * FROM v_index_usage;
  ```

- [ ] RLS 정책 검증
  ```sql
  -- 각 테이블의 정책 확인
  SELECT * FROM pg_policies WHERE schemaname = 'public';
  ```

- [ ] 보안 설정 확인
  - [ ] Supabase 대시보드 > Authentication > Settings
  - [ ] "Enable password leak detection" 활성화

### 정기 점검사항

#### 주간
- [ ] 느린 쿼리 확인 (Database > Query Performance)
- [ ] 테이블 크기 확인
- [ ] 에러 로그 확인

#### 월간
- [ ] 인덱스 사용 통계 확인
- [ ] 디스크 공간 확인
- [ ] 백업 상태 확인

#### 분기별
- [ ] 인덱스 재구성 검토
- [ ] 쿼리 성능 분석
- [ ] 스키마 최적화 검토

---

**마지막 업데이트:** 2025년 11월 7일  
**작성자:** DB 최적화 팀  
**버전:** 1.0.0
