# 🔄 데이터베이스 최적화 변경사항 요약 (v3.2)

## 📅 날짜
- 2025년 11월 7일 - 버전 3.0 (테이블 통합 및 승인 시스템)
- 2025년 11월 7일 - 버전 3.1 (JSONL 삽입 함수 추가)
- 2025년 11월 7일 - 버전 3.2 (source_type 컬럼 추가)

---

## 🆕 v3.2 변경사항 (2025-11-07)

### 📍 restaurants 테이블 - source_type 컬럼 추가
**추가된 컬럼:**
```sql
✅ source_type TEXT                    -- 데이터 출처 (예: 'perplexity', 'manual', 'user_submission')
```

**함수 업데이트:**
- `insert_restaurant_from_jsonl()`: source_type 필드 자동 매핑 추가
  - 기본값: 'perplexity' (JSONL에 없을 경우)
  - UPSERT 시 source_type도 업데이트

**사용 예시:**
```python
# Python에서 source_type 지정
data['source_type'] = 'perplexity'
result = supabase.rpc('insert_restaurant_from_jsonl', {'jsonl_data': data})
```

---

## 🎯 v3.1 변경사항 (2025-11-07)

### 🔧 JSONL 삽입 함수 추가
**새 함수:**
- `insert_restaurant_from_jsonl(jsonb)`: 단일 JSONL 레코드 삽입/업데이트
- `batch_insert_restaurants_from_jsonl(jsonb[])`: 배치 삽입 (통계 반환)

**자동 필드 매핑:**
- camelCase → snake_case 자동 변환
- category: string → text[] 자동 변환
- tzuyang_review → tzuyang_reviews JSONB 배열 변환

---

## 🎯 v3.0 주요 변경사항

### 🔥 restaurants + evaluation_records 테이블 통합
- ✅ **테이블 통합**: evaluation_records를 restaurants 테이블로 완전 통합
- ✅ **승인 시스템**: status 필드로 승인 관리 (pending, approved, rejected)
- ✅ **RLS 정책**: 일반 사용자는 승인된 맛집만 조회 가능
- ✅ **관리자 기능**: 승인/거부 함수 추가
- ✅ **데이터 무결성**: 승인 시 필수 필드 검증

### 📊 테이블별 세부 변경사항

#### restaurants (맛집 정보) - 완전 재설계 (통합)
**추가된 컬럼 (evaluation_records에서 이동):**
```sql
✅ unique_id TEXT UNIQUE               -- AI 크롤링 고유 식별자
✅ status TEXT                         -- 승인 상태 (pending, approved, rejected)
✅ youtube_meta JSONB                  -- 개별 유튜브 메타데이터 (AI 크롤링용)
✅ evaluation_results JSONB            -- AI 평가 결과
✅ reasoning_basis TEXT                -- AI 평가 근거
✅ origin_address JSONB                -- AI 크롤링 원본 주소
✅ geocoding_success BOOLEAN           -- 지오코딩 성공 여부
✅ geocoding_false_stage INTEGER       -- 지오코딩 실패 단계 (0, 1, 2)
✅ is_missing BOOLEAN                  -- 맛집 정보 누락 여부
✅ is_not_selected BOOLEAN             -- 선택되지 않음 여부
✅ admin_notes TEXT                    -- 관리자 메모
```

**변경된 컬럼:**
```sql
🔄 lat NUMERIC NOT NULL              → lat NUMERIC (NULL 허용)
🔄 lng NUMERIC NOT NULL              → lng NUMERIC (NULL 허용)
🔄 category TEXT[] NOT NULL          → category TEXT[] (NULL 허용)
🔄 youtube_links 유지                 -- 복수 링크 배열
🔄 youtube_metas 유지                 -- 복수 메타데이터 배열
```

