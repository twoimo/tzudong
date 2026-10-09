# One-shot schema diagnostic proposal

This is an offline proposal. It does not authorize or perform a provider call.

The future request reproduces the exact rejected 2,553-byte factored-schema
payload so the only changed behavior is bounded in-memory error inspection.
This is a narrow diagnostic of the same synthetic request, not another schema
representation experiment. It never resends the failed 835-second video. It
does not establish acceptance or authorize production adoption. It keeps the prior
model, prompt, schema, output limit, `store: false`, shared budget namespace,
RPM 1, concurrency 1, one POST, no redirects, no retry, and no readback.
Google's troubleshooting guide says client errors such as HTTP 400 should not
be retried, so automatic retry is explicitly disabled as well.

The sanitizer reads at most 64 KiB and returns only a bounded HTTP status, an
exact allowlisted error code, a fixed category, and an optional schema path.
It never returns the error message, body, headers, response ID, key, or values.
An optional path from `google.rpc.BadRequest.FieldViolation` is accepted only
when the detail type is exact and the path exists in the submitted schema.
The documented human message form is a fallback; it requires a fixed marker,
an exact quoted path, and the same submitted-schema membership check. Multiple
or unknown paths fail closed.

The current Interactions error contract documents a machine-readable
snake-case `error.code` plus a human-readable `message`. Google Common Protos
documents `BadRequest.FieldViolation.field` as a request-body path, but the
Interactions page does not promise that detail, so it remains optional. The
structured-output guide documents the accepted schema subset, numeric enum,
local `$ref` examples, and that very large or deeply nested schemas may be
rejected. Message-derived reason categories remain marker-based evidence, not
an assertion that a particular rejection cause is proven.

Official sources:

- https://ai.google.dev/gemini-api/docs/api-errors
- https://ai.google.dev/gemini-api/docs/troubleshooting
- https://ai.google.dev/gemini-api/docs/structured-output
- https://docs.cloud.google.com/php/docs/reference/common-protos/latest/Rpc.BadRequest.FieldViolation

Run the offline tests with:

```sh
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest -v test_sanitizer.py
```
