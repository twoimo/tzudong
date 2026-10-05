-- G010 notification and marketing authority. Marketing dispatch remains opt-in and
-- fail-closed; this migration makes no legal, filing, or compliance claims.

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  type text not null,
  title text not null,
  message text not null,
  data jsonb not null default '{}'::jsonb,
  is_read boolean not null default false,
  created_at timestamptz not null default pg_catalog.clock_timestamp()
);

alter table public.notifications
  add column if not exists classification text not null default 'transactional',
  add column if not exists channel text not null default 'in_app',
  add column if not exists consent_event_id uuid references public.privacy_consent_events(id) on delete restrict,
  add column if not exists retention_class text not null default 'notifications_operational',
  add column if not exists campaign_operation_id uuid,
  add column if not exists delivered_at timestamptz;

update public.notifications set data = '{}'::jsonb where data is null;
alter table public.notifications alter column data set default '{}'::jsonb;
alter table public.notifications alter column data set not null;
alter table public.notifications
  drop constraint if exists notifications_classification_check,
  add constraint notifications_classification_check check (classification in ('transactional', 'marketing')),
  drop constraint if exists notifications_channel_check,
  add constraint notifications_channel_check check (channel in ('in_app', 'email', 'sms', 'push')),
  drop constraint if exists notifications_marketing_consent_check,
  add constraint notifications_marketing_consent_check check (
    (classification = 'transactional' and consent_event_id is null)
    or (classification = 'marketing' and channel in ('email', 'sms', 'push') and consent_event_id is not null)
  );
create index if not exists notifications_owner_created_at_idx on public.notifications (user_id, created_at desc);

create or replace function public.assert_notification_content_safe(p_title text, p_message text, p_data jsonb)
returns void language plpgsql immutable set search_path = pg_catalog as $$
declare v_data_text text;
begin
  if p_title is null or char_length(trim(p_title)) not between 1 and 120 then raise exception 'notification_title_invalid'; end if;
  if p_message is null or char_length(trim(p_message)) not between 1 and 1000 then raise exception 'notification_message_invalid'; end if;
  if p_data is null or jsonb_typeof(p_data) <> 'object' or (select count(*) from jsonb_object_keys(p_data)) > 16 then raise exception 'notification_data_invalid'; end if;
  if exists (
    select 1 from jsonb_each(p_data) as item(key, value)
    where key !~ '^[A-Za-z][A-Za-z0-9_]{0,39}$'
      or lower(key) in ('address','email','phone','telephone','token','secret','password','credential','rrn','residentregistrationnumber','latitude','longitude','lat','lng','location','rawocr','ocr','rejectionreason')
      or jsonb_typeof(value) not in ('string','number','boolean','null')
      or (jsonb_typeof(value) = 'string' and char_length(trim(both '"' from value::text)) > 160)
  ) then raise exception 'notification_data_unsafe'; end if;
  v_data_text := p_data::text;
  if p_title ~* '[A-Z0-9._%+''-]+@[A-Z0-9.-]+\.[A-Z]{2,}'
    or p_message ~* '[A-Z0-9._%+''-]+@[A-Z0-9.-]+\.[A-Z]{2,}'
    or v_data_text ~* '[A-Z0-9._%+''-]+@[A-Z0-9.-]+\.[A-Z]{2,}'
    or p_title ~ '[0-9]{6}-?[1-4][0-9]{6}'
    or p_message ~ '[0-9]{6}-?[1-4][0-9]{6}'
    or v_data_text ~ '[0-9]{6}-?[1-4][0-9]{6}'
    or p_title ~ '(^|[^0-9])(\+?82[-. ]?)?(0?1[016789]|0?2|0?[3-6][1-5])[-. ]?[0-9]{3,4}[-. ]?[0-9]{4}([^0-9]|$)'
    or p_message ~ '(^|[^0-9])(\+?82[-. ]?)?(0?1[016789]|0?2|0?[3-6][1-5])[-. ]?[0-9]{3,4}[-. ]?[0-9]{4}([^0-9]|$)'
    or v_data_text ~ '(^|[^0-9])(\+?82[-. ]?)?(0?1[016789]|0?2|0?[3-6][1-5])[-. ]?[0-9]{3,4}[-. ]?[0-9]{4}([^0-9]|$)'
    or p_title ~* '((lat|latitude|lng|lon|longitude|위도|경도)[[:space:]]*[:=][[:space:]]*-?[0-9]{1,3}\.[0-9]{4,}|(coordinates?|coords?|좌표)[[:space:]]*[:=][[:space:]]*\(?[[:space:]]*-?[0-9]{1,3}\.[0-9]{4,}[[:space:]]*[,/][[:space:]]*-?[0-9]{1,3}\.[0-9]{4,})'
    or p_message ~* '((lat|latitude|lng|lon|longitude|위도|경도)[[:space:]]*[:=][[:space:]]*-?[0-9]{1,3}\.[0-9]{4,}|(coordinates?|coords?|좌표)[[:space:]]*[:=][[:space:]]*\(?[[:space:]]*-?[0-9]{1,3}\.[0-9]{4,}[[:space:]]*[,/][[:space:]]*-?[0-9]{1,3}\.[0-9]{4,})'
    or v_data_text ~* '((lat|latitude|lng|lon|longitude|위도|경도)[[:space:]]*[:=][[:space:]]*-?[0-9]{1,3}\.[0-9]{4,}|(coordinates?|coords?|좌표)[[:space:]]*[:=][[:space:]]*\(?[[:space:]]*-?[0-9]{1,3}\.[0-9]{4,}[[:space:]]*[,/][[:space:]]*-?[0-9]{1,3}\.[0-9]{4,})'
    or p_title ~* '(bearer[[:space:]]+|api[_-]?key|access[_-]?token|refresh[_-]?token|password[=:])'
    or p_message ~* '(bearer[[:space:]]+|api[_-]?key|access[_-]?token|refresh[_-]?token|password[=:])'
    or v_data_text ~* '(bearer[[:space:]]+|api[_-]?key|access[_-]?token|refresh[_-]?token|password[=:])'
  then raise exception 'notification_content_unsafe'; end if;
