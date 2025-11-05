# Supabase DB 마이그레이션 및 데이터 로드 가이드

## 1단계: DB 마이그레이션 실행

### 방법 1: Supabase 대시보드 사용 (권장)

1. Supabase 대시보드 접속: https://supabase.com/dashboard
2. 프로젝트 선택
3. 왼쪽 메뉴에서 **SQL Editor** 클릭
4. **New query** 클릭
5. `supabase/migrations/20251105_update_restaurants_for_evaluation.sql` 파일 내용 전체 복사 후 붙여넣기
6. **Run** 버튼 클릭
7. 성공 메시지 확인:
   ```
   ✅ restaurants 테이블 재설계 완료
   ✅ evaluation_records 테이블 생성 완료
   ⚠️ 기존 데이터는 restaurants_backup_20251105에 백업되었습니다
   ```

### 방법 2: Supabase CLI 사용

```bash
cd /Users/byeon-ujung/Desktop/programming/tzudong/tzudong
supabase db push
```

## 2단계: 환경변수 설정

### .env 파일 생성 (아직 없다면)

```bash
cd /Users/byeon-ujung/Desktop/programming/tzudong/tzudong/backend/perplexity-restaurant-evaluation
```

`.env` 파일 생성 후 다음 내용 추가:

```env
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_KEY=your-service-role-key
```

**Supabase Key 찾기:**
1. Supabase 대시보드 → 프로젝트 선택
2. Settings → API
3. **service_role** secret 복사 (중요: anon public이 아님!)

## 3단계: 데이터 로드

```bash
cd /Users/byeon-ujung/Desktop/programming/tzudong/tzudong/backend/perplexity-restaurant-evaluation/src
conda activate tzudong-youtube
python3 load_transform_to_db.py
```

## 문제 해결

### 권한 오류 발생 시

RLS (Row Level Security) 때문에 오류가 발생할 수 있습니다.

**임시 해결 방법:**
Supabase SQL Editor에서 다음 실행:

```sql
-- RLS 임시 비활성화
ALTER TABLE public.evaluation_records DISABLE ROW LEVEL SECURITY;

-- 데이터 로드 후 다시 활성화
ALTER TABLE public.evaluation_records ENABLE ROW LEVEL SECURITY;
```

### service_role key vs anon key

- **service_role**: RLS 우회 가능, 서버용
- **anon**: RLS 적용됨, 클라이언트용

데이터 로드 시 **service_role** 사용 필수!
