# 쯔둥 (Tzudong)

쯔양의 맛집 정보를 기반으로 한 레스토랑 검색 및 관리 플랫폼

## 🎯 주요 기능

### 사용자 기능

- 🗺️ **지도 기반 맛집 검색**: Google Maps 또는 Naver Maps 통합
- 🔍 **스마트 검색 시스템**
  - **이중 검색 엔진**: 맛집 이름 + YouTube 영상 제목 동시 검색
  - **Fuzzy Search (퍼지 검색)**: Trigram 유사도 기반 지능형 검색
    - PostgreSQL의 **pg_trgm** + **word_similarity** 사용
    - 오타나 부분 일치도 검색 가능
  - **품질 필터링**: `status='approved'` 승인된 맛집만 표시
  - **중복 제거**: 같은 음식점명 자동 중복 제거
  - **엄격한 매칭**: 검색어와 한 글자도 겹치지 않으면 제외
- 🏷️ **다양한 필터링**: 지역, 카테고리, 리뷰 수 기반 검색
- 📺 **YouTube 영상 연동**: 쯔양의 방문 영상 바로 보기
- ⭐ **리뷰 시스템**: 사용자 리뷰 작성 및 관리
- 📱 **반응형 디자인**: 모바일/데스크톱 최적화
- 🎯 **맛집 제보**: 새로운 맛집 정보 제보 및 수정 요청

### 관리자 기능

- ✅ **데이터 검수 시스템**
  - YouTube 영상에서 추출한 레스토랑 정보 검토 및 승인
  - 7가지 평가 지표 기반 품질 관리
  - 무한 스크롤 방식의 효율적인 데이터 로딩 (50개씩)
  - Soft Delete 방식의 삭제 기능
  - 영상 제목 검색 기능 (필터링된 결과 내 검색)
  - DB 충돌 감지 및 자동 병합
- 📝 **맛집 직접 수정**
  - 관리자 모달에서 restaurants 테이블 직접 편집
  - **필수 재지오코딩**: 수정 시 Naver Geocoding API로 주소 재검증
  - **듀얼 쿼리 전략**: 이름+전체주소, 이름+시군구 두 가지 방식으로 검색
  - **다중 후보 선택**: 최대 6개 주소 후보 중 사용자 선택
  - 모든 주소 필드 자동 업데이트 (도로명/지번/영문주소, 주소요소, 좌표)
- 🔍 **리뷰 관리**: 사용자 리뷰 승인/거부 시스템
- 📋 **제보 관리**: 맛집 제보 및 수정 요청 검토 (JSONB 배열 기반)

## 📋 관리자 데이터 검수 (Admin Evaluation Management)

새로 추가된 **관리자 데이터 검수** 기능은 사이드바에서 접근 가능하며, YouTube 영상에서 자동 추출한 레스토랑 정보를 검토하고 승인하는 워크플로우를 제공합니다.

### 7가지 평가 지표

| 항목                                         | 설명                           | 평가 범위         |
| -------------------------------------------- | ------------------------------ | ----------------- |
| **1️⃣ 방문 여부 정확성** (Visit Authenticity)  | 실제 방문 여부 및 정확도       | 0-4점             |
| **2️⃣ 추론 합리성** (Reasoning Quality)        | 추론 과정의 논리성             | 0-2점             |
| **3️⃣ 실제 근거 일치도** (Grounding Accuracy)  | 영상 내용과 추출 정보의 일치도 | True/False        |
| **4️⃣ 리뷰 충실도** (Review Faithfulness)      | 음식 리뷰의 정확성             | 0-1점             |
| **5️⃣ 주소 정합성** (Location Match)           | 주소 정보의 정확성             | True/False/Failed |
| **6️⃣ 카테고리 유효성** (Category Validity)    | 카테고리 파싱 성공 여부        | True/False        |
| **7️⃣ 카테고리 정합성** (Category Consistency) | 카테고리 분류의 적절성         | True/False        |

### 주요 기능

#### 📊 평가 테이블

- **무한 스크롤**:
  - 초기 50개 레코드 로드 후 스크롤 시 자동으로 추가 로딩
  - 필터링된 결과에 대해서도 동일하게 작동
  - 로딩 상태 표시 및 완료 메시지
- **상단 카테고리 탭**:
  - `전체` / `삭제`: 클릭하여 필터링 전환
  - 통계 표시: 미처리, 승인됨, 보류, Missing, DB충돌, 지오코딩실패, 평가 미대상 (클릭 불가)
  - **지오코딩 실패**: pending 또는 평가 미대상 상태에서 지오코딩이 실패한 모든 레코드 포함
