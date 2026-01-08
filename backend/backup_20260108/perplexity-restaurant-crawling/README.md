# 🍜 쯔양 레스토랑 정보 수집 시스템

TypeScript + Puppeteer를 사용하여 Perplexity AI에서 유튜브 맛집 정보를 자동으로 추출하는 크롤러입니다.

## 주요 특징

- 🤖 **자동화된 크롤링**: Perplexity AI를 활용한 지능적인 맛집 정보 추출
- 🔐 **세션 관리**: 로그인 세션 자동 저장/복원으로 장시간 크롤링 지원
- 🔄 **자동 로그인 유지**: 세션 만료 시 자동 재로그인
- 🧹 **데이터 정제**: 출처 인용구 자동 제거 및 좌표 보완
- 🌍 **다국어 지원**: 국내(네이버) 및 해외(구글) 주소 좌표 자동 확보
- 📊 **병렬 처리**: 단일/병렬/고속 병렬 모드 지원
- 🎯 **AI 모델 선택**: Gemini 2.5 Pro 자동 선택
- 🗑️ **라이브러리 관리**: 각 수집 완료 후 자동 삭제
- 🔐 **중복 방지**: 이미 처리된 URL 자동 스킵

## 크롤링 파이프라인

```
┌─────────────────────────────────────────────────────────────────┐
│                  🍜 크롤링 파이프라인 (3단계)                      │
└─────────────────────────────────────────────────────────────────┘

┌──────────────────┐
│  YouTube Channel │
│    (쯔양 채널)    │
└────────┬─────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────────┐
│  STEP 1: YouTube URL 수집                                       │
│  📄 api-tzuyang-youtubeVideo-urls.py                            │
├─────────────────────────────────────────────────────────────────┤
│  • YouTube Data API로 채널의 모든 영상 URL 수집                  │
│  • 중복 검사: 기존 파일과 비교하여 새 URL만 추가                  │
│  • 출력: tzuyang_youtubeVideo_urls.txt                          │
└────────┬────────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────────┐
│  STEP 2: Perplexity AI 크롤링                                   │
│  📄 index.ts / headless-index.js (TypeScript + Puppeteer)       │
├─────────────────────────────────────────────────────────────────┤
│  • Perplexity AI로 영상별 레스토랑 정보 추출                      │
│  • 중복 검사: youtube_link 기반 (Set)                            │
│  • AI 모델: Gemini 2.5 Pro 자동 선택                            │
│  • 좌표 보완: 네이버/구글 지도 API                               │
│  • 출처 인용구 제거: [1], {ts:670}, (web:42) 등                 │
│  • 병렬 처리: 단일/병렬(3)/고속(5) 모드                           │
│  • 라이브러리 관리: 각 수집 완료 후 자동 삭제                     │
│  • 출력: tzuyang_restaurant_results.jsonl                       │
└────────┬────────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────────┐
│  STEP 3: YouTube 메타데이터 추가                                 │
│  📄 api-youtube-meta.py                                         │
├─────────────────────────────────────────────────────────────────┤
│  • YouTube API로 조회수, 좋아요, 댓글 수 추가                     │
│  • OpenAI로 광고 브랜드 자동 탐지                                │
│  • 중복 검사: 기존 파일과 비교                                    │
│  • 출력: tzuyang_restaurant_results_with_meta.jsonl             │
└─────────────────────────────────────────────────────────────────┘
```

## 중복 검사 시스템

### 검사 메커니즘

**1단계: 입력 파일 로드**
```typescript
// 파일: src/process-remaining.ts
const inputFilePath = 'tzuyang_youtubeVideo_urls.txt';
const allUrls = fs.readFileSync(inputFilePath, 'utf-8').split('\n');
```

**2단계: 이미 처리된 URL 로드**
```typescript
function loadProcessedUrls(filePath: string): Set<string> {
  const urls = new Set<string>();
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split('\n');
  
  for (const line of lines) {
    const data = JSON.parse(line);
    if (data.youtube_link) {
      urls.add(data.youtube_link);  // Set에 추가
    }
  }
  return urls;  // O(1) 조회 속도
}

// 처리된 URL 로드
const processedUrls = loadProcessedUrls('tzuyang_restaurant_results.jsonl');
```

