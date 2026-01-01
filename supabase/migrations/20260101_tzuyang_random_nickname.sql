-- 쯔양 테마 랜덤 닉네임 생성을 위한 handle_new_user 함수 업데이트
-- 실행 방법: Supabase SQL Editor에서 실행

DROP FUNCTION IF EXISTS public.handle_new_user() CASCADE;

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    prefixes TEXT[] := ARRAY[
        '위장이2개',     -- 쯔양 별명
        '블랙홀위장',    -- 먹방 유머
        '쯔동민턴',      -- 쯔동 + 배드민턴
        '냉면빨대',      -- 쯔양 냉면 빨대흡입
        '짜장면통째로',  -- 자장면 통으로
        '라면8봉',       -- 라면 많이 먹방
        '삼겹살산맥',    -- 고기 먹방
        '치킨흡입기',    -- 치킨 먹방
        '쩝쩝박사',      -- 먹방 소리
        '대왕카스테라',  -- 대왕 시리즈
        '국밥말아먹어',  -- 국밥
        '쯔양제자',      -- 쯔양 팬
        '먹방견습생',    -- 먹방 입문
        '위장무한대',    -- 위장 크기
        '풀코스다먹어',  -- 코스요리
        '5인분혼밥러',   -- 혼밥
        '배터지기직전',  -- 배부름
        '밥도둑잡아라',  -- 밥도둑 반찬
        '냠냠폭격기',    -- 폭풍흡입
        '칼로리는숫자',  -- 다이어트 무시
        '야식은기본',    -- 야식
        '다이어트내일부터' -- 내일부터 다이어트
    ];
    random_prefix TEXT;
    random_suffix TEXT;
    generated_nickname TEXT;
BEGIN
    -- 랜덤 prefix 선택
    random_prefix := prefixes[1 + floor(random() * array_length(prefixes, 1))::int];
    
    -- 랜덤 4자리 숫자
    random_suffix := lpad((floor(random() * 10000))::text, 4, '0');
    
    -- 닉네임 생성
    generated_nickname := random_prefix || '_' || random_suffix;
    
    -- 프로필 생성 (메타데이터에 닉네임이 있으면 사용, 없으면 랜덤 생성)
    INSERT INTO public.profiles (user_id, nickname, email)
    VALUES (
        NEW.id,
        COALESCE(NEW.raw_user_meta_data->>'nickname', generated_nickname),
        NEW.email
    );

    -- 일반 사용자 역할 부여
    INSERT INTO public.user_roles (user_id, role)
    VALUES (NEW.id, 'user');

    -- 사용자 통계 초기화
    INSERT INTO public.user_stats (user_id)
    VALUES (NEW.id);

    RETURN NEW;
EXCEPTION
    WHEN OTHERS THEN
        -- 에러 로깅
        RAISE WARNING 'Error in handle_new_user: %', SQLERRM;
        RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.handle_new_user IS '신규 사용자 가입 시 쯔양 테마 랜덤 닉네임으로 프로필, 역할, 통계 자동 생성';

-- 트리거 재생성 (기존 것이 DROP CASCADE로 삭제되었으므로)
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
