# 🍽️ 쯔양 레스토랑 평가 시스템# 🍽️ Perplexity Restaurant Evaluation System



크롤링된 레스토랑 데이터를 다단계로 평가하고 검증하여 신뢰할 수 있는 맛집 데이터베이스를 구축하는 시스템입니다.Perplexity AI를 활용한 음식점 평가 자동화 시스템입니다. 크롤링된 음식점 데이터를 기반으로 평가 대상을 선정하고, 규칙 기반 평가 및 AI 평가를 수행합니다.



## 📚 목차## 📋 시스템 개요



- [시스템 개요](#-시스템-개요)이 시스템은 다음과 같은 **순차적 4단계**로 음식점 평가를 수행합니다:

- [평가 파이프라인](#-평가-파이프라인)

- [중복 처리 시스템](#-중복-처리-시스템)1. **평가 대상 선정** (Python) - 크롤링 데이터에서 평가할 음식점을 필터링 (평가 미대상 분리)

- [파일 설명](#-파일-설명)2. **규칙 기반 평가** (Python) - 카테고리 유효성과 위치 정합성 검증 (네이버/NCP API 활용)

- [설치 및 설정](#-설치-및-설정)3. **AI 평가 (LAAJ)** (TypeScript) - Perplexity AI를 통한 심층 평가 수행 (병렬 처리 지원)

- [실행 방법](#-실행-방법)4. **Transform** (Python) - 평가 결과를 DB 로드용 포맷으로 변환 (평가 미대상 포함)

- [평가 기준](#-평가-기준)

- [트러블슈팅](#-트러블슈팅)**⚠️ 평가는 반드시 1→2→3→4 순서로 진행해야 합니다.**



---## 🚀 설치 및 설정



## 🎯 시스템 개요### 1. 의존성 설치

```bash

크롤링된 레스토랑 데이터를 **4단계 평가 프로세스**를 거쳐 검증하고 DB 삽입 형식으로 변환합니다.npm install

```

### 주요 기능

### 2. 환경 변수 설정 (.env 파일)

- ✅ **평가 대상 선정**: 주소 유효성 기반 필터링```env

- 🔍 **Rule 기반 평가**: Naver Geocoding으로 위치 검증 + 카테고리 매칭PERPLEXITY_SESSION_PATH=perplexity-session.json

- 🤖 **AI 평가 (LAAJ)**: Perplexity AI로 5개 항목 심층 평가NODE_ENV=development

- 🔄 **에러 재평가**: 실패한 평가 자동 재시도

- 📊 **데이터 변환**: unique_id 생성 및 DB 삽입 형식 변환# 로그인 모드 설정

- 💾 **DB 삽입**: Supabase PostgreSQL에 최종 데이터 저장MANUAL_LOGIN=true  # 수동 로그인 권장 (브라우저에서 직접 로그인)

- 🔐 **중복 방지**: 전 과정에서 이미 처리된 데이터 자동 스킵

# 규칙 평가용 API 키 (필수)

---NAVER_CLIENT_ID_BYEON=your_naver_client_id

NAVER_CLIENT_SECRET_BYEON=your_naver_client_secret

## 🔄 평가 파이프라인NCP_MAPS_KEY_ID_BYEON=your_ncp_key_id

NCP_MAPS_KEY_BYEON=your_ncp_key

``````

┌─────────────────────────────────────────────────────────────────┐

│                   🍽️ 평가 파이프라인 (6단계)                      │### 3. Python 환경 설정

└─────────────────────────────────────────────────────────────────┘규칙 평가를 위해 Python 3.8+가 필요합니다.

```bash

┌──────────────────────────────────────────┐pip install requests python-dotenv

│  tzuyang_restaurant_results_with_meta.jsonl │```

│  (크롤링 + 메타데이터 완료)                   │

└────────────┬─────────────────────────────┘### 4. TypeScript 컴파일

             │```bash

             ▼npm run build

┌─────────────────────────────────────────────────────────────────┐```

│  STEP 1: 평가 대상 선정                                          │

│  📄 evaluation-target-selection.py                              │**💡 Tip**: 전체 파이프라인(`evaluation_pipeline.py`)은 자동으로 빌드 여부를 확인하고 필요 시 빌드를 수행합니다.

├─────────────────────────────────────────────────────────────────┤

│  • 주소 유효성 체크                                              │## 🔐 로그인 방식

│  • 평가 대상 / 비대상 분리                                        │

│                                                                 │### 수동 로그인 모드 (권장)

│  출력:                                                          │- `MANUAL_LOGIN=true`로 설정

│  - selection.jsonl (평가 대상)                                  │- 브라우저 창이 열리면 사용자가 직접 로그인

│  - notSelection_with_addressNull.jsonl (비대상)                │- 2FA나 복잡한 로그인 상황에 안정적

└────────────┬────────────────────────────────────────────────────┘- **사용법:**

             │  1. `.env` 파일에서 `MANUAL_LOGIN=true` 설정

             ▼  2. `npm run dev` 실행

┌─────────────────────────────────────────────────────────────────┐  3. 브라우저 창이 열리면 직접 Perplexity에 로그인

│  STEP 2: Rule 기반 평가                                          │  4. 로그인 완료 후 터미널에서 Enter 키 입력

│  📄 evaluation-rule.py                                          │

├─────────────────────────────────────────────────────────────────┤## 📊 사용 방법

│  • Naver Geocoding API로 좌표 검증                               │

│  • 카테고리 유효성 체크                                           │### 🔥 전체 파이프라인 자동 실행 (권장)

│  • 위치 정합성 확인                                              │```bash

│                                                                 │# 전체 평가 파이프라인 실행 (1→2→3→4 순차 실행)

│  출력: rule_results.jsonl                                       │python3 src/evaluation_pipeline.py

└────────────┬────────────────────────────────────────────────────┘```

             │

             ▼파이프라인은 다음을 자동으로 수행합니다:

┌─────────────────────────────────────────────────────────────────┐1. ✅ **빌드 확인 및 자동 빌드** - TypeScript 컴파일 필요 시 자동 실행

│  STEP 3: AI 평가 (LAAJ)                                         │2. ✅ **병렬 브라우저 수 선택** - 시작 시 1/3/5개 선택 (전체 파이프라인에 적용)

│  📄 index.ts (TypeScript + Perplexity AI)                       │3. ✅ **평가 대상 선정** (Step 1) - 평가 대상과 평가 미대상(not_selected) 분리

├─────────────────────────────────────────────────────────────────┤4. ✅ **규칙 기반 평가** (Step 2)

│  • 5개 평가 항목 AI 분석                                         │5. ✅ **AI 평가 LAAJ** (Step 3) - 선택한 병렬 브라우저 수로 실행

│    1. 방문 여부 정확성 (visit_authenticity)                      │6. ✅ **Transform** (Step 4) - 평가 결과 + 평가 미대상을 transform.jsonl로 통합

│    2. 위치 정보 정확성 (location_accuracy)                       │

│    3. 메뉴 일치도 (menu_match)                                  │**💡 중복 처리 방지**: 모든 단계에서 이미 처리된 레코드는 자동으로 건너뜁니다.

│    4. 정보 정확성 (information_accuracy)                         │

│    5. 전반적 신뢰도 (overall_reliability)                        │---

│                                                                 │

│  출력:                                                          │### 📝 개별 단계 실행 (선택사항)

│  - evaluation_results.jsonl (성공)                             │

│  - evaluation_errors.jsonl (실패)                              │#### 1. 평가 대상 선정

└────────────┬────────────────────────────────────────────────────┘```bash

             │cd src

             ▼python3 evaluation-target-selection.py

┌─────────────────────────────────────────────────────────────────┐```

│  STEP 4: 에러 재평가                                             │- ✅ **중복 처리 방지**: 기존 출력 파일에 이미 있는 youtube_link는 자동으로 건너뜁니다.

│  📄 index_retry_for_errors.ts                                   │- ✅ **평가 미대상 분리**: 주소가 없는 음식점(광고, 해외 등)은 자동으로 `notSelection_with_addressNull.jsonl`로 분리

├─────────────────────────────────────────────────────────────────┤- ✅ **youtube_meta 포함**: `tzuyang_restaurant_results_with_meta.jsonl`에서 영상 메타데이터 자동 포함

│  • errors.jsonl의 실패 항목 재평가                               │

│  • 성공 시 results.jsonl에 추가                                  │#### 2. 규칙 기반 평가 (RULE)

│  • 성공한 항목은 errors.jsonl에서 삭제                            │```bash

│                                                                 │cd src

│  출력: evaluation_results.jsonl (업데이트)                       │python3 evaluation-rule.py

└────────────┬────────────────────────────────────────────────────┘```

             │- ✅ **중복 처리 방지**: 이미 평가된 youtube_link는 자동으로 건너뜁니다.

             ▼

┌─────────────────────────────────────────────────────────────────┐#### 3. AI 평가 (LAAJ)

│  STEP 5: 데이터 변환 (Transform)                                 │```bash

│  📄 transform_evaluation_results.py                             │# TypeScript 빌드 (최초 1회 또는 코드 변경 시)

├─────────────────────────────────────────────────────────────────┤npm run build

│  • unique_id 생성 (SHA-256 해시)                                │

│  • 데이터 평탄화 (flatten)                                       │# 개발 모드

│  • 평가 결과 + 비대상 통합                                        │npm run dev

│                                                                 │

│  출력: tzuyang_restaurant_transforms.jsonl                      │# 또는

└────────────┬────────────────────────────────────────────────────┘node dist/index.js

             │```

             ▼- ✅ **중복 처리 방지**: 성공/실패 파일에 이미 있는 youtube_link는 자동으로 건너뜁니다.

┌─────────────────────────────────────────────────────────────────┐

│  STEP 6: 데이터베이스 삽입                                        │**실행 시 선택사항:**

│  📄 insert_to_supabase.ts                                       │- **병렬 처리 브라우저 수**: 1개 / 3개 / 5개 선택

├─────────────────────────────────────────────────────────────────┤- 병렬 처리 시 여러 브라우저가 동시에 평가를 수행하여 속도 향상

│  • Supabase PostgreSQL 연결                                     │- 각 브라우저는 독립적인 프로필 디렉토리 사용 (충돌 방지)

│  • unique_id 중복 체크                                          │- 각 배치는 모두 완료된 후 다음 배치로 진행

│  • 데이터 삽입 (restaurants, youtube_videos, creators)           │- **전체 레코드 처리**: 모든 미처리 레코드를 순차적으로 평가

│                                                                 │

│  출력: Supabase Database                                        │---

└─────────────────────────────────────────────────────────────────┘

```### 🔄 에러 레코드 재평가 (선택사항)



---AI 평가 중 실패한 레코드들을 다시 평가하려면:



## 🔐 중복 처리 시스템```bash

# TypeScript 빌드 (필요 시)

모든 단계에서 **이미 처리된 데이터를 자동으로 감지하고 스킵**합니다.npm run build



### 단계별 중복 검사```bash

# 에러 레코드 재평가 실행

| 단계 | 파일 | 중복 기준 | 검사 방식 | 저장 방식 |node dist/index_retry_for_errors.js

|------|------|----------|----------|----------|```

| **STEP 1** | `evaluation-target-selection.py` | `youtube_link` | 2개 파일 통합 체크 | **append** 모드 |

| **STEP 2** | `evaluation-rule.py` | `youtube_link` | 유틸리티 함수 | **append** 모드 |**동작 방식:**

| **STEP 3** | `index.ts` (LAAJ) | `youtube_link` | inline 함수 (results + errors) | **append** 모드 |1. `tzuyang_restaurant_evaluation_errors.jsonl`의 에러 레코드 읽기

| **STEP 4** | `index_retry_for_errors.ts` | `youtube_link` | inline 함수, 성공 시 삭제 | **append** + 삭제 |2. ✅ **이미 성공한 레코드 자동 제거**: `results.jsonl`에 있는 youtube_link는 에러 파일에서 자동 삭제

| **STEP 5** | `transform_evaluation_results.py` | `unique_id` | SHA-256 해시 | **append** 모드 |3. 각 레코드를 **새로운 프롬프트로 다시 평가** (재시도가 아닌 새 평가)

| **STEP 6** | `insert_to_supabase.ts` | `unique_id` | DB 한 번에 조회 | 중복 시 스킵 |4. 성공 시 → `tzuyang_restaurant_evaluation_results.jsonl`에 append

5. 성공 시 → `errors.jsonl`에서 해당 레코드 자동 제거

### STEP 1: 평가 대상 선정 중복 처리6. 실패 시 → `errors.jsonl`에 그대로 유지



```python**💡 Tip**: 파이프라인과 별도로 실행되며, 병렬 처리 옵션 선택 가능

# evaluation-target-selection.py

---

from duplicate_checker import load_processed_urls, append_to_jsonl

## 📊 처리 통계

# 기존 처리된 URL 로드 (selection + notSelection 모두)

processed_urls = (파이프라인 실행 시 각 단계별 상세 통계가 자동으로 출력됩니다:

    load_processed_urls(OUTPUT_FILE_SELECTION) |

    load_processed_urls(OUTPUT_FILE_NOT_SELECTION)```

)================================================================================

📊 전체 처리 통계

# 중복 필터링================================================================================

if youtube_link in processed_urls:

    stats["already_processed"] += 1Step 1: 평가 대상 선정

    continue  입력: 전체 크롤링 데이터

  이미 처리됨: 50개

# 주소 있으면 selection, 없으면 notSelection  새로 처리: 30개

if address:  최종 누적: 80개

    append_to_jsonl(OUTPUT_FILE_SELECTION, data)

else:Step 2: RULE 평가

    append_to_jsonl(OUTPUT_FILE_NOT_SELECTION, data)  입력: 80개

```  이미 처리됨: 70개

  새로 처리: 10개 (12.5%)

**특징:**  최종 누적: 80개

- ✅ 2개 파일 모두 체크 (selection + notSelection)

- ✅ 공통 유틸리티 함수 사용Step 3: LAAJ 평가

- ✅ Append 모드로 안전한 저장  입력: 80개

  이미 처리됨: 60개 (성공 50, 에러 10)

---  새로 처리: 15개 성공 (75.0%), 5개 에러 (25.0%)

  최종 누적: 성공 65개, 에러 15개

### STEP 2: Rule 평가 중복 처리

────────────────────────────────────────────────────────────────────────────────

```python✅ 전체 성공률: 65/80 (81.3%)

# evaluation-rule.py────────────────────────────────────────────────────────────────────────────────

```

from duplicate_checker import load_processed_urls, append_to_jsonl

**통계 항목:**

# 기존 처리된 URL 로드- **입력**: 해당 단계의 입력 레코드 수

processed_links = load_processed_urls(str(OUTPUT_PATH))- **이미 처리됨**: 이전 실행에서 완료된 레코드 (자동 스킵)

- **새로 처리**: 현재 실행에서 새로 처리한 레코드와 성공률

# 중복 필터링- **최종 누적**: 파일에 저장된 전체 레코드 수

for line in input_lines:

    record = json.loads(line)**💡 중복 처리 방지:** 모든 단계에서 이미 처리된 youtube_link는 자동으로 건너뜁니다.

    if record['youtube_link'] in processed_links:

        stats["skipped_duplicate"] += 1## 🎯 AI 평가 상세

        continue```

    

    # 평가 후 즉시 append**동작 방식:**

    result = evaluate_restaurant(record)1. `tzuyang_restaurant_evaluation_errors.jsonl`의 에러 레코드 읽기

    append_to_jsonl(str(OUTPUT_PATH), result)2. 각 레코드를 **새로운 프롬프트로 다시 평가** (재시도가 아닌 새 평가)

```3. 성공 시 → `tzuyang_restaurant_evaluation_results.jsonl`에 append

4. 성공 시 → `errors.jsonl`에서 해당 레코드 자동 제거

**특징:**5. 실패 시 → `errors.jsonl`에 그대로 유지

- ✅ 유틸리티 함수로 일관된 처리

- ✅ 처리 후 즉시 저장**💡 Tip**: 파이프라인과 별도로 실행되며, 병렬 처리 옵션 선택 가능

- ✅ 중복 통계 자동 추적

## 🎯 AI 평가 상세

---

### 평가 항목 (5가지)

### STEP 3: LAAJ 평가 중복 처리1. **visit_authenticity** (방문 여부 정확성)

   - 0~4점 척도로 실제 방문 여부 평가

```typescript   - `{values: [...], missing: []}` 형식

// index.ts   - `missing` 배열: 영상에서 식별되었지만 restaurants 리스트에 누락된 음식점들

     - 문자열 형식 또는 `{name: "...", eval_basis: "..."}` 딕셔너리 형식

function loadMultipleProcessedUrls(...filePaths: string[]): Set<string> {

  const allUrls = new Set<string>();2. **rb_inference_score** (추론 합리성)

     - 0~2점 척도로 reasoning_basis의 논리성 평가

  for (const filePath of filePaths) {

    if (!existsSync(filePath)) continue;3. **rb_grounding_TF** (실제 근거 일치도)

       - true/false로 영상 내 근거 확인 여부 평가

    const content = readFileSync(filePath, 'utf-8');

    const lines = content.trim().split('\n').filter(line => line.trim());4. **review_faithfulness_score** (리뷰 충실도)

       - 0.0~1.0 척도로 리뷰 정확성 평가

    for (const line of lines) {

      try {5. **category_TF** (카테고리 정합성)

        const data = JSON.parse(line);   - true/false로 카테고리 적절성 평가

        if (data.youtube_link) {

          allUrls.add(data.youtube_link);### 오류 처리 및 재시도

        }- **페이지 로드 오류** (ERR_FAILED): 1번 재시도 (5-15초 랜덤 대기)

      } catch (e) {  - 페이지 오류 발생 시에만 모델 재선택 수행

        // 파싱 실패 무시- **JSON 파싱 실패**: 재시도 없이 오류 기록 (Perplexity 응답 문제)

      }- **각 단계마다 1-3초 랜덤 대기**로 서버 부하 분산

    }- **Assistant steps 감지 후 5-8초 대기** (응답 완전 생성 보장)

  }- **30개 처리마다 2-4분 자동 휴식** (서버 부하 방지, 안정적 장시간 실행)

  - 오류 발생 시 자동으로 메인 페이지 복구

  return allUrls;

}### 병렬 처리 최적화

- **1개**: 순차 처리 (안정적)

// 사용: results와 errors 모두 체크- **3개**: 병렬 처리 (권장, 속도 3배)

const processedLinks = loadMultipleProcessedUrls(outputFilePath, errorFilePath);- **5개**: 병렬 처리 (속도 5배, 서버 부하 주의)

const recordsToProcess = lines.filter(line => {- **각 브라우저 독립 프로필**: `puppeteer_dev_profile_0`, `_1`, `_2` 등 고유 디렉토리 사용 (충돌 방지)

  const youtubeLink = JSON.parse(line).youtube_link;- **Thread 정리**: 배치 시작 시 첫 번째 브라우저에서만 수행 (효율성 향상)

  return !processedLinks.has(youtubeLink);- **모델 선택**: 첫 평가 시 또는 페이지 오류 복구 후에만 수행

});- **stdin 입력 지원**: TTY 모드와 파이프 입력 모두 지원 (파이프라인 호환)

```- Promise.all()로 배치 단위 완료 보장



**특징:**### 대용량 처리 예시 (700개 기준)

- ✅ TypeScript inline 함수 (rootDir 제약)| 병렬 브라우저 수 | 순수 처리 시간 | 휴식 시간 (23회) | **총 소요 시간** |

- ✅ results + errors 파일 모두 체크| ---------------- | -------------- | ---------------- | ---------------- |

- ✅ 성공/실패 모두 중복 방지| **1개**          | 9.7시간        | 1.3시간          | **약 11시간**    |

| **3개**          | 3.4시간        | 1.3시간          | **약 4.8시간**   |

---| **5개**          | 2.1시간        | 1.3시간          | **약 3.4시간**   |



### STEP 4: 에러 재평가 중복 처리*30개마다 2-4분 휴식 적용 기준*



```typescript#### 3. AI 평가 실행

// index_retry_for_errors.ts```bash

# 개발 모드

// 1. 이미 성공한 것 로드npm run dev

const alreadySuccessful = loadMultipleProcessedUrls(outputFilePath);

# 또는

// 2. 성공한 것 제외하고 재평가node dist/index.js

const linesToProcess = errorLines.filter(line => {```

  const record = JSON.parse(line.trim());- ✅ **중복 처리 방지**: 성공/실패 파일에 이미 있는 youtube_link는 자동으로 건너뜁니다.

  return !alreadySuccessful.has(record.youtube_link);

});**실행 시 선택사항:**

- **병렬 처리 브라우저 수**: 1개 / 3개 / 5개 선택

// 3. 재평가 성공 시- 병렬 처리 시 여러 브라우저가 동시에 평가를 수행하여 속도 향상

if (evaluationResult.success) {- 각 브라우저는 독립적인 프로필 디렉토리 사용 (충돌 방지)

  appendFileSync(outputFilePath, resultLine, 'utf-8');  // results에 추가- 각 배치는 모두 완료된 후 다음 배치로 진행

  successfulYoutubeLinks.add(youtubeLink);  // 추적- **전체 레코드 처리**: 모든 미처리 레코드를 순차적으로 평가

}

#### 4. Transform (평가 결과 변환)

// 4. errors.jsonl 업데이트 (성공한 것 제거)```bash

const remainingErrorLines = errorLines.filter(line => {cd src

  const record = JSON.parse(line.trim());python3 transform_evaluation_results.py

  return !successfulYoutubeLinks.has(record.youtube_link);```

});- ✅ **평가 결과 통합**: evaluation_results.jsonl의 평가 결과를 youtube_link-restaurant_name 기준으로 변환

writeFileSync(errorFilePath, remainingErrorLines.join('\n'), 'utf-8');- ✅ **평가 미대상 포함**: notSelection_with_addressNull.jsonl의 평가 미대상도 자동 통합

```- ✅ **Missing 항목 처리**: visit_authenticity.missing에 있는 음식점들도 자동 추출 (문자열/딕셔너리 형식 모두 지원)

- ✅ **중복 방지**: 이미 transform.jsonl에 있는 레코드는 자동 스킵

**특징:**- ✅ **출력**: transform.jsonl (pending + missing + not_selected 통합)

- ✅ 이미 성공한 것 자동 스킵

- ✅ 성공 시 errors에서 자동 삭제**Missing 항목 처리 로직:**

- ✅ 실패는 그대로 유지 (다음 재시도용)- `visit_authenticity.missing` 배열에서 음식점 추출

- 문자열 형식: 바로 음식점명으로 사용 (예: `"카페 오늘"`)

---- 딕셔너리 형식: `name` 속성 추출 (예: `{"name": "과일 가게", "eval_basis": "..."}`)

- Missing 항목은 `is_missing: true`로 표시되어 수동 등록 대상이 됨

### STEP 5: Transform 중복 처리

## 🎯 AI 평가 상세

```python

# transform_evaluation_results.py### 평가 항목 (5가지)

1. **visit_authenticity** (방문 여부 정확성)

from duplicate_checker import load_processed_unique_ids, append_to_jsonl   - 0~4점 척도로 실제 방문 여부 평가

   - `{values: [...], missing: []}` 형식

# unique_id 생성

def generate_unique_id(youtube_link, name, review):2. **rb_inference_score** (추론 합리성)

    key_string = str(youtube_link) + str(name) + str(review)   - 0~2점 척도로 reasoning_basis의 논리성 평가

    return hashlib.sha256(key_string.encode('utf-8')).hexdigest()

3. **rb_grounding_TF** (실제 근거 일치도)

# 기존 unique_id 로드   - true/false로 영상 내 근거 확인 여부 평가

written_ids = load_processed_unique_ids(OUTPUT_FILE)

4. **review_faithfulness_score** (리뷰 충실도)

# 중복 필터링   - 0.0~1.0 척도로 리뷰 정확성 평가

for entry in flattened_results:

    uid = entry['unique_id']5. **category_TF** (카테고리 정합성)

       - true/false로 카테고리 적절성 평가

    if uid not in written_ids:

        append_to_jsonl(OUTPUT_FILE, entry)### 오류 처리 및 재시도

        written_ids.add(uid)- **페이지 로드 오류** (ERR_FAILED): 1번 재시도 (5-15초 랜덤 대기)

        stats["total_written"] += 1  - 페이지 오류 발생 시에만 모델 재선택 수행

    else:- **JSON 파싱 실패**: 재시도 없이 오류 기록 (Perplexity 응답 문제)

        stats["total_skipped"] += 1- **각 단계마다 1-3초 랜덤 대기**로 서버 부하 분산

```- **Assistant steps 감지 후 5-8초 대기** (응답 완전 생성 보장)

- 오류 발생 시 자동으로 메인 페이지 복구

**특징:**

- ✅ SHA-256 해시로 고유 ID 생성### 병렬 처리 최적화

- ✅ 같은 youtube_link + name + review = 같은 unique_id- **1개**: 순차 처리 (안정적)

- ✅ Append 모드로 안전한 누적- **3개**: 병렬 처리 (권장, 속도 3배)

- **5개**: 병렬 처리 (속도 5배, 서버 부하 주의)

---- **각 브라우저 독립 프로필**: `puppeteer_dev_profile_0`, `_1`, `_2` 등 고유 디렉토리 사용 (충돌 방지)

- **Thread 정리**: 배치 시작 시 첫 번째 브라우저에서만 수행 (효율성 향상)

### STEP 6: DB 삽입 중복 처리- **모델 선택**: 첫 평가 시 또는 페이지 오류 복구 후에만 수행

- **stdin 입력 지원**: TTY 모드와 파이프 입력 모두 지원 (파이프라인 호환)

```typescript- Promise.all()로 배치 단위 완료 보장

// insert_to_supabase.ts

## 📁 파일 구조 및 워크플로우

// 1. DB에서 모든 unique_id 한 번에 조회 (최적화)

const { data: existingRecords } = await supabase```

  .from('restaurants')📂 perplexity-restaurant-evaluation/

  .select('unique_id, deleted_at');├── 📄 tzuyang_restaurant_evaluation_selection.jsonl          # 평가 대상 데이터

├── 📄 tzuyang_restaurant_evaluation_notSelection_with_addressNull.jsonl  # 평가 미대상 (주소 없음)

const existingUniqueIds = new Set();├── 📄 tzuyang_restaurant_evaluation_rule_results.jsonl       # 규칙 평가 결과

const deletedUniqueIds = new Set();├── 📄 tzuyang_restaurant_evaluation_results.jsonl            # AI 평가 성공 결과

├── 📄 tzuyang_restaurant_evaluation_errors.jsonl             # AI 평가 실패 기록

for (const record of existingRecords) {├── 📄 transform.jsonl                                        # DB 로드용 통합 데이터 (평가 결과 + 평가 미대상)

  existingUniqueIds.add(record.unique_id);├── 📂 src/

  if (record.deleted_at) {│   ├── 🔥 evaluation_pipeline.py           # 전체 파이프라인 실행 스크립트 (1→2→3→4)

    deletedUniqueIds.add(record.unique_id);│   ├── 📋 evaluation-target-selection.py   # Step 1: 평가 대상 선정 (평가 미대상 분리)

  }│   ├── 🔧 evaluation-rule.py              # Step 2: 규칙 평가 (2단계 매칭)

}│   ├── 🤖 perplexity-evaluator.ts         # Step 3: Perplexity 제어 모듈

│   ├── 📄 jsonl-processor.ts              # JSONL 파일 처리 모듈

// 2. 메모리에서 빠르게 중복 체크│   ├── ⚙️ index.ts                        # Step 3: AI 평가 메인 파일 (병렬 처리)

for (const restaurant of restaurants) {│   ├── 🔄 index_retry_for_errors.ts       # 에러 레코드 재평가 (별도 실행)

  if (existingUniqueIds.has(restaurant.unique_id)) {│   ├── 🔀 transform_evaluation_results.py  # Step 4: Transform (평가 결과 + 평가 미대상 통합)

    if (!deletedUniqueIds.has(restaurant.unique_id)) {│   ├── 💾 load_transform_to_db.py         # DB 로드 스크립트

      // 이미 존재하고 삭제되지 않음 → 스킵│   └── 📋 types.ts                         # 타입 정의

      continue;└── ⚙️ .env                                  # 환경 변수 설정

    }```

  }

  ### 워크플로우

  // 새 데이터 또는 복원 대상 → 삽입/업데이트```

  await insertRestaurant(restaurant);📥 입력: tzuyang_restaurant_results_with_meta.jsonl (크롤링 데이터 + youtube_meta)

}          ↓

```🔍 Step 1: 평가 대상 선정 (evaluation-target-selection.py)

          ↓

**특징:**📄 출력: tzuyang_restaurant_evaluation_selection.jsonl (평가 대상)

- ✅ DB 조회 1회만 수행 (N번 조회 → 1번 조회)        tzuyang_restaurant_evaluation_notSelection_with_addressNull.jsonl (평가 미대상)

- ✅ Set 기반 메모리 체크 (O(1))          ↓

- ✅ 삭제된 레코드 복원 지원📏 Step 2: 규칙 평가 - RULE (evaluation-rule.py)

          ↓

---📄 출력: tzuyang_restaurant_evaluation_rule_results.jsonl

          ↓

### 중복 처리 최적화 요약🤖 Step 3: AI 평가 - LAAJ (index.ts via Node.js)

          ↓

1. **메모리 기반 Set 사용** - O(1) 조회 속도📄 출력: tzuyang_restaurant_evaluation_results.jsonl (성공)

2. **Append 모드** - 기존 데이터 절대 손실 없음        tzuyang_restaurant_evaluation_errors.jsonl (실패)

3. **즉시 저장** - 처리 후 바로 append          ↓

4. **DB 조회 최소화** - 한 번에 로드 후 메모리 체크🔀 Step 4: Transform (transform_evaluation_results.py)

5. **공통 유틸리티** - 일관된 코드 패턴          ↓

📄 출력: transform.jsonl (평가 결과 + 평가 미대상 통합)

---          ↓

💾 DB 로드: load_transform_to_db.py

## 📄 파일 설명          ↓

📊 Supabase evaluation_records 테이블

### 실행 스크립트```



| 파일 | 언어 | 설명 |**💡 전체 파이프라인은 `python3 src/evaluation_pipeline.py`로 한 번에 실행 가능**

|------|------|------|

| `evaluation-pipeline.py` | Python | 전체 평가 파이프라인 통합 스크립트 |## ⚙️ 규칙 기반 평가 상세

| `evaluation-target-selection.py` | Python | 평가 대상 선정 (주소 유효성 체크) |

| `evaluation-rule.py` | Python | Rule 기반 평가 (Naver Geocoding) |규칙 평가는 **카테고리 유효성**과 **위치 정합성**을 검증합니다.

| `index.ts` | TypeScript | LAAJ AI 평가 (Perplexity) |

| `index_retry_for_errors.ts` | TypeScript | 에러 재평가 |### 위치 정합성 평가 로직

| `transform_evaluation_results.py` | Python | 데이터 변환 (unique_id 생성) |- **1단계: 정확 주소 매칭**

| `insert_to_supabase.ts` | TypeScript | Supabase DB 삽입 |  - 원본 주소를 NCP 지오코딩으로 지번주소 변환

  - 네이버 로컬 검색으로 후보 수집 (name 검색 5개 + name+address 검색 3개 + name+region 검색 5개)

### 출력 파일  - 지번주소가 정확히 일치하면 성공



| 파일 | 형식 | 설명 |- **2단계: 거리 기반 매칭 (1단계 실패 시)**

|------|------|------|  - 원본 주소와 후보 주소의 lat/lng를 NCP 지오코딩으로 얻음

| `tzuyang_restaurant_evaluation_selection.jsonl` | JSONL | 평가 대상 (주소 有) |  - Haversine 공식으로 거리 계산

| `tzuyang_restaurant_evaluation_notSelection_with_addressNull.jsonl` | JSONL | 평가 비대상 (주소 無) |  - **30m 이내** 가장 가까운 후보 선택

| `tzuyang_restaurant_evaluation_rule_results.jsonl` | JSONL | Rule 평가 결과 |

| `tzuyang_restaurant_evaluation_results.jsonl` | JSONL | LAAJ 평가 성공 |### 검색 쿼리 전략

| `tzuyang_restaurant_evaluation_errors.jsonl` | JSONL | LAAJ 평가 실패 |- **name**: 식당명만 검색 (전국적 결과)

| `tzuyang_restaurant_transforms.jsonl` | JSONL | Transform 최종 결과 |- **name+address**: 식당명 + 원본 주소 (정확도 높음)

- **name+region**: 식당명 + 지역명 (지역별 필터링, ex: "통큰식당 제천시")

---

### 현재 성능 (테스트 데이터 26개 음식점 기준)

## 🔧 설치 및 설정- **성공률**: 65.4% (17/26개)

- **국내 성공**: 17개 (해외 제외)

### 1. Python 패키지 설치- **실패 원인**: 해외 주소, API 제한, 주소 불일치 등



```bash## 📝 출력 파일

pip install requests python-dotenv

```### 평가 대상 선정

- `tzuyang_restaurant_evaluation_selection.jsonl`: 평가 대상으로 선정된 음식점 데이터

### 2. Node.js 패키지 설치- `tzuyang_restaurant_evaluation_notSelection_with_addressNull.jsonl`: 제외된 데이터 (주소 정보 없음)



```bash### 규칙 평가

npm install- `tzuyang_restaurant_evaluation_rule_results.jsonl`: 규칙 기반 평가 결과 (성공/실패, 매칭 주소, 거리 등)

```

### AI 평가

주요 패키지:- `tzuyang_restaurant_evaluation_results.jsonl`: 평가 성공한 레코드 (evaluation_results 필드 추가)

- `puppeteer` - 브라우저 자동화- `tzuyang_restaurant_evaluation_errors.jsonl`: 평가 실패한 레코드 (error 필드 포함)

- `@supabase/supabase-js` - Supabase 클라이언트

- `dotenv` - 환경 변수 관리## 🎬 관리자 액션 동작 방식



### 3. TypeScript 빌드### 1️⃣ 수동 등록 (`not_selected`, `missing` 상태에서 사용)

- **동작**: `MissingRestaurantForm` 모달 팝업 열림

```bash- **목적**: 평가 미대상이거나 누락된 음식점을 수동으로 등록

npm run build- **입력 데이터**:

```  - 선택된 레코드의 `youtube_link`와 `youtube_meta` 자동 전달

  - 음식점 이름, 주소, 카테고리 등 수동 입력

### 4. 환경 변수 설정- **결과**: 

  - 새로운 `restaurant` 레코드 생성

`.env` 파일 생성:  - `evaluation_record`의 `status`는 `pending`으로 변경됨

  - 입력한 음식점 정보가 DB에 저장됨

```env

# Perplexity 계정### 2️⃣ 삭제 (모든 상태에서 사용 가능)

PERPLEXITY_EMAIL=your_email@example.com- **동작**: 

PERPLEXITY_PASSWORD=your_password_here  1. 확인 다이얼로그 표시 ("정말 삭제하시겠습니까?")

  2. 확인 시 `evaluation_records` 테이블에서 레코드 완전 삭제

# Naver Geocoding API- **결과**: 

NAVER_CLIENT_ID=your_naver_client_id  - DB에서 영구 제거

NAVER_CLIENT_SECRET=your_naver_client_secret  - 성공 토스트 메시지 표시

- **주의**: 

# Supabase  - 실제 음식점 데이터(`restaurant` 테이블)는 삭제되지 않음

SUPABASE_URL=https://your-project.supabase.co  - 평가 레코드만 제거됨

SUPABASE_SERVICE_KEY=your_service_key_here

```### 3️⃣ 상태별 액션 버튼 가시성

| 상태               | 수동 등록 | 삭제 |

---| ------------------ | --------- | ---- |

| `pending`          | ❌         | ✅    |

## 🚀 실행 방법| `approved`         | ❌         | ✅    |

| `hold`             | ❌         | ✅    |

### 방법 1: 통합 파이프라인 (권장)| `db_conflict`      | ❌         | ✅    |

| `geocoding_failed` | ❌         | ✅    |

**전체 평가 프로세스 자동 실행:**| `missing`          | ✅         | ✅    |

| `not_selected`     | ✅         | ✅    |

```bash

cd src## 🛠️ 개발

python evaluation-pipeline.py

```### 프로젝트 구조

- **Python 스크립트**: 데이터 처리 및 규칙 평가 (네이버/NCP API 연동)

자동으로 STEP 1 → 2 → 3 → 4 → 5 → 6 순차 실행- **TypeScript 모듈**: Perplexity 자동화 및 병렬 처리 (Puppeteer 기반)

- **JSONL 포맷**: 대용량 데이터 효율적 처리

---

### 주요 기능

### 방법 2: 단계별 실행- ✅ **중복 처리 방지**: 모든 단계에서 이미 처리된 youtube_link 자동 건너뛰기

- ✅ **에러 재시도 자동 정리**: 이미 성공한 레코드는 에러 파일에서 자동 제거

#### STEP 1: 평가 대상 선정- ✅ **긴 JSON 안정적 파싱**: code 블록 전체 textContent 추출로 대용량 응답 완벽 처리

- ✅ **30개마다 자동 휴식**: 2-4분 랜덤 휴식으로 서버 부하 방지 및 안정적 장시간 실행

```bash- ✅ **상세 통계 출력**: 각 단계별 입력/처리/성공/실패 통계 자동 계산

cd src- ✅ 자동 쓰레드 삭제 (배치 시작 시 첫 브라우저에서만 - 효율성)

python evaluation-target-selection.py- ✅ Gemini Pro 2.5 모델 자동 선택 (첫 평가/오류 복구 시에만)

```- ✅ 인간처럼 타이핑 (10-20ms/문자)

- ✅ Assistant steps 감지 후 충분한 대기 (5-8초, 응답 완전 생성)

#### STEP 2: Rule 평가- ✅ 병렬 처리 (1/3/5 브라우저, 각각 독립 프로필)

- ✅ 오류 자동 재시도 및 복구 (페이지 오류 감지)

```bash- ✅ 랜덤 대기로 서버 부하 분산

python evaluation-rule.py- ✅ TTY/파이프 입력 모두 지원 (파이프라인 자동화 호환)

```

### 확장

#### STEP 3: LAAJ 평가시스템은 모듈화되어 있어 새로운 평가 규칙이나 AI 모델로 쉽게 확장할 수 있습니다.

```bash
cd ..
npm run eval
```

#### STEP 4: 에러 재평가

```bash
node dist/index_retry_for_errors.js
```

#### STEP 5: Transform

```bash
cd src
python transform_evaluation_results.py
```

#### STEP 6: DB 삽입

```bash
cd ..
node dist/insert_to_supabase.js
```

---

## 📊 평가 기준

### LAAJ 평가 5개 항목

| 항목 | 코드명 | 평가 내용 | 점수 범위 |
|------|--------|----------|----------|
| 1 | `visit_authenticity` | 방문 여부 정확성 (실제 방문 vs 포장/배달/언급) | 0-4 |
| 2 | `location_accuracy` | 위치 정보 정확성 (지점명, 주소 정확도) | 0-3 |
| 3 | `menu_match` | 메뉴 일치도 (영상 메뉴 vs 실제 메뉴) | 0-3 |
| 4 | `information_accuracy` | 정보 정확성 (전화번호, 영업시간 등) | 0-2 |
| 5 | `overall_reliability` | 전반적 신뢰도 (종합 평가) | 0-2 |

**점수가 낮을수록 신뢰도가 높습니다.**

---

## 🔍 트러블슈팅

### 1. Perplexity 로그인 실패

**증상:**
```
❌ Perplexity 로그인 실패
```

**해결:**
1. `.env` 파일 확인
2. `perplexity-session.json` 삭제
3. 재시도

---

### 2. Naver API 오류

**증상:**
```
Error: Naver API quota exceeded
```

**해결:**
- Naver Cloud Platform에서 일일 할당량 확인
- 다른 API 키 사용

---

### 3. TypeScript 빌드 오류

**증상:**
```
error TS6059: File is not under 'rootDir'
```

**해결:**
- 이미 해결됨: inline 함수 사용

---

### 4. Supabase 연결 오류

**증상:**
```
Error: Invalid Supabase URL
```

**해결:**
1. `.env`의 `SUPABASE_URL` 확인
2. Service Key가 올바른지 확인

---

## 🔗 관련 문서

- [Backend 전체 시스템](../README.md)
- [크롤링 시스템](../perplexity-restaurant-crawling/README.md)
- [공통 유틸리티](../utils/README.md)

---

**마지막 업데이트:** 2025-01-16