- **영상 제목 검색**:
  - **Fuzzy Search (퍼지 검색)** 기반 지능형 검색
  - PostgreSQL의 **pg_trgm** (Trigram) + **word_similarity** 사용
  - 오타가 있어도 유사한 제목 찾기 가능
    - 예: "밥도독" 검색 → "[HD]밥도둑 정찬..." 매칭 ✅
  - **검색 알고리즘**:
    1. `word_similarity()`: 검색어가 제목의 일부와 얼마나 비슷한지 (부분 매칭)
    2. `similarity()`: 전체 문자열 유사도
    3. 제목 길이: 짧은 제목 우선
  - **디바운스 처리**: 300ms 대기 후 검색 (타이핑 중 과도한 요청 방지)
  - 필터링된 결과 내에서 검색 수행
  - 실시간 검색 결과 표시
- **필터 리셋 버튼**: 왼쪽 상단에 위치하여 모든 필터를 한 번에 초기화
- **필터 활성화 표시**: 필터가 적용된 컬럼의 메뉴 버튼은 초록색 배경으로 표시
- **고정 컬럼**:
  - 왼쪽: 필터 리셋 버튼, 영상 정보 (YouTube 썸네일 클릭 가능)
  - 오른쪽: 상태 관리 및 액션 버튼 (삭제 필터 시 드롭다운 숨김)
- **인라인 필터링**: 각 컬럼 헤더에서 직접 필터 적용
- **시각적 표시**:
  - True: 🟢 녹색 배지
  - False: 🔴 빨간색 배지
  - Failed: 🟡 노란색 배지

#### 🔄 상태 관리

- `pending`: 검토 대기
- `approved`: 승인됨
- `hold`: 보류
- `missing`: 정보 누락
- `db_conflict`: DB 충돌
- `geocoding_failed`: 지오코딩 실패 (명시적 실패 상태)
- `not_selected`: 평가 미대상 (주소 정보 없음)
- `deleted`: 삭제됨 (Soft Delete)

> 💡 **지오코딩 실패 통계**: `geocoding_failed` 상태 + `pending` 상태에서 지오코딩 실패 + `not_selected` 상태에서 지오코딩 실패를 모두 포함하여 집계

#### ⚡ 액션 및 내부 로직

- **승인 (Approve)**:
  - ✅ 지오코딩 성공 여부 자동 체크
  - ✅ 지번주소로 기존 음식점 검색
  - ✅ **DB 충돌 감지**:
    - Type 1 (name_mismatch): 같은 주소 + 같은 youtube_link + 다른 음식점명 → `db_conflict` 상태로 변경 및 경고
    - Type 2 (merge_needed): 같은 주소 + 같은 음식점명 + 다른 youtube_link → YouTube 링크, 리뷰 자동 병합
  - ✅ **신규 등록**: 새 음식점 자동 등록 및 `approved` 상태 업데이트
  - ⚠️ Missing 음식점은 승인 불가 (수동 등록 필요)
- **수정 (Edit)**:
  - 레스토랑 정보 수정 모달 열기
  - 음식점명, 주소, 카테고리 등 편집 가능
- **삭제 (Delete)**:
  - **Soft Delete 방식**: status를 'deleted'로 변경, deleted_at 타임스탬프 기록
  - DB에서 물리적 삭제하지 않음 (중복 체크 유지)
  - 확인 다이얼로그 표시
  - 삭제된 레코드는 jsonl 재로드 시 건너뜀
- **수동 등록**: Missing 레스토랑 정보를 수동으로 입력하여 등록
- **삭제 탭**:
  - 삭제된 레코드만 필터링하여 표시
  - 상태 컬럼 드롭다운 자동 숨김
  - 검색 기능 동시 사용 가능

> 💡 **Optimistic Locking**: 동시 수정 방지를 위해 `updated_at` 기반 낙관적 잠금 적용
>
> 💡 **Soft Delete**: 삭제된 레코드는 DB에 유지되어 중복 체크 및 데이터 감사 추적 가능

### 사용 방법

1. **사이드바**에서 "관리자 데이터 검수" 클릭
2. **상단 카테고리 탭**:
   - `전체`: 삭제 제외한 모든 레코드 표시 (기본)
   - `삭제`: 삭제된 레코드만 표시 (상태 드롭다운 자동 숨김)
   - 통계: 미처리, 승인됨, 보류 등 (클릭 불가, 참고용)
3. **무한 스크롤**:
   - 초기 50개 레코드가 로드됨
   - 아래로 스크롤하면 자동으로 다음 50개 로드
   - "모든 레코드를 불러왔습니다 (n개 / 전체 m개)" 메시지로 완료 확인
4. **영상 제목 검색**:
   - 검색창에 YouTube 영상 제목 입력하여 필터링
   - 필터링된 결과 내에서 검색됨
