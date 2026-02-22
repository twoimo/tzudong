BEGIN;

DO $$
DECLARE
    v_admin_id uuid := '2367ad13-faeb-4634-8c88-1f026ef22109'::uuid;
    v_user_id uuid := '20192f6b-6f3a-42ef-a92d-49652a9137d6'::uuid;
    v_submission_id uuid;
    v_item_id uuid;
    v_trace_link text := format('https://www.youtube.com/watch?v=smoketest-%s', to_char(clock_timestamp(),'YYYYMMDDHH24MISSMS'));
    v_result record;
BEGIN
    RAISE NOTICE 'Running admin-context approval smoke test with link %', v_trace_link;

    PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
    PERFORM set_config('request.jwt.claim.sub', v_admin_id::text, true);

    INSERT INTO public.restaurant_submissions (
        user_id,
        submission_type,
        restaurant_name,
        restaurant_phone,
        restaurant_address,
        restaurant_categories
    ) VALUES (
        v_admin_id,
        'new',
        'SMOKE 테스트 식당',
        '010-1111-2222',
        '서울특별시 강남구 강남대로 1',
        ARRAY['한식']::text[]
    ) RETURNING id INTO v_submission_id;

    INSERT INTO public.restaurant_submission_items (
        submission_id,
        youtube_link,
        tzuyang_review
    ) VALUES (
        v_submission_id,
        v_trace_link,
        'smoke review text'
    ) RETURNING id INTO v_item_id;

    SELECT * INTO v_result
    FROM public.approve_submission_item(
        v_item_id,
        v_admin_id,
        jsonb_build_object(
            'name', '테스트 음식점',
            'phone', '02-1234-5678',
            'tzuyang_review', 'smoke test review for approval rpc',
            'youtube_link', v_trace_link,
            'jibun_address', '서울특별시 강남구 테헤란로 1',
            'road_address', '서울특별시 강남구 테헤란로 1',
            'english_address', 'Teheran-ro 1',
            'lat', 37.498,
            'lng', 127.028,
            'categories', to_jsonb(ARRAY['한식']::text[]),
            'address_elements', '{"admin":"smoke"}'::jsonb
        )
    );

    RAISE NOTICE 'admin flow => success=% msg=% restaurant_id=%', v_result.success, v_result.message, v_result.created_restaurant_id;

    IF NOT v_result.success THEN
        RAISE EXCEPTION 'admin approval smoke test failed: %', v_result.message;
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM public.restaurants
        WHERE id = v_result.created_restaurant_id
          AND trace_id IS NOT NULL
          AND approved_name = '테스트 음식점'
    ) THEN
        RAISE EXCEPTION 'approval succeeded but restaurant record not found/invalid';
    END IF;

    RAISE NOTICE 'restaurant row created: %', (SELECT approved_name FROM public.restaurants WHERE id = v_result.created_restaurant_id);

    PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
    PERFORM set_config('request.jwt.claim.sub', v_user_id::text, true);

    SELECT * INTO v_result
    FROM public.approve_submission_item(
        v_item_id,
        v_admin_id,
        jsonb_build_object(
            'name', '스푸핑 시도 음식점',
            'jibun_address', '서울특별시 마포구 테스트로 2',
            'lat', 37.499,
            'lng', 127.029,
            'road_address', '서울특별시 마포구 테스트로 2'
        )
    );

    RAISE NOTICE 'spoof attempt => success=% msg=%', v_result.success, v_result.message;

    IF v_result.success THEN
        RAISE EXCEPTION 'spoof attempt unexpectedly succeeded';
    END IF;

    RAISE NOTICE 'RPC security check passed';
END;
$$;

ROLLBACK;