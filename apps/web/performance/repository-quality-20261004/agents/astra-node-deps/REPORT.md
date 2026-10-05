# Node dependency security and quality handoff

Source: `/Users/twoimo/.codex/worktrees/node-dependency-quality-20261004/tzudong`
Branch: `codex/node-dependency-quality-20261004`
Baseline and observed remote develop: `4295fd54411ac8a4c304dce89efbb6f96e90935c`.
All edits are uncommitted. Parent owns source delivery, commit, push, PR decisions, promotion and deployment.

## Security result

Fresh baseline npm audit reproduced the supplied advisories. Web had 9 vulnerability entries (8 high, 1 critical); these are affected packages, not nine independent advisories. Backend reproduction and remediation are under `backend/`.

The candidate upgrades Next 16.3.5 to exactly 16.3.6, including @next/bundle-analyzer and eslint-config-next. The [maintainer release](https://github.com/vercel/next.js/releases/tag/v16.3.6) contains the [next/og ImageResponse fix](https://github.com/advisories/GHSA-vcvr-r3jv-pc5j). A static scan of 1,136 tracked web code files outside retained performance evidence found no next/og or @vercel/og reference. This separates observed source exposure from the vulnerable installed package; it does not prove a deployed environment.

Web brace-expansion overrides change 5.0.9 to 5.0.12, and 2.1.4 to 2.1.7 for minimatch 3.1.5. These cover [parseCommaParts recursion](https://github.com/advisories/GHSA-6j4f-fj2g-mc7p), [nested-group recursion](https://github.com/advisories/GHSA-qhr7-859c-m2p7) and [quadratic rewrite](https://github.com/advisories/GHSA-q2hr-2g5m-vwhr). See `advisory-version-matrix.json` for exact official patch minima and selected resolved versions. Both npm and Bun installations execute all four minimatch 3 owner paths successfully under Node 24 with brace-expansion 2.1.7.

**Full web audit remains failed: exit 1, seven high entries caused by the single unresolved [braces advisory](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm).** Production-only audit is zero, but does not replace the all-dependency Security gate. There is no ignore, disable, audit-level weakening, force update or asserted remediation for braces.

The [official npm registry](https://registry.npmjs.org/braces) still lists 3.0.3 as latest. [Upstream PR 72](https://github.com/micromatch/braces/pull/72), head `28d440b5dd449dbf1fe6f3506cf94ecca4d02660`, is open and unmerged. It proposes parser and AST walker depth guards, not a published patch. Its GitHub merge_commit_sha is a speculative PR merge ref, not evidence of a merged release.

Current owner paths are eslint-config-next -> @next/eslint-plugin-next -> fast-glob -> micromatch -> braces, and @tailwindcss/cli -> @parcel/watcher -> micromatch -> braces. Both are dev tool paths. The Next plugin expands configured rootDir globs; this project's ESLint config does not set rootDir. Parcel processes watcher ignore globs. No direct application imports of these vulnerable dev libraries were introduced. Current use boundaries reduce observed exposure but cannot clear the audit finding.

Applicable alternatives and their limits:

- Upgrade to a verified published upstream release once available, then regenerate both locks and rerun audit plus caller checks. No such release exists at this readback.
- Review and carry a bounded local depth-guard patch based on the upstream proposal. This would be an explicitly named local mitigation, need npm and Bun installation parity plus compile/expand/AST regressions, and leave the registered 3.0.3 audit blocker unless a published fixed package exists. It is not applied in this manifest/caller-only change.
- Replace both dependent development paths with supported alternatives after separate API and lint/watch equivalence review. Replacing only one leaves the other. Aliasing braces to brace-expansion or silently downgrading Next lint to npm's suggested 14.2.35 is not API/release-compatible remediation.

## PR decisions

| PR | Exact intent | Fresh-baseline decision |
| --- | --- | --- |
| 3066 | Web runtime group, including Next16.3.6, React19.3.0, Supercluster9.1.0 | Integrated target manifest ranges and exact requested direct resolved versions; required SSR peer transitive upgrades retained in npm lock |
| 3065 | Web dev group, including analyzer/config16.3.6, Playwright1.63.0, Supabase CLI2.117.0 | Integrated; retained Node24/npm11.6.2, native7.0.2/compat6.0.2 pins; corrected four dependency version assertions in nightly unit test |
| 2855 | framer-motion12.42.2 ->13.4.0 | Integrated; no current production code import found, next.config optimizer list is retained |
| 3064 | Backend Puppeteer25.8.0 ->25.12.0 | Integrated; see backend report for offline consumer and frozen-install evidence |
| 3062 | Backend @google/genai2.18.0 ->2.24.0 | Integrated; SDK consumers checked without network/provider calls |
| 3061 | Backend dotenv16.6.1 ->18.0.3 | Integrated with quiet environment loading; actual machine JSON callers tested |
| 2924 | Backend js-yaml4.x ->5.4.2 | Integrated with named load import at map crawler; config parse parity verified |
| 2902 | Older cross-project group (web maplibre6.4.1, Next16.3.4, sharp0.35.4; backend js-yaml4.3.2) | Excluded as already satisfied/superseded: baseline web6.10.0/16.3.5/0.35.4, backend lock4.3.2; no stale tree copied |

Exact heads, baseline specifications, direct and transitive resolved versions are in `web-pr-intents.json`, `web-pr-head-resolutions.json`, `web-pr-decision-matrix.json`, `pr-2902-web-baseline-proof.json` and `backend/pr-*.json`.

## Compatibility and validation

Supercluster 9.1 introduces its own named feature type exports. With the dependency upgraded but source unchanged, native TypeScript reproduced exactly 16 TS2702 diagnostics. Five files now import ClusterFeature/PointFeature by name. Runtime map logic is unchanged. A new real adapter test exercises index load, cluster lookup/expansion, category extraction, individual points and empty input.

Bun 1.4.0 imported the candidate npm authority lock in an isolated task directory. All 820 unique package/version identities and every declared npm integrity match; root dependency specs match. Physical hoisting differs (837 npm entries, 831 Bun entries), which is expected. Bun frozen install preserves lock bytes; minimatch caller execution confirms the relevant edge resolution. The existing Bun minimatch compatibility patch is preserved.

Confirmed: candidate npm ci; isolated Bun frozen install; full lint; updated-test targeted lint; focused 109/109 unit checks; native/compat parity; compiler provenance (native7.0.2, bridge/API6.0.2); npm production build and route CSS boundaries; offline production browser 3/3 (home, Radix keyboard/focus, pointer/keyboard panel resizing). Final full unit: 2,804 pass / 9 skip / 0 fail across the general and isolated lanes; see `web-unit-full-final.json`. Backend relevant tests: 80 pass / 8 Windows-only skip / 0 fail; actual added caller tests 12/12.

Initial full unit run was 2,653 pass / one skip / one failure due to four stale Supabase CLI2.115.0 expectations after the requested2.117.0 update. Only those version assertions were updated. Nightly workflows and regression scripts were not changed. Do not interpret the initial failure as a baseline workflow failure.

The generated `.next` build is available in the task tree; `build-staging.json` binds its build ID and key manifests to source hashes. Actual Naver SDK A/B remains for the parent after serial source integration. No performance improvement, SDK regression result, deployment or live correctness is claimed.

Task-owned runtime: Node24.21.0 and npm11.6.2 under `../runtime/bin`; caches, Bun install, browser install and package installations were task-owned. Shared node_modules, model/provider/default settings and operational targets were preserved. No commits, remote mutations, phone access, paid/production API calls or real database writes were performed.

SSR resolution note: PR3066 head locks @supabase/supabase-js2.117.1; fresh npm resolution selected2.117.2 to satisfy SSR0.12.7 peer ^2.114.0 (baseline2.112.3 does not satisfy it). The six2.117.2 Supabase SDK nodes and jose6.2.12 are explicit resolver changes in `web-resolved-version-changes.json`, not a copied PR tree. React/type upgrades were separately authorized PR3066 intents, not a requirement inferred from the Next security patch.
