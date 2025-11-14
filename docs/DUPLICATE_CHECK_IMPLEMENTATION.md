# 중복 검사 시스템 구현 완료 ✅

## 구현 내용

### 1. Levenshtein Distance 기반 중복 검사
- **파일**: `src/lib/db-conflict-checker.ts`
- **함수**: `checkRestaurantDuplicate()`
- **로직**:
  1. 지번주소 앞 20자로 같은 지역 필터링 (성능 최적화)
  2. 이름 유사도 85% 이상이면 중복 판정
  3. "프랭크버거 신림" vs "프랭크버거 신림점" → 92% 유사 → 중복

### 2. DB 스키마 추가
- **파일**: `supabase/migrations/20251114_add_duplicate_error_fields.sql`
- **추가 컬럼**:
  - `db_error_message` (TEXT): 사용자에게 표시할 에러 메시지
  - `db_error_details` (JSONB): 중복된 맛집 정보 등 상세 데이터
- **인덱스**: `idx_restaurants_jibun_address_pattern` (성능 향상)

### 3. 타입 정의 업데이트
- **파일**: `src/types/evaluation.ts`
- `EvaluationRecord` 인터페이스에 에러 필드 추가
- `DuplicateCheckResult` 인터페이스 추가

### 4. 승인 로직에 중복 검사 통합

#### EditRestaurantModal (관리자 수정 모달)
- **파일**: `src/components/admin/EditRestaurantModal.tsx`
- 승인 버튼 클릭 시:
  1. 중복 검사 실행
  2. 중복 발견 → status 유지, 에러 메시지 저장
  3. 중복 없음 → status를 'approved'로 변경

#### AdminEvaluationPage (평가 관리 페이지)
- **파일**: `src/pages/AdminEvaluationPage.tsx`
- `handleApprove()` 함수에 중복 검사 추가
- 동일한 로직 적용

### 5. 에러 알림 UI 컴포넌트
- **파일**: `src/components/admin/RestaurantErrorAlert.tsx`
- 기능:
  - 중복 에러 메시지 표시
  - 기존 맛집 정보 (이름, 주소, 유사도) 표시
  - [오류 확인 및 수정] 버튼 → 수정 모드 진입
  - [기존 맛집 보기] 버튼 → 새 탭으로 열기

### 6. EvaluationRowDetails 통합
- **파일**: `src/components/admin/EvaluationRowDetails.tsx`
- 레코드 확장 시 에러 알림을 최상단에 표시
- `onEdit` prop을 통해 수정 모드 진입 가능

## 동작 플로우

### 시나리오 1: 중복 없음 ✅
```
사용자 → [승인] 클릭
         ↓
중복 검사 → 통과
         ↓
status: pending → approved
db_error_message: null
```

### 시나리오 2: 중복 발견 ⚠️
```
사용자 → [승인] 클릭
         ↓
중복 검사 → 실패 (유사도 92%)
         ↓
status: pending (유지)
db_error_message: "프랭크버거 신림점와 92% 유사..."
db_error_details: { conflicting_restaurant: {...} }
         ↓
화면에 에러 알림 표시
```

### 시나리오 3: 에러 해결 후 재승인 🔄
```
관리자 → 에러 확인 → [수정] → 이름 변경
         ↓
다시 [승인] 클릭
         ↓
중복 검사 → 통과
         ↓
status: approved
db_error_message: null (초기화)
```

## 주요 특징

1. **정확한 중복 감지**: 편집 거리 알고리즘으로 오타, 띄어쓰기 차이 감지
2. **성능 최적화**: 지번주소 기반 필터링으로 검색 범위 최소화
3. **투명한 에러 정보**: 어떤 맛집과 중복인지 명확히 표시
4. **Status 유지**: 에러 발생 시에도 기존 워크플로우 유지
5. **재시도 가능**: 수정 후 다시 승인 가능

## 다음 단계

1. ✅ 마이그레이션 실행:
   ```bash
   # Supabase Studio에서 실행
   # supabase/migrations/20251114_add_duplicate_error_fields.sql
   ```

2. ✅ 테스트:
   - 중복 맛집 승인 시도
   - 에러 메시지 확인
   - 수정 후 재승인

3. 🔧 조정 (필요시):
   - 유사도 임계값 조정 (현재 85%)
   - 주소 매칭 길이 조정 (현재 20자)

## 파일 변경 사항

```
✅ src/lib/db-conflict-checker.ts (업데이트)
✅ src/components/admin/EditRestaurantModal.tsx (업데이트)
✅ src/pages/AdminEvaluationPage.tsx (업데이트)
✅ src/types/evaluation.ts (업데이트)
✅ src/components/admin/RestaurantErrorAlert.tsx (신규)
✅ src/components/admin/EvaluationRowDetails.tsx (업데이트)
✅ src/components/admin/EvaluationTableNew.tsx (업데이트)
✅ supabase/migrations/20251114_add_duplicate_error_fields.sql (신규)
```

## 테스트 예시

### Case 1: 정확히 같은 이름
```typescript
"프랭크버거 신림" vs "프랭크버거 신림"
→ 유사도: 100% → 중복
```

### Case 2: 미묘한 차이
```typescript
"프랭크버거 신림" vs "프랭크버거 신림점"
→ 유사도: 92% → 중복
```

### Case 3: 오타
```typescript
"프랭크버거 신림" vs "프랭그버거 신림"
→ 유사도: 87% → 중복
```

### Case 4: 완전히 다른 이름
```typescript
"프랭크버거" vs "맥도날드"
→ 유사도: 20% → 중복 아님
```
