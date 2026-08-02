# Privacy-auth recovery runbook

## Purpose and release boundary

This runbook governs the observability and operational-recovery portion of the privacy-auth recovery release. It is a deployment gate, not evidence that a deployment, log drain, Datadog configuration, consent, age verification, guardian authorization, legal approval, or provider migration has occurred.

Only receipt-only eligibility may admit a user. Malformed, stale, mismatched, withdrawn, expired-guardian, or unavailable eligibility evidence fails closed. Roster work is classification-only and must not create or overwrite eligibility, profile, consent, age, guardian, or marketing facts.

## Configuration contract

Complete the following in the approved production organization; do not substitute similarly named resources.

| Item | Required value | Local configuration status | Required external proof |
| --- | --- | --- | --- |
| Vercel project and log-drain name | `privacy-auth-recovery-v1` | Not established by this runbook | Vercel project and drain configuration showing the exact name, destination, and successful delivery |
| Datadog log index | `vercel_privacy_auth_recovery` | Not established by this runbook | Datadog index configuration and a redacted event visible in that index |
| Datadog retention | 30 days | Not established by this runbook | Index retention setting or approved retention record |
| Credential reference | `OPERATOR-SUPPLIED: <least-privilege Vercel-to-Datadog credential reference>` | Placeholder only; no credential or receipt is present | Credential-manager reference, authorized scope review, and rotation owner; never paste a token into this document, shell history, Vercel, or Datadog evidence |
| Dashboard and saved query | `privacy-auth-recovery-v1` | Not established by this runbook | Dashboard URL/export and saved query result for the drain index |

The operator must configure the Vercel Log Drain named `privacy-auth-recovery-v1` to the approved Datadog HTTPS intake routed to `vercel_privacy_auth_recovery`. Do not record the intake URL with credentials. Configure 30-day retention on that index. Missing drain delivery, index, retention, dashboard/query, monitor, or notification-routing proof blocks deployment.

## Preflight gates

Before provisioning, injection, canary, or promotion, collect and attach references (not secrets or raw telemetry) for all of the following:

1. Privacy/legal approval for the current policy and the applicable DPA and retention terms for Datadog processing.
2. Platform on-call and Security on-call acknowledgement of monitor ownership, notification routes, escalation destination, and the 30-day retention setting.
3. Provider-owned G016/ledger/catalog terminal proof, current policy tuple, and a pinned compatible receipt-only fallback deployment. This runbook cannot replace those proofs.
4. An allowlisted server-event implementation only. Events may contain event name, UTC minute, build/commit, deployment ID, migration/manifest SHA, policy version/SHA, route class, provider, outcome/reason enum, correlation UUID, and approved opaque subject digest. Do not send raw email, user UUID, credentials, cookies, tokens, SQL, audit payloads, or other PII.

Hard stop immediately on source, ledger, catalog, policy, or retention/DPA mismatch; missing approval; unavailable provider; nonzero role membership; duplicate or unbound G016; unpinned fallback; absent drain proof; unsafe version pair; prohibited telemetry; or any proposal to weaken RLS, bypass authorization, or fabricate user facts.

## Dashboard and query

Create the dashboard and saved query named `privacy-auth-recovery-v1` using only `vercel_privacy_auth_recovery`. Scope panels to the recovery event allowlist and show, by deployment/build and route class:

- count of `42501` and privacy-audit-write-failure outcomes;
- catalog-drift and roster-conservation outcomes;
- authentication starts, failures, and failure rate, excluding `onboarding_required`;
- callback starts, failures, and failure rate, excluding `onboarding_required`;
- eligibility error and policy-drift rate, with an alerting review threshold of more than 0.5% over at least 20 checks;
- drain delivery and event-field redaction inspection results.

The saved query must preserve the denominator used for rates, exclude `onboarding_required` from auth and callback failure numerators, and group by opaque correlation only. Do not make a dashboard panel or query a substitute for a monitor receipt.

## Required monitors

Create exactly these six monitors with the listed names and thresholds. Attach Platform and Security on-call routing and retain a redacted monitor configuration/export as external proof. “Block” means no promotion; “hold” means pause promotion and investigate; “page” means page the assigned on-call route.

