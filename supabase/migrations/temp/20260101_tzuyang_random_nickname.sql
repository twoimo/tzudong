-- 쯔양 테마 랜덤 닉네임 생성을 위한 handle_new_user 함수 업데이트
-- 실행 방법: Supabase SQL Editor에서 실행
-- 중복 닉네임 방지를 위해 최대 10회 재시도 로직 포함

DROP FUNCTION IF EXISTS public.handle_new_user() CASCADE;

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    prefixes TEXT[] := ARRAY[
        '위장이2개', '블랙홀위장', '쯔동민턴', '냉면빨대', '짜장면통째로',
        '라면8봉', '삼겹살산맥', '치킨흡입기', '쩝쩝박사', '대왕카스테라',
        '국밥말아먹어', '쯔양제자', '먹방견습생', '위장무한대', '풀코스다먹어',
        '5인분혼밥러', '배터지기직전', '밥도둑잡아라', '냠냠폭격기', '칼로리는숫자',
        '야식은기본', '다이어트내일부터'
    ];
    random_prefix TEXT;
    random_suffix TEXT;
    generated_nickname TEXT;
    retry_count INTEGER := 0;
    max_retries CONSTANT INTEGER := 10;
    nickname_exists BOOLEAN;
BEGIN
    -- 메타데이터에 닉네임이 있으면 사용
    IF NEW.raw_user_meta_data->>'nickname' IS NOT NULL THEN
        generated_nickname := NEW.raw_user_meta_data->>'nickname';
    ELSE
        -- 중복되지 않는 닉네임 생성 (최대 10회 재시도)
        LOOP
            random_prefix := prefixes[1 + floor(random() * array_length(prefixes, 1))::int];
            random_suffix := lpad((floor(random() * 10000))::text, 4, '0');
            generated_nickname := random_prefix || '_' || random_suffix;
            
            -- 중복 체크
            SELECT EXISTS(
                SELECT 1 FROM public.profiles WHERE nickname = generated_nickname
            ) INTO nickname_exists;
            
            EXIT WHEN NOT nickname_exists OR retry_count >= max_retries;
            retry_count := retry_count + 1;
        END LOOP;
        
        -- 최대 재시도 초과 시 user_id 기반 폴백
        IF nickname_exists THEN
            generated_nickname := '쯔동이_' || substr(NEW.id::text, 1, 8);
        END IF;
    END IF;

    -- 프로필 생성
    INSERT INTO public.profiles (user_id, nickname, email)
    VALUES (NEW.id, generated_nickname, NEW.email);

    -- 일반 사용자 역할 부여
    INSERT INTO public.user_roles (user_id, role)
    VALUES (NEW.id, 'user');

    -- 사용자 통계 초기화
    INSERT INTO public.user_stats (user_id)
    VALUES (NEW.id);

    RETURN NEW;
EXCEPTION
    WHEN OTHERS THEN
        RAISE WARNING 'Error in handle_new_user: %', SQLERRM;
        RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.handle_new_user IS '신규 사용자 가입 시 쯔양 테마 랜덤 닉네임(중복 체크 포함)으로 프로필, 역할, 통계 자동 생성';

-- 트리거 재생성
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
