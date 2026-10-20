-- Anonymous root-document first-visible-window Web Vitals histograms only.
-- No user/session/metric IDs, URLs, IPs, UA, coordinates or raw event timestamps.
create table public.app_web_vitals_histogram (
  observed_day date not null,
  release_sha text not null check (release_sha ~ '^[a-f0-9]{40}$'),
  device text not null check (device in ('mobile','desktop')),
  metric text not null check (metric in ('CLS','INP','LCP')),
  navigation text not null check (navigation in ('navigate','reload','back-forward','back-forward-cache','prerender','restore')),
  bucket smallint not null check (bucket >= 0 and bucket <= case metric when 'CLS' then 100 when 'INP' then 200 else 120 end),
  sample_count bigint not null check (sample_count > 0),
  primary key (observed_day, release_sha, device, metric, navigation, bucket)
);
alter table public.app_web_vitals_histogram enable row level security;
revoke all on public.app_web_vitals_histogram from public, anon, authenticated;
grant select, insert, update on public.app_web_vitals_histogram to service_role;

create function public.record_app_web_vitals(
  p_release text, p_device text, p_metric text, p_navigation text, p_bucket smallint
) returns void language sql security invoker set search_path = '' as $$
  insert into public.app_web_vitals_histogram
    (observed_day, release_sha, device, metric, navigation, bucket, sample_count)
  values
    ((pg_catalog.statement_timestamp() at time zone 'UTC')::date, p_release, p_device, p_metric, p_navigation, p_bucket, 1)
  on conflict (observed_day, release_sha, device, metric, navigation, bucket)
  do update set sample_count = public.app_web_vitals_histogram.sample_count + 1;
$$;
revoke all on function public.record_app_web_vitals(text,text,text,text,smallint) from public, anon, authenticated;
grant execute on function public.record_app_web_vitals(text,text,text,text,smallint) to service_role;
comment on table public.app_web_vitals_histogram is 'Non-identifying daily counts of fixed value buckets; metric samples are not distinct users. First-visible-window root-document cohort, QA excluded client-side. No personal-data retention rule introduced.';

notify pgrst, 'reload schema';