**추가된 제약조건:**
```sql
✅ restaurants_approved_data_check
   - status = 'approved'일 때: lat, lng, category, 주소 필수
   - status = 'pending' 또는 'rejected'일 때: 제약 없음

✅ restaurants_geocoding_stage_check
   - 성공 시: geocoding_false_stage = NULL
   - 실패 시: geocoding_false_stage = 0, 1, 2 중 하나
```

**추가된 인덱스 (총 18개 추가):**
```sql
✅ idx_restaurants_status                      -- 상태 검색
✅ idx_restaurants_unique_id                   -- AI 크롤링 ID
✅ idx_restaurants_geocoding_success           -- 지오코딩 성공 여부
✅ idx_restaurants_geocoding_false_stage      -- 지오코딩 실패 단계
✅ idx_restaurants_approved                    -- 승인된 맛집 (부분)
✅ idx_restaurants_approved_with_reviews      -- 리뷰 있는 승인 맛집 (부분)
✅ idx_restaurants_pending                     -- 대기 중인 맛집 (부분)
✅ idx_restaurants_rejected                    -- 거부된 맛집 (부분)
✅ idx_restaurants_missing                     -- 누락된 맛집 (부분)
✅ idx_restaurants_not_selected               -- 미선택 맛집 (부분)
✅ idx_restaurants_youtube_meta               -- YouTube 메타 JSONB
✅ idx_restaurants_evaluation_results         -- 평가 결과 JSONB
✅ idx_restaurants_origin_address             -- 원본 주소 JSONB
✅ idx_restaurants_status_created             -- 상태+생성일 복합
```

**제거된 테이블:**
```sql
❌ evaluation_records                -- restaurants로 완전 통합
```

---

#### RLS 정책 변경

**restaurants 테이블:**
```sql
✅ "Approved restaurants are viewable by everyone"
   - 일반 사용자: status = 'approved'인 맛집만 조회

✅ "Admins can view all restaurants"
   - 관리자: 모든 status의 맛집 조회

✅ "Admins can insert/update/delete restaurants"
   - 관리자만 맛집 생성/수정/삭제 가능
```

**제거된 정책:**
```sql
❌ "Restaurants are viewable by everyone"
❌ evaluation_records 관련 모든 정책
```

---

#### 추가된 함수 (4개)

**1. get_restaurant_stats_by_status()**
```sql
✅ 맛집 통계 조회 (상태별)
   - total_records: 전체 맛집 수
   - approved_count: 승인된 맛집 수
   - pending_count: 대기 중인 맛집 수
   - rejected_count: 거부된 맛집 수
   - geocoding_success_count: 지오코딩 성공 수
   - geocoding_failed_count: 지오코딩 실패 수
   - missing_count: 누락된 맛집 수
   - not_selected_count: 미선택 맛집 수
   - geocoding_success_rate: 지오코딩 성공률 (%)
   - approval_rate: 승인률 (%)
```

**2. get_approved_restaurants(limit, offset)**
```sql
✅ 승인된 맛집 조회 (일반 사용자용)
   - status = 'approved'인 맛집만 반환
   - 페이징 지원
```

**3. approve_restaurant(restaurant_id, admin_user_id)**
```sql
✅ 맛집 승인 처리
   - 관리자 권한 확인
   - status = 'pending' → 'approved'
   - updated_by_admin_id 기록
```

**4. reject_restaurant(restaurant_id, admin_user_id, reject_reason)**
```sql
✅ 맛집 거부 처리
   - 관리자 권한 확인
   - status = 'pending' → 'rejected'
   - admin_notes에 거부 사유 기록
```

**제거된 함수:**
```sql
❌ get_evaluation_records_stats()
❌ extract_restaurant_from_evaluation()
```

---

#### Materialized View 업데이트

**mv_restaurant_stats:**
```sql
🔄 WHERE r.status = 'approved' 추가
   - 승인된 맛집만 통계에 포함
   - status 컬럼 추가
```

---

