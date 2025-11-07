# Transform 통합 및 중복 방지 완료

## 📋 개요

평가 파이프라인에 transform 로직을 통합하고, transform.jsonl 및 데이터베이스 로드 시 중복 방지 기능을 추가했습니다.

## 🔄 작업 흐름

```
1. LAAJ 평가 (index.ts / index_retry_for_errors.ts)
   ↓
2. 평가 결과 저장 (results.jsonl)
   ↓
3. Transform 자동 실행 (transform-utils.ts) ← NEW!
   ↓ (중복 체크: youtube_link|||restaurant_name)
4. Transform 결과 저장 (transform.jsonl)
   ↓
5. 데이터베이스 로드 (load_transform_to_db.py)
   ↓ (중복 체크: DB의 기존 레코드)
6. evaluation_records 테이블
```

## ✅ 변경 사항

### 1. transform-utils.ts (신규 생성)

**위치**: `backend/perplexity-restaurant-evaluation/src/transform-utils.ts`

**기능**:
- `transformAndSaveResults()`: 평가 결과를 transform하여 transform.jsonl에 저장
- `loadExistingKeys()`: 기존 transform.jsonl에서 중복 키 로드
- `extractRestaurantEvaluation()`: 레스토랑별 평가 결과 추출
- `getNaverAddressInfo()`: 네이버 지오코딩 정보 추출

**중복 방지**:
- Key: `${youtube_link}|||${restaurant_name}`
- transform.jsonl에 이미 존재하는 키는 스킵
- 반환값: `{ saved: number, skipped: number }`

**주요 코드**:
```typescript
export function transformAndSaveResults(
  evaluationResult: EvaluationResult,
  transformFile: string = 'transform.jsonl'
): { saved: number; skipped: number } {
  // 기존 키 로드
  const existingKeys = loadExistingKeys(transformFile);
  
  // 레스토랑별 transform
  const records: TransformRecord[] = [];
  
  // ... transform 로직 ...
  
  // 중복 체크 후 저장
  let saved = 0;
  let skipped = 0;
  for (const record of records) {
    const key = `${record.youtube_link}|||${record.restaurant_name}`;
    if (existingKeys.has(key)) {
      skipped++;
      continue;
    }
    appendFileSync(transformFile, JSON.stringify(record) + '\n', 'utf-8');
    saved++;
  }
  
  return { saved, skipped };
}
```

### 2. index.ts (수정)

**위치**: `backend/perplexity-restaurant-evaluation/src/index.ts`

**변경 내용**:
1. Import 추가:
```typescript
import { transformAndSaveResults } from './transform-utils.js';
```

2. 평가 성공 후 transform 호출 (line ~357):
```typescript
const resultLine = JSON.stringify(updatedRecord) + '\n';
appendFileSync(resultFilePath, resultLine, 'utf-8');

// Transform 수행 및 저장 (중복 방지)
try {
  const transformResult = transformAndSaveResults(updatedRecord, 'transform.jsonl');
  console.log(`   🔄 Transform: ${transformResult.saved}개 저장, ${transformResult.skipped}개 중복 스킵`);
} catch (transformError) {
  console.error(`   ⚠️ Transform 실패:`, transformError);
}

console.log(`✅ 레코드 ${idx + 1}/${recordsToProcess.length} 평가 완료 및 저장됨`);
```

### 3. index_retry_for_errors.ts (수정)

**위치**: `backend/perplexity-restaurant-evaluation/src/index_retry_for_errors.ts`

**변경 내용**:
1. Import 추가:
```typescript
import { transformAndSaveResults } from './transform-utils.js';
```

2. 재평가 성공 후 transform 호출 (line ~333):
```typescript
const resultLine = JSON.stringify(resultRecord) + '\n';
appendFileSync(outputFilePath, resultLine, 'utf-8');

// Transform 수행 및 저장 (중복 방지)
try {
  const transformResult = transformAndSaveResults(resultRecord, 'transform.jsonl');
  console.log(`   🔄 Transform: ${transformResult.saved}개 저장, ${transformResult.skipped}개 중복 스킵`);
} catch (transformError) {
  console.error(`   ⚠️ Transform 실패:`, transformError);
}

successCount++;
successfulYoutubeLinks.add(youtubeLink);
console.log(`✅ 레코드 ${recordIndex + 1} 재평가 성공 및 저장됨`);
```

### 4. load_transform_to_db.py (수정)

**위치**: `backend/perplexity-restaurant-evaluation/src/load_transform_to_db.py`

**변경 내용**:

1. 기존 데이터 로드 및 중복 키 생성:
```python
# 기존 데이터의 (youtube_link, restaurant_name) 조합을 가져와서 중복 체크용 Set 생성
print(f"\n🔍 기존 데이터 확인 중...")
try:
    existing_result = supabase.table('evaluation_records').select('youtube_link, restaurant_name').execute()
    existing_keys = {f"{r['youtube_link']}|||{r['restaurant_name']}" for r in existing_result.data}
    print(f"✅ 기존 데이터: {len(existing_keys)}개 레코드")
except Exception as e:
    print(f"⚠️ 기존 데이터 조회 실패, 중복 체크 없이 진행: {e}")
    existing_keys = set()
```

