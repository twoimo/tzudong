# 🍽️ Perplexity Restaurant Evaluation System

Perplexity AI를 활용한 음식점 평가 자동화 시스템입니다. 크롤링된 음식점 데이터를 기반으로 평가 대상을 선정하고, 규칙 기반 평가 및 AI 평가를 수행합니다.

## 📋 시스템 개요

이 시스템은 다음과 같은 **순차적 4단계**로 음식점 평가를 수행합니다:

1. **평가 대상 선정** (Python) - 크롤링 데이터에서 평가할 음식점을 필터링 (평가 미대상 분리)
2. **규칙 기반 평가** (Python) - 카테고리 유효성과 위치 정합성 검증 (네이버/NCP API 활용)
3. **AI 평가 (LAAJ)** (TypeScript) - Perplexity AI를 통한 심층 평가 수행 (병렬 처리 지원)
4. **Transform** (Python) - 평가 결과를 DB 로드용 포맷으로 변환 (평가 미대상 포함)

**⚠️ 평가는 반드시 1→2→3→4 순서로 진행해야 합니다.**

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
# 전체 평가 파이프라인 실행 (1→2→3→4 순차 실행)
python3 src/evaluation_pipeline.py
```

파이프라인은 다음을 자동으로 수행합니다:
1. ✅ **빌드 확인 및 자동 빌드** - TypeScript 컴파일 필요 시 자동 실행
2. ✅ **병렬 브라우저 수 선택** - 시작 시 1/3/5개 선택 (전체 파이프라인에 적용)
3. ✅ **평가 대상 선정** (Step 1) - 평가 대상과 평가 미대상(not_selected) 분리
4. ✅ **규칙 기반 평가** (Step 2)
5. ✅ **AI 평가 LAAJ** (Step 3) - 선택한 병렬 브라우저 수로 실행
6. ✅ **Transform** (Step 4) - 평가 결과 + 평가 미대상을 transform.jsonl로 통합

**💡 중복 처리 방지**: 모든 단계에서 이미 처리된 레코드는 자동으로 건너뜁니다.

---

### 📝 개별 단계 실행 (선택사항)

#### 1. 평가 대상 선정
```bash
cd src
python3 evaluation-target-selection.py
```
- ✅ **중복 처리 방지**: 기존 출력 파일에 이미 있는 youtube_link는 자동으로 건너뜁니다.
- ✅ **평가 미대상 분리**: 주소가 없는 음식점(광고, 해외 등)은 자동으로 `notSelection_with_addressNull.jsonl`로 분리
- ✅ **youtube_meta 포함**: `tzuyang_restaurant_results_with_meta.jsonl`에서 영상 메타데이터 자동 포함

#### 2. 규칙 기반 평가 (RULE)
```bash
cd src
python3 evaluation-rule.py
```
- ✅ **중복 처리 방지**: 이미 평가된 youtube_link는 자동으로 건너뜁니다.

#### 3. AI 평가 (LAAJ)
```bash
# TypeScript 빌드 (최초 1회 또는 코드 변경 시)
npm run build

# 개발 모드
npm run dev

# 또는
node dist/index.js
```
- ✅ **중복 처리 방지**: 성공/실패 파일에 이미 있는 youtube_link는 자동으로 건너뜁니다.

**실행 시 선택사항:**
- **병렬 처리 브라우저 수**: 1개 / 3개 / 5개 선택
- 병렬 처리 시 여러 브라우저가 동시에 평가를 수행하여 속도 향상
- 각 브라우저는 독립적인 프로필 디렉토리 사용 (충돌 방지)
- 각 배치는 모두 완료된 후 다음 배치로 진행
- **전체 레코드 처리**: 모든 미처리 레코드를 순차적으로 평가

---

### 🔄 에러 레코드 재평가 (선택사항)

AI 평가 중 실패한 레코드들을 다시 평가하려면:

```bash
# TypeScript 빌드 (필요 시)
npm run build

```bash
# 에러 레코드 재평가 실행
node dist/index_retry_for_errors.js
```

**동작 방식:**
1. `tzuyang_restaurant_evaluation_errors.jsonl`의 에러 레코드 읽기
2. ✅ **이미 성공한 레코드 자동 제거**: `results.jsonl`에 있는 youtube_link는 에러 파일에서 자동 삭제
3. 각 레코드를 **새로운 프롬프트로 다시 평가** (재시도가 아닌 새 평가)
4. 성공 시 → `tzuyang_restaurant_evaluation_results.jsonl`에 append
5. 성공 시 → `errors.jsonl`에서 해당 레코드 자동 제거
6. 실패 시 → `errors.jsonl`에 그대로 유지