5. **컬럼 필터**: 각 컬럼 헤더의 메뉴 버튼(≡)으로 조건 설정
   - 필터 적용된 컬럼은 초록색 배경으로 표시됨
6. **필터 초기화**: 왼쪽 상단 새로고침 아이콘(↻) 버튼으로 모든 필터 리셋
7. **상세 보기**: 행 왼쪽 확장 버튼(▼) 클릭
8. **검토**: 7가지 평가 지표 확인 및 YouTube 영상 클릭하여 검증
9. **액션 실행**:
   - **승인**: 지오코딩 성공 + 유효한 주소 → 자동 처리 (병합/충돌감지/신규등록)
   - **수정**: 레스토랑 정보 편집 모달 열기
   - **삭제**: Soft Delete (status='deleted', 중복 체크 유지)
   - **수동 등록**: Missing 음식점 정보 직접 입력

### 데이터 소스

평가 데이터는 `backend/perplexity-restaurant-evaluation/`에서 수집 및 처리됩니다:

- YouTube 영상 URL 목록
- Perplexity AI 기반 정보 추출
- 네이버 지오코딩 API 주소 검증

## 🔍 고급 맛집 검색 우선순위 시스템

### 검색 알고리즘

쯔둥의 맛집 검색은 **완전 포함 → 단어 매칭 → Trigram 유사도 → 레벤슈타인 거리** 4단계 우선순위 시스템을 사용합니다. **맛집 이름과 YouTube 제목 모두 동일한 알고리즘**을 적용합니다.

#### 🎯 검색 우선순위

1. **완전 포함** (Complete Match) - 🥇 최우선
   - 검색어가 맛집명에 **그대로 포함**되는 경우
   - 예: "솔밭" 검색 → "솔밭 식당" ✅ (complete_match_score = 1)

2. **단어 매칭** (Word Match) - 🥈 2순위
   - 검색어를 **띄어쓰기 기준**으로 단어 분리
   - 분리된 단어가 맛집명에 **얼마나 포함**되는지 계산
   - 최소 **1/3 이상** 단어가 매칭되어야 함 (threshold: 0.33)
   - 예: "솔밭 식당" 검색 → "솔밭 한정식 본점" (2/2 = 100% 매칭) ✅

3. **Trigram 유사도** (Trigram Similarity) - 🥉 3순위
   - **띄어쓰기 제거** 후 Trigram 기반 유사도 계산
   - PostgreSQL의 `pg_trgm` 확장 사용
   - 0~1 사이의 값 (높을수록 유사)
   - 예: "솔밧식당" vs "솔밭식당" → 높은 유사도 (오타 허용) ✅

4. **레벤슈타인 거리** (Levenshtein Distance) - 4순위
   - **편집 거리** 기반 유사도 (몇 글자를 바꿔야 같아지는지)
   - 작을수록 유사함
   - 예: "솔밧" vs "솔밭" → 거리 1 (한 글자만 다름) ✅

5. **이름 길이** - 최종 순위
   - 같은 우선순위일 때 **짧은 이름**을 우선
   - 예: "솔밭" vs "솔밭식당본점" → "솔밭" 우선 ✅

#### 🚫 필수 필터링 조건

- **최소 1글자 이상 포함 필수**: 검색어의 글자가 하나라도 맞지 않으면 결과에서 제외
- 예: "솔밭" 검색 → "치킨집" ❌ (완전히 무관)

#### 📝 검색 예시

```
검색어: "솔밭 식당"

1순위 (완전 포함):
- "솔밭 식당" (검색어가 그대로 포함) → 🥇

2순위 (단어 매칭):
- "솔밭 한정식" (2/2 단어 = 100% 매칭) → 🥈
- "식당 솔밭 본점" (2/2 단어 = 100% 매칭) → �

3순위 (Trigram 유사도):
- "솔밧식당" (띄어쓰기 제거 후 유사도 높음) → 🥉

4순위 (레벤슈타인 거리):
- "솔방식당" (편집 거리 1-2) → 4위

❌ 필터링되는 경우:
- "치킨집" (한 글자도 안 겹침) ❌
- "Food House" (한 글자도 안 겹침) ❌
```

#### 🔧 기술 구현

**파일 위치**: `/src/components/search/RestaurantSearch.tsx`

```typescript
// 1. 맛집 이름 검색 (RPC 함수)
const { data: nameResults } = await supabase
  .rpc("search_restaurants_by_name", {
    search_query: searchQuery,
    search_categories: categories,  // 카테고리 필터 (선택)
    max_results: 50,
    include_all_status: false,      // approved만 표시
    korean_only: true,              // 한국 지역만 (홈페이지용)
  });

// 2. YouTube 제목 검색 (RPC 함수 - 동일한 알고리즘)
const { data: youtubeResults } = await supabase
  .rpc("search_restaurants_by_youtube_title", {
    search_query: searchQuery,
    max_results: 50,
    include_all_status: false,      // approved만 표시
    korean_only: true,              // 한국 지역만 (홈페이지용)
  });

// 3. 결과 병합 및 중복 제거 (음식점명 기준)
```

