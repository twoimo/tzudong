# Cluster expansion image readiness delta (candidate, not released)

Baseline: main `1b5230ac93021c72499f4950bff6cda24e2515e5`, tree `6d522ae2c957e7f5d55caf4fbafbc7a284ba33d6`.
The prior release remains complete; this is a new performance task. Nightly 39457197351 remains a separate historical failure, not rerun.

## Question and alternatives

The previous production PC expansion had four rAF samples with up to 28 images not ready between 99.9 and 183.3 ms after the click. `complete && naturalWidth > 0` measures image readiness, not isolated decode work. No pure-decode or production improvement claim follows from that observation.

Rendered category pictures first request previously unseen images after insertion. Compare (A) a finite map-owned picture primer, beginning at map mount, with (B) waiting for per-expansion decode while retaining the old cluster. A avoids a new expansion/cancellation state machine and never delays interaction, but spends startup bandwidth and decode work, and is best effort under immediate interaction or memory pressure. B can guarantee prepared images but adds visible input latency, stale expansion/cancellation risks and more SDK ownership state. Select A for a narrow candidate experiment; do not reinstate the rejected direct DOM srcset fast path. Browser-selected WebP/PNG inventory is shared with visible pictures, at most 18 unique assets (85,402 source WebP bytes; actual wire bytes must be measured separately).

## Sequence and acceptance

1. Freeze baseline and source hashes. Reproduce first-transfer delay with the actual HTML generator and real browser images, separately measuring resource responseEnd, explicit decode promise latency, first visible image readiness and rAF gaps. Use the same controlled resource delay and initial-cluster-ready action point in both arms; no extra candidate warm-up wait.
2. Compare fresh browser profiles at 1440x1000, 390x844 and 820x1180, alternating arms, at least 6 pairs per size. Record all trials and failures. Controlled local fixture is mechanism evidence, not production SDK/field evidence.
3. Absolute local budget: no blank render-unit frame, all visible marker pictures ready within 250 ms of expansion, max 18 primer pictures, no duplicate WebP/PNG resource transfer per category, no post-unmount DOM write. Relative improvement budget: at least 30 ms and 25% lower median readiness delay per viewport. Noise budget: matched arm difference must exceed baseline MAD and one 60 Hz frame (16.7 ms); retain every sample. These are task-specific experiment budgets, not a G003 release improvement score.
4. Verify failure/unmount/unsupported-format selection, existing marker pool regressions, scoped lint and compiler parity. Measure startup transfer and decode costs as well as expansion results.
5. Actual ordinary Pro thesis -> Gemini maximum adversarial -> Pro reverse review for this material delta, with source/bundle receipts. Old formal reviews remain frozen and cover the original pool invariants only. Current shared admission has another owner's uncertain Gemini send and occupied Pro slot; preserve them. Local work is allowed; external validation/release remain incomplete until actual review finishes.
6. Normal feature -> develop READY preview, matched real SDK viewport measurements, protected develop -> data -> main promotion with fresh current rollback SHA and exact production authorization. Then READY/alias/SHA/health, assets and actual production UI/readiness measurements in all three viewports. Fix and reverify failures or use normal protected rollback. Never substitute local fixture or previous release evidence for new host evidence.

## Required report

State absolute before/after values, relative change, variance/noise and startup cost per viewport. Separate fixture, preview and production; bind source, deployment SHA, timestamp and screenshots/AX records. Mark unverified items and zero admitted production improvement slices honestly. Keep fixes/rollback and Nightly separate. No new scheduling or duplicate old audits.
