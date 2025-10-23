-- RLS 정책 수정: 인증되지 않은 사용자도 데이터를 볼 수 있도록 변경 + 성능 최적화

-- 1. 먼저 모든 기존 v2 정책들을 삭제 (충돌 방지)
DROP POLICY IF EXISTS "Everyone can view restaurants v2" ON public.restaurants;
DROP POLICY IF EXISTS "Admins can insert restaurants v2" ON public.restaurants;
DROP POLICY IF EXISTS "Admins can update restaurants v2" ON public.restaurants;
DROP POLICY IF EXISTS "Admins can delete restaurants v2" ON public.restaurants;
DROP POLICY IF EXISTS "Admins can view all roles v2" ON public.user_roles;
DROP POLICY IF EXISTS "Users can view their own roles v2" ON public.user_roles;
DROP POLICY IF EXISTS "Users can insert own profile v2" ON public.profiles;
DROP POLICY IF EXISTS "Users can update own profile v2" ON public.profiles;
DROP POLICY IF EXISTS "Users can delete own profile v2" ON public.profiles;
DROP POLICY IF EXISTS "Reviews are viewable by everyone v2" ON public.reviews;
DROP POLICY IF EXISTS "Users and admins can insert reviews v2" ON public.reviews;
DROP POLICY IF EXISTS "Users and admins can update reviews v2" ON public.reviews;
DROP POLICY IF EXISTS "Users and admins can delete reviews v2" ON public.reviews;
DROP POLICY IF EXISTS "Server costs are viewable by everyone v2" ON public.server_costs;
DROP POLICY IF EXISTS "Admins can manage server costs v2" ON public.server_costs;
DROP POLICY IF EXISTS "Authenticated users can create submissions v2" ON public.restaurant_submissions;
DROP POLICY IF EXISTS "Users and admins can view submissions v2" ON public.restaurant_submissions;
DROP POLICY IF EXISTS "Users and admins can update submissions v2" ON public.restaurant_submissions;
DROP POLICY IF EXISTS "Users and admins can delete submissions v2" ON public.restaurant_submissions;
DROP POLICY IF EXISTS "User stats are viewable by everyone v2" ON public.user_stats;

-- 2. restaurants 테이블 정책 재생성 (중복 제거 및 성능 최적화)
-- 기존 정책들을 강제로 삭제
DROP POLICY IF EXISTS "Restaurants are viewable by everyone" ON public.restaurants;
DROP POLICY IF EXISTS "Everyone can view restaurants" ON public.restaurants;
DROP POLICY IF EXISTS "Admins can manage restaurants" ON public.restaurants;
DROP POLICY IF EXISTS "Admins can insert restaurants" ON public.restaurants;
DROP POLICY IF EXISTS "Admins can update restaurants" ON public.restaurants;
DROP POLICY IF EXISTS "Admins can delete restaurants" ON public.restaurants;

-- 통합된 SELECT 정책 (모든 사용자에게 공개)
CREATE POLICY "Everyone can view restaurants v2"
  ON public.restaurants FOR SELECT
  TO public
  USING (true);

-- 관리자용 INSERT 정책 (성능 최적화)
CREATE POLICY "Admins can insert restaurants v2"
  ON public.restaurants FOR INSERT
  TO authenticated
  WITH CHECK ((SELECT auth.uid()) IN (
    SELECT user_id FROM public.user_roles WHERE role = 'admin'
  ));

-- 관리자용 UPDATE 정책 (성능 최적화)
CREATE POLICY "Admins can update restaurants v2"
  ON public.restaurants FOR UPDATE
  TO authenticated
  USING ((SELECT auth.uid()) IN (
    SELECT user_id FROM public.user_roles WHERE role = 'admin'
  ));

-- 관리자용 DELETE 정책 (성능 최적화)
CREATE POLICY "Admins can delete restaurants v2"
  ON public.restaurants FOR DELETE
  TO authenticated
  USING ((SELECT auth.uid()) IN (
    SELECT user_id FROM public.user_roles WHERE role = 'admin'
  ));

-- user_roles 테이블 정책 재생성 (중복 제거 및 성능 최적화)
DROP POLICY IF EXISTS "Admins can view all roles" ON public.user_roles;
DROP POLICY IF EXISTS "Users can view their own roles" ON public.user_roles;
DROP POLICY IF EXISTS "Admins can view all roles v2" ON public.user_roles;
DROP POLICY IF EXISTS "Users can view their own roles v2" ON public.user_roles;

