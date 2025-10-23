-- RLS 정책 수정: 인증되지 않은 사용자도 데이터를 볼 수 있도록 변경
-- restaurants 테이블
DROP POLICY IF EXISTS "Restaurants are viewable by everyone" ON public.restaurants;
CREATE POLICY "Restaurants are viewable by everyone"
  ON public.restaurants FOR SELECT
  TO public
  USING (true);

-- user_stats 테이블
DROP POLICY IF EXISTS "User stats are viewable by everyone" ON public.user_stats;
CREATE POLICY "User stats are viewable by everyone"
  ON public.user_stats FOR SELECT
  TO public
  USING (true);

-- reviews 테이블
DROP POLICY IF EXISTS "Reviews are viewable by everyone" ON public.reviews;
CREATE POLICY "Reviews are viewable by everyone"
  ON public.reviews FOR SELECT
  TO public
  USING (true);

-- server_costs 테이블
DROP POLICY IF EXISTS "Server costs are viewable by everyone" ON public.server_costs;
CREATE POLICY "Server costs are viewable by everyone"
  ON public.server_costs FOR SELECT
  TO public
  USING (true);
