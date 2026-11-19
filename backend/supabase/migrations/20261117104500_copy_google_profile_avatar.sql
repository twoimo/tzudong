-- The avatar copy function existed, but no trigger called it. Google account
-- photos stayed in auth metadata while public profiles kept a null avatar, so
-- review cards and profile pages rendered the fallback mark.
-- Copy only a canonical Google avatar, and never replace a photo the user set.

CREATE OR REPLACE FUNCTION public.handle_new_user_avatar()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_avatar text;
BEGIN
  v_avatar := NULLIF(btrim(NEW.raw_user_meta_data->>'avatar_url'), '');
  IF v_avatar IS NULL
     OR v_avatar !~ '^https://lh3\.googleusercontent\.com/a/[A-Za-z0-9._=-]+$'
     OR v_avatar ~* '\.svg' THEN
    v_avatar := NULLIF(btrim(NEW.raw_user_meta_data->>'picture'), '');
  END IF;

  IF v_avatar IS NULL
     OR octet_length(v_avatar) > 4096
     OR v_avatar !~ '^https://lh3\.googleusercontent\.com/a/[A-Za-z0-9._=-]+$'
     OR v_avatar ~* '\.svg' THEN
    RETURN NEW;
  END IF;

  UPDATE public.profiles
     SET avatar_url = v_avatar
   WHERE user_id = NEW.id
     AND avatar_url IS NULL
     AND nickname IS DISTINCT FROM '탈퇴한 사용자';

  RETURN NEW;
END;
$$;

ALTER FUNCTION public.handle_new_user_avatar() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.handle_new_user_avatar()
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;

DROP TRIGGER IF EXISTS on_auth_user_created_avatar ON auth.users;
CREATE TRIGGER on_auth_user_created_avatar
  AFTER INSERT OR UPDATE OF raw_user_meta_data ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user_avatar();

UPDATE public.profiles AS profile
   SET avatar_url = candidate.avatar
  FROM (
    SELECT
      auth_user.id AS user_id,
      CASE
        WHEN NULLIF(btrim(auth_user.raw_user_meta_data->>'avatar_url'), '')
             ~ '^https://lh3\.googleusercontent\.com/a/[A-Za-z0-9._=-]+$'
         AND NULLIF(btrim(auth_user.raw_user_meta_data->>'avatar_url'), '') !~* '\.svg'
          THEN btrim(auth_user.raw_user_meta_data->>'avatar_url')
        WHEN NULLIF(btrim(auth_user.raw_user_meta_data->>'picture'), '')
             ~ '^https://lh3\.googleusercontent\.com/a/[A-Za-z0-9._=-]+$'
         AND NULLIF(btrim(auth_user.raw_user_meta_data->>'picture'), '') !~* '\.svg'
          THEN btrim(auth_user.raw_user_meta_data->>'picture')
        ELSE NULL
      END AS avatar
    FROM auth.users AS auth_user
  ) AS candidate
 WHERE profile.user_id = candidate.user_id
   AND profile.avatar_url IS NULL
   AND profile.nickname IS DISTINCT FROM '탈퇴한 사용자'
   AND candidate.avatar IS NOT NULL
   AND octet_length(candidate.avatar) <= 4096;
