# 🔄 restaurants + evaluation_records 테이블 통합 가이드 (v3.0)

## 📋 개요

`evaluation_records` 테이블을 `restaurants` 테이블로 통합하여, 하나의 테이블에서 AI 크롤링 데이터와 승인 프로세스를 관리합니다.

---

## 🎯 통합 목적

### 기존 문제점
- 두 개의 테이블로 데이터가 분산되어 관리 복잡도 증가
- 승인 프로세스가 명확하지 않음
- 일반 사용자가 미승인 데이터를 볼 수 있는 보안 문제

### 해결 방안
- **테이블 통합**: 모든 맛집 데이터를 `restaurants` 테이블에서 관리
- **승인 시스템**: `status` 필드로 승인 상태 관리 (pending, approved, rejected)
- **RLS 정책**: 일반 사용자는 승인된 맛집만 조회 가능

---

## 📊 테이블 구조

### restaurants 테이블 (통합 후)

```sql
CREATE TABLE public.restaurants (
    -- 기본 정보
    id UUID PRIMARY KEY,
    name TEXT NOT NULL,
    phone TEXT,
    description TEXT,
    category TEXT[],  -- NULL 허용 (승인 전)
    
    -- 위치 정보
    lat NUMERIC,  -- NULL 허용 (승인 전)
    lng NUMERIC,  -- NULL 허용 (승인 전)
    
    -- 주소 정보
    road_address TEXT,
    jibun_address TEXT,
    english_address TEXT,
    address_elements JSONB,
    origin_address JSONB,  -- AI 크롤링 원본
    
    -- 유튜브 정보
    youtube_links TEXT[],
    youtube_meta JSONB,     -- 개별 메타데이터 (AI 크롤링)
    youtube_metas JSONB,    -- 복수 메타데이터
    unique_id TEXT UNIQUE,  -- AI 크롤링 ID
    
    -- 쯔양 리뷰
    tzuyang_reviews JSONB,
    reasoning_basis TEXT,   -- AI 평가 근거
    
    -- AI 평가 정보
    evaluation_results JSONB,
    
    -- 지오코딩
    geocoding_success BOOLEAN DEFAULT false,
    geocoding_false_stage INTEGER,  -- 0, 1, 2
    
    -- 상태 관리 ⭐ 핵심
    status TEXT DEFAULT 'pending',  -- pending, approved, rejected
    is_missing BOOLEAN DEFAULT false,
    is_not_selected BOOLEAN DEFAULT false,
    
    -- 관리
    review_count INTEGER DEFAULT 0,
    admin_notes TEXT,
    created_by UUID,
    updated_by_admin_id UUID,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    
    -- 제약조건
    CONSTRAINT restaurants_approved_data_check CHECK (
        -- 승인 시 필수 데이터 검증
        (status = 'approved' AND 
         lat IS NOT NULL AND 
         lng IS NOT NULL AND 
         category IS NOT NULL AND
         (road_address IS NOT NULL OR jibun_address IS NOT NULL)) OR
        status IN ('pending', 'rejected')
    )
);
```

---

## 🔐 RLS 정책

### 1. 일반 사용자 (조회만)
```sql
-- 승인된 맛집만 조회 가능
CREATE POLICY "Approved restaurants are viewable by everyone"
    ON public.restaurants FOR SELECT
    TO public
    USING (status = 'approved');
```

### 2. 관리자 (전체 조회/수정)
```sql
-- 모든 status의 맛집 조회 가능
CREATE POLICY "Admins can view all restaurants"
    ON public.restaurants FOR SELECT
    TO authenticated
    USING (public.has_role(auth.uid(), 'admin'));

-- 관리자만 생성/수정/삭제 가능
CREATE POLICY "Admins can insert/update/delete restaurants"
    ON public.restaurants FOR ALL
    TO authenticated
    USING (public.has_role(auth.uid(), 'admin'));
```

---

## 🛠️ 주요 함수

