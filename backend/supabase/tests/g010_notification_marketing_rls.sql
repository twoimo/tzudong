-- Run after the complete G010 foundation, notification, and retention migration chain.
-- Transactional: this fixture leaves no rows behind.
begin;

update privacy_retention.privacy_retention_classes
set
  data_class = 'privacy_marketing_audit',
  basis_code = 'test.operator_approved_marketing_audit',
  trigger_type = 'event_occurred',
  retention_period = interval '90 days',
  status = 'active',
  approved_evidence_ref = 'G010-TEST-MARKETING-AUDIT',
  version = 'test-v1'
where code = 'privacy_marketing_audit';

do $$
declare v_policy_count integer; v_definer boolean;
begin
  select count(*) into v_policy_count from pg_policies
   where schemaname='public' and tablename='notifications'
     and policyname in ('notifications_owner_select','notifications_owner_update','notifications_owner_delete');
  if v_policy_count<>3 then raise exception 'expected owner-only notification policies'; end if;
  if has_table_privilege('authenticated','public.notifications','INSERT')
    or has_table_privilege('authenticated','public.notifications','UPDATE')
    or has_table_privilege('authenticated','public.notifications','DELETE') then raise exception 'authenticated must not directly mutate notifications'; end if;
  if not has_table_privilege('authenticated','public.notifications','SELECT') then raise exception 'owner reads require select plus RLS'; end if;
  if has_function_privilege('authenticated','public.preview_marketing_campaign(uuid,text,uuid[],text,text,jsonb,text,timestamptz)','EXECUTE')
    or has_function_privilege('authenticated','public.prepare_marketing_campaign_batch(uuid,uuid,text,text,integer,text)','EXECUTE')
    or has_function_privilege('authenticated','public.finalize_marketing_campaign_batch(uuid,uuid,uuid,text,uuid[])','EXECUTE') then raise exception 'campaign RPCs must be service-role-only'; end if;
  if not has_function_privilege('authenticated','public.mark_notification_read(uuid)','EXECUTE')
    or not has_function_privilege('authenticated','public.mark_all_notifications_read()','EXECUTE')
    or not has_function_privilege('authenticated','public.delete_notification(uuid)','EXECUTE') then raise exception 'owner mark/delete RPCs are missing'; end if;
  select prosecdef into v_definer from pg_proc where oid='public.mark_notification_read(uuid)'::regprocedure;
  if coalesce(v_definer,false)=false then raise exception 'mark RPC must bind owner inside security definer'; end if;
end $$;

do $$
declare permission record;
begin
  select * into permission from public.evaluate_marketing_permission_state('email',false,true,'2026-07-12 21:00:00+09','Asia/Seoul');
  if permission.allowed or permission.reason_code<>'ordinary_consent_missing' then raise exception 'email requires ordinary consent'; end if;
  select * into permission from public.evaluate_marketing_permission_state('sms',true,false,'2026-07-12 20:59:00+09','Asia/Seoul');
  if not permission.allowed then raise exception '20:59 must not require separate SMS night consent'; end if;
  select * into permission from public.evaluate_marketing_permission_state('sms',true,false,'2026-07-12 21:00:00+09','Asia/Seoul');
  if permission.allowed or permission.reason_code<>'night_consent_missing' then raise exception '21:00 must require separate SMS night consent'; end if;
  select * into permission from public.evaluate_marketing_permission_state('push',true,false,'2026-07-13 07:59:00+09','Asia/Seoul');
  if permission.allowed or permission.reason_code<>'night_consent_missing' then raise exception '07:59 must require separate push night consent'; end if;
  select * into permission from public.evaluate_marketing_permission_state('push',true,false,'2026-07-13 08:00:00+09','Asia/Seoul');
  if not permission.allowed then raise exception '08:00 must not require separate push night consent'; end if;
  select * into permission from public.evaluate_marketing_permission_state('email',true,false,'2026-07-12 21:00:00+09','Asia/Seoul');
  if not permission.allowed then raise exception 'email may bypass only the separate night check'; end if;
end $$;

do $$
declare constraint_text text;
begin
  select pg_get_constraintdef(oid) into constraint_text from pg_constraint where conrelid='public.notifications'::regclass and conname='notifications_marketing_consent_check';
  if constraint_text is null
    or constraint_text not ilike '%classification%'
    or constraint_text not ilike '%transactional%'
    or constraint_text not ilike '%marketing%'
    or constraint_text not ilike '%consent_event_id%'
    or constraint_text not ilike '%channel%'
  then raise exception 'classification and consent linkage must be explicit'; end if;
end $$;
rollback;
