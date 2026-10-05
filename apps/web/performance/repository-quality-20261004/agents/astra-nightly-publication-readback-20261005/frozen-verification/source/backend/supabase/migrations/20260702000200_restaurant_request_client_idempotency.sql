-- Add a narrow browser-safe idempotency key for 쯔양 맛집 제보 inserts.
-- The key lets the client recover from an ambiguous network response by
-- reading back the exact request it submitted, without treating unrelated
-- recent recommendations as success.

alter table public.restaurant_requests
  add column if not exists client_request_key text;

create unique index if not exists restaurant_requests_user_client_request_key_idx
  on public.restaurant_requests (user_id, client_request_key)
  where client_request_key is not null;

notify pgrst, 'reload schema';