**데이터베이스 함수**:

- `/supabase/migrations/20251117_advanced_restaurant_search.sql`
  - `calculate_word_match_score()`: 단어 매칭 점수 계산
  - `search_restaurants_by_name(query, categories, max_results, include_all_status, korean_only)`: 맛집 이름 검색
  - `search_restaurants_by_youtube_title(query, max_results, include_all_status, korean_only)`: YouTube 제목 검색

**주요 기능**:

- ✅ **완전 포함 우선**: 검색어가 그대로 들어있으면 최우선
- ✅ **단어 단위 매칭**: 띄어쓰기 기준으로 단어를 분리하여 매칭
- ✅ **오타 허용**: Trigram + 레벤슈타인으로 유사한 이름 찾기
- ✅ **카테고리 필터**: 맛집 이름 검색 시 카테고리 필터 지원
- ✅ **지역 필터**: `korean_only=true` 시 한국 17개 시/도만 검색 (DB 레벨)
- ✅ **품질 관리**: `include_all_status=false` 시 승인된 맛집만 표시
- ✅ **최소 1글자 매칭**: 완전히 무관한 결과 차단

**검색 알고리즘 비교**:

| 항목              | 이전 방식 (v1)             | 현재 방식 (v2)                           |
| ----------------- | -------------------------- | ---------------------------------------- |
| 우선순위          | 토큰 → similarity → 길이   | 완전 포함 → 단어 매칭 → Trigram → 편집 거리 |
| 단어 매칭         | 토큰(글자) 단위            | 띄어쓰기 기준 단어 단위                  |
| 지역 필터         | ❌                          | ✅ (DB 레벨, 한국 17개 시/도)            |
| 최소 매칭 조건    | 1글자 이상                 | 1글자 이상 (동일)                        |
| 오타 허용         | ✅                          | ✅ (Trigram + 레벤슈타인)                 |
| 순서 무관 매칭    | 제한적                     | ✅ (단어 단위)                            |
| 카테고리 필터     | ❌                          | ✅                                        |

## 🎨 주요 페이지 및 검색 로직

### 쯔동여지도 홈/글로벌 (Home/Global Map)

**페이지 기능**:
- 🗺️ 지도 기반 맛집 탐색
- 🏷️ 지역/카테고리 필터링 (road_address, jibun_address 기반)
- 📍 맛집 상세 정보 패널
  - 도로명 주소 및 지번 주소 표시
  - YouTube 영상 목록 (썸네일)
  - 쯔양 리뷰 목록
  - 카테고리 배지
- 🖱️ 마커 클릭 시 상세 정보 표시

**검색 로직** (`RestaurantSearch.tsx`):
- **이중 검색 엔진**:
  - 맛집 이름 검색: `search_restaurants_by_name()` RPC 함수
  - YouTube 제목 검색: `search_restaurants_by_youtube_title()` RPC 함수
- **카테고리 필터 통합**: 선택된 카테고리를 맛집 이름 검색에 전달
- **지역 필터링**: 
  - **홈페이지** (`isKoreanOnly=true`): DB 레벨에서 한국 지역만 필터링
    - 17개 시/도 정규표현식 매칭 (서울특별시, 부산광역시, ...)
    - `korean_only: true` 파라미터로 SQL에서 직접 필터링
  - **글로벌** (`isKoreanOnly=false`): 전 세계 지역 표시
    - 선택된 국가(`selectedRegion`)로 클라이언트 필터링
- **최대 50개 결과** 반환
- **실시간 검색**: 타이핑 즉시 검색 실행

```typescript
// 맛집 이름 검색 (홈페이지)
const { data } = await supabase.rpc("search_restaurants_by_name", {
  search_query: trimmedQuery,
  search_categories: categoriesToSearch,  // 카테고리 필터
  max_results: 50,
  include_all_status: false,  // approved만
  korean_only: true,  // 한국 지역만 (DB 레벨 필터링)
});

// YouTube 제목 검색 (홈페이지)
const { data } = await supabase.rpc("search_restaurants_by_youtube_title", {
  search_query: trimmedQuery,
  max_results: 50,
  include_all_status: false,  // approved만
  korean_only: true,  // 한국 지역만 (DB 레벨 필터링)
});

// 글로벌 페이지: 선택된 국가로 클라이언트 필터링
if (!isKoreanOnly && selectedRegion) {
  results = results.filter(restaurant => 
    address.includes(selectedRegion)
  );
}
```

