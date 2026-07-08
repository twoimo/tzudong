-- Service-role-only claim/finalization RPCs for backend trend job workers.

create or replace function public.claim_admin_trend_job_request(
  p_claimed_by text,
  p_stale_after interval default interval '30 minutes'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_request public.admin_trend_job_requests%rowtype;
begin
  if auth.role() <> 'service_role' then
    raise exception 'trend_job_request_service_role_required';
  end if;

  if p_claimed_by is null or btrim(p_claimed_by) = '' then
    raise exception 'trend_job_request_claimant_required';
  end if;

  with candidate as (
    select id
      from public.admin_trend_job_requests
     where status = 'queued'
        or (status = 'claimed' and claimed_at < timezone('utc'::text, now()) - p_stale_after and completed_at is null)
     order by created_at asc, id asc
     for update skip locked
     limit 1
  )
  update public.admin_trend_job_requests r
     set status = 'claimed',
         claimed_by = p_claimed_by,
         claimed_at = timezone('utc'::text, now()),
         updated_at = timezone('utc'::text, now())
    from candidate
   where r.id = candidate.id
  returning r.* into v_request;

  if not found then
    return jsonb_build_object('claimed', false, 'request', null);
  end if;

  return jsonb_build_object('claimed', true, 'request', to_jsonb(v_request));
end;
$$;

create or replace function public.complete_admin_trend_job_request(
  p_request_id uuid,
  p_claimed_by text,
  p_run_id uuid,
  p_result_summary jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_request public.admin_trend_job_requests%rowtype;
begin
  if auth.role() <> 'service_role' then
    raise exception 'trend_job_request_service_role_required';
  end if;

  update public.admin_trend_job_requests
     set status = 'succeeded',
         run_id = p_run_id,
         result_summary = coalesce(p_result_summary, '{}'::jsonb),
         completed_at = timezone('utc'::text, now()),
         updated_at = timezone('utc'::text, now())
   where id = p_request_id
     and status = 'claimed'
     and claimed_by = p_claimed_by
  returning * into v_request;

  if not found then
    raise exception 'trend_job_request_finalize_failed';
  end if;

  return jsonb_build_object('ok', true, 'status', v_request.status, 'requestId', v_request.id, 'runId', v_request.run_id, 'errorCode', v_request.error_code, 'completedAt', v_request.completed_at);
end;
$$;

create or replace function public.fail_admin_trend_job_request(
  p_request_id uuid,
  p_claimed_by text,
  p_error_code text,
  p_result_summary jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_request public.admin_trend_job_requests%rowtype;
begin
  if auth.role() <> 'service_role' then
    raise exception 'trend_job_request_service_role_required';
  end if;

  if p_error_code is null or btrim(p_error_code) = '' then
    raise exception 'trend_job_request_error_code_required';
  end if;

  update public.admin_trend_job_requests
     set status = 'failed',
         error_code = p_error_code,
         result_summary = coalesce(p_result_summary, '{}'::jsonb),
         completed_at = timezone('utc'::text, now()),
         updated_at = timezone('utc'::text, now())
   where id = p_request_id
     and status = 'claimed'
     and claimed_by = p_claimed_by
  returning * into v_request;

  if not found then
    raise exception 'trend_job_request_finalize_failed';
  end if;

  return jsonb_build_object('ok', true, 'status', v_request.status, 'requestId', v_request.id, 'runId', v_request.run_id, 'errorCode', v_request.error_code, 'completedAt', v_request.completed_at);
end;
$$;

revoke all on function public.claim_admin_trend_job_request(text, interval) from public, anon, authenticated;
revoke all on function public.complete_admin_trend_job_request(uuid, text, uuid, jsonb) from public, anon, authenticated;
revoke all on function public.fail_admin_trend_job_request(uuid, text, text, jsonb) from public, anon, authenticated;

grant execute on function public.claim_admin_trend_job_request(text, interval) to service_role;
grant execute on function public.complete_admin_trend_job_request(uuid, text, uuid, jsonb) to service_role;
grant execute on function public.fail_admin_trend_job_request(uuid, text, text, jsonb) to service_role;
