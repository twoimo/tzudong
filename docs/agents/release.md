# Hosted operations and release

Read before any Vercel action (including inspection), hosted DB mutations, producer/freeze changes, protected promotion, deployment/rollback, DNS, or security configuration. Existing explicit authorization for the same action and scope remains valid; do not ask again. Authorization does not substitute for the evidence below. A blocked release does not block independent local implementation, tests, or read-only diagnosis. For a read-only Vercel query, verify the exact project and sanitize evidence; production-release prerequisites apply when releasing, not when inspecting.

The dirty original worktree is immutable. Work only in an isolated recovery candidate; never reset, stash, or clean either worktree. Content patches start from a fresh head and move as serialized PRs `develop -> data -> main`, subject to external approval and branch protection.

A production release remains blocked until current external evidence proves all of the following:

- the exact policy version/hash/locale/effective/published tuple is published, approved, and deployed;
- retention classes have named operator approval, legal basis, trigger, period, activation, and hosted backup/PITR evidence;
- hosted production migrations, RLS/grants, RPC readback, generated Supabase types, catalog, key-management, and operator-access evidence match the deployed catalog;
- marketing delivery uses an approved HTTPS provider with production secrets and internal capability controls;
- location-business filing or documented non-applicability is externally confirmed;
- under-14 support, if enabled, uses an externally verified guardian provider;
- incident notices have named human approval and immutable submission/receipt evidence; and
- Korean legal/privacy-owner review is recorded.

Before any Vercel action, verify the exact Git-integrated `tzudong` project. Do not use a stale `web` project or mutate DNS. A release or rollback needs external approval, branch-protection evidence, a rollback plan, and deployment readback receipt. This source tree makes no claim that a merge or deployment occurred.

Do not fabricate these receipts, weaken fail-closed behavior, bypass branch protection, commit credentials, or claim that local tests prove legal compliance or hosted production state.
