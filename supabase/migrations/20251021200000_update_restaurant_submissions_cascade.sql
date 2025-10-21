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

-- 설명: 이제 레스토랑을 삭제하면 해당 레스토랑을 참조하는 모든 제보도 자동으로 삭제됩니다.