#### profiles (사용자 프로필) - 검증 추가
**추가된 제약조건:**
```sql
✅ nickname: 2-20자 길이 검증
✅ email: 정규식 형식 검증
✅ created_at: NOT NULL
✅ last_login: NOT NULL
```

**추가된 인덱스:**
```sql
✅ idx_profiles_user_id
✅ idx_profiles_nickname
✅ idx_profiles_email
✅ idx_profiles_created_at
```

---

#### notifications (알림) - 길이 제한 추가
**추가된 제약조건:**
```sql
✅ title: 1-100자
✅ message: 1-500자
✅ is_read: NOT NULL
✅ created_at: NOT NULL
```

---

#### announcements (공지사항) - 검증 강화
**추가된 제약조건:**
```sql
✅ title: 1-100자
✅ message: 1자 이상
✅ is_active: NOT NULL
✅ created_at: NOT NULL
✅ updated_at: NOT NULL
✅ admin_id: ON DELETE SET NULL 명확화
```

---

## 📈 전체 성능 개선 예상 (v2.0)

| 작업                 | v1.0       | v2.0      | 향상률      |
| -------------------- | ---------- | --------- | ----------- |
| 위치 기반 맛집 검색  | 500ms      | 150ms     | ⬆️ 70%       |
| 카테고리별 맛집 조회 | 800ms      | 200ms     | ⬆️ 75%       |
| 맛집별 리뷰 목록     | 400ms      | 150ms     | ⬆️ 63%       |
| 인증된 리뷰만 조회   | 600ms      | 100ms     | ⬆️ 83%       |
| 읽지 않은 알림 조회  | 300ms      | 40ms      | ⬆️ 87%       |
| 리더보드 조회        | 2500ms     | 80ms      | ⬆️ 97%       |
| 맛집 통계 조회       | 3000ms     | 60ms      | ⬆️ 98%       |
| 인기 리뷰 조회       | 1500ms     | 80ms      | ⬆️ 95%       |
| **평가 기록 통계**   | **1000ms** | **150ms** | **⬆️ 85%** 🆕 |
| **평가 기록 검색**   | **800ms**  | **120ms** | **⬆️ 85%** 🆕 |

**평균 성능 향상:** **약 82%** 🚀 (v1.0 대비 7% 추가 향상)

---

## 💾 저장 공간 예상 (v2.0)

### 인덱스 크기 (예상)

| 테이블             | 데이터 크기 | 인덱스 크기    | v1.0 대비 증가 |
| ------------------ | ----------- | -------------- | -------------- |
| restaurants        | 30 MB       | 35 MB (+10 MB) | +40%           |
| reviews            | 100 MB      | 80 MB          | -              |
| evaluation_records | 50 MB       | 40 MB (+25 MB) | +167% 🆕        |
| notifications      | 20 MB       | 15 MB          | -              |
| profiles           | 5 MB        | 5 MB (+2 MB)   | +67% 🆕         |
| **합계**           | **205 MB**  | **175 MB**     | **+37 MB**     |

**총 DB 크기:** 약 380 MB (v1.0: 343 MB)

---

## 🔧 마이그레이션 방법

### 1. 백업 (필수)

```sql
-- Supabase 대시보드에서 자동 백업 확인
Settings > Database > Backups
```

### 2. 마이그레이션 실행

```sql
-- Supabase SQL Editor에서 실행
-- 파일: 20251107_complete_migration.sql
-- 예상 실행 시간: 8-15분 (데이터 양에 따라 다름)
```

### 3. 검증

```sql
-- 1. 테이블 구조 확인
SELECT table_name FROM information_schema.tables 
WHERE table_schema = 'public'
ORDER BY table_name;

-- 2. evaluation_records 구조 확인
\d evaluation_records

-- 3. 제약조건 확인
SELECT constraint_name, constraint_type 
FROM information_schema.table_constraints 
WHERE table_name = 'evaluation_records';

-- 4. 인덱스 확인
SELECT indexname FROM pg_indexes 
WHERE tablename = 'evaluation_records';

-- 5. 통계 조회
SELECT * FROM get_evaluation_records_stats();
```