end; $$;

create or replace function public.create_user_notification(p_user_id uuid, p_type text, p_title text, p_message text, p_data jsonb default '{}'::jsonb)
returns void language plpgsql security definer set search_path = public, pg_catalog as $$
begin
  if auth.uid() is null or auth.uid() <> p_user_id then raise exception 'notification_owner_required'; end if;
  if p_type is null or p_type !~ '^[a-z_]{1,64}$' then raise exception 'notification_type_invalid'; end if;
  perform public.assert_notification_content_safe(p_title, p_message, coalesce(p_data, '{}'::jsonb));
  insert into public.notifications (user_id,type,title,message,data,classification,channel,retention_class)
  values (p_user_id,p_type,trim(p_title),trim(p_message),coalesce(p_data,'{}'::jsonb),'transactional','in_app','notifications_operational');
end; $$;

create or replace function public.mark_notification_read(notification_uuid uuid)
returns void language plpgsql security definer set search_path = public, pg_catalog as $$
begin
  if auth.uid() is null or notification_uuid is null then raise exception 'notification_owner_required'; end if;
  update public.notifications set is_read = true where id = notification_uuid and user_id = auth.uid();
end; $$;

create or replace function public.mark_all_notifications_read()
returns void language plpgsql security definer set search_path = public, pg_catalog as $$
begin
  if auth.uid() is null then raise exception 'notification_owner_required'; end if;
  update public.notifications set is_read = true where user_id = auth.uid() and is_read = false;
end; $$;

create or replace function public.delete_notification(notification_uuid uuid)
returns void language plpgsql security definer set search_path = public, pg_catalog as $$
begin
  if auth.uid() is null or notification_uuid is null then raise exception 'notification_owner_required'; end if;
  delete from public.notifications where id = notification_uuid and user_id = auth.uid();
end; $$;

create or replace function public.assert_marketing_service_role()
returns void language plpgsql security definer set search_path = pg_catalog as $$
begin
  if auth.role() <> 'service_role' then raise exception 'marketing_service_role_required'; end if;