**💡 Tip**: 파이프라인과 별도로 실행되며, 병렬 처리 옵션 선택 가능

---

## 📊 처리 통계

파이프라인 실행 시 각 단계별 상세 통계가 자동으로 출력됩니다:

```
================================================================================
📊 전체 처리 통계
================================================================================

Step 1: 평가 대상 선정
  입력: 전체 크롤링 데이터
  이미 처리됨: 50개
  새로 처리: 30개
  최종 누적: 80개

Step 2: RULE 평가
  입력: 80개
  이미 처리됨: 70개
  새로 처리: 10개 (12.5%)
  최종 누적: 80개

Step 3: LAAJ 평가
  입력: 80개
  이미 처리됨: 60개 (성공 50, 에러 10)
  새로 처리: 15개 성공 (75.0%), 5개 에러 (25.0%)
  최종 누적: 성공 65개, 에러 15개

────────────────────────────────────────────────────────────────────────────────
✅ 전체 성공률: 65/80 (81.3%)
────────────────────────────────────────────────────────────────────────────────
```

**통계 항목:**
- **입력**: 해당 단계의 입력 레코드 수
- **이미 처리됨**: 이전 실행에서 완료된 레코드 (자동 스킵)
- **새로 처리**: 현재 실행에서 새로 처리한 레코드와 성공률
- **최종 누적**: 파일에 저장된 전체 레코드 수

**💡 중복 처리 방지:** 모든 단계에서 이미 처리된 youtube_link는 자동으로 건너뜁니다.

## 🎯 AI 평가 상세
```

**동작 방식:**
1. `tzuyang_restaurant_evaluation_errors.jsonl`의 에러 레코드 읽기
2. 각 레코드를 **새로운 프롬프트로 다시 평가** (재시도가 아닌 새 평가)
3. 성공 시 → `tzuyang_restaurant_evaluation_results.jsonl`에 append
4. 성공 시 → `errors.jsonl`에서 해당 레코드 자동 제거
5. 실패 시 → `errors.jsonl`에 그대로 유지

**💡 Tip**: 파이프라인과 별도로 실행되며, 병렬 처리 옵션 선택 가능

## 🎯 AI 평가 상세

### 평가 항목 (5가지)
1. **visit_authenticity** (방문 여부 정확성)
   - 0~4점 척도로 실제 방문 여부 평가
   - `{values: [...], missing: []}` 형식
   - `missing` 배열: 영상에서 식별되었지만 restaurants 리스트에 누락된 음식점들
     - 문자열 형식 또는 `{name: "...", eval_basis: "..."}` 딕셔너리 형식

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
- **30개 처리마다 2-4분 자동 휴식** (서버 부하 방지, 안정적 장시간 실행)
- 오류 발생 시 자동으로 메인 페이지 복구

### 병렬 처리 최적화
- **1개**: 순차 처리 (안정적)
- **3개**: 병렬 처리 (권장, 속도 3배)
- **5개**: 병렬 처리 (속도 5배, 서버 부하 주의)
- **각 브라우저 독립 프로필**: `puppeteer_dev_profile_0`, `_1`, `_2` 등 고유 디렉토리 사용 (충돌 방지)
- **Thread 정리**: 배치 시작 시 첫 번째 브라우저에서만 수행 (효율성 향상)
- **모델 선택**: 첫 평가 시 또는 페이지 오류 복구 후에만 수행
- **stdin 입력 지원**: TTY 모드와 파이프 입력 모두 지원 (파이프라인 호환)
- Promise.all()로 배치 단위 완료 보장

### 대용량 처리 예시 (700개 기준)
| 병렬 브라우저 수 | 순수 처리 시간 | 휴식 시간 (23회) | **총 소요 시간** |
|--------------|-------------|----------------|---------------|
| **1개** | 9.7시간 | 1.3시간 | **약 11시간** |
| **3개** | 3.4시간 | 1.3시간 | **약 4.8시간** |
| **5개** | 2.1시간 | 1.3시간 | **약 3.4시간** |

*30개마다 2-4분 휴식 적용 기준*

#### 3. AI 평가 실행
```bash
# 개발 모드
npm run dev

