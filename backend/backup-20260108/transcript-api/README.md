# 🎬 Transcript API

YouTube 자막 수집 및 GitHub 커밋을 위한 FastAPI 서버입니다.

> ⚠️ **참고**: 현재 메인 자막 수집은 **Puppeteer 기반 스크립트**(`transcript-puppeteer.ts`)로 이전되었습니다.
> 이 API는 로컬 관리용 보조 도구로 사용됩니다.

## 주요 자막 수집 방식

### 🆕 Puppeteer 기반 (권장)

```bash
cd backend/geminiCLI-restaurant-crawling/scripts
npx ts-node transcript-puppeteer.ts --date 25-12-04
```

- **1차**: maestra.ai (Primary)
- **2차**: tubetranscript.com (Fallback)
- GitHub Actions에서도 실행 가능
- 30개마다 자동 커밋

### FastAPI (이 서버)

로컬에서 관리자 UI와 연동하여 사용:
- 상태 확인
- 수동 GitHub 커밋/푸시

## 설치

```bash
cd backend/transcript-api
pip install -r requirements.txt
```

## 실행

```bash
# 개발 모드 (자동 리로드)
uvicorn main:app --reload --port 8000

# 프로덕션 모드
uvicorn main:app --host 0.0.0.0 --port 8000
```

## API 문서

서버 실행 후 접속:
- Swagger UI: http://localhost:8000/docs
- ReDoc: http://localhost:8000/redoc

## API 엔드포인트

### GET /status
현재 상태 확인 (대기 중인 URL 수, 이미 수집된 transcript 수)

```bash
curl http://localhost:8000/status
```

### POST /collect
YouTube 자막 수집 + GitHub 커밋

```bash
curl -X POST http://localhost:8000/collect \
  -H "Content-Type: application/json" \
  -d '{"auto_commit": true}'
```

**요청 파라미터:**
- `date_folder`: 날짜 폴더 (기본: 오늘)
- `max_urls`: 최대 처리 URL 수 (기본: 전체)
- `auto_commit`: 자동 커밋 여부 (기본: true)

### POST /commit
이미 수집된 파일만 GitHub에 커밋

```bash
curl -X POST http://localhost:8000/commit
```

## 출력 파일

```
backend/geminiCLI-restaurant-crawling/data/{날짜}/
├── tzuyang_restaurant_transcripts.json  # 수집된 자막
└── tzuyang_transcript_errors.json       # 실패 로그
```

### Transcript JSON 형식

```json
[
  {
    "youtube_link": "https://www.youtube.com/watch?v=xxx",
    "language": "ko",
    "collected_at": "2025-12-04T10:30:00+09:00",
    "transcript": [
      {"start": 0.0, "text": "안녕하세요"},
      {"start": 2.5, "text": "오늘은..."}
    ]
  }
]
```

- **start**: 시작 시간 (초 단위, float)
- **text**: 자막 텍스트
- **collected_at**: 수집 시간 (KST, ISO 8601)

## 워크플로우

### GitHub Actions 통합 워크플로우 (권장)

```
┌─────────────────────────────────────────────────────────────────┐
│  🍜 Restaurant Pipeline (통합)                                   │
│  📄 .github/workflows/restaurant-pipeline.yml                   │
├─────────────────────────────────────────────────────────────────┤
│  1️⃣ url-collection      → YouTube URL 수집                      │
│  2️⃣ transcript-collection → Puppeteer 자막 수집 (자동 커밋)      │
│  3️⃣ crawling-evaluation → 크롤링 + 평가 + DB 삽입               │
└─────────────────────────────────────────────────────────────────┘
```

GitHub Actions에서 전체 파이프라인 실행:
```bash
gh workflow run "restaurant-pipeline.yml" \
  -f step=all \
  --ref github-actions-restaurant
```

### 로컬 API 사용 (보조)

1. 서버 실행:
   ```bash
   cd backend/transcript-api
   uvicorn main:app --port 8000
   ```

2. 프론트엔드 실행:
   ```bash
   cd apps/web
   npm run dev
   ```

3. 관리자 페이지(`/admin/evaluations`) 접속
4. 상태 확인 및 수동 커밋

## 로그 파일

로그는 다음 구조로 저장됩니다:

```
backend/log/geminiCLI-restaurant/
├── report/{yy-mm-dd}/    # JSON 요약 리포트
│   └── transcript-api_HHMMSS.json
├── text/{yy-mm-dd}/      # 텍스트 로그
│   └── transcript-api.log
└── structured/{yy-mm-dd}/ # 구조화된 JSONL 로그
    └── transcript-api.jsonl
```

## CLI 사용

서버 없이 직접 실행도 가능합니다:

```bash
# Transcript 수집
python services/youtube.py --date 25-12-02

# GitHub 커밋
python services/github.py --date 25-12-02

# Git 상태 확인
python services/github.py --status
```

## 주의사항

1. **브랜치**: `github-actions-restaurant` 브랜치에 커밋됩니다
2. **Git 설정**: 커밋 시 자동으로 user.name, user.email 설정됨
3. **푸시 권한**: GitHub에 푸시하려면 로컬에 인증이 설정되어 있어야 함

---

## 관련 문서

- [Puppeteer 자막 수집 스크립트](../geminiCLI-restaurant-crawling/scripts/transcript-puppeteer.ts)
- [크롤링 시스템 README](../geminiCLI-restaurant-crawling/README.md)
- [GitHub Actions README](../../.github/workflows/README.md)
