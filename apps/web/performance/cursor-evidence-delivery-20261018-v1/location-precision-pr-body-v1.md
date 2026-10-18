A valid location capability could be rejected during a longer session because subtracting two fractional monotonic timestamps does not always recover the exact five-minute duration. For example, `(262144.02702702704 + 300000) - 262144.02702702704` yields `299999.99999999994`. This reproduced the two capability/lifecycle failures in the follow-up CI run.

Validate the minted expiry by recomputing the original sum instead. This preserves the same fixed lifetime, finite/safe timestamps, opaque WeakMap identity, exact expiry boundary, revocation and no-revival behavior; no epsilon tolerance or permission widening. The server-owned location-readiness gate and coordinate handling remain unchanged.

A deterministic regression drives the actual private capability API at three fractional monotonic times, checks access immediately and before expiry, then denial at expiry and after a clock rewind. On the deployed baseline the added test fails (9 pass/1 fail); with the fix, all10 tests/128 assertions pass. Changed-file lint and native/compat parity pass with0 diagnostics. Original CI failures and raw sampler evidence remain retained.

Deliver through develop → data → main, then deploy the exact protected main SHA and repeat the live URL readbacks. This is a narrow follow-up to PR #3317; no DB/Storage/DNS, real device coordinates, feature activation or paid setting changes.
