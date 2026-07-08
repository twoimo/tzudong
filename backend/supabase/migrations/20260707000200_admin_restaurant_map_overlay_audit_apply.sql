-- Audit and apply foundation for admin restaurant map overlay actions.
-- Public clients must not receive direct table/RPC grants; guarded admin APIs call this via service_role only.

create table if not exists public.admin_restaurant_map_overlay_audit_events (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid not null references auth.users(id) on delete restrict,
  action text not null check (action in ('upsert_overlay', 'deactivate_overlay', 'approve_proposal_overlay')),
  restaurant_id uuid not null references public.restaurants(id) on delete restrict,
  overlay_type text not null check (overlay_type in ('trend', 'seasonal')),
  reason text not null,
  before_snapshot jsonb not null default '{}'::jsonb,
  after_snapshot jsonb not null default '{}'::jsonb,
  correlation_id uuid not null,
  idempotency_key text not null,
  payload_hash text not null,
  request_metadata jsonb not null default '{}'::jsonb,
  status text not null default 'applied' check (status in ('applied', 'failed')),
  error_code text,
  applied_at timestamptz not null default timezone('utc'::text, now()),
  created_at timestamptz not null default timezone('utc'::text, now()),
  unique (actor_user_id, idempotency_key)
);

create index if not exists admin_restaurant_map_overlay_audit_lookup_idx
  on public.admin_restaurant_map_overlay_audit_events (restaurant_id, overlay_type, applied_at desc);

create index if not exists admin_restaurant_map_overlay_audit_correlation_idx
  on public.admin_restaurant_map_overlay_audit_events (correlation_id);

create index if not exists admin_restaurant_map_overlay_audit_actor_created_idx
  on public.admin_restaurant_map_overlay_audit_events (actor_user_id, created_at desc);

alter table public.admin_restaurant_map_overlay_audit_events enable row level security;

revoke all on table public.admin_restaurant_map_overlay_audit_events from public;
revoke all on table public.admin_restaurant_map_overlay_audit_events from anon;
revoke all on table public.admin_restaurant_map_overlay_audit_events from authenticated;
grant all on table public.admin_restaurant_map_overlay_audit_events to service_role;