# 또는
node dist/index.js
```
- ✅ **중복 처리 방지**: 성공/실패 파일에 이미 있는 youtube_link는 자동으로 건너뜁니다.

**실행 시 선택사항:**
- **병렬 처리 브라우저 수**: 1개 / 3개 / 5개 선택
- 병렬 처리 시 여러 브라우저가 동시에 평가를 수행하여 속도 향상
- 각 브라우저는 독립적인 프로필 디렉토리 사용 (충돌 방지)
- 각 배치는 모두 완료된 후 다음 배치로 진행
- **전체 레코드 처리**: 모든 미처리 레코드를 순차적으로 평가

#### 4. Transform (평가 결과 변환)
```bash
cd src
python3 transform_evaluation_results.py
```
- ✅ **평가 결과 통합**: evaluation_results.jsonl의 평가 결과를 youtube_link-restaurant_name 기준으로 변환
- ✅ **평가 미대상 포함**: notSelection_with_addressNull.jsonl의 평가 미대상도 자동 통합
- ✅ **Missing 항목 처리**: visit_authenticity.missing에 있는 음식점들도 자동 추출 (문자열/딕셔너리 형식 모두 지원)
- ✅ **중복 방지**: 이미 transform.jsonl에 있는 레코드는 자동 스킵
- ✅ **출력**: transform.jsonl (pending + missing + not_selected 통합)

**Missing 항목 처리 로직:**
- `visit_authenticity.missing` 배열에서 음식점 추출
- 문자열 형식: 바로 음식점명으로 사용 (예: `"카페 오늘"`)
- 딕셔너리 형식: `name` 속성 추출 (예: `{"name": "과일 가게", "eval_basis": "..."}`)
- Missing 항목은 `is_missing: true`로 표시되어 수동 등록 대상이 됨

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
- **각 브라우저 독립 프로필**: `puppeteer_dev_profile_0`, `_1`, `_2` 등 고유 디렉토리 사용 (충돌 방지)
- **Thread 정리**: 배치 시작 시 첫 번째 브라우저에서만 수행 (효율성 향상)
- **모델 선택**: 첫 평가 시 또는 페이지 오류 복구 후에만 수행
- **stdin 입력 지원**: TTY 모드와 파이프 입력 모두 지원 (파이프라인 호환)
- Promise.all()로 배치 단위 완료 보장

## 📁 파일 구조 및 워크플로우

```
📂 perplexity-restaurant-evaluation/
├── 📄 tzuyang_restaurant_evaluation_selection.jsonl          # 평가 대상 데이터
├── 📄 tzuyang_restaurant_evaluation_notSelection_with_addressNull.jsonl  # 평가 미대상 (주소 없음)
├── 📄 tzuyang_restaurant_evaluation_rule_results.jsonl       # 규칙 평가 결과
├── 📄 tzuyang_restaurant_evaluation_results.jsonl            # AI 평가 성공 결과
├── 📄 tzuyang_restaurant_evaluation_errors.jsonl             # AI 평가 실패 기록
├── 📄 transform.jsonl                                        # DB 로드용 통합 데이터 (평가 결과 + 평가 미대상)
├── 📂 src/
│   ├── 🔥 evaluation_pipeline.py           # 전체 파이프라인 실행 스크립트 (1→2→3→4)
│   ├── 📋 evaluation-target-selection.py   # Step 1: 평가 대상 선정 (평가 미대상 분리)
│   ├── 🔧 evaluation-rule.py              # Step 2: 규칙 평가 (2단계 매칭)
│   ├── 🤖 perplexity-evaluator.ts         # Step 3: Perplexity 제어 모듈
│   ├── 📄 jsonl-processor.ts              # JSONL 파일 처리 모듈
│   ├── ⚙️ index.ts                        # Step 3: AI 평가 메인 파일 (병렬 처리)
│   ├── 🔄 index_retry_for_errors.ts       # 에러 레코드 재평가 (별도 실행)
│   ├── 🔀 transform_evaluation_results.py  # Step 4: Transform (평가 결과 + 평가 미대상 통합)
│   ├── 💾 load_transform_to_db.py         # DB 로드 스크립트
│   └── 📋 types.ts                         # 타입 정의
└── ⚙️ .env                                  # 환경 변수 설정
```

### 워크플로우
```
📥 입력: tzuyang_restaurant_results_with_meta.jsonl (크롤링 데이터 + youtube_meta)
          ↓
🔍 Step 1: 평가 대상 선정 (evaluation-target-selection.py)
          ↓
