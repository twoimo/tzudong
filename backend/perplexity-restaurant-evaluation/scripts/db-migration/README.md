# DB Migration Scripts

이 폴더는 evaluation_records 데이터를 Supabase에 마이그레이션하기 위한 스크립트들을 포함합니다.

## 📁 파일 구조

```
scripts/db-migration/
├── README.md                    # 이 파일
├── DB_MIGRATION_GUIDE.md       # 상세 마이그레이션 가이드
├── load_data_in_batches.py     # 배치 데이터 로딩 스크립트
├── analyze_duplicates.py        # 중복 데이터 분석 도구
├── enable_rls.sql              # RLS(Row Level Security) 활성화
└── temp_disable_rls.sql        # RLS 임시 비활성화
```

## 🚀 빠른 시작

### 1. RLS 임시 비활성화 (데이터 로딩 전)

```bash
# Supabase SQL Editor에서 실행
psql -h <your-host> -U <user> -d <database> -f temp_disable_rls.sql
```

또는 Supabase Dashboard > SQL Editor에서 `temp_disable_rls.sql` 내용을 복사하여 실행

### 2. 데이터 배치 로딩

```bash
cd scripts/db-migration
python3 load_data_in_batches.py
```

**주요 기능:**
- 602개의 evaluation records를 배치(50개씩)로 로딩
- 진행 상황 실시간 표시
- 오류 발생 시 자동 재시도
- 중복 데이터 자동 감지 및 스킵

**실행 결과:**
```
배치 1/13 처리 중... (50개 레코드)
✓ 배치 1 완료
배치 2/13 처리 중... (50개 레코드)
✓ 배치 2 완료
...
총 602개 레코드 중 602개 성공적으로 로딩됨
```

### 3. 중복 데이터 분석 (선택 사항)

```bash
python3 analyze_duplicates.py
```

**분석 항목:**
- 같은 지번주소에 다른 음식점명이 있는 경우
- 중복 YouTube 링크
- 중복 음식점명

### 4. RLS 재활성화 (데이터 로딩 후)

```bash
psql -h <your-host> -U <user> -d <database> -f enable_rls.sql
```

## 📊 데이터 구조

### evaluation_records 테이블

| 컬럼명 | 타입 | 설명 |
|--------|------|------|
| id | TEXT | Primary Key (UUID) |
| youtube_link | TEXT | YouTube 영상 URL |
| restaurant_name | TEXT | 음식점명 |
| status | TEXT | 상태 (pending/approved/hold/missing/db_conflict/geocoding_failed) |
| youtube_meta | JSONB | YouTube 메타데이터 |
| evaluation_results | JSONB | 평가 결과 (7개 항목) |
| restaurant_info | JSONB | 음식점 정보 |
| geocoding_success | BOOLEAN | 지오코딩 성공 여부 |
| db_conflict_info | JSONB | DB 충돌 정보 |
| missing_message | TEXT | Missing 메시지 |
| created_at | TIMESTAMP | 생성 시간 |
| updated_at | TIMESTAMP | 수정 시간 |

### evaluation_results 구조 (JSONB)

```json
{
  "visit_authenticity": {
    "name": "음식점명",
    "eval_value": 1,  // 0-4점
    "eval_basis": "평가 근거"
  },
  "rb_inference_score": {
    "name": "음식점명",
    "eval_value": 2,  // 0-2점
    "eval_basis": "평가 근거"
  },
  "rb_grounding_TF": {
    "name": "음식점명",
    "eval_value": true,  // boolean
    "eval_basis": "평가 근거"
  },
  "review_faithfulness_score": {
    "name": "음식점명",
    "eval_value": 1,  // 0-1점
    "eval_basis": "평가 근거"
  },
  "location_match_TF": {
    "name": "음식점명",
    "eval_value": true,  // boolean
    "origin_address": "원본주소",
    "naver_address": { /* 매칭된 주소 정보 */ },
    "falseMessage": "실패 사유" // false일 때만
  },
  "category_validity_TF": {
    "name": "음식점명",
    "eval_value": true  // boolean
  },
  "category_TF": {
    "name": "음식점명",
    "eval_value": true,  // boolean
    "category_revision": "수정 카테고리" // false일 때만
  }
}
```

## 🔧 환경 변수 설정

`.env` 파일에 다음 변수를 설정해야 합니다:

```env
VITE_SUPABASE_URL=your_supabase_url
VITE_SUPABASE_ANON_KEY=your_anon_key
```

## ⚠️ 주의사항

1. **RLS 설정**: 데이터 로딩 전에는 반드시 RLS를 비활성화해야 합니다
2. **배치 크기**: 기본 50개씩 처리하며, 필요시 코드에서 `BATCH_SIZE` 변경 가능
3. **중복 처리**: 같은 id를 가진 레코드는 자동으로 스킵됩니다
4. **오류 처리**: 네트워크 오류 발생 시 자동으로 재시도합니다

## 🐛 문제 해결

### 문제: "permission denied for table evaluation_records"
**해결**: RLS를 비활성화했는지 확인 (`temp_disable_rls.sql` 실행)

### 문제: "duplicate key value violates unique constraint"
**해결**: 이미 로딩된 데이터입니다. `analyze_duplicates.py`로 확인

### 문제: Python 패키지 오류
**해결**: 
```bash
pip install python-dotenv supabase
```

## 📚 추가 문서

자세한 내용은 `DB_MIGRATION_GUIDE.md`를 참조하세요.
