# Tzudong Restaurant Info Crawler

TypeScript + Puppeteer를 사용하여 Perplexity AI에서 유튜브 맛집 정보를 자동으로 추출하는 크롤러입니다.

## 설치 및 설정

```bash
cd backend
npm install
```

## 사용법

### 1. 전체 처리 (reasoning_basis 없는 항목만 처리 - 추천)
```bash
npm run start
```
**모든 개선사항 적용됨**: 전체화면 브라우저, Shift+Enter 입력, Gemini 2.5 Pro 자동 선택, 정확한 필터링 등 모든 최신 기능 포함

### 1.5. 수동 시작 모드 (각 항목마다 확인)
```bash
npm run manual-start
```
**수동 모드**: 각 항목 처리 전에 사용자 확인을 받음

### 1.6. 데이터 초기화 (reasoning_basis 재처리용)
```bash
npm run reset
```
**데이터 초기화**: youtube_link 유지하고 restaurants 배열을 빈 배열로 초기화 (다중 레스토랑 정보 저장용)

### 1.7. 좌표 정보 보완 (Naver Map API)
```bash
npm run enrich-coordinates
```
**좌표 보완**: 기존 데이터 중 좌표가 없는 항목들의 주소를 네이버 지도 API로 조회하여 lat/lng 정보를 채워줍니다

### 2. 남은 항목만 배치 처리 (최대 10개씩)
```bash
npm run process
```

### 3. 개발 모드 실행
```bash
npm run dev
```

### 4. 로그인 감지 테스트
```bash
npm run test-login
```

### 5. 테스트 모드 (1개 항목만 처리)
```bash
npm run test-process
```

### 6. 입력 방식 테스트
```bash
npm run test-input
```

## 파일 구조

```
backend/
├── src/
│   ├── index.ts              # 메인 크롤러 (전체 처리)
│   ├── process-remaining.ts  # 배치 처리 (남은 항목만)
│   ├── perplexity-crawler.ts # 퍼플렉시티 크롤링 로직
│   ├── jsonl-processor.ts    # JSONL 파일 처리 유틸리티
│   └── types.ts              # TypeScript 타입 정의
├── package.json
├── tsconfig.json
└── README.md
```

## 개선사항 (최신)

- **다중 레스토랑 추출**: 하나의 YouTube 영상에서 여러 개의 레스토랑 정보를 모두 저장
- **쯔양 리뷰 요약**: 각 음식점마다 쯔양의 리뷰 내용을 상세하게 요약하여 저장
- **네이버 지도 좌표 보완**: 주소 정보를 네이버 지도 API로 조회하여 정확한 위도/경도 정보 추가
- **JSON 구조 변경**: RestaurantData 구조로 다중 레스토랑 정보 저장 지원
- **AI 모델 자동 선택**: Gemini 2.5 Pro 모델 세션당 한 번만 선택 (중복 방지)
- **Shift+Enter 줄바꿈 입력**: Perplexity AI 방식대로 줄바꿈하여 정확한 입력
- **정확한 필터링**: reasoning_basis 유무로만 처리 여부 결정 (name 등 다른 필드는 null 허용)
- **향상된 로그인 감지**: 다중 지표를 활용한 정확한 로그인 상태 판별
- **전체화면 브라우저**: 크롬 브라우저가 최대화된 상태로 실행 (1920x1080)
- **확장된 타임아웃**: 브라우저 안정성을 위한 타임아웃 증가 (60s → 120s)
- **디버깅 정보**: 로그인 감지 상태 상세 출력으로 문제 해결 용이
- **입력창 안정성**: 로그인 중에도 안전하게 입력창 대기 및 검증

## 동작 방식