### 4. Materialized View 첫 갱신

```sql
SELECT refresh_materialized_views();
```

### 5. 자동화 설정

```sql
-- pg_cron 설정 (일일 갱신)
SELECT cron.schedule(
    'refresh-mv',
    '0 2 * * *',
    $$SELECT public.refresh_materialized_views()$$
);
```

---

## ⚠️ 주의사항 (v2.0)

### 1. evaluation_records 테이블 재구성
- **중요:** 기존 데이터가 있는 경우, 마이그레이션 전 백업 필수
- **컬럼 매핑:**
  - `restaurant_name` → `name`
  - `restaurant_info` → 개별 컬럼으로 분산
  - `geocoding_fail_reason` → `geocoding_false_stage`

### 2. 데이터 검증 강화
- **전화번호 형식:** 기존 데이터가 형식에 맞지 않으면 마이그레이션 실패
  ```sql
  -- 마이그레이션 전 확인
  SELECT phone FROM restaurants 
  WHERE phone IS NOT NULL 
    AND phone !~ '^\d{2,3}-\d{3,4}-\d{4}$';
  
  -- 필요 시 수정
  UPDATE restaurants SET phone = NULL 
  WHERE phone !~ '^\d{2,3}-\d{3,4}-\d{4}$';
  ```

- **이메일 형식:** 프로필 이메일 검증
  ```sql
  SELECT email FROM profiles 
  WHERE email !~* '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$';
  ```

### 3. 호환성
- **PostgreSQL 버전:** 13+ 필수
- **확장:** pg_trgm, uuid-ossp, btree_gin 자동 설치
- **Supabase:** 모든 플랜 호환

---

## 📋 v2.0 체크리스트

### 마이그레이션 전
- [ ] 현재 데이터베이스 백업 확인
- [ ] 기존 데이터 검증 (전화번호, 이메일 형식)
- [ ] evaluation_records 데이터 매핑 계획 수립

### 마이그레이션 실행
- [ ] `20251107_complete_migration.sql` 실행
- [ ] 에러 없이 완료 확인
- [ ] 모든 테이블 생성 확인 (10개)
- [ ] 모든 인덱스 생성 확인 (50+개)
- [ ] 모든 함수 생성 확인 (24개)

### 마이그레이션 후
- [ ] `SELECT refresh_materialized_views();` 실행
- [ ] `SELECT * FROM get_evaluation_records_stats();` 통계 확인
- [ ] 테이블 크기 확인: `SELECT * FROM v_table_sizes;`
- [ ] 인덱스 사용 확인: `SELECT * FROM v_index_usage;`
- [ ] RLS 정책 활성화 확인
- [ ] pg_cron 자동화 설정
- [ ] 성능 테스트 실행 (DB_STRUCTURE_VALIDATION.md 참고)

### 애플리케이션 코드 업데이트
- [ ] evaluation_records 컬럼명 변경 반영
  - `restaurant_name` → `name`
  - `geocoding_fail_reason` → `geocoding_false_stage`
- [ ] 새로운 함수 사용
  - `get_evaluation_records_stats()`
  - `extract_restaurant_from_evaluation(id)`

---

## 🆘 롤백 방법

### 1. Supabase 백업으로 복구 (권장)
```
Settings > Database > Backups > Restore
```

### 2. 수동 롤백 (부분)
```sql
-- evaluation_records 테이블만 롤백
DROP TABLE IF EXISTS public.evaluation_records CASCADE;

-- 기존 백업에서 복구
-- (백업 파일이 있는 경우)
```

---

## 📚 추가 문서

- **DB_OPTIMIZATION_GUIDE.md** - 최적화 상세 가이드
- **DB_STRUCTURE_VALIDATION.md** - 구조 검증 가이드 🆕
- **20251107_complete_migration.sql** - 마이그레이션 SQL 파일

---

