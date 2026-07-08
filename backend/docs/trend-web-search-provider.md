# Trend web search provider contract

Package E defines the v1 live web-search contract for trend automation. The contract is intentionally narrow: Google Programmable Search JSON API (`google_cse`) is the only v1 live provider. Do not add inline Next crawling, generic web search, raw page fetching, scoring crawlers, or alternate live providers in v1.

## Runtime behavior

- Default state: `TREND_WEB_SEARCH_ENABLED=0` or an unset value disables live web search. This is non-fatal and must surface the diagnostic reason `web_search_disabled`.
- Enabled without credentials: when live search is enabled but `GOOGLE_CSE_API_KEY` or `GOOGLE_CSE_CX` is missing, dry-run remains non-fatal and must surface `web_search_provider_missing`.
- Provider: `TREND_WEB_SEARCH_PROVIDER` must be `google_cse` for v1 live calls. Unknown providers are configuration errors, not fallback providers.
- Automation writes proposals only. It must not write approved overlays; proposal approval remains unimplemented until Package I.

## Environment variables

| Variable | Purpose |
| --- | --- |
| `TREND_WEB_SEARCH_PROVIDER` | Live provider id. V1 supports only `google_cse`. |
| `TREND_WEB_SEARCH_ALLOWED_DOMAINS` | Comma-separated allowlist overriding the default domains below. |
| `TREND_WEB_SEARCH_MAX_QUERIES_PER_RUN` | Hard cap on rendered Google CSE queries per run. |
| `TREND_WEB_SEARCH_MAX_RESULTS_PER_QUERY` | Hard cap on stored CSE result items per query. |
| `TREND_WEB_SEARCH_TIMEOUT_MS` | Per-request timeout for Google CSE JSON API calls. |
| `TREND_WEB_SEARCH_FIXTURE_PATH` | JSON fixture path used by dry-run/offline tests instead of live CSE calls. |

Google CSE credentials are read from `GOOGLE_CSE_API_KEY` and `GOOGLE_CSE_CX` only when live search is enabled.

## Default allowlist domains

Package E default domains are Korean/Tzudong-context friendly public sources plus YouTube context:

- `korean.visitkorea.or.kr`
- `www.korea.net`
- `www.mafra.go.kr`
- `www.kma.go.kr`
- `www.nongsaro.go.kr`
- `www.foodsafetykorea.go.kr`
- `www.mcst.go.kr`
- `www.youtube.com`

Results whose `displayLink` or normalized host is outside the effective allowlist must be discarded before proposal material is assembled.

## Query template ids

V1 query templates are identified by stable ids:

- `seasonal_food_month_ko`
- `holiday_food_context_ko`
- `region_food_season_ko`
- `tzuyang_video_context_ko`
- `category_trend_context_ko`

Rendered queries should stay deterministic for the same parameters and should favor Korean terms where useful, for example seasonal foods, Korean holidays, region/city names, Tzuyang video context, and food-category trend context.

## Data and policy boundaries

- Use Google Programmable Search JSON API terms and quota limits; do not bypass CSE by scraping Google results or target pages.
- Do not fetch raw pages, raw HTML, full article bodies, or full video/page text in v1.
- No raw page fetch, no raw scraping, and no result body fetch are allowed in v1.
- Store only provider-returned title/link/snippet/displayLink metadata.
- Store only bounded CSE metadata needed for proposal drafting: `title`, `link`, `snippet`, and `displayLink`.
- Snippets must remain bounded to provider/result-card scope. Do not persist expanded page content under another field name.
- Fixture and dry-run data must follow the same storage boundary: no `html`, `body`, `content`, `raw`, or fetched-page fields.

## Fixture update process

`backend/fixtures/trend-web-search/google-cse-allowlist.fixture.json` is the deterministic Package E fixture for dry-run and source-contract tests.

When updating it:

1. Capture only Google CSE JSON API result metadata for approved template ids.
2. Preserve the fixture shape: `schemaVersion`, `provider`, `capturedAt`, and `queries[]`; each query has `templateId`, `renderedQuery`, `parameters`, and `response.items[]`.
3. Include at least one allowlisted result and at least one deliberate disallowed-domain result so Package F can prove discard behavior.
4. Remove any raw page content, full fetched bodies, or raw HTML before committing.
5. Keep timestamps and sample values deterministic unless intentionally refreshing the fixture.

For dry-run/offline use, point `TREND_WEB_SEARCH_FIXTURE_PATH` at this fixture. Live credentials are not required for fixture-backed dry-runs.