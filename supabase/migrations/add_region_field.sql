-- Add region field to restaurants table
ALTER TABLE public.restaurants
ADD COLUMN IF NOT EXISTS region TEXT;

-- Create index for region field
CREATE INDEX IF NOT EXISTS idx_restaurants_region ON public.restaurants(region);

-- Update existing data with region information based on address
UPDATE public.restaurants
SET region = CASE
  -- 서울특별시
  WHEN address LIKE '서울특별시%' THEN '서울특별시'
  WHEN address LIKE '서울 %' THEN '서울특별시'
  WHEN address = '서울' THEN '서울특별시'

  -- 부산광역시
  WHEN address LIKE '부산광역시%' THEN '부산광역시'
  WHEN address LIKE '부산 %' THEN '부산광역시'
  WHEN address = '부산' THEN '부산광역시'

  -- 대구광역시
  WHEN address LIKE '대구광역시%' THEN '대구광역시'
  WHEN address LIKE '대구 %' THEN '대구광역시'
  WHEN address = '대구' THEN '대구광역시'

  -- 인천광역시
  WHEN address LIKE '인천광역시%' THEN '인천광역시'
  WHEN address LIKE '인천 %' THEN '인천광역시'
  WHEN address = '인천' THEN '인천광역시'

  -- 광주광역시
  WHEN address LIKE '광주광역시%' THEN '광주광역시'

  -- 대전광역시
  WHEN address LIKE '대전광역시%' THEN '대전광역시'
  WHEN address LIKE '대전 %' THEN '대전광역시'
  WHEN address = '대전' THEN '대전광역시'

  -- 울산광역시
  WHEN address LIKE '울산광역시%' THEN '울산광역시'

  -- 세종특별자치시
  WHEN address LIKE '세종특별자치시%' THEN '세종특별자치시'

  -- 경기도
  WHEN address LIKE '경기도%' THEN '경기도'
  WHEN address LIKE '경기 %' THEN '경기도'
  WHEN address = '경기' THEN '경기도'

  -- 충청북도
  WHEN address LIKE '충청북도%' THEN '충청북도'
  WHEN address LIKE '충북 %' THEN '충청북도'
  WHEN address = '충북' THEN '충청북도'

  -- 충청남도
  WHEN address LIKE '충청남도%' THEN '충청남도'
  WHEN address LIKE '충남 %' THEN '충청남도'
  WHEN address = '충남' THEN '충청남도'

  -- 전라북도
  WHEN address LIKE '전라북도%' THEN '전라북도'
  WHEN address LIKE '전북 %' THEN '전라북도'
  WHEN address = '전북' THEN '전라북도'

  -- 전북특별자치도
  WHEN address LIKE '전북특별자치도%' THEN '전북특별자치도'

  -- 전라남도
  WHEN address LIKE '전라남도%' THEN '전라남도'
  WHEN address LIKE '전남 %' THEN '전라남도'
  WHEN address = '전남' THEN '전라남도'

  -- 울릉도 (먼저 처리해야 함)
  WHEN address LIKE '경상북도 울릉군%' THEN '울릉도'
  WHEN address LIKE '경북 울릉군%' THEN '울릉도'

  -- 경상북도
  WHEN address LIKE '경상북도%' THEN '경상북도'
  WHEN address LIKE '경북 %' THEN '경상북도'
  WHEN address = '경북' THEN '경상북도'

  -- 욕지도 (먼저 처리해야 함)
  WHEN address LIKE '%욕지%' THEN '욕지도'

  -- 경상남도
  WHEN address LIKE '경상남도%' THEN '경상남도'
  WHEN address LIKE '경남 %' THEN '경상남도'
  WHEN address = '경남' THEN '경상남도'

  -- 강원특별자치도
  WHEN address LIKE '강원특별자치도%' THEN '강원특별자치도'
  WHEN address LIKE '강원 %' THEN '강원특별자치도'
  WHEN address = '강원' THEN '강원특별자치도'

  -- 제주특별자치도
  WHEN address LIKE '제주특별자치도%' THEN '제주특별자치도'


  -- 해외 주소는 기타로 분류
  ELSE '기타'
END
WHERE region IS NULL;