end; $$;

create or replace function public.is_marketing_night_window(p_scheduled_at timestamptz, p_timezone text default 'Asia/Seoul')
returns boolean language plpgsql stable set search_path = pg_catalog as $$
declare v_local_time time;
begin
  if p_scheduled_at is null or p_timezone is null or not exists (select 1 from pg_timezone_names where name = p_timezone) then raise exception 'marketing_timezone_invalid'; end if;
  v_local_time := p_scheduled_at at time zone p_timezone;
  return v_local_time >= time '21:00' or v_local_time < time '08:00';
end; $$;

create or replace function public.evaluate_marketing_permission_state(p_channel text, p_ordinary_granted boolean, p_night_granted boolean, p_scheduled_at timestamptz, p_timezone text default 'Asia/Seoul')
returns table (allowed boolean, reason_code text) language plpgsql stable set search_path = public, pg_catalog as $$
begin
  if p_channel not in ('email','sms','push') then raise exception 'marketing_channel_invalid'; end if;
  if coalesce(p_ordinary_granted,false) = false then return query select false,'ordinary_consent_missing'::text; return; end if;
  -- Email remains subject to ordinary consent and alone skips the separate night check.
  if public.is_marketing_night_window(p_scheduled_at,p_timezone) and p_channel <> 'email' and coalesce(p_night_granted,false) = false then
    return query select false,'night_consent_missing'::text; return;
  end if;
  return query select true,'allowed'::text;
end; $$;

create or replace function public.evaluate_notification_marketing_permission(p_user_id uuid, p_channel text, p_scheduled_at timestamptz, p_timezone text default 'Asia/Seoul')
returns table (allowed boolean, reason_code text, consent_event_id uuid, night_consent_event_id uuid)
language plpgsql security definer stable set search_path = public, pg_catalog as $$
declare v_ordinary uuid; v_night uuid;
begin
  perform public.assert_marketing_service_role();
  if p_user_id is null or p_channel not in ('email','sms','push') then raise exception 'marketing_permission_input_invalid'; end if;
  select state.consent_event_id into v_ordinary from public.privacy_consent_state state
   where state.user_id=p_user_id and state.purpose=p_channel || '_marketing' and state.channel=p_channel and state.decision='granted'
   order by state.occurred_at desc limit 1;
  if p_channel <> 'email' and public.is_marketing_night_window(p_scheduled_at,p_timezone) then
    select state.consent_event_id into v_night from public.privacy_consent_state state
     where state.user_id=p_user_id and state.purpose='night_marketing' and state.channel=p_channel and state.decision='granted'
     order by state.occurred_at desc limit 1;
  end if;
  return query select permission.allowed,permission.reason_code,
    case when permission.allowed then v_ordinary end,
    case when permission.allowed then v_night end
  from public.evaluate_marketing_permission_state(p_channel,v_ordinary is not null,v_night is not null,p_scheduled_at,p_timezone) permission;
end; $$;

