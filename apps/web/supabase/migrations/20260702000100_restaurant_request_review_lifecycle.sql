-- Add a bounded approve/reject lifecycle for restaurant_requests without
-- converting recommendation requests into restaurant_submissions.

alter table public.restaurant_requests
  add column if not exists status text,
  add column if not exists reviewed_by_admin_id uuid,
  add column if not exists reviewed_at timestamptz,
  add column if not exists admin_note text,
  add column if not exists rejection_reason text,
  add column if not exists review_audit_id uuid,
  add column if not exists updated_at timestamptz;

update public.restaurant_requests
   set status = 'pending'
 where status is null;

update public.restaurant_requests
   set updated_at = created_at
 where updated_at is null;

alter table public.restaurant_requests
  alter column status set default 'pending',
  alter column status set not null,
  alter column updated_at set default timezone('utc', now()),
  alter column updated_at set not null;

do $$
begin
  if not exists (
    select 1
      from pg_constraint
     where conname = 'restaurant_requests_status_check'
       and conrelid = 'public.restaurant_requests'::regclass
  ) then
    alter table public.restaurant_requests
      add constraint restaurant_requests_status_check
      check (status in ('pending', 'approved', 'rejected'));
  end if;
end $$;

create table if not exists public.restaurant_request_review_audit (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.restaurant_requests(id) on delete cascade,
  admin_user_id uuid not null,
  action text not null check (action in ('approve', 'reject')),
  before_status text not null check (before_status in ('pending', 'approved', 'rejected')),
  after_status text not null check (after_status in ('pending', 'approved', 'rejected')),
  admin_note text,
  rejection_reason text,
  created_at timestamptz not null default timezone('utc', now())
);

alter table public.restaurant_request_review_audit enable row level security;

create index if not exists restaurant_requests_status_created_idx
  on public.restaurant_requests (status, created_at desc);

create index if not exists restaurant_request_review_audit_request_idx
  on public.restaurant_request_review_audit (request_id, created_at desc);

create index if not exists restaurant_request_review_audit_admin_idx
  on public.restaurant_request_review_audit (admin_user_id, created_at desc);

revoke all on public.restaurant_request_review_audit from anon, authenticated;
grant select on public.restaurant_request_review_audit to authenticated;

create or replace function public.review_restaurant_request(
  p_request_id uuid,
  p_admin_user_id uuid,
  p_action text,
  p_admin_note text default null,
  p_rejection_reason text default null
)
returns table(success boolean, message text, audit_id uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  current_status text;
  next_status text;
  created_audit_id uuid;
begin
  if not public.is_user_admin(p_admin_user_id) then
    raise exception 'admin privileges required';
  end if;

  if p_action not in ('approve', 'reject') then
    return query select false, '승인 또는 반려 중 하나를 선택해 주세요.', null::uuid;
    return;
  end if;

  if p_action = 'reject' and nullif(btrim(coalesce(p_rejection_reason, '')), '') is null then
    return query select false, '반려 사유를 입력해 주세요.', null::uuid;
    return;
  end if;

  select restaurant_requests.status
    into current_status
    from public.restaurant_requests
   where restaurant_requests.id = p_request_id
   for update;

  if not found then
    return query select false, '검토할 맛집 추천 요청을 찾을 수 없습니다.', null::uuid;
    return;
  end if;

  if current_status <> 'pending' then
    return query select false, '이미 검토가 완료된 맛집 추천 요청입니다.', null::uuid;
    return;
  end if;

  next_status := case when p_action = 'approve' then 'approved' else 'rejected' end;

  insert into public.restaurant_request_review_audit (
    request_id,
    admin_user_id,
    action,
    before_status,
    after_status,
    admin_note,
    rejection_reason
  )
  values (
    p_request_id,
    p_admin_user_id,
    p_action,
    current_status,
    next_status,
    nullif(btrim(coalesce(p_admin_note, '')), ''),
    case when p_action = 'reject' then nullif(btrim(coalesce(p_rejection_reason, '')), '') else null end
  )
  returning id into created_audit_id;

  update public.restaurant_requests
     set status = next_status,
         reviewed_by_admin_id = p_admin_user_id,
         reviewed_at = timezone('utc', now()),
         admin_note = nullif(btrim(coalesce(p_admin_note, '')), ''),
         rejection_reason = case when p_action = 'reject' then nullif(btrim(coalesce(p_rejection_reason, '')), '') else null end,
         review_audit_id = created_audit_id,
         updated_at = timezone('utc', now())
   where restaurant_requests.id = p_request_id;

  return query select
    true,
    case when p_action = 'approve' then '맛집 추천 요청을 승인했습니다.' else '맛집 추천 요청을 반려했습니다.' end,
    created_audit_id;
end;
$$;

revoke all on function public.review_restaurant_request(uuid, uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.review_restaurant_request(uuid, uuid, text, text, text) to service_role;

create or replace function public.delete_pending_restaurant_submission(
  p_submission_id uuid,
  p_user_id uuid,
  p_submission_type text
)
returns table(success boolean, message text)
language plpgsql
security definer
set search_path = public
as $$
declare
  current_status text;
begin
  if p_submission_type not in ('new', 'edit') then
    return query select false, '삭제할 제보 유형이 올바르지 않습니다.';
    return;
  end if;

  select restaurant_submissions.status
    into current_status
    from public.restaurant_submissions
   where restaurant_submissions.id = p_submission_id
     and restaurant_submissions.user_id = p_user_id
     and restaurant_submissions.submission_type = p_submission_type
   for update;

  if not found then
    return query select false, '삭제할 제보 내역을 찾지 못했습니다.';
    return;
  end if;

  if current_status <> 'pending' then
    return query select false, '이미 검토가 완료된 제보 내역은 삭제할 수 없습니다.';
    return;
  end if;

  delete from public.restaurant_submission_items
   where submission_id = p_submission_id;

  delete from public.restaurant_submissions
   where restaurant_submissions.id = p_submission_id
     and restaurant_submissions.user_id = p_user_id
     and restaurant_submissions.submission_type = p_submission_type
     and restaurant_submissions.status = 'pending';

  if not found then
    return query select false, '이미 검토가 완료된 제보 내역은 삭제할 수 없습니다.';
    return;
  end if;

  return query select true, '제보 내역을 삭제했습니다.';
end;
$$;

revoke all on function public.delete_pending_restaurant_submission(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.delete_pending_restaurant_submission(uuid, uuid, text) to service_role;

-- Preserve owner read/insert and admin read/update policies for restaurant_requests.
drop policy if exists "Users can view own requests" on public.restaurant_requests;
create policy "Users can view own requests"
    on public.restaurant_requests for select
    using ((select auth.uid()) = user_id);

drop policy if exists "Users can insert own requests" on public.restaurant_requests;
create policy "Users can insert own requests"
    on public.restaurant_requests for insert
    with check ((select auth.uid()) = user_id);

drop policy if exists "Admins can view all requests" on public.restaurant_requests;
create policy "Admins can view all requests"
    on public.restaurant_requests for select
    using (public.is_user_admin((select auth.uid())));

drop policy if exists "Admins can update requests" on public.restaurant_requests;
create policy "Admins can update requests"
    on public.restaurant_requests for update
    using (public.is_user_admin((select auth.uid())))
    with check (public.is_user_admin((select auth.uid())));

drop policy if exists "Admins can view request review audit" on public.restaurant_request_review_audit;
create policy "Admins can view request review audit"
    on public.restaurant_request_review_audit for select
    using (public.is_user_admin((select auth.uid())));

notify pgrst, 'reload schema';