-- 통합된 역할 조회 정책 (관리자는 모두, 사용자는 본인만, 성능 최적화)
CREATE POLICY "Users and admins can view roles v3"
  ON public.user_roles FOR SELECT
  TO authenticated
  USING (
    user_id = (SELECT auth.uid()) OR
    (SELECT auth.uid()) IN (SELECT user_id FROM public.user_roles WHERE role = 'admin')
  );

-- profiles 테이블 정책 재생성 (성능 최적화)
DROP POLICY IF EXISTS "Users can insert own profile" ON public.profiles;
DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;
DROP POLICY IF EXISTS "Users can delete own profile" ON public.profiles;

-- 프로필 INSERT 정책 (성능 최적화)
CREATE POLICY "Users can insert own profile v2"
  ON public.profiles FOR INSERT
  TO authenticated
  WITH CHECK (user_id = (SELECT auth.uid()));

-- 프로필 UPDATE 정책 (성능 최적화)
CREATE POLICY "Users can update own profile v2"
  ON public.profiles FOR UPDATE
  TO authenticated
  USING (user_id = (SELECT auth.uid()));

-- 프로필 DELETE 정책 (성능 최적화)
CREATE POLICY "Users can delete own profile v2"
  ON public.profiles FOR DELETE
  TO authenticated
  USING (user_id = (SELECT auth.uid()));

-- reviews 테이블 정책 재생성 (중복 제거 및 성능 최적화)
DROP POLICY IF EXISTS "Reviews are viewable by everyone" ON public.reviews;
DROP POLICY IF EXISTS "Users can insert own reviews" ON public.reviews;
DROP POLICY IF EXISTS "Users can only review Jjyang-visited restaurants" ON public.reviews;
DROP POLICY IF EXISTS "Users can update own reviews" ON public.reviews;
DROP POLICY IF EXISTS "Users can delete own reviews" ON public.reviews;
DROP POLICY IF EXISTS "Admins can update all reviews" ON public.reviews;
DROP POLICY IF EXISTS "Admins can delete all reviews" ON public.reviews;
DROP POLICY IF EXISTS "Users and admins can insert reviews" ON public.reviews;
DROP POLICY IF EXISTS "Users and admins can update reviews" ON public.reviews;
DROP POLICY IF EXISTS "Users and admins can delete reviews" ON public.reviews;

-- 리뷰 SELECT 정책 (모든 사용자에게 공개)
CREATE POLICY "Reviews are viewable by everyone v2"
  ON public.reviews FOR SELECT
  TO public
  USING (true);

-- 리뷰 INSERT 정책 (사용자 + 관리자, 성능 최적화)
CREATE POLICY "Users and admins can insert reviews v2"
  ON public.reviews FOR INSERT
  TO authenticated
  WITH CHECK (
    user_id = (SELECT auth.uid()) OR
    (SELECT auth.uid()) IN (SELECT user_id FROM public.user_roles WHERE role = 'admin')
  );

-- 리뷰 UPDATE 정책 (사용자 본인 + 관리자, 성능 최적화)
CREATE POLICY "Users and admins can update reviews v2"
  ON public.reviews FOR UPDATE
  TO authenticated
  USING (
    user_id = (SELECT auth.uid()) OR
    (SELECT auth.uid()) IN (SELECT user_id FROM public.user_roles WHERE role = 'admin')
  );

-- 리뷰 DELETE 정책 (사용자 본인 + 관리자, 성능 최적화)
CREATE POLICY "Users and admins can delete reviews v2"
  ON public.reviews FOR DELETE
  TO authenticated
  USING (
    user_id = (SELECT auth.uid()) OR
    (SELECT auth.uid()) IN (SELECT user_id FROM public.user_roles WHERE role = 'admin')
  );

-- server_costs 테이블 정책 재생성 (중복 제거 및 성능 최적화)
DROP POLICY IF EXISTS "Server costs are viewable by everyone" ON public.server_costs;
DROP POLICY IF EXISTS "Admins can manage server costs" ON public.server_costs;
DROP POLICY IF EXISTS "Server costs are viewable by everyone v2" ON public.server_costs;
DROP POLICY IF EXISTS "Admins can manage server costs v2" ON public.server_costs;

