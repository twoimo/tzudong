-- Restrict public Data API restaurant reads to the same approved-only contract used by the web app.
-- Service-role admin/batch paths continue to bypass RLS; authenticated admin updates remain explicit.

alter table public.restaurants enable row level security;

revoke all on table public.restaurants from anon, authenticated;
grant select on table public.restaurants to anon, authenticated;
grant update on table public.restaurants to authenticated;

drop policy if exists "Enable read access for all users" on public.restaurants;
drop policy if exists "Enable update for admins" on public.restaurants;
drop policy if exists restaurants_public_approved_select on public.restaurants;
create policy restaurants_public_approved_select
  on public.restaurants
  for select
  to anon, authenticated
  using (status = 'approved');

drop policy if exists restaurants_authenticated_admin_update on public.restaurants;
create policy restaurants_authenticated_admin_update
  on public.restaurants
  for update
  to authenticated
  using (public.is_user_admin((select auth.uid())))
  with check (public.is_user_admin((select auth.uid())));

comment on policy restaurants_public_approved_select on public.restaurants
  is 'Public/browser Data API reads must match the approved-only map/dashboard contract.';
comment on policy restaurants_authenticated_admin_update on public.restaurants
  is 'Authenticated browser updates are limited to admins; service-role batch/admin APIs bypass RLS.';

notify pgrst, 'reload schema';