📄 출력: tzuyang_restaurant_evaluation_selection.jsonl (평가 대상)
        tzuyang_restaurant_evaluation_notSelection_with_addressNull.jsonl (평가 미대상)
          ↓
📏 Step 2: 규칙 평가 - RULE (evaluation-rule.py)
          ↓
📄 출력: tzuyang_restaurant_evaluation_rule_results.jsonl
          ↓
🤖 Step 3: AI 평가 - LAAJ (index.ts via Node.js)
          ↓
📄 출력: tzuyang_restaurant_evaluation_results.jsonl (성공)
        tzuyang_restaurant_evaluation_errors.jsonl (실패)
          ↓
🔀 Step 4: Transform (transform_evaluation_results.py)
          ↓
📄 출력: transform.jsonl (평가 결과 + 평가 미대상 통합)
          ↓
💾 DB 로드: load_transform_to_db.py
          ↓
📊 Supabase evaluation_records 테이블
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

## 🎬 관리자 액션 동작 방식

### 1️⃣ 수동 등록 (`not_selected`, `missing` 상태에서 사용)
- **동작**: `MissingRestaurantForm` 모달 팝업 열림
- **목적**: 평가 미대상이거나 누락된 음식점을 수동으로 등록
- **입력 데이터**:
  - 선택된 레코드의 `youtube_link`와 `youtube_meta` 자동 전달
  - 음식점 이름, 주소, 카테고리 등 수동 입력
- **결과**: 
  - 새로운 `restaurant` 레코드 생성
  - `evaluation_record`의 `status`는 `pending`으로 변경됨
  - 입력한 음식점 정보가 DB에 저장됨

### 2️⃣ 삭제 (모든 상태에서 사용 가능)
- **동작**: 
  1. 확인 다이얼로그 표시 ("정말 삭제하시겠습니까?")
  2. 확인 시 `evaluation_records` 테이블에서 레코드 완전 삭제
- **결과**: 
  - DB에서 영구 제거 (복구 불가능)
  - 성공 토스트 메시지 표시
- **주의**: 
  - 실제 음식점 데이터(`restaurant` 테이블)는 삭제되지 않음
  - 평가 레코드만 제거됨

### 3️⃣ 상태별 액션 버튼 가시성
| 상태 | 수동 등록 | 삭제 |
|------|----------|------|
| `pending` | ❌ | ✅ |
| `approved` | ❌ | ✅ |
| `hold` | ❌ | ✅ |
| `db_conflict` | ❌ | ✅ |
| `geocoding_failed` | ❌ | ✅ |
| `missing` | ✅ | ✅ |
| `not_selected` | ✅ | ✅ |

## 🛠️ 개발

### 프로젝트 구조
- **Python 스크립트**: 데이터 처리 및 규칙 평가 (네이버/NCP API 연동)
- **TypeScript 모듈**: Perplexity 자동화 및 병렬 처리 (Puppeteer 기반)
- **JSONL 포맷**: 대용량 데이터 효율적 처리

### 주요 기능
- ✅ **중복 처리 방지**: 모든 단계에서 이미 처리된 youtube_link 자동 건너뛰기
- ✅ **에러 재시도 자동 정리**: 이미 성공한 레코드는 에러 파일에서 자동 제거
- ✅ **긴 JSON 안정적 파싱**: code 블록 전체 textContent 추출로 대용량 응답 완벽 처리
- ✅ **30개마다 자동 휴식**: 2-4분 랜덤 휴식으로 서버 부하 방지 및 안정적 장시간 실행
- ✅ **상세 통계 출력**: 각 단계별 입력/처리/성공/실패 통계 자동 계산
- ✅ 자동 쓰레드 삭제 (배치 시작 시 첫 브라우저에서만 - 효율성)
- ✅ Gemini Pro 2.5 모델 자동 선택 (첫 평가/오류 복구 시에만)
- ✅ 인간처럼 타이핑 (10-20ms/문자)
- ✅ Assistant steps 감지 후 충분한 대기 (5-8초, 응답 완전 생성)
- ✅ 병렬 처리 (1/3/5 브라우저, 각각 독립 프로필)
- ✅ 오류 자동 재시도 및 복구 (페이지 오류 감지)
- ✅ 랜덤 대기로 서버 부하 분산
- ✅ TTY/파이프 입력 모두 지원 (파이프라인 자동화 호환)

### 확장
시스템은 모듈화되어 있어 새로운 평가 규칙이나 AI 모델로 쉽게 확장할 수 있습니다.