-- RLS 정책 성능 최적화 마이그레이션
-- auth.uid() 직접 사용으로 쿼리 성능 향상

-- 기존 v2 정책들을 먼저 삭제
DROP POLICY IF EXISTS "Everyone can view restaurants v2" ON public.restaurants;
DROP POLICY IF EXISTS "Admins can insert restaurants v2" ON public.restaurants;
DROP POLICY IF EXISTS "Admins can update restaurants v2" ON public.restaurants;
DROP POLICY IF EXISTS "Admins can delete restaurants v2" ON public.restaurants;
DROP POLICY IF EXISTS "Users and admins can view roles v3" ON public.user_roles;
DROP POLICY IF EXISTS "Users can insert own profile v2" ON public.profiles;
DROP POLICY IF EXISTS "Users can update own profile v2" ON public.profiles;
DROP POLICY IF EXISTS "Users can delete own profile v2" ON public.profiles;
DROP POLICY IF EXISTS "Reviews are viewable by everyone v2" ON public.reviews;
DROP POLICY IF EXISTS "Users and admins can insert reviews v2" ON public.reviews;
DROP POLICY IF EXISTS "Users and admins can update reviews v2" ON public.reviews;
DROP POLICY IF EXISTS "Users and admins can delete reviews v2" ON public.reviews;
DROP POLICY IF EXISTS "Server costs are viewable by everyone v3" ON public.server_costs;
DROP POLICY IF EXISTS "Admins can manage server costs v3" ON public.server_costs;
DROP POLICY IF EXISTS "Admins can manage server costs update v3" ON public.server_costs;
DROP POLICY IF EXISTS "Admins can manage server costs delete v3" ON public.server_costs;
DROP POLICY IF EXISTS "Authenticated users can create submissions v2" ON public.restaurant_submissions;
DROP POLICY IF EXISTS "Users and admins can view submissions v2" ON public.restaurant_submissions;
DROP POLICY IF EXISTS "Users and admins can update submissions v2" ON public.restaurant_submissions;
DROP POLICY IF EXISTS "Users and admins can delete submissions v2" ON public.restaurant_submissions;

-- 최적화된 정책들 생성 (auth.uid() 직접 사용)
-- restaurants 테이블
CREATE POLICY "Everyone can view restaurants v2"
  ON public.restaurants FOR SELECT
  TO public
  USING (true);

CREATE POLICY "Admins can insert restaurants v2"
  ON public.restaurants FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() IN (
    SELECT user_id FROM public.user_roles WHERE role = 'admin'
  ));

CREATE POLICY "Admins can update restaurants v2"
  ON public.restaurants FOR UPDATE
  TO authenticated
  USING (auth.uid() IN (
    SELECT user_id FROM public.user_roles WHERE role = 'admin'
  ));

CREATE POLICY "Admins can delete restaurants v2"
  ON public.restaurants FOR DELETE
  TO authenticated
  USING (auth.uid() IN (
    SELECT user_id FROM public.user_roles WHERE role = 'admin'
  ));

-- user_roles 테이블
CREATE POLICY "Users and admins can view roles v4"
  ON public.user_roles FOR SELECT
  TO authenticated
  USING (
    user_id = auth.uid() OR
    auth.uid() IN (SELECT user_id FROM public.user_roles WHERE role = 'admin')
  );

-- profiles 테이블
CREATE POLICY "Users can insert own profile v2"
  ON public.profiles FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can update own profile v2"
  ON public.profiles FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "Users can delete own profile v2"
  ON public.profiles FOR DELETE
  TO authenticated
  USING (user_id = auth.uid());

-- reviews 테이블
CREATE POLICY "Reviews are viewable by everyone v2"
  ON public.reviews FOR SELECT
  TO public
  USING (true);

CREATE POLICY "Users and admins can insert reviews v2"
  ON public.reviews FOR INSERT
  TO authenticated
  WITH CHECK (
    user_id = auth.uid() OR
    auth.uid() IN (SELECT user_id FROM public.user_roles WHERE role = 'admin')
  );

CREATE POLICY "Users and admins can update reviews v2"
  ON public.reviews FOR UPDATE
  TO authenticated
  USING (
    user_id = auth.uid() OR
    auth.uid() IN (SELECT user_id FROM public.user_roles WHERE role = 'admin')
  );

CREATE POLICY "Users and admins can delete reviews v2"
  ON public.reviews FOR DELETE
  TO authenticated
  USING (
    user_id = auth.uid() OR
    auth.uid() IN (SELECT user_id FROM public.user_roles WHERE role = 'admin')
  );

-- server_costs 테이블
CREATE POLICY "Server costs are viewable by everyone v4"
  ON public.server_costs FOR SELECT
  TO public
  USING (true);

CREATE POLICY "Admins can manage server costs v4"
  ON public.server_costs FOR ALL
  TO authenticated
  USING (auth.uid() IN (
    SELECT user_id FROM public.user_roles WHERE role = 'admin'
  ))
  WITH CHECK (auth.uid() IN (
    SELECT user_id FROM public.user_roles WHERE role = 'admin'
  ));

-- restaurant_submissions 테이블
CREATE POLICY "Authenticated users can create submissions v2"
  ON public.restaurant_submissions FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users and admins can view submissions v2"
  ON public.restaurant_submissions FOR SELECT
  TO authenticated
  USING (
    user_id = auth.uid() OR
    auth.uid() IN (SELECT user_id FROM public.user_roles WHERE role = 'admin')
  );

CREATE POLICY "Users and admins can update submissions v2"
  ON public.restaurant_submissions FOR UPDATE
  TO authenticated
  USING (
    user_id = auth.uid() OR
    auth.uid() IN (SELECT user_id FROM public.user_roles WHERE role = 'admin')
  );

CREATE POLICY "Users and admins can delete submissions v2"
  ON public.restaurant_submissions FOR DELETE
  TO authenticated
  USING (
    user_id = auth.uid() OR
    auth.uid() IN (SELECT user_id FROM public.user_roles WHERE role = 'admin')
  );

-- user_stats 테이블
CREATE POLICY "User stats are viewable by everyone v2"
  ON public.user_stats FOR SELECT
  TO public
  USING (true);
