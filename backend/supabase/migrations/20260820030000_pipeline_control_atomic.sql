-- Follow-on atomic control-plane RPCs. Do not edit 20260817020000_pipeline_control.sql.

ALTER TABLE pipeline_control.jobs
    ADD COLUMN IF NOT EXISTS pause_requested boolean NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS cancel_requested boolean NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS checkpoint jsonb NOT NULL DEFAULT '{}'::jsonb,
    ADD COLUMN IF NOT EXISTS claimed_by text,
    ADD COLUMN IF NOT EXISTS execution_mode text NOT NULL DEFAULT 'dry_run',
    ADD COLUMN IF NOT EXISTS data_sink text NOT NULL DEFAULT 'local',
    ADD COLUMN IF NOT EXISTS desired_action text NOT NULL DEFAULT 'none',
    ADD COLUMN IF NOT EXISTS claim_token uuid,
    ADD COLUMN IF NOT EXISTS attempt integer NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS next_step integer NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS worker_id text,
    ADD COLUMN IF NOT EXISTS control_version integer NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS requested_at timestamptz,
    ADD COLUMN IF NOT EXISTS approved_at timestamptz;

CREATE TABLE IF NOT EXISTS pipeline_control.job_steps (
    job_id uuid NOT NULL REFERENCES pipeline_control.jobs (id),
    step_index integer NOT NULL,
    status text NOT NULL,
    exit_code integer,
    started_at timestamptz NOT NULL DEFAULT now(),
    ended_at timestamptz,
    duration_ms integer,
    input_hash text,
    output_hash text,
    PRIMARY KEY (job_id, step_index)
);

CREATE TABLE IF NOT EXISTS pipeline_control.control_requests (
    id bigserial PRIMARY KEY,
    job_id uuid NOT NULL REFERENCES pipeline_control.jobs (id),
    action text NOT NULL,
    actor text NOT NULL,
    request_id text NOT NULL,
    desired_action text NOT NULL,
    status text NOT NULL DEFAULT 'requested',
    requested_at timestamptz NOT NULL DEFAULT now(),
    approved_at timestamptz
);

CREATE INDEX IF NOT EXISTS pipeline_control_jobs_claim_idx
    ON pipeline_control.jobs (created_at, id)
    WHERE status = 'Queued' AND pause_requested = false AND cancel_requested = false;

CREATE OR REPLACE FUNCTION pipeline_control._job_json(j pipeline_control.jobs)
RETURNS jsonb
LANGUAGE sql
STABLE
AS $$
    SELECT jsonb_build_object(
        'id', j.id,
        'target', j.target,
        'profile', j.profile,
        'status', j.status,
        'idempotency_key', j.idempotency_key,
        'payload_hash', j.payload_hash,
        'actor', j.actor,
        'request_id', j.request_id,
        'lease_until', EXTRACT(EPOCH FROM j.lease_until),
        'heartbeat_at', EXTRACT(EPOCH FROM j.heartbeat_at),
        'adapter_index', j.adapter_index,
        'dry_run', j.dry_run,
        'error_code', j.error_code,
        'pause_requested', j.pause_requested,
        'cancel_requested', j.cancel_requested,
        'claimed_by', j.claimed_by,
        'checkpoint', j.checkpoint,
        'execution_mode', j.execution_mode,
        'data_sink', j.data_sink,
        'desired_action', j.desired_action,
        'claim_token', j.claim_token,
        'attempt', j.attempt,
        'next_step', j.next_step,
        'worker_id', j.worker_id,
        'control_version', j.control_version
    );
$$;

CREATE OR REPLACE FUNCTION pipeline_control.enqueue_job(
    p_target text,
    p_profile text,
    p_idempotency_key text,
    p_payload_hash text,
    p_actor text,
    p_request_id text,
    p_dry_run boolean DEFAULT true,
    p_execution_mode text DEFAULT 'dry_run',
    p_data_sink text DEFAULT 'local'
) RETURNS TABLE (run jsonb, created boolean)
LANGUAGE plpgsql
AS $$
DECLARE
    existing pipeline_control.jobs%ROWTYPE;
    holder uuid;
    holder_status text;
    new_job pipeline_control.jobs%ROWTYPE;
    lock_name text := p_target || ':' || p_profile;