-- 서버 비용 SELECT 정책 (모든 사용자에게 공개, public 역할)
CREATE POLICY "Server costs are viewable by everyone v3"
  ON public.server_costs FOR SELECT
  TO public
  USING (true);

-- 서버 비용 관리 정책 (관리자만, INSERT/UPDATE/DELETE)
CREATE POLICY "Admins can manage server costs v3"
  ON public.server_costs FOR INSERT
  TO authenticated
  WITH CHECK ((SELECT auth.uid()) IN (
    SELECT user_id FROM public.user_roles WHERE role = 'admin'
  ));

CREATE POLICY "Admins can manage server costs update v3"
  ON public.server_costs FOR UPDATE
  TO authenticated
  USING ((SELECT auth.uid()) IN (
    SELECT user_id FROM public.user_roles WHERE role = 'admin'
  ));

CREATE POLICY "Admins can manage server costs delete v3"
  ON public.server_costs FOR DELETE
  TO authenticated
  USING ((SELECT auth.uid()) IN (
    SELECT user_id FROM public.user_roles WHERE role = 'admin'
  ));

-- restaurant_submissions 테이블 정책 재생성 (중복 제거 및 성능 최적화)
DROP POLICY IF EXISTS "Authenticated users can create submissions" ON public.restaurant_submissions;
DROP POLICY IF EXISTS "Users can view their own submissions" ON public.restaurant_submissions;
DROP POLICY IF EXISTS "Users can update their own pending submissions" ON public.restaurant_submissions;
DROP POLICY IF EXISTS "Users can delete their own pending submissions" ON public.restaurant_submissions;
DROP POLICY IF EXISTS "Admins can view all submissions" ON public.restaurant_submissions;
DROP POLICY IF EXISTS "Admins can update all submissions" ON public.restaurant_submissions;
DROP POLICY IF EXISTS "Admins can delete all submissions" ON public.restaurant_submissions;
DROP POLICY IF EXISTS "Users and admins can view submissions" ON public.restaurant_submissions;
DROP POLICY IF EXISTS "Users and admins can update submissions" ON public.restaurant_submissions;
DROP POLICY IF EXISTS "Users and admins can delete submissions" ON public.restaurant_submissions;

-- 제보 CREATE 정책 (인증된 사용자, 성능 최적화)
CREATE POLICY "Authenticated users can create submissions v2"
  ON public.restaurant_submissions FOR INSERT
  TO authenticated
  WITH CHECK (user_id = (SELECT auth.uid()));

-- 제보 SELECT 정책 (사용자 본인 + 관리자, 성능 최적화)
CREATE POLICY "Users and admins can view submissions v2"
  ON public.restaurant_submissions FOR SELECT
  TO authenticated
  USING (
    user_id = (SELECT auth.uid()) OR
    (SELECT auth.uid()) IN (SELECT user_id FROM public.user_roles WHERE role = 'admin')
  );

-- 제보 UPDATE 정책 (사용자 본인 + 관리자, 성능 최적화)
CREATE POLICY "Users and admins can update submissions v2"
  ON public.restaurant_submissions FOR UPDATE
  TO authenticated
  USING (
    user_id = (SELECT auth.uid()) OR
    (SELECT auth.uid()) IN (SELECT user_id FROM public.user_roles WHERE role = 'admin')
  );

-- 제보 DELETE 정책 (사용자 본인 + 관리자, 성능 최적화)
CREATE POLICY "Users and admins can delete submissions v2"
  ON public.restaurant_submissions FOR DELETE
  TO authenticated
  USING (
    user_id = (SELECT auth.uid()) OR
    (SELECT auth.uid()) IN (SELECT user_id FROM public.user_roles WHERE role = 'admin')
  );

-- user_stats 테이블 정책 (누락된 부분 추가)
DROP POLICY IF EXISTS "User stats are viewable by everyone" ON public.user_stats;

-- 사용자 통계 SELECT 정책 (모든 사용자에게 공개)
CREATE POLICY "User stats are viewable by everyone v3"
  ON public.user_stats FOR SELECT
  TO public
  USING (true);
