-- 레스토랑 삭제 시 관련 제보도 자동 삭제되도록 CASCADE 설정 변경

-- 기존 외래 키 제약 조건 삭제 후 재생성
ALTER TABLE public.restaurant_submissions
DROP CONSTRAINT IF EXISTS restaurant_submissions_approved_restaurant_id_fkey;

-- CASCADE DELETE로 재생성
ALTER TABLE public.restaurant_submissions
ADD CONSTRAINT restaurant_submissions_approved_restaurant_id_fkey
FOREIGN KEY (approved_restaurant_id)
REFERENCES public.restaurants(id)
ON DELETE CASCADE;

-- 수정 요청 기능 추가를 위한 필드들
ALTER TABLE public.restaurant_submissions
ADD COLUMN IF NOT EXISTS submission_type TEXT DEFAULT 'new' CHECK (submission_type IN ('new', 'update')),
ADD COLUMN IF NOT EXISTS original_restaurant_id UUID REFERENCES public.restaurants(id),
ADD COLUMN IF NOT EXISTS changes_requested JSONB;

-- 다중 카테고리 지원을 위한 스키마 변경
-- 안전한 마이그레이션: 임시 컬럼 사용

-- 1. restaurants 테이블 마이그레이션 (안전하게 실행)
DO $$
BEGIN
    -- category 컬럼이 enum 타입인지 확인하고 TEXT[]로 변환
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'restaurants' AND column_name = 'category'
        AND data_type = 'USER-DEFINED'
    ) THEN
        -- enum 타입인 경우 TEXT[]로 변환
        ALTER TABLE public.restaurants ADD COLUMN IF NOT EXISTS category_temp TEXT[];
        UPDATE public.restaurants SET category_temp = ARRAY[category::TEXT] WHERE category IS NOT NULL;
        UPDATE public.restaurants SET category_temp = ARRAY[]::TEXT[] WHERE category IS NULL;
        ALTER TABLE public.restaurants DROP COLUMN category;
        ALTER TABLE public.restaurants RENAME COLUMN category_temp TO category;
    END IF;
END $$;

-- 2. restaurant_submissions 테이블 마이그레이션 (안전하게 실행)
DO $$
BEGIN
    -- category 컬럼이 TEXT 타입인지 확인하고 TEXT[]로 변환
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'restaurant_submissions' AND column_name = 'category'
        AND data_type = 'text'
    ) THEN
        -- TEXT 타입인 경우 TEXT[]로 변환
        ALTER TABLE public.restaurant_submissions ADD COLUMN IF NOT EXISTS category_temp TEXT[];
        UPDATE public.restaurant_submissions SET category_temp = ARRAY[category::TEXT] WHERE category IS NOT NULL;
        UPDATE public.restaurant_submissions SET category_temp = ARRAY[]::TEXT[] WHERE category IS NULL;
        ALTER TABLE public.restaurant_submissions DROP COLUMN category;
        ALTER TABLE public.restaurant_submissions RENAME COLUMN category_temp TO category;
    END IF;
END $$;

-- 3. reviews 테이블의 기존 category 컬럼도 TEXT[]로 변환 (enum 의존성 제거)
DO $$
BEGIN
    -- category 컬럼이 enum 타입인지 확인하고 TEXT[]로 변환
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'reviews' AND column_name = 'category'
        AND data_type = 'USER-DEFINED'
    ) THEN
        -- enum 타입인 경우 TEXT[]로 변환
        ALTER TABLE public.reviews ADD COLUMN IF NOT EXISTS category_temp TEXT[];
        UPDATE public.reviews SET category_temp = ARRAY[category::TEXT] WHERE category IS NOT NULL;
        UPDATE public.reviews SET category_temp = ARRAY[]::TEXT[] WHERE category IS NULL;
        ALTER TABLE public.reviews DROP COLUMN category;
        ALTER TABLE public.reviews RENAME COLUMN category_temp TO category;
    END IF;
END $$;

-- 4. enum 타입 제거 (모든 테이블이 업데이트된 후)
DROP TYPE IF EXISTS restaurant_category CASCADE;

-- 5. reviews 테이블에 새로운 categories 컬럼 추가 (다중 카테고리용)
ALTER TABLE public.reviews ADD COLUMN IF NOT EXISTS categories TEXT[];

-- 설명: 이제 레스토랑을 삭제하면 해당 레스토랑을 참조하는 모든 제보도 자동으로 삭제됩니다.
-- 수정 요청 기능: submission_type으로 신규/수정 구분, original_restaurant_id로 대상 맛집 지정, changes_requested로 변경사항 저장