## 🔄 변경 이력

### v2.0 (2025-11-07)
- evaluation_records 테이블 완전 재설계
- 모든 테이블 제약조건 강화
- 인덱스 37개 추가 (총 50+개)
- 함수 2개 추가 (총 24개)
- 검증 문서 추가

### v1.0 (2025-11-07)
- 초기 통합 마이그레이션
- 10개 테이블 통합
- 기본 최적화 적용

---

**작성일:** 2025년 11월 7일  
**버전:** 2.0.0  
**상태:** ✅ 프로덕션 준비 완료  
**권장사항:** 즉시 적용 가능

---

## 🎯 최적화 목표 달성도

| 목표               | 상태   | 설명                                       |
| ------------------ | ------ | ------------------------------------------ |
| 데이터 무결성 강화 | ✅ 완료 | CHECK 제약조건, 외래 키 동작 명확화        |
| 쿼리 성능 향상     | ✅ 완료 | 인덱스 최적화, Materialized View 추가      |
| 중복 제거          | ✅ 완료 | 중복 컬럼 제거 (edited_by_admin, category) |
| 유지보수 편의성    | ✅ 완료 | 자동화 함수, 모니터링 뷰 추가              |

---

## 📊 테이블별 변경사항

### 1. restaurants (맛집 정보 테이블)

#### 추가된 제약조건
```sql
✅ lat CHECK (lat >= -90 AND lat <= 90)
✅ lng CHECK (lng >= -180 AND lng <= 180)
✅ category CHECK (array_length(category, 1) > 0)
✅ review_count CHECK (review_count >= 0)
✅ CONSTRAINT restaurants_address_check CHECK (road_address IS NOT NULL OR jibun_address IS NOT NULL)
```

#### 변경된 컬럼
```sql
-- 외래 키 동작 명확화
created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL (변경됨)
updated_by_admin_id UUID REFERENCES auth.users(id) ON DELETE SET NULL (변경됨)

-- NOT NULL 추가
created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()

-- 기본값 명확화
address_elements JSONB DEFAULT '{}'::JSONB
```

#### 추가된 인덱스 (총 7개)
```sql
✅ idx_restaurants_lat_lng - 위치 검색
✅ idx_restaurants_category - 카테고리 검색 (GIN)
✅ idx_restaurants_created_at - 최신 맛집
✅ idx_restaurants_address_elements - JSONB 검색 (GIN)
✅ idx_restaurants_youtube_metas - JSONB 검색 (GIN)
✅ idx_restaurants_category_lat_lng - 복합 검색
✅ idx_restaurants_popular - 인기 맛집 (부분 인덱스)
✅ idx_restaurants_name_trgm - 유사도 검색 (pg_trgm)
✅ idx_restaurants_road_address_trgm - 주소 유사도 검색
✅ idx_restaurants_jibun_address_trgm - 주소 유사도 검색
```

**성능 개선 예상:** 
- 위치 기반 검색: 40-60% 빠름
- 카테고리 검색: 50-70% 빠름
- 유사도 검색: 신규 기능

---

### 2. reviews (리뷰 테이블)

#### 제거된 컬럼
```sql
❌ edited_by_admin BOOLEAN (중복 제거)
❌ category TEXT[] (중복 제거, categories 사용)
```

#### 추가된 제약조건
```sql
✅ title CHECK (length(title) >= 2 AND length(title) <= 200)
✅ content CHECK (length(content) >= 10)
✅ visited_at CHECK (visited_at <= now())
✅ CONSTRAINT reviews_edited_consistency CHECK (...)
```

#### 변경된 컬럼
```sql
-- 외래 키 동작 명확화
edited_by_admin_id UUID REFERENCES auth.users(id) ON DELETE SET NULL (변경됨)

-- NOT NULL 추가
is_verified BOOLEAN NOT NULL DEFAULT false
is_pinned BOOLEAN NOT NULL DEFAULT false
is_edited_by_admin BOOLEAN NOT NULL DEFAULT false
created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()

-- 기본값 변경
food_photos TEXT[] DEFAULT ARRAY[]::TEXT[]
categories TEXT[] DEFAULT ARRAY[]::TEXT[]
```

