-- profiles 테이블에 nickname_changed 필드 추가
ALTER TABLE public.profiles
ADD COLUMN IF NOT EXISTS nickname_changed BOOLEAN DEFAULT false;

-- 기존 사용자들에게는 nickname_changed를 false로 설정
UPDATE public.profiles
SET nickname_changed = false
WHERE nickname_changed IS NULL;
