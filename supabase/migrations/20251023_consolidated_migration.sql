-- ========================================
-- 쯔양 맛집 지도 - 통합 마이그레이션 파일
-- 모든 마이그레이션을 하나의 파일로 통합
-- ========================================

-- ========================================
-- 1. 초기 스키마 생성 (20251021075749)
-- ========================================

-- Create role enum
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'app_role') THEN
        CREATE TYPE public.app_role AS ENUM ('admin', 'user');
    END IF;
END
$$;

-- Create user_roles table (separate from profiles for security)
DROP TABLE IF EXISTS public.user_roles CASCADE;
CREATE TABLE public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  role app_role NOT NULL DEFAULT 'user',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  UNIQUE(user_id, role)
);

-- Create profiles table
DROP TABLE IF EXISTS public.profiles CASCADE;
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL UNIQUE,
  nickname TEXT NOT NULL UNIQUE,
  email TEXT NOT NULL,
  profile_picture TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  last_login TIMESTAMP WITH TIME ZONE DEFAULT now(),
  nickname_changed BOOLEAN DEFAULT false
);

-- Create categories enum (will be converted to TEXT[] later)
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'restaurant_category') THEN
        CREATE TYPE public.restaurant_category AS ENUM (
  '치킨', '중식', '돈까스·회', '피자', '패스트푸드',
  '찜·탕', '족발·보쌈', '분식', '카페·디저트',
  '한식', '고기', '양식', '아시안', '야식', '도시락'
);
    END IF;
END
$$;

-- Create restaurants table
DROP TABLE IF EXISTS public.restaurants CASCADE;
CREATE TABLE public.restaurants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  address TEXT NOT NULL,
  phone TEXT,
  category restaurant_category NOT NULL,
  youtube_link TEXT,
  tzuyang_review TEXT,
  lat DECIMAL(10, 8) NOT NULL,
  lng DECIMAL(11, 8) NOT NULL,
  visit_count INTEGER DEFAULT 0,
  review_count INTEGER DEFAULT 0,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_by_admin_id UUID REFERENCES auth.users(id),
  description TEXT,
  region TEXT
);

-- Create reviews table
DROP TABLE IF EXISTS public.reviews CASCADE;
CREATE TABLE public.reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  restaurant_id UUID REFERENCES public.restaurants(id) ON DELETE CASCADE NOT NULL,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  visited_at TIMESTAMP WITH TIME ZONE NOT NULL,
  verification_photo TEXT NOT NULL,
  food_photos TEXT[] DEFAULT '{}',
  category restaurant_category NOT NULL,
  is_verified BOOLEAN DEFAULT false,
  admin_note TEXT,
  is_pinned BOOLEAN DEFAULT false,
  edited_by_admin BOOLEAN DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  is_edited_by_admin BOOLEAN DEFAULT false,
  edited_by_admin_id UUID REFERENCES auth.users(id),
  edited_at TIMESTAMP WITH TIME ZONE,
  categories TEXT[]
);

-- Create server_costs table
DROP TABLE IF EXISTS public.server_costs CASCADE;
CREATE TABLE public.server_costs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  item_name TEXT NOT NULL,
  monthly_cost DECIMAL(10, 2) NOT NULL,
  description TEXT,
  updated_by UUID REFERENCES auth.users(id),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Create user_stats table for leaderboard
DROP TABLE IF EXISTS public.user_stats CASCADE;
CREATE TABLE public.user_stats (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL UNIQUE,
  review_count INTEGER DEFAULT 0,
  verified_review_count INTEGER DEFAULT 0,
  trust_score DECIMAL(5, 2) DEFAULT 0,
  last_updated TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Create restaurant_submissions table
CREATE TABLE IF NOT EXISTS public.restaurant_submissions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    restaurant_name TEXT NOT NULL,
    address TEXT NOT NULL,
    phone TEXT,
    category TEXT[] NOT NULL,
    youtube_link TEXT NOT NULL,
    description TEXT,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
    rejection_reason TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    reviewed_by_admin_id UUID REFERENCES auth.users(id),
    reviewed_at TIMESTAMPTZ,
    approved_restaurant_id UUID REFERENCES public.restaurants(id) ON DELETE CASCADE,
    submission_type TEXT DEFAULT 'new' CHECK (submission_type IN ('new', 'update')),
    original_restaurant_id UUID REFERENCES public.restaurants(id),
    changes_requested JSONB
);