### 쯔동여지도 필터링 (Filtering Page)

**페이지 기능**:
- 📋 테이블 형식 맛집 목록
- 🔍 다중 필터 적용:
  - 검색어 (맛집명)
  - 지역 필터 (시/도 단위)
  - 카테고리 필터 (복수 선택)
  - 리뷰 수 필터 (슬라이더)
- 📊 정렬 기능 (이름, 카테고리, 리뷰 수)
- 📝 우측 패널: 선택한 맛집의 리뷰 목록

**검색 로직** (`FilteringPage.tsx`):
- **맛집 이름 검색만 사용**: `search_restaurants_by_name()` RPC 함수
- **카테고리 필터 없음**: `search_categories: null` (검색 후 클라이언트 필터링)
- **최대 100개 결과** 반환 (필터링 페이지이므로 더 많은 결과)
- **검색어 있을 때만 실행**: `enabled: !!searchQuery.trim()`

```typescript
// 맛집 이름 검색
const { data: restaurants } = await supabase.rpc('search_restaurants_by_name', {
  search_query: searchQuery.trim(),
  search_categories: null,  // 카테고리 필터 사용 안 함
  max_results: 100,
  include_all_status: false,  // approved만
  korean_only: false,  // 전체 지역 (글로벌 포함)
});

// 검색어가 없으면 전체 맛집 목록 표시
// 검색어가 있으면 검색 결과 표시
const sourceData = searchQuery.trim() ? searchResults : allRestaurants;
```

### 관리자 데이터 검수 (Admin Evaluation Page)

**페이지 기능**:
- ✅ YouTube 영상에서 추출한 레스토랑 정보 검토 및 승인
- 📊 7가지 평가 지표 기반 품질 관리
- ♾️ 무한 스크롤 방식의 효율적인 데이터 로딩 (50개씩)
- 🗑️ Soft Delete 방식의 삭제 기능
- 🔍 영상 제목 검색 기능 (필터링된 결과 내 검색)
- 🔄 DB 충돌 감지 및 자동 병합
- 🎯 상태별 필터링 (pending, approved, hold, missing, db_conflict, etc.)

**검색 로직** (`AdminEvaluationPage.tsx`):
- **YouTube 제목 검색만 사용**: `search_restaurants_by_youtube_title()` RPC 함수
- **전체 상태 조회**: `include_all_status: true` (관리자용)
- **최대 100개 결과** 반환
- **필수 컬럼만 조회**: 22개 컬럼 (성능 최적화)
  - 기본 정보: id, name, 주소, 전화번호, 카테고리, 좌표, 상태
  - YouTube 정보: youtube_link, youtube_meta (title 포함)
  - 평가 정보: origin_address, address_elements, reasoning_basis, evaluation_results
  - 검색 점수: complete_match_score, word_match_score, trigram_similarity, levenshtein_distance
- **Fuzzy Search (퍼지 검색)**: Trigram 유사도 기반 (오타 허용)
- **디바운스 처리**: 300ms 대기 후 검색 (타이핑 중 과도한 요청 방지)
- **필터링된 결과 내 검색**: 현재 적용된 필터(상태, 평가 지표)를 유지하면서 검색

```typescript
// YouTube 제목 검색 (관리자용 - 전체 상태 조회)
const { data } = await supabase.rpc('search_restaurants_by_youtube_title', {
  search_query: searchQuery.trim(),
  max_results: 100,
  include_all_status: true,  // 관리자는 모든 상태의 레코드 조회 가능
  korean_only: false,  // 전체 지역 (글로벌 포함)
});

// 검색 결과를 EvaluationRecord 형식으로 변환
const convertedData = (data || []).map(r => ({
  id: r.id,
  youtube_title: r.youtube_title,
  youtube_link: r.youtube_link,
  // ... 기타 필드
}));
```

**검색 특징**:
- ✅ **오타 허용**: "밥도독" → "[HD]밥도둑 정찬..." 매칭
- ✅ **부분 매칭**: 제목의 일부만 검색해도 찾기 가능
- ✅ **실시간 검색**: 디바운스 후 자동 검색
- ✅ **필터 유지**: 검색 시 현재 적용된 상태/평가 필터 유지

### 쯔동여지도 도장 (Stamp Page)

**페이지 기능**:
- 📺 YouTube 영상이 있는 맛집 그리드 표시
- 🖼️ 썸네일 기반 시각적 탐색
- ⭐ 리뷰 수 표시

**검색 로직**: 
- 검색 기능 없음 (전체 맛집 그리드 표시)

### 쯔동여지도 제보 (Submission Page)

