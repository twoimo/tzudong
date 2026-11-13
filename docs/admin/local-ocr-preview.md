# Local receipt OCR preview

The administrator review workspace has a **파일 미리보기** panel. It provides temporary suggestions only. It does not create a review, verify a receipt, queue work, persist an image/result, or override the shared feature-readiness hold.

## Local macOS setup

Requirements: the pinned project Node/Bun dependencies, macOS Vision and `/usr/bin/swift` (Xcode Command Line Tools). Keep the normal administrator session/authentication checks enabled.

```sh
cd apps/web
OCR_PREVIEW_LOCAL_ENABLED=true npm run dev
# Or run a standalone, local-only preview:
bun scripts/preview-receipt-ocr.ts /absolute/path/receipt.png --timeout-ms 20000
```

The browser accepts JPG/PNG/WebP up to 3 MiB. The CLI accepts these formats up to 8 MiB. Images are validated, orientation-normalized and resized in memory. Native OCR is bounded by dimensions (8192 per edge, 24 million pixels), execution time, input/output bytes and recognized line count. Browser result state is cleared on close/unmount. CLI JSON goes to stdout; do not redirect real receipt suggestions into shared logs. Only synthetic test receipts belong in test artifacts.

`GET /api/admin/ocr-receipts/preview` reports the local opt-in, not proof that a native execution succeeds. `POST` authenticates the administrator, enforces same-origin requests, rejects unexpected keys, caps body bytes and admits only one local process per server process. It never accepts a client provider/cost switch. Production Linux reports local unavailable and never falls back to a cloud provider.

## Optional cloud adapters, disabled by default

Gemini and OpenAI adapters exist for explicit operator use. No cloud execution was used to validate this change. Unit tests inject fake transports.

- Gemini requires `--provider gemini --allow-free-cloud --attest-gemini-free` and the dedicated `GEMINI_OCR_FREE_API_KEY`. The legacy paid credits key is not used. The attestation is an operator assertion, not a check of Google's billing or remaining quota. Configure only a verified unbilled project and a model eligible for its current free tier. A limit or failure stops the attempt, with no retry, account switch or paid fallback.
- OpenAI requires `--provider openai --allow-paid-cloud` and `OPENAI_API_KEY`. It is not free merely because a ChatGPT subscription exists. The Responses payload uses `text.format`, `store:false`, a bounded output budget and no retries. Do not enable without separate paid-call authorization.
- Both transports have fixed provider origins, a 64 KiB streaming response cap, timeouts, cancellation and fixed error codes. Raw provider diagnostics and keys are never printed. Browser preview remains local-only regardless of these CLI options.

## Hosting limits and readiness

Apple Vision cannot execute in Vercel/Linux or Cloudflare Workers. Cloudflare Free's 10 ms CPU and 128 MB per invocation are not a viable native OCR runtime. A self-hosted Mac can run local previews without a model API charge, but hardware/electricity and any runner/hosting costs are separate. GitHub-hosted runner minutes and available macOS runners depend on the repository/account plan; no free hosted worker is assumed or provisioned here. Never upload private receipt artifacts into a public Actions run.

The hosted `get_feature_runtime_capability` gate remains separate. The local PG17 partial-baseline exercise proved held/unauthorized behavior only. Missing platform extensions and role/constraint dependencies prevented a faithful full migration-chain replay and activation check. No hosted readiness migration, worker activation, review write or production release was performed for this feature.

Reference limits (recheck before enabling):
- https://developers.cloudflare.com/workers/platform/limits/
- https://ai.google.dev/gemini-api/docs/pricing
- https://platform.openai.com/docs/guides/structured-outputs
