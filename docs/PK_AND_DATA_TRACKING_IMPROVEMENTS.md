# PK 및 데이터 추적 개선 사항

## 📋 핵심 요약

**당신의 생각이 100% 정확합니다!**

```
evaluation_records.restaurant_id가 있으면:
  → restaurants 테이블의 기존 레코드 UPDATE
  
evaluation_records.restaurant_id가 없으면:
  → restaurants 테이블에 새로 INSERT
```

## 🎯 해결한 핵심 문제

**문제 시나리오:**
1. 레코드 A를 승인 → restaurants에 등록 (id: "rest-123")
2. 나중에 레코드 A의 "수정" 버튼 클릭 → 이름이나 주소 변경
3. **기존 로직 (문제)**: 승인 클릭 → 새로운 restaurant 생성 (id: "rest-456") ❌
4. **결과**: restaurants에 중복 데이터, 원본("rest-123")은 방치됨

**해결 방법:**
- `record.restaurant_id` 확인
- **있으면**: `restaurants` 테이블 UPDATE (기존 데이터 수정)
- **없으면**: `restaurants` 테이블 INSERT (새 데이터 생성)

## ✅ 구현된 변경사항

### 1. DB 스키마 변경

**새 마이그레이션 파일**: `20251106_add_restaurant_id_to_evaluation_records.sql`

```sql
ALTER TABLE public.evaluation_records
ADD COLUMN IF NOT EXISTS restaurant_id UUID REFERENCES public.restaurants(id) ON DELETE SET NULL;
```

**목적**: 
- 승인된 레코드가 어떤 restaurant로 등록되었는지 추적
- 병합된 경우 병합된 restaurant ID 저장
- 재검수 시 기존 restaurant 확인 가능

### 2. TypeScript 타입 업데이트

**파일**: `src/types/evaluation.ts`

```typescript
export interface EvaluationRecord {
  // ... 기존 필드들
  restaurant_id: string | null; // 새로 추가
  // ...
}
```

### 3. 코드 로직 수정

#### 3.1. 새 음식점 등록 (`insertNewRestaurant`)

**파일**: `src/pages/AdminEvaluationPage.tsx`

```typescript
// restaurants에 삽입 후 ID 받아오기
const { data: newRestaurant, error: insertError } = await supabase
  .from('restaurants')
  .insert({...})
  .select('id')
  .single();

// evaluation_records에 restaurant_id 저장
await supabase
  .from('evaluation_records')
  .update({
    status: 'approved',
    restaurant_id: newRestaurant.id, // ✅ 연결
  })
  .eq('id', record.id);
```

#### 3.2. **🔥 핵심: 수정 시 UPDATE vs INSERT 분기 (`EditRestaurantModal`)**

**파일**: `src/components/admin/EditRestaurantModal.tsx`

```typescript
const handleApprove = async () => {
  // 핵심: restaurant_id가 있는지 확인
  if (record.restaurant_id) {
    // ✅ 이미 승인된 레코드 → restaurants 테이블 UPDATE
    await supabase
      .from('restaurants')
      .update({
        name: trimmedName,
        road_address: geocodingResult.data!.road_address,
        jibun_address: geocodingResult.data!.jibun_address,
        // ... 기타 필드
        updated_at: new Date().toISOString(),
      })
      .eq('id', record.restaurant_id); // ✅ 기존 ID로 UPDATE
    
    // evaluation_records의 restaurant_info도 갱신
    await supabase
      .from('evaluation_records')
      .update({
        restaurant_info: {...}, // 수정된 정보 반영
        updated_at: new Date().toISOString(),
      })
      .eq('id', record.id);
      
  } else {
    // ✅ 아직 승인 안됨 → 새 레스토랑 INSERT
    const { data: newRestaurant } = await supabase
      .from('restaurants')
      .insert({...})
      .select('id')
      .single();
    
    // evaluation_records에 restaurant_id 저장
    await supabase
      .from('evaluation_records')
      .update({
        status: 'approved',
        restaurant_id: newRestaurant.id, // ✅ 새 ID 저장
      })
      .eq('id', record.id);
  }
};
```

#### 3.3. 병합 처리 (`DbConflictResolutionPanel`, `MissingRestaurantForm`)

#### 3.3. 병합 처리 (`DbConflictResolutionPanel`, `MissingRestaurantForm`)

```typescript
// 병합 후 기존 restaurant ID 저장
await supabase
  .from('evaluation_records')
  .update({
    status: 'approved',
    restaurant_id: existingRestaurant.id, // ✅ 병합된 레스토랑 ID
  })
  .eq('id', record.id);
```

## 📊 데이터 플로우

### 시나리오 1: 최초 승인

```
1. evaluation_records (id: "eval-123", restaurant_id: null)
   ↓
2. 승인 버튼 클릭
   ↓
3. restaurants INSERT (새 id: "rest-456" 생성)
   ↓
4. evaluation_records UPDATE:
   - status = 'approved'
   - restaurant_id = "rest-456" ✅
```