**3단계: 미처리 URL 필터링**
```typescript
// 중복 제외
const remainingUrls = allUrls.filter(url => !processedUrls.has(url));
console.log(`미처리: ${remainingUrls.length}개`);
```

**4단계: 처리 및 즉시 저장**
```typescript
for (const url of remainingUrls) {
  const result = await crawler.processYouTubeLink(url);
  
  // Append 모드로 즉시 저장
  fs.appendFileSync('tzuyang_restaurant_results.jsonl', 
    JSON.stringify(result) + '\n'
  );
}
```

**5단계: 라이브러리 자동 삭제**
```typescript
// 각 URL 처리 완료 후
if (this.browserId === 0) {
  await this.deleteAllThreads();  // Library 삭제 + 홈으로 이동
}
```

### 중복 검사 특징

- **검사 대상**: `tzuyang_restaurant_results.jsonl`
- **검사 키**: `youtube_link` (YouTube URL)
- **자료구조**: `Set<string>` (O(1) 조회)
- **저장 방식**: Append 모드 (기존 데이터 보존)
- **중단 안전**: 각 항목 처리 후 즉시 저장
- **재실행 가능**: 이미 처리된 URL 자동 스킵

## 설치 및 설정

```bash
cd backend/perplexity-restaurant-crawling
npm install
npx tsc  # TypeScript 컴파일
```

### 환경 변수 설정

`.env` 파일 생성:

```env
YOUTUBE_API_KEY_BYEON=your_youtube_api_key
OPENAI_API_KEY_BYEON=your_openai_api_key
PERPLEXITY_EMAIL=your_perplexity_email
PERPLEXITY_PASSWORD=your_perplexity_password
```

## 사용법

### 1. 일반 모드 (브라우저 표시)

```bash
npm run start
# 또는
node dist/index.js
```

**처리 모드 선택**:
- **단일 모드**: 1개 브라우저, 순차 처리 (안정적)
- **병렬 모드**: 3개 브라우저, 동시 처리 (빠름)
- **고속 병렬 모드**: 5개 브라우저, 동시 처리 (가장 빠름)

### 2. 헤드리스 모드 (백그라운드)

```bash
npm run headless
# 또는
node dist/headless-index.js
```

백그라운드에서 브라우저 없이 실행됩니다.

### 3. Python 파이프라인 (헤드리스)

```bash
cd backend
conda activate tzudong
python headless-restaurant-pipeline.py
```

### 4. 데이터 초기화

```bash
npm run reset
```

### 5. 좌표 정보 보완

```bash
npm run enrich-coordinates
```

## 출력 파일

- `tzuyang_restaurant_results.jsonl`: 수집된 레스토랑 정보
- `perplexity-session.json`: 로그인 세션 데이터 (자동 생성)

## 데이터 구조

### `tzuyang_restaurant_results.jsonl`

크롤링 완료 후 출력 (메타데이터 없음)

```json
{
  "youtube_link": "https://www.youtube.com/watch?v=Mm76nsEkOIM",
  "restaurants": [
    {
      "name": "영생덕",
      "phone": "053-255-5777",
      "address": "대구 중구 종로 39",
      "lat": 35.8693928,
      "lng": 128.5913992,
      "category": "중식",
      "youtube_link": "https://www.youtube.com/watch?v=Mm76nsEkOIM",
      "reasoning_basis": "유튜버 쯔양이 영상에서 '영생덕'이라는 상호를 언급하고, '대구 중구 종로 39'라는 주소 자막을 통해 방문한 것을 확인함...",
      "tzuyang_review": "60년 전통의 중식 만두 전문점으로, 꾼만두, 물만두, 찐교스를 주문함..."
    },
    {
      "name": "삼화만두",
      "phone": "0507-1354-5651",
      "address": "대구 중구 남성로 58-1",
      "lat": 35.8670763,
      "lng": 128.5930564,
      "category": "분식",
      "youtube_link": "https://www.youtube.com/watch?v=Mm76nsEkOIM",
      "reasoning_basis": "영상에서 '삼화만두'라는 상호와 '대구 중구 남성로 58-1'라는 주소 자막을 통해 방문을 확인함...",
      "tzuyang_review": "우리나라 최초로 비빔만두를 개발한 원조집으로, 비빔만두, 찐만두, 쫄면을 주문함..."
    }
  ]
}
```

