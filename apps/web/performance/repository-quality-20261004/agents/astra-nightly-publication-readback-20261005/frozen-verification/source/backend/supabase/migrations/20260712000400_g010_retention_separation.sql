-- G010 retention and separation controls.
-- This migration supplies technical controls only. Class applicability, trigger,
-- period, evidence, holds, and external storage inventory remain human-approved.

begin;

create schema if not exists privacy_retention;
revoke all on schema privacy_retention from public, anon, authenticated;
revoke all on all tables in schema privacy_retention from public, anon, authenticated;
revoke all on all sequences in schema privacy_retention from public, anon, authenticated;
revoke all on all functions in schema privacy_retention from public, anon, authenticated;
alter default privileges for role postgres in schema privacy_retention
  revoke all on tables from public, anon, authenticated;
alter default privileges for role postgres in schema privacy_retention
  revoke all on sequences from public, anon, authenticated;
alter default privileges for role postgres in schema privacy_retention
  revoke all on functions from public, anon, authenticated;

create table if not exists privacy_retention.privacy_retention_classes (
  code text primary key check (code ~ '^[a-z][a-z0-9_]{2,79}$'),
  data_class text null check (data_class is null or data_class ~ '^[a-z][a-z0-9_]{2,79}$'),
  basis_code text null check (basis_code is null or basis_code ~ '^[a-z][a-z0-9_.-]{2,119}$'),
  trigger_type text null check (trigger_type is null or trigger_type ~ '^[a-z][a-z0-9_]{2,79}$'),
  retention_period interval null check (retention_period is null or retention_period > interval '0 seconds'),
  status text not null default 'disabled' check (status in ('draft', 'active', 'disabled')),
  approved_evidence_ref text null check (approved_evidence_ref is null or char_length(approved_evidence_ref) between 8 and 160),
  version text null check (version is null or version ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$'),
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  updated_at timestamptz not null default pg_catalog.clock_timestamp(),
  activated_at timestamptz null,
  constraint privacy_retention_classes_active_configuration_check check (
    status <> 'active' or (
      data_class is not null
      and basis_code is not null
      and trigger_type is not null
      and retention_period is not null
      and approved_evidence_ref is not null
      and version is not null
    )
  ),
  constraint privacy_retention_classes_active_version_lock_check check (
    status <> 'active' or activated_at is not null
  )
);

-- These are deliberately unconfigured. Their names are not an applicability
-- decision; an operator/legal approval must supply every active field above.
insert into privacy_retention.privacy_retention_classes (code, status)
values
  ('access_log_1y', 'disabled'),
  ('access_log_2y', 'disabled'),
  ('ecommerce_advertising_6m', 'disabled'),
  ('ecommerce_contract_5y', 'disabled'),
  ('ecommerce_payment_supply_5y', 'disabled'),
  ('ecommerce_dispute_3y', 'disabled'),
  ('privacy_identity_audit', 'disabled'),
  ('privacy_marketing_audit', 'disabled'),
  ('privacy_account_deletion_audit', 'disabled'),
  ('privacy_incident_audit', 'disabled')
on conflict (code) do nothing;

CREATE OR REPLACE FUNCTION public.privacy_resolve_audit_retention_until(
  p_class_code text,
  p_now timestamptz
)
RETURNS timestamptz
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, privacy_retention
AS $$
DECLARE
  v_matching_class_count bigint;
  v_retention_period interval;
BEGIN
  IF p_class_code IS NULL
     OR p_class_code NOT IN (
       'privacy_identity_audit',
       'privacy_marketing_audit',
       'privacy_account_deletion_audit',
       'privacy_incident_audit'
     )
     OR p_now IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'privacy_audit_retention_policy_required';
  END IF;

  SELECT COUNT(*), MAX(retention_period)
  INTO v_matching_class_count, v_retention_period
  FROM privacy_retention.privacy_retention_classes
  WHERE code = p_class_code
    AND status = 'active'
    AND approved_evidence_ref IS NOT NULL
    AND activated_at IS NOT NULL
    AND activated_at <= p_now
    AND version IS NOT NULL
    AND basis_code IS NOT NULL
    AND trigger_type = 'event_occurred'
    AND data_class = p_class_code
    AND retention_period IS NOT NULL
    AND retention_period > interval '0 seconds';

  IF v_matching_class_count <> 1 OR v_retention_period IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'privacy_audit_retention_policy_required';
  END IF;

  RETURN p_now + v_retention_period;
END;
$$;


create table if not exists privacy_retention.privacy_retention_class_sources (
  class_code text not null references privacy_retention.privacy_retention_classes(code) on delete restrict,
  source_type text not null check (source_type in (
    'ocr_metadata',
    'ocr_artifact',
    'notification',
    'approved_audit_record',
    'access_log',
    'storage_object',
    'deleted_account_residue'
  )),
  disposition text not null check (disposition in ('separate', 'purge')),
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key (class_code, source_type),
  constraint privacy_retention_class_sources_storage_disposition_check check (
    (source_type = 'storage_object' and disposition = 'purge')
    or (source_type <> 'storage_object' and disposition = 'separate')
  )
);

create table if not exists privacy_retention.privacy_legal_holds (
  id uuid primary key default gen_random_uuid(),
  subject_ref_hash text not null check (subject_ref_hash ~ '^[0-9a-f]{64}$'),
  data_class text not null check (data_class ~ '^[a-z][a-z0-9_]{2,79}$'),
  reason_code text not null check (reason_code ~ '^[a-z][a-z0-9_.-]{2,119}$'),
  status text not null default 'active' check (status in ('active', 'released')),
  approved_by uuid not null,
  approved_evidence_ref text not null check (char_length(approved_evidence_ref) between 8 and 160),
  expires_at timestamptz null,
  released_at timestamptz null,
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  constraint privacy_legal_holds_release_check check (
    (status = 'active' and released_at is null)
    or (status = 'released' and released_at is not null)
  )
);

create table if not exists privacy_retention.privacy_retention_work_items (
  id uuid primary key default gen_random_uuid(),
  class_code text not null references privacy_retention.privacy_retention_classes(code) on delete restrict,
  data_class text not null check (data_class ~ '^[a-z][a-z0-9_]{2,79}$'),
  source_type text not null check (source_type in (
    'ocr_metadata',
    'ocr_artifact',
    'notification',
    'approved_audit_record',
    'access_log',
    'storage_object',
    'deleted_account_residue'
  )),
  source_ref_hash text not null check (source_ref_hash ~ '^[0-9a-f]{64}$'),
  subject_ref_hash text null check (subject_ref_hash is null or subject_ref_hash ~ '^[0-9a-f]{64}$'),
  source_metadata_hash text null check (source_metadata_hash is null or source_metadata_hash ~ '^[0-9a-f]{64}$'),
  trigger_at timestamptz not null,
  storage_bucket text null check (storage_bucket is null or char_length(storage_bucket) between 1 and 63),
  storage_object_name text null check (storage_object_name is null or char_length(storage_object_name) between 1 and 1024),
  status text not null default 'pending' check (status in ('pending', 'claimed', 'separated', 'purged', 'failed')),
  storage_claim_token uuid null,
  storage_claimed_at timestamptz null,
  last_error_code text null check (last_error_code is null or last_error_code ~ '^[a-z][a-z0-9_]{2,79}$'),
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  updated_at timestamptz not null default pg_catalog.clock_timestamp(),
  unique (class_code, source_type, source_ref_hash),
  constraint privacy_retention_work_items_storage_locator_check check (
    (source_type = 'storage_object' and storage_bucket is not null and storage_object_name is not null)
    or (source_type <> 'storage_object' and storage_bucket is null and storage_object_name is null)
  ),
  constraint privacy_retention_work_items_claim_check check (
    (status = 'claimed' and storage_claim_token is not null and storage_claimed_at is not null)
    or (status <> 'claimed' and storage_claim_token is null and storage_claimed_at is null)
  )
);

create table if not exists privacy_retention.privacy_retained_records (
  id uuid primary key default gen_random_uuid(),
  work_item_id uuid not null unique references privacy_retention.privacy_retention_work_items(id) on delete restrict,
  class_code text not null references privacy_retention.privacy_retention_classes(code) on delete restrict,
  data_class text not null check (data_class ~ '^[a-z][a-z0-9_]{2,79}$'),
  purpose_code text not null default 'approved_retention' check (purpose_code = 'approved_retention'),
  subject_ref_hash text null check (subject_ref_hash is null or subject_ref_hash ~ '^[0-9a-f]{64}$'),
  source_ref_hash text not null check (source_ref_hash ~ '^[0-9a-f]{64}$'),
  source_metadata_hash text null check (source_metadata_hash is null or source_metadata_hash ~ '^[0-9a-f]{64}$'),
  retained_at timestamptz not null default pg_catalog.clock_timestamp(),
  expires_at timestamptz not null,
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  constraint privacy_retained_records_expiry_check check (expires_at >= retained_at)
);

create table if not exists privacy_retention.privacy_retention_runs (
  id uuid primary key default gen_random_uuid(),
  class_code text not null references privacy_retention.privacy_retention_classes(code) on delete restrict,
  cutoff timestamptz not null,
  status text not null check (status in ('previewed', 'confirmed', 'running', 'completed', 'partial', 'failed', 'held')),
  preview_hash text not null check (preview_hash ~ '^[0-9a-f]{64}$'),
  preview_expires_at timestamptz not null,
  idempotency_key text null check (idempotency_key is null or idempotency_key ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$'),
  scanned_count integer not null default 0 check (scanned_count >= 0),
  planned_count integer not null default 0 check (planned_count >= 0),
  held_count integer not null default 0 check (held_count >= 0),
  separated_count integer not null default 0 check (separated_count >= 0),
  storage_deleted_count integer not null default 0 check (storage_deleted_count >= 0),
  failure_count integer not null default 0 check (failure_count >= 0),
  readback_passed boolean not null default false,
  audit_id uuid null,
  started_at timestamptz null,
  completed_at timestamptz null,
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  updated_at timestamptz not null default pg_catalog.clock_timestamp(),
  constraint privacy_retention_runs_completed_readback_check check (
    status <> 'completed' or (readback_passed and completed_at is not null)
  ),
  constraint privacy_retention_runs_completion_order_check check (
    completed_at is null or started_at is null or completed_at >= started_at
  )
);

create unique index if not exists privacy_retention_runs_idempotency_key_idx
  on privacy_retention.privacy_retention_runs (idempotency_key)
  where idempotency_key is not null;
create unique index if not exists privacy_retention_one_active_run_per_class_idx
  on privacy_retention.privacy_retention_runs (class_code)
  where status in ('confirmed', 'running', 'partial');

create table if not exists privacy_retention.privacy_retention_run_items (
  run_id uuid not null references privacy_retention.privacy_retention_runs(id) on delete cascade,
  work_item_id uuid not null references privacy_retention.privacy_retention_work_items(id) on delete restrict,
  source_type text not null check (source_type in (
    'ocr_metadata',
    'ocr_artifact',
    'notification',
    'approved_audit_record',
    'access_log',
    'storage_object',
    'deleted_account_residue'
  )),
  status text not null check (status in ('planned', 'held', 'separated', 'storage_claimed', 'storage_deleted', 'failed')),
  error_code text null check (error_code is null or error_code ~ '^[a-z][a-z0-9_]{2,79}$'),
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  updated_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key (run_id, work_item_id)
);
revoke all on table privacy_retention.privacy_retention_classes from public, anon, authenticated, service_role;
revoke all on table privacy_retention.privacy_retention_class_sources from public, anon, authenticated, service_role;
revoke all on table privacy_retention.privacy_legal_holds from public, anon, authenticated, service_role;
revoke all on table privacy_retention.privacy_retention_work_items from public, anon, authenticated, service_role;
revoke all on table privacy_retention.privacy_retained_records from public, anon, authenticated, service_role;
revoke all on table privacy_retention.privacy_retention_runs from public, anon, authenticated, service_role;
revoke all on table privacy_retention.privacy_retention_run_items from public, anon, authenticated, service_role;

create index if not exists privacy_retention_work_items_eligible_idx
  on privacy_retention.privacy_retention_work_items (class_code, trigger_at, id)
  where status in ('pending', 'failed', 'claimed');
create index if not exists privacy_legal_holds_active_match_idx
  on privacy_retention.privacy_legal_holds (subject_ref_hash, data_class, expires_at)
  where status = 'active';
create index if not exists privacy_retention_run_items_run_status_idx
  on privacy_retention.privacy_retention_run_items (run_id, status, work_item_id);

alter table privacy_retention.privacy_retention_classes enable row level security;
alter table privacy_retention.privacy_retention_class_sources enable row level security;
alter table privacy_retention.privacy_legal_holds enable row level security;
alter table privacy_retention.privacy_retention_work_items enable row level security;
alter table privacy_retention.privacy_retained_records enable row level security;
alter table privacy_retention.privacy_retention_runs enable row level security;
alter table privacy_retention.privacy_retention_run_items enable row level security;

create or replace function privacy_retention.set_updated_at()
returns trigger
language plpgsql
set search_path = pg_catalog, privacy_retention
as $$
begin
  new.updated_at = pg_catalog.clock_timestamp();
  return new;
end;
$$;

create or replace function privacy_retention.prevent_retention_class_history_mutation()
returns trigger
language plpgsql
set search_path = pg_catalog, privacy_retention
as $$
begin
  if old.status <> 'active' and new.status = 'active' then
    new.activated_at := coalesce(old.activated_at, pg_catalog.clock_timestamp());
  end if;

  if old.activated_at is not null and (
    new.data_class is distinct from old.data_class
    or new.basis_code is distinct from old.basis_code
    or new.trigger_type is distinct from old.trigger_type
    or new.retention_period is distinct from old.retention_period
    or new.approved_evidence_ref is distinct from old.approved_evidence_ref
    or new.version is distinct from old.version
    or new.activated_at is distinct from old.activated_at
  ) then
    raise exception using errcode = '55000', message = 'active_retention_class_is_versioned';
  end if;

  return new;
end;
$$;
create or replace function privacy_retention.prevent_active_class_source_mutation()
returns trigger
language plpgsql
set search_path = pg_catalog, privacy_retention
as $$
declare
  target_class_code text := coalesce(new.class_code, old.class_code);
begin
  if exists (
    select 1
    from privacy_retention.privacy_retention_classes
    where code = target_class_code
      and status = 'active'
  ) then
    raise exception using errcode = '55000', message = 'active_retention_class_sources_are_versioned';
  end if;

  return case when tg_op = 'DELETE' then old else new end;
end;
$$;


create or replace function privacy_retention.prevent_legal_hold_history_mutation()
returns trigger
language plpgsql
set search_path = pg_catalog, privacy_retention
as $$
begin
  if old.status = 'released' then
    raise exception using errcode = '55000', message = 'released_legal_hold_is_immutable';
  end if;

  if old.subject_ref_hash is distinct from new.subject_ref_hash
    or old.data_class is distinct from new.data_class
    or old.reason_code is distinct from new.reason_code
    or old.approved_by is distinct from new.approved_by
    or old.approved_evidence_ref is distinct from new.approved_evidence_ref
    or old.expires_at is distinct from new.expires_at
    or old.created_at is distinct from new.created_at
  then
    raise exception using errcode = '55000', message = 'legal_hold_history_is_immutable';
  end if;

  return new;
end;
$$;

drop trigger if exists privacy_retention_classes_updated_at on privacy_retention.privacy_retention_classes;
create trigger privacy_retention_classes_updated_at
before update on privacy_retention.privacy_retention_classes
for each row execute function privacy_retention.set_updated_at();

drop trigger if exists privacy_retention_classes_versioned on privacy_retention.privacy_retention_classes;
create trigger privacy_retention_classes_versioned
before update on privacy_retention.privacy_retention_classes
for each row execute function privacy_retention.prevent_retention_class_history_mutation();
drop trigger if exists privacy_retention_class_sources_versioned on privacy_retention.privacy_retention_class_sources;
create trigger privacy_retention_class_sources_versioned
before insert or update or delete on privacy_retention.privacy_retention_class_sources
for each row execute function privacy_retention.prevent_active_class_source_mutation();

drop trigger if exists privacy_legal_holds_history on privacy_retention.privacy_legal_holds;
create trigger privacy_legal_holds_history
before update on privacy_retention.privacy_legal_holds
for each row execute function privacy_retention.prevent_legal_hold_history_mutation();

drop trigger if exists privacy_retention_work_items_updated_at on privacy_retention.privacy_retention_work_items;
create trigger privacy_retention_work_items_updated_at
before update on privacy_retention.privacy_retention_work_items
for each row execute function privacy_retention.set_updated_at();

drop trigger if exists privacy_retention_runs_updated_at on privacy_retention.privacy_retention_runs;
create trigger privacy_retention_runs_updated_at
before update on privacy_retention.privacy_retention_runs
for each row execute function privacy_retention.set_updated_at();

drop trigger if exists privacy_retention_run_items_updated_at on privacy_retention.privacy_retention_run_items;
create trigger privacy_retention_run_items_updated_at
before update on privacy_retention.privacy_retention_run_items
for each row execute function privacy_retention.set_updated_at();

create or replace function privacy_retention.require_service_role()
returns void
language plpgsql
security definer
set search_path = pg_catalog, auth
as $$
begin
  if auth.role() is distinct from 'service_role' then
    raise exception using errcode = '42501', message = 'privacy_retention_service_role_required';
  end if;
end;
$$;

create or replace function privacy_retention.active_hold_exists(
  p_subject_ref_hash text,
  p_data_class text,
  p_as_of timestamptz
)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, privacy_retention
as $$
  select p_subject_ref_hash is not null and exists (
    select 1
    from privacy_retention.privacy_legal_holds hold
    where hold.subject_ref_hash = p_subject_ref_hash
      and hold.data_class = p_data_class
      and hold.status = 'active'
      and (hold.expires_at is null or hold.expires_at > p_as_of)
  );
$$;

create or replace function privacy_retention.write_run_audit(
  p_run privacy_retention.privacy_retention_runs,
  p_status text,
  p_reason_code text
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public, privacy_retention
as $$
declare
  audit_event_id uuid;
  v_occurred_at timestamptz := pg_catalog.clock_timestamp();
begin
  insert into public.privacy_audit_events (
    event_type,
    actor_user_id,
    operation_id,
    correlation_id,
    preview_hash,
    status,
    reason_code,
    count_summary,
    request_metadata,
    occurred_at,
    retention_until
  ) values (
    'privacy_retention_run',
    case
      when auth.uid() is not null and exists (select 1 from auth.users where id = auth.uid()) then auth.uid()
      else null
    end,
    p_run.id,
    p_run.id,
    p_run.preview_hash,
    p_status,
    upper(p_reason_code),
    jsonb_build_object(
      'requested', p_run.scanned_count,
      'eligible', p_run.planned_count,
      'suppressed', p_run.held_count,
      'created', p_run.separated_count,
      'updated', p_run.storage_deleted_count,
      'failed', p_run.failure_count
    ),
    jsonb_build_object('route', '/api/internal/privacy-retention'),
    v_occurred_at,
    v_occurred_at + (
      select retention_period
      from privacy_retention.privacy_retention_classes
      where code = p_run.class_code
    )
  ) returning id into audit_event_id;

  return audit_event_id;
end;
$$;

create or replace function public.preview_privacy_retention_run(
  p_class_code text,
  p_as_of timestamptz,
  p_batch_size integer,
  p_max_duration_ms integer default 10000
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, extensions, public, privacy_retention
as $$
declare
  retention_class privacy_retention.privacy_retention_classes%rowtype;
  run privacy_retention.privacy_retention_runs%rowtype;
  preview_eligible_count integer := 0;
  preview_held_count integer := 0;
  preview_hash text;
  audit_event_id uuid;
  v_now timestamptz := pg_catalog.clock_timestamp();
begin
  perform privacy_retention.require_service_role();

  if p_batch_size not between 1 and 100 or p_max_duration_ms not between 1000 and 10000 then
    raise exception using errcode = '22023', message = 'privacy_retention_batch_or_timeout_invalid';
  end if;
  perform set_config('statement_timeout', p_max_duration_ms::text, true);

  select * into retention_class
  from privacy_retention.privacy_retention_classes
  where code = p_class_code;

  if not found or retention_class.status <> 'active' then
    raise exception using errcode = '22023', message = 'privacy_retention_class_not_active';
  end if;

  preview_hash := encode(digest(concat_ws('|', p_class_code, p_as_of::text, p_batch_size::text, retention_class.version, retention_class.approved_evidence_ref), 'sha256'), 'hex');

  insert into privacy_retention.privacy_retention_runs (
    class_code,
    cutoff,
    status,
    preview_hash,
    preview_expires_at
  ) values (
    p_class_code,
    p_as_of,
    'previewed',
    preview_hash,
    v_now + interval '15 minutes'
  ) returning * into run;

  with candidates as (
    select
      item.id,
      item.source_type,
      privacy_retention.active_hold_exists(item.subject_ref_hash, item.data_class, p_as_of) as held
    from privacy_retention.privacy_retention_work_items item
    join privacy_retention.privacy_retention_class_sources source
      on source.class_code = item.class_code
      and source.source_type = item.source_type
    where item.class_code = p_class_code
      and item.data_class = retention_class.data_class
      and item.trigger_at <= p_as_of -- cutoff is inclusive: before and at are eligible.
      and item.status in ('pending', 'failed', 'claimed')
      and (item.status <> 'claimed' or item.storage_claimed_at < v_now - interval '5 minutes')
    order by item.trigger_at asc, item.id asc
    limit p_batch_size
  ), inserted as (
    insert into privacy_retention.privacy_retention_run_items (run_id, work_item_id, source_type, status)
    select run.id, id, source_type, case when held then 'held' else 'planned' end
    from candidates
    returning status
  )
  select
    count(*) filter (where status = 'planned'),
    count(*) filter (where status = 'held')
  into preview_eligible_count, preview_held_count
  from inserted;

  update privacy_retention.privacy_retention_runs
  set scanned_count = preview_eligible_count + preview_held_count,
      planned_count = preview_eligible_count,
      held_count = preview_held_count
  where id = run.id
  returning * into run;

  audit_event_id := privacy_retention.write_run_audit(run, 'previewed', 'retention_preview');
  update privacy_retention.privacy_retention_runs
  set audit_id = audit_event_id
  where id = run.id
  returning * into run;

  return jsonb_build_object(
    'operationId', run.id,
    'previewHash', run.preview_hash,
    'expiresAt', run.preview_expires_at,
    'summary', jsonb_build_object(
      'cutoff', run.cutoff,
      'eligible', run.planned_count,
      'held', run.held_count,
      'scanned', run.scanned_count
    ),
    'requiredConfirmation', '보존·분리 적용'
  );
end;
$$;

create or replace function public.confirm_privacy_retention_run(
  p_run_id uuid,
  p_preview_hash text,
  p_confirmation_text text,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, privacy_retention
as $$
declare
  run privacy_retention.privacy_retention_runs%rowtype;
  audit_event_id uuid;
begin
  perform privacy_retention.require_service_role();

  select * into run
  from privacy_retention.privacy_retention_runs
  where id = p_run_id
  for update;

  if not found then
    raise exception using errcode = '22023', message = 'privacy_retention_run_not_found';
  end if;

  if run.preview_hash <> p_preview_hash or p_confirmation_text <> '보존·분리 적용' then
    raise exception using errcode = '22023', message = 'privacy_retention_confirmation_invalid';
  end if;

  if run.status in ('confirmed', 'running', 'partial', 'completed', 'held') then
    if run.idempotency_key = p_idempotency_key then
      return jsonb_build_object('operationId', run.id, 'status', run.status);
    end if;
    raise exception using errcode = '22023', message = 'privacy_retention_run_already_confirmed';
  end if;

  if run.status <> 'previewed' or run.preview_expires_at <= pg_catalog.clock_timestamp() then
    raise exception using errcode = '22023', message = 'privacy_retention_preview_expired_or_invalid';
  end if;

  update privacy_retention.privacy_retention_runs
  set status = 'confirmed', idempotency_key = p_idempotency_key
  where id = run.id
  returning * into run;

  audit_event_id := privacy_retention.write_run_audit(run, 'confirmed', 'retention_confirmed');
  update privacy_retention.privacy_retention_runs
  set audit_id = audit_event_id
  where id = run.id;

  return jsonb_build_object('operationId', run.id, 'status', 'confirmed');
end;
$$;

create or replace function public.apply_privacy_retention_run(
  p_run_id uuid,
  p_preview_hash text,
  p_idempotency_key text,
  p_max_duration_ms integer default 10000
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, privacy_retention
as $$
declare
  run privacy_retention.privacy_retention_runs%rowtype;
  audit_event_id uuid;
  db_separated integer := 0;
  held_now integer := 0;
  failed_now integer := 0;
  v_now timestamptz := pg_catalog.clock_timestamp();
begin
  perform privacy_retention.require_service_role();

  if p_max_duration_ms not between 1000 and 10000 then
    raise exception using errcode = '22023', message = 'privacy_retention_timeout_invalid';
  end if;
  perform set_config('statement_timeout', p_max_duration_ms::text, true);

  select * into run
  from privacy_retention.privacy_retention_runs
  where id = p_run_id
  for update;

  if not found then
    raise exception using errcode = '22023', message = 'privacy_retention_run_not_found';
  end if;
  if run.preview_hash <> p_preview_hash or run.idempotency_key <> p_idempotency_key then
    raise exception using errcode = '22023', message = 'privacy_retention_apply_binding_invalid';
  end if;
  if run.status = 'completed' then
    return jsonb_build_object(
      'operationId', run.id,
      'status', 'applied',
      'readback', jsonb_build_object('passed', run.readback_passed),
      'auditId', run.audit_id
    );
  end if;
  if run.status not in ('confirmed', 'running', 'partial', 'held') then
    raise exception using errcode = '22023', message = 'privacy_retention_run_not_applicable';
  end if;
  if not pg_try_advisory_xact_lock(hashtextextended(run.id::text, 0)) then
    return jsonb_build_object(
      'operationId', run.id,
      'status', 'held',
      'readback', jsonb_build_object('passed', false),
      'auditId', run.audit_id,
      'errorCode', 'privacy_retention_run_locked'
    );
  end if;

  update privacy_retention.privacy_retention_runs
  set status = 'running', started_at = coalesce(started_at, v_now)
  where id = run.id;
  -- A crashed storage worker may leave a claim behind. Its short lease makes
  -- the same bound run retryable without treating an unacknowledged deletion
  -- as complete.
  update privacy_retention.privacy_retention_work_items item
  set status = 'pending',
      storage_claim_token = null,
      storage_claimed_at = null,
      last_error_code = 'privacy_retention_storage_claim_expired'
  from privacy_retention.privacy_retention_run_items run_item
  where run_item.run_id = run.id
    and run_item.work_item_id = item.id
    and run_item.status = 'storage_claimed'
    and item.status = 'claimed'
    and item.storage_claim_token = run.id
    and item.storage_claimed_at < v_now - interval '5 minutes';

  update privacy_retention.privacy_retention_run_items run_item
  set status = 'planned',
      error_code = 'privacy_retention_storage_claim_expired'
  from privacy_retention.privacy_retention_work_items item
  where run_item.run_id = run.id
    and run_item.work_item_id = item.id
    and run_item.status = 'storage_claimed'
    and item.status = 'pending';

  -- A release/expiry makes a previously held item retryable; an active hold
  -- wins again immediately before any mutation.
  update privacy_retention.privacy_retention_run_items run_item
  set status = 'planned', error_code = null
  from privacy_retention.privacy_retention_work_items item
  where run_item.run_id = run.id
    and run_item.work_item_id = item.id
    and run_item.status in ('held', 'failed')
    and item.status in ('pending', 'failed')
    and not privacy_retention.active_hold_exists(item.subject_ref_hash, item.data_class, run.cutoff);

  update privacy_retention.privacy_retention_run_items run_item
  set status = 'held', error_code = null
  from privacy_retention.privacy_retention_work_items item
  where run_item.run_id = run.id
    and run_item.work_item_id = item.id
    and run_item.status = 'planned'
    and privacy_retention.active_hold_exists(item.subject_ref_hash, item.data_class, run.cutoff);
  get diagnostics held_now = row_count;

  with selected as (
    select item.*
    from privacy_retention.privacy_retention_run_items run_item
    join privacy_retention.privacy_retention_work_items item on item.id = run_item.work_item_id
    where run_item.run_id = run.id
      and run_item.status = 'planned'
      and item.source_type <> 'storage_object'
      and item.status in ('pending', 'failed')
      and not privacy_retention.active_hold_exists(item.subject_ref_hash, item.data_class, run.cutoff)
    for update of item skip locked
  ), copied as (
    insert into privacy_retention.privacy_retained_records (
      work_item_id,
      class_code,
      data_class,
      subject_ref_hash,
      source_ref_hash,
      source_metadata_hash,
      retained_at,
      expires_at
    )
    select
      selected.id,
      selected.class_code,
      selected.data_class,
      selected.subject_ref_hash,
      selected.source_ref_hash,
      selected.source_metadata_hash,
      v_now,
      selected.trigger_at + retention_class.retention_period
    from selected
    join privacy_retention.privacy_retention_classes retention_class
      on retention_class.code = selected.class_code
      and retention_class.status = 'active'
    on conflict (work_item_id) do nothing
    returning work_item_id
  ), updated as (
    update privacy_retention.privacy_retention_work_items item
    set status = 'separated', last_error_code = null
    from copied
    where item.id = copied.work_item_id
    returning item.id
  )
  update privacy_retention.privacy_retention_run_items run_item
  set status = 'separated', error_code = null
  from updated
  where run_item.run_id = run.id
    and run_item.work_item_id = updated.id;
  get diagnostics db_separated = row_count;
  update privacy_retention.privacy_retention_run_items run_item
  set status = 'held', error_code = null
  from privacy_retention.privacy_retention_work_items item
  where run_item.run_id = run.id
    and run_item.work_item_id = item.id
    and run_item.status = 'planned'
    and privacy_retention.active_hold_exists(item.subject_ref_hash, item.data_class, run.cutoff);

  -- Locked source rows remain unmodified and make the receipt partial. They
  -- are retried by the same idempotent run instead of being reported complete.
  update privacy_retention.privacy_retention_run_items run_item
  set status = 'failed', error_code = 'privacy_retention_source_busy'
  from privacy_retention.privacy_retention_work_items item
  where run_item.run_id = run.id
    and run_item.work_item_id = item.id
    and run_item.status = 'planned'
    and item.source_type <> 'storage_object';
  get diagnostics failed_now = row_count;

  update privacy_retention.privacy_retention_runs current_run
  set separated_count = (
        select count(*) from privacy_retention.privacy_retention_run_items
        where run_id = current_run.id and status = 'separated'
      ),
      held_count = (
        select count(*) from privacy_retention.privacy_retention_run_items
        where run_id = current_run.id and status = 'held'
      ),
      failure_count = (
        select count(*) from privacy_retention.privacy_retention_run_items
        where run_id = current_run.id and status = 'failed'
      )
  where current_run.id = run.id
  returning * into run;

  audit_event_id := privacy_retention.write_run_audit(run, 'applied', 'retention_apply');
  update privacy_retention.privacy_retention_runs
  set audit_id = audit_event_id
  where id = run.id
  returning * into run;

  return jsonb_build_object(
    'operationId', run.id,
    'status', case when run.failure_count > 0 then 'partial' when run.held_count > 0 and run.separated_count = 0 then 'held' else 'applied' end,
    'storagePending', (
      select count(*) from privacy_retention.privacy_retention_run_items
      where run_id = run.id and source_type = 'storage_object' and status = 'planned'
    ),
    'readback', jsonb_build_object('passed', false),
    'auditId', run.audit_id,
    'counts', jsonb_build_object('separated', db_separated, 'heldNow', held_now, 'failedNow', failed_now)
  );
end;
$$;

create or replace function public.claim_privacy_retention_storage_items(
  p_run_id uuid,
  p_preview_hash text,
  p_idempotency_key text,
  p_limit integer
)
returns table (work_item_id uuid, bucket_name text, object_name text)
language plpgsql
security definer
set search_path = pg_catalog, public, privacy_retention
as $$
declare
  run privacy_retention.privacy_retention_runs%rowtype;
begin
  perform privacy_retention.require_service_role();
  if p_limit not between 1 and 100 then
    raise exception using errcode = '22023', message = 'privacy_retention_storage_limit_invalid';
  end if;

  select * into run
  from privacy_retention.privacy_retention_runs
  where id = p_run_id
  for update;
  if not found or run.preview_hash <> p_preview_hash or run.idempotency_key <> p_idempotency_key then
    raise exception using errcode = '22023', message = 'privacy_retention_storage_binding_invalid';
  end if;

  return query
  with candidates as (
    select run_item.work_item_id
    from privacy_retention.privacy_retention_run_items run_item
    join privacy_retention.privacy_retention_work_items item on item.id = run_item.work_item_id
    where run_item.run_id = run.id
      and run_item.source_type = 'storage_object'
      and run_item.status = 'planned'
      and item.status in ('pending', 'failed')
      and not privacy_retention.active_hold_exists(item.subject_ref_hash, item.data_class, run.cutoff)
    order by item.trigger_at asc, item.id asc
    limit p_limit
    for update of run_item, item skip locked
  ), claimed_items as (
    update privacy_retention.privacy_retention_work_items item
    set status = 'claimed',
        storage_claim_token = run.id,
        storage_claimed_at = pg_catalog.clock_timestamp(),
        last_error_code = null
    from candidates
    where item.id = candidates.work_item_id
    returning item.id, item.storage_bucket, item.storage_object_name
  ), marked as (
    update privacy_retention.privacy_retention_run_items run_item
    set status = 'storage_claimed', error_code = null
    from claimed_items
    where run_item.run_id = run.id and run_item.work_item_id = claimed_items.id
    returning run_item.work_item_id
  )
  select claimed_items.id, claimed_items.storage_bucket, claimed_items.storage_object_name
  from claimed_items
  join marked on marked.work_item_id = claimed_items.id;
end;
$$;

create or replace function public.ack_privacy_retention_storage_items(
  p_run_id uuid,
  p_preview_hash text,
  p_idempotency_key text,
  p_work_item_ids uuid[],
  p_succeeded boolean
)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public, privacy_retention
as $$
declare
  run privacy_retention.privacy_retention_runs%rowtype;
  affected integer := 0;
begin
  perform privacy_retention.require_service_role();
  if cardinality(p_work_item_ids) is null or cardinality(p_work_item_ids) not between 1 and 100 then
    raise exception using errcode = '22023', message = 'privacy_retention_storage_ack_invalid';
  end if;

  select * into run
  from privacy_retention.privacy_retention_runs
  where id = p_run_id
  for update;
  if not found or run.preview_hash <> p_preview_hash or run.idempotency_key <> p_idempotency_key then
    raise exception using errcode = '22023', message = 'privacy_retention_storage_binding_invalid';
  end if;

  if p_succeeded then
    update privacy_retention.privacy_retention_work_items item
    set status = 'purged', storage_claim_token = null, storage_claimed_at = null, last_error_code = null
    where item.id = any(p_work_item_ids)
      and item.status = 'claimed'
      and item.storage_claim_token = run.id
      and not privacy_retention.active_hold_exists(item.subject_ref_hash, item.data_class, run.cutoff);

    update privacy_retention.privacy_retention_run_items run_item
    set status = 'storage_deleted', error_code = null
    from privacy_retention.privacy_retention_work_items item
    where run_item.run_id = run.id
      and run_item.work_item_id = item.id
      and run_item.work_item_id = any(p_work_item_ids)
      and run_item.status = 'storage_claimed'
      and item.status = 'purged';
  else
    update privacy_retention.privacy_retention_work_items item
    set status = 'failed', storage_claim_token = null, storage_claimed_at = null, last_error_code = 'privacy_retention_storage_cleanup_failed'
    where item.id = any(p_work_item_ids)
      and item.status = 'claimed'
      and item.storage_claim_token = run.id;

    update privacy_retention.privacy_retention_run_items run_item
    set status = 'failed', error_code = 'privacy_retention_storage_cleanup_failed'
    where run_item.run_id = run.id
      and run_item.work_item_id = any(p_work_item_ids)
      and run_item.status = 'storage_claimed';
  end if;

  get diagnostics affected = row_count;
  return affected;
end;
$$;

create or replace function public.finalize_privacy_retention_run(
  p_run_id uuid,
  p_preview_hash text,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, privacy_retention
as $$
declare
  run privacy_retention.privacy_retention_runs%rowtype;
  readback_expected_count integer := 0;
  readback_separated_count integer := 0;
  readback_storage_deleted_count integer := 0;
  readback_held_count integer := 0;
  readback_failure_count integer := 0;
  readback_pending_count integer := 0;
  readback_ok boolean := false;
  final_status text;
  audit_event_id uuid;
begin
  perform privacy_retention.require_service_role();

  select * into run
  from privacy_retention.privacy_retention_runs
  where id = p_run_id
  for update;
  if not found or run.preview_hash <> p_preview_hash or run.idempotency_key <> p_idempotency_key then
    raise exception using errcode = '22023', message = 'privacy_retention_finalize_binding_invalid';
  end if;

  select
    count(*),
    count(*) filter (where status = 'separated'),
    count(*) filter (where status = 'storage_deleted'),
    count(*) filter (where status = 'held'),
    count(*) filter (where status = 'failed'),
    count(*) filter (where status in ('planned', 'storage_claimed'))
  into readback_expected_count, readback_separated_count, readback_storage_deleted_count, readback_held_count, readback_failure_count, readback_pending_count
  from privacy_retention.privacy_retention_run_items
  where run_id = run.id;

  -- Independent readback verifies both the separated minimal database copies
  -- and storage acknowledgements rather than trusting mutation row counts.
  readback_ok := readback_expected_count > 0
    and readback_pending_count = 0
    and readback_held_count = 0
    and readback_failure_count = 0
    and (
      select count(*)
      from privacy_retention.privacy_retention_run_items run_item
      join privacy_retention.privacy_retention_work_items item on item.id = run_item.work_item_id
      left join privacy_retention.privacy_retained_records record on record.work_item_id = item.id
      where run_item.run_id = run.id
        and (
          (run_item.source_type = 'storage_object' and run_item.status = 'storage_deleted' and item.status = 'purged')
          or (run_item.source_type <> 'storage_object' and run_item.status = 'separated' and item.status = 'separated' and record.id is not null)
        )
    ) = readback_expected_count;

  final_status := case
    when readback_ok then 'completed'
    when readback_held_count = readback_expected_count and readback_expected_count > 0 then 'held'
    else 'partial'
  end;

  update privacy_retention.privacy_retention_runs
  set status = final_status,
      separated_count = readback_separated_count,
      storage_deleted_count = readback_storage_deleted_count,
      held_count = readback_held_count,
      failure_count = readback_failure_count,
      readback_passed = readback_ok,
      completed_at = case when final_status = 'completed' then pg_catalog.clock_timestamp() else null end
  where id = run.id
  returning * into run;

  audit_event_id := privacy_retention.write_run_audit(
    run,
    case when run.readback_passed then 'readback_passed' else 'readback_failed' end,
    'retention_readback'
  );
  update privacy_retention.privacy_retention_runs
  set audit_id = audit_event_id
  where id = run.id
  returning * into run;

  return jsonb_build_object(
    'operationId', run.id,
    'status', case when run.status = 'completed' then 'applied' else run.status end,
    'readback', jsonb_build_object(
      'passed', run.readback_passed,
      'checks', jsonb_build_object(
        'expectedCountMatched', run.readback_passed,
        'databaseCountMatched', run.readback_passed,
        'storageCountMatched', run.readback_passed,
        'noActiveHoldMutated', run.held_count = 0
      )
    ),
    'auditId', run.audit_id,
    'errorCode', case when run.readback_passed then null else 'privacy_retention_readback_incomplete' end
  );
end;
$$;

alter function privacy_retention.set_updated_at() owner to postgres;
alter function privacy_retention.prevent_retention_class_history_mutation() owner to postgres;
alter function privacy_retention.prevent_active_class_source_mutation() owner to postgres;
alter function privacy_retention.prevent_legal_hold_history_mutation() owner to postgres;
alter function privacy_retention.require_service_role() owner to postgres;
alter function privacy_retention.active_hold_exists(text, text, timestamptz) owner to postgres;
alter function privacy_retention.write_run_audit(privacy_retention.privacy_retention_runs, text, text) owner to postgres;
alter function public.preview_privacy_retention_run(text, timestamptz, integer, integer) owner to postgres;
alter function public.confirm_privacy_retention_run(uuid, text, text, text) owner to postgres;
alter function public.apply_privacy_retention_run(uuid, text, text, integer) owner to postgres;
alter function public.claim_privacy_retention_storage_items(uuid, text, text, integer) owner to postgres;
alter function public.ack_privacy_retention_storage_items(uuid, text, text, uuid[], boolean) owner to postgres;
alter function public.finalize_privacy_retention_run(uuid, text, text) owner to postgres;
alter function public.privacy_resolve_audit_retention_until(text, timestamptz) owner to postgres;

revoke all on function privacy_retention.set_updated_at() from public, anon, authenticated;
revoke all on function privacy_retention.prevent_retention_class_history_mutation() from public, anon, authenticated;
revoke all on function privacy_retention.prevent_active_class_source_mutation() from public, anon, authenticated;
revoke all on function privacy_retention.prevent_legal_hold_history_mutation() from public, anon, authenticated;
revoke all on function privacy_retention.require_service_role() from public, anon, authenticated;
revoke all on function privacy_retention.active_hold_exists(text, text, timestamptz) from public, anon, authenticated;
revoke all on function privacy_retention.write_run_audit(privacy_retention.privacy_retention_runs, text, text) from public, anon, authenticated;
revoke all on function public.preview_privacy_retention_run(text, timestamptz, integer, integer) from public, anon, authenticated;
revoke all on function public.confirm_privacy_retention_run(uuid, text, text, text) from public, anon, authenticated;
revoke all on function public.apply_privacy_retention_run(uuid, text, text, integer) from public, anon, authenticated;
revoke all on function public.claim_privacy_retention_storage_items(uuid, text, text, integer) from public, anon, authenticated;
revoke all on function public.ack_privacy_retention_storage_items(uuid, text, text, uuid[], boolean) from public, anon, authenticated;
revoke all on function public.finalize_privacy_retention_run(uuid, text, text) from public, anon, authenticated;
revoke all on function public.privacy_resolve_audit_retention_until(text, timestamptz) from public, anon, authenticated, service_role;

grant execute on function public.preview_privacy_retention_run(text, timestamptz, integer, integer) to service_role;
grant execute on function public.confirm_privacy_retention_run(uuid, text, text, text) to service_role;
grant execute on function public.apply_privacy_retention_run(uuid, text, text, integer) to service_role;
grant execute on function public.claim_privacy_retention_storage_items(uuid, text, text, integer) to service_role;
grant execute on function public.ack_privacy_retention_storage_items(uuid, text, text, uuid[], boolean) to service_role;
grant execute on function public.finalize_privacy_retention_run(uuid, text, text) to service_role;

notify pgrst, 'reload schema';

commit;