### 시나리오 2: 승인 후 수정 (핵심!)

```
1. evaluation_records (id: "eval-123", restaurant_id: "rest-456")
   ↓
2. "수정" 버튼 클릭 → 이름 변경 (예: "맛집A" → "맛집B")
   ↓
3. 승인 버튼 클릭
   ↓
4. record.restaurant_id 체크 → "rest-456" 존재! ✅
   ↓
5. restaurants UPDATE (id: "rest-456"):
   - name = "맛집B"
   - updated_at = now()
   ↓
6. evaluation_records UPDATE (id: "eval-123"):
   - restaurant_info.name = "맛집B"
   - updated_at = now()
   - restaurant_id = "rest-456" (유지)
```

**결과**: 중복 생성 없이 기존 레코드만 수정됨! 🎉

### 시나리오 3: 병합

```
1. DB 충돌 감지 (같은 주소+이름, 다른 영상)
   ↓
2. 관리자 병합 선택
   ↓
3. restaurants(id: "rest-789") UPDATE:
   - youtube_links 배열에 추가
   - youtube_metas 배열에 추가
   ↓
4. evaluation_records UPDATE:
   - status = 'approved'
   - restaurant_id = "rest-789" ✅
```

**현재 로직 유지**:

```typescript
## 🔍 DB 충돌 체크 방식 (변경 없음)

**현재 로직 유지**:

```typescript
// 충돌 1: 같은 주소 + 같은 youtube_link + 다른 이름
// → 진짜 충돌 (DB 충돌)

// 충돌 2: 같은 주소 + 같은 이름 + 다른 youtube_link
// → 병합 필요

// ID는 비교하지 않음
```

**이유**:
- `jibun_address` + `youtube_link` + `name` 조합이 비즈니스 로직상 유니크 판단 기준
- 수정 시에는 `restaurant_id`로 기존 레코드를 UPDATE하므로 충돌 없음

## 🎯 핵심 질문과 답변

### Q1: "이미 승인된 것을 다시 수정했을 때 어디를 수정하나?"

**A: `restaurant_id`가 있으면 `restaurants` 테이블을 UPDATE합니다.**

```typescript
if (record.restaurant_id) {
  // restaurants 테이블의 기존 레코드 UPDATE
  await supabase.from('restaurants').update({...}).eq('id', record.restaurant_id);
} else {
  // restaurants 테이블에 새 레코드 INSERT
  const { data: newRestaurant } = await supabase.from('restaurants').insert({...});
}
```

### Q2: "evaluation-records에서 수정되는 건지 restaurants에서 수정되는 건지?"

**A: 둘 다 수정됩니다 (연동):**

1. **restaurants 테이블**: 실제 데이터 UPDATE (이름, 주소, 좌표 등)
2. **evaluation_records 테이블**: `restaurant_info` 필드 UPDATE (추적/기록용)

```typescript
// 1. restaurants 업데이트
await supabase.from('restaurants').update({
  name: "수정된 이름",
  jibun_address: "수정된 주소",
  // ...
}).eq('id', record.restaurant_id);

// 2. evaluation_records도 업데이트 (동기화)
await supabase.from('evaluation_records').update({
  restaurant_info: {
    name: "수정된 이름",
    // ... 수정된 정보 반영
  },
}).eq('id', record.id);
```

### Q3: "PK가 있어서 evaluation-records와 restaurants를 연결해야 하나?"

**A: 네! `restaurant_id` 외래키로 연결됩니다.**

```sql
ALTER TABLE evaluation_records
ADD COLUMN restaurant_id UUID 
REFERENCES restaurants(id) ON DELETE SET NULL;
```

**목적:**
- ✅ 추적: 어떤 평가가 어떤 음식점이 되었는지 추적
- ✅ 수정: 이미 승인된 레코드 수정 시 기존 restaurant UPDATE
- ✅ 재검수: 중복 승인 방지
- ✅ 통계: 승인률, 병합률 계산
```

**이유**:
- `jibun_address` + `youtube_link` + `name` 조합이 비즈니스 로직상 유니크 판단 기준
- ID는 기술적 PK일 뿐, 실제 중복 여부는 주소/이름/영상으로 판단
- 수정 후 등록 시에는 새로운 ID가 생성되므로 ID 비교는 의미 없음

## 📊 데이터 플로우

### 시나리오 1: 새 음식점 등록 (승인)

```
1. JSONL 파일 로드
   ↓
2. evaluation_records 삽입 (id: "eval-123" 자동생성)
   ↓
3. 관리자 승인
   ↓
4. restaurants 삽입 (id: "rest-456" 자동생성)
   ↓
5. evaluation_records 업데이트:
   - status = 'approved'
   - restaurant_id = "rest-456" ✅
```

