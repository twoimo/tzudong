# Privacy and communications

Read for auth, consent, location, retention/deletion, notifications, or personal-data changes. These requirements also govern backend and tooling work that handles such data.

G010/G013/G014 source safeguards reduce risk but do not certify statutory compliance, policy publication, filing, deployment, or legal approval.

- Canonical privacy objects are `privacy_policy_versions`, `privacy_onboarding_challenges`, `privacy_age_profiles`, `privacy_guardian_verifications`, `privacy_consent_events`, the derived `privacy_consent_state` view, and append-only `privacy_audit_events`.
- Canonical RPCs include `get_current_privacy_policy_version`, `create_privacy_onboarding_challenge`, `confirm_privacy_onboarding`, `submit_privacy_consent`, and `record_privacy_guardian_verification`. Do not add fallback aliases.
- Account creation is challenge-bound to the exact published policy version, locale, content hash, and operator approval readback. Unsupported under-14 registration stays blocked until a verified guardian workflow is deployed and read back; do not collect a date of birth, guardian contact, or resident registration number as a workaround.
- Ordinary marketing consent is purpose- and channel-specific. Advertising between 21:00 and 08:00 requires the separate `night_marketing` decision for the same channel. Transactional notifications must not silently become advertising.
- `apps/web/lib/privacy/sanitize.ts` is the shared privacy assertion/redaction boundary. Never log or persist passwords, credentials, cookies, session/onboarding tokens, email addresses, phone numbers, resident registration numbers, precise location, raw OCR, arbitrary request bodies, provider diagnostics, or free-form errors.
- Device location requires a just-in-time disclosure, remains memory-only, and must stop its watcher on cancellation/unmount. Stored restaurant/business coordinates are a separate contract.
- Account deletion and retention operations remain fail closed: recent reauthentication, exact typed confirmation, stable preview hash, readback, append-only minimized audit, legal-hold/last-admin checks, session revocation, database cleanup, and Auth deletion last.
- Retention periods and legal bases come only from active operator-approved classes. Code must not invent periods. Applied Supabase migrations are immutable; add a new migration for a correction.
- Privacy incident handling records bounded detection/decision/notice/receipt state under one operation ID. A named human determines and performs any authority or subject notification; source code must not claim that a filing was submitted or accepted.
