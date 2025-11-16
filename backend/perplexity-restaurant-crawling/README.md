# 🍜 쯔양 레스토랑 크롤링 시스템# Tzudong Restaurant Info Crawler



YouTube 채널에서 영상 URL을 수집하고, Perplexity AI로 레스토랑 정보를 추출한 뒤, YouTube 메타데이터를 보강하는 자동화 크롤링 시스템입니다.TypeScript + Puppeteer를 사용하여 Perplexity AI에서 유튜브 맛집 정보를 자동으로 추출하는 크롤러입니다.



## 📚 목차## 주요 특징



- [시스템 개요](#-시스템-개요)- 🤖 **자동화된 크롤링**: Perplexity AI를 활용한 지능적인 맛집 정보 추출 (하나의 영상에서 여러 식당 동시 추출, AI 모델 자동 감지, 다중 JSON 파싱 개선)

- [크롤링 파이프라인](#-크롤링-파이프라인)- 🔐 **지능적 세션 관리**: 로그인 세션 자동 저장/복원으로 장시간 크롤링 지원 (세션 복원 성공 시 바로 크롤링 시작, 크롤링 중 로그인 풀릴 시 자동 감지 및 사용자 대기)

- [중복 처리 시스템](#-중복-처리-시스템)- 🔄 **자동 로그인 유지**: 세션 만료 시 자동 재로그인으로 중단 없는 작업

- [파일 설명](#-파일-설명)- 🧹 **깔끔한 데이터**: 출처 인용구 및 빈 괄호 자동 제거 ([1], [web:7], {ts:670}, [ts:286], {ts:27, ts:94}, ({ts:904-915}), (web:42), (web:6, web:21, web:23, web:24), ({ts:243, ts:250-296, ts:422}), {ts:526-563, ts:845}, {attached_file:1(ts:176, ts:514, ts:579)}, {ts:613, 643}, (ts:59) 등)로 완벽하게 깔끔한 JSON 데이터 생성

- [설치 및 설정](#-설치-및-설정)- 🌍 **다국어 주소 지원**: 국내(네이버 지도) 및 해외(구글 지도) 주소 좌표 자동 확보 (기존 좌표 있어도 강제 재확보)

- [실행 방법](#-실행-방법)- 📊 **배치 처리**: 대량의 유튜브 링크를 효율적으로 처리

- [출력 파일 구조](#-출력-파일-구조)- 🎯 **정확한 데이터 추출**: 영상 분석, 검색, 지도 검증을 통한 고품질 데이터

- [트러블슈팅](#-트러블슈팅)

## 설치 및 설정

---

```bash

## 🎯 시스템 개요cd backend

npm install

쯔양의 YouTube 채널에서 맛집 관련 영상 데이터를 자동으로 수집하고 가공하는 시스템입니다.```



### 주요 기능## 사용법



- ✅ **YouTube URL 자동 수집**: YouTube Data API로 채널의 모든 영상 URL 수집### 1. 전체 처리 (reasoning_basis 없는 항목만 처리 - 추천)

- 🤖 **AI 기반 크롤링**: Perplexity AI + Puppeteer로 영상별 레스토랑 정보 추출```bash

- 📊 **메타데이터 보강**: YouTube API로 조회수, 좋아요, 댓글 수 등 추가npm run start

- 🎯 **광고 분석**: OpenAI로 영상 내 광고 브랜드 자동 탐지```

- 🔄 **중복 제거**: 전 과정에서 이미 처리된 URL 자동 필터링**모든 개선사항 적용됨**: 전체화면 브라우저, Shift+Enter 입력, Gemini 2.5 Pro 자동 선택, 정확한 필터링 등 모든 최신 기능 포함

- 💾 **안전한 저장**: Append 모드로 중단 시에도 데이터 손실 없음

### 1.5. 수동 시작 모드 (각 항목마다 확인)

---```bash

npm run manual-start

## 🔄 크롤링 파이프라인```

**수동 모드**: 각 항목 처리 전에 사용자 확인을 받음

```

┌─────────────────────────────────────────────────────────────────┐### 1.6. 데이터 초기화 (reasoning_basis 재처리용)

│                  🍜 크롤링 파이프라인 (3단계)                      │```bash

└─────────────────────────────────────────────────────────────────┘npm run reset

```

┌──────────────────┐**데이터 초기화**: youtube_link 유지하고 restaurants 배열을 빈 배열로 초기화 (다중 레스토랑 정보 저장용)

│  YouTube Channel │

│    (쯔양 채널)    │### 1.7. 좌표 정보 보완 (Naver/Google Maps API)

└────────┬─────────┘```bash

         │npm run enrich-coordinates

         ▼```

┌─────────────────────────────────────────────────────────────────┐**좌표 보완**: 기존 데이터 중 좌표가 없는 항목들의 주소를 지도 API로 조회하여 lat/lng 정보를 채워줍니다

│  STEP 1: YouTube URL 수집                                       │- **국내 주소**: 네이버 지도 API 사용

│  📄 api-tzuyang-youtubeVideo-urls.py                            │- **해외 주소**: 구글 지도 자동 검색 및 좌표 추출 (터키, 일본, 미국 등 지원)

├─────────────────────────────────────────────────────────────────┤

│  • YouTube Data API로 채널의 모든 영상 URL 수집                  │### 1.8. 로그인 상태 테스트

│  • 기존 URL과 중복 체크                                          │```bash

│  • 신규 URL만 추가                                              │npm run test-login

│                                                                 │```

│  출력: tzuyang_youtubeVideo_urls.txt (961+ URLs)                │**로그인 테스트**: 퍼플렉시티의 현재 로그인 상태를 확인하고 자동 재로그인을 시도합니다.

└────────┬────────────────────────────────────────────────────────┘

         │### 1.9. 세션 관리 테스트

         ▼```bash

┌─────────────────────────────────────────────────────────────────┐npm run test-session

│  STEP 2: Perplexity 레스토랑 데이터 수집                         │```

│  📄 index.ts (TypeScript + Puppeteer)                           │**세션 테스트**: 브라우저 세션 저장/복원 기능을 테스트합니다.

├─────────────────────────────────────────────────────────────────┤

│  • Perplexity AI에 영상 URL 제공                                │### 1.10. 출처 인용구 제거

│  • 브라우저 자동화로 레스토랑 정보 추출                           │```bash

│  • 이미 처리된 URL 스킵                                          │npm run clean-citations

│                                                                 │```

│  출력: tzuyang_restaurant_results.jsonl                         │**인용구 정리**: 기존 데이터에서 모든 출처 인용구와 빈 괄호를 자동 제거합니다.

│  (각 영상의 레스토랑 리스트)                                      │- **기존 패턴**: [attached_file:1], [attached-file:1], [web:7], [2], [3], {ts:670}, (, , , )

└────────┬────────────────────────────────────────────────────────┘- **새로운 패턴**: [ts:286], {ts:27, ts:94}, {ts:310, ts:343, ts:424}, ({ts:904-915}), {ts:196-228}, {ts:1037, ts:1047}, [attached_file:1(ts:715, ts:754)], (web:42), (web:6, web:21, web:23, web:24), ({ts:243, ts:250-296, ts:422}), {ts:526-563, ts:845}, {attached_file:1(ts:176, ts:514, ts:579)}, {ts:613, 643}, (ts:59)

         │- **범위 패턴**: {ts:196-228}, ({ts:904-915}), ts:250-296, ts:526-563 등 타임스탬프 범위 표기 지원

         ▼- **복수 패턴**: {ts:27, ts:94}, {ts:1037, ts:1047}, (web:6, web:21, web:23, web:24), {ts:526-563, ts:845}, {ts:613, 643} 등 여러 참조 동시 표기 지원

┌─────────────────────────────────────────────────────────────────┐- **복합 패턴**: ({ts:243, ts:250-296, ts:422}), {attached_file:1(ts:176, ts:514, ts:579)}처럼 괄호+중괄호 조합에 범위까지 포함된 복잡한 패턴 지원

│  STEP 3: YouTube 메타데이터 추가                                 │

│  📄 api-youtube-meta.py                                         │## 세션 관리

├─────────────────────────────────────────────────────────────────┤

│  • YouTube Data API로 영상 메타데이터 추가                       │크롤러는 브라우저 세션을 자동으로 관리하여 장시간 크롤링 시 로그인 세션 만료 문제를 해결합니다.

│    - 제목, 업로드 날짜                                           │

│    - 조회수, 좋아요, 댓글 수                                      │### 세션 저장/복원 기능

│    - 영상 길이 (초)                                             │

│  • OpenAI API로 광고 브랜드 분석                                 │- **자동 세션 저장**: 크롤링 종료 시 쿠키, 로컬 스토리지, 세션 스토리지를 `perplexity-session.json` 파일로 저장

│  • 이미 메타데이터가 있는 URL 스킵                                │- **자동 세션 복원**: 다음 실행 시 저장된 세션을 복원하여 재로그인 불필요

│                                                                 │- **세션 유효성 검사**: 24시간 이상 경과된 세션은 자동 폐기

│  출력: tzuyang_restaurant_results_with_meta.jsonl               │- **안전한 폴백**: 세션 복원 실패 시 새 세션으로 시작

│  (완전한 레스토랑 + 메타데이터)                                   │- **빠른 시작**: 세션 복원 성공 시 안전 확인 단계 생략하고 바로 크롤링 시작

└─────────────────────────────────────────────────────────────────┘

```### 로그인 유지 메커니즘



---1. **프로그램 시작 시**: 저장된 세션 자동 복원

2. **크롤링 중**: 각 항목 처리 전후로 로그인 상태 실시간 확인

## 🔐 중복 처리 시스템3. **세션 만료 자동 감지**: 로그인 모달이 나타나면 즉시 사용자에게 알림

4. **사용자 대기 모드**: 로그인이 풀리면 터미널에서 아무 키 입력 대기

각 단계에서 **이미 처리된 데이터를 자동으로 감지하고 스킵**하여 효율성을 극대화합니다.5. **프로그램 종료 시**: 현재 세션 자동 저장



### 단계별 중복 검사### 크롤링 중 로그인 풀림 대응



| 단계 | 파일 | 중복 기준 | 검사 방식 | 저장 방식 |크롤링 진행 중 Google 로그인이 만료되면 자동으로 감지하여 사용자에게 알려줍니다:

|------|------|----------|----------|----------|

| **STEP 1** | `api-tzuyang-youtubeVideo-urls.py` | `youtube_url` | 기존 txt 파일 전체 로드 → Set 비교 | **append** 모드 |```

| **STEP 2** | `index.ts` (process-remaining.ts) | `youtube_link` | inline 함수로 JSONL 파싱 → Set 비교 | **append** 모드 |🚨 [로그인 필요] Perplexity AI 로그인 상태가 풀렸습니다!

| **STEP 3** | `api-youtube-meta.py` | `youtube_link` | `load_processed_urls()` 유틸리티 함수 | **append** 모드 |📋 다음을 확인하세요:

   1. Chrome 브라우저가 열려 있는지 확인

### STEP 1: YouTube URL 수집 중복 처리   2. 브라우저에서 Google 로그인을 완료해주세요

   3. Perplexity AI 페이지가 정상적으로 로드되었는지 확인

```python   4. 모든 준비가 완료되었으면 터미널로 돌아와서 아무 키나 누르세요

# api-tzuyang-youtubeVideo-urls.py

⌨️  로그인 완료 후 아무 키나 눌러서 크롤링을 계속하세요...

def load_existing_urls(file_path: Path) -> set:```

    """기존 파일에서 URL 로드"""

    existing_urls = set()사용자가 브라우저에서 로그인을 완료한 후 터미널로 돌아와 아무 키나 누르면 크롤링이 자동으로 계속됩니다. 이로써 수시간 동안 크롤링을 해도 로그인 세션으로 인한 중단이 발생하지 않습니다.

    if file_path.exists():

        with open(file_path, 'r', encoding='utf-8') as f:### 세션 관리 팁

            for line in f:

                url = line.strip()- **최초 실행**: 브라우저에서 수동으로 로그인한 후 프로그램을 종료하면 세션이 저장됩니다

                if url:- **이후 실행**: 자동으로 로그인 세션이 복원되어 재로그인 필요 없습니다

                    existing_urls.add(url)- **세션 삭제**: `perplexity-session.json` 파일을 삭제하면 새 세션으로 시작합니다

    return existing_urls- **긴급 상황**: 브라우저 창이 보이므로 직접 로그인할 수도 있습니다



def save_new_urls(video_urls: list, existing_urls: set, output_path: Path):### 2. 남은 항목만 배치 처리 (최대 10개씩)

    """새로운 URL만 필터링하여 추가"""```bash

    new_videos = [v for v in video_urls if v['url'] not in existing_urls]npm run process

    ```

    # Append 모드로 안전하게 추가

    with open(output_path, 'a', encoding='utf-8') as f:### 3. 개발 모드 실행

        for video in new_videos:```bash

            f.write(video['url'] + '\n')npm run dev

``````



**특징:**### 4. 로그인 감지 테스트

- ✅ 기존 URL Set 전체를 메모리에 로드```bash

- ✅ 신규 URL만 필터링npm run test-login

- ✅ Append 모드로 기존 데이터 보존```



---### 5. 테스트 모드 (1개 항목만 처리)

```bash

### STEP 2: Perplexity 크롤링 중복 처리npm run test-process

```

```typescript

// process-remaining.ts### 6. 입력 방식 테스트

```bash

function loadProcessedUrls(filePath: string): Set<string> {npm run test-input

  const urls = new Set<string>();```

  

  if (!existsSync(filePath)) return urls;## 파일 구조

  

  const content = readFileSync(filePath, 'utf-8');```

  const lines = content.trim().split('\n').filter(line => line.trim());backend/

  ├── src/

  for (const line of lines) {│   ├── index.ts              # 메인 크롤러 (전체 처리)

    try {│   ├── process-remaining.ts  # 배치 처리 (남은 항목만)

      const data = JSON.parse(line);│   ├── perplexity-crawler.ts # 퍼플렉시티 크롤링 로직

      if (data.youtube_link) {│   ├── jsonl-processor.ts    # JSONL 파일 처리 유틸리티

        urls.add(data.youtube_link);│   └── types.ts              # TypeScript 타입 정의

      }├── package.json

    } catch (e) {├── tsconfig.json

      // 파싱 실패 무시└── README.md

    }```

  }

  ## 개선사항 (최신)

  return urls;

}- **다중 레스토랑 추출**: 하나의 YouTube 영상에서 여러 개의 레스토랑 정보를 모두 저장

- **쯔양 리뷰 요약**: 각 음식점마다 쯔양의 리뷰 내용을 상세하게 요약하여 저장

// 사용- **네이버 지도 좌표 보완**: 주소 정보를 네이버 지도 API로 조회하여 정확한 위도/경도 정보 추가 (항상 재확보하여 최신 좌표 보장)

const processedUrls = loadProcessedUrls('tzuyang_restaurant_results.jsonl');- **JSON 구조 변경**: RestaurantData 구조로 다중 레스토랑 정보 저장 지원

const newEntries = allEntries.filter(entry => !processedUrls.has(entry.youtube_link));- **다중 JSON 파싱 개선**: 복잡한 HTML 구조에서도 모든 JSON 응답을 정확하게 추출 (백업 파싱 로직 포함)

```- **AI 모델 자동 감지/선택**: Gemini 2.5 Pro 모델이 이미 선택되어 있으면 건너뛰고, 아니면 자동 선택 (세션당 한 번만)

- **Shift+Enter 줄바꿈 입력**: Perplexity AI 방식대로 줄바꿈하여 정확한 입력

**특징:**- **정확한 필터링**: reasoning_basis 유무로만 처리 여부 결정 (name 등 다른 필드는 null 허용)

- ✅ TypeScript inline 함수 (rootDir 제약)- **향상된 로그인 감지**: 다중 지표를 활용한 정확한 로그인 상태 판별

- ✅ JSONL 파싱하여 youtube_link 추출- **전체화면 브라우저**: 크롬 브라우저가 최대화된 상태로 실행 (1920x1080)

- ✅ Set 기반 빠른 조회 (O(1))- **확장된 타임아웃**: 브라우저 안정성을 위한 타임아웃 증가 (60s → 120s)

- **디버깅 정보**: 로그인 감지 상태 상세 출력으로 문제 해결 용이

---- **입력창 안정성**: 로그인 중에도 안전하게 입력창 대기 및 검증



### STEP 3: 메타데이터 추가 중복 처리## 동작 방식



```python1. **브라우저 초기화**: 최대화된 Chrome 브라우저 실행 (1920x1080)

# api-youtube-meta.py2. **페이지 이동**: Perplexity AI 메인 페이지 접속

3. **입력창 확인**: 로그인 상태와 입력창 로드 상태 확인 (60초 대기)

from duplicate_checker import load_processed_urls, append_to_jsonl4. **사용자 확인**: 브라우저 상태 확인 후 수동 시작 (안전한 크롤링)

5. **AI 모델 감지/선택**: Gemini 2.5 Pro 모델이 이미 선택되어 있으면 건너뛰고, 아니면 자동 선택 (첫 번째 항목에서만)

# 이미 메타데이터가 추가된 URL 로드6. **프롬프트 입력**: Shift+Enter로 줄바꿈하여 Perplexity AI 방식대로 입력

processed_urls = load_processed_urls(output_file)7. **응답 대기**: JSON 응답이 나타날 때까지 최대 10분 대기

8. **데이터 추출**: JSON 코드 블록에서 다중 레스토랑 데이터 및 쯔양 리뷰를 파싱

# 입력 파일에서 새로운 레코드만 필터링9. **좌표 보완**: 주소 정보를 네이버 지도 API로 조회하여 위도/경도 정보 추가

new_records = []10. **파일 업데이트**: `tzuyang_restaurant_results.jsonl` 파일의 restaurants 배열에 데이터 추가

with open(input_file, 'r', encoding='utf-8') as f:11. **반복**: 다음 reasoning_basis 없는 항목을 찾아서 전체 처리 완료까지 반복

    for line in f:

        record = json.loads(line)## 로그인 설정 (중요!)

        youtube_link = record.get('youtube_link')

        if youtube_link not in processed_urls:### 안전한 수동 확인 시스템 ✅

            new_records.append(record)

크롤링 시작 전에 **항상 사용자 확인**을 받습니다:

# 각 레코드 처리 후 즉시 append

for record in new_records:- **브라우저 상태 확인**: 로그인 상태와 페이지 로드 상태를 표시

    enriched = add_youtube_metadata(record)- **수동 시작 제어**: 사용자가 준비될 때까지 대기

    append_to_jsonl(output_file, enriched)- **안전한 진행**: 자동 시작을 방지하여 안정성 확보

```

### 확인 절차 (첫 번째 항목만):

**특징:**

- ✅ 공통 유틸리티 함수 사용 (`../utils/duplicate_checker.py`)1. 크롤러 실행 시 Chrome 브라우저가 열립니다

- ✅ 처리 후 즉시 append (중단 시에도 안전)2. 브라우저에서 Perplexity AI 페이지가 로드됩니다

- ✅ 이미 처리된 URL 자동 스킵3. **터미널에 로그인 상태 및 입력창 상태 정보가 표시됩니다**

4. 필요한 경우 브라우저에서 수동으로 로그인하세요

---5. 입력창이 나타날 때까지 기다렸다가 준비되면 **터미널로 돌아와 아무 키나 누르세요**

6. **AI 모델이 Gemini 2.5 Pro로 자동 감지/설정됩니다** (이미 선택되어 있으면 건너뜀, 첫 번째 항목에서만)

### 중복 처리 최적화7. 첫 번째 크롤링이 시작되고, 이후 항목들은 **자동으로 연속 처리**됩니다



1. **메모리 기반 Set 사용**### 로그인 감지 테스트:

   - O(1) 시간 복잡도로 빠른 조회

   - 수천 개 URL도 빠르게 처리로그인 감지 로직을 테스트하려면:

```bash

2. **Append 모드 사용**npm run test-login

   - 기존 데이터 절대 손실 없음```

   - 중단 후 재실행 시 이어서 처리

이 명령은 브라우저를 열고 현재 로그인 상태를 분석하여 결과를 출력합니다.

3. **즉시 저장**

   - 각 레코드 처리 후 바로 파일에 기록### 테스트 실행 방법:

   - 예상치 못한 중단에도 안전

```bash

---# 로그인 감지 기능 테스트

cd backend

## 📄 파일 설명npm run build

node test-login.js

### 실행 스크립트

# 실제 크롤링 (첫 번째 항목만)

| 파일 | 언어 | 설명 |set TEST_MODE=true && npx tsx src/process-remaining.ts

|------|------|------|

| `crawling-pipeline.py` | Python | 3단계 크롤링 통합 실행 스크립트 |# 배치 크롤링 (최대 10개씩)

| `api-tzuyang-youtubeVideo-urls.py` | Python | YouTube Data API로 영상 URL 수집 |npx tsx src/process-remaining.ts

| `index.ts` | TypeScript | Perplexity AI 크롤러 (Puppeteer) |```

| `process-remaining.ts` | TypeScript | 남은 URL 처리 (중복 스킵) |

| `api-youtube-meta.py` | Python | YouTube 메타데이터 + 광고 분석 |**참고**: 로그인 정보는 저장되지 않으며, 각 세션마다 수동 로그인이 필요할 수 있습니다.



### 헬퍼 스크립트## 주의사항



| 파일 | 설명 |- **헤드리스 모드**: 디버깅을 위해 헤드리스 모드를 해제했음 (필요시 수정 가능)

|------|------|- **요청 간격**: 서버 부하 방지를 위해 각 요청 사이에 5-10초 대기

| `test-single.js` | 단일 URL 테스트용 |- **타임아웃**: 응답 대기 시간은 최대 10분으로 설정

| `test-login.js` | Perplexity 로그인 테스트 |- **오류 처리**: 개별 항목 처리 실패 시 다음 항목으로 계속 진행

| `clean-citations.js` | 결과 데이터 정리 |

| `reset-data.js` | 데이터 초기화 |## HTML 구조 기반 구현



### 출력 파일크롤러는 제공된 HTML 구조를 기반으로 구현되었습니다:



| 파일 | 형식 | 레코드 수 | 설명 |- **입력창**: `#ask-input` (contenteditable div)

|------|------|----------|------|- **제출**: Enter 키 입력

| `tzuyang_youtubeVideo_urls.txt` | TXT | 961+ | YouTube 영상 URL 목록 |- **응답**: `pre code` 요소 내 JSON 데이터

| `tzuyang_restaurant_results.jsonl` | JSONL | ~1500 | Perplexity 크롤링 결과 |- **검색 모드**: 기본적으로 "search" 모드 사용

| `tzuyang_restaurant_results_with_meta.jsonl` | JSONL | ~1500 | 메타데이터 추가 완료 |

## 오류 해결

---

### 브라우저 실행 실패

## 🔧 설치 및 설정```bash

# Windows에서 추가 인자 필요할 수 있음

### 1. Python 패키지 설치# src/perplexity-crawler.ts의 launch 옵션 확인

```

```bash

pip install google-api-python-client openai python-dotenv### 파일 경로 문제

``````bash

# JSONL 파일 경로가 맞는지 확인

### 2. Node.js 패키지 설치# 기본값: ../../../tzuyang_restaurant_results.jsonl

```

```bash

npm install### 네트워크 타임아웃

``````bash

# 인터넷 연결 상태 확인

주요 패키지:# VPN이나 프록시 설정 확인

- `puppeteer` - 브라우저 자동화```

- `dotenv` - 환경 변수 관리

## 확장 및 커스터마이징

### 3. TypeScript 빌드

### 새로운 프롬프트 템플릿

```bash`src/index.ts` 또는 `src/process-remaining.ts`의 `PROMPT_TEMPLATE` 변수 수정

npm run build

```### 다른 AI 서비스 연동

`src/perplexity-crawler.ts`의 `processYouTubeLink` 메서드 수정

### 4. 환경 변수 설정

### 배치 크기 조정

`.env` 파일 생성:`src/process-remaining.ts`의 `maxToProcess` 변수 수정


```env
# YouTube Data API
YOUTUBE_API_KEY_BYEON=your_youtube_api_key_here

# OpenAI API (광고 분석용)
OPENAI_API_KEY_BYEON=your_openai_api_key_here

# Perplexity 계정
PERPLEXITY_EMAIL=your_email@example.com
PERPLEXITY_PASSWORD=your_password_here
```

**API 키 발급:**
- YouTube: https://console.cloud.google.com/
- OpenAI: https://platform.openai.com/api-keys
- Perplexity: https://www.perplexity.ai/ 회원가입

---

## 🚀 실행 방법

### 방법 1: 통합 파이프라인 (권장)

**3단계를 자동으로 순차 실행:**

```bash
cd src
python crawling-pipeline.py
```

---

### 방법 2: 단계별 실행

#### STEP 1: YouTube URL 수집

```bash
cd src
python api-tzuyang-youtubeVideo-urls.py
```

**출력:**
```
🍜 쯔양 YouTube 채널 URL 수집 시작!
============================================================

📂 기존 파일 발견: ../tzuyang_youtubeVideo_urls.txt
   기존 URL 개수: 961개

📄 페이지 1 로딩 중...
   ✅ 50개 동영상 추가 (누적: 50개)

🎉 총 980개의 동영상을 찾았습니다!

📝 새로운 동영상 19개 발견!

💾 ../tzuyang_youtubeVideo_urls.txt에 19개의 새 URL 추가 완료!
📊 전체 URL 개수: 961 → 980개
```

---

#### STEP 2: Perplexity 크롤링

```bash
npm run start
```

또는 남은 항목만 처리:

```bash
npm run process-remaining
```

**출력:**
```
🔍 처리 대상 확인 중...
   전체 URL: 980개
   이미 처리됨: 961개
   새로 처리할 URL: 19개

🚀 크롤링 시작...
[1/19] https://youtube.com/watch?v=...
   ✅ 3개 레스토랑 추출 완료
```

---

#### STEP 3: 메타데이터 추가

```bash
cd src
python api-youtube-meta.py
```

**출력:**
```
📊 입력 파일: ../tzuyang_restaurant_results.jsonl
📊 출력 파일: ../tzuyang_restaurant_results_with_meta.jsonl

🔍 기존 처리 내역 확인 중...
   ✅ 이미 처리된 URL: 961개

📋 새로 처리할 레코드: 19개

[1/19] 처리 중...
   제목: 맛집 탐방
   조회수: 1,234,567
   좋아요: 50,000
   광고: ['브랜드A', '브랜드B']
   ✅ 완료

💾 총 19개 레코드 처리 완료!
```

---

## 📊 출력 파일 구조

### `tzuyang_youtubeVideo_urls.txt`

```
https://www.youtube.com/watch?v=ABC123
https://www.youtube.com/watch?v=DEF456
https://www.youtube.com/watch?v=GHI789
...
```

---

### `tzuyang_restaurant_results.jsonl`

```json
{
  "youtube_link": "https://youtube.com/watch?v=...",
  "restaurants": [
    {
      "name": "맛집 이름",
      "address": "서울특별시 강남구...",
      "category": "한식",
      "menu": "대표 메뉴",
      "tzuyang_review": "너무 맛있어요",
      "reasoning_basis": "영상 0:30에서 언급"
    }
  ]
}
```

---

### `tzuyang_restaurant_results_with_meta.jsonl`

```json
{
  "youtube_link": "https://youtube.com/watch?v=...",
  "youtube_title": "엄청난 맛집 탐방!",
  "youtube_published_at": "2024-01-15T10:00:00Z",
  "youtube_view_count": 1234567,
  "youtube_like_count": 50000,
  "youtube_comment_count": 3000,
  "youtube_duration_seconds": 720,
  "video_category": "음식점",
  "ad_brands": ["브랜드A", "브랜드B"],
  "restaurants": [
    {
      "name": "맛집 이름",
      "address": "서울특별시 강남구...",
      "category": "한식",
      "menu": "대표 메뉴",
      "tzuyang_review": "너무 맛있어요"
    }
  ]
}
```

---

## 🔍 트러블슈팅

### 1. YouTube API Quota 초과

**증상:**
```
Error 403: quotaExceeded
```

**원인:**
- YouTube Data API 일일 할당량: 10,000 units
- 영상 정보 조회 1회 = 1 unit
- 메타데이터 조회 1회 = 1 unit

**해결:**
1. 다음 날까지 대기 (자정 PST 시간에 리셋)
2. 다른 Google Cloud 프로젝트에서 새 API 키 발급
3. 할당량 증가 신청 (Google Cloud Console)

---

### 2. Perplexity 로그인 실패

**증상:**
```
❌ Perplexity 로그인 실패
```

**해결:**
1. `.env` 파일의 이메일/비밀번호 확인
2. `perplexity-session.json` 삭제 후 재시도
   ```bash
   rm perplexity-session.json
   ```
3. Perplexity 계정이 활성 상태인지 확인
4. 로그인 테스트 실행:
   ```bash
   node test-login.js
   ```

---

### 3. Puppeteer 브라우저 실행 오류

**증상:**
```
Error: Failed to launch the browser process
```

**해결 (macOS):**
```bash
# Chromium 수동 설치
npm install puppeteer --force

# 권한 문제 해결
xattr -d com.apple.quarantine node_modules/puppeteer/.local-chromium/mac-*/chrome-mac/Chromium.app
```

**해결 (Linux):**
```bash
# 필수 라이브러리 설치
sudo apt-get install -y \
  libnss3 libatk1.0-0 libatk-bridge2.0-0 \
  libcups2 libdrm2 libxkbcommon0 libxcomposite1 \
  libxdamage1 libxfixes3 libxrandr2 libgbm1 libasound2
```

---

### 4. 중복 URL이 계속 처리됨

**증상:**
- 같은 URL이 반복해서 크롤링됨

**해결:**
1. 출력 파일 경로 확인
   ```bash
   ls -la ../tzuyang_restaurant_results.jsonl
   ```

2. 파일 권한 확인
   ```bash
   chmod 644 ../tzuyang_restaurant_results.jsonl
   ```

3. 중복 검사 로직이 활성화되어 있는지 코드 확인

---

### 5. OpenAI API 토큰 초과

**증상:**
```
Error: This model's maximum context length is 8192 tokens
```

**해결:**
```python
# api-youtube-meta.py에서 제목/설명 길이 제한
title = title[:500]  # 500자로 제한
description = description[:1000]  # 1000자로 제한
```

---

## 📈 성능 최적화

### 크롤링 속도

- **단일 스레드**: ~3-5초/영상
- **예상 소요 시간**: 
  - 100개 영상: 5-8분
  - 1000개 영상: 50-80분

### 메모리 사용량

- **Python**: ~50-100MB
- **Node.js (Puppeteer)**: ~200-500MB (Chromium)

### API 호출 제한

- **YouTube Data API**: 10,000 units/day
- **OpenAI API**: GPT-3.5-turbo 기준, 분당 3,500 requests
- **Perplexity**: 로그인 세션 유지로 무제한

---

## 🤖 Headless 모드 실행 가이드

### Headless 모드란?

GitHub Actions 및 서버 환경에서 브라우저 UI 없이 백그라운드로 실행하는 모드입니다.

### 실행 방법

#### 1. TypeScript 직접 실행
```bash
npx tsx headless_index.ts
```

#### 2. Python Pipeline 실행 (권장)
```bash
python3 headless-crawling-pipeline.py
```

### 일반 모드 vs Headless 모드

| 항목 | 일반 모드 (`npm run start`) | Headless 모드 (`headless_index.ts`) |
|------|---------------------------|----------------------------------|
| 브라우저 UI | ✅ 있음 (디버깅 가능) | ❌ 없음 (백그라운드) |
| 세션 파일 | `perplexity-session.json` | `headless-perplexity-session.json` |
| 사용자 입력 | ✅ 필요 (로그인, 확인) | ❌ 불필요 (자동 처리) |
| 서버 환경 | ❌ 부적합 | ✅ 최적화 |
| 통계 수집 | ❌ 없음 | ✅ 자동 (`backend/headless_stats/`) |
| 실행 속도 | 🐢 느림 (UI 렌더링) | ⚡ 빠름 (UI 생략) |

### Headless 모드 특징

- 🤖 **완전 자동화**: 브라우저 UI 없이 백그라운드 실행
- 🔄 **세션 자동 복원**: `headless-perplexity-session.json` 자동 로드
- 📊 **통계 자동 수집**: `backend/headless_stats/` 폴더에 JSON 저장
- 🎯 **CI/CD 최적화**: GitHub Actions 등에서 바로 실행 가능

### 통계 파일 위치

```
backend/headless_stats/
├── crawling_stats_20250116_123456.json  # 수집 통계
├── evaluation_stats_20250116_130000.json  # 평가 통계
└── pipeline_stats_20250116_140000.json  # 통합 통계
```

---

## 🔗 관련 문서

- [Backend 전체 시스템](../README.md)
- [평가 시스템](../perplexity-restaurant-evaluation/README.md)
- [공통 유틸리티](../utils/README.md)

---

**마지막 업데이트:** 2025-01-16