**페이지 기능**:
- 📝 **신규 맛집 제보**:
  - 맛집명, 주소(도로명), 전화번호
  - 카테고리 선택 (복수 가능, 배열로 저장)
  - YouTube 영상 링크
  - 설명 (선택)
  - 모든 주소는 **도로명 주소**로 저장
- ✏️ **맛집 수정 요청**:
  - 기존 맛집 선택 (드롭다운)
  - 변경사항 자동 감지 및 표시
  - 수정된 정보 제출
- 📋 내 제보 내역 조회 (무한 스크롤)
- 🏷️ 상태별 표시 (대기/승인/거부)

**검색 로직**:
- 검색 기능 없음 (제보 및 내역 조회 페이지)

### 관리자 페이지 (리뷰 승인, 제보 관리)

**페이지 기능**:
- ✅ **리뷰 승인**: 사용자 리뷰 검토 및 승인/거부
  - 승인 시 `review_count` 자동 증가
  - 거부 시 `review_count` 자동 감소
- 📋 **제보 관리**: 맛집 제보 및 수정 요청 처리
  - 신규 제보: `road_address`에 주소 저장, `youtube_links` 배열로 저장
  - **중복 방지**: 이름 + 도로명 주소 조합으로 자동 체크
  - 중복 발견 시 에러 메시지 표시

**검색 로직**:
- 간단한 클라이언트 필터링 (이름, 사용자명 등)

---

## 📊 검색 로직 요약 비교

| 페이지               | 사용 함수                              | 카테고리 필터 | 지역 필터 | 최대 결과 | 특징                           |
| -------------------- | -------------------------------------- | ------------- | --------- | --------- | ------------------------------ |
| 홈/글로벌            | `search_restaurants_by_name` + `youtube_title` | ✅ 지원        | ✅ 한국만 (DB) | 50개      | 이중 검색, DB 레벨 지역 필터링 |
| 필터링               | `search_restaurants_by_name`           | ❌ 미지원      | ❌        | 100개     | 맛집 이름만, 더 많은 결과      |
| 관리자 데이터 검수   | `search_restaurants_by_youtube_title`  | ❌ 미지원      | ❌        | 100개     | YouTube 제목만, 전체 상태 조회, 22개 컬럼 |
| 도장                 | -                                      | -             | -         | -         | 검색 없음                      |
| 제보                 | -                                      | -             | -         | -         | 검색 없음                      |
| 관리자 리뷰/제보     | 클라이언트 필터링                      | -             | -         | -         | 간단한 텍스트 필터링           |

### 관리자 페이지

- **데이터 검수**: 평가 레코드 관리
- **리뷰 승인**: 사용자 리뷰 검토 및 승인
  - 승인 시 `review_count` 자동 증가
  - 거부 시 `review_count` 자동 감소
- **제보 관리**: 맛집 제보 및 수정 요청 처리
  - 신규 제보: `road_address`에 주소 저장, `youtube_links` 배열로 저장
  - **중복 방지**: 이름 + 도로명 주소 조합으로 자동 체크
  - 중복 발견 시 에러 메시지 표시

## 🚀 시작하기

### 필수 조건

- Node.js 18+
- Bun (권장) 또는 npm
- Supabase 계정

### 설치

```bash
# 저장소 클론
git clone <repository-url>
cd tzudong

# 의존성 설치
bun install

# 환경 변수 설정
cp .env.example .env
# .env 파일 편집하여 Supabase 키 입력
```

### 환경 변수

`.env` 파일에 다음을 설정하세요:

```env
VITE_SUPABASE_URL=your_supabase_url
VITE_SUPABASE_ANON_KEY=your_supabase_anon_key
VITE_GOOGLE_MAPS_API_KEY=your_google_maps_key
VITE_NAVER_MAPS_CLIENT_ID=your_naver_maps_client_id
```

### 개발 서버 실행

```bash
bun run dev
# 또는
npm run dev
```

브라우저에서 `http://localhost:8080` 접속

## 📁 프로젝트 구조

```
tzudong/
├── src/
│   ├── components/
│   │   ├── admin/           # 관리자 컴포넌트
│   │   │   ├── EvaluationTableNew.tsx  # 평가 테이블
│   │   │   └── EvaluationRowDetails.tsx # 상세 정보
│   │   ├── map/             # 지도 컴포넌트
│   │   ├── filters/         # 필터 컴포넌트
│   │   └── ui/              # shadcn/ui 컴포넌트
│   ├── pages/
│   │   ├── AdminEvaluationPage.tsx  # 데이터 검수 페이지
│   │   └── FilteringPage.tsx        # 메인 검색 페이지
│   ├── contexts/            # React Context
│   ├── hooks/               # Custom Hooks
│   └── integrations/        # Supabase 연동
├── backend/
│   └── perplexity-restaurant-evaluation/
│       ├── src/             # 데이터 수집 로직
│       └── scripts/
│           └── db-migration/  # DB 마이그레이션 스크립트
└── supabase/
    └── migrations/          # Supabase 스키마
```

