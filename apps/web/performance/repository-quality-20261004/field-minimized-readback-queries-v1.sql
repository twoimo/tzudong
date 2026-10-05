-- Read-only anonymous metric counts; no user/URL/body/id query.
select metric, sum(sample_count)::bigint as samples
from public.app_web_vitals_histogram group by metric order by metric;

select release_sha, device, metric, sum(sample_count)::bigint as samples
from public.app_web_vitals_histogram where observed_day >= date '2026-10-01'
group by release_sha, device, metric order by release_sha, device, metric limit 100;
