# Supabase에 레스토랑 데이터 삽입하기

이 가이드는 `tzuyang_restaurant_transforms.jsonl` 파일의 데이터를 Supabase의 `restaurants` 테이블에 삽입하는 방법을 설명합니다.

## 사전 준비

### 1. 환경 변수 설정

프로젝트 루트의 `.env` 파일에 다음 변수가 설정되어 있어야 합니다:

```bash
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=your-anon-key
# 또는
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key  # 선택사항
```

**참고:** Anon Key를 사용하므로 RLS를 수동으로 제어해야 합니다.

### 2. 패키지 설치

```bash
npm install
```

## 실행 방법

### 1단계: Supabase에서 제약 조건 수정

Supabase SQL Editor에서 다음 SQL을 **순서대로** 실행하세요:

#### 1-1. RLS 비활성화
```sql
ALTER TABLE public.restaurants DISABLE ROW LEVEL SECURITY;
```

#### 1-2. 전화번호 제약 조건 제거 (해외 번호 허용)
```sql
ALTER TABLE public.restaurants 
DROP CONSTRAINT IF EXISTS restaurants_phone_check;
```

#### 1-3. 이름 제약 조건 완화 (1자 이상 허용)
```sql
ALTER TABLE public.restaurants 
DROP CONSTRAINT IF EXISTS restaurants_name_check;

ALTER TABLE public.restaurants 
ADD CONSTRAINT restaurants_name_check 
CHECK (length(name) >= 1 AND length(name) <= 100);
```

#### 1-4. (선택) 기존 데이터 삭제
처음 삽입하거나 재삽입하는 경우:
```sql
DELETE FROM public.restaurants;
```

### 2단계: 데이터 삽입

```bash
npx tsx insert_to_supabase.ts
```

### 3단계: RLS 다시 활성화

데이터 삽입 완료 후 Supabase SQL Editor에서:

```sql
ALTER TABLE public.restaurants ENABLE ROW LEVEL SECURITY;
```

## 데이터 매핑

JSONL 파일의 각 레코드는 다음과 같이 변환됩니다:

**기본 정보:**
- `unique_id` → `unique_id`
- `name` → `name` (1자 이상 허용)
- `phone` → `phone` (모든 형식 허용, 해외 번호 포함)
- `category` → `categories` (배열로 변환)
- `status` → `status`
- `source_type` → `source_type`

**유튜브 및 평가:**
- `youtube_meta` → `youtube_meta`
- `evaluation_results` → `evaluation_results`
- `reasoning_basis` → `reasoning_basis`
- `tzuyang_review` → `tzuyang_reviews` (객체 배열로 변환)

**주소 정보:**
- `origin_address` → `origin_address`
- `roadAddress` → `road_address`
- `jibunAddress` → `jibun_address`
- `englishAddress` → `english_address`
- `addressElements` → `address_elements`

**위치 및 상태:**
- `origin_address.lat` → `lat`
- `origin_address.lng` → `lng`
- `geocoding_success` → `geocoding_success`
- `geocoding_false_stage` → `geocoding_false_stage`
- `is_missing` → `is_missing` (JSONL 원본 값 그대로 사용)
- `is_notSelected` → `is_not_selected`

## 주요 변경 사항

1. **전화번호 제약 제거**: 한국 형식뿐만 아니라 해외 전화번호(+61, +90 등)도 허용
2. **이름 길이 완화**: 2자 이상 → 1자 이상으로 변경 (예: "독")
3. **is_missing 원본 유지**: JSONL 파일의 `is_missing` 값을 그대로 사용
4. **description 제거**: 불필요한 필드 제거

## 주의사항

1. **환경 변수**: 프로젝트 루트의 `.env` 파일이 자동으로 로드됩니다.

2. **RLS 제어**: Anon Key를 사용하므로 데이터 삽입 전 RLS를 반드시 비활성화해야 합니다.

3. **제약 조건**: 전화번호 및 이름 제약 조건을 미리 수정해야 합니다.

4. **중복 방지**: `unique_id` 컬럼이 UNIQUE 제약 조건을 가지므로, 중복 데이터는 자동으로 거부됩니다. 재삽입 시 기존 데이터를 먼저 삭제하세요.

5. **Rate Limiting**: 100개 레코드마다 1초씩 대기하여 Supabase API 제한을 방지합니다.

6. **해외 레스토랑**: 터키, 호주, 인도네시아 등 해외 레스토랑도 포함되어 있습니다.

## 실행 결과

스크립트는 다음과 같은 정보를 출력합니다:

```
🚀 데이터 삽입을 시작합니다...

✅ [1/913] 식당이름1 - 성공
✅ [2/913] 식당이름2 - 성공
...

============================================================
📊 데이터 삽입 완료!
============================================================
✅ 성공: 900개
❌ 실패: 13개
============================================================
```

## 문제 해결

### 오류: "Cannot find module '@supabase/supabase-js'"

```bash
npm install @supabase/supabase-js
```

### 오류: "Row Level Security policy violation"

RLS를 비활성화하거나 Service Role Key를 사용하고 있는지 확인하세요.

### 오류: "duplicate key value violates unique constraint"

`unique_id`가 이미 존재하는 레코드입니다. 중복 데이터를 제거하거나 upsert 로직으로 변경하세요.