create or replace function public.apply_admin_restaurant_map_overlay_action(
  p_actor_user_id uuid,
  p_action text,
  p_restaurant_id uuid,
  p_overlay_type text,
  p_label text,
  p_description text,
  p_active_from timestamptz,
  p_active_until timestamptz,
  p_evidence jsonb,
  p_reason text,
  p_preview_hash text,
  p_payload_hash text,
  p_correlation_id uuid,
  p_idempotency_key text,
  p_request_metadata jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_restaurant public.restaurants%rowtype;
  v_overlay_before public.admin_restaurant_map_overlays%rowtype;
  v_overlay_after public.admin_restaurant_map_overlays%rowtype;
  v_audit public.admin_restaurant_map_overlay_audit_events%rowtype;
  v_before_snapshot jsonb := '{}'::jsonb;
  v_after_snapshot jsonb := '{}'::jsonb;
  v_request_metadata jsonb := '{}'::jsonb;
  v_now timestamptz := timezone('utc'::text, now());
begin
  if auth.role() <> 'service_role' then
    raise exception 'overlay_service_role_required';
  end if;

  if p_actor_user_id is null then
    raise exception 'overlay_actor_required';
  end if;

  if p_action is null or p_action not in ('upsert_overlay', 'deactivate_overlay') then
    raise exception 'overlay_action_invalid';
  end if;

  if p_restaurant_id is null then
    raise exception 'overlay_restaurant_not_found';
  end if;

  if p_overlay_type is null or p_overlay_type not in ('trend', 'seasonal') then
    raise exception 'overlay_type_invalid';
  end if;

  if p_action = 'upsert_overlay' and (p_label is null or char_length(trim(p_label)) < 1 or char_length(trim(p_label)) > 80) then
    raise exception 'overlay_label_invalid';
  end if;

  if p_description is not null and char_length(p_description) > 500 then
    raise exception 'overlay_description_invalid';
  end if;

  if p_active_from is not null and p_active_until is not null and p_active_from > p_active_until then
    raise exception 'overlay_active_window_invalid';
  end if;

  if p_reason is null or char_length(trim(p_reason)) < 1 then
    raise exception 'overlay_reason_required';
  end if;

  if p_preview_hash is null or p_preview_hash !~ '^[0-9a-f]{64}$' or p_payload_hash is null or p_payload_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'overlay_hash_invalid';
  end if;

  if p_correlation_id is null or p_idempotency_key is null or char_length(trim(p_idempotency_key)) < 1 then
    raise exception 'overlay_idempotency_invalid';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_actor_user_id::text || ':' || p_idempotency_key, 0));
  select *
    into v_audit
    from public.admin_restaurant_map_overlay_audit_events
   where actor_user_id = p_actor_user_id
     and idempotency_key = p_idempotency_key;

  if found then
    if v_audit.payload_hash = p_payload_hash
       and v_audit.correlation_id = p_correlation_id
       and v_audit.restaurant_id = p_restaurant_id
       and v_audit.overlay_type = p_overlay_type
       and v_audit.action = p_action then
      return jsonb_build_object(
        'status', v_audit.status,
        'replayed', true,
        'overlay', v_audit.after_snapshot,
        'audit', to_jsonb(v_audit),
        'readback', jsonb_build_object(
          'matchedPayloadHash', true,
          'matchedPreviewHash', coalesce(v_audit.request_metadata ->> 'previewHash', '') = p_preview_hash,
          'restaurantId', v_audit.restaurant_id,
          'overlayType', v_audit.overlay_type
        )
      );
    end if;

    raise exception 'overlay_idempotency_conflict';
  end if;

  select *
    into v_restaurant
    from public.restaurants
   where id = p_restaurant_id
   for share;

  if not found then
    raise exception 'overlay_restaurant_not_found';
  end if;

  select *
    into v_overlay_before
    from public.admin_restaurant_map_overlays
   where restaurant_id = p_restaurant_id
     and overlay_type = p_overlay_type
   for update;

  if found then
    v_before_snapshot := to_jsonb(v_overlay_before);
  elsif p_action = 'deactivate_overlay' then
    raise exception 'overlay_not_found_for_deactivate';
  end if;

  if p_action = 'upsert_overlay' then
    if v_before_snapshot = '{}'::jsonb then
      insert into public.admin_restaurant_map_overlays (
        restaurant_id,
        overlay_type,
        label,
        description,
        active_from,
        active_until,
        evidence,
        is_active,
        created_by_admin_id,
        updated_by_admin_id
      ) values (
        p_restaurant_id,
        p_overlay_type,
        trim(p_label),
        p_description,
        p_active_from,
        p_active_until,
        coalesce(p_evidence, '{}'::jsonb),
        true,
        p_actor_user_id,
        p_actor_user_id
      )
      returning * into v_overlay_after;
    else
      update public.admin_restaurant_map_overlays
         set label = trim(p_label),
             description = p_description,
             active_from = p_active_from,
             active_until = p_active_until,
             evidence = coalesce(p_evidence, '{}'::jsonb),
             is_active = true,
             updated_by_admin_id = p_actor_user_id
       where restaurant_id = p_restaurant_id
         and overlay_type = p_overlay_type
      returning * into v_overlay_after;
    end if;
  else
    update public.admin_restaurant_map_overlays
       set is_active = false,
           evidence = coalesce(evidence, '{}'::jsonb) || jsonb_build_object(
             'deactivatedAt', v_now,
             'deactivationReason', trim(p_reason),
             'deactivationPreviewHash', p_preview_hash,
             'deactivationPayloadHash', p_payload_hash
           ),
           updated_by_admin_id = p_actor_user_id
     where restaurant_id = p_restaurant_id
       and overlay_type = p_overlay_type
    returning * into v_overlay_after;
  end if;

  v_after_snapshot := to_jsonb(v_overlay_after);
  v_request_metadata := coalesce(p_request_metadata, '{}'::jsonb) || jsonb_build_object('previewHash', p_preview_hash);

  insert into public.admin_restaurant_map_overlay_audit_events (
    actor_user_id,
    action,
    restaurant_id,
    overlay_type,
    reason,
    before_snapshot,
    after_snapshot,
    correlation_id,
    idempotency_key,
    payload_hash,
    request_metadata,
    status
  ) values (
    p_actor_user_id,
    p_action,
    p_restaurant_id,
    p_overlay_type,
    trim(p_reason),
    v_before_snapshot,
    v_after_snapshot,
    p_correlation_id,
    p_idempotency_key,
    p_payload_hash,
    v_request_metadata,
    'applied'
  )
  returning * into v_audit;

  return jsonb_build_object(
    'status', 'applied',
    'replayed', false,
    'overlay', v_after_snapshot,
    'audit', to_jsonb(v_audit),
    'readback', jsonb_build_object(
      'matchedPayloadHash', v_audit.payload_hash = p_payload_hash,
      'matchedPreviewHash', coalesce(v_audit.request_metadata ->> 'previewHash', '') = p_preview_hash,
      'restaurantId', v_overlay_after.restaurant_id,
      'overlayType', v_overlay_after.overlay_type
    )
  );
end;
$$;

revoke all on function public.apply_admin_restaurant_map_overlay_action(
  uuid,
  text,
  uuid,
  text,
  text,
  text,
  timestamptz,
  timestamptz,
  jsonb,
  text,
  text,
  text,
  uuid,
  text,
  jsonb
) from public;
revoke all on function public.apply_admin_restaurant_map_overlay_action(
  uuid,
  text,
  uuid,
  text,
  text,
  text,
  timestamptz,
  timestamptz,
  jsonb,
  text,
  text,
  text,
  uuid,
  text,
  jsonb
) from anon;
revoke all on function public.apply_admin_restaurant_map_overlay_action(
  uuid,
  text,
  uuid,
  text,
  text,
  text,
  timestamptz,
  timestamptz,
  jsonb,
  text,
  text,
  text,
  uuid,
  text,
  jsonb
) from authenticated;
grant execute on function public.apply_admin_restaurant_map_overlay_action(
  uuid,
  text,
  uuid,
  text,
  text,
  text,
  timestamptz,
  timestamptz,
  jsonb,
  text,
  text,
  text,
  uuid,
  text,
  jsonb
) to service_role;