create table if not exists public.marketing_campaign_operations (
  id uuid primary key default gen_random_uuid(), actor_user_id uuid not null references auth.users(id) on delete restrict,
  channel text not null check (channel in ('email','sms','push')), title text not null, message text not null,
  data jsonb not null default '{}'::jsonb, preview_hash text not null check (preview_hash ~ '^[0-9a-f]{64}$'),
  expires_at timestamptz not null, status text not null default 'previewed' check (status in ('previewed','applying','applied','partial','failed')),
  audit_id uuid, created_at timestamptz not null default pg_catalog.clock_timestamp(), updated_at timestamptz not null default pg_catalog.clock_timestamp()
);
create table if not exists public.marketing_campaign_recipients (
  operation_id uuid not null references public.marketing_campaign_operations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete restrict,
  status text not null default 'pending' check (status in ('pending','eligible','suppressed','sent','failed')),
  consent_event_id uuid references public.privacy_consent_events(id) on delete restrict,
  night_consent_event_id uuid references public.privacy_consent_events(id) on delete restrict,
  updated_at timestamptz not null default pg_catalog.clock_timestamp(), primary key(operation_id,user_id)
);
create table if not exists public.marketing_campaign_batches (
  id uuid primary key default gen_random_uuid(), operation_id uuid not null references public.marketing_campaign_operations(id) on delete cascade,
  idempotency_key text not null check(char_length(trim(idempotency_key)) between 8 and 128),
  status text not null check(status in ('prepared','provider_failed','completed')), eligible_count integer not null check(eligible_count between 0 and 100),
  created_at timestamptz not null default pg_catalog.clock_timestamp(), completed_at timestamptz, unique(operation_id,idempotency_key)
);
alter table public.notifications drop constraint if exists notifications_campaign_operation_fk;
alter table public.notifications add constraint notifications_campaign_operation_fk foreign key(campaign_operation_id) references public.marketing_campaign_operations(id) on delete restrict;
create unique index if not exists notifications_campaign_recipient_uniq on public.notifications(campaign_operation_id,user_id) where campaign_operation_id is not null;
create index if not exists marketing_campaign_recipients_status_idx on public.marketing_campaign_recipients(operation_id,status);

alter table public.notifications enable row level security;
alter table public.notifications force row level security;
drop policy if exists notifications_owner_select on public.notifications;
create policy notifications_owner_select on public.notifications for select to authenticated using (user_id = auth.uid());
drop policy if exists notifications_owner_update on public.notifications;
create policy notifications_owner_update on public.notifications for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists notifications_owner_delete on public.notifications;
create policy notifications_owner_delete on public.notifications for delete to authenticated using (user_id = auth.uid());
alter table public.marketing_campaign_operations enable row level security;
alter table public.marketing_campaign_operations force row level security;
alter table public.marketing_campaign_recipients enable row level security;
alter table public.marketing_campaign_recipients force row level security;
alter table public.marketing_campaign_batches enable row level security;
alter table public.marketing_campaign_batches force row level security;

create or replace function public.record_marketing_campaign_audit(p_operation_id uuid,p_actor_user_id uuid,p_preview_hash text,p_status text,p_reason_code text,p_error_code text,p_requested integer,p_eligible integer,p_suppressed integer,p_failed integer)
returns uuid language plpgsql security definer set search_path = public,pg_catalog as $$
declare v_id uuid; v_occurred_at timestamptz := pg_catalog.clock_timestamp();
begin
  insert into public.privacy_audit_events(event_type,actor_user_id,operation_id,correlation_id,preview_hash,status,reason_code,error_code,count_summary,request_metadata,occurred_at,retention_until)
  values ('g010_marketing_campaign',p_actor_user_id,p_operation_id,p_operation_id,p_preview_hash,p_status,p_reason_code,p_error_code,
    jsonb_build_object('requested',greatest(coalesce(p_requested,0),0),'eligible',greatest(coalesce(p_eligible,0),0),'suppressed',greatest(coalesce(p_suppressed,0),0),'failed',greatest(coalesce(p_failed,0),0)),
    jsonb_build_object('route','/api/admin/marketing-campaigns'),v_occurred_at,public.privacy_resolve_audit_retention_until('privacy_marketing_audit',v_occurred_at)) returning id into v_id;
  return v_id;
end; $$;

create or replace function public.marketing_campaign_receipt(p_operation_id uuid)
returns jsonb language plpgsql security definer set search_path = public,pg_catalog as $$
declare v_operation public.marketing_campaign_operations%rowtype; v_requested integer:=0; v_sent integer:=0; v_suppressed integer:=0; v_failed integer:=0; v_rows integer:=0;
begin
  perform public.assert_marketing_service_role();
  select * into v_operation from public.marketing_campaign_operations where id=p_operation_id;
  if not found then raise exception 'marketing_operation_not_found'; end if;
  select count(*)::integer,count(*) filter(where status='sent')::integer,count(*) filter(where status='suppressed')::integer,count(*) filter(where status in ('failed','eligible','pending'))::integer into v_requested,v_sent,v_suppressed,v_failed from public.marketing_campaign_recipients where operation_id=p_operation_id;
  select count(*)::integer into v_rows from public.notifications where campaign_operation_id=p_operation_id and classification='marketing';
  return jsonb_build_object('operationId',v_operation.id,'status',v_operation.status,'auditId',v_operation.audit_id,
    'counts',jsonb_build_object('requested',coalesce(v_requested,0),'sent',coalesce(v_sent,0),'suppressed',coalesce(v_suppressed,0),'failed',coalesce(v_failed,0)),
    'readback',jsonb_build_object('passed',v_operation.status in ('applied','partial') and v_rows=v_sent,'notificationRows',coalesce(v_rows,0)));