### `tzuyang_restaurant_results_with_meta.jsonl`

YouTube 메타데이터 추가 후 출력

```json
{
  "youtube_link": "https://www.youtube.com/watch?v=x6CqjKYFyiU",
  "restaurants": [
    {
      "name": "부산안면옥",
      "phone": "053-424-9389",
      "address": "대구광역시 중구 국채보상로125길 4-1",
      "lat": 35.8705982,
      "lng": 128.598939,
      "category": "한식",
      "youtube_link": "https://www.youtube.com/watch?v=x6CqjKYFyiU",
      "reasoning_basis": "유튜버 쯔양이 대구 공평동에 위치한 120년 전통의 냉면집을 방문했습니다...",
      "tzuyang_review": "쯔양은 이 식당의 여러 메뉴를 맛보고 극찬했습니다. 특히 평양냉면에 대해 입문자도 먹기 좋은 맛으로..."
    }
  ],
  "youtube_meta": {
    "title": "대구3) 6개월만 영업하는 120년 전통 냉면집?!😨 사장님이 이런사람은 처음이래요🤣",
    "publishedAt": "2025-08-19T12:02:00Z",
    "is_shorts": false,
    "duration": 944,
    "ads_info": {
      "is_ads": false,
      "what_ads": null
    }
  }
}
```

## 주요 기능

### 세션 관리
- 초기 로그인 후 세션 자동 저장
- 재실행 시 자동 세션 복원
- 세션 만료 시 자동 재로그인 프롬프트
- Chrome 프로필 공유: `~/.puppeteer-chrome-profile-perplexity`

### 데이터 정제
- 출처 인용구 제거: `[1]`, `{ts:670}`, `(web:42)` 등
- 빈 괄호 제거: `()`, `{}`, `[]`
- 좌표 자동 확보 (네이버/구글 지도 API)

### 병렬 처리
- 단일 모드: 1개 브라우저 (안정적)
- 병렬 모드: 3개 브라우저 (3배 속도)
- 고속 모드: 5개 브라우저 (5배 속도)

### 중복 방지
- `youtube_link` 기반 중복 검사
- JSONL 파일에서 처리된 URL 로드
- `Set<string>` 자료구조로 O(1) 조회
- Append 모드로 중단 시에도 데이터 손실 없음

## 트러블슈팅

### Google 로그인 차단

```
Couldn't sign you in - This browser or app may not be secure
```

**해결 방법**:

1. 세션 파일 및 프로필 삭제
```bash
rm -f perplexity-session.json
rm -rf ~/.puppeteer-chrome-profile-perplexity
```

2. 평가 시스템의 세션 복사 (이미 로그인된 경우)
```bash
cp ../perplexity-restaurant-evaluation/perplexity-session.json .
```

3. 재실행 후 수동 로그인

### Cloudflare CAPTCHA

```
Please unblock challenges.cloudflare.com
Verify you are human
```

**해결 방법**:
- 평가 시스템과 동일한 Chrome 설정 사용 (자동)
- 고정 프로필 디렉토리로 세션 유지
- Stealth 플러그인으로 봇 탐지 우회
- 문제 지속 시 세션 파일 재생성

### 라이브러리 삭제 실패

**해결 방법**:
- 홈 버튼 클릭 로직 개선됨
- URL 직접 이동 fallback 자동 실행
- `deleteAllThreads()` 함수에서 자동 처리

## 기술 스택

- **TypeScript**: 타입 안전성
- **Puppeteer Extra**: 브라우저 자동화
- **Stealth Plugin**: 봇 탐지 우회
- **Perplexity AI**: 맛집 정보 추출
- **Naver Maps API**: 국내 주소 좌표화
- **Google Maps**: 해외 주소 좌표화

## 라이센스

MIT