## 🗄️ 데이터베이스 구조

### restaurants 테이블

| 컬럼명           | 타입      | 설명                           |
| ---------------- | --------- | ------------------------------ |
| id               | UUID      | Primary Key                    |
| name             | TEXT      | 음식점명                       |
| phone            | TEXT      | 전화번호                       |
| road_address     | TEXT      | 도로명 주소                    |
| jibun_address    | TEXT      | 지번 주소                      |
| english_address  | TEXT      | 영문 주소                      |
| address_elements | JSONB     | 네이버 지오코딩 주소 요소 배열 |
| lat              | DOUBLE    | 위도 (Naver y)                 |
| lng              | DOUBLE    | 경도 (Naver x)                 |
| category         | TEXT[]    | 음식 카테고리 배열             |
| youtube_links    | TEXT[]    | YouTube 영상 URL 배열          |
| tzuyang_reviews  | TEXT[]    | 쯔양 리뷰 배열                 |
| youtube_metas    | JSONB[]   | YouTube 메타데이터 배열        |
| review_count     | INTEGER   | 사용자 리뷰 수 (기본값: 0)     |
| created_at       | TIMESTAMP | 생성 시간                      |
| updated_at       | TIMESTAMP | 수정 시간                      |

### restaurant_submissions 테이블 (JSONB 배열 기반)

| 컬럼명                      | 타입              | 설명                                                                 |
| --------------------------- | ----------------- | -------------------------------------------------------------------- |
| id                          | UUID              | Primary Key                                                          |
| user_id                     | UUID              | 제보자 ID (auth.users FK)                                            |
| submission_type             | submission_type   | new (신규 제보) / edit (수정 요청)                                   |
| status                      | submission_status | pending / all_approved / partially_approved / all_deleted            |
| user_restaurants_submission | JSONB             | 제보 맛집 배열 `[{unique_id, name, categories, address, phone, youtube_link, tzuyang_review}, ...]` |
| admin_notes                 | TEXT              | 관리자 메모                                                          |
| rejection_reason            | TEXT              | 거부 사유                                                            |
| resolved_by_admin_id        | UUID              | 검토한 관리자 ID                                                     |
| reviewed_at                 | TIMESTAMPTZ       | 검토 완료 시간                                                       |
| created_at                  | TIMESTAMPTZ       | 제보 시간                                                            |
| updated_at                  | TIMESTAMPTZ       | 수정 시간                                                            |

**특징**:
- **JSONB 배열 구조**: 한 번의 제보에 여러 맛집 정보 포함 가능
- **unique_id**: 
  - 신규 제보 시: `null` (승인 시 자동 생성)
  - 수정 요청 시: 기존 맛집의 `unique_id`
- **부분 승인**: 여러 맛집 중 일부만 승인 가능 (`partially_approved`)
- **MD5 해싱**: `generate_unique_id(name, jibun_address, tzuyang_review)`로 중복 방지

> **주소 저장**: 사용자가 입력한 주소는 모두 **도로명 주소**로 저장됩니다.
>
> **카테고리 저장**: 단일 선택이든 복수 선택이든 항상 **TEXT[] 배열**로 저장됩니다.
>
> **중복 방지**: 승인 시 동일한 `name` + `road_address` 조합이 있는지 자동 체크하여 중복 등록을 방지합니다.

### reviews 테이블

| 컬럼명             | 타입      | 설명                      |
| ------------------ | --------- | ------------------------- |
| id                 | UUID      | Primary Key               |
| user_id            | UUID      | 작성자 ID                 |
| restaurant_id      | UUID      | 맛집 ID                   |
| title              | TEXT      | 리뷰 제목                 |
| content            | TEXT      | 리뷰 내용                 |
| visited_at         | DATE      | 방문 날짜                 |
| verification_photo | TEXT      | 인증 사진 URL             |
| food_photos        | TEXT[]    | 음식 사진 URL 배열        |
| category           | TEXT      | 카테고리                  |
| is_verified        | BOOLEAN   | 승인 여부 (기본값: false) |
| is_pinned          | BOOLEAN   | 고정 여부                 |
| admin_note         | TEXT      | 관리자 메모               |
| edited_by_admin    | BOOLEAN   | 관리자 수정 여부          |
| created_at         | TIMESTAMP | 작성 시간                 |
| updated_at         | TIMESTAMP | 수정 시간                 |

### review_likes 테이블

| 컬럼명     | 타입      | 설명        |
| ---------- | --------- | ----------- |
| id         | UUID      | Primary Key |
| review_id  | UUID      | 리뷰 ID     |
| user_id    | UUID      | 사용자 ID   |
| created_at | TIMESTAMP | 좋아요 시간 |

