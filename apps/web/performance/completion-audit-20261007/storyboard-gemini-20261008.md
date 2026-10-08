# Gemini storyboard execution

This change removes the remaining non-Gemini storyboard producer paths while preserving stored documents, vectors, scene assets and queue records. The shared thumbnail bridge and pure parser/OS sandbox behavior remain separately tested.

RAG now uses the official `gemini-embedding-001` REST contract, 1024 dimensions and L2 normalization. A model/configuration fingerprint separates new vectors from existing BGE vectors. Old documents remain accessible by content without comparing their old vectors to Gemini vectors. The legacy keyword candidate window is bounded at 200 rows; equivalent semantic recall is **unproven**. Candidate ranking uses Gemini embedding cosine rather than the old cross-encoder, so its quality also requires an independent evaluation.

The worker shares the crawler's `ProjectBudget` state and project scope. Lease/pacing and SQLite waits respect the operation deadline; 429 `Retry-After` advances the shared cooldown. There is no automatic resend or alternate-provider fallback after a lost response.

| Check or measurement | Result | Interpretation |
|---|---|---|
| Retired CLI paths | 8 refuse before provider/config/file work | Existing names remain compatible as fixed refusals |
| Targeted active web checks | 74 pass, 0 fail | Fixtures and API contracts, not live service |
| RAG worker | 18 pass, 0 fail | Isolated SQLite/fake HTTP; original project venv unchanged |
| Legacy library checks | 143 pass, 8 platform skips, 0 fail | Skips are not passes; parser/thumbnail/sandbox coverage retained |
| Duplicate question embedding | 3 → 2 model calls per controlled search | −1 call, 33.33% reduction within the Gemini candidate |
| Rerank result in reuse experiment | Identical | Deterministic fixture, not provider quality evidence |
| Production bundle | Next.js 16.3.8 passed, 50 pages | Local build only |

The call count is deterministic, so a confidence interval does not apply. There are no new actual provider latency, token, monetary-saving or quality claims. Real paid provider calls, model downloads, operating DB writes, billing changes and deployments during this change: **0**.

The first whole-web run found an obsolete source assertion and seven mock-interference failures. The source contract now checks the retired execution boundary, and the RAG module mocks run in an isolated Bun process. The repeated whole-web check passed 3160 tests, skipped 9 prerequisites and failed 0 across 19 groups. Raw group diagnostics are retained separately.

The original project Python environment lacks FastAPI. The 18 worker checks use the isolated runtime `/Users/twoimo/.cache/uv/archive-v0/ndnlhaiCoNYGKgUz/bin/python` (Python 3.12.13, FastAPI 0.142.4, Pydantic 2.13.5); this is a test environment, not release-runtime proof. Model `gemini-3.8-flash` remains the configured caption model and was not silently replaced or invoked.

Real credited-project calls and billing attribution, independent retrieval quality, operating API/DB readback and deployment remain required. This is progress toward the full objective, not completion.
