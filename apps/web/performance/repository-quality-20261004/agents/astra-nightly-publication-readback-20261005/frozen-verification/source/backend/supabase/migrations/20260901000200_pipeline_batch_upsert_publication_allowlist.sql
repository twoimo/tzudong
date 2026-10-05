-- P2 follow-on (tasks.md #16): a publication-only RPC with a server-side
-- Publication_Set column allowlist.
--
-- Rationale: the applied pipeline_control.batch_upsert_restaurants RPC is owned
-- by the crawler/evaluation writer and accepts fields that are intentionally not
-- in the Publication_Set. Replacing that function would break its existing
-- contract. Publication therefore gets a distinct, narrower RPC whose dynamic
-- columns are restricted to the Publication_Set.
--
-- Applied migrations are immutable: 20260820040000_pipeline_batch_upsert.sql and
-- its batch_upsert_restaurants function are NOT modified or replaced. This new
-- publish_upsert_restaurants function preserves the required CAS/readback
-- semantics, owner, REVOKE grants, postgres-DSN-only boundary (not a Data API
-- endpoint), and the public RPC allowlist assertion.
--
-- Allowlist source: backend/deploy/publication-set.v1.json -> public.restaurants
--   publishedColumns (29) plus the identity/CAS keys the insert/update logic
--   already relies on (id, trace_id, updated_at). trace_id is already one of the
--   29 published columns; id and updated_at are added as identity/CAS keys.
-- A payload key outside this allowlist is treated as invalid input and rejected
-- fail-closed with the bounded 'batch_upsert_invalid' code (ERRCODE 22023,
-- consistent with the existing malformed-input pattern); no row is written.
--
-- The existing evaluation writer continues to call batch_upsert_restaurants;
-- only an explicitly authorized publication adapter may call this function.
-- This source tree makes no claim that this migration has been applied or
-- deployed.

CREATE FUNCTION pipeline_control.publish_upsert_restaurants(p_rows jsonb)
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
    v_bad_key text;
    -- Publication_Set allowlist for public.restaurants (design.md C6 / D5,
    -- backend/deploy/publication-set.v1.json). No column outside this set may be
    -- written server-side. Any other payload key is rejected fail-closed.
    v_allowed_columns constant text[] := ARRAY[
        -- publishedColumns (29)
        'approved_name', 'origin_name', 'naver_name', 'google_name',
        'trace_id_name_source', 'trace_id', 'phone', 'categories', 'status',
        'source_type', 'channel_name', 'youtube_link', 'youtube_meta',
        'description_map_url', 'evaluation_results', 'reasoning_basis',
        'tzuyang_review', 'origin_address', 'road_address', 'jibun_address',
        'english_address', 'address_elements', 'lat', 'lng',
        'geocoding_success', 'geocoding_false_stage', 'is_missing',
        'is_not_selected', 'recollect_version',
        -- identity / CAS keys admissible in the payload per insert/update logic
        'id', 'updated_at'
    ];
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

        -- Server-side Publication_Set column allowlist. A non-admitted column
        -- can never be written: reject the whole batch fail-closed and apply no
        -- row. Diagnostics are not exposed; only the bounded code is raised.
        SELECT payload_key
        INTO v_bad_key
        FROM jsonb_object_keys(v_payload) AS payload_keys(payload_key)
        WHERE NOT (payload_key = ANY (v_allowed_columns))
        LIMIT 1;

        IF v_bad_key IS NOT NULL THEN
            RAISE EXCEPTION 'batch_upsert_invalid' USING ERRCODE = '22023';
        END IF;

        IF v_op = 'insert' THEN
            IF v_payload->>'id' IS NULL THEN
                RAISE EXCEPTION 'batch_upsert_invalid' USING ERRCODE = '22023';
            END IF;

            SELECT
                string_agg(format('%I', attribute.attname), ',' ORDER BY attribute.attnum),
                string_agg(format('populated.%I', attribute.attname), ',' ORDER BY attribute.attnum)
            INTO v_insert_cols, v_insert_select
            FROM pg_catalog.pg_attribute AS attribute
            WHERE attribute.attrelid = 'public.restaurants'::regclass
              AND attribute.attnum > 0
              AND NOT attribute.attisdropped
              AND attribute.attname IN (SELECT jsonb_object_keys(v_payload))
              AND attribute.attname = ANY (v_allowed_columns);

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
              AND attribute.attname = ANY (v_allowed_columns)
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

-- public.videos uses a text identity and requires youtube_link/channel_name on
-- insert. Those two required service-data fields are explicitly included in
-- the Publication_Set; row-owned timestamps and all other metadata stay out.
CREATE FUNCTION pipeline_control.publish_upsert_videos(p_rows jsonb)
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
    v_id text;
    v_inserted integer := 0;
    v_updated integer := 0;
    v_ids text[] := ARRAY[]::text[];
    v_insert_cols text;
    v_insert_select text;
    v_set text;
    v_expected_id text;
    v_expected_updated timestamptz;
    v_readback jsonb;
    v_bad_key text;
    v_allowed_columns constant text[] := ARRAY[
        'id', 'youtube_link', 'channel_name', 'title', 'published_at',
        'duration', 'category', 'meta_history', 'view_count', 'like_count',
        'comment_count'
    ];
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

        SELECT payload_key
        INTO v_bad_key
        FROM jsonb_object_keys(v_payload) AS payload_keys(payload_key)
        WHERE NOT (payload_key = ANY (v_allowed_columns))
        LIMIT 1;

        IF v_bad_key IS NOT NULL THEN
            RAISE EXCEPTION 'batch_upsert_invalid' USING ERRCODE = '22023';
        END IF;

        IF v_op = 'insert' THEN
            IF v_payload->>'id' IS NULL
               OR v_payload->>'youtube_link' IS NULL
               OR v_payload->>'channel_name' IS NULL THEN
                RAISE EXCEPTION 'batch_upsert_invalid' USING ERRCODE = '22023';
            END IF;

            SELECT
                string_agg(format('%I', attribute.attname), ',' ORDER BY attribute.attnum),
                string_agg(format('populated.%I', attribute.attname), ',' ORDER BY attribute.attnum)
            INTO v_insert_cols, v_insert_select
            FROM pg_catalog.pg_attribute AS attribute
            WHERE attribute.attrelid = 'public.videos'::regclass
              AND attribute.attnum > 0
              AND NOT attribute.attisdropped
              AND attribute.attname IN (SELECT jsonb_object_keys(v_payload))
              AND attribute.attname = ANY (v_allowed_columns);

            IF v_insert_cols IS NULL THEN
                RAISE EXCEPTION 'conditional_write_failed' USING ERRCODE = '40001';
            END IF;

            EXECUTE format(
                'INSERT INTO public.videos (%s) SELECT %s FROM jsonb_populate_record(null::public.videos, $1) AS populated RETURNING id',
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
                v_expected_id := v_expected->>'id';
                v_expected_updated := (v_expected->>'updated_at')::timestamptz;
            EXCEPTION WHEN OTHERS THEN
                RAISE EXCEPTION 'conditional_write_failed' USING ERRCODE = '40001';
            END;

            IF v_expected_id IS NULL OR v_expected_updated IS NULL THEN
                RAISE EXCEPTION 'conditional_write_failed' USING ERRCODE = '40001';
            END IF;

            SELECT string_agg(
                format('%I = populated.%I', attribute.attname, attribute.attname),
                ',' ORDER BY attribute.attnum
            )
            INTO v_set
            FROM pg_catalog.pg_attribute AS attribute
            WHERE attribute.attrelid = 'public.videos'::regclass
              AND attribute.attnum > 0
              AND NOT attribute.attisdropped
              AND attribute.attname IN (SELECT jsonb_object_keys(v_payload))
              AND attribute.attname = ANY (v_allowed_columns)
              AND attribute.attname <> 'id';

            IF v_set IS NULL THEN
                RAISE EXCEPTION 'conditional_write_failed' USING ERRCODE = '40001';
            END IF;

            EXECUTE format(
                'UPDATE public.videos AS target SET %s, updated_at = now() '
                'FROM jsonb_populate_record(null::public.videos, $1) AS populated '
                'WHERE target.id = $2 '
                'AND target.updated_at IS NOT DISTINCT FROM $3 '
                'RETURNING target.id',
                v_set
            ) INTO v_id USING v_payload, v_expected_id, v_expected_updated;

            IF v_id IS NULL THEN
                RAISE EXCEPTION 'compare_and_set_conflict' USING ERRCODE = '40001';
            END IF;

            v_updated := v_updated + 1;
            v_ids := array_append(v_ids, v_id);
        ELSE
            RAISE EXCEPTION 'batch_upsert_invalid' USING ERRCODE = '22023';
        END IF;
    END LOOP;

    SELECT COALESCE(jsonb_agg(to_jsonb(video) ORDER BY ordinality.ord), '[]'::jsonb)
    INTO v_readback
    FROM unnest(v_ids) WITH ORDINALITY AS ordinality(id, ord)
    JOIN public.videos AS video ON video.id = ordinality.id;

    RETURN jsonb_build_object(
        'inserted_count', v_inserted,
        'updated_count', v_updated,
        'readback', v_readback
    );
END;
$$;

ALTER FUNCTION pipeline_control.publish_upsert_restaurants(jsonb) OWNER TO postgres;

ALTER FUNCTION pipeline_control.publish_upsert_videos(jsonb) OWNER TO postgres;

REVOKE ALL ON FUNCTION pipeline_control.publish_upsert_restaurants(jsonb)
    FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON FUNCTION pipeline_control.publish_upsert_videos(jsonb)
    FROM PUBLIC, anon, authenticated, service_role;

ALTER DEFAULT PRIVILEGES IN SCHEMA pipeline_control
    REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC, anon, authenticated, service_role;

SELECT privacy_retention.assert_g014_public_rpc_allowlist();