### 1. 맛집 통계 조회
```sql
SELECT * FROM get_restaurant_stats_by_status();
```

**반환 값:**
- `total_records`: 전체 맛집 수
- `approved_count`: 승인된 맛집 수
- `pending_count`: 대기 중인 맛집 수
- `rejected_count`: 거부된 맛집 수
- `geocoding_success_count`: 지오코딩 성공 수
- `geocoding_failed_count`: 지오코딩 실패 수
- `missing_count`: 누락된 맛집 수
- `not_selected_count`: 미선택 맛집 수
- `geocoding_success_rate`: 지오코딩 성공률 (%)
- `approval_rate`: 승인률 (%)

### 2. 승인된 맛집 조회
```sql
-- 처음 100개 조회
SELECT * FROM get_approved_restaurants(100, 0);

-- 다음 100개 조회 (페이징)
SELECT * FROM get_approved_restaurants(100, 100);
```

### 3. 맛집 승인 처리 (관리자 전용)
```sql
SELECT approve_restaurant(
    '맛집UUID'::UUID,
    '관리자UUID'::UUID
);
```

**동작:**
- `status = 'pending'` → `'approved'`
- `updated_by_admin_id` 기록
- `updated_at` 갱신

### 4. 맛집 거부 처리 (관리자 전용)
```sql
SELECT reject_restaurant(
    '맛집UUID'::UUID,
    '관리자UUID'::UUID,
    '거부 사유입니다'  -- 선택적
);
```

**동작:**
- `status = 'pending'` → `'rejected'`
- `admin_notes`에 거부 사유 저장
- `updated_by_admin_id` 기록

---

## 📈 인덱스 최적화

### 상태별 조회 최적화
```sql
-- 승인된 맛집 조회 (일반 사용자용)
CREATE INDEX idx_restaurants_approved 
    ON restaurants(created_at DESC, review_count DESC) 
    WHERE status = 'approved';

-- 리뷰 있는 승인된 맛집
CREATE INDEX idx_restaurants_approved_with_reviews 
    ON restaurants(review_count DESC, created_at DESC) 
    WHERE status = 'approved' AND review_count > 0;

-- 대기 중인 맛집 (관리자용)
CREATE INDEX idx_restaurants_pending 
    ON restaurants(created_at DESC) 
    WHERE status = 'pending';

-- 거부된 맛집 (관리자용)
CREATE INDEX idx_restaurants_rejected 
    ON restaurants(created_at DESC) 
    WHERE status = 'rejected';
```

---

## 🔍 사용 예시

### 프론트엔드 - 일반 사용자 화면
```typescript
// 승인된 맛집 목록 조회 (RLS로 자동 필터링)
const { data: restaurants } = await supabase
  .from('restaurants')
  .select('*')
  .order('created_at', { ascending: false });

// 또는 함수 사용
const { data: restaurants } = await supabase
  .rpc('get_approved_restaurants', { limit_count: 50, offset_count: 0 });
```

### 프론트엔드 - 관리자 화면
```typescript
// 모든 상태의 맛집 조회 (관리자만 가능)
const { data: allRestaurants } = await supabase
  .from('restaurants')
  .select('*')
  .order('created_at', { ascending: false });

// 대기 중인 맛집만 조회
const { data: pendingRestaurants } = await supabase
  .from('restaurants')
  .select('*')
  .eq('status', 'pending')
  .order('created_at', { ascending: false });

// 맛집 승인
await supabase.rpc('approve_restaurant', {
  restaurant_id: '맛집UUID',
  admin_user_id: '관리자UUID'
});

// 맛집 거부
await supabase.rpc('reject_restaurant', {
  restaurant_id: '맛집UUID',
  admin_user_id: '관리자UUID',
  reject_reason: '주소 정보가 부정확합니다'
});

// 통계 조회
const { data: stats } = await supabase
  .rpc('get_restaurant_stats_by_status');
```

