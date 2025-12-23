-- ============================================================================
-- restaurant_submissions에서 target_restaurant_id 제거
-- EDIT 제보의 target_restaurant_id는 items 레벨에서 관리
-- ============================================================================

-- ============================================================================
-- 1. 기존 데이터 마이그레이션: submissions의 target_restaurant_id를 items로 복사
-- ============================================================================

-- items에 target_restaurant_id 컬럼이 없으면 추가
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' 
        AND table_name = 'restaurant_submission_items' 
        AND column_name = 'target_restaurant_id'
    ) THEN
        ALTER TABLE public.restaurant_submission_items 
        ADD COLUMN target_restaurant_id UUID REFERENCES public.restaurants(id) ON DELETE SET NULL;
        
        COMMENT ON COLUMN public.restaurant_submission_items.target_restaurant_id 
        IS 'EDIT 타입일 때 수정 대상 레스토랑 ID (각 아이템별 매칭)';
        
        CREATE INDEX IF NOT EXISTS idx_submission_items_target_restaurant 
        ON public.restaurant_submission_items(target_restaurant_id) 
        WHERE target_restaurant_id IS NOT NULL;
    END IF;
END $$;

-- submissions의 target_restaurant_id를 items로 복사 (기존 데이터용)
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' 
        AND table_name = 'restaurant_submissions' 
        AND column_name = 'target_restaurant_id'
    ) THEN
        UPDATE public.restaurant_submission_items AS items
        SET target_restaurant_id = subs.target_restaurant_id
        FROM public.restaurant_submissions AS subs
        WHERE items.submission_id = subs.id
          AND subs.submission_type = 'edit'
          AND subs.target_restaurant_id IS NOT NULL
          AND items.target_restaurant_id IS NULL;
    END IF;
END $$;

-- ============================================================================
-- 2. restaurant_submissions에서 target_restaurant_id 관련 제약조건 제거
-- ============================================================================

-- 기존 CHECK 제약조건 제거
ALTER TABLE public.restaurant_submissions 
DROP CONSTRAINT IF EXISTS submissions_type_target_check;

-- 인덱스 제거
DROP INDEX IF EXISTS idx_submissions_target_restaurant;

-- ============================================================================
-- 3. restaurant_submissions에서 target_restaurant_id 컬럼 제거
-- ============================================================================

ALTER TABLE public.restaurant_submissions 
DROP COLUMN IF EXISTS target_restaurant_id;

-- ============================================================================
-- 4. approve_edit_submission_item 함수 업데이트
-- item.target_restaurant_id 사용하도록 변경
-- ============================================================================

-- 기존 함수 삭제 (리턴 타입 변경을 위해 필수)
DROP FUNCTION IF EXISTS public.approve_edit_submission_item(UUID, UUID, JSONB);

CREATE OR REPLACE FUNCTION public.approve_edit_submission_item(
    p_item_id UUID,
    p_admin_user_id UUID,
    p_updated_data JSONB DEFAULT '{}'::jsonb
)
RETURNS TABLE(success BOOLEAN, message TEXT, restaurant_id UUID)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_is_admin BOOLEAN;
    v_item RECORD;
    v_submission RECORD;
    v_target_restaurant_id UUID;
BEGIN
    -- 1. 관리자 권한 확인
    SELECT public.is_user_admin(p_admin_user_id) INTO v_is_admin;
    IF NOT v_is_admin THEN
        RETURN QUERY SELECT FALSE, '관리자 권한이 필요합니다.'::TEXT, NULL::UUID;
        RETURN;
    END IF;

    -- 2. 항목 조회
    SELECT * INTO v_item
    FROM public.restaurant_submission_items
    WHERE id = p_item_id AND item_status = 'pending';

    IF NOT FOUND THEN
        RETURN QUERY SELECT FALSE, '처리할 항목이 없거나 이미 처리되었습니다.'::TEXT, NULL::UUID;
        RETURN;
    END IF;

    -- 3. 부모 submission 조회
    SELECT * INTO v_submission
    FROM public.restaurant_submissions
    WHERE id = v_item.submission_id AND submission_type = 'edit';

    IF NOT FOUND THEN
        RETURN QUERY SELECT FALSE, '수정 요청 제보가 아닙니다.'::TEXT, NULL::UUID;
        RETURN;
    END IF;

    -- 4. 대상 레코드 확인 (item의 target_restaurant_id 사용)
    v_target_restaurant_id := v_item.target_restaurant_id;

    IF v_target_restaurant_id IS NULL THEN
        RETURN QUERY SELECT FALSE, '수정 대상 음식점을 찾을 수 없습니다. (item.target_restaurant_id가 없음)'::TEXT, NULL::UUID;
        RETURN;
    END IF;

    -- 5. 대상 레스토랑 존재 여부 확인
    IF NOT EXISTS (SELECT 1 FROM public.restaurants WHERE id = v_target_restaurant_id) THEN
        RETURN QUERY SELECT FALSE, '수정 대상 음식점이 존재하지 않습니다.'::TEXT, NULL::UUID;
        RETURN;
    END IF;

    -- 6. restaurants 테이블 UPDATE
    UPDATE public.restaurants
    SET
        youtube_link = COALESCE(p_updated_data->>'youtube_link', v_item.youtube_link, youtube_link),
        tzuyang_review = COALESCE(p_updated_data->>'tzuyang_review', v_item.tzuyang_review, tzuyang_review),
        name = COALESCE(p_updated_data->>'name', v_submission.restaurant_name, name),
        categories = COALESCE(
            CASE WHEN p_updated_data->'categories' IS NOT NULL 
                 THEN ARRAY(SELECT jsonb_array_elements_text(p_updated_data->'categories'))
                 ELSE NULL END,
            v_submission.restaurant_categories,
            categories
        ),
        phone = COALESCE(p_updated_data->>'phone', v_submission.restaurant_phone, phone),
        source_type = 'user_submission_edit',
        updated_by_admin_id = p_admin_user_id,
        updated_at = now()
    WHERE id = v_target_restaurant_id;

    -- 7. 항목 상태 업데이트
    UPDATE public.restaurant_submission_items
    SET 
        item_status = 'approved',
        approved_restaurant_id = v_target_restaurant_id
    WHERE id = p_item_id;

    -- 8. submission 메타 업데이트
    UPDATE public.restaurant_submissions
    SET 
        resolved_by_admin_id = p_admin_user_id,
        reviewed_at = COALESCE(reviewed_at, now())
    WHERE id = v_submission.id;

    RETURN QUERY SELECT TRUE, '수정 항목이 승인되었습니다.'::TEXT, v_target_restaurant_id;
END;
$$;

COMMENT ON FUNCTION public.approve_edit_submission_item IS '수정 요청 개별 항목 승인 - item.target_restaurant_id 기반';

-- ============================================================================
-- 5. target_unique_id 컬럼 제거 (더 이상 사용 안함)
-- ============================================================================

ALTER TABLE public.restaurant_submission_items 
DROP COLUMN IF EXISTS target_unique_id;

DROP INDEX IF EXISTS idx_submission_items_target_unique_id;

-- ============================================================================
-- 완료 메시지
-- ============================================================================
DO $$
BEGIN
    RAISE NOTICE '✅ 마이그레이션 완료:';
    RAISE NOTICE '  - restaurant_submissions.target_restaurant_id 제거됨';
    RAISE NOTICE '  - restaurant_submission_items.target_restaurant_id 유지 (아이템별 매칭)';
    RAISE NOTICE '  - restaurant_submission_items.target_unique_id 제거됨';
    RAISE NOTICE '  - approve_edit_submission_item 함수 업데이트됨';
END $$;
