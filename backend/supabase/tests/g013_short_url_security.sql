-- G013 adversarial database contracts. Run after 20260713000100_g013_short_url_security.sql
-- against a disposable Supabase database. Fixtures are rolled back at the end.
-- Alternating calls below model two workers sharing one atomic (scope, bucket) counter.

BEGIN;

SELECT pg_catalog.set_config('request.jwt.claim.role', 'service_role', true);

DO $$
DECLARE
  v_ip_limit integer;
  v_allowed boolean;
  v_retry_after integer;
  v_call integer;
  v_restaurant_id uuid;
  v_allocation record;
BEGIN
  SELECT policies.max_requests
    INTO v_ip_limit
    FROM shortener_private.short_url_rate_limit_policies AS policies
   WHERE policies.scope = 'ip';

  IF v_ip_limit <> 20 THEN
    RAISE EXCEPTION 'G013 expected immutable IP policy of 20 per window';
  END IF;

  DELETE FROM shortener_private.short_url_rate_limit_counters;

  -- Worker A would make odd calls and worker B even calls; both share this DB key.
  FOR v_call IN 1..v_ip_limit LOOP
    SELECT limits.allowed, limits.retry_after_seconds
      INTO v_allowed, v_retry_after
      FROM shortener_private.consume_short_url_rate_limit(
        'ip',
        'ip:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
        pg_catalog.clock_timestamp()
      ) AS limits;

    IF NOT v_allowed OR v_retry_after <> 0 THEN
      RAISE EXCEPTION 'G013 rejected request % before the shared ceiling', v_call;
    END IF;
  END LOOP;

  SELECT limits.allowed, limits.retry_after_seconds
    INTO v_allowed, v_retry_after
    FROM shortener_private.consume_short_url_rate_limit(
      'ip',
      'ip:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
      pg_catalog.clock_timestamp()
    ) AS limits;

  IF v_allowed OR v_retry_after < 1 THEN
    RAISE EXCEPTION 'G013 did not reject the first request over the shared ceiling';
  END IF;

  -- TTL expiry resets the shared counter without any process-local clock or Map.
  INSERT INTO shortener_private.short_url_rate_limit_counters AS counters (
    policy_scope, bucket_key, window_started_at, request_count, expires_at
  ) VALUES (
    'ip',
    'ip:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff',
    pg_catalog.clock_timestamp() - interval '2 hours',
    999,
    pg_catalog.clock_timestamp() - interval '1 hour'
  )
  ON CONFLICT (policy_scope, bucket_key) DO UPDATE
     SET window_started_at = EXCLUDED.window_started_at,
         request_count = EXCLUDED.request_count,
         expires_at = EXCLUDED.expires_at;

  SELECT limits.allowed, limits.retry_after_seconds
    INTO v_allowed, v_retry_after
    FROM shortener_private.consume_short_url_rate_limit(
      'ip',
      'ip:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff',
      pg_catalog.clock_timestamp()
    ) AS limits;

  IF NOT v_allowed OR v_retry_after <> 0 THEN
    RAISE EXCEPTION 'G013 did not reset an expired bucket atomically';
  END IF;

  SELECT restaurants.id
    INTO v_restaurant_id
    FROM public.restaurants AS restaurants
   ORDER BY restaurants.id
   LIMIT 1;

  IF v_restaurant_id IS NULL THEN
    RAISE EXCEPTION 'G013 requires one restaurant fixture';
  END IF;

  DELETE FROM shortener_private.short_url_rate_limit_counters;

  -- Target races return the first allocation; the unique target constraint admits one row.
  SELECT *
    INTO v_allocation
    FROM public.allocate_short_url(
      '/?review=11111111-1111-4111-8111-111111111111',
      v_restaurant_id,
      '11111111-1111-4111-8111-111111111111'::uuid,
      'unknown',
      ARRAY['Race01', 'Race02', 'Race03', 'Race04', 'Race05']::text[]
    );

  IF v_allocation.code <> 'Race01' OR v_allocation.is_existing OR v_allocation.rate_limited OR v_allocation.allocation_failed THEN
    RAISE EXCEPTION 'G013 initial target allocation was incorrect';
  END IF;

  SELECT *
    INTO v_allocation
    FROM public.allocate_short_url(
      '/?review=11111111-1111-4111-8111-111111111111',
      v_restaurant_id,
      '11111111-1111-4111-8111-111111111111'::uuid,
      'unknown',
      ARRAY['Race06', 'Race07', 'Race08', 'Race09', 'Race10']::text[]
    );

  IF v_allocation.code <> 'Race01' OR NOT v_allocation.is_existing OR v_allocation.rate_limited OR v_allocation.allocation_failed THEN
    RAISE EXCEPTION 'G013 duplicate target allocation was not stable';
  END IF;

  IF (
    SELECT count(*)
      FROM public.short_urls AS short_urls
     WHERE short_urls.target_url = '/?review=11111111-1111-4111-8111-111111111111'
  ) <> 1 THEN
    RAISE EXCEPTION 'G013 target race created more than one row';
  END IF;

  -- A code collision consumes the next supplied CSPRNG candidate, not an unbounded retry.
  INSERT INTO public.short_urls (code, target_url, restaurant_id, restaurant_name)
  VALUES ('Coll01', '/?review=22222222-2222-4222-8222-222222222222', v_restaurant_id, NULL);

  SELECT *
    INTO v_allocation
    FROM public.allocate_short_url(
      '/?review=33333333-3333-4333-8333-333333333333',
      v_restaurant_id,
      '33333333-3333-4333-8333-333333333333'::uuid,
      'unknown',
      ARRAY['Coll01', 'Next02', 'Next03', 'Next04', 'Next05']::text[]
    );

  IF v_allocation.code <> 'Next02' OR v_allocation.is_existing OR v_allocation.rate_limited OR v_allocation.allocation_failed THEN
    RAISE EXCEPTION 'G013 did not retry exactly to the first free candidate';
  END IF;

  INSERT INTO public.short_urls (code, target_url, restaurant_id, restaurant_name)
  VALUES
    ('Cap001', '/?review=44444444-4444-4444-8444-444444444441', v_restaurant_id, NULL),
    ('Cap002', '/?review=44444444-4444-4444-8444-444444444442', v_restaurant_id, NULL),
    ('Cap003', '/?review=44444444-4444-4444-8444-444444444443', v_restaurant_id, NULL),
    ('Cap004', '/?review=44444444-4444-4444-8444-444444444444', v_restaurant_id, NULL),
    ('Cap005', '/?review=44444444-4444-4444-8444-444444444445', v_restaurant_id, NULL);

  SELECT *
    INTO v_allocation
    FROM public.allocate_short_url(
      '/?review=55555555-5555-4555-8555-555555555555',
      v_restaurant_id,
      '55555555-5555-4555-8555-555555555555'::uuid,
      'unknown',
      ARRAY['Cap001', 'Cap002', 'Cap003', 'Cap004', 'Cap005']::text[]
    );

  IF v_allocation.code IS NOT NULL OR v_allocation.is_existing OR v_allocation.rate_limited OR NOT v_allocation.allocation_failed THEN
    RAISE EXCEPTION 'G013 attempted more than five candidate collisions';
  END IF;
END;
$$;

-- Dirty duplicate rows are intentionally not inserted after migration: its preflight
-- must reject them before adding UNIQUE constraints, and the constraints prevent a
-- post-migration fixture. api-security-source.test.ts pins both failure messages.

ROLLBACK;