-- ========================================
-- 2. Enable RLS on all tables
-- ========================================

ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.restaurants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.server_costs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_stats ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.restaurant_submissions ENABLE ROW LEVEL SECURITY;

-- ========================================
-- 3. Functions
-- ========================================

-- Create security definer function to check roles
CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role app_role)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles
    WHERE user_id = _user_id
    AND role = _role
  )
$$;

-- Create trigger function for profile creation
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (user_id, nickname, email)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'nickname', 'user_' || substr(NEW.id::text, 1, 8)),
    NEW.email
  );

  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, 'user');

  INSERT INTO public.user_stats (user_id)
  VALUES (NEW.id);

  RETURN NEW;
END;
$$;

-- Create function to increment review count
CREATE OR REPLACE FUNCTION increment_review_count(restaurant_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE restaurants
  SET review_count = COALESCE(review_count, 0) + 1
  WHERE id = restaurant_id;
END;
$$;

-- Create function to decrement review count
CREATE OR REPLACE FUNCTION decrement_review_count(restaurant_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE restaurants
  SET review_count = GREATEST(COALESCE(review_count, 0) - 1, 0)
  WHERE id = restaurant_id;
END;
$$;

-- Create function to update user stats after review submission
CREATE OR REPLACE FUNCTION update_user_stats_on_review()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE user_stats
    SET
      review_count = COALESCE(review_count, 0) + 1,
      last_updated = now()
    WHERE user_id = NEW.user_id;

    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' AND NEW.is_verified = true AND OLD.is_verified = false THEN
    UPDATE user_stats
    SET
      verified_review_count = COALESCE(verified_review_count, 0) + 1,
      trust_score = LEAST(COALESCE(trust_score, 0) + 5, 100),
      last_updated = now()
    WHERE user_id = NEW.user_id;

    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE user_stats
    SET
      review_count = GREATEST(COALESCE(review_count, 0) - 1, 0),
      verified_review_count = CASE
        WHEN OLD.is_verified THEN GREATEST(COALESCE(verified_review_count, 0) - 1, 0)
        ELSE COALESCE(verified_review_count, 0)
      END,
      last_updated = now()
    WHERE user_id = OLD.user_id;

    RETURN OLD;
  END IF;

  RETURN NEW;
END;
$$;

-- Create function to set edited_at when is_edited_by_admin changes
CREATE OR REPLACE FUNCTION public.set_review_edited_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.is_edited_by_admin = true AND (OLD.is_edited_by_admin IS NULL OR OLD.is_edited_by_admin = false) THEN
    NEW.edited_at = now();
  END IF;
  RETURN NEW;
END;
$$;

-- Create function to update updated_at timestamp
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- ========================================
-- 4. RLS Policies
-- ========================================

-- RLS Policies for user_roles
CREATE POLICY "Users and admins can view roles"
  ON public.user_roles FOR SELECT
  TO authenticated
  USING (user_id = (select auth.uid()) OR public.has_role((select auth.uid()), 'admin'));

-- RLS Policies for profiles
CREATE POLICY "Public profiles are viewable by everyone"
  ON public.profiles FOR SELECT
  TO public
  USING (true);

CREATE POLICY "Users can update own profile"
  ON public.profiles FOR UPDATE
  TO authenticated
  USING (user_id = (select auth.uid()));

CREATE POLICY "Users can insert own profile"
  ON public.profiles FOR INSERT
  TO authenticated
  WITH CHECK (user_id = (select auth.uid()));

-- RLS Policies for restaurants
CREATE POLICY "Restaurants are viewable by everyone"
  ON public.restaurants FOR SELECT
  TO public
  USING (true);

CREATE POLICY "Admins can insert restaurants"
  ON public.restaurants FOR INSERT
  TO authenticated
  WITH CHECK (public.has_role((select auth.uid()), 'admin'));

CREATE POLICY "Admins can update restaurants"
  ON public.restaurants FOR UPDATE
  TO authenticated
  USING (public.has_role((select auth.uid()), 'admin'));

CREATE POLICY "Admins can delete restaurants"
  ON public.restaurants FOR DELETE
  TO authenticated
  USING (public.has_role((select auth.uid()), 'admin'));

-- RLS Policies for reviews
CREATE POLICY "Reviews are viewable by everyone"
  ON public.reviews FOR SELECT
  TO public
  USING (true);

CREATE POLICY "Users can insert own reviews"
  ON public.reviews FOR INSERT
  TO authenticated
  WITH CHECK (user_id = (select auth.uid()));

CREATE POLICY "Users and admins can update reviews"
  ON public.reviews FOR UPDATE
  TO authenticated
  USING (user_id = (select auth.uid()) OR public.has_role((select auth.uid()), 'admin'));

CREATE POLICY "Users and admins can delete reviews"
  ON public.reviews FOR DELETE
  TO authenticated
  USING (user_id = (select auth.uid()) OR public.has_role((select auth.uid()), 'admin'));

-- RLS Policies for server_costs
CREATE POLICY "Server costs are viewable by everyone"
  ON public.server_costs FOR SELECT
  TO public
  USING (true);

CREATE POLICY "Admins can manage server costs"
  ON public.server_costs FOR ALL
  TO authenticated
  USING (public.has_role((select auth.uid()), 'admin'));

-- RLS Policies for user_stats
CREATE POLICY "User stats are viewable by everyone"
  ON public.user_stats FOR SELECT
  TO public
  USING (true);

-- RLS Policies for restaurant_submissions
CREATE POLICY "Users can view their own submissions"
    ON public.restaurant_submissions
    FOR SELECT
    TO authenticated
    USING (auth.uid() = user_id);

CREATE POLICY "Admins can view all submissions"
    ON public.restaurant_submissions
    FOR SELECT
    TO authenticated
    USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Authenticated users can create submissions"
    ON public.restaurant_submissions
    FOR INSERT
    TO authenticated
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own pending submissions"
    ON public.restaurant_submissions
    FOR UPDATE
    TO authenticated
    USING (auth.uid() = user_id AND status = 'pending')
    WITH CHECK (auth.uid() = user_id AND status = 'pending');

CREATE POLICY "Admins can update all submissions"
    ON public.restaurant_submissions
    FOR UPDATE
    TO authenticated
    USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Users can delete their own pending submissions"
    ON public.restaurant_submissions
    FOR DELETE
    TO authenticated
    USING (auth.uid() = user_id AND status = 'pending');

CREATE POLICY "Admins can delete all submissions"
    ON public.restaurant_submissions
    FOR DELETE
    TO authenticated
    USING (public.has_role(auth.uid(), 'admin'));

-- ========================================
-- 5. Views
-- ========================================

-- Create submission stats view
CREATE OR REPLACE VIEW public.submission_stats AS
SELECT
    user_id,
    COUNT(*) FILTER (WHERE status = 'pending') AS pending_count,
    COUNT(*) FILTER (WHERE status = 'approved') AS approved_count,
    COUNT(*) FILTER (WHERE status = 'rejected') AS rejected_count,
    COUNT(*) AS total_count
FROM public.restaurant_submissions
GROUP BY user_id;

-- ========================================
-- 6. Triggers
-- ========================================

-- Trigger for new user
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Create trigger for user stats
DROP TRIGGER IF EXISTS trigger_update_user_stats ON reviews;
CREATE TRIGGER trigger_update_user_stats
  AFTER INSERT OR UPDATE OR DELETE ON reviews
  FOR EACH ROW EXECUTE FUNCTION update_user_stats_on_review();

-- Create trigger for review edited_at
DROP TRIGGER IF EXISTS trigger_set_review_edited_at ON reviews;
CREATE TRIGGER trigger_set_review_edited_at
  BEFORE UPDATE ON reviews
  FOR EACH ROW EXECUTE FUNCTION public.set_review_edited_at();

-- Triggers for updated_at
DROP TRIGGER IF EXISTS update_restaurants_updated_at ON public.restaurants;
CREATE TRIGGER update_restaurants_updated_at
  BEFORE UPDATE ON public.restaurants
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS update_reviews_updated_at ON public.reviews;
CREATE TRIGGER update_reviews_updated_at
  BEFORE UPDATE ON public.reviews
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS update_server_costs_updated_at ON public.server_costs;
CREATE TRIGGER update_server_costs_updated_at
  BEFORE UPDATE ON public.server_costs
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ========================================
-- 7. Storage Bucket
-- ========================================

-- Create storage bucket for review photos
INSERT INTO storage.buckets (id, name, public)
VALUES ('review-photos', 'review-photos', true)
ON CONFLICT (id) DO NOTHING;

-- Storage policies for review photos
DROP POLICY IF EXISTS "Anyone can view review photos" ON storage.objects;
CREATE POLICY "Anyone can view review photos"
  ON storage.objects FOR SELECT
  TO public
  USING (bucket_id = 'review-photos');

DROP POLICY IF EXISTS "Authenticated users can upload review photos" ON storage.objects;
CREATE POLICY "Authenticated users can upload review photos"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'review-photos');

DROP POLICY IF EXISTS "Users can update own review photos" ON storage.objects;
CREATE POLICY "Users can update own review photos"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (bucket_id = 'review-photos' AND auth.uid()::text = (storage.foldername(name))[1]);

DROP POLICY IF EXISTS "Users can delete own review photos" ON storage.objects;
CREATE POLICY "Users can delete own review photos"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (bucket_id = 'review-photos' AND auth.uid()::text = (storage.foldername(name))[1]);

-- ========================================
-- 8. Indexes
-- ========================================

-- Create indexes for performance
DROP INDEX IF EXISTS idx_restaurants_lat_lng;
CREATE INDEX idx_restaurants_lat_lng ON public.restaurants(lat, lng);
DROP INDEX IF EXISTS idx_restaurants_category;
CREATE INDEX idx_restaurants_category ON public.restaurants(category);
DROP INDEX IF EXISTS idx_restaurants_region;
CREATE INDEX idx_restaurants_region ON public.restaurants(region);

DROP INDEX IF EXISTS idx_reviews_restaurant_id;
CREATE INDEX idx_reviews_restaurant_id ON public.reviews(restaurant_id);
DROP INDEX IF EXISTS idx_reviews_user_id;
CREATE INDEX idx_reviews_user_id ON public.reviews(user_id);
DROP INDEX IF EXISTS idx_reviews_created_at;
CREATE INDEX idx_reviews_created_at ON public.reviews(created_at DESC);
DROP INDEX IF EXISTS idx_reviews_is_edited_by_admin;
CREATE INDEX idx_reviews_is_edited_by_admin ON public.reviews(is_edited_by_admin);

DROP INDEX IF EXISTS idx_user_stats_trust_score;
CREATE INDEX idx_user_stats_trust_score ON public.user_stats(trust_score DESC);

DROP INDEX IF EXISTS idx_restaurant_submissions_user_id;
CREATE INDEX idx_restaurant_submissions_user_id ON public.restaurant_submissions(user_id);
DROP INDEX IF EXISTS idx_restaurant_submissions_status;
CREATE INDEX idx_restaurant_submissions_status ON public.restaurant_submissions(status);
DROP INDEX IF EXISTS idx_restaurant_submissions_created_at;
CREATE INDEX idx_restaurant_submissions_created_at ON public.restaurant_submissions(created_at DESC);

-- ========================================
-- 9. Migrate data from tzuyang_review to description
-- ========================================

-- Migrate data from tzuyang_review to description (if needed)
UPDATE public.restaurants
SET description = tzuyang_review
WHERE description IS NULL AND tzuyang_review IS NOT NULL;

-- Migrate data from edited_by_admin to is_edited_by_admin
UPDATE public.reviews
SET is_edited_by_admin = edited_by_admin
WHERE is_edited_by_admin IS NULL;

-- ========================================
-- 10. Update region data based on address
-- ========================================

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
  WHEN address LIKE '광주 %' THEN '광주광역시'
  WHEN address = '광주' THEN '광주광역시'

  -- 대전광역시
  WHEN address LIKE '대전광역시%' THEN '대전광역시'
  WHEN address LIKE '대전 %' THEN '대전광역시'
  WHEN address = '대전' THEN '대전광역시'

  -- 울산광역시
  WHEN address LIKE '울산광역시%' THEN '울산광역시'
  WHEN address LIKE '울산 %' THEN '울산광역시'
  WHEN address = '울산' THEN '울산광역시'

  -- 세종특별자치시
  WHEN address LIKE '세종특별자치시%' THEN '세종특별자치시'
  WHEN address LIKE '세종 %' THEN '세종특별자치시'
  WHEN address = '세종' THEN '세종특별자치시'

  -- 경기도
  WHEN address LIKE '경기도%' THEN '경기도'
  WHEN address LIKE '경기 %' THEN '경기도'
  WHEN address = '경기' THEN '경기도'

  -- 강원특별자치도
  WHEN address LIKE '강원특별자치도%' THEN '강원특별자치도'
  WHEN address LIKE '강원도%' THEN '강원특별자치도'
  WHEN address LIKE '강원 %' THEN '강원특별자치도'
  WHEN address = '강원' THEN '강원특별자치도'

  -- 충청북도
  WHEN address LIKE '충청북도%' THEN '충청북도'
  WHEN address LIKE '충북 %' THEN '충청북도'
  WHEN address = '충북' THEN '충청북도'

  -- 충청남도
  WHEN address LIKE '충청남도%' THEN '충청남도'
  WHEN address LIKE '충남 %' THEN '충청남도'
  WHEN address = '충남' THEN '충청남도'

  -- 전라북도
  WHEN address LIKE '전라북도%' THEN '전북특별자치도'
  WHEN address LIKE '전북특별자치도%' THEN '전북특별자치도'
  WHEN address LIKE '전북 %' THEN '전북특별자치도'
  WHEN address = '전북' THEN '전북특별자치도'

  -- 전라남도
  WHEN address LIKE '전라남도%' THEN '전라남도'
  WHEN address LIKE '전남 %' THEN '전라남도'
  WHEN address = '전남' THEN '전라남도'

  -- 경상북도
  WHEN address LIKE '경상북도%' THEN '경상북도'
  WHEN address LIKE '경북 %' THEN '경상북도'
  WHEN address = '경북' THEN '경상북도'

  -- 경상남도
  WHEN address LIKE '경상남도%' THEN '경상남도'
  WHEN address LIKE '경남 %' THEN '경상남도'
  WHEN address = '경남' THEN '경상남도'

  -- 제주특별자치도
  WHEN address LIKE '제주특별자치도%' THEN '제주특별자치도'
  WHEN address LIKE '제주 %' THEN '제주특별자치도'
  WHEN address = '제주' THEN '제주특별자치도'

  -- 울릉도 (경상북도 울릉군)
  WHEN address LIKE '경상북도 울릉군%' THEN '울릉도'
  WHEN address LIKE '경북 울릉군%' THEN '울릉도'
  WHEN address LIKE '%울릉%' THEN '울릉도'

  -- 욕지도 (경상남도 통영시)
  WHEN address LIKE '%욕지%' THEN '욕지도'

  ELSE '기타'
END
WHERE region IS NULL;

-- ========================================
-- 11. Grant admin role to twoimo@dgu.ac.kr
-- ========================================

INSERT INTO public.user_roles (user_id, role)
SELECT id, 'admin'
FROM auth.users
WHERE email = 'twoimo@dgu.ac.kr'
ON CONFLICT (user_id, role) DO NOTHING;