end; $$;

create or replace function public.preview_marketing_campaign(p_actor_user_id uuid,p_channel text,p_recipient_user_ids uuid[],p_title text,p_message text,p_data jsonb,p_preview_hash text,p_expires_at timestamptz)
returns jsonb language plpgsql security definer set search_path = public,pg_catalog as $$
declare v_operation uuid:=gen_random_uuid(); v_requested integer; v_audit uuid; v_now timestamptz:=pg_catalog.clock_timestamp();
begin
  perform public.assert_marketing_service_role();
  if p_actor_user_id is null or p_channel not in ('email','sms','push') or p_preview_hash !~ '^[0-9a-f]{64}$' or p_expires_at is null or p_expires_at <= v_now or p_expires_at > v_now + interval '15 minutes' then raise exception 'marketing_preview_invalid'; end if;
  v_requested:=coalesce(array_length(p_recipient_user_ids,1),0);
  if v_requested not between 1 and 100 or (select count(distinct user_id) from unnest(p_recipient_user_ids) recipients(user_id)) <> v_requested then raise exception 'marketing_recipient_batch_invalid'; end if;
  perform public.assert_notification_content_safe(p_title,p_message,coalesce(p_data,'{}'::jsonb));
  insert into public.marketing_campaign_operations(id,actor_user_id,channel,title,message,data,preview_hash,expires_at) values(v_operation,p_actor_user_id,p_channel,trim(p_title),trim(p_message),coalesce(p_data,'{}'::jsonb),p_preview_hash,p_expires_at);
  insert into public.marketing_campaign_recipients(operation_id,user_id) select v_operation,user_id from unnest(p_recipient_user_ids) recipients(user_id);
  v_audit:=public.record_marketing_campaign_audit(v_operation,p_actor_user_id,p_preview_hash,'previewed','MARKETING_CAMPAIGN_PREVIEW',null,v_requested,0,0,0);
  update public.marketing_campaign_operations set audit_id=v_audit where id=v_operation;
  return jsonb_build_object('operationId',v_operation,'expiresAt',p_expires_at,'requestedCount',v_requested,'batchCap',100);
end; $$;