| Monitor | Condition | Required action |
| --- | --- | --- |
| `privacy-workflow-42501-v1` | Any privacy-workflow `42501` in a rolling 5-minute window | Page; block promotion and preserve redacted evidence. |
| `privacy-audit-write-failure-v1` | Any privacy-audit write failure in a rolling 5-minute window | Page; block promotion and preserve redacted evidence. |
| `privacy-catalog-drift-v1` | Any catalog-drift event | Block promotion; escalate for catalog/RLS/definer review. |
| `privacy-roster-conservation-v1` | Any roster count mismatch (classifications must sum to exactly 16) | Block promotion; do not repair by mutating eligibility or consent data. |
| `privacy-auth-failure-rate-v1` | Auth failure rate greater than 2% over 15 minutes with at least 20 auth starts; exclude `onboarding_required` | Hold promotion and investigate. |
| `privacy-callback-failure-rate-v1` | Callback failure rate greater than 2% over 15 minutes with at least 20 callback starts; exclude `onboarding_required` | Hold promotion and investigate. |

The dashboard query also requires review of eligibility-error or policy-drift rate greater than 0.5% with at least 20 eligibility checks. Treat a breach as a release hold and fail-closed eligibility condition; do not invent a seventh named monitor without separately approved scope.

## Redacted non-production injection procedure

Use a non-production project and non-production Datadog routing only. Never inject into production to validate alerting.

1. Confirm the non-production drain/index are isolated from production, the 30-day retention/DPA checks are recorded for the target, and the event emitter allowlist is deployed.
2. Generate one synthetic `42501` event and one synthetic catalog-drift event through the approved server-side event path. Use a new opaque test correlation value and enum-only fields; do not use a real user identifier, email, cookie, token, credential, SQL, or audit payload.
3. Verify in Vercel Runtime Logs that each event is structured and redacted, then verify delivery to the target Datadog index.
4. Verify the `privacy-auth-recovery-v1` dashboard/query renders both events, the matching monitors transition as configured, and Platform/Security on-call receive the expected test notification.
5. Capture redacted Vercel delivery, Datadog index/query, dashboard, monitor-state, and on-call-routing receipts. Mark them as non-production synthetic evidence.
6. Delete only the synthetic test correlation reference from working notes after evidence capture. Do not delete Datadog or Vercel records outside the approved retention process.

Injection failure, unredacted payload, missing delivery, missing alert, or misrouted notification blocks promotion. Correct configuration and repeat only the synthetic non-production procedure.

## Production promotion and stabilization

Promotion requires all external proofs in the checklist below; completed local configuration alone is insufficient. During controlled production canaries, validate password and Google outcomes, receipt/protected access, incomplete-user denial/onboarding, drain delivery, alert routing, and redaction. Do not treat an OAuth callback as proof of fresh identity and never delete, ban, or hold an OAuth identity based on callback timing or shape.

Maintain a 60-minute stabilization window after canary evidence begins. Any page, block, hold condition, missing receipt, or fail-closed eligibility error stops promotion.

## Evidence checklist

Record references, owners, timestamps, and redacted exports for:

- Vercel project and exact `privacy-auth-recovery-v1` drain configuration and delivery;
- Datadog organization, `vercel_privacy_auth_recovery` index, and 30-day retention proof;
- operator-supplied least-privilege credential-manager reference, scope review, and rotation owner (never the credential);
- DPA/retention approval and Platform/Security on-call acknowledgement and routing test;
- `privacy-auth-recovery-v1` dashboard and saved-query proof;
- all six monitor configurations, thresholds, state transitions, and notification receipts;
- redacted non-production `42501` and drift injection evidence;
- production canary evidence for password, Google, protected access, incomplete denial/onboarding, drain delivery, redaction, and 60-minute stabilization;
- immutable release, provider/ledger/catalog, policy, roster, and pinned fallback receipts required by the release gate.

Absence of any item is an unresolved external-proof gap, not a completed local configuration.

## Rollback and hard-stop boundaries

Do not bypass a failed gate to restore login. For canary, telemetry, dashboard, monitor, routing, DPA/retention, or redaction failure: halt promotion, retain redacted evidence, notify Platform and Security on-call, and use only the pinned compatible receipt-only fallback deployment.

Before or during failed G016, the provider rolls back its transaction and supplies terminal zero-membership readback; do not retry ambiguously. After G016, do not recreate roles, delete history, disable RLS/FORCE RLS, add an automatic successor, or use a direct/app/psql replay. Only a newly reviewed provider-owned forward remedy may proceed.

For policy or roster failure, stop or retry only idempotent classification; unsupported users remain gated. Never create eligibility, consent, age, guardian, or marketing state to clear an alert. Escalate source/ledger/catalog, RLS/definer, policy/legal, and telemetry issues to their designated owners before resuming promotion.
