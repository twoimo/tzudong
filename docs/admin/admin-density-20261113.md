# Administrator density and local receipt preview, 2026-11-13

Base: `bb0b91a0de4b2af2f4fe577203a409ab32a80e49`. Work remains on `feat/admin-density-ocr-20261113`; no merge/deployment or hosted readiness migration is part of this candidate.

## UI changes

- Narrower sidebar, compact shared header, four-pixel spacing scale, neutral square surfaces and preserved 44px touch controls.
- The phone menu bar identifies the current module instead of repeating a second visible title.
- Dashboard operating counts, performance rankings and diagnoses default to bounded tables; charts/fullscreen controls remain available. Numeric cells do not break across lines.
- Storyboard project selection, connection settings and project actions share the header. Saved-project controls wrap on phones rather than escaping the clipped canvas.
- Mobile KPI cards measure 88.5px in the synthetic 390px fixture, down from 130–140px in the first candidate. No claim about application throughput follows from this geometry measurement.

## Verification and honest limits

- Stable-source 15-menu × 3-width × 2-theme audit: 90 cases, zero geometry/accessibility issues. 78 rendered-check passes, six honest Sentry-not-configured states and six fixture/provider-limited states. These are synthetic data, not production/provider acceptance.
- After the final overview/storyboard-only CSS correction: 12 affected cases rerun, stable source, zero issues. Other modules were not changed by that correction.
- Five legacy routes at three widths: 15/15 pass. Sidebar navigation, read-only search/detail controls and reduced-motion checks retained.
- Saved-project detail and numeric-cell checks at 390/834/1423: no escaped controls, split numbers, hidden operating values or KPI value/delta overlap.
- Local OCR: native Apple Vision recognized synthetic Korean store/date/time/amount fields with zero cloud calls. The actual route was exercised with only `requireAdmin` mocked in an isolated subprocess; UI responses came from a real local CLI result. This does not certify production session middleware or real-receipt accuracy. The generic design gateway cannot establish the authenticated production API path.
- OCR route: unauthenticated 401, cross-origin 403, disabled 503, provider injection 400, invalid image 422, native success 200. UI result clearing tested at three widths. Cloud transports tested only with fake fetches.
- Relevant unit suites, targeted ESLint, native/compat TypeScript parity and `git diff --check` passed. No new production build, hosted worker or provider call was performed.
- Shared DB readiness: 27 Bun and eight Python adapter tests passed. The temporary PG17 partial baseline proved HELD/ACL behavior only; missing platform extensions/role dependencies and an activation-row constraint error prevent a full-chain/READY claim. Its owned Postgres process was stopped. Hosted readiness remains held.

Operation guide: [local OCR preview](local-ocr-preview.md).
