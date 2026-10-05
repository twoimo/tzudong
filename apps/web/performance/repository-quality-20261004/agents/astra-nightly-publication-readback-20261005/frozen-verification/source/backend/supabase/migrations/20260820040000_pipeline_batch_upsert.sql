-- P4: bounded restaurant upsert RPC with CAS and batched readback.
-- Invoked over a postgres DSN only. Not a Data API endpoint.
-- Follow-on: keep 20260817000100 and 20260820030000 unchanged.

CREATE OR REPLACE FUNCTION pipeline_control.batch_upsert_restaurants(p_rows jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $$
DECLARE
    v_count integer;
    v_item jsonb;
    v_payload jsonb;
    v_expected jsonb;
    v_op text;
    v_id uuid;
    v_inserted integer := 0;
    v_updated integer := 0;
    v_ids uuid[] := ARRAY[]::uuid[];
    v_insert_cols text;
    v_insert_select text;
    v_set text;
    v_expected_id uuid;
    v_expected_trace text;
    v_expected_updated timestamptz;
    v_readback jsonb;
BEGIN
    IF p_rows IS NULL OR jsonb_typeof(p_rows) <> 'array' THEN
        RAISE EXCEPTION 'batch_upsert_invalid' USING ERRCODE = '22023';
    END IF;

    v_count := jsonb_array_length(p_rows);
    IF v_count > 200 THEN
        RAISE EXCEPTION 'batch_upsert_limit' USING ERRCODE = '22023';
    END IF;

    IF v_count = 0 THEN
        RETURN jsonb_build_object(
            'inserted_count', 0,
            'updated_count', 0,
            'readback', '[]'::jsonb
        );
    END IF;

    FOR v_item IN SELECT value FROM jsonb_array_elements(p_rows) AS t(value)
    LOOP
        IF jsonb_typeof(v_item) <> 'object' THEN
            RAISE EXCEPTION 'batch_upsert_invalid' USING ERRCODE = '22023';
        END IF;

        v_op := v_item->>'op';
        v_payload := v_item->'payload';
        v_expected := v_item->'expected';

        IF v_payload IS NULL OR jsonb_typeof(v_payload) <> 'object' THEN
            RAISE EXCEPTION 'batch_upsert_invalid' USING ERRCODE = '22023';
        END IF;

        IF v_op = 'insert' THEN
            SELECT
                string_agg(format('%I', attribute.attname), ',' ORDER BY attribute.attnum),
                string_agg(format('populated.%I', attribute.attname), ',' ORDER BY attribute.attnum)
            INTO v_insert_cols, v_insert_select
            FROM pg_catalog.pg_attribute AS attribute
            WHERE attribute.attrelid = 'public.restaurants'::regclass
              AND attribute.attnum > 0
              AND NOT attribute.attisdropped
              AND attribute.attname IN (SELECT jsonb_object_keys(v_payload))
              AND attribute.attname <> 'id';

            IF v_insert_cols IS NULL THEN
                RAISE EXCEPTION 'conditional_write_failed' USING ERRCODE = '40001';
            END IF;

            EXECUTE format(
                'INSERT INTO public.restaurants (%s) SELECT %s FROM jsonb_populate_record(null::public.restaurants, $1) AS populated RETURNING id',
                v_insert_cols,
                v_insert_select
            ) INTO STRICT v_id USING v_payload;

            v_inserted := v_inserted + 1;
            v_ids := array_append(v_ids, v_id);

        ELSIF v_op = 'update' THEN
            IF v_expected IS NULL OR jsonb_typeof(v_expected) <> 'object' THEN
                RAISE EXCEPTION 'conditional_write_failed' USING ERRCODE = '40001';
            END IF;

            BEGIN
                v_expected_id := (v_expected->>'id')::uuid;
                v_expected_updated := (v_expected->>'updated_at')::timestamptz;
            EXCEPTION WHEN OTHERS THEN
                RAISE EXCEPTION 'conditional_write_failed' USING ERRCODE = '40001';
            END;

            IF v_expected_id IS NULL OR v_expected->>'trace_id' IS NULL THEN
                RAISE EXCEPTION 'conditional_write_failed' USING ERRCODE = '40001';
            END IF;

            v_expected_trace := v_expected->>'trace_id';

            SELECT string_agg(
                format('%I = populated.%I', attribute.attname, attribute.attname),
                ',' ORDER BY attribute.attnum
            )
            INTO v_set
            FROM pg_catalog.pg_attribute AS attribute
            WHERE attribute.attrelid = 'public.restaurants'::regclass
              AND attribute.attnum > 0
              AND NOT attribute.attisdropped
              AND attribute.attname IN (SELECT jsonb_object_keys(v_payload))
              AND attribute.attname NOT IN ('id', 'updated_at');

            IF v_set IS NULL THEN
                RAISE EXCEPTION 'conditional_write_failed' USING ERRCODE = '40001';
            END IF;

            EXECUTE format(
                'UPDATE public.restaurants AS target SET %s, updated_at = now() '
                'FROM jsonb_populate_record(null::public.restaurants, $1) AS populated '
                'WHERE target.id = $2 '
                'AND target.trace_id IS NOT DISTINCT FROM $3 '
                'AND target.updated_at IS NOT DISTINCT FROM $4 '
                'RETURNING target.id',
                v_set
            ) INTO v_id USING v_payload, v_expected_id, v_expected_trace, v_expected_updated;

            IF v_id IS NULL THEN
                RAISE EXCEPTION 'compare_and_set_conflict' USING ERRCODE = '40001';
            END IF;

            v_updated := v_updated + 1;
            v_ids := array_append(v_ids, v_id);
        ELSE
            RAISE EXCEPTION 'batch_upsert_invalid' USING ERRCODE = '22023';
        END IF;
    END LOOP;

    SELECT COALESCE(jsonb_agg(to_jsonb(restaurant) ORDER BY ordinality.ord), '[]'::jsonb)
    INTO v_readback
    FROM unnest(v_ids) WITH ORDINALITY AS ordinality(id, ord)
    JOIN public.restaurants AS restaurant ON restaurant.id = ordinality.id;

    RETURN jsonb_build_object(
        'inserted_count', v_inserted,
        'updated_count', v_updated,
        'readback', v_readback
    );
END;
$$;

ALTER FUNCTION pipeline_control.batch_upsert_restaurants(jsonb) OWNER TO postgres;

REVOKE ALL ON FUNCTION pipeline_control.batch_upsert_restaurants(jsonb)
    FROM PUBLIC, anon, authenticated, service_role;

ALTER DEFAULT PRIVILEGES IN SCHEMA pipeline_control
    REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC, anon, authenticated, service_role;

-- Index helpers are not public RPCs. Step 13 writes through the postgres RPC
-- (SECURITY DEFINER as postgres), so service_role EXECUTE is not required.
REVOKE ALL ON FUNCTION public.extract_youtube_video_id(text)
    FROM service_role;
REVOKE ALL ON FUNCTION public.resolve_restaurant_identity_name(text, text, text, text)
    FROM service_role;
REVOKE ALL ON FUNCTION public.normalize_restaurant_identity_name(text)
    FROM service_role;

SELECT privacy_retention.assert_g014_public_rpc_allowlist();
