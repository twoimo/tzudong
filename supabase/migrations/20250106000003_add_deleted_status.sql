-- Add 'deleted' status to evaluation_records table
-- Soft delete를 위한 상태 추가

-- 0. RLS 비활성화 (중요!)
ALTER TABLE evaluation_records DISABLE ROW LEVEL SECURITY;

-- 1. 기존 CHECK 제약조건 제거
ALTER TABLE evaluation_records 
DROP CONSTRAINT IF EXISTS evaluation_records_status_check;

-- 2. 'deleted' 상태 포함한 새 CHECK 제약조건 추가
ALTER TABLE evaluation_records 
ADD CONSTRAINT evaluation_records_status_check 
CHECK (status IN (
  'pending', 
  'approved', 
  'hold', 
  'missing', 
  'not_selected', 
  'db_conflict', 
  'geocoding_failed',
  'deleted'
));

-- 3. deleted_at 컬럼 추가 (삭제 시점 기록)
ALTER TABLE evaluation_records
ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

-- 4. 인덱스 추가 (deleted 상태 필터링 최적화)
CREATE INDEX IF NOT EXISTS idx_evaluation_records_not_deleted 
ON evaluation_records(status) 
WHERE status != 'deleted';

-- 5. 코멘트 추가
COMMENT ON COLUMN evaluation_records.deleted_at IS 'Soft delete timestamp - records are marked as deleted instead of being removed';
COMMENT ON CONSTRAINT evaluation_records_status_check ON evaluation_records IS 'Evaluation status including soft delete state';
