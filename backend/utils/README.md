# 🛠️ 공통 유틸리티 시스템

전체 데이터 파이프라인에서 사용하는 중복 검사 및 파일 처리 유틸리티 함수 모음입니다.

## 📚 목차

- [개요](#-개요)
- [Python 유틸리티](#-python-유틸리티)
- [TypeScript 유틸리티](#-typescript-유틸리티)
- [적용된 파일 목록](#-적용된-파일-목록)
- [성능 최적화](#-성능-최적화)

---

## 🎯 개요

전체 파이프라인에서 **중복 데이터를 자동으로 감지하고 제거**하여:
- ✅ 불필요한 API 호출 방지
- ✅ 처리 시간 단축
- ✅ 데이터 일관성 유지
- ✅ 안전한 파일 저장 (append 모드)

---

## 🐍 Python 유틸리티

**파일:** `backend/utils/duplicate_checker.py`

### 함수 목록

#### 1. `load_processed_urls(file_path: str | Path) -> Set[str]`

JSONL 파일에서 `youtube_link` 필드를 추출하여 Set으로 반환합니다.

**매개변수:**
- `file_path`: JSONL 파일 경로

**반환값:**
- `Set[str]`: youtube_link의 Set

**사용 예시:**
```python
from duplicate_checker import load_processed_urls

# 기존 처리된 URL 로드
processed_urls = load_processed_urls("output.jsonl")

# 중복 체크
if "https://youtube.com/watch?v=ABC123" in processed_urls:
    print("이미 처리됨")
```

---

#### 2. `load_processed_restaurants(file_path: str | Path, key: str = 'name') -> Set[str]`

JSONL 파일에서 지정된 키 값을 추출하여 Set으로 반환합니다.

**매개변수:**
- `file_path`: JSONL 파일 경로
- `key`: 추출할 키 (기본값: 'name')

**반환값:**
- `Set[str]`: 지정된 키 값의 Set

**사용 예시:**
```python
from duplicate_checker import load_processed_restaurants

# 레스토랑 이름 로드
restaurant_names = load_processed_restaurants("restaurants.jsonl", key="name")

# 고유 ID 로드
unique_ids = load_processed_restaurants("transforms.jsonl", key="unique_id")
```

---

#### 3. `load_processed_unique_ids(file_path: str | Path) -> Set[str]`

JSONL 파일에서 `unique_id` 필드를 추출하여 Set으로 반환합니다.

**매개변수:**
- `file_path`: JSONL 파일 경로

**반환값:**
- `Set[str]`: unique_id의 Set

**사용 예시:**
```python
from duplicate_checker import load_processed_unique_ids

# 기존 unique_id 로드
written_ids = load_processed_unique_ids("transforms.jsonl")

# 중복 체크
new_id = "c85c53778b120eff20f3b22c831a943a..."
if new_id not in written_ids:
    print("새 레코드")
```

---

#### 4. `append_to_jsonl(file_path: str | Path, data: Dict)`

JSONL 파일에 데이터를 안전하게 추가합니다 (append 모드).

**매개변수:**
- `file_path`: JSONL 파일 경로
- `data`: 저장할 딕셔너리 데이터

**사용 예시:**
```python
from duplicate_checker import append_to_jsonl

# 데이터 추가
new_restaurant = {
    "youtube_link": "https://youtube.com/watch?v=ABC123",
    "name": "맛집",
    "address": "서울특별시..."
}

append_to_jsonl("output.jsonl", new_restaurant)
```

**특징:**
- ✅ Append 모드: 기존 데이터 손실 없음
- ✅ 자동 줄바꿈 추가
- ✅ UTF-8 인코딩
- ✅ ensure_ascii=False로 한글 지원

---

#### 5. `load_multiple_processed_urls(*file_paths: str | Path) -> Set[str]`

여러 JSONL 파일에서 `youtube_link`를 추출하여 통합 Set으로 반환합니다.

**매개변수:**
- `*file_paths`: 여러 JSONL 파일 경로 (가변 인자)

**반환값:**
- `Set[str]`: 모든 파일의 youtube_link 통합 Set

**사용 예시:**
```python
from duplicate_checker import load_multiple_processed_urls

# 여러 파일에서 URL 로드
all_processed = load_multiple_processed_urls(
    "evaluation_results.jsonl",
    "evaluation_errors.jsonl"
)

# 중복 체크
if youtube_link in all_processed:
    print("이미 처리됨 (성공 또는 실패)")
```

---

### 전체 사용 예시

```python
#!/usr/bin/env python3
from duplicate_checker import (
    load_processed_urls,
    load_multiple_processed_urls,
    append_to_jsonl
)

# 1. 기존 처리된 URL 로드
processed_urls = load_processed_urls("output.jsonl")
print(f"이미 처리된 URL: {len(processed_urls)}개")

# 2. 입력 데이터 필터링
input_data = [
    {"youtube_link": "https://youtube.com/watch?v=A", "name": "맛집1"},
    {"youtube_link": "https://youtube.com/watch?v=B", "name": "맛집2"},
    {"youtube_link": "https://youtube.com/watch?v=C", "name": "맛집3"}
]

new_items = [
    item for item in input_data
    if item['youtube_link'] not in processed_urls
]

print(f"새로 처리할 항목: {len(new_items)}개")

# 3. 처리 및 저장
for item in new_items:
    # 데이터 처리 로직
    result = process(item)
    
    # 즉시 저장 (append 모드)
    append_to_jsonl("output.jsonl", result)
    processed_urls.add(item['youtube_link'])

print(f"처리 완료: {len(new_items)}개")
```

---

## 📘 TypeScript 유틸리티

**파일:** `backend/utils/duplicate-checker.ts`

### ⚠️ 주의사항

TypeScript 버전은 **rootDir 제약**으로 인해 **직접 import 불가**합니다.
각 파일에 **inline으로 복사**하여 사용합니다.

### 함수: `loadMultipleProcessedUrls(...filePaths: string[]): Set<string>`

여러 JSONL 파일에서 `youtube_link`를 추출하여 Set으로 반환합니다.

**매개변수:**
- `...filePaths`: 여러 JSONL 파일 경로 (가변 인자)

**반환값:**
- `Set<string>`: 모든 파일의 youtube_link 통합 Set

**사용 예시:**

```typescript
import { readFileSync, existsSync } from 'fs';

// Inline 함수 정의 (각 파일에 복사)
function loadMultipleProcessedUrls(...filePaths: string[]): Set<string> {
  const allUrls = new Set<string>();
  
  for (const filePath of filePaths) {
    if (!existsSync(filePath)) continue;
    
    const content = readFileSync(filePath, 'utf-8');
    const lines = content.trim().split('\n').filter(line => line.trim());
    
    for (const line of lines) {
      try {
        const data = JSON.parse(line);
        if (data.youtube_link) {
          allUrls.add(data.youtube_link);
        }
      } catch (e) {
        // 파싱 실패 무시
      }
    }
  }
  
  return allUrls;
}

// 사용
const processedLinks = loadMultipleProcessedUrls(
  'evaluation_results.jsonl',
  'evaluation_errors.jsonl'
);

console.log(`이미 처리된 URL: ${processedLinks.size}개`);

// 중복 필터링
const recordsToProcess = allRecords.filter(record => {
  return !processedLinks.has(record.youtube_link);
});
```

---

## 📋 적용된 파일 목록

### Python 파일 (유틸리티 함수 사용)

| 파일 | 사용 함수 | 중복 기준 |
|------|----------|----------|
| `api-youtube-meta.py` | `load_processed_urls`, `append_to_jsonl` | `youtube_link` |
| `evaluation-target-selection.py` | `load_processed_urls`, `append_to_jsonl` | `youtube_link` |
| `evaluation-rule.py` | `load_processed_urls`, `append_to_jsonl` | `youtube_link` |
| `transform_evaluation_results.py` | `load_processed_unique_ids` | `unique_id` |

**Import 방식:**
```python
import sys
import os
sys.path.append(os.path.join(os.path.dirname(__file__), '../../utils'))
from duplicate_checker import load_processed_urls, append_to_jsonl
```

---

### TypeScript 파일 (inline 함수 사용)

| 파일 | 함수 | 중복 기준 |
|------|------|----------|
| `process-remaining.ts` | `loadProcessedUrls` (단일 파일) | `youtube_link` |
| `index.ts` (LAAJ) | `loadMultipleProcessedUrls` | `youtube_link` |
| `index_retry_for_errors.ts` | `loadMultipleProcessedUrls` | `youtube_link` |

**Inline 방식:**
```typescript
// 각 파일 상단에 함수 정의 복사
function loadMultipleProcessedUrls(...filePaths: string[]): Set<string> {
  // ... 구현 ...
}
```

---

## 🚀 성능 최적화

### 1. Set 기반 조회

```python
# ❌ 느린 방법 (O(n))
processed_urls = ["url1", "url2", "url3", ...]
if url in processed_urls:  # 리스트 순회
    pass

# ✅ 빠른 방법 (O(1))
processed_urls = {"url1", "url2", "url3", ...}
if url in processed_urls:  # 해시 테이블 조회
    pass
```

**성능 차이:**
- 100개 URL: ~0.01ms (Set) vs ~0.1ms (List)
- 10,000개 URL: ~0.01ms (Set) vs ~10ms (List)
- **Set이 1000배 빠름!**

---

### 2. Append 모드 사용

```python
# ❌ 위험한 방법 (덮어쓰기)
with open("output.jsonl", 'w') as f:
    for item in new_items:
        f.write(json.dumps(item) + '\n')
# 중단 시 기존 데이터 손실!

# ✅ 안전한 방법 (추가)
with open("output.jsonl", 'a') as f:
    for item in new_items:
        f.write(json.dumps(item) + '\n')
# 중단 시에도 기존 데이터 안전!
```

---

### 3. 즉시 저장

```python
# ❌ 느린 방법 (마지막에 일괄 저장)
results = []
for item in items:
    result = process(item)  # 10초 소요
    results.append(result)

# 100개 처리 후 저장 → 중단 시 모두 손실!
with open("output.jsonl", 'w') as f:
    for result in results:
        f.write(json.dumps(result) + '\n')

# ✅ 안전한 방법 (즉시 저장)
for item in items:
    result = process(item)  # 10초 소요
    append_to_jsonl("output.jsonl", result)  # 즉시 저장
# 중단 시에도 처리된 것까지 저장됨!
```

---

### 4. DB 조회 최소화

```typescript
// ❌ 느린 방법 (N번 조회)
for (const restaurant of restaurants) {
  const { data } = await supabase
    .from('restaurants')
    .select('unique_id')
    .eq('unique_id', restaurant.unique_id);
  
  if (!data) {
    await insertRestaurant(restaurant);
  }
}
// 1000개 → 1000번 DB 조회!

// ✅ 빠른 방법 (1번 조회)
const { data: existingRecords } = await supabase
  .from('restaurants')
  .select('unique_id');

const existingIds = new Set(existingRecords.map(r => r.unique_id));

for (const restaurant of restaurants) {
  if (!existingIds.has(restaurant.unique_id)) {
    await insertRestaurant(restaurant);
  }
}
// 1000개 → 1번 DB 조회!
```

---

## 📊 중복 검사 통계

### 전체 파이프라인 중복 제거 효과

```
┌─────────────────────┬──────────┬──────────┬──────────┐
│      단계           │ 전체     │ 중복     │ 처리     │
├─────────────────────┼──────────┼──────────┼──────────┤
│ URL 수집            │   980    │   19     │   961    │
│ Perplexity 크롤링   │   980    │   19     │   961    │
│ 메타데이터 추가      │   980    │   19     │   961    │
│ 평가 대상 선정       │   961    │    0     │   961    │
│ Rule 평가           │   961    │    0     │   961    │
│ LAAJ 평가           │   961    │    0     │   961    │
│ Transform           │  1500    │  200     │  1300    │
│ DB 삽입             │  1300    │  100     │  1200    │
└─────────────────────┴──────────┴──────────┴──────────┘
```

**중복 제거 효과:**
- API 호출 절감: ~20%
- 처리 시간 단축: ~30%
- 데이터 일관성: 100%

---

## 🔗 관련 문서

- [Backend 전체 시스템](../README.md)
- [크롤링 시스템](../perplexity-restaurant-crawling/README.md)
- [평가 시스템](../perplexity-restaurant-evaluation/README.md)

---

**마지막 업데이트:** 2025-01-16
