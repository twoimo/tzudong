-- Speed up AuthProvider bootstrap checks that load nickname setup and admin role state.
-- Supabase RLS performance guidance recommends indexing columns used by auth/RLS predicates;
-- these same columns are also used by the client auth state lookups.

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'profiles'
      and column_name = 'user_id'
  ) then
    execute 'create index if not exists profiles_user_id_idx on public.profiles (user_id)';
  end if;

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'user_roles'
      and column_name = 'user_id'
  ) and exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'user_roles'
      and column_name = 'role'
  ) then
    execute 'create index if not exists user_roles_user_id_role_idx on public.user_roles (user_id, role)';
  end if;
end $$;