create or replace function public.prepare_marketing_campaign_batch(p_operation_id uuid,p_actor_user_id uuid,p_preview_hash text,p_idempotency_key text,p_batch_limit integer default 100,p_timezone text default 'Asia/Seoul')
returns jsonb language plpgsql security definer set search_path = public,pg_catalog as $$
declare v_operation public.marketing_campaign_operations%rowtype; v_batch public.marketing_campaign_batches%rowtype; v_has_batch boolean:=false; v_recipient public.marketing_campaign_recipients%rowtype; v_permission record; v_recipients jsonb:='[]'::jsonb; v_eligible integer:=0; v_suppressed integer:=0; v_requested integer:=0; v_audit uuid; v_now timestamptz:=pg_catalog.clock_timestamp();
begin
  perform public.assert_marketing_service_role();
  if p_operation_id is null or p_actor_user_id is null or p_preview_hash !~ '^[0-9a-f]{64}$' or p_idempotency_key is null or char_length(trim(p_idempotency_key)) not between 8 and 128 or p_batch_limit not between 1 and 100 then raise exception 'marketing_apply_invalid'; end if;
  select * into v_operation from public.marketing_campaign_operations where id=p_operation_id for update;
  if not found then raise exception 'marketing_operation_not_found'; end if;
  if v_operation.actor_user_id<>p_actor_user_id or v_operation.preview_hash<>p_preview_hash then raise exception 'marketing_preview_mismatch'; end if;
  if v_operation.expires_at<=v_now then raise exception 'marketing_preview_expired'; end if;
  select * into v_batch from public.marketing_campaign_batches where operation_id=p_operation_id and idempotency_key=trim(p_idempotency_key) for update; v_has_batch:=found;
  if v_has_batch and v_batch.status='completed' then return jsonb_build_object('status','completed','replayed',true,'receipt',public.marketing_campaign_receipt(p_operation_id)); end if;
  if v_has_batch and v_batch.status='prepared' then
    select coalesce(jsonb_agg(jsonb_build_object('userId',user_id) order by user_id),'[]'::jsonb) into v_recipients from public.marketing_campaign_recipients where operation_id=p_operation_id and status='eligible';
    return jsonb_build_object('status','prepared','replayed',true,'operationId',p_operation_id,'batchId',v_batch.id,'channel',v_operation.channel,'title',v_operation.title,'message',v_operation.message,'data',v_operation.data,'recipients',v_recipients);
  end if;
  for v_recipient in select * from public.marketing_campaign_recipients where operation_id=p_operation_id and status in ('pending','failed') order by user_id limit p_batch_limit for update loop
    select * into v_permission from public.evaluate_notification_marketing_permission(v_recipient.user_id,v_operation.channel,v_now,p_timezone);
    if v_permission.allowed then
      update public.marketing_campaign_recipients set status='eligible',consent_event_id=v_permission.consent_event_id,night_consent_event_id=v_permission.night_consent_event_id,updated_at=v_now where operation_id=p_operation_id and user_id=v_recipient.user_id;
      v_recipients:=v_recipients || jsonb_build_array(jsonb_build_object('userId',v_recipient.user_id)); v_eligible:=v_eligible+1;
    else
      update public.marketing_campaign_recipients set status='suppressed',consent_event_id=null,night_consent_event_id=null,updated_at=v_now where operation_id=p_operation_id and user_id=v_recipient.user_id; v_suppressed:=v_suppressed+1;
    end if;
  end loop;
  select count(*)::integer into v_requested from public.marketing_campaign_recipients where operation_id=p_operation_id;
  if v_eligible=0 then
    v_audit:=public.record_marketing_campaign_audit(p_operation_id,p_actor_user_id,p_preview_hash,'applied','MARKETING_CAMPAIGN_SUPPRESSED',null,v_requested,0,v_suppressed,0);
    update public.marketing_campaign_operations set status='applied',audit_id=v_audit,updated_at=v_now where id=p_operation_id;
    return jsonb_build_object('status','applied','receipt',public.marketing_campaign_receipt(p_operation_id));
  end if;
  if v_has_batch then update public.marketing_campaign_batches set status='prepared',eligible_count=v_eligible,completed_at=null where id=v_batch.id; else insert into public.marketing_campaign_batches(operation_id,idempotency_key,status,eligible_count) values(p_operation_id,trim(p_idempotency_key),'prepared',v_eligible) returning * into v_batch; end if;
  v_audit:=public.record_marketing_campaign_audit(p_operation_id,p_actor_user_id,p_preview_hash,'confirmed','MARKETING_CAMPAIGN_CONFIRMED',null,v_requested,v_eligible,v_suppressed,0);
  update public.marketing_campaign_operations set status='applying',audit_id=v_audit,updated_at=v_now where id=p_operation_id;
  return jsonb_build_object('status','prepared','operationId',p_operation_id,'batchId',v_batch.id,'channel',v_operation.channel,'title',v_operation.title,'message',v_operation.message,'data',v_operation.data,'recipients',v_recipients);
end; $$;