BEGIN
    SELECT * INTO existing
    FROM pipeline_control.jobs
    WHERE idempotency_key = p_idempotency_key;
    IF FOUND THEN
        IF existing.payload_hash <> p_payload_hash THEN
            RAISE EXCEPTION 'idempotency_payload_conflict' USING ERRCODE = 'P0001';
        END IF;
        run := pipeline_control._job_json(existing);
        created := false;
        RETURN NEXT;
        RETURN;
    END IF;

    SELECT l.job_id, j.status
    INTO holder, holder_status
    FROM pipeline_control.locks l
    JOIN pipeline_control.jobs j ON j.id = l.job_id
    WHERE l.lock_key = lock_name;
    IF holder IS NOT NULL AND holder_status IN ('Queued', 'Fetching', 'Inserting', 'Paused') THEN
        RAISE EXCEPTION 'lock_held' USING ERRCODE = 'P0001';
    END IF;

    INSERT INTO pipeline_control.jobs (
        target, profile, status, idempotency_key, payload_hash, actor, request_id,
        lease_until, heartbeat_at, dry_run, execution_mode, data_sink
    ) VALUES (
        p_target, p_profile, 'Queued', p_idempotency_key, p_payload_hash, p_actor, p_request_id,
        now() + interval '30 seconds', now(), p_dry_run, p_execution_mode, p_data_sink
    ) RETURNING * INTO new_job;

    INSERT INTO pipeline_control.locks (lock_key, job_id)
    VALUES (lock_name, new_job.id)
    ON CONFLICT (lock_key) DO UPDATE SET job_id = EXCLUDED.job_id, held_since = now();

    INSERT INTO pipeline_control.audit (actor, job_id, transition, request_id)
    VALUES (p_actor, new_job.id, 'enqueue', p_request_id);

    run := pipeline_control._job_json(new_job);
    created := true;
    RETURN NEXT;
END;
$$;

CREATE OR REPLACE FUNCTION pipeline_control.claim_job(
    p_worker_id text DEFAULT 'worker'
) RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
    picked uuid;
    claimed pipeline_control.jobs%ROWTYPE;
BEGIN
    SELECT j.id INTO picked
    FROM pipeline_control.jobs j
    WHERE j.status = 'Queued'
      AND j.pause_requested = false
      AND j.cancel_requested = false
    ORDER BY j.created_at ASC, j.id ASC
    FOR UPDATE SKIP LOCKED
    LIMIT 1;

    IF picked IS NULL THEN
        RETURN NULL;
    END IF;

    UPDATE pipeline_control.jobs
    SET status = 'Fetching',
        claimed_by = p_worker_id,
        worker_id = p_worker_id,
        claim_token = COALESCE(claim_token, gen_random_uuid()),
        attempt = attempt + 1,
        lease_until = now() + interval '30 seconds',
        heartbeat_at = now(),
        updated_at = now()
    WHERE id = picked
    RETURNING * INTO claimed;

    INSERT INTO pipeline_control.audit (actor, job_id, transition, request_id)
    VALUES (p_worker_id, claimed.id, 'claim', claimed.request_id);

    RETURN pipeline_control._job_json(claimed);
END;
$$;

CREATE OR REPLACE FUNCTION pipeline_control.control_job(
    p_job_id uuid,
    p_action text,
    p_actor text,
    p_request_id text
) RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
    current pipeline_control.jobs%ROWTYPE;
    lock_name text;
BEGIN
    SELECT * INTO current FROM pipeline_control.jobs WHERE id = p_job_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'run_not_found' USING ERRCODE = 'P0001';
    END IF;
    lock_name := current.target || ':' || current.profile;

    IF p_action = 'pause' THEN
        IF current.status NOT IN ('Queued', 'Fetching', 'Inserting') THEN
            RAISE EXCEPTION 'illegal_transition' USING ERRCODE = 'P0001';
        END IF;
        INSERT INTO pipeline_control.control_requests (
            job_id, action, actor, request_id, desired_action, status
        ) VALUES (current.id, 'pause', p_actor, p_request_id, 'pause', 'requested');
        IF current.status = 'Queued' THEN
            UPDATE pipeline_control.jobs SET
                pause_requested = true,
                desired_action = 'pause',
                requested_at = now(),
                approved_at = now(),
                control_version = control_version + 1,
                status = 'Paused',
                lease_until = now() + interval '30 seconds',
                heartbeat_at = now(),
                updated_at = now()
            WHERE id = current.id;
            UPDATE pipeline_control.control_requests
            SET status = 'approved', approved_at = now()
            WHERE id = (
                SELECT cr.id FROM pipeline_control.control_requests cr
                WHERE cr.job_id = current.id AND cr.action = 'pause'
                ORDER BY cr.id DESC LIMIT 1
            );
        ELSE
            UPDATE pipeline_control.jobs SET
                pause_requested = true,
                desired_action = 'pause',
                requested_at = now(),
                control_version = control_version + 1,
                lease_until = now() + interval '30 seconds',
                heartbeat_at = now(),
                updated_at = now()
            WHERE id = current.id;
        END IF;
        INSERT INTO pipeline_control.audit (actor, job_id, transition, request_id)
        VALUES (p_actor, current.id, 'pause_requested', p_request_id);
        SELECT * INTO current FROM pipeline_control.jobs WHERE id = p_job_id;
        RETURN pipeline_control._job_json(current);
    END IF;

    IF p_action = 'cancel' THEN
        IF current.status NOT IN ('Queued', 'Fetching', 'Inserting', 'Paused') THEN
            RAISE EXCEPTION 'illegal_transition' USING ERRCODE = 'P0001';
        END IF;
        INSERT INTO pipeline_control.control_requests (
            job_id, action, actor, request_id, desired_action, status
        ) VALUES (current.id, 'cancel', p_actor, p_request_id, 'cancel', 'requested');
        IF current.status IN ('Queued', 'Paused') THEN
            UPDATE pipeline_control.jobs SET
                cancel_requested = true,
                desired_action = 'cancel',
                requested_at = now(),
                approved_at = now(),
                control_version = control_version + 1,
                status = 'Cancelled',
                updated_at = now()
            WHERE id = current.id;
            DELETE FROM pipeline_control.locks WHERE lock_key = lock_name AND job_id = current.id;
            UPDATE pipeline_control.control_requests
            SET status = 'approved', approved_at = now()
            WHERE id = (
                SELECT cr.id FROM pipeline_control.control_requests cr
                WHERE cr.job_id = current.id AND cr.action = 'cancel'
                ORDER BY cr.id DESC LIMIT 1
            );
        ELSE
            UPDATE pipeline_control.jobs SET
                cancel_requested = true,
                desired_action = 'cancel',
                requested_at = now(),
                control_version = control_version + 1,
                updated_at = now()
            WHERE id = current.id;
        END IF;
        INSERT INTO pipeline_control.audit (actor, job_id, transition, request_id)
        VALUES (p_actor, current.id, 'cancel_requested', p_request_id);
        SELECT * INTO current FROM pipeline_control.jobs WHERE id = p_job_id;
        RETURN pipeline_control._job_json(current);
    END IF;

    IF p_action = 'resume' THEN
        IF current.status <> 'Paused' AND NOT current.pause_requested THEN
            RAISE EXCEPTION 'illegal_transition' USING ERRCODE = 'P0001';
        END IF;
        UPDATE pipeline_control.jobs SET
            pause_requested = false,
            desired_action = 'none',
            status = CASE WHEN status = 'Paused' THEN 'Queued' ELSE status END,
            lease_until = now() + interval '30 seconds',
            heartbeat_at = now(),
            control_version = control_version + 1,
            updated_at = now()
        WHERE id = current.id;
        INSERT INTO pipeline_control.audit (actor, job_id, transition, request_id)
        VALUES (p_actor, current.id, 'resume', p_request_id);
        SELECT * INTO current FROM pipeline_control.jobs WHERE id = p_job_id;
        RETURN pipeline_control._job_json(current);
    END IF;

    RAISE EXCEPTION 'illegal_transition' USING ERRCODE = 'P0001';
END;
$$;

