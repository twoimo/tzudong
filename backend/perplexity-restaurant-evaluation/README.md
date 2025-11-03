# 🍽️ Perplexity Restaurant Evaluation System

Perplexity AI를 활용한 음식점 평가 자동화 시스템입니다. 크롤링된 음식점 데이터를 기반으로 평가 대상을 선정하고, 규칙 기반 평가 및 AI 평가를 수행합니다.

## 📋 시스템 개요

이 시스템은 다음과 같은 3단계로 음식점 평가를 수행합니다:

1. **평가 대상 선정** - 크롤링 데이터에서 평가할 음식점을 필터링
2. **규칙 기반 평가** - 카테고리 유효성과 위치 정합성 검증 (네이버/NCP API 활용)
3. **AI 평가** - Perplexity AI를 통한 심층 평가 수행

## 🚀 설치 및 설정

### 1. 의존성 설치
```bash
npm install
```

### 2. 환경 변수 설정 (.env 파일)
```env
PERPLEXITY_SESSION_PATH=perplexity-session.json
NODE_ENV=development

# 로그인 모드 설정 (선택사항)
# true: 수동 로그인 모드 (브라우저에서 직접 로그인)
# false 또는 빈 값: 자동 로그인 모드 (기본값)
MANUAL_LOGIN=false

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

## 🔐 로그인 방식

### 자동 로그인 모드 (기본값)
- `MANUAL_LOGIN=false` 또는 설정하지 않음
- 시스템이 자동으로 Perplexity에 로그인 시도
- 구글 로그인을 우선적으로 시도한 후 일반 로그인을 시도
- 로그인 성공을 여러 번 검증

### 수동 로그인 모드 (권장)
- `MANUAL_LOGIN=true`로 설정
- 브라우저 창이 열리면 사용자가 직접 로그인
- 2FA나 복잡한 로그인 상황에 유용

**수동 로그인 사용법:**
1. `.env` 파일에서 `MANUAL_LOGIN=true` 설정
2. `npm run dev` 실행
3. 브라우저 창이 열리면 직접 Perplexity에 로그인
4. 로그인 완료 후 터미널에서 Enter 키 입력

## 📊 사용 방법

### 1. 평가 대상 선정
```bash
cd src
python3 evaluation-target-selection.py
```

### 2. 규칙 기반 평가
```bash
cd src
python3 evaluation-rule.py
```

### 3. AI 평가 실행
```bash
# 개발 모드
npm run dev

# 프로덕션 모드
npm run start
```

## 📁 파일 구조 및 워크플로우

```
📂 perplexity-restaurant-evaluation/
├── 📄 tzuyang_restaurant_evaluation_selection.jsonl          # 평가 대상 데이터
├── 📄 tzuyang_restaurant_evaluation_rule_results.jsonl       # 규칙 평가 결과
├── 📄 tzuyang_restaurant_evaluation_notSelection_with_addressNull.jsonl  # 제외된 데이터
├── 📂 src/
│   ├── 🔧 evaluation-target-selection.py    # 평가 대상 선정 스크립트
│   ├── 🔧 evaluation-rule.py               # 규칙 평가 스크립트 (2단계 매칭)
│   ├── 🤖 perplexity-evaluator.ts          # Perplexity 제어 모듈
│   ├── 📄 jsonl-processor.ts               # JSONL 파일 처리 모듈
│   ├── ⚙️ index.ts                         # 메인 실행 파일
│   └── 📋 types.ts                         # 타입 정의
└── ⚙️ .env                                  # 환경 변수 설정
```

### 워크플로우
1. **입력**: `tzuyang_restaurant_results.jsonl` (크롤링 데이터)
2. **평가 대상 선정** → `tzuyang_restaurant_evaluation_selection.jsonl`
3. **규칙 평가** → `tzuyang_restaurant_evaluation_rule_results.jsonl`
4. **AI 평가** → 최종 평가 결과

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

- `tzuyang_restaurant_evaluation_selection.jsonl`: 평가 대상으로 선정된 음식점 데이터
- `tzuyang_restaurant_evaluation_rule_results.jsonl`: 규칙 기반 평가 결과 (성공/실패, 매칭 주소, 거리 등)
- `tzuyang_restaurant_evaluation_notSelection_with_addressNull.jsonl`: 평가에서 제외된 데이터 (주소 정보 없음)

## 🛠️ 개발

### 프로젝트 구조
- **Python 스크립트**: 데이터 처리 및 규칙 평가 (네이버/NCP API 연동)
- **TypeScript 모듈**: Perplexity 자동화 및 메인 로직
- **JSONL 포맷**: 대용량 데이터 효율적 처리

### 확장
시스템은 모듈화되어 있어 새로운 평가 규칙이나 AI 모델로 쉽게 확장할 수 있습니다.