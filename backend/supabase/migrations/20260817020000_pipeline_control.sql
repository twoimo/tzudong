-- Slice 0 control-plane state. Lives on the existing local Supabase Postgres.
-- Hosted apply of this schema is not authorized by the Slice 0 execution approval.

CREATE SCHEMA IF NOT EXISTS pipeline_control;

CREATE TABLE IF NOT EXISTS pipeline_control.jobs (
    id uuid PRIMARY KEY,
    target text NOT NULL,
    profile text NOT NULL CHECK (profile IN ('heavy_local', 'lite_gha')),
    status text NOT NULL CHECK (
        status IN (
            'Queued',
            'Fetching',
            'Inserting',
            'Paused',
            'Cancelled',
            'Failed',
            'Succeeded'
        )
    ),
    idempotency_key text NOT NULL,
    payload_hash text NOT NULL,
    actor text NOT NULL,
    request_id text NOT NULL,
    lease_until timestamptz NOT NULL,
    heartbeat_at timestamptz NOT NULL,
    adapter_index integer NOT NULL DEFAULT 0,
    dry_run boolean NOT NULL DEFAULT true,
    error_code text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (idempotency_key)
);

CREATE TABLE IF NOT EXISTS pipeline_control.locks (
    lock_key text PRIMARY KEY,
    job_id uuid NOT NULL REFERENCES pipeline_control.jobs (id),
    held_since timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS pipeline_control.audit (
    id bigserial PRIMARY KEY,
    actor text NOT NULL,
    job_id uuid NOT NULL,
    transition text NOT NULL,
    request_id text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS pipeline_control_jobs_target_profile_idx
    ON pipeline_control.jobs (target, profile, status);

REVOKE ALL ON SCHEMA pipeline_control FROM PUBLIC;
GRANT USAGE ON SCHEMA pipeline_control TO service_role;
GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA pipeline_control TO service_role;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA pipeline_control TO service_role;
