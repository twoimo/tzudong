# 🍜 Tzudong Pipeline v2.0

**YouTube 맛집 데이터 자동화 파이프라인 - 통합 리팩토링 버전**

---

## 🎯 시스템 개요

### 목적

유튜버 채널의 영상에서 방문한 맛집 정보를 자동으로 수집, 검증, 평가하여 데이터베이스에 저장하는 통합 파이프라인입니다.

---

## 📁 디렉토리 구조

```
tzudong_pipeline_v2.0/
├── README.md              # 이 파일
├── env.example            # 환경 변수 템플릿
│
├── scripts/               # 🔧 실행 스크립트 (구현 예정)
│   └── example.js
│
├── prompts/               # 📝 AI 프롬프트 (구현 예정)
│   └── example.txt
│
├── data/                  # 💾 데이터 저장
│   └── example.jsonl
│
├── utils/                 # 🛠️ 공통 유틸리티 (구현 예정)
│   ├── example.js
│   └── example.py
│
└── .gemini/               # Gemini CLI 인증 (OAuth 2.0)
```

---

## ⚙️ 환경 설정

### 1. 주요 환경 변수

```env.example
# ===== GitHub =====
GITHUB_TOKEN=your_github_token
GITHUB_OWNER=your_github_owner
GITHUB_REPO=your_github_repo

# ===== YouTube 메타데이터 수집 =====
YOUTUBE_API_KEY=your_youtube_api_key

# ===== Google API =====
GOOGLE_API_KEY=your_google_api_key

# ===== OpenAI API =====
OPENAI_API_KEY=your_openai_api_key

# ===== Kakao Map API =====
KAKAO_REST_API_KEY=your_kakao_rest_api_key

# ===== Naver Search API =====
NAVER_CLIENT_ID=your_naver_client_id
NAVER_CLIENT_SECRET=your_naver_client_secret

# ===== NCP Maps (Naver Cloud Platform) =====
NCP_MAPS_KEY_ID=your_ncp_maps_key_id
NCP_MAPS_KEY=your_ncp_maps_key

# ===== PostgreSQL (OR Supabase)=====
POSTGRES_HOST=your_postgres_host
POSTGRES_PORT=5432
POSTGRES_USER=your_postgres_user
POSTGRES_PASSWORD=your_postgres_password
POSTGRES_DATABASE=your_postgres_database
SUPABASE_URL=your_supabase_url
SUPABASE_KEY=your_supabase_key

# ===== Gemini OAuth 2.0 (backend\tzudong_pipeline\.gemini\oauth_creds.json) =====
GEMINI_ACCESS_TOKEN=your_gemini_access_token
GEMINI_REFRESH_TOKEN=your_gemini_refresh_token

# ===== Pipeline Settings =====
# 실행 환경 (local, github_actions, oracle_cloud)
PIPELINE_ENV=local

# 타겟 채널 (콤마로 여러 개 선택 가능)
# 예: tzuyang,meatcreator,seonkyoung
TARGET_CHANNELS=tzuyang

# Gemini 모델 설정 (gemini-3-flash-preview, gemini-3-pro-preview)
GEMINI_MODEL=gemini-3-flash-preview

# 병렬 처리 워커 수
PARALLEL_WORKERS=2

# 로그 레벨 (DEBUG, INFO, WARNING, ERROR)
LOG_LEVEL=INFO

# 한국 시간대
TIMEZONE=Asia/Seoul
```

---

## 3. 전체 파이프라인 흐름

```mermaid
flowchart TD
    subgraph Input
        YT[("📺 YouTube Channel<br/>(채널 ID)")]
    end

    subgraph BRANCH1["🔀 BRANCH 1 (GitHub Actions)"]
        B1_1["youtube_link 수집"]
        B1_2["메타데이터 수집<br/>• 조회수, 좋아요, 댓글수<br/>• OpenAI API 광고 분석"]
        B1_3["주기적 갱신 지원"]
    end

    subgraph Parallel["병렬 처리 (Oracle Cloud)"]
        subgraph BRANCH2["🔀 BRANCH 2"]
            B2_1["Description URL 추출"]
            B2_2["Puppeteer 네이버지도"]
            B2_3["맛집 위치 정보 확보"]
        end

        subgraph BRANCH3["🔀 BRANCH 3"]
            B3_1["자막 수집"]
            B3_2["youtube-transcript"]
            B3_3["주기적 갱신"]
        end

        subgraph BRANCH4["🔀 BRANCH 4"]
            B4_1["히트맵 마커 수집"]
            B4_2["Most Replayed"]
            B4_3["주기적 갱신"]
        end
    end

    subgraph BRANCH3_1["🔀 BRANCH 3-1 (GitHub Actions / Oracle Cloud)"]
        B3_1_1["자막 교정"]
        B3_1_2["BRANCH 3 merge 시 트리거"]
    end

    subgraph BRANCH5["🔀 BRANCH 5: 🤖 AI Processing (GitHub Actions / Oracle Cloud)"]
        B5_1["Step 1: geminiCLI 크롤링<br/>• 채널 ID + 프롬프트<br/>• description 유무 분기"]
        B5_2["Step 2: geminiCLI 평가<br/>• 채널 ID + 프롬프트<br/>• 평가 모델 개선"]
        B5_3["Step 3: Transform<br/>• trace_id 생성<br/>• 데이터 정규화"]
    end

    subgraph Output["💾 Database Insert (Oracle Cloud DB)"]
        DB1["OCI DB 저장"]
        DB2["trace_id 중복 체크"]
        DB3["UI 최신 데이터 반영"]
    end

    YT --> BRANCH1
    BRANCH1 --> M1{{"MERGE"}}
    M1 --> BRANCH2
    M1 --> BRANCH3
    M1 --> BRANCH4
    BRANCH2 --> M2{{"MERGE"}}
    BRANCH3 --> M2
    BRANCH4 --> M2
    M2 --> BRANCH3_1
    BRANCH3_1 --> M3{{"MERGE"}}
    M3 --> BRANCH5
    B5_1 --> B5_2 --> B5_3
    BRANCH5 --> Output

    style YT fill:#ff6b6b,stroke:#333,stroke-width:2px,color:#fff
    style M1 fill:#ffd93d,stroke:#333,stroke-width:2px
    style M2 fill:#ffd93d,stroke:#333,stroke-width:2px
    style M3 fill:#ffd93d,stroke:#333,stroke-width:2px
    style Output fill:#6bcb77,stroke:#333,stroke-width:2px
```