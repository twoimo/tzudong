-- RLS 정책 임시 비활성화
ALTER TABLE restaurants DISABLE ROW LEVEL SECURITY;

-- tzuyang_review 컬럼 추가 (tzuyang_reviews 배열의 첫 번째 값)
ALTER TABLE restaurants
ADD COLUMN IF NOT EXISTS tzuyang_review TEXT;

-- youtube_link 컬럼 추가 (youtube_links 배열의 첫 번째 값)
ALTER TABLE restaurants
ADD COLUMN IF NOT EXISTS youtube_link TEXT;

-- 기존 배열 데이터에서 첫 번째 값을 새 컬럼으로 이전
UPDATE restaurants
SET tzuyang_review = (tzuyang_reviews->0->>'review')
WHERE tzuyang_reviews IS NOT NULL 
  AND jsonb_array_length(tzuyang_reviews) > 0;

UPDATE restaurants
SET youtube_link = youtube_links[1]
WHERE youtube_links IS NOT NULL 
  AND array_length(youtube_links, 1) > 0;

-- 기존 배열 컬럼 삭제
ALTER TABLE restaurants
DROP COLUMN IF EXISTS youtube_metas,
DROP COLUMN IF EXISTS tzuyang_reviews,
DROP COLUMN IF EXISTS youtube_links;

-- 코멘트 추가
COMMENT ON COLUMN restaurants.tzuyang_review IS '쯔양의 첫 번째 리뷰 (단일 텍스트)';
COMMENT ON COLUMN restaurants.youtube_link IS '첫 번째 유튜브 영상 링크 (단일 텍스트)';

-- RLS 정책 재활성화
ALTER TABLE restaurants ENABLE ROW LEVEL SECURITY;