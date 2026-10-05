-- Transactional review transitions for admin trend overlay proposals.
-- Guarded Next.js routes call this via service_role after requireAdmin.

create or replace function public.review_admin_restaurant_map_overlay_proposal(
  p_actor_user_id uuid,
  p_proposal_id uuid,
  p_transition text,
  p_reason text,
  p_expected_proposal_hash text,
  p_correlation_id uuid,
  p_idempotency_key text,
  p_request_hash text,
  p_request_metadata jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_existing_event public.admin_restaurant_map_overlay_proposal_review_events%rowtype;
  v_proposal public.admin_restaurant_map_overlay_proposals%rowtype;
  v_now timestamptz := timezone('utc'::text, now());
  v_request_metadata jsonb := coalesce(p_request_metadata, '{}'::jsonb);
begin
  if auth.role() <> 'service_role' then
    raise exception 'trend_proposal_review_service_role_required';
  end if;

  if p_actor_user_id is null or p_proposal_id is null then
    raise exception 'invalid_trend_proposal_review_request';
  end if;

  if p_transition is null or p_transition not in ('rejected', 'superseded', 'expired') then
    raise exception 'invalid_trend_proposal_review_request';
  end if;

  if p_reason is null or char_length(trim(p_reason)) < 1 or char_length(trim(p_reason)) > 500 then
    raise exception 'trend_proposal_review_reason_required';
  end if;

  if p_expected_proposal_hash is null or p_expected_proposal_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid_trend_proposal_review_request';
  end if;

  if p_request_hash is null or p_request_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid_trend_proposal_review_request';
  end if;

  if p_correlation_id is null or p_idempotency_key is null or char_length(trim(p_idempotency_key)) < 8 or char_length(trim(p_idempotency_key)) > 128 then
    raise exception 'invalid_trend_proposal_review_request';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_actor_user_id::text || ':' || p_idempotency_key, 0));

  select *
    into v_existing_event
    from public.admin_restaurant_map_overlay_proposal_review_events
   where actor_user_id = p_actor_user_id
     and idempotency_key = p_idempotency_key;

  if found then
    if v_existing_event.proposal_id = p_proposal_id
       and v_existing_event.transition = p_transition
       and v_existing_event.correlation_id = p_correlation_id
       and v_existing_event.request_hash = p_request_hash
       and v_existing_event.proposal_hash = p_expected_proposal_hash then
      select *
        into v_proposal
        from public.admin_restaurant_map_overlay_proposals
       where id = v_existing_event.proposal_id;

      return jsonb_build_object(
        'ok', true,
        'status', v_existing_event.to_status,
        'replayed', true,
        'proposal', jsonb_build_object(
          'id', v_existing_event.proposal_id,
          'proposalStatus', coalesce(v_proposal.proposal_status, v_existing_event.to_status),
          'proposalHash', v_existing_event.proposal_hash,
          'reviewedByAdminId', v_existing_event.reviewed_by_admin_id,
          'reviewedAt', v_existing_event.created_at,
          'reviewReason', v_existing_event.reason
        ),
        'reviewEvent', jsonb_build_object(
          'eventId', v_existing_event.id,
          'transition', v_existing_event.transition,
          'fromStatus', v_existing_event.from_status,
          'toStatus', v_existing_event.to_status,
          'correlationId', v_existing_event.correlation_id,
          'idempotencyKey', v_existing_event.idempotency_key,
          'requestHash', v_existing_event.request_hash
        ),
        'readback', jsonb_build_object(
          'matchedRequestHash', true,
          'matchedProposalHash', true
        )
      );
    end if;

    raise exception 'trend_proposal_review_idempotency_conflict';
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

  if v_proposal.proposal_status <> 'pending' then
    raise exception 'trend_proposal_not_pending';
  end if;

  update public.admin_restaurant_map_overlay_proposals
     set proposal_status = p_transition,
         reviewed_by_admin_id = p_actor_user_id,
         reviewed_at = v_now,
         review_reason = trim(p_reason)
   where id = p_proposal_id
   returning * into v_proposal;

  insert into public.admin_restaurant_map_overlay_proposal_review_events (
    proposal_id,
    actor_user_id,
    transition,
    from_status,
    to_status,
    reason,
    correlation_id,
    idempotency_key,
    request_hash,
    proposal_hash,
    request_metadata,
    reviewed_by_admin_id,
    created_at
  ) values (
    p_proposal_id,
    p_actor_user_id,
    p_transition,
    'pending',
    p_transition,
    trim(p_reason),
    p_correlation_id,
    trim(p_idempotency_key),
    p_request_hash,
    p_expected_proposal_hash,
    v_request_metadata || jsonb_build_object(
      'proposalId', p_proposal_id,
      'transition', p_transition,
      'expectedProposalHash', p_expected_proposal_hash,
      'requestHash', p_request_hash
    ),
    p_actor_user_id,
    v_now
  )
  returning * into v_existing_event;

  return jsonb_build_object(
    'ok', true,
    'status', p_transition,
    'replayed', false,
    'proposal', jsonb_build_object(
      'id', v_proposal.id,
      'proposalStatus', v_proposal.proposal_status,
      'proposalHash', v_proposal.proposal_hash,
      'reviewedByAdminId', v_proposal.reviewed_by_admin_id,
      'reviewedAt', v_proposal.reviewed_at,
      'reviewReason', v_proposal.review_reason
    ),
    'reviewEvent', jsonb_build_object(
      'eventId', v_existing_event.id,
      'transition', v_existing_event.transition,
      'fromStatus', v_existing_event.from_status,
      'toStatus', v_existing_event.to_status,
      'correlationId', v_existing_event.correlation_id,
      'idempotencyKey', v_existing_event.idempotency_key,
      'requestHash', v_existing_event.request_hash
    ),
    'readback', jsonb_build_object(
      'matchedRequestHash', v_existing_event.request_hash = p_request_hash,
      'matchedProposalHash', v_existing_event.proposal_hash = p_expected_proposal_hash
    )
  );
exception
  when unique_violation then
    raise exception 'trend_proposal_review_idempotency_conflict';
end;
$$;

revoke all on function public.review_admin_restaurant_map_overlay_proposal(
  uuid,
  uuid,
  text,
  text,
  text,
  uuid,
  text,
  text,
  jsonb
) from public;
revoke all on function public.review_admin_restaurant_map_overlay_proposal(
  uuid,
  uuid,
  text,
  text,
  text,
  uuid,
  text,
  text,
  jsonb
) from anon;
revoke all on function public.review_admin_restaurant_map_overlay_proposal(
  uuid,
  uuid,
  text,
  text,
  text,
  uuid,
  text,
  text,
  jsonb
) from authenticated;
grant execute on function public.review_admin_restaurant_map_overlay_proposal(
  uuid,
  uuid,
  text,
  text,
  text,
  uuid,
  text,
  text,
  jsonb
) to service_role;
