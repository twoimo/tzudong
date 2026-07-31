-- G013 extension: add durable budgets for Directions and sponsor analysis without rewriting G013.
-- The policy table is otherwise immutable; migration DDL holds an exclusive table lock while
-- the check and the two fixed policy rows are extended atomically.

BEGIN;

ALTER TABLE provider_budget_private.admin_provider_budget_policies
  DROP CONSTRAINT admin_provider_budget_policies_provider_check;

ALTER TABLE provider_budget_private.admin_provider_budget_policies
  ADD CONSTRAINT admin_provider_budget_policies_provider_check
    CHECK (
      provider IN (
        'naver_local_search',
        'naver_geocode',
        'youtube_metadata',
        'naver_directions',
        'openai_sponsor_analysis'
      )
    );

ALTER TABLE provider_budget_private.admin_provider_budget_policies
  DISABLE TRIGGER admin_provider_budget_policies_immutable;

INSERT INTO provider_budget_private.admin_provider_budget_policies (
  provider, actor_per_minute, global_per_minute, global_per_day
) VALUES
  ('naver_directions', 20, 200, 10000),
  ('openai_sponsor_analysis', 10, 100, 1000);

ALTER TABLE provider_budget_private.admin_provider_budget_policies
  ENABLE TRIGGER admin_provider_budget_policies_immutable;

COMMIT;

NOTIFY pgrst, 'reload schema';