create or replace function public.fail_marketing_campaign_batch(p_operation_id uuid,p_batch_id uuid,p_actor_user_id uuid,p_preview_hash text,p_error_code text)
returns jsonb language plpgsql security definer set search_path = public,pg_catalog as $$
declare v_operation public.marketing_campaign_operations%rowtype; v_batch public.marketing_campaign_batches%rowtype; v_requested integer:=0; v_suppressed integer:=0; v_audit uuid; v_now timestamptz:=pg_catalog.clock_timestamp();
begin
  perform public.assert_marketing_service_role();
  if p_error_code not in ('provider_unavailable','provider_request_failed','provider_response_invalid') then raise exception 'marketing_provider_error_invalid'; end if;
  select * into v_operation from public.marketing_campaign_operations where id=p_operation_id for update;
  select * into v_batch from public.marketing_campaign_batches where id=p_batch_id and operation_id=p_operation_id for update;
  if not found or v_operation.actor_user_id<>p_actor_user_id or v_operation.preview_hash<>p_preview_hash then raise exception 'marketing_batch_not_found'; end if;
  update public.marketing_campaign_batches set status='provider_failed' where id=p_batch_id;
  update public.marketing_campaign_recipients set status='failed',updated_at=v_now where operation_id=p_operation_id and status='eligible';
  select count(*)::integer,count(*) filter(where status='suppressed')::integer into v_requested,v_suppressed from public.marketing_campaign_recipients where operation_id=p_operation_id;
  v_audit:=public.record_marketing_campaign_audit(p_operation_id,p_actor_user_id,p_preview_hash,'failed','MARKETING_CAMPAIGN_PROVIDER_FAILED',p_error_code,v_requested,v_batch.eligible_count,v_suppressed,v_batch.eligible_count);
  update public.marketing_campaign_operations set status='failed',audit_id=v_audit,updated_at=v_now where id=p_operation_id;
  return public.marketing_campaign_receipt(p_operation_id);
end; $$;

create or replace function public.finalize_marketing_campaign_batch(p_operation_id uuid,p_batch_id uuid,p_actor_user_id uuid,p_preview_hash text,p_accepted_user_ids uuid[])
returns jsonb language plpgsql security definer set search_path = public,pg_catalog as $$
declare v_operation public.marketing_campaign_operations%rowtype; v_batch public.marketing_campaign_batches%rowtype; v_requested integer:=0; v_sent integer:=0; v_suppressed integer:=0; v_failed integer:=0; v_audit uuid; v_status text; v_now timestamptz:=pg_catalog.clock_timestamp();
begin
  perform public.assert_marketing_service_role();
  if coalesce(array_length(p_accepted_user_ids,1),0)>100 or coalesce(array_length(p_accepted_user_ids,1),0)<>(select count(distinct user_id) from unnest(coalesce(p_accepted_user_ids,'{}'::uuid[])) accepted(user_id)) then raise exception 'marketing_provider_result_invalid'; end if;
  select * into v_operation from public.marketing_campaign_operations where id=p_operation_id for update;
  select * into v_batch from public.marketing_campaign_batches where id=p_batch_id and operation_id=p_operation_id for update;
  if not found or v_operation.actor_user_id<>p_actor_user_id or v_operation.preview_hash<>p_preview_hash or v_batch.status<>'prepared' then raise exception 'marketing_batch_not_found'; end if;
  if exists(select 1 from unnest(coalesce(p_accepted_user_ids,'{}'::uuid[])) accepted(user_id) where not exists(select 1 from public.marketing_campaign_recipients r where r.operation_id=p_operation_id and r.user_id=accepted.user_id and r.status='eligible')) then raise exception 'marketing_provider_result_invalid'; end if;
  insert into public.notifications(user_id,type,title,message,data,classification,channel,consent_event_id,retention_class,campaign_operation_id,delivered_at)
  select r.user_id,'marketing_campaign',v_operation.title,v_operation.message,v_operation.data,'marketing',v_operation.channel,r.consent_event_id,'notifications_operational',p_operation_id,v_now from public.marketing_campaign_recipients r where r.operation_id=p_operation_id and r.status='eligible' and r.user_id=any(coalesce(p_accepted_user_ids,'{}'::uuid[])) on conflict (campaign_operation_id,user_id) where campaign_operation_id is not null do nothing;
  update public.marketing_campaign_recipients set status=case when user_id=any(coalesce(p_accepted_user_ids,'{}'::uuid[])) then 'sent' else 'failed' end,updated_at=v_now where operation_id=p_operation_id and status='eligible';
  select count(*)::integer,count(*) filter(where status='sent')::integer,count(*) filter(where status='suppressed')::integer,count(*) filter(where status in ('failed','eligible','pending'))::integer into v_requested,v_sent,v_suppressed,v_failed from public.marketing_campaign_recipients where operation_id=p_operation_id;
  v_status:=case when v_failed=0 then 'applied' else 'partial' end;
  v_audit:=public.record_marketing_campaign_audit(p_operation_id,p_actor_user_id,p_preview_hash,v_status,case when v_status='applied' then 'MARKETING_CAMPAIGN_APPLIED' else 'MARKETING_CAMPAIGN_PARTIAL' end,null,v_requested,v_sent+v_failed,v_suppressed,v_failed);
  update public.marketing_campaign_batches set status='completed',completed_at=v_now where id=p_batch_id;
  update public.marketing_campaign_operations set status=v_status,audit_id=v_audit,updated_at=v_now where id=p_operation_id;
  return public.marketing_campaign_receipt(p_operation_id);
