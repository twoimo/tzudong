# 리뷰 영수증 OCR 중복 검사 시스템

리뷰 제출 시 영수증 이미지를 OCR 처리하여 동일 영수증으로 중복 리뷰 작성을 방지하는 시스템.

## 기능 개요

| 기능 | 설명 |
|------|------|
| **이미지 압축** | 업로드 전 WebP 변환, 최대 300KB |
| **영수증 OCR** | Gemini Vision API로 가게명/날짜/시간/금액 추출 |
| **중복 검사** | SHA-256 해시로 동일 영수증 탐지 |
| **관리자 UI** | 수동 OCR 실행 버튼 + 중복 경고 배지 |

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
│   └── ReviewModal.tsx          # 이미지 압축 (compressImage)
├── components/admin/
│   └── SubmissionListView.tsx   # OCR 버튼 + 중복 배지
└── app/api/admin/
    └── ocr-receipts/route.ts    # OCR API Route

backend/
└── geminiCLI-ocr-receipts/
    ├── package.json
    └── ocr-receipts.js          # OCR 처리 스크립트

.github/workflows/
└── ocr-review-receipts.yml      # 스케줄 + 수동 트리거

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

-- 유니크 인덱스 (중복 방지)
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
  "confidence": 0.95
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
| `GITHUB_TOKEN` | 워크플로우 트리거용 |
| `GITHUB_OWNER` | GitHub 사용자명 |
| `GITHUB_REPO` | 레포지토리 이름 |

### GitHub Secrets

| 변수 | 설명 |
|------|------|
| `SUPABASE_URL` | Supabase 프로젝트 URL |
| `SUPABASE_SERVICE_ROLE_KEY` | 서비스 역할 키 |
| `GEMINI_API_KEY` | Google AI Studio API 키 |

---

## 사용 방법

### 1. 패키지 설치

```bash
cd apps/web && npm install browser-image-compression
```

### 2. DB 마이그레이션

```bash
supabase db push
```

### 3. 관리자 페이지

1. **리뷰 검수 탭** 접속
2. **OCR 검사 실행** 버튼 클릭
3. 중복 영수증 발견 시 빨간색 **"중복 영수증"** 배지 표시

---

## GitHub Actions 스케줄

- **자동 실행**: 매일 새벽 4시 (KST)
- **수동 실행**: Actions 탭 → Run workflow

---

## OCR 프롬프트

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
```

---

## 해시 생성 규칙

```javascript
const hashInput = `${store_name}|${date}|${time}|${total_amount}`;
const receiptHash = crypto.createHash('sha256').update(hashInput).digest('hex');
```

동일 가게 + 날짜 + 시간 + 금액 → 동일 해시 → 중복 판정
