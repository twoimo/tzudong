# Hosted operations and release

Read before any Vercel action (including inspection), hosted DB mutations, producer/freeze changes, protected promotion, deployment/rollback, DNS, or security configuration. Existing explicit authorization for the same action and scope remains valid; do not ask again. A blocked technical check does not block independent local implementation, tests, or read-only diagnosis. For a read-only Vercel query, verify the exact project and sanitize evidence.

The dirty original worktree is immutable. Work only in an isolated recovery candidate; never reset, stash, or clean either worktree. Content patches start from a fresh head and move as serialized PRs `develop -> data -> main` under branch protection. Tzudong has one operator, the GitHub repository owner. That person's explicit request is the operator approval. A second reviewer is not required, and this file must not invent one.

On 2026-09-22 the operator parked the external evidence gates for schema, RLS, grants, RPCs, hosted catalog and key management, retention periods, policy publication, marketing send approval, precise-location filing, under-14 guardian verification, incident submission receipts, and Korean privacy-owner review. They are not release blockers. The parked text is [2026-09-22-parked-external-gates.md](../archive/release-gates/2026-09-22-parked-external-gates.md). Restore that file before enforcing those gates again. Parking them does not enable the product features and does not create the missing evidence.

A production deploy still needs no force push, the protected PR order, a named rollback SHA taken from the current production deployment, and a post-deploy readback of the Vercel deployment SHA and live URL. Local tests are not that readback.

Before any Vercel action, verify the exact Git-integrated `tzudong` project. Do not use a stale `web` project or mutate DNS. This source tree makes no claim that a merge or deployment occurred.

Do not fabricate receipts, commit credentials, bypass branch protection, or claim that local tests prove legal compliance or hosted production state. Application code stays fail-closed for under-14 registration, precise device location, marketing send, and retention activation until the operator restores the parked gates and changes the product on purpose.