> **복합 유니크 제약**: (review_id, user_id) - 한 사용자는 리뷰당 1개의 좋아요만 가능

### address_elements 구조 예시

```json
[
  {
    "code": "",
    "types": ["SIDO"],
    "longName": "제주특별자치도",
    "shortName": "제주특별자치도"
  },
  {
    "code": "",
    "types": ["SIGUGUN"],
    "longName": "서귀포시",
    "shortName": "서귀포시"
  },
  // ... 기타 주소 요소
]
```

**지역 필터링**:

- `road_address` 또는 `jibun_address`에서 시/도명 패턴 매칭
- 우선순위: 도로명 주소 → 지번 주소
- 특수 지역: 울릉도, 욕지도 등 별도 처리

**카테고리 필터링**:

- PostgreSQL `overlaps` 연산자 사용
- TEXT[] 배열에서 교집합 검사

**리뷰 수 필터링**:

- `review_count` 컬럼 기반
- 리뷰 승인 시 자동 증가, 거부 시 감소

## 🛠️ 기술 스택

### Frontend

- **Framework**: React 18 + TypeScript
- **Build Tool**: Vite 5.4
- **UI Library**: shadcn/ui (Radix UI)
- **Styling**: Tailwind CSS
- **Maps**: Google Maps API / Naver Maps API

### Backend

- **Database**: Supabase (PostgreSQL)
- **Authentication**: Supabase Auth
- **Storage**: Supabase Storage

### Dev Tools

- **Package Manager**: Bun
- **Linting**: ESLint
- **Data Crawling**: Playwright (Perplexity AI)

## 📝 주요 컴포넌트

### 지도 컴포넌트

- **MapView.tsx**: Google Maps 통합
- **NaverMapView.tsx**: Naver Maps 통합
- 카테고리별 커스텀 마커 아이콘
- 마커 클릭 시 상세 패널 표시

### 관리자 컴포넌트

- **EvaluationTableNew.tsx**: 평가 레코드 표시 및 관리
  - 7개 평가 지표 컬럼 + 상태/액션
  - 인라인 필터링 (드롭다운)
  - Sticky 컬럼 (왼쪽: 영상 정보, 오른쪽: 상태/액션)
  - YouTube 썸네일 통합
- **AdminEvaluationPage.tsx**: 평가 데이터 로딩 및 상태 관리
- **AdminReviewsPage.tsx**: 리뷰 승인/거부 관리
- **AdminSubmissionsPage.tsx**: 맛집 제보 검토 및 처리

### 사용자 컴포넌트

- **RestaurantDetailPanel.tsx**: 맛집 상세 정보 표시
  - 도로명/지번 주소 분리 표시
  - YouTube 영상 목록 (썸네일)
  - 쯔양 리뷰 목록
  - 카테고리 배지 (배열 전체 표시)
- **ReviewModal.tsx**: 리뷰 작성 모달
- **RestaurantSubmissionsPage.tsx**: 맛집 제보 및 수정 요청

## 🔄 최근 업데이트

### 2025-01-06

- ✅ **지역 필터링 개선**: `road_address`/`jibun_address` 기반 필터링으로 변경
- ✅ **맛집 제보 시스템**: 신규 제보 및 수정 요청 기능 추가
- ✅ **주소 저장 형식**: 사용자 입력 주소는 모두 도로명 주소(`road_address`)로 저장
- ✅ **카테고리 저장**: 단일/복수 상관없이 항상 TEXT[] 배열로 저장
- ✅ **중복 방지**: 관리자 승인 시 이름 + 도로명 주소 조합으로 중복 체크
- ✅ **리뷰 승인 로직**: review_count 중복 증가 방지
- ✅ **YouTube 링크**: `youtube_links` 배열 타입으로 완전 지원

### DB 스키마 마이그레이션

- `address` → `road_address`, `jibun_address`, `address_elements` (JSONB)
- `category` → `category` (TEXT[], 항상 배열)
- `youtube_link` → `youtube_links` (TEXT[])
- `tzuyang_review` → `tzuyang_reviews` (TEXT[])

## �🐛 알려진 이슈

- [ ] 마지막 레코드 스크롤 잘림 현상 (확인 필요)
- [ ] Google Maps 타입 정의 경고 (기능상 문제 없음)

## 📚 추가 문서

- [제품 명세서](./docs/PRODUCT_SPEC.md)
- [설치 가이드](./docs/SETUP_GUIDE.md)
- [네이버 지오코딩 설정](./docs/NAVER_GEOCODING_SETUP.md)

## 🤝 기여

이슈 및 PR은 언제든 환영합니다!

## 📄 라이선스

MIT License
