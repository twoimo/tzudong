# Perplexity Restaurant Evaluation

Puppeteer를 사용하여 Perplexity AI로 식당 평가를 수행하는 시스템입니다.

## 설치 및 설정

1. 의존성 설치:
```bash
npm install
```

2. 환경 변수 설정 (.env 파일):
```
PERPLEXITY_SESSION_PATH=perplexity-session.json
NODE_ENV=development

# 로그인 모드 설정 (선택사항)
# true: 수동 로그인 모드 (브라우저에서 직접 로그인)
# false 또는 빈 값: 자동 로그인 모드 (기본값)
MANUAL_LOGIN=false
```

3. TypeScript 컴파일:
```bash
npm run build
```

## 로그인 방식

시스템은 두 가지 로그인 모드를 지원합니다:

### 자동 로그인 모드 (기본값)
- `MANUAL_LOGIN=false` 또는 설정하지 않음
- 시스템이 자동으로 Perplexity에 로그인 시도
- 구글 로그인을 우선적으로 시도한 후, 일반 Perplexity 로그인을 시도
- 로그인 성공을 여러 번 검증하고 입력 필드가 나타나는지 확인
- 로그인 성공이 확실할 때만 프롬프트 입력 진행
- 자동 로그인이 실패하면 수동 로그인으로 전환

### 수동 로그인 모드 (권장)
- `MANUAL_LOGIN=true`로 설정
- 브라우저 창이 열리면 사용자가 직접 Perplexity에 로그인
- 시스템이 로그인 상태를 최소한으로만 확인하고 바로 평가 진행
- 2FA나 복잡한 로그인 상황에 유용
- 가장 안정적이고 예측 가능한 방법

### 수동 로그인 사용법

1. `.env` 파일에서 `MANUAL_LOGIN=true` 설정
2. `npm run dev` 실행
3. 브라우저 창이 열리면 직접 Perplexity에 로그인
4. 로그인 완료 후 터미널에서 Enter 키 입력 (시스템이 자동으로 진행)
5. 시스템이 평가를 시작합니다

## 사용 방법

### 개발 모드 실행
```bash
npm run dev
```

### 프로덕션 모드 실행
```bash
npm run start
```

## 프롬프트 설정

`src/index.ts` 파일의 `EVALUATION_PROMPT_TEMPLATE` 변수에 평가용 프롬프트를 작성하세요.

## 출력 파일

평가 결과는 `tzuyang_restaurant_evaluation.jsonl` 파일에 저장됩니다.

## 구조

- `src/types.ts`: 타입 정의
- `src/perplexity-evaluator.ts`: Perplexity 제어 클래스
- `src/jsonl-processor.ts`: JSONL 파일 처리 클래스
- `src/index.ts`: 메인 실행 파일