# 🍽️ Perplexity Restaurant Evaluation System

Perplexity AI를 활용한 음식점 평가 자동화 시스템입니다. 크롤링된 음식점 데이터를 기반으로 평가 대상을 선정하고, 규칙 기반 평가 및 AI 평가를 수행합니다.

## 📋 시스템 개요

이 시스템은 다음과 같은 **순차적 3단계**로 음식점 평가를 수행합니다:

1. **평가 대상 선정** (Python) - 크롤링 데이터에서 평가할 음식점을 필터링
2. **규칙 기반 평가** (Python) - 카테고리 유효성과 위치 정합성 검증 (네이버/NCP API 활용)
3. **AI 평가 (LAAJ)** (TypeScript) - Perplexity AI를 통한 심층 평가 수행 (병렬 처리 지원)

**⚠️ 평가는 반드시 1→2→3 순서로 진행해야 합니다.**

## 🚀 설치 및 설정

### 1. 의존성 설치
```bash
npm install
```

### 2. 환경 변수 설정 (.env 파일)
```env
PERPLEXITY_SESSION_PATH=perplexity-session.json
NODE_ENV=development

# 로그인 모드 설정
MANUAL_LOGIN=true  # 수동 로그인 권장 (브라우저에서 직접 로그인)

# 규칙 평가용 API 키 (필수)
NAVER_CLIENT_ID_BYEON=your_naver_client_id
NAVER_CLIENT_SECRET_BYEON=your_naver_client_secret
NCP_MAPS_KEY_ID_BYEON=your_ncp_key_id
NCP_MAPS_KEY_BYEON=your_ncp_key
```

### 3. Python 환경 설정
규칙 평가를 위해 Python 3.8+가 필요합니다.
```bash
pip install requests python-dotenv
```

### 4. TypeScript 컴파일
```bash
npm run build
```

**💡 Tip**: 전체 파이프라인(`evaluation_pipeline.py`)은 자동으로 빌드 여부를 확인하고 필요 시 빌드를 수행합니다.

## 🔐 로그인 방식

### 수동 로그인 모드 (권장)
- `MANUAL_LOGIN=true`로 설정
- 브라우저 창이 열리면 사용자가 직접 로그인
- 2FA나 복잡한 로그인 상황에 안정적
- **사용법:**
  1. `.env` 파일에서 `MANUAL_LOGIN=true` 설정
  2. `npm run dev` 실행
  3. 브라우저 창이 열리면 직접 Perplexity에 로그인
  4. 로그인 완료 후 터미널에서 Enter 키 입력

## 📊 사용 방법

### 🔥 전체 파이프라인 자동 실행 (권장)
```bash
# TypeScript 빌드 (최초 1회 또는 코드 변경 시)
npm run build

# 전체 평가 파이프라인 실행 (1→2→3 순차 실행)
python3 src/evaluation_pipeline.py
```

파이프라인은 다음을 자동으로 수행합니다:
1. ✅ 평가 대상 선정
2. ✅ 규칙 기반 평가 (RULE)
3. ✅ AI 평가 (LAAJ) - 병렬 브라우저 수 선택 프롬프트

---

### 📝 개별 단계 실행 (선택사항)

#### 1. 평가 대상 선정
```bash
cd src
python3 evaluation-target-selection.py
```

#### 2. 규칙 기반 평가 (RULE)
```bash
cd src
python3 evaluation-rule.py
```

#### 3. AI 평가 (LAAJ)
```bash
# 개발 모드
npm run dev

# 또는
node dist/index.js
```

**실행 시 선택사항:**
- **병렬 처리 브라우저 수**: 1개 / 3개 / 5개 선택
- 병렬 처리 시 여러 브라우저가 동시에 평가를 수행하여 속도 향상
- 각 배치는 모두 완료된 후 다음 배치로 진행

## 🎯 AI 평가 상세

### 평가 항목 (5가지)
1. **visit_authenticity** (방문 여부 정확성)
   - 0~4점 척도로 실제 방문 여부 평가
   - `{values: [...], missing: []}` 형식

2. **rb_inference_score** (추론 합리성)
   - 0~2점 척도로 reasoning_basis의 논리성 평가

3. **rb_grounding_TF** (실제 근거 일치도)
   - true/false로 영상 내 근거 확인 여부 평가

4. **review_faithfulness_score** (리뷰 충실도)
   - 0.0~1.0 척도로 리뷰 정확성 평가

5. **category_TF** (카테고리 정합성)
   - true/false로 카테고리 적절성 평가

### 오류 처리 및 재시도
- **페이지 로드 오류** (ERR_FAILED): 1번 재시도 (5-15초 랜덤 대기)
- **JSON 파싱 실패**: 재시도 없이 오류 기록 (Perplexity 응답 문제)
- **각 단계마다 1-3초 랜덤 대기**로 서버 부하 분산
- 오류 발생 시 자동으로 메인 페이지 복구

### 병렬 처리
- **1개**: 순차 처리 (안정적)
- **3개**: 병렬 처리 (권장, 속도 3배)
- **5개**: 병렬 처리 (속도 5배, 서버 부하 주의)
- Promise.all()로 배치 단위 완료 보장

### 3. AI 평가 실행
```bash
# 개발 모드
npm run dev

# 또는
node dist/index.js
```

**실행 시 선택사항:**
- **병렬 처리 브라우저 수**: 1개 / 3개 / 5개 선택
- 병렬 처리 시 여러 브라우저가 동시에 평가를 수행하여 속도 향상
- 각 배치는 모두 완료된 후 다음 배치로 진행

## 🎯 AI 평가 상세

### 평가 항목 (5가지)
1. **visit_authenticity** (방문 여부 정확성)
   - 0~4점 척도로 실제 방문 여부 평가
   - `{values: [...], missing: []}` 형식

2. **rb_inference_score** (추론 합리성)
   - 0~2점 척도로 reasoning_basis의 논리성 평가

3. **rb_grounding_TF** (실제 근거 일치도)
   - true/false로 영상 내 근거 확인 여부 평가

4. **review_faithfulness_score** (리뷰 충실도)
   - 0.0~1.0 척도로 리뷰 정확성 평가

5. **category_TF** (카테고리 정합성)
   - true/false로 카테고리 적절성 평가

### 오류 처리 및 재시도
- **페이지 로드 오류** (ERR_FAILED): 1번 재시도 (5-15초 랜덤 대기)
  - 페이지 오류 발생 시에만 모델 재선택 수행
- **JSON 파싱 실패**: 재시도 없이 오류 기록 (Perplexity 응답 문제)
- **각 단계마다 1-3초 랜덤 대기**로 서버 부하 분산
- **Assistant steps 감지 후 5-8초 대기** (응답 완전 생성 보장)
- 오류 발생 시 자동으로 메인 페이지 복구

### 병렬 처리 최적화
- **1개**: 순차 처리 (안정적)
- **3개**: 병렬 처리 (권장, 속도 3배)
- **5개**: 병렬 처리 (속도 5배, 서버 부하 주의)
- **Thread 정리**: 배치 시작 시 첫 번째 브라우저에서만 수행 (효율성 향상)
- **모델 선택**: 첫 평가 시 또는 페이지 오류 복구 후에만 수행
- Promise.all()로 배치 단위 완료 보장

## 📁 파일 구조 및 워크플로우

```
📂 perplexity-restaurant-evaluation/
├── 📄 tzuyang_restaurant_evaluation_selection.jsonl          # 평가 대상 데이터
├── 📄 tzuyang_restaurant_evaluation_rule_results.jsonl       # 규칙 평가 결과
├── 📄 tzuyang_restaurant_evaluation_results.jsonl            # AI 평가 성공 결과
├── 📄 tzuyang_restaurant_evaluation_errors.jsonl             # AI 평가 실패 기록
├── 📄 tzuyang_restaurant_evaluation_notSelection_with_addressNull.jsonl  # 제외된 데이터
├── 📂 src/
│   ├── � evaluation_pipeline.py           # 🔥 전체 파이프라인 실행 스크립트
│   ├── �🔧 evaluation-target-selection.py   # Step 1: 평가 대상 선정
│   ├── 🔧 evaluation-rule.py              # Step 2: 규칙 평가 (2단계 매칭)
│   ├── 🤖 perplexity-evaluator.ts         # Step 3: Perplexity 제어 모듈
│   ├── 📄 jsonl-processor.ts              # JSONL 파일 처리 모듈
│   ├── ⚙️ index.ts                        # AI 평가 메인 파일 (병렬 처리)
│   └── 📋 types.ts                         # 타입 정의
└── ⚙️ .env                                  # 환경 변수 설정
```

### 워크플로우
```
📥 입력: tzuyang_restaurant_results.jsonl (크롤링 데이터)
          ↓
🔍 Step 1: 평가 대상 선정 (evaluation-target-selection.py)
          ↓
📄 출력: tzuyang_restaurant_evaluation_selection.jsonl
          ↓
📏 Step 2: 규칙 평가 - RULE (evaluation-rule.py)
          ↓
📄 출력: tzuyang_restaurant_evaluation_rule_results.jsonl
          ↓
🤖 Step 3: AI 평가 - LAAJ (index.ts via Node.js)
          ↓
📄 출력: tzuyang_restaurant_evaluation_results.jsonl (성공)
        tzuyang_restaurant_evaluation_errors.jsonl (실패)
```

**💡 전체 파이프라인은 `python3 src/evaluation_pipeline.py`로 한 번에 실행 가능**

## ⚙️ 규칙 기반 평가 상세

규칙 평가는 **카테고리 유효성**과 **위치 정합성**을 검증합니다.

### 위치 정합성 평가 로직
- **1단계: 정확 주소 매칭**
  - 원본 주소를 NCP 지오코딩으로 지번주소 변환
  - 네이버 로컬 검색으로 후보 수집 (name 검색 5개 + name+address 검색 3개 + name+region 검색 5개)
  - 지번주소가 정확히 일치하면 성공

- **2단계: 거리 기반 매칭 (1단계 실패 시)**
  - 원본 주소와 후보 주소의 lat/lng를 NCP 지오코딩으로 얻음
  - Haversine 공식으로 거리 계산
  - **30m 이내** 가장 가까운 후보 선택

### 검색 쿼리 전략
- **name**: 식당명만 검색 (전국적 결과)
- **name+address**: 식당명 + 원본 주소 (정확도 높음)
- **name+region**: 식당명 + 지역명 (지역별 필터링, ex: "통큰식당 제천시")

### 현재 성능 (테스트 데이터 26개 음식점 기준)
- **성공률**: 65.4% (17/26개)
- **국내 성공**: 17개 (해외 제외)
- **실패 원인**: 해외 주소, API 제한, 주소 불일치 등

## 📝 출력 파일

### 평가 대상 선정
- `tzuyang_restaurant_evaluation_selection.jsonl`: 평가 대상으로 선정된 음식점 데이터
- `tzuyang_restaurant_evaluation_notSelection_with_addressNull.jsonl`: 제외된 데이터 (주소 정보 없음)

### 규칙 평가
- `tzuyang_restaurant_evaluation_rule_results.jsonl`: 규칙 기반 평가 결과 (성공/실패, 매칭 주소, 거리 등)

### AI 평가
- `tzuyang_restaurant_evaluation_results.jsonl`: 평가 성공한 레코드 (evaluation_results 필드 추가)
- `tzuyang_restaurant_evaluation_errors.jsonl`: 평가 실패한 레코드 (error 필드 포함)

## 🛠️ 개발

### 프로젝트 구조
- **Python 스크립트**: 데이터 처리 및 규칙 평가 (네이버/NCP API 연동)
- **TypeScript 모듈**: Perplexity 자동화 및 병렬 처리 (Puppeteer 기반)
- **JSONL 포맷**: 대용량 데이터 효율적 처리

### 주요 기능
- ✅ 자동 쓰레드 삭제 (배치 시작 시 첫 브라우저에서만 - 효율성)
- ✅ Gemini Pro 2.5 모델 자동 선택 (첫 평가/오류 복구 시에만)
- ✅ 인간처럼 타이핑 (10-20ms/문자)
- ✅ Assistant steps 감지 후 충분한 대기 (5-8초, 응답 완전 생성)
- ✅ 병렬 처리 (1/3/5 브라우저)
- ✅ 오류 자동 재시도 및 복구 (페이지 오류 감지)
- ✅ 랜덤 대기로 서버 부하 분산

### 확장
시스템은 모듈화되어 있어 새로운 평가 규칙이나 AI 모델로 쉽게 확장할 수 있습니다.