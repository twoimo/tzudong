-- One anonymous global admission row; no per-source/user identifiers or history.
create table public.app_web_vitals_ingest_budget (
  id smallint primary key check (id = 1),
  window_start timestamptz not null,
  accepted_count integer not null check (accepted_count between 1 and 180)
);
alter table public.app_web_vitals_ingest_budget enable row level security;
revoke all on public.app_web_vitals_ingest_budget from public, anon, authenticated;
grant select, insert, update on public.app_web_vitals_ingest_budget to service_role;

create function public.record_app_web_vitals_bounded(
  p_release text, p_device text, p_metric text, p_navigation text, p_bucket smallint
) returns boolean language plpgsql security invoker set search_path = '' as $$
declare granted smallint;
begin
  insert into public.app_web_vitals_ingest_budget(id,window_start,accepted_count)
  values(1,pg_catalog.date_trunc('minute',pg_catalog.statement_timestamp()),1)
  on conflict(id) do update
    set window_start=excluded.window_start,
        accepted_count=case when public.app_web_vitals_ingest_budget.window_start=excluded.window_start
          then public.app_web_vitals_ingest_budget.accepted_count+1 else 1 end
    where public.app_web_vitals_ingest_budget.window_start<excluded.window_start
       or (public.app_web_vitals_ingest_budget.window_start=excluded.window_start
           and public.app_web_vitals_ingest_budget.accepted_count<180)
  returning id into granted;
  if granted is null then return false; end if;
  perform public.record_app_web_vitals(p_release,p_device,p_metric,p_navigation,p_bucket);
  return true;
end;
$$;
revoke all on function public.record_app_web_vitals_bounded(text,text,text,text,smallint) from public, anon, authenticated;
grant execute on function public.record_app_web_vitals_bounded(text,text,text,text,smallint) to service_role;
notify pgrst,'reload schema';
