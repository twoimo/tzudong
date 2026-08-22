-- Follow-on transactional outbox. Do not edit prior pipeline_control migrations.
-- Publisher drains unpublished rows to Kafka. Data API EXECUTE stays revoked.

CREATE TABLE IF NOT EXISTS pipeline_control.outbox (
    id bigserial PRIMARY KEY,
    event_id text NOT NULL UNIQUE,
    job_id uuid,
    event_type text NOT NULL
        CHECK (event_type IN ('run.lifecycle', 'step.progress', 'record.upserted')),
    topic text NOT NULL,
    payload jsonb NOT NULL,
    document_id text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    published_at timestamptz,
    claimed_at timestamptz,
    claim_token uuid,
    attempts integer NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS pipeline_control_outbox_unpublished_idx
    ON pipeline_control.outbox (id)
    WHERE published_at IS NULL;

CREATE OR REPLACE FUNCTION pipeline_control.enqueue_outbox(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pipeline_control, public
AS $$
DECLARE
    v_type text;
    v_topic text;
    v_event_id text;
    v_document_id text;
    v_job uuid;
    v_row pipeline_control.outbox%ROWTYPE;
BEGIN
    IF p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object' THEN
        RAISE EXCEPTION 'outbox_payload_invalid' USING ERRCODE = '22023';
    END IF;

    v_type := p_payload->>'type';
    IF v_type IS NULL OR v_type NOT IN ('run.lifecycle', 'step.progress', 'record.upserted') THEN
        RAISE EXCEPTION 'outbox_event_type_unknown' USING ERRCODE = '22023';
    END IF;

    v_event_id := NULLIF(p_payload->>'event_id', '');
    v_document_id := NULLIF(p_payload->>'document_id', '');
    v_topic := NULLIF(p_payload->>'topic', '');
    IF v_event_id IS NULL OR v_document_id IS NULL OR v_topic IS NULL THEN
        RAISE EXCEPTION 'outbox_payload_invalid' USING ERRCODE = '22023';
    END IF;

    BEGIN
        v_job := NULLIF(p_payload->>'job_id', '')::uuid;
    EXCEPTION
        WHEN invalid_text_representation THEN
            v_job := NULL;
    END;

    INSERT INTO pipeline_control.outbox (
        event_id, job_id, event_type, topic, payload, document_id
    ) VALUES (
        v_event_id,
        v_job,
        v_type,
        v_topic,
        COALESCE(p_payload->'payload', p_payload),
        v_document_id
    )
    ON CONFLICT (event_id) DO NOTHING
    RETURNING * INTO v_row;

    IF NOT FOUND THEN
        SELECT * INTO v_row
        FROM pipeline_control.outbox
        WHERE event_id = v_event_id;
        RETURN jsonb_build_object(
            'id', v_row.id,
            'event_id', v_row.event_id,
            'document_id', v_row.document_id,
            'topic', v_row.topic,
            'created', false
        );
    END IF;

    RETURN jsonb_build_object(
        'id', v_row.id,
        'event_id', v_row.event_id,
        'document_id', v_row.document_id,
        'topic', v_row.topic,
        'created', true
    );
END;
$$;

CREATE OR REPLACE FUNCTION pipeline_control.claim_outbox(p_limit integer, p_claim_token uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pipeline_control, public
AS $$
DECLARE
    v_limit integer := COALESCE(p_limit, 50);
    v_rows jsonb;
BEGIN
    IF p_claim_token IS NULL THEN
        RAISE EXCEPTION 'outbox_claim_token_required' USING ERRCODE = '22023';
    END IF;
    IF v_limit < 1 THEN
        RAISE EXCEPTION 'outbox_claim_limit' USING ERRCODE = '22023';
    END IF;
    IF v_limit > 50 THEN
        v_limit := 50;
    END IF;

    WITH picked AS (
        SELECT id
        FROM pipeline_control.outbox
        WHERE published_at IS NULL
          AND (claimed_at IS NULL OR claimed_at < now() - interval '30 seconds')
        ORDER BY id
        FOR UPDATE SKIP LOCKED
        LIMIT v_limit
    )
    UPDATE pipeline_control.outbox AS target
    SET
        claimed_at = now(),
        claim_token = p_claim_token,
        attempts = target.attempts + 1
    FROM picked
    WHERE target.id = picked.id;

    SELECT COALESCE(jsonb_agg(row_payload ORDER BY (row_payload->>'id')::bigint), '[]'::jsonb)
    INTO v_rows
    FROM (
        SELECT jsonb_build_object(
            'id', target.id,
            'event_id', target.event_id,
            'job_id', target.job_id,
            'event_type', target.event_type,
            'topic', target.topic,
            'payload', target.payload,
            'document_id', target.document_id,
            'created_at', target.created_at,
            'attempts', target.attempts
        ) AS row_payload
        FROM pipeline_control.outbox AS target
        WHERE target.claim_token = p_claim_token
          AND target.published_at IS NULL
        ORDER BY target.id
    ) claimed;

    RETURN COALESCE(v_rows, '[]'::jsonb);
END;
$$;

CREATE OR REPLACE FUNCTION pipeline_control.ack_outbox(p_ids bigint[], p_claim_token uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pipeline_control, public
AS $$
DECLARE
    v_count integer := 0;
BEGIN
    IF p_claim_token IS NULL THEN
        RAISE EXCEPTION 'outbox_claim_token_required' USING ERRCODE = '22023';
    END IF;

    UPDATE pipeline_control.outbox
    SET published_at = now()
    WHERE id = ANY (COALESCE(p_ids, ARRAY[]::bigint[]))
      AND claim_token = p_claim_token
      AND published_at IS NULL;

    GET DIAGNOSTICS v_count = ROW_COUNT;
    RETURN jsonb_build_object('acked', v_count);
END;
$$;

ALTER TABLE pipeline_control.outbox OWNER TO postgres;
ALTER FUNCTION pipeline_control.enqueue_outbox(jsonb) OWNER TO postgres;
ALTER FUNCTION pipeline_control.claim_outbox(integer, uuid) OWNER TO postgres;
ALTER FUNCTION pipeline_control.ack_outbox(bigint[], uuid) OWNER TO postgres;

REVOKE ALL ON TABLE pipeline_control.outbox
    FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON SEQUENCE pipeline_control.outbox_id_seq
    FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION pipeline_control.enqueue_outbox(jsonb)
    FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION pipeline_control.claim_outbox(integer, uuid)
    FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION pipeline_control.ack_outbox(bigint[], uuid)
    FROM PUBLIC, anon, authenticated, service_role;

ALTER DEFAULT PRIVILEGES IN SCHEMA pipeline_control
    REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC, anon, authenticated, service_role;

SELECT privacy_retention.assert_g014_public_rpc_allowlist();