### 백엔드 - AI 크롤링 데이터 삽입
```typescript
// AI 크롤링 결과를 restaurants 테이블에 삽입
const { data, error } = await supabase
  .from('restaurants')
  .insert({
    unique_id: 'youtube_link_hash',
    name: '맛집 이름',
    phone: '02-1234-5678',
    category: ['한식', '고기'],
    status: 'pending',  // 기본값
    youtube_meta: { /* 메타데이터 */ },
    evaluation_results: { /* AI 평가 */ },
    origin_address: { address: '...', lat: 37.123, lng: 127.456 },
    road_address: '서울특별시...',
    geocoding_success: true,
    is_missing: false,
    is_not_selected: false
  });
```

---

## 🚀 마이그레이션 단계

### 1. 백업
```bash
# Supabase 대시보드에서 백업 생성
Settings > Database > Backups > Create Backup
```

### 2. 마이그레이션 실행
```sql
-- Supabase SQL Editor에서 실행
-- 파일: 20251107_complete_migration.sql
```

### 3. Materialized View 갱신
```sql
SELECT refresh_materialized_views();
```

### 4. 통계 확인
```sql
SELECT * FROM get_restaurant_stats_by_status();
```

### 5. RLS 정책 확인
```sql
-- 일반 사용자로 로그인하여 승인된 맛집만 조회되는지 확인
-- 관리자로 로그인하여 모든 맛집이 조회되는지 확인
```

---

## ⚠️ 주의사항

### 1. 기존 데이터 마이그레이션
- 기존 `evaluation_records` 테이블 데이터가 있다면 먼저 백업 필요
- 데이터를 `restaurants` 테이블로 복사 후 검증 필요

### 2. 애플리케이션 코드 수정
- `evaluation_records` 테이블 참조하는 모든 코드를 `restaurants`로 변경
- `status` 필드 조건 추가 필요

### 3. 승인 프로세스
- 새로운 맛집은 기본적으로 `status = 'pending'`
- 관리자가 수동으로 승인/거부 처리 필요
- 승인 시 필수 데이터(lat, lng, category, 주소) 검증됨

### 4. 성능
- 승인된 맛집 조회는 부분 인덱스로 최적화됨
- 대량 데이터 승인 시 Materialized View 갱신 필요

---

## 📊 모니터링

### 승인 대기 현황
```sql
SELECT COUNT(*) as pending_count
FROM restaurants
WHERE status = 'pending';
```

### 승인율 추이
```sql
SELECT 
    DATE(created_at) as date,
    COUNT(*) FILTER (WHERE status = 'approved') as approved,
    COUNT(*) FILTER (WHERE status = 'pending') as pending,
    COUNT(*) FILTER (WHERE status = 'rejected') as rejected
FROM restaurants
WHERE created_at >= NOW() - INTERVAL '30 days'
GROUP BY DATE(created_at)
ORDER BY date DESC;
```

### 지오코딩 실패 분석
```sql
SELECT 
    geocoding_false_stage,
    COUNT(*) as count
FROM restaurants
WHERE geocoding_success = false
GROUP BY geocoding_false_stage;
```

---

## 🔗 관련 문서

- [CHANGELOG.md](./CHANGELOG.md) - 전체 변경사항 상세 내역
- [DB_OPTIMIZATION_GUIDE.md](./DB_OPTIMIZATION_GUIDE.md) - 성능 최적화 가이드
- [DB_STRUCTURE_VALIDATION.md](./DB_STRUCTURE_VALIDATION.md) - 검증 및 테스트 가이드

---

## 🤖 JSONL 크롤링 데이터 삽입

### Python 크롤러에서 데이터 삽입

#### 1. 단일 레코드 삽입
```python
import json
from supabase import create_client, Client

supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)

# JSONL 한 줄 읽기
jsonl_line = '{"youtube_link": "https://...", "name": "대성식품", ...}'
data = json.loads(jsonl_line)

# DB에 삽입
result = supabase.rpc('insert_restaurant_from_jsonl', {
    'jsonl_data': data
}).execute()

print(f"삽입된 맛집 ID: {result.data}")

# source_type 지정 (선택 사항, 기본값: 'perplexity')
data['source_type'] = 'perplexity'  # 또는 'manual', 'user_submission' 등
result = supabase.rpc('insert_restaurant_from_jsonl', {
    'jsonl_data': data
}).execute()
```