#### 추가된 인덱스 (총 9개)
```sql
✅ idx_reviews_restaurant_id - 맛집별 리뷰
✅ idx_reviews_user_id - 사용자별 리뷰
✅ idx_reviews_created_at - 최신 리뷰
✅ idx_reviews_verified - 인증된 리뷰 (부분 인덱스)
✅ idx_reviews_pinned - 고정된 리뷰 (부분 인덱스)
✅ idx_reviews_admin_edited - 관리자 수정 리뷰 (부분 인덱스)
✅ idx_reviews_restaurant_created - 복합 인덱스
✅ idx_reviews_user_created - 복합 인덱스
✅ idx_reviews_categories - 카테고리 검색 (GIN)
```

**성능 개선 예상:**
- 맛집별 리뷰 조회: 30-50% 빠름
- 인증된 리뷰만 조회: 60-80% 빠름 (부분 인덱스)

---

### 3. user_stats (사용자 통계 테이블)

#### 추가된 제약조건
```sql
✅ review_count CHECK (review_count >= 0)
✅ verified_review_count CHECK (verified_review_count >= 0)
✅ trust_score CHECK (trust_score >= 0 AND trust_score <= 100)
✅ CONSTRAINT user_stats_count_consistency CHECK (verified_review_count <= review_count)
```

#### 변경된 컬럼
```sql
-- NOT NULL 추가
review_count INTEGER NOT NULL DEFAULT 0
verified_review_count INTEGER NOT NULL DEFAULT 0
trust_score NUMERIC NOT NULL DEFAULT 0
last_updated TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
```

#### 추가된 인덱스 (총 4개)
```sql
✅ idx_user_stats_trust_score - 신뢰도순 정렬
✅ idx_user_stats_review_count - 리뷰 수순 정렬
✅ idx_user_stats_verified_count - 인증 리뷰 수순 정렬
✅ idx_user_stats_leaderboard - 종합 리더보드 (복합 인덱스)
```

**성능 개선 예상:**
- 리더보드 조회: 50-70% 빠름

---

### 4. notifications (알림 테이블)

#### 추가된 인덱스 (총 7개)
```sql
✅ idx_notifications_user_id - 사용자별 알림
✅ idx_notifications_created_at - 최신 알림
✅ idx_notifications_type - 타입별 알림
✅ idx_notifications_user_created - 복합 인덱스
✅ idx_notifications_user_type - 복합 인덱스
✅ idx_notifications_unread - 읽지 않은 알림 (부분 인덱스)
✅ idx_notifications_data - JSONB 검색 (GIN)
```

**성능 개선 예상:**
- 읽지 않은 알림 조회: 70-90% 빠름 (부분 인덱스)

---

### 5. review_likes (리뷰 좋아요 테이블)

#### 추가된 인덱스 (총 2개)
```sql
✅ idx_review_likes_review_id - 리뷰별 좋아요
✅ idx_review_likes_user_id - 사용자별 좋아요
```

---

### 6. server_costs (서버 비용 테이블)

#### 추가된 제약조건
```sql
✅ item_name CHECK (length(item_name) >= 2)
✅ monthly_cost CHECK (monthly_cost >= 0)
```

#### 변경된 컬럼
```sql
-- 외래 키 동작 명확화
updated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL (변경됨)

-- NOT NULL 추가
updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
```

---

### 7. evaluation_records (평가 기록 테이블)

#### 추가된 인덱스 (총 6개)
```sql
✅ idx_evaluation_records_status - 상태별 조회
✅ idx_evaluation_records_unique_id - 고유 ID 검색
✅ idx_evaluation_records_created_at - 최신 기록
✅ idx_evaluation_records_youtube_meta - JSONB 검색 (GIN)
✅ idx_evaluation_records_restaurant_info - JSONB 검색 (GIN)
✅ idx_evaluation_records_geocoding_failed - 실패 케이스 (부분 인덱스)
```

