# Draft: Interactions structured-schema `invalid_request`

Status: private draft only. Do not publish or send without separate approval.
No credentials, headers, response body, diagnostic message, response ID, or
generated text are included.

## Summary

On the beta Interactions endpoint, `gemini-3.8-flash` completes a synthetic
text request when `response_format` is absent. Adding either of two equivalent
JSON response schemas returns HTTP 400 with the allowlisted code
`invalid_request`. The error exposed no safely validated field path or schema
keyword.

## Environment and invariant request fields

- Endpoint: `POST https://generativelanguage.googleapis.com/v1beta/interactions`
- Model: `gemini-3.8-flash`
- Input: one benign no-media text content block
- `generation_config.max_output_tokens`: `65536`
- `store`: `false`
- No video, tools, cache, history, streaming, or redirects

The exact input text is represented by SHA-256
`81377b15578f67767fab3a8b4a72cede12c75a83544f103109ca4b437a4f671b`.
This draft is based on source-derived, hash-checked reconstruction, not a
recovered historical wire body.

## Observations

1. Without `response_format`: HTTP 200 and completed.
2. With the expanded schema: HTTP 400.
   - schema canonical bytes: `5335`
   - schema SHA-256: `7168c8153f3922ebc33cfdd6f4a07e89e947374e5af882dc122bade3495a9efd`
3. With the locally factored equivalent schema: HTTP 400.
   - schema canonical bytes: `2004`
   - schema SHA-256: `d72c43afe8d12d0a85a815d8ec70ce107dc40e0bc97d2dfbedfeaf6065846953`
   - request canonical bytes: `2553`
   - request SHA-256: `a9dcf0aa926e214d3b7d0e91e35e7ea1c575086c4b2ed04d87b4ca19335587ae`
   - sanitized code: `invalid_request`
   - sanitized field path and keyword: unavailable

The factored schema fixture is
`../fixture/factored-schema.json`. Its `$ref` nodes have no siblings, are
nonrecursive, and resolve to the same canonical expanded schema. This local
proof does not establish provider acceptance.

## Secret-free request outline

```json
{
  "model": "gemini-3.8-flash",
  "input": [{"type": "text", "text": "<benign no-media synthetic prompt>"}],
  "response_format": {
    "type": "text",
    "mime_type": "application/json",
    "schema": "<attach factored-schema.json as this object>"
  },
  "generation_config": {"max_output_tokens": 65536},
  "store": false
}
```

## Questions for the provider

1. Which documented or enforced JSON-schema condition rejects this request?
2. Does Interactions support nonrecursive local JSON Pointer `$ref` values that
   target existing property schemas, or only the documented root `"#"` form?
3. Is schema complexity calculated after resolving refs, and are there current
   node, state, depth, or constraint limits that are absent from the guide?
4. Can the API return a stable machine field path or fixed reason code for this
   `invalid_request` without relying on the human-readable message?

No claim is made that numeric enum or any other individually documented field
is unsupported. No production request or video should be used to reproduce the
issue.