1. **브라우저 초기화**: 최대화된 Chrome 브라우저 실행 (1920x1080)
2. **페이지 이동**: Perplexity AI 메인 페이지 접속
3. **입력창 확인**: 로그인 상태와 입력창 로드 상태 확인 (60초 대기)
4. **사용자 확인**: 브라우저 상태 확인 후 수동 시작 (안전한 크롤링)
5. **AI 모델 선택**: Gemini 2.5 Pro 모델 자동 선택 (첫 번째 항목에서만)
6. **프롬프트 입력**: Shift+Enter로 줄바꿈하여 Perplexity AI 방식대로 입력
7. **응답 대기**: JSON 응답이 나타날 때까지 최대 10분 대기
8. **데이터 추출**: JSON 코드 블록에서 다중 레스토랑 데이터 및 쯔양 리뷰를 파싱
9. **좌표 보완**: 주소 정보를 네이버 지도 API로 조회하여 위도/경도 정보 추가
10. **파일 업데이트**: `tzuyang_restaurant_results.jsonl` 파일의 restaurants 배열에 데이터 추가
11. **반복**: 다음 reasoning_basis 없는 항목을 찾아서 전체 처리 완료까지 반복

## 로그인 설정 (중요!)

### 안전한 수동 확인 시스템 ✅

크롤링 시작 전에 **항상 사용자 확인**을 받습니다:

- **브라우저 상태 확인**: 로그인 상태와 페이지 로드 상태를 표시
- **수동 시작 제어**: 사용자가 준비될 때까지 대기
- **안전한 진행**: 자동 시작을 방지하여 안정성 확보

### 확인 절차 (첫 번째 항목만):

1. 크롤러 실행 시 Chrome 브라우저가 열립니다
2. 브라우저에서 Perplexity AI 페이지가 로드됩니다
3. **터미널에 로그인 상태 및 입력창 상태 정보가 표시됩니다**
4. 필요한 경우 브라우저에서 수동으로 로그인하세요
5. 입력창이 나타날 때까지 기다렸다가 준비되면 **터미널로 돌아와 아무 키나 누르세요**
6. **AI 모델이 Gemini 2.5 Pro로 자동 설정됩니다** (첫 번째 항목에서만)
7. 첫 번째 크롤링이 시작되고, 이후 항목들은 **자동으로 연속 처리**됩니다

### 로그인 감지 테스트:

로그인 감지 로직을 테스트하려면:
```bash
npm run test-login
```

이 명령은 브라우저를 열고 현재 로그인 상태를 분석하여 결과를 출력합니다.

### 테스트 실행 방법:

```bash
# 로그인 감지 기능 테스트
cd backend
npm run build
node test-login.js

# 실제 크롤링 (첫 번째 항목만)
set TEST_MODE=true && npx tsx src/process-remaining.ts

# 배치 크롤링 (최대 10개씩)
npx tsx src/process-remaining.ts
```

**참고**: 로그인 정보는 저장되지 않으며, 각 세션마다 수동 로그인이 필요할 수 있습니다.

## 주의사항

- **헤드리스 모드**: 디버깅을 위해 헤드리스 모드를 해제했음 (필요시 수정 가능)
- **요청 간격**: 서버 부하 방지를 위해 각 요청 사이에 5-10초 대기
- **타임아웃**: 응답 대기 시간은 최대 10분으로 설정
- **오류 처리**: 개별 항목 처리 실패 시 다음 항목으로 계속 진행

## HTML 구조 기반 구현

크롤러는 제공된 HTML 구조를 기반으로 구현되었습니다:

- **입력창**: `#ask-input` (contenteditable div)
- **제출**: Enter 키 입력
- **응답**: `pre code` 요소 내 JSON 데이터
- **검색 모드**: 기본적으로 "search" 모드 사용

## 오류 해결

### 브라우저 실행 실패
```bash
# Windows에서 추가 인자 필요할 수 있음
# src/perplexity-crawler.ts의 launch 옵션 확인
```

### 파일 경로 문제
```bash
# JSONL 파일 경로가 맞는지 확인
# 기본값: ../../../tzuyang_restaurant_results.jsonl
```

### 네트워크 타임아웃
```bash
# 인터넷 연결 상태 확인
# VPN이나 프록시 설정 확인
```

## 확장 및 커스터마이징

### 새로운 프롬프트 템플릿
`src/index.ts` 또는 `src/process-remaining.ts`의 `PROMPT_TEMPLATE` 변수 수정

### 다른 AI 서비스 연동
`src/perplexity-crawler.ts`의 `processYouTubeLink` 메서드 수정

### 배치 크기 조정
`src/process-remaining.ts`의 `maxToProcess` 변수 수정
