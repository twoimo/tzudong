# Storage deletion: local provider correction

The experimental provider correction passed all eight actual Storage HTTP/S3 scenarios. The earlier pinned unmodified runtime passed seven and failed the partial-S3 case. This is local correctness evidence, **not an official provider release, hosted correction, performance improvement, or full-goal completion**.

## Change and causal model

An S3 DeleteObjects request can return HTTP 200 with per-key `Errors`. The original v1.33.0 adapter discards the response; the current examined v1.80.1 adapter only checks rejected batch promises. Consequently the surrounding database transaction can commit metadata deletion while the physical object remains.

The prepared patches reject a nonempty or malformed `Errors` field with the fixed `S3_DELETE_PARTIAL_FAILURE` message. An entry without `Key` also rejects. No object keys, messages or complete provider responses are incorporated into this new error. The existing exception boundary propagates failure to the current transaction. Ordinary success, empty Errors, existing transport failures and each version's empty-input behavior remain covered. The newer patch waits for the original `allSettled` batch helper; it introduces no retry.

For the injected fault, the desired predicate is:

`provider failure → request failure ∧ current metadata retained ∧ cleanup unresolved`.

Metadata rollback does **not** restore physical deletions that already succeeded. The source also processes outer database batches separately, so an earlier batch may already be committed. These limitations require explicit result reconciliation and must not be described as whole-request rollback.

## Fixed scenario results

| Metric | Before | After | Absolute change | Interpretation |
| --- | ---: | ---: | ---: | --- |
| Passing physical contract scenarios | 7 / 8 | 8 / 8 | +1 scenario; +12.5 percentage points | Fixed scenario inventory, not population success probability |
| Injected partial-failure HTTP response | 200 | 500 | Failure propagated | Numerical status-code differences are not performance measures |
| Metadata present after the failed deletion | false | true | Required protection restored | Actual isolated database readback |
| Physical original photo count | 1 | 1 | 0 | Fault proxy left the photo untouched |
| Cleanup pending after the fault | false | true | False completion avoided | Actual record RPC readback |
| TUS `.info` / incomplete uploads after termination | 0 / 0 | 0 / 0 | 0 | Original photo preserved; termination 204 |

The eight scenarios ran once under the corrected runtime. A 95% confidence interval is inapplicable to the deterministic contract-case census; this experiment does not estimate a real-world error rate. The fault is a valid S3 protocol response injected by the owned proxy, not an observed hosted IAM failure.

- Actual publisher method bodies: **26 passed, 0 failed** with stubbed SDK responses, including key-less/malformed Errors, mixed outcomes, chunk ordering, a transport rejection and settlement of all started chunks.
- Existing admission/orchestration boundary plus the new experiment-rejection case: **16 passed, 0 failed, 90 assertions**.
- Pinned native/compatibility type parity and targeted ESLint: passed.

Two preparation attempts executed zero cases because a Node preload affected child startup. Their failed receipts remain intact. The successful fixture applies the patch once before executing the original server. The method runner initially rejected the compiler's deprecated `module=None` option; CommonJS fixed the runner without changing provider assertions.

## Runtime and evidence boundary

Base image: `supabase/storage-api@sha256:3e3742049427313d167578ba7af753069947972b64fcc5374cfb750f66a26177`.

Compiled adapter preimage: `bd03a1fa8083fc81504373af72cc2fdf858626417a63d0f9894bd080c2da40d1`.

Experimental compiled adapter: `50ecb8f6433b17e1d8ef3d053c828e0b8f873ab0400adf94ce46452673aaad58`.

The runtime is modified even though its underlying image is official. The receipt uses a separate schema, `providerModified=true`, `admissionEligible=false`, and `baseStorageImage` rather than claiming an official deployed image. A real admission test confirms that adding the base image field back cannot make this receipt eligible. Production admission and its failed evidence remain unchanged.

The exact unapplied record SQL hash remained `1529ad96ebbc2c8e173d5c51fae9bef8051ce632c829eda20f0ae173a77c8caa`. The fixture is scoped to its owned Colima socket, loopback HTTP, synthetic data and MinIO, with separate PG15 Storage/domain prerequisites. It is not a full G014 replay or an attestation of the operating PG17 database.

Examined official source: [Storage v1.80.1 adapter at ba73b08](https://github.com/supabase/storage/blob/ba73b08b9b94b1d53fb14c8b34970e7121d4f09b/src/storage/backend/s3/adapter.ts). Source patches and the runtime patch are prepared under `backend/supabase/tests/storage-provider-patches/` and `record_storage_s3_patch.cjs`.

The JSON report and detached SHA retain source hashes, settings, receipts, verification counts and limitations. Actual eight-case receipts remain in `backend/supabase/tests/record-storage-evidence/`. Task-owned containers/network were removed; the Storage profile was stopped afterward. Other profiles, the Docker default context, original files, hosted resources, billing and models were preserved.

## Remaining action

Confirm the actual hosted provider version and obtain a supported provider correction or a separately authorized owned runtime with its own immutable bindings. Repeat the exact physical contract there, reconcile multi-object partial outcomes, verify actual user flows/catalog compatibility and use the protected deployment sequence. The experimental local receipt must not enable operating media deletion.