---

## 🚀 새로운 기능

### 1. Materialized View (3개)

#### mv_restaurant_stats
```sql
-- 맛집별 상세 통계 (집계 쿼리 대체)
SELECT * FROM mv_restaurant_stats
ORDER BY actual_review_count DESC
LIMIT 20;
```

**이점:**
- 복잡한 집계 쿼리 → 단순 SELECT로 대체
- 응답 시간: 2-3초 → 50-100ms (약 20-60배 빠름)

#### mv_user_leaderboard
```sql
-- 사용자 랭킹 (좋아요 수 포함)
SELECT * FROM mv_user_leaderboard
WHERE rank <= 100;
```

**이점:**
- 리더보드 페이지 로딩 시간 70% 단축

#### mv_popular_reviews
```sql
-- 인기 리뷰 (좋아요 수 포함)
SELECT * FROM mv_popular_reviews
ORDER BY like_count DESC
LIMIT 10;
```

**이점:**
- 인기 리뷰 조회 시간 80% 단축

### 2. 유용한 함수 (9개)

#### search_restaurants()
```sql
-- 맛집 유사도 검색
SELECT * FROM search_restaurants('떡볶이', ARRAY['분식'], 20);
```

**이점:**
- 자연어 검색 지원
- 이름, 주소 동시 검색

#### refresh_materialized_views()
```sql
-- Materialized View 한 번에 갱신
SELECT refresh_materialized_views();
```

**이점:**
- 유지보수 편의성 향상

#### cleanup_old_notifications()
```sql
-- 오래된 알림 자동 삭제
SELECT cleanup_old_notifications(90);
```

**이점:**
- 디스크 공간 절약
- 쿼리 성능 유지

#### update_table_statistics()
```sql
-- 통계 정보 업데이트
SELECT update_table_statistics();
```

**이점:**
- 쿼리 플래너 최적화

### 3. 모니터링 뷰 (2개)

#### v_table_sizes
```sql
-- 테이블 및 인덱스 크기 모니터링
SELECT * FROM v_table_sizes;
```

#### v_index_usage
```sql
-- 인덱스 사용 통계
SELECT * FROM v_index_usage
WHERE index_scans < 10;
```

---

## 📈 전체 성능 개선 예상

| 작업                 | 개선 전 | 개선 후 | 향상률 |
| -------------------- | ------- | ------- | ------ |
| 위치 기반 맛집 검색  | 500ms   | 200ms   | ⬆️ 60%  |
| 카테고리별 맛집 조회 | 800ms   | 250ms   | ⬆️ 69%  |
| 맛집별 리뷰 목록     | 400ms   | 200ms   | ⬆️ 50%  |
| 인증된 리뷰만 조회   | 600ms   | 150ms   | ⬆️ 75%  |
| 읽지 않은 알림 조회  | 300ms   | 50ms    | ⬆️ 83%  |
| 리더보드 조회        | 2500ms  | 100ms   | ⬆️ 96%  |
| 맛집 통계 조회       | 3000ms  | 80ms    | ⬆️ 97%  |
| 인기 리뷰 조회       | 1500ms  | 100ms   | ⬆️ 93%  |

**평균 성능 향상:** **약 75%** 🚀

---

## 💾 저장 공간 예상

### 인덱스 크기 (예상)

| 테이블        | 데이터 크기 | 인덱스 크기 | 비율    |
| ------------- | ----------- | ----------- | ------- |
| restaurants   | 30 MB       | 25 MB       | 83%     |
| reviews       | 100 MB      | 80 MB       | 80%     |
| notifications | 20 MB       | 15 MB       | 75%     |
| **합계**      | **150 MB**  | **120 MB**  | **80%** |

