# 🎬 Transcript API

YouTube 자막을 로컬에서 수집하고 GitHub에 자동 커밋하는 FastAPI 서버입니다.

## 왜 필요한가?

GitHub Actions는 Azure 클라우드에서 실행되며, **YouTube가 클라우드 IP를 차단**합니다.
따라서 자막 수집은 로컬에서 실행해야 합니다.

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
    "transcript": [
      {"start": 0.0, "text": "안녕하세요"},
      {"start": 2.5, "text": "오늘은..."}
    ],
    "collected_at": "2025-12-02T10:30:00+09:00"
  }
]
```

## 워크플로우

1. **URL 수집** (GitHub Actions - 2일마다 자동)
2. **Transcript 수집** (로컬 FastAPI - 관리자 UI 버튼 클릭)
3. **크롤링 + 평가** (GitHub Actions - transcript 커밋 감지 시 자동)

## 관리자 UI에서 사용하기

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
4. 헤더의 **"자막 수집"** 버튼 클릭
5. 수집 완료 후 자동으로 GitHub에 커밋/푸시됨 → Actions 워크플로우 트리거

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