CREATE OR REPLACE FUNCTION pipeline_control.checkpoint_job(
    p_job_id uuid,
    p_adapter_index integer DEFAULT NULL,
    p_worker_id text DEFAULT NULL,
    p_checkpoint jsonb DEFAULT '{}'::jsonb
) RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
    current pipeline_control.jobs%ROWTYPE;
    lock_name text;
    step_idx integer;
BEGIN
    SELECT * INTO current FROM pipeline_control.jobs WHERE id = p_job_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'run_not_found' USING ERRCODE = 'P0001';
    END IF;
    lock_name := current.target || ':' || current.profile;
    step_idx := COALESCE(p_adapter_index, current.adapter_index);

    IF current.status NOT IN ('Queued', 'Fetching', 'Inserting', 'Paused') THEN
        RAISE EXCEPTION 'illegal_transition' USING ERRCODE = 'P0001';
    END IF;

    INSERT INTO pipeline_control.job_steps (
        job_id, step_index, status, ended_at
    ) VALUES (
        current.id, step_idx, current.status, now()
    )
    ON CONFLICT (job_id, step_index) DO UPDATE SET
        status = EXCLUDED.status,
        ended_at = EXCLUDED.ended_at;

    IF current.cancel_requested THEN
        UPDATE pipeline_control.jobs SET
            adapter_index = step_idx,
            next_step = step_idx,
            checkpoint = COALESCE(p_checkpoint, '{}'::jsonb),
            heartbeat_at = now(),
            lease_until = now() + interval '30 seconds',
            worker_id = COALESCE(p_worker_id, worker_id),
            status = 'Cancelled',
            approved_at = now(),
            updated_at = now()
        WHERE id = current.id;
        DELETE FROM pipeline_control.locks WHERE lock_key = lock_name AND job_id = current.id;
        UPDATE pipeline_control.control_requests
        SET status = 'approved', approved_at = now()
        WHERE job_id = current.id AND action = 'cancel' AND status = 'requested';
        INSERT INTO pipeline_control.audit (actor, job_id, transition, request_id)
        VALUES (COALESCE(p_worker_id, 'worker'), current.id, 'cancel_approved', current.request_id);
    ELSIF current.pause_requested AND current.status IN ('Fetching', 'Inserting', 'Queued') THEN
        UPDATE pipeline_control.jobs SET
            adapter_index = step_idx,
            next_step = step_idx,
            checkpoint = COALESCE(p_checkpoint, '{}'::jsonb),
            heartbeat_at = now(),
            lease_until = now() + interval '30 seconds',
            worker_id = COALESCE(p_worker_id, worker_id),
            status = 'Paused',
            approved_at = now(),
            updated_at = now()
        WHERE id = current.id;
        UPDATE pipeline_control.control_requests
        SET status = 'approved', approved_at = now()
        WHERE job_id = current.id AND action = 'pause' AND status = 'requested';
        INSERT INTO pipeline_control.audit (actor, job_id, transition, request_id)
        VALUES (COALESCE(p_worker_id, 'worker'), current.id, 'pause_approved', current.request_id);
    ELSE
        UPDATE pipeline_control.jobs SET
            adapter_index = step_idx,
            next_step = step_idx,
            checkpoint = COALESCE(p_checkpoint, '{}'::jsonb),
            heartbeat_at = now(),
            lease_until = now() + interval '30 seconds',
            worker_id = COALESCE(p_worker_id, worker_id),
            updated_at = now()
        WHERE id = current.id;
    END IF;

    INSERT INTO pipeline_control.audit (actor, job_id, transition, request_id)
    VALUES (COALESCE(p_worker_id, current.claimed_by, 'worker'), current.id, 'checkpoint', current.request_id);

    SELECT * INTO current FROM pipeline_control.jobs WHERE id = p_job_id;
    RETURN pipeline_control._job_json(current);
END;
$$;

REVOKE ALL ON FUNCTION pipeline_control.enqueue_job(text, text, text, text, text, text, boolean, text, text)
    FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION pipeline_control.claim_job(text)
    FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION pipeline_control.control_job(uuid, text, text, text)
    FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION pipeline_control.checkpoint_job(uuid, integer, text, jsonb)
    FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION pipeline_control._job_json(pipeline_control.jobs)
    FROM PUBLIC, anon, authenticated, service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA pipeline_control TO service_role;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA pipeline_control TO service_role;
