# Runtime audit — 2026-09-21

Scope: current source at 985966de and read-only local Postgres inspection on tzudong-local-93b7ce882ecb. Earlier generation/export reports are historical evidence, not newly executed tests.

## Current observations

- Storyboard project: revision 25, ready.
- Jobs: succeeded 5, failed 1; no queued or claimed jobs.
- Worker: enabled, not revoked, heartbeat age 0 seconds at query time. Do not restart an active worker based on an old handoff.
- Local feed: browser readback now shows the imported Daily Fix and Sushirin reviews. Live hosted connection remains under implementation review in continuation task 01a0bec9-7163-7ec0-b81b-2050c7c7e117.

## Newly identified verification gap

`apps/web/lib/admin/storyboard/outbound-worker.ts` defaults memory admission to Node RSS plus model-reported resident bytes and image buffer estimate. This does not include memory occupied by unrelated processes or the rest of the host. Consequently the check can admit work under system memory pressure even when its arithmetic unit tests pass. The resource equation is necessary but its runtime measurement is incomplete. Review host-wide available-memory measurement, model residency double-counting, missing residency estimates, and peak inference memory before claiming a safe memory admission policy.

`estimateStoryboardQueueWait` is only referenced by its unit tests in the current source search. Its formula is documented, but a live queue estimate is not integrated or established by this audit.

## Remaining completion evidence

- Direct hosted public-feed reads with genuine hosted author resolution and photo readback.
- Runtime memory-pressure behavior and a defensible peak inference estimate.
- GPS operator evidence and real permission/location flow.
- Requested model execution path for pending implementation and integration review.
- Hosted changes, deployment and protected promotion remain separate from local evidence.

Do not mark the full goal complete from this audit.

## Admission reproduction and delegation status

A direct Bun invocation of the current `admitStoryboardWorkerMemory` returned true for physical RAM 128 GiB, worker RSS 0.25 GiB and model residency 8 GiB. If unrelated processes occupy 120 GiB, admission must fail, but that usage is absent from the default measurement. This is an arithmetic reproduction, not a physical memory-pressure stress test.

The continuation task subsequently reported terminal `interrupted`; the next follow-up was rejected because the task is archived. No implementation result or actual ChatGPT Web xhigh execution was returned. The earlier execution was not running. Under the user's explicit request to continue this exact task, its archived state was subsequently cleared and one follow-up was dispatched. Actual requested-model availability and an implementation result remain unconfirmed. Hosted connection remains incomplete.
