BEGIN;

DO $$
DECLARE
    v_admin_id uuid := '2367ad13-faeb-4634-8c88-1f026ef22109'::uuid;
    v_user_id uuid := '20192f6b-6f3a-42ef-a92d-49652a9137d6'::uuid;
    v_submission_id uuid;
    v_item_id uuid;
    v_target_restaurant_id uuid;
    v_result record;
BEGIN
    RAISE NOTICE 'Running edit approval smoke test';

    PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
    PERFORM set_config('request.jwt.claim.sub', v_admin_id::text, true);

    -- 1) create a baseline restaurant to modify
    INSERT INTO public.restaurants (
        approved_name,
        phone,
        categories,
        lat,
        lng,
        road_address,
        jibun_address,
        english_address,
        address_elements,
        origin_address,
        youtube_meta,
        trace_id,
        reasoning_basis,
        evaluation_results,
        source_type,
        geocoding_success,
        status,
        is_missing,
        is_not_selected,
        review_count,
        created_by,
        tzuyang_review,
        youtube_link
    )
    VALUES (
        'edit-target-smoke',
        '02-7777-1111',
        ARRAY['한식']::text[],
        37.49,
        127.03,
        '서울특별시 강남구 역삼로 7',
        '서울특별시 강남구 역삼로 7',
        'Yeoksam-ro 7',
        '{}'::jsonb,
        '{}'::jsonb,
        '{}'::jsonb,
        'trace-smoke-edit',
        NULL,
        NULL,
        'user_submission_new',
        true,
        'approved',
        false,
        false,
        0,
        v_admin_id,
        'seed review',
        'https://www.youtube.com/watch?v=smoke-edit-seed'
    )
    RETURNING id INTO v_target_restaurant_id;

    -- Keep backup in sync so FK checks in test don't fail on target_restaurant_id
    INSERT INTO public.restaurants_backup (
        id,
        name,
        phone,
        categories,
        lat,
        lng,
        road_address,
        jibun_address,
        english_address,
        address_elements,
        origin_address,
        youtube_meta,
        unique_id,
        reasoning_basis,
        evaluation_results,
        source_type,
        geocoding_success,
        geocoding_false_stage,
        status,
        is_missing,
        is_not_selected,
        review_count,
        created_by,
        updated_by_admin_id,
        tzuyang_review,
        youtube_link
    )
    SELECT
        v_target_restaurant_id,
        r.approved_name,
        r.phone,
        r.categories,
        r.lat,
        r.lng,
        r.road_address,
        r.jibun_address,
        r.english_address,
        r.address_elements,
        r.origin_address,
        r.youtube_meta,
        r.trace_id,
        r.reasoning_basis,
        r.evaluation_results,
        r.source_type,
        r.geocoding_success,
        NULL,
        r.status,
        r.is_missing,
        r.is_not_selected,
        r.review_count,
        r.created_by,
        v_admin_id,
        r.tzuyang_review,
        r.youtube_link
    FROM public.restaurants r
    WHERE r.id = v_target_restaurant_id
    ON CONFLICT (id) DO UPDATE SET
        name = EXCLUDED.name,
        phone = EXCLUDED.phone,
        categories = EXCLUDED.categories,
        lat = EXCLUDED.lat,
        lng = EXCLUDED.lng,
        road_address = EXCLUDED.road_address,
        jibun_address = EXCLUDED.jibun_address,
        english_address = EXCLUDED.english_address,
        address_elements = EXCLUDED.address_elements,
        origin_address = EXCLUDED.origin_address,
        youtube_meta = EXCLUDED.youtube_meta,
        unique_id = EXCLUDED.unique_id,
        reasoning_basis = EXCLUDED.reasoning_basis,
        evaluation_results = EXCLUDED.evaluation_results,
        source_type = EXCLUDED.source_type,
        geocoding_success = EXCLUDED.geocoding_success,
        geocoding_false_stage = EXCLUDED.geocoding_false_stage,
        status = EXCLUDED.status,
        is_missing = EXCLUDED.is_missing,
        is_not_selected = EXCLUDED.is_not_selected,
        review_count = EXCLUDED.review_count,
        created_by = EXCLUDED.created_by,
        updated_by_admin_id = EXCLUDED.updated_by_admin_id,
        tzuyang_review = EXCLUDED.tzuyang_review,
        youtube_link = EXCLUDED.youtube_link,
        updated_at = NOW();

    -- 2) create edit submission + pending item
    INSERT INTO public.restaurant_submissions (
        user_id,
        submission_type,
        restaurant_name,
        restaurant_phone,
        restaurant_address,
        restaurant_categories,
        status
    ) VALUES (
        v_admin_id,
        'edit'::public.submission_type,
        'edit-target-smoke',
        '02-7777-1111',
        '서울특별시 강남구 역삼로 7',
        ARRAY['한식']::text[],
        'pending'::public.submission_status
    ) RETURNING id INTO v_submission_id;

    INSERT INTO public.restaurant_submission_items (
        submission_id,
        target_restaurant_id,
        youtube_link,
        tzuyang_review
    ) VALUES (
        v_submission_id,
        v_target_restaurant_id,
        'https://www.youtube.com/watch?v=smoke-edit-seed',
        'seed review for edit target'
    ) RETURNING id INTO v_item_id;

    -- 3) approve edit
    SELECT * INTO v_result
    FROM public.approve_edit_submission_item(
        v_item_id,
        v_admin_id,
        jsonb_build_object(
            'name', 'edit-target-smoke-updated',
            'phone', '02-8888-2222',
            'tzuyang_review', 'smoke edit review updated',
            'youtube_link', 'https://www.youtube.com/watch?v=smoke-edit-updated',
            'jibun_address', '서울특별시 강남구 역삼로 8',
            'road_address', '서울특별시 강남구 역삼로 8',
            'english_address', 'Yeoksam-ro 8',
            'lat', 37.491,
            'lng', 127.031,
            'categories', to_jsonb(ARRAY['한식','카페']::text[]),
            'address_elements', '{"admin":"smoke-edit"}'::jsonb
        )
    );

    RAISE NOTICE 'edit flow => success=% msg=% restaurant_id=%', v_result.success, v_result.message, v_result.restaurant_id;

    IF NOT v_result.success THEN
        RAISE EXCEPTION 'edit approval smoke test failed: %', v_result.message;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM public.restaurants WHERE id = v_target_restaurant_id AND approved_name = 'edit-target-smoke-updated'
    ) THEN
        RAISE EXCEPTION 'restaurant row not updated in restaurants table';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM public.restaurants_backup rb WHERE rb.id = v_target_restaurant_id AND rb.geocoding_success = true AND rb.geocoding_false_stage IS NULL
    ) THEN
        RAISE EXCEPTION 'restaurant row not synced correctly in restaurants_backup';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM public.restaurant_submission_items WHERE id = v_item_id AND item_status = 'approved'
    ) THEN
        RAISE EXCEPTION 'submission item not marked approved';
    END IF;

    RAISE NOTICE 'edit update + backup sync passed';

    -- 4) spoof attempt should fail
    PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
    PERFORM set_config('request.jwt.claim.sub', v_user_id::text, true);

    SELECT * INTO v_result
    FROM public.approve_edit_submission_item(
        v_item_id,
        v_admin_id,
        jsonb_build_object(
            'name', 'spoofed',
            'jibun_address', '서울특별시 강남구 스푸핑로 9',
            'road_address', '서울특별시 강남구 스푸핑로 9',
            'lat', 37.492,
            'lng', 127.033
        )
    );

    RAISE NOTICE 'spoof edit attempt => success=% msg=%', v_result.success, v_result.message;

    IF v_result.success THEN
        RAISE EXCEPTION 'spoof edit attempt unexpectedly succeeded';
    END IF;
END;
$$;

ROLLBACK;
