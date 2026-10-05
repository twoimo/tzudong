# Native Astra Xhigh independent review

- Source: `/Users/twoimo/.codex/worktrees/review-commit-recovery-20261004/tzudong`.
- Base: `4295fd54411ac8a4c304dce89efbb6f96e90935c`. Exact source hashes in `source-manifest.json`; tracked patch in `source.patch`; exact reviewed files retained under `source/`.
- Actual session: `01a10669-73d6-7f20-bce6-674c4de5d383`, provider `openai`, model `gpt-6-astra`, effort `xhigh`. Sanitized session_meta line 1 / turn_context line 6 in `model-metadata.json`. Opus upstream429 is not counted as a successful review.

## P2 — 같은 저장 작업의 재시도에서 삭제 스냅샷을 교체하지 마세요

`apps/web/components/reviews/ReviewModal.tsx:1426-1428` always overwrites `submittedDraftDeletionRef` on submit retries, including an already committed operation. Another same-owner/same-restaurant composer (including another tab) can save B after the original snapshot A. The first conditional cleanup correctly preserves B and displays draft-cleanup recovery. Retrying unchanged A captures B, while ReviewSaveOperation returns the existing saved outcome without another insert. clearDraft then deletes B. The newer, unsubmitted draft is lost.

Reproduction: snapshot(A) → insert(A) succeeds → other composer autosaves B → compare(A,B) rejects deletion → retry A in the original mounted composer → snapshot(B) → saved result from original operation → compare(B,B) → delete B. Measured: one insert, two uploads, one deletion, B absent.

Keep deletion authority tied to the original operation snapshot through retries. Distinguish a changed row from transient storage failure so that a newer draft can be preserved while completing the already-saved operation. A bare recapture on retry defeats the compare/delete guard.

## Verification and limits

Source stays read-only. Task-owned `scratch/cleanup-retry.test.ts` executes the actual extracted submit/clearDraft/prepareDraftDeletion handlers, actual persisted-row validator, actual ReviewSaveOperation and Supabase adapter with synthetic local transports. IDB requests are simulated deterministically; this is not a second browser/real-IDB probe. The fixture corrects the parent's constant currentOwner closure to follow saveOwnerRef.

Final reproduction: 6 control cases pass, 1 intended regression assertion fails. Raw output in `repro-output.txt`; structured event ordering in `repro-results.json`. Controls cover known-success unmount and owner change; preservation of newer drafts after original unmount; unanswered insert on unmount; snapshot failure; delete failure retry without a duplicate insert.

The original PR3112 known-success-after-unmount path is repaired under available storage: ownerRef becoming undefined no longer skips the scoped cleanup. The newly captured closure stays bound to the old owner/key. Atomic get/compare/delete share one readwrite transaction in source. A newer row after capture, absent-key replacement, and changed timestamps are rejected. No new persisted fields/media/IDs/TTL were introduced. Unknown outcomes retain draft/photos; durable idempotency across restart is outside scope.

Reviewed related controller, autosave/load/close handlers, owner-keyed composer boundary, and home/feed/map modal callers. The parent-reported 113 unit plus 8 real-IDB results were not used as proof. No full suite, duplicate browser probe, phone, auth storage, remote writes, lint or parity execution was performed here; parent owns the latter source-delivery checks.

Run only the local reproduction from the source apps/web directory:

```sh
/Users/twoimo/.bun/bin/bun test /Users/twoimo/.codex/worktrees/marker-memory-lifetime-20261001/tzudong/apps/web/performance/repository-quality-20261004/agents/astra-commit-recovery/scratch/cleanup-retry.test.ts
```

No additional reproducible P1/P2 identified in the reviewed paths.