2. 중복 체크 및 필터링:
```python
# 중복 체크
key = f"{record['youtube_link']}|||{record['restaurant_name']}"
if key in existing_keys:
    skipped_count += 1
    continue
```

3. 통계 출력 개선:
```python
print(f"\n✅ 데이터 로드 완료!")
print(f"   - 읽은 레코드: {len(records) + skipped_count}개")
print(f"   - 중복 스킵: {skipped_count}개")
print(f"   - 삽입 시도: {len(records)}개")
print(f"   - 삽입 성공: {total_inserted}개")
print(f"   - 삽입 실패: {len(records) - total_inserted}개")
```

4. **제거된 기능**: 기존 데이터 전체 삭제 옵션
   - 이제 항상 중복 체크하여 새로운 레코드만 삽입
   - 기존 데이터는 유지

## 📊 사용 예시

### 1. 평가 실행 (자동 transform 포함)

```bash
# 메인 평가
cd backend/perplexity-restaurant-evaluation
npm run start

# 출력 예시:
# ✅ 레코드 1/10 평가 완료 및 저장됨
#    🔄 Transform: 3개 저장, 0개 중복 스킵
```

```bash
# 에러 재평가
npm run retry

# 출력 예시:
# ✅ 레코드 1 재평가 성공 및 저장됨
#    🔄 Transform: 2개 저장, 1개 중복 스킵
```

### 2. 데이터베이스 로드

```bash
python src/load_transform_to_db.py transform.jsonl

# 출력 예시:
# 🔍 기존 데이터 확인 중...
# ✅ 기존 데이터: 1500개 레코드
# 📊 총 100개 레코드 읽기 완료
#    - 삽입할 레코드: 20개
#    - 중복으로 스킵: 80개
# 
# ✅ 데이터 로드 완료!
#    - 읽은 레코드: 100개
#    - 중복 스킵: 80개
#    - 삽입 시도: 20개
#    - 삽입 성공: 20개
#    - 삽입 실패: 0개
```

## 🔑 중복 방지 전략

### 파일 레벨 (transform.jsonl)
- **키**: `${youtube_link}|||${restaurant_name}`
- **방법**: transform 전에 기존 transform.jsonl 읽어서 Set으로 저장
- **장점**: 빠른 중복 체크, 파일 크기 최소화

### 데이터베이스 레벨 (evaluation_records)
- **키**: `(youtube_link, restaurant_name)` 조합
- **방법**: 로드 전에 DB에서 기존 키 조회하여 Set으로 저장
- **장점**: 데이터베이스 무결성 보장, 중복 INSERT 방지

## 🎯 이점

1. **자동화**: 평가 후 수동으로 transform 스크립트 실행할 필요 없음
2. **실시간 처리**: 각 평가 결과가 나올 때마다 즉시 transform
3. **중복 방지**: 
   - transform.jsonl에 같은 레코드 중복 저장 방지
   - 데이터베이스에 중복 INSERT 방지
4. **성능**: Set 자료구조로 O(1) 중복 체크
5. **로깅**: 각 단계에서 saved/skipped 개수 출력으로 투명성 확보

## 📁 파일 구조

```
backend/perplexity-restaurant-evaluation/
├── src/
│   ├── index.ts                      # 메인 평가 (✅ transform 통합)
│   ├── index_retry_for_errors.ts    # 에러 재평가 (✅ transform 통합)
│   ├── transform-utils.ts           # Transform 유틸 (✅ 신규)
│   ├── load_transform_to_db.py      # DB 로드 (✅ 중복 방지 추가)
│   └── ...
├── transform.jsonl                  # Transform 결과 (중복 없음)
├── tzuyang_restaurant_evaluation_results.jsonl  # 평가 결과
└── TRANSFORM_INTEGRATION.md         # 이 문서
```

## 🧪 테스트 방법

1. **Transform 중복 방지 테스트**:
```bash
# 동일한 평가 결과 2번 실행
npm run start  # 첫 실행: saved=N, skipped=0
npm run start  # 두 번째: saved=0, skipped=N
```

2. **DB 로드 중복 방지 테스트**:
```bash
# 동일한 transform.jsonl 2번 로드
python src/load_transform_to_db.py  # 첫 로드: 삽입=N, 스킵=0
python src/load_transform_to_db.py  # 두 번째: 삽입=0, 스킵=N
```

## ⚠️ 주의사항

1. **transform.jsonl 위치**: 
   - 기본값: `backend/perplexity-restaurant-evaluation/transform.jsonl`
   - 필요시 경로 수정 가능

2. **중복 키 기준**:
   - `youtube_link`와 `restaurant_name` 조합
   - 둘 중 하나라도 다르면 별도 레코드로 취급

3. **에러 처리**:
   - Transform 실패해도 평가 결과는 정상 저장됨
   - 에러 로그 출력되며 계속 진행

4. **기존 데이터**:
   - load_transform_to_db.py는 더 이상 기존 데이터 삭제 안 함
   - 항상 추가(append) 방식으로 동작
   - 처음부터 다시 로드하려면 수동으로 테이블 비우기

## 📝 변경 이력

- 2025-01-XX: Transform 자동화 및 중복 방지 기능 추가
  - transform-utils.ts 생성
  - index.ts transform 통합
  - index_retry_for_errors.ts transform 통합
  - load_transform_to_db.py 중복 방지 추가
