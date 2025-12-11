# 리뷰 영수증 OCR 중복 검사 시스템

리뷰 제출 시 영수증 이미지를 OCR 처리하여 동일 영수증으로 중복 리뷰 작성을 방지하는 시스템.

## 기능 개요

| 기능 | 설명 |
|------|------|
| **이미지 압축** | 업로드 전 WebP 변환, 최대 300KB |
| **영수증 OCR** | Gemini 2.5 Flash Vision API로 가게명/날짜/시간/금액 추출 |
| **중복 검사** | SHA-256 해시로 동일 영수증 탐지 |
| **관리자 UI** | OCR 실행 버튼 + 중복 경고 + 승인 차단 |

---

## 아키텍처

```
[리뷰 제출] → [이미지 압축 (클라이언트)] → [Supabase Storage]
                                                    ↓
[관리자 버튼] → [GitHub Actions 트리거] → [OCR 스크립트 실행]
                                                    ↓
                                          [DB 업데이트: receipt_hash, is_duplicate]
```

---

## 파일 구조

```
apps/web/
├── components/reviews/
│   └── ReviewModal.tsx              # 이미지 압축 (compressImage)
├── components/admin/
│   └── SubmissionListView.tsx       # 리뷰 검수 UI
│       ├── OCR 상태 표시 (대기/중복 카운트)
│       ├── OCR 실행 버튼
│       ├── 중복 영수증 행 빨간색 하이라이트
│       ├── 중복 시 승인 버튼 비활성화
│       ├── 이미지 확대 모달 (클릭 시)
│       └── ReviewPhotoItem (로딩 스피너)
└── app/api/admin/
    └── ocr-receipts/route.ts        # OCR API Route (GET/POST)

backend/
└── geminiCLI-ocr-receipts/
    ├── package.json
    └── ocr-receipts.js              # OCR 처리 스크립트

.github/workflows/
└── ocr-review-receipts.yml          # 스케줄 + 수동 트리거

supabase/migrations/
└── 20251211_add_receipt_ocr_columns.sql
```

---

## DB 스키마

```sql
ALTER TABLE public.reviews 
  ADD COLUMN receipt_hash TEXT,           -- SHA-256 해시
  ADD COLUMN receipt_data JSONB,          -- OCR 결과
  ADD COLUMN is_duplicate BOOLEAN,        -- 중복 여부
  ADD COLUMN ocr_processed_at TIMESTAMPTZ; -- 처리 시각

-- 유니크 인덱스 (중복 시 NULL로 저장하여 회피)
CREATE UNIQUE INDEX idx_reviews_receipt_hash 
  ON public.reviews(receipt_hash) 
  WHERE receipt_hash IS NOT NULL;
```

### `receipt_data` 스키마

```json
{
  "store_name": "가게명",
  "date": "YYYY-MM-DD",
  "time": "HH:MM",
  "total_amount": 15000,
  "items": ["메뉴1", "메뉴2"],
  "confidence": 0.95,
  "duplicate_of": "원본_리뷰_ID"  // 중복 시에만 존재
}
```

**오류 시:**
```json
{
  "error": "not_receipt | unreadable | low_quality | parse_failed",
  "confidence": 0.0
}
```

---

## 환경 변수

### 로컬 (`apps/web/.env.local`)

```env
SUPABASE_SERVICE_ROLE_KEY=eyJ...
GITHUB_TOKEN=github_pat_...
GITHUB_OWNER=your-username
GITHUB_REPO=tzudong
```

### Vercel

| 변수 | 설명 |
|------|------|
| `SUPABASE_SERVICE_ROLE_KEY` | DB 서비스 역할 키 |
| `GITHUB_TOKEN` | 워크플로우 트리거용 PAT |
| `GITHUB_OWNER` | GitHub 사용자명 |
| `GITHUB_REPO` | 레포지토리 이름 |

### GitHub Secrets

| 변수 | 설명 |
|------|------|
| `SUPABASE_URL` | Supabase 프로젝트 URL |
| `SUPABASE_SERVICE_ROLE_KEY` | 서비스 역할 키 |
| `GOOGLE_API_KEY_BYEON` | Gemini API 키 |

---

## 사용 방법

### 관리자 페이지

1. **리뷰 검수 탭** 접속
2. 헤더에서 **OCR 상태** 확인 (대기/중복 카운트)
3. **OCR 실행** 버튼 클릭 → GitHub Actions 트리거
4. 중복 영수증 리뷰는 **빨간색 행**으로 표시
5. 중복 리뷰 클릭 시 모달에서:
   - **중복 영수증 감지** 경고 및 원본 리뷰 ID 표시
   - **승인 버튼 비활성화** (거부만 가능)
6. 이미지 클릭 시 **확대 모달** 표시

---

## API Endpoints

### `GET /api/admin/ocr-receipts`

OCR 처리 상태 조회

```json
{
  "pending": 5,      // 미처리 리뷰 수
  "duplicate": 2,    // 중복 감지된 리뷰 수
  "processed": 100   // 처리 완료된 리뷰 수
}
```

### `POST /api/admin/ocr-receipts`

GitHub Actions 워크플로우 수동 트리거

```json
{
  "success": true,
  "message": "OCR 처리가 시작되었습니다."
}
```

---

## GitHub Actions 스케줄

- **자동 실행**: 매일 새벽 4시 (KST) - cron: `0 19 * * *` (UTC)
- **수동 실행**: 
  - 관리자 페이지 OCR 실행 버튼
  - GitHub Actions 탭 → Run workflow

---

## OCR 처리 로직

### 1. OCR 프롬프트

```
당신은 한국어 영수증 OCR 전문가입니다.
다음 이미지에서 영수증 정보를 추출하여 JSON으로 반환하세요.

{
  "store_name": "가게명",
  "date": "YYYY-MM-DD",
  "time": "HH:MM",
  "total_amount": 금액(숫자),
  "items": ["메뉴1", "메뉴2"],
  "confidence": 0.0~1.0
}

영수증이 아니거나 읽을 수 없으면:
{
  "error": "사유",
  "confidence": 0.0
}
```

### 2. 해시 생성 규칙

```javascript
const hashInput = `${store_name}|${date}|${time}|${total_amount}`;
const receiptHash = crypto.createHash('sha256').update(hashInput).digest('hex');
```

동일 가게 + 날짜 + 시간 + 금액 → 동일 해시 → 중복 판정

### 3. 중복 처리

- 중복 발견 시 `receipt_hash`는 `NULL`로 저장 (UNIQUE INDEX 회피)
- `receipt_data.duplicate_of`에 원본 리뷰 ID 저장
- `is_duplicate = true`

---

## 관리자 UI 기능

| 기능 | 설명 |
|------|------|
| **OCR 상태 배지** | 대기/중복 카운트 실시간 표시 |
| **OCR 실행 버튼** | 대기 리뷰 없으면 비활성화 |
| **중복 행 강조** | 빨간색 배경으로 하이라이트 |
| **승인 차단** | 중복 리뷰 승인 버튼 비활성화 |
| **이미지 미리보기** | 로딩 스피너 + 클릭 시 확대 |
| **승인/거부 버튼** | 모달에서 둘 다 표시 |
