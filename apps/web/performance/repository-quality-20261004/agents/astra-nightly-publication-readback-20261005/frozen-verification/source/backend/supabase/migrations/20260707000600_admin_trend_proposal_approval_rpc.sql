-- Atomic approval for trend overlay proposals.
-- Applies overlay, writes overlay audit, and marks proposal approved in one service-role transaction.

create or replace function public.approve_admin_restaurant_map_overlay_proposal(
  p_actor_user_id uuid,
  p_proposal_id uuid,
  p_expected_proposal_hash text,
  p_confirmation_text text,
  p_required_confirmation_text text,
  p_reason text,
  p_overlay_payload jsonb,
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
  v_existing_audit public.admin_restaurant_map_overlay_audit_events%rowtype;
  v_proposal public.admin_restaurant_map_overlay_proposals%rowtype;
  v_overlay_before public.admin_restaurant_map_overlays%rowtype;
  v_overlay_after public.admin_restaurant_map_overlays%rowtype;
  v_audit public.admin_restaurant_map_overlay_audit_events%rowtype;
  v_now timestamptz := timezone('utc'::text, now());
  v_payload jsonb := coalesce(p_overlay_payload, '{}'::jsonb);
  v_request_metadata jsonb := coalesce(p_request_metadata, '{}'::jsonb);
  v_route_action text := v_payload ->> 'action';
  v_restaurant_id uuid;
  v_overlay_type text := v_payload ->> 'overlayType';
  v_label text := v_payload ->> 'label';
  v_description text := v_payload ->> 'description';
  v_active_from timestamptz;
  v_active_until timestamptz;
  v_evidence jsonb := coalesce(v_payload -> 'evidence', '{}'::jsonb);
  v_before_snapshot jsonb := '{}'::jsonb;
  v_after_snapshot jsonb := '{}'::jsonb;
begin
  if auth.role() <> 'service_role' then
    raise exception 'trend_proposal_approval_service_role_required';
  end if;

  if p_actor_user_id is null or p_proposal_id is null then
    raise exception 'invalid_trend_proposal_approval_request';
  end if;

  if p_confirmation_text is null or p_required_confirmation_text is null or p_confirmation_text <> p_required_confirmation_text then
    raise exception 'trend_proposal_confirmation_required';
  end if;

  if p_expected_proposal_hash is null or p_expected_proposal_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid_trend_proposal_approval_request';
  end if;

  if p_preview_hash is null or p_preview_hash !~ '^[0-9a-f]{64}$' or p_payload_hash is null or p_payload_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid_trend_proposal_approval_request';
  end if;

  if p_correlation_id is null or p_idempotency_key is null or char_length(trim(p_idempotency_key)) < 8 or char_length(trim(p_idempotency_key)) > 128 then
    raise exception 'invalid_trend_proposal_approval_request';
  end if;

  if v_route_action <> 'upsert' then
    raise exception 'invalid_trend_proposal_approval_request';
  end if;

  if v_overlay_type not in ('trend', 'seasonal') then
    raise exception 'invalid_trend_proposal_approval_request';
  end if;

  begin
    v_restaurant_id := (v_payload ->> 'restaurantId')::uuid;
  exception
    when invalid_text_representation then
      raise exception 'invalid_trend_proposal_approval_request';
  end;

  if v_restaurant_id is null then
    raise exception 'invalid_trend_proposal_approval_request';
  end if;

  if v_label is null or char_length(trim(v_label)) < 1 or char_length(trim(v_label)) > 80 then
    raise exception 'invalid_trend_proposal_approval_request';
  end if;

  if v_description is not null and char_length(v_description) > 500 then
    raise exception 'invalid_trend_proposal_approval_request';
  end if;

  if nullif(v_payload ->> 'activeFrom', '') is not null then
    v_active_from := (v_payload ->> 'activeFrom')::timestamptz;
  end if;
  if nullif(v_payload ->> 'activeUntil', '') is not null then
    v_active_until := (v_payload ->> 'activeUntil')::timestamptz;
  end if;
  if v_active_from is not null and v_active_until is not null and v_active_from > v_active_until then
    raise exception 'trend_proposal_preview_stale';
  end if;

  if p_reason is null or char_length(trim(p_reason)) < 1 then
    raise exception 'invalid_trend_proposal_approval_request';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_actor_user_id::text || ':' || p_idempotency_key, 0));

  select *
    into v_existing_audit
    from public.admin_restaurant_map_overlay_audit_events
   where actor_user_id = p_actor_user_id
     and idempotency_key = p_idempotency_key;

  if found then
    if v_existing_audit.action = 'approve_proposal_overlay'
       and v_existing_audit.payload_hash = p_payload_hash
       and v_existing_audit.correlation_id = p_correlation_id
       and v_existing_audit.request_metadata ->> 'proposalId' = p_proposal_id::text
       and v_existing_audit.request_metadata ->> 'expectedProposalHash' = p_expected_proposal_hash
       and v_existing_audit.request_metadata ->> 'previewHash' = p_preview_hash
       and v_existing_audit.request_metadata ->> 'overlayType' = v_overlay_type
       and v_existing_audit.request_metadata ->> 'restaurantId' = v_restaurant_id::text
       and v_existing_audit.request_metadata ->> 'routeAction' = v_route_action
       and v_existing_audit.request_metadata ->> 'rpcAction' = 'approve_proposal_overlay' then
      select *
        into v_proposal
        from public.admin_restaurant_map_overlay_proposals
       where id = p_proposal_id;

      return jsonb_build_object(
        'ok', true,
        'status', 'approved',
        'replayed', true,
        'overlay', v_existing_audit.after_snapshot,
        'audit', jsonb_build_object(
          'domain', 'admin_restaurant_map_overlays',
          'source', 'admin_restaurant_map_overlay_audit_events',
          'auditId', v_existing_audit.id,
          'correlationId', v_existing_audit.correlation_id,
          'idempotencyKey', v_existing_audit.idempotency_key,
          'payloadHash', v_existing_audit.payload_hash,
          'appliedAt', v_existing_audit.applied_at
        ),
        'proposal', jsonb_build_object(
          'id', p_proposal_id,
          'proposalStatus', coalesce(v_proposal.proposal_status, 'approved'),
          'proposalHash', p_expected_proposal_hash,
          'overlayAuditId', v_existing_audit.id,
          'reviewedByAdminId', v_existing_audit.actor_user_id,
          'reviewedAt', v_existing_audit.applied_at,
          'reviewReason', v_existing_audit.reason
        ),
        'readback', jsonb_build_object(
          'matchedPayloadHash', true,
          'matchedPreviewHash', true,
          'matchedExpectedProposalHash', true,
          'replayed', true
        )
      );
    end if;

    raise exception 'trend_proposal_idempotency_conflict';
  end if;

  select *
    into v_proposal
    from public.admin_restaurant_map_overlay_proposals
   where id = p_proposal_id
   for update;

  if not found then
    raise exception 'trend_proposal_not_found';
  end if;

  if v_proposal.proposal_hash <> p_expected_proposal_hash then
    raise exception 'trend_proposal_hash_stale';
  end if;

  if v_proposal.restaurant_id <> v_restaurant_id or v_proposal.overlay_type <> v_overlay_type then
    raise exception 'trend_proposal_preview_stale';
  end if;

  if v_proposal.proposal_status <> 'pending' then
    raise exception 'trend_proposal_not_pending';
  end if;

  select *
    into v_overlay_before
    from public.admin_restaurant_map_overlays
   where restaurant_id = v_restaurant_id
     and overlay_type = v_overlay_type
   for update;

  if found then
    v_before_snapshot := to_jsonb(v_overlay_before);
    update public.admin_restaurant_map_overlays
       set label = trim(v_label),
           description = v_description,
           active_from = v_active_from,
           active_until = v_active_until,
           evidence = v_evidence,
           is_active = true,
           updated_by_admin_id = p_actor_user_id
     where restaurant_id = v_restaurant_id
       and overlay_type = v_overlay_type
     returning * into v_overlay_after;
  else
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
      v_restaurant_id,
      v_overlay_type,
      trim(v_label),
      v_description,
      v_active_from,
      v_active_until,
      v_evidence,
      true,
      p_actor_user_id,
      p_actor_user_id
    )
    returning * into v_overlay_after;
  end if;

  v_after_snapshot := to_jsonb(v_overlay_after);
  v_request_metadata := jsonb_build_object(
    'route', '/api/admin/trend-proposals/[proposalId]/approve',
    'proposalId', p_proposal_id,
    'expectedProposalHash', p_expected_proposal_hash,
    'previewHash', p_preview_hash,
    'payloadHash', p_payload_hash,
    'payloadVersion', 1,
    'overlayType', v_overlay_type,
    'restaurantId', v_restaurant_id,
    'routeAction', v_route_action,
    'rpcAction', 'approve_proposal_overlay',
    'correlationId', p_correlation_id,
    'idempotencyKey', trim(p_idempotency_key),
    'actorUserId', p_actor_user_id,
    'requestId', v_request_metadata ->> 'requestId',
    'ipHash', v_request_metadata ->> 'ipHash',
    'userAgentHash', v_request_metadata ->> 'userAgentHash'
  );

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
    status,
    applied_at
  ) values (
    p_actor_user_id,
    'approve_proposal_overlay',
    v_restaurant_id,
    v_overlay_type,
    trim(p_reason),
    v_before_snapshot,
    v_after_snapshot,
    p_correlation_id,
    trim(p_idempotency_key),
    p_payload_hash,
    v_request_metadata,
    'applied',
    v_now
  )
  returning * into v_audit;

  update public.admin_restaurant_map_overlay_proposals
     set proposal_status = 'approved',
         reviewed_by_admin_id = p_actor_user_id,
         reviewed_at = v_now,
         review_reason = trim(p_reason),
         overlay_audit_id = v_audit.id
   where id = p_proposal_id
   returning * into v_proposal;

  return jsonb_build_object(
    'ok', true,
    'status', 'approved',
    'replayed', false,
    'overlay', v_after_snapshot,
    'audit', jsonb_build_object(
      'domain', 'admin_restaurant_map_overlays',
      'source', 'admin_restaurant_map_overlay_audit_events',
      'auditId', v_audit.id,
      'correlationId', v_audit.correlation_id,
      'idempotencyKey', v_audit.idempotency_key,
      'payloadHash', v_audit.payload_hash,
      'appliedAt', v_audit.applied_at
    ),
    'proposal', jsonb_build_object(
      'id', v_proposal.id,
      'proposalStatus', v_proposal.proposal_status,
      'proposalHash', v_proposal.proposal_hash,
      'overlayAuditId', v_proposal.overlay_audit_id,
      'reviewedByAdminId', v_proposal.reviewed_by_admin_id,
      'reviewedAt', v_proposal.reviewed_at,
      'reviewReason', v_proposal.review_reason
    ),
    'readback', jsonb_build_object(
      'matchedPayloadHash', v_audit.payload_hash = p_payload_hash,
      'matchedPreviewHash', v_audit.request_metadata ->> 'previewHash' = p_preview_hash,
      'matchedExpectedProposalHash', v_audit.request_metadata ->> 'expectedProposalHash' = p_expected_proposal_hash,
      'replayed', false
    )
  );
exception
  when unique_violation then
    raise exception 'trend_proposal_idempotency_conflict';
  when invalid_datetime_format or datetime_field_overflow then
    raise exception 'trend_proposal_preview_stale';
end;
$$;

revoke all on function public.approve_admin_restaurant_map_overlay_proposal(
  uuid,
  uuid,
  text,
  text,
  text,
  text,
  jsonb,
  text,
  text,
  uuid,
  text,
  jsonb
) from public;
revoke all on function public.approve_admin_restaurant_map_overlay_proposal(
  uuid,
  uuid,
  text,
  text,
  text,
  text,
  jsonb,
  text,
  text,
  uuid,
  text,
  jsonb
) from anon;
revoke all on function public.approve_admin_restaurant_map_overlay_proposal(
  uuid,
  uuid,
  text,
  text,
  text,
  text,
  jsonb,
  text,
  text,
  uuid,
  text,
  jsonb
) from authenticated;
grant execute on function public.approve_admin_restaurant_map_overlay_proposal(
  uuid,
  uuid,
  text,
  text,
  text,
  text,
  jsonb,
  text,
  text,
  uuid,
  text,
  jsonb
) to service_role;
