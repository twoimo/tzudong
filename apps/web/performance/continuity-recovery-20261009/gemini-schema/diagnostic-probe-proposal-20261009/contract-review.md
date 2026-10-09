# Interactions contract review

Reviewed offline on 2026-10-09. No provider request was made. The request
shapes below are derived from pinned source and hash-checked local
reconstruction; no historical raw request body or diagnostic text was
recovered.

## Current official contract

The current beta API reference documents `POST /v1beta/interactions`, lists
`gemini-3.8-flash`, accepts string or content input, and defines a text content
block as `{ "type": "text", "text": string }`. `TextResponseFormat` requires
`type: "text"`; `mime_type: "application/json"` permits a `schema` object.
`generation_config.max_output_tokens` is an optional integer and `store` is an
optional boolean.

The structured-output guide separately documents these schema features used by
the expanded adapter schema:

- types: `string`, `number`, `integer`, `boolean`, `object`, and `array`;
- object: `properties`, `required`, and `additionalProperties`;
- string and numeric `enum`;
- numeric `minimum` and `maximum`;
- array `items` and `maxItems`;
- `description`.

Numeric enum is explicitly documented and is not classified as unsupported.
The guide also contains a recursive example using `{"$ref":"#"}`. Its
explicit keyword list does not define the accepted range of arbitrary local
JSON Pointer references such as `#/properties/claims`. That boundary remains
unresolved. The guide warns that very large or deeply nested schemas may be
rejected but publishes no byte, node, resolved-graph, or depth threshold.

Official sources:

- https://ai.google.dev/api/interactions-api
- https://ai.google.dev/gemini-api/docs/structured-output
- https://ai.google.dev/gemini-api/docs/interactions-breaking-changes-may-2026

## Pinned construction

Pinned `claude-video` 0.3.2 at
`03ceb42f7fa2c4439aca01752118044baabffb8f` sets the endpoint to
`https://generativelanguage.googleapis.com/v1beta/interactions`. Its base
`ask()` sends `model`, a video content block, and a text content block. For a
clipped video it sends `processing` as the documented static object with
`type`, `start_offset`, and `end_offset`.

The project adapter constructs the request submitted by its interception. It
adds the top-level text `response_format` with JSON MIME type and schema, plus
`generation_config.max_output_tokens`. Its production video payload omits
`store`; the reference makes `store` optional. The synthetic probes explicitly
sent `store: false`. The adapter sends no `Api-Revision` header. The current
reference does not require one; the migration guide describes that header as a
temporary opt-in before the May 2026 transition.

The base pinned engine does not itself add `response_format` or
`generation_config`; the adapter intentionally replaces that generated request
with its own canonical structured payload before the Interactions POST. This is
a source-level distinction, not an observed contract violation.

## Field comparison

| Field | Rejected synthetic request | Current contract | Finding |
| --- | --- | --- | --- |
| Endpoint | `/v1beta/interactions` | beta endpoint | match |
| Model | `gemini-3.8-flash` | listed model | match |
| Input | one text content block | supported content form | match |
| `response_format.type` | `text` | required text discriminator | match |
| `mime_type` | `application/json` | supported text MIME type | match |
| `schema` | object | optional JSON schema object | match at container level |
| `generation_config.max_output_tokens` | `65536` | optional integer | type/placement match; reference gives no model-specific bound |
| `store` | `false` | optional boolean | match |
| Numeric enum | used | explicitly supported | match |
| `additionalProperties: false` | used | boolean supported | match |
| Local `$ref` | nonrecursive JSON Pointers | root `$ref` example exists | arbitrary pointer coverage unresolved |
| Schema complexity | 5,335-byte expanded and 2,004-byte factored forms rejected | large/deep schemas may be rejected | threshold unresolved |

The no-schema control completed with the same model, input, `store: false`, and
`max_output_tokens: 65536`. The expanded schema and factored schema requests
both returned HTTP 400. The bounded diagnostic exposed only the official code
`invalid_request`, with no field path or schema keyword. This evidence isolates
the response schema as necessary to the observed rejection but does not select
one keyword or constraint as the cause.

## Conclusion

No definite endpoint, response-format container, model, MIME type, input type,
or documented schema-keyword mismatch was found. The correct retained state is:

`official docs vs exact rejected request unresolved`

Production adoption and schema acceptance remain false. Schema deletion, model
or provider fallback, and another provider call are outside this review.
