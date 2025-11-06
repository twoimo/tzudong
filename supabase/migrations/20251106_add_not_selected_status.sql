-- evaluation_records 테이블의 status에 'not_selected' 추가

-- 기존 CHECK 제약 제거
ALTER TABLE public.evaluation_records 
DROP CONSTRAINT IF EXISTS evaluation_records_status_check;

-- 새로운 CHECK 제약 추가 (not_selected 포함)
ALTER TABLE public.evaluation_records 
ADD CONSTRAINT evaluation_records_status_check 
CHECK (status IN (
  'pending', 
  'approved', 
  'hold', 
  'deleted', 
  'missing', 
  'db_conflict', 
  'geocoding_failed',
  'not_selected'
));

-- 코멘트 추가
COMMENT ON COLUMN public.evaluation_records.status IS 
'레코드 상태: pending(대기), approved(승인), hold(보류), deleted(삭제), missing(누락), db_conflict(DB충돌), geocoding_failed(지오코딩실패), not_selected(평가미대상)';

-- RLS 비활성화 (데이터 로드를 위해)
ALTER TABLE public.evaluation_records DISABLE ROW LEVEL SECURITY;