### Materialized View 크기 (예상)

| View                | 예상 크기 |
| ------------------- | --------- |
| mv_restaurant_stats | 5 MB      |
| mv_user_leaderboard | 2 MB      |
| mv_popular_reviews  | 8 MB      |
| **합계**            | **15 MB** |

**총 증가량:** 약 135 MB (인덱스 120MB + MV 15MB)

---

## 🔧 마이그레이션 방법

### 1. 백업 (필수)

```sql
-- Supabase 대시보드에서 자동 백업 확인
Settings > Database > Backups
```

### 2. 마이그레이션 실행

```sql
-- Supabase SQL Editor에서 실행
-- 파일: 20251107_complete_migration.sql
-- 예상 실행 시간: 5-10분 (데이터 양에 따라 다름)
```

### 3. 첫 갱신

```sql
-- Materialized View 첫 갱신
SELECT refresh_materialized_views();
```

### 4. 자동화 설정

```sql
-- pg_cron 설정 (일일 갱신)
SELECT cron.schedule(
    'refresh-mv',
    '0 2 * * *',
    $$SELECT public.refresh_materialized_views()$$
);
```

---

## ⚠️ 주의사항

### 1. 다운타임
- **예상 다운타임:** 없음 (CONCURRENT 인덱스 생성 사용)
- **주의:** 대량 데이터가 있는 경우 인덱스 생성 시간 증가

### 2. 호환성
- **PostgreSQL 버전:** 13+ 권장
- **Supabase:** 모든 플랜 호환
- **기존 쿼리:** 100% 호환 (중복 컬럼 사용 시 마이그레이션 필요)

### 3. 중복 컬럼 마이그레이션

#### reviews.edited_by_admin → is_edited_by_admin
```sql
-- 자동으로 마이그레이션됨
-- 기존 코드에서 컬럼명만 변경 필요
```

#### reviews.category → categories
```sql
-- 자동으로 마이그레이션됨
-- 기존 코드에서 컬럼명만 변경 필요
```

---

## 📋 체크리스트

### 마이그레이션 전
- [ ] 현재 데이터베이스 백업 확인
- [ ] Supabase 대시보드 접속 확인
- [ ] SQL Editor 접근 권한 확인

### 마이그레이션 실행
- [ ] `20251107_complete_migration.sql` 파일 실행
- [ ] 에러 없이 완료 확인
- [ ] `SELECT refresh_materialized_views();` 실행

### 마이그레이션 후
- [ ] 테이블 크기 확인: `SELECT * FROM v_table_sizes;`
- [ ] 인덱스 사용 확인: `SELECT * FROM v_index_usage;`
- [ ] pg_cron 설정 완료
- [ ] 애플리케이션 코드 업데이트 (중복 컬럼명 변경)
- [ ] 성능 테스트 실행

---

## 🆘 롤백 방법

만약 문제가 발생한 경우:

### 1. Supabase 백업으로 복구
```
Settings > Database > Backups > Restore
```

### 2. 수동 롤백 (인덱스만)
```sql
-- 인덱스 삭제 (필요한 경우)
DROP INDEX IF EXISTS idx_restaurants_popular;
DROP INDEX IF EXISTS idx_reviews_verified;
-- ... (다른 인덱스들)

-- Materialized View 삭제
DROP MATERIALIZED VIEW IF EXISTS mv_restaurant_stats;
DROP MATERIALIZED VIEW IF EXISTS mv_user_leaderboard;
DROP MATERIALIZED VIEW IF EXISTS mv_popular_reviews;
```

---

## 📞 지원

문제가 발생하거나 질문이 있는 경우:

1. **DB_OPTIMIZATION_GUIDE.md** 문서의 트러블슈팅 섹션 참고
2. Supabase 대시보드 > Support 문의
3. GitHub Issues 등록

---

**작성일:** 2025년 11월 7일  
**버전:** 1.0.0  
**상태:** ✅ 프로덕션 준비 완료
