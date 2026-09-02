-- Local_Only_Schema for the platform-modernization pipeline (design C5, D2, D6, D8).
-- This schema is LOCAL ONLY. It must not intersect the Publication_Set
-- (public.restaurants, public.videos). Hosted apply is not authorized by this file.
-- New immutable migration. Do not edit prior migrations; corrections add a new file.

CREATE SCHEMA IF NOT EXISTS local_analytics;

-- Staging rows captured before the Supabase insert step (restaurants).
CREATE TABLE IF NOT EXISTS local_analytics.staging_restaurants (
    id bigserial PRIMARY KEY,
    run_id text NOT NULL,
    trace_id text,
    row_identity_key text,
    payload jsonb NOT NULL,
    payload_hash text,
    fixture_marker text,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS local_analytics_staging_restaurants_run_idx
    ON local_analytics.staging_restaurants (run_id, created_at DESC);

-- Staging video metadata captured before the Supabase insert step (videos).
CREATE TABLE IF NOT EXISTS local_analytics.staging_videos (
    id bigserial PRIMARY KEY,
    run_id text NOT NULL,
    video_id text,
    payload jsonb NOT NULL,
    payload_hash text,
    fixture_marker text,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS local_analytics_staging_videos_run_idx
    ON local_analytics.staging_videos (run_id, created_at DESC);

-- Per-step crawl evidence summary.
CREATE TABLE IF NOT EXISTS local_analytics.crawl_evidence (
    id bigserial PRIMARY KEY,
    run_id text NOT NULL,
    step text NOT NULL,
    status text NOT NULL CHECK (status IN ('succeeded', 'failed', 'skipped')),
    reason_code text,
    summary jsonb NOT NULL DEFAULT '{}'::jsonb,
    recorded_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS local_analytics_crawl_evidence_run_idx
    ON local_analytics.crawl_evidence (run_id, recorded_at DESC);

-- Requirement 2 Parity_Result rows (design D2). Mismatch fields hold names only,
-- never field values, and are bounded to 50 entries.
CREATE TABLE IF NOT EXISTS local_analytics.parity_results (
    id                    bigserial   PRIMARY KEY,
    slice_id              text        NOT NULL,
    input_id              text        NOT NULL,
    rust_artifact_id      text        NOT NULL,
    normalization_rule_id text        NOT NULL,
    matched               boolean     NOT NULL,
    compared_fields       text[]      NOT NULL,
    mismatch_fields       text[]      NOT NULL,
    mismatch_field_count  integer     NOT NULL,
    result_code           text,
    recorded_at           timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT parity_mismatch_bound CHECK (cardinality(mismatch_fields) <= 50),
    CONSTRAINT parity_count_nonneg   CHECK (mismatch_field_count >= 0)
);

CREATE INDEX IF NOT EXISTS local_analytics_parity_results_slice_idx
    ON local_analytics.parity_results (slice_id, rust_artifact_id, recorded_at DESC);

-- Requirement 3 performance measurement runs (design D3). Raw artifacts live under
-- backend/performance/*; this table indexes evidence-set summaries only.
CREATE TABLE IF NOT EXISTS local_analytics.benchmark_runs (
    id                     bigserial   PRIMARY KEY,
    evidence_set_id        text        NOT NULL,
    slice_id               text        NOT NULL,
    metric_key             text        NOT NULL,
    summary_statistic      text        NOT NULL,
    repetition_count       integer     NOT NULL CHECK (repetition_count >= 0),
    observed_value         numeric,
    baseline_measurement_id text,
    environment_profile_id text,
    status                 text        NOT NULL DEFAULT 'unresolved',
    recorded_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS local_analytics_benchmark_runs_slice_idx
    ON local_analytics.benchmark_runs (slice_id, metric_key, recorded_at DESC);

-- Publish job requests and their status. Admin route handlers only enqueue and
-- read here; the Backend_Runtime worker performs the apply and readback.
CREATE TABLE IF NOT EXISTS local_analytics.publish_jobs (
    publish_job_id uuid        PRIMARY KEY,
    requested_by   text        NOT NULL,
    status         text        NOT NULL DEFAULT 'requested'
        CHECK (status IN (
            'requested', 'preview', 'confirmed', 'applying',
            'readback', 'succeeded', 'failed'
        )),
    preview_hash   text,
    result_code    text,
    requested_at   timestamptz NOT NULL DEFAULT now(),
    updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS local_analytics_publish_jobs_status_idx
    ON local_analytics.publish_jobs (status, requested_at DESC);

-- Publish preview / apply / readback history (design D6). The design expresses the
-- primary key as (publish_job_id, stage, target_table, coalesce(batch_index, -1)).
-- Postgres primary keys cannot embed an expression, so the coalesce is materialized
-- as a stored generated column and the key is declared over plain columns.
CREATE TABLE IF NOT EXISTS local_analytics.publish_history (
    publish_job_id   uuid        NOT NULL,
    stage            text        NOT NULL,   -- preview|confirm|apply|readback
    stage_at         timestamptz NOT NULL DEFAULT now(),
    target_table     text        NOT NULL,
    insert_row_count integer     NOT NULL DEFAULT 0,
    update_row_count integer     NOT NULL DEFAULT 0,
    total_row_count  integer     NOT NULL DEFAULT 0,
    batch_index      integer,
    batch_index_key  integer     GENERATED ALWAYS AS (COALESCE(batch_index, -1)) STORED,
    readback_rows    integer,
    matched_rows     integer,
    mismatched_rows  integer,
    preview_hash     text,
    result_code      text        NOT NULL,
    PRIMARY KEY (publish_job_id, stage, target_table, batch_index_key)
);

-- Append-only publish audit events (design D6). No row values, provider diagnostics,
-- free-form error strings, or Forbidden_Log_Field content.
CREATE TABLE IF NOT EXISTS local_analytics.publish_audit_events (
    id             bigserial   PRIMARY KEY,
    publish_job_id uuid        NOT NULL,
    stage          text        NOT NULL,
    recorded_at    timestamptz NOT NULL DEFAULT now(),
    target_table   text        NOT NULL,
    row_count      integer     NOT NULL,
    result_code    text        NOT NULL
);

CREATE INDEX IF NOT EXISTS local_analytics_publish_audit_events_job_idx
    ON local_analytics.publish_audit_events (publish_job_id, recorded_at DESC);

-- Requirement 16 phase-report index. Points at backend/log/phases/{phaseId}-report.json.
CREATE TABLE IF NOT EXISTS local_analytics.phase_reports (
    id          bigserial   PRIMARY KEY,
    phase_id    text        NOT NULL,
    sequence    integer     NOT NULL,
    report_path text        NOT NULL,
    result_code text,
    recorded_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (phase_id)
);

-- Requirement 15 Agent_Action_Record (design D8). The unique (trigger_signal_id,
-- action_kind_id) enforces "exactly once per trigger+action" at the data layer.
-- Columns are the six enumerated fields plus recorded_at; no signal body column.
CREATE TABLE IF NOT EXISTS local_analytics.agent_action_records (
    action_id           uuid        PRIMARY KEY,
    trigger_signal_id   text        NOT NULL,
    signal_severity     text        NOT NULL,
    action_kind_id      text        NOT NULL,
    result_code         text,
    human_approval_ref  text,
    recorded_at         timestamptz NOT NULL DEFAULT now(),
    UNIQUE (trigger_signal_id, action_kind_id)
);

-- Grants: local backend schema reached over the postgres DSN / service_role only.
-- Not a Data API surface. Mirror the pipeline_control convention.
REVOKE ALL ON SCHEMA local_analytics FROM PUBLIC;
GRANT USAGE ON SCHEMA local_analytics TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA local_analytics TO service_role;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA local_analytics TO service_role;

-- Append-only enforcement: revoke UPDATE and DELETE from every role, including
-- service_role, so recorded audit rows cannot be modified or removed.
REVOKE UPDATE, DELETE ON local_analytics.publish_audit_events
    FROM PUBLIC, anon, authenticated, service_role;
REVOKE UPDATE, DELETE ON local_analytics.agent_action_records
    FROM PUBLIC, anon, authenticated, service_role;

ALTER DEFAULT PRIVILEGES IN SCHEMA local_analytics
    REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC, anon, authenticated, service_role;
