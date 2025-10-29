# Tzudong Restaurant Info Crawler

TypeScript + Puppeteer를 사용하여 Perplexity AI에서 유튜브 맛집 정보를 자동으로 추출하는 크롤러입니다.

## 설치 및 설정

```bash
cd backend
npm install
```

## 사용법

### 1. 전체 처리 (모든 null 항목 처리 - 추천)
```bash
npm run start
```
**모든 개선사항 적용됨**: 전체화면 브라우저, Shift+Enter 입력, 향상된 로그인 감지 등 모든 최신 기능 포함

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

- **AI 모델 자동 선택**: Gemini 2.5 Pro 모델 자동 선택 및 설정
- **줄바꿈 고려 입력**: Perplexity AI 방식대로 Shift+Enter로 줄바꿈하여 정확한 입력
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
5. **AI 모델 선택**: Gemini 2.5 Pro 모델 자동 선택
6. **프롬프트 입력**: 줄바꿈을 고려하여 Shift+Enter로 정확한 입력
7. **응답 대기**: JSON 응답이 나타날 때까지 최대 10분 대기
8. **데이터 추출**: JSON 코드 블록에서 데이터를 파싱
9. **파일 업데이트**: `tzuyang_restaurant_results.jsonl` 파일의 해당 항목 업데이트
10. **반복**: 다음 null 항목을 찾아서 전체 처리 완료까지 반복

## 로그인 설정 (중요!)

### 안전한 수동 확인 시스템 ✅

크롤링 시작 전에 **항상 사용자 확인**을 받습니다:

- **브라우저 상태 확인**: 로그인 상태와 페이지 로드 상태를 표시
- **수동 시작 제어**: 사용자가 준비될 때까지 대기
- **안전한 진행**: 자동 시작을 방지하여 안정성 확보

### 확인 절차:

1. 크롤러 실행 시 Chrome 브라우저가 열립니다
2. 브라우저에서 Perplexity AI 페이지가 로드됩니다
3. **터미널에 로그인 상태 및 입력창 상태 정보가 표시됩니다**
4. 필요한 경우 브라우저에서 수동으로 로그인하세요
5. 입력창이 나타날 때까지 기다렸다가 준비되면 **터미널로 돌아와 아무 키나 누르세요**
6. **AI 모델이 Gemini 2.5 Pro로 자동 설정됩니다**
7. 크롤링이 시작됩니다

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
