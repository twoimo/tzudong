-- RLS 다시 활성화
ALTER TABLE public.evaluation_records ENABLE ROW LEVEL SECURITY;

-- 데이터 현황 확인
SELECT status, COUNT(*) as count 
FROM evaluation_records 
GROUP BY status 
ORDER BY count DESC;

-- 총 레코드 수
SELECT COUNT(*) as total_records FROM evaluation_records;
