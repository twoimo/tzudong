-- ========================================
-- 음식점 평가 시스템을 위한 restaurants 테이블 재설계
-- 작성일: 2025-11-05
-- ========================================

-- 1. 기존 restaurants 테이블 백업 (필요시 복구용)
CREATE TABLE IF NOT EXISTS public.restaurants_backup_20251105 AS 
SELECT * FROM public.restaurants;

-- 2. 기존 restaurants 테이블 삭제
DROP TABLE IF EXISTS public.restaurants CASCADE;

-- 3. 새 restaurants 테이블 생성
CREATE TABLE public.restaurants (
  -- 기본 정보
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  phone TEXT,
  
  -- YouTube 관련 데이터 (배열)
  youtube_links TEXT[] DEFAULT '{}' NOT NULL,
  tzuyang_reviews TEXT[] DEFAULT '{}' NOT NULL,
  youtube_metas JSONB[] DEFAULT '{}' NOT NULL,
  
  -- 좌표 (기존 DB 우선, 없으면 Naver 사용)
  lat DECIMAL(10, 8) NOT NULL,
  lng DECIMAL(11, 8) NOT NULL,
  
  -- Naver 지오코딩 주소 정보
  road_address TEXT,                    -- 도로명 주소
  jibun_address TEXT NOT NULL,          -- 지번 주소 (Unique 판단 기준)
  english_address TEXT,                 -- 영문 주소
  address_elements JSONB,               -- 주소 구성 요소
  
  -- 카테고리 (배열, 평가 시 추가 가능)
  category TEXT[] DEFAULT '{}' NOT NULL,
  
  -- 통계
  review_count INTEGER DEFAULT 0,
  
  -- 기타
  description TEXT,
  
  -- 메타 정보
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_by_admin_id UUID REFERENCES auth.users(id)
);

-- 4. 인덱스 생성 (성능 최적화)
CREATE INDEX idx_restaurants_jibun_address ON public.restaurants(jibun_address);
CREATE INDEX idx_restaurants_name ON public.restaurants(name);
CREATE INDEX idx_restaurants_category ON public.restaurants USING GIN(category);
CREATE INDEX idx_restaurants_youtube_links ON public.restaurants USING GIN(youtube_links);

-- 5. 복합 인덱스 (Unique 판단용)
CREATE INDEX idx_restaurants_name_jibun ON public.restaurants(name, jibun_address);

-- 6. Row Level Security 활성화
ALTER TABLE public.restaurants ENABLE ROW LEVEL SECURITY;

-- 7. RLS 정책 생성

-- 7-1. 읽기: 모든 사용자 허용
DROP POLICY IF EXISTS "Anyone can read restaurants" ON public.restaurants;
CREATE POLICY "Anyone can read restaurants"
  ON public.restaurants FOR SELECT
  USING (true);

-- 7-2. 삽입: 관리자만 허용
DROP POLICY IF EXISTS "Only admins can insert restaurants" ON public.restaurants;
CREATE POLICY "Only admins can insert restaurants"
  ON public.restaurants FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.user_roles
      WHERE user_id = auth.uid()
      AND role = 'admin'
    )
  );

-- 7-3. 수정: 관리자만 허용
DROP POLICY IF EXISTS "Only admins can update restaurants" ON public.restaurants;
CREATE POLICY "Only admins can update restaurants"
  ON public.restaurants FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.user_roles
      WHERE user_id = auth.uid()
      AND role = 'admin'
    )
  );

-- 7-4. 삭제: 관리자만 허용
DROP POLICY IF EXISTS "Only admins can delete restaurants" ON public.restaurants;
CREATE POLICY "Only admins can delete restaurants"
  ON public.restaurants FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.user_roles
      WHERE user_id = auth.uid()
      AND role = 'admin'
    )
  );

-- 8. 트리거 함수: updated_at 자동 업데이트
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_restaurants_updated_at ON public.restaurants;
CREATE TRIGGER update_restaurants_updated_at
  BEFORE UPDATE ON public.restaurants
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- 9. evaluation_records 테이블 생성 (transform.jsonl 데이터 저장용)
DROP TABLE IF EXISTS public.evaluation_records CASCADE;
CREATE TABLE public.evaluation_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- 식별 정보
  youtube_link TEXT NOT NULL,
  restaurant_name TEXT NOT NULL,
  
  -- 상태 관리
  status TEXT NOT NULL DEFAULT 'pending' 
    CHECK (status IN ('pending', 'approved', 'hold', 'deleted', 'missing', 'db_conflict', 'geocoding_failed')),
  
  -- 원본 데이터
  youtube_meta JSONB,
  evaluation_results JSONB,
  restaurant_info JSONB,
  
  -- 지오코딩 정보
  geocoding_success BOOLEAN DEFAULT false,
  geocoding_fail_reason TEXT,
  
  -- DB 충돌 정보
  db_conflict_info JSONB,
  
  -- Missing 관련
  missing_message TEXT,
  
  -- 메타 정보
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  processed_by UUID REFERENCES auth.users(id),
  processed_at TIMESTAMP WITH TIME ZONE,
  
  -- 복합 유니크 제약 (같은 youtube_link-restaurant_name은 1개만)
  UNIQUE(youtube_link, restaurant_name)
);

-- 10. evaluation_records 인덱스
CREATE INDEX idx_evaluation_records_status ON public.evaluation_records(status);
CREATE INDEX idx_evaluation_records_youtube_link ON public.evaluation_records(youtube_link);
CREATE INDEX idx_evaluation_records_restaurant_name ON public.evaluation_records(restaurant_name);

-- 11. evaluation_records RLS
ALTER TABLE public.evaluation_records ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins can read evaluation_records" ON public.evaluation_records;
CREATE POLICY "Admins can read evaluation_records"
  ON public.evaluation_records FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.user_roles
      WHERE user_id = auth.uid()
      AND role = 'admin'
    )
  );

DROP POLICY IF EXISTS "Admins can insert evaluation_records" ON public.evaluation_records;
CREATE POLICY "Admins can insert evaluation_records"
  ON public.evaluation_records FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.user_roles
      WHERE user_id = auth.uid()
      AND role = 'admin'
    )
  );

DROP POLICY IF EXISTS "Admins can update evaluation_records" ON public.evaluation_records;
CREATE POLICY "Admins can update evaluation_records"
  ON public.evaluation_records FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.user_roles
      WHERE user_id = auth.uid()
      AND role = 'admin'
    )
  );

DROP POLICY IF EXISTS "Admins can delete evaluation_records" ON public.evaluation_records;
CREATE POLICY "Admins can delete evaluation_records"
  ON public.evaluation_records FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.user_roles
      WHERE user_id = auth.uid()
      AND role = 'admin'
    )
  );

-- 12. evaluation_records updated_at 트리거
DROP TRIGGER IF EXISTS update_evaluation_records_updated_at ON public.evaluation_records;
CREATE TRIGGER update_evaluation_records_updated_at
  BEFORE UPDATE ON public.evaluation_records
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- 13. 완료 메시지
DO $$
BEGIN
  RAISE NOTICE '✅ restaurants 테이블 재설계 완료';
  RAISE NOTICE '✅ evaluation_records 테이블 생성 완료';
  RAISE NOTICE '⚠️ 기존 데이터는 restaurants_backup_20251105에 백업되었습니다';
END
$$;
