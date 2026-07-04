alter table public.restaurant_submissions
  add column if not exists client_submission_key text;

create unique index if not exists restaurant_submissions_user_type_client_submission_key_idx
  on public.restaurant_submissions (user_id, submission_type, client_submission_key)
  where client_submission_key is not null;

create or replace function public.submit_restaurant_submission(
  p_user_id uuid,
  p_submission_type text,
  p_client_submission_key text,
  p_restaurant_name text,
  p_restaurant_address text,
  p_restaurant_phone text default null,
  p_restaurant_categories text[] default null,
  p_youtube_link text default null,
  p_tzuyang_review text default null
)
returns table(
  submission_id uuid,
  item_id uuid,
  user_id uuid,
  submission_type text,
  client_submission_key text,
  status text,
  restaurant_name text,
  restaurant_address text,
  restaurant_phone text,
  restaurant_categories text[],
  youtube_link text,
  tzuyang_review text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_submission_id uuid;
  v_item_id uuid;
begin
  if p_user_id is null then
    raise exception 'user_id is required' using errcode = '22023';
  end if;

  if p_submission_type <> 'new' then
    raise exception 'unsupported submission_type' using errcode = '22023';
  end if;

  if p_client_submission_key is null or btrim(p_client_submission_key) = '' then
    raise exception 'client_submission_key is required' using errcode = '22023';
  end if;

  insert into public.restaurant_submissions (
    user_id,
    submission_type,
    client_submission_key,
    status,
    restaurant_name,
    restaurant_address,
    restaurant_phone,
    restaurant_categories
  ) values (
    p_user_id,
    p_submission_type,
    p_client_submission_key,
    'pending',
    btrim(p_restaurant_name),
    btrim(p_restaurant_address),
    nullif(btrim(p_restaurant_phone), ''),
    p_restaurant_categories
  )
  on conflict (user_id, submission_type, client_submission_key)
    where client_submission_key is not null
  do nothing
  returning id into v_submission_id;

  if v_submission_id is not null then
    insert into public.restaurant_submission_items (
      submission_id,
      youtube_link,
      tzuyang_review
    ) values (
      v_submission_id,
      btrim(p_youtube_link),
      nullif(btrim(p_tzuyang_review), '')
    )
    returning id into v_item_id;
  else
    select rs.id
      into v_submission_id
      from public.restaurant_submissions rs
     where rs.user_id = p_user_id
       and rs.submission_type = p_submission_type
       and rs.client_submission_key = p_client_submission_key;

    select rsi.id
      into v_item_id
      from public.restaurant_submission_items rsi
     where rsi.submission_id = v_submission_id
     order by rsi.id asc
     limit 1;
  end if;

  return query
  select
    rs.id as submission_id,
    rsi.id as item_id,
    rs.user_id,
    rs.submission_type,
    rs.client_submission_key,
    rs.status,
    rs.restaurant_name,
    rs.restaurant_address,
    rs.restaurant_phone,
    rs.restaurant_categories,
    rsi.youtube_link,
    rsi.tzuyang_review
  from public.restaurant_submissions rs
  join public.restaurant_submission_items rsi
    on rsi.id = v_item_id
  where rs.id = v_submission_id;
end;
$$;

revoke all on function public.submit_restaurant_submission(uuid, text, text, text, text, text, text[], text, text)
  from public, anon, authenticated;
grant execute on function public.submit_restaurant_submission(uuid, text, text, text, text, text, text[], text, text)
  to service_role;
notify pgrst, 'reload schema';
