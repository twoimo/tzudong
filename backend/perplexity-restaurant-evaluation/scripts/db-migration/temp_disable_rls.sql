-- 임시로 RLS 비활성화하여 데이터 로드하기
-- Supabase SQL Editor에서 실행

-- 1. RLS 임시 비활성화
ALTER TABLE public.evaluation_records DISABLE ROW LEVEL SECURITY;

-- 2. 여기서 Python 스크립트로 데이터 로드 실행
-- python3 load_transform_to_db.py

-- 3. 데이터 로드 완료 후 RLS 다시 활성화
-- ALTER TABLE public.evaluation_records ENABLE ROW LEVEL SECURITY;