end; $$;

revoke all on table public.notifications from public, anon, authenticated;
grant select on table public.notifications to authenticated;
grant all on table public.notifications to service_role;
revoke all on table public.marketing_campaign_operations from public, anon, authenticated;
revoke all on table public.marketing_campaign_recipients from public, anon, authenticated;
revoke all on table public.marketing_campaign_batches from public, anon, authenticated;
grant all on table public.marketing_campaign_operations, public.marketing_campaign_recipients, public.marketing_campaign_batches to service_role;

revoke all on function public.assert_notification_content_safe(text,text,jsonb), public.assert_marketing_service_role(), public.is_marketing_night_window(timestamptz,text), public.evaluate_marketing_permission_state(text,boolean,boolean,timestamptz,text), public.evaluate_notification_marketing_permission(uuid,text,timestamptz,text), public.record_marketing_campaign_audit(uuid,uuid,text,text,text,text,integer,integer,integer,integer), public.marketing_campaign_receipt(uuid), public.preview_marketing_campaign(uuid,text,uuid[],text,text,jsonb,text,timestamptz), public.prepare_marketing_campaign_batch(uuid,uuid,text,text,integer,text), public.fail_marketing_campaign_batch(uuid,uuid,uuid,text,text), public.finalize_marketing_campaign_batch(uuid,uuid,uuid,text,uuid[]) from public, anon, authenticated;
revoke all on function public.create_user_notification(uuid,text,text,text,jsonb), public.mark_notification_read(uuid), public.mark_all_notifications_read(), public.delete_notification(uuid) from public, anon;
grant execute on function public.create_user_notification(uuid,text,text,text,jsonb), public.mark_notification_read(uuid), public.mark_all_notifications_read(), public.delete_notification(uuid) to authenticated;
grant execute on function public.assert_notification_content_safe(text,text,jsonb), public.assert_marketing_service_role(), public.is_marketing_night_window(timestamptz,text), public.evaluate_marketing_permission_state(text,boolean,boolean,timestamptz,text), public.evaluate_notification_marketing_permission(uuid,text,timestamptz,text), public.record_marketing_campaign_audit(uuid,uuid,text,text,text,text,integer,integer,integer,integer), public.marketing_campaign_receipt(uuid), public.preview_marketing_campaign(uuid,text,uuid[],text,text,jsonb,text,timestamptz), public.prepare_marketing_campaign_batch(uuid,uuid,text,text,integer,text), public.fail_marketing_campaign_batch(uuid,uuid,uuid,text,text), public.finalize_marketing_campaign_batch(uuid,uuid,uuid,text,uuid[]) to service_role;

-- Revoke every historic broadcast helper overload without dropping server-only code.
do $$ declare v_function regprocedure; begin
  for v_function in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('create_admin_announcement_notification','create_new_restaurant_notification','create_ranking_notification','create_batch_new_restaurants_notification') loop
    execute format('revoke all on function %s from public, anon, authenticated',v_function);
  end loop;
end $$;