#### 2. 배치 삽입 (권장)
```python
import json
from supabase import create_client, Client

supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)

# JSONL 파일 전체 읽기
records = []
with open('tzuyang_restaurant_results.jsonl', 'r', encoding='utf-8') as f:
    for line in f:
        records.append(json.loads(line))

# 배치 삽입 (최대 1000개씩 권장)
batch_size = 100
for i in range(0, len(records), batch_size):
    batch = records[i:i+batch_size]
    
    result = supabase.rpc('batch_insert_restaurants_from_jsonl', {
        'jsonl_array': batch
    }).execute()
    
    stats = result.data[0]
    print(f"배치 {i//batch_size + 1}:")
    print(f"  - 신규 삽입: {stats['inserted_count']}")
    print(f"  - 업데이트: {stats['updated_count']}")
    print(f"  - 실패: {stats['failed_count']}")
    
    if stats['failed_count'] > 0:
        print(f"  - 실패 레코드: {stats['failed_records']}")
```

#### 3. 필드명 매핑 (camelCase → snake_case)

JSONL 데이터의 필드명이 camelCase이지만, 함수가 자동으로 변환해줍니다:

| JSONL 필드        | DB 컬럼            | 자동 변환                |
| ----------------- | ------------------ | ------------------------ |
| `source_type`     | `source_type`      | ✅ (기본값: 'perplexity') |
| `is_notSelected`  | `is_not_selected`  | ✅                        |
| `roadAddress`     | `road_address`     | ✅                        |
| `jibunAddress`    | `jibun_address`    | ✅                        |
| `englishAddress`  | `english_address`  | ✅                        |
| `addressElements` | `address_elements` | ✅                        |

#### 4. UPSERT 동작

`insert_restaurant_from_jsonl()` 함수는 `unique_id` 기준으로 UPSERT를 수행합니다:

- **새 레코드**: 삽입
- **기존 레코드**: 업데이트 (youtube_links 배열에 추가)

```sql
ON CONFLICT (unique_id) 
DO UPDATE SET
    name = EXCLUDED.name,
    phone = EXCLUDED.phone,
    ...
    updated_at = now()
```

### SQL에서 직접 삽입

```sql
-- 단일 삽입
SELECT insert_restaurant_from_jsonl('{
  "youtube_link": "https://www.youtube.com/watch?v=oRWZAJN4ZFQ",
  "status": "pending",
  "name": "대성식품",
  "phone": "063-284-1486",
  "category": "분식",
  "origin_address": {"address": "전북 전주시...", "lat": 35.816, "lng": 127.147},
  "roadAddress": "전북특별자치도 전주시 완산구 팔달로 157-5",
  "geocoding_success": true,
  "is_notSelected": false,
  "unique_id": "4ed18d7d..."
}'::jsonb);

-- 배치 삽입
SELECT * FROM batch_insert_restaurants_from_jsonl(
  ARRAY[
    '{"unique_id": "abc123", "name": "대성식품", ...}'::jsonb,
    '{"unique_id": "def456", "name": "전통춘천닭갈비", ...}'::jsonb
  ]
);
```

### 삽입 후 확인

```sql
-- 최근 삽입된 맛집 확인
SELECT id, name, status, geocoding_success, created_at
FROM restaurants
ORDER BY created_at DESC
LIMIT 10;

-- 대기 중인 맛집 수
SELECT COUNT(*) FROM restaurants WHERE status = 'pending';

-- 지오코딩 실패 확인
SELECT name, geocoding_false_stage, origin_address
FROM restaurants
WHERE geocoding_success = false;
```

---

## 📞 문의

테이블 통합 관련 이슈나 질문이 있으시면 개발팀에 문의해주세요.
