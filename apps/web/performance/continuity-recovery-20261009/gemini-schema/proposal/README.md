# Gemini schema factor proposal

This is an offline proposal. It does not change the production adapter, send a
provider request, or modify the failed 835-second receipt.

## Evidence and scope

The plain text Interactions probe completed, the full 5,335-byte structured
schema probe returned HTTP 400, and the same high output limit completed after
`response_format` was removed. This isolates the required rejection condition
to the full schema representation. It does not identify a particular keyword,
numeric enum, or constraint as the cause.

Google's current structured-output guide includes local `$ref` in its recursive
schema example (`"$ref": "#"`). This proposal uses only non-recursive local
JSON Pointer references. It does not use `$defs`, external references, or
cycles: <https://ai.google.dev/gemini-api/docs/structured-output#recursive-structures>.

## Candidate

Eight repeated schema nodes are replaced by local references to existing schema
nodes. Every replacement is a `properties` field schema, and every reference is
smaller than the canonical JSON it replaces. `properties` maps and `required`
arrays remain concrete schema structures.

After those eight replacements, an exhaustive scan of the remaining eligible
`properties` field and `items` schema nodes finds zero repeated exact subtrees
whose local reference would be smaller. This is the minimum representation
under the declared no-`$defs`, existing-node, acyclic factoring rules.

The factored schema is 2,004 canonical bytes, 127 nodes, and depth 10. The
original is 5,335 bytes, 329 nodes, and depth 13. Resolving all references
produces 5,335 bytes, 329 nodes, depth 13, and the exact original SHA-256
`7168c8153f3922ebc33cfdd6f4a07e89e947374e5af882dc122bade3495a9efd`.
The accepted DTO, field names, required arrays, enum values, numeric bounds,
array limits, descriptions, and `additionalProperties` constraints are
therefore unchanged after expansion.

`fixture/factored-schema.json` is the exact candidate. Run:

```sh
python3 apps/web/performance/continuity-recovery-20261009/gemini-schema/proofs/verify_schema_factor.py
```

The verifier regenerates the production schema, checks every reference and
byte-saving condition, rejects external references and cycles, expands the
candidate, compares canonical bytes, and verifies the full request delta.

## Request and cache effects

For the unchanged `-D43ezc57z8` static interval 0–835, prompt, model,
media, processing, and `max_output_tokens=65536`, the current request is 8,011
canonical bytes with SHA-256
`121a7580dde9db30051ec8c05c63f843a478eb59ec9e6900e39f27bd11c8d331`.
Replacing only `response_format.schema` creates a 4,680-byte candidate request
with SHA-256
`bc0ef2b02c0827c6538350d04b8deefc29659f28d4faf40d54937e8a11f5d661`.
That is the prospective successful-request fingerprint if a separately
authorized provider probe accepts the reference representation.

No current cache identity changes because production source is untouched. If
this proposal is implemented later, the schema SHA, adapter source SHA,
configuration identity, receipt path, and request fingerprint will change even
though the expanded DTO contract is identical. Existing successful paid cache
entries must remain protected until an explicit source-compatibility rule is
reviewed; expanded-schema equality alone must not silently trigger paid work or
admit a differently fingerprinted response.

The failed 835-second receipt remains immutable and readback-required. It has no
response ID and its stored request fingerprint belongs to the rejected full
schema request. A later accepted candidate must use a newly authorized bounded
manual-repair batch whose lineage records the new destination identity and
request fingerprint. It must not overwrite, retry, or reclassify the old
receipt in place.

The existing result validator, prompt, model, media, limits, cache policy, and
old receipts are unchanged. API acceptance of these local references is not
proved offline; that requires a separately authorized single provider probe.