### 시나리오 2: 기존 음식점 병합

```
1. DB 충돌 감지 (같은 주소+이름, 다른 영상)
   ↓
2. 관리자 병합 선택
   ↓
3. restaurants(id: "rest-789") 업데이트:
   - youtube_links 배열에 추가
   - youtube_metas 배열에 추가
   ↓
4. evaluation_records 업데이트:
   - status = 'approved'
   - restaurant_id = "rest-789" ✅
```

### 시나리오 3: 수정 후 등록

```
1. 관리자가 데이터 수정 (이름, 주소 등)
   ↓
2. 재지오코딩 실행
   ↓
3. 승인 → restaurants 새 레코드 삽입 (id: "rest-999")
   ↓
4. evaluation_records 업데이트:
   - status = 'approved'
   - restaurant_id = "rest-999" ✅
```

## 🎯 이점

### 1. 추적성 (Traceability)
- 어떤 evaluation_record가 어떤 restaurant가 되었는지 명확히 추적
- 병합 이력 확인 가능

### 2. **중복 방지 (핵심!)**
- 이미 승인된 레코드를 다시 수정 → 기존 restaurant UPDATE (중복 생성 ❌)
- `restaurant_id` 존재 여부로 INSERT/UPDATE 분기

### 3. 재검수 지원
- 이미 승인된 레코드를 다시 확인할 때 restaurant_id로 기존 데이터 조회
- "이 평가는 이미 restaurants(id: xxx)에 등록되어 있습니다" 표시 가능

### 4. 데이터 무결성
- 외래키 제약으로 restaurant 삭제 시 evaluation_records.restaurant_id는 NULL로 설정
- 고아 레코드 방지

### 5. 통계/분석
- 승인률 계산 시 restaurant_id NOT NULL 카운트
- 병합 비율 분석 가능

## ❌ 이전 문제점 (수정 전)

**문제:**
```typescript
// 수정 모달에서 승인 클릭 시 항상 새 restaurant INSERT
const { data: newRestaurant } = await supabase
  .from('restaurants')
  .insert({...}); // ❌ 중복 생성!
```

**결과:**
- 같은 음식점이 restaurants 테이블에 여러 번 등록됨
- 원본 레코드는 방치되고 새 레코드만 계속 생성됨

## ✅ 수정 후 (현재)

**개선:**
```typescript
if (record.restaurant_id) {
  // ✅ 기존 레코드 UPDATE
  await supabase.from('restaurants').update({...}).eq('id', record.restaurant_id);
} else {
  // ✅ 새 레코드 INSERT
  const { data: newRestaurant } = await supabase.from('restaurants').insert({...});
}
```

**결과:**
- 중복 없이 기존 레코드만 수정됨
- 데이터 정합성 유지

## 🚀 다음 단계 (선택사항)

### 1. 마이그레이션 실행

```bash
# Supabase CLI가 설치되어 있다면
supabase db reset

# 또는 Supabase Dashboard에서 SQL Editor로 실행
```

### 2. 재검수 UI 개선 (향후)

```typescript
// evaluation_records 테이블에서 조회 시
if (record.restaurant_id) {
  // 이미 승인된 레코드
  const restaurant = await getRestaurant(record.restaurant_id);
  showWarning(`이미 "${restaurant.name}"으로 등록되어 있습니다.`);
}
```

### 3. 통계 대시보드 (향후)

```sql
-- 승인률
SELECT 
  COUNT(CASE WHEN restaurant_id IS NOT NULL THEN 1 END) as approved,
  COUNT(*) as total
FROM evaluation_records;

-- 병합 비율
SELECT 
  COUNT(DISTINCT restaurant_id) as unique_restaurants,
  COUNT(*) as total_approved_records
FROM evaluation_records
WHERE status = 'approved';
```

## 📝 결론

✅ **evaluation_records.restaurant_id** - 핵심 연결 고리!

- **INSERT/UPDATE 분기점**: `restaurant_id` 존재 여부로 판단
- **중복 방지**: 이미 승인된 레코드는 UPDATE만 수행
- **추적성**: 어떤 평가가 어떤 음식점이 되었는지 명확
- **연동**: evaluation_records ↔ restaurants 양방향 동기화

✅ **수정 로직 (EditRestaurantModal)**:
```typescript
if (record.restaurant_id) {
  // 이미 승인됨 → restaurants UPDATE + evaluation_records.restaurant_info UPDATE
} else {
  // 아직 미승인 → restaurants INSERT + evaluation_records.restaurant_id 저장
}
```

✅ **DB 충돌 체크**: 주소+이름+영상 조합 비교 (ID 비교 불필요)

✅ **사용자 제보**: 동일한 플로우 적용 (evaluation_records → restaurants)

이제 **모든 수정이 기존 레코드를 UPDATE**하며, 중복 생성이 방지됩니다! 🎉
