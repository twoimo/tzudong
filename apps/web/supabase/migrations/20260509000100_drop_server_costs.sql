-- Retire the server cost management table after removing the app/admin UI.
-- This table is no longer referenced by the web app or backend code.
drop table if exists public.server_costs;
;
