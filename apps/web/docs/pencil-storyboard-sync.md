# Pencil storyboard sync review and operating contract

This document is the app-local documentation and review checklist for the controlled frontend-to-Pencil storyboard sync described in:

- `.omx/plans/prd-frontend-pencil-storyboard-sync-20260430T065410Z.md`
- `.omx/plans/test-spec-frontend-pencil-storyboard-sync-20260430T065410Z.md`

The contract is intentionally conservative: the running Next.js app remains the source of truth, generated Pencil artifacts are review assets, and any Pencil-to-code direction must land as a human/agent review queue item before app source is changed.

## Non-negotiable guardrails

1. **No direct Pencil-to-React mutation.** Reverse sync commands may read Pencil exports and create review queue Markdown/JSON, but must not edit `app/**`, `components/**`, `hooks/**`, `lib/**`, or other runtime source files.
2. **Code/runtime stays source of truth.** Route screenshots, manifests, source hashes, and drift reports are the authoritative bridge from app code to Pencil.
3. **Generated artifacts are isolated.** Use `apps/web/design/pencil/` for storyboard manifests, screenshots, `.pen` files, exports, drift reports, and review queue items.
4. **Dirty-file preservation is mandatory.** Before any implementation run, record `git status --short -- apps/web` and do not modify unrelated pre-existing dirty files such as the prelaunch-preserved files called out by the team task.
5. **Large/binary output is deliberate.** `.pen`, PNG, and PDF artifacts should be generated from manifests and committed only when the owning lane decides the git policy; otherwise keep them ignored or publish them as build artifacts.

## Recommended artifact layout

```text
apps/web/design/pencil/
├── README.md                         # human index and regeneration policy
├── manifest.json                     # canonical route/component entries
├── routes.md                         # generated route inventory for review
├── screenshots/
│   └── <flow>/<route-id>/<viewport>.png
├── pen/
│   └── <flow>.pen
├── exports/
│   └── <flow>/<viewport>.png
├── drift/
│   └── latest.json
└── review-queue/
    ├── README.md
    └── <yyyyMMdd-HHmmss>-<slug>.{md,json}
```

The root is app-local so the storyboard contract can reference `apps/web` source paths without crossing backend or repo-wide ownership boundaries.

## Manifest review checklist

Every manifest entry should answer the reviewer questions from the PRD: what frontend surface is represented, where it comes from, what viewport/fixture generated it, and whether it is stale.

Required fields:

- `id`: stable kebab-case id, e.g. `home-map`, `admin-evaluations`, `review-modal-mobile`.
- `kind`: `route`, `component`, or `state`.
- `flow`: product grouping such as `home-map`, `discovery`, `user`, `admin`, or `auth`.
- `route`: route path for route entries, or `null` for pure component/state entries.
- `sourcePaths`: runtime files that own the UI.
- `viewports`: at minimum `mobile` and `desktop` for route-level MVP entries.
- `fixture`: explicit auth/data/session assumptions, including `public`, `admin`, `authenticated`, or a named mocked fixture.
- `screenshotPath`, `penPath`, `exportPaths`: generated artifact references.
- `sourceHash` and `screenshotHash`: drift inputs.
- `generatedAt`: ISO timestamp from the generation command.
- `status`: `generated`, `needs-fixture`, `stale`, `blocked`, or `reviewed`.
- `reviewNotes`: short human-readable caveats.

Quality checks:

- Manifest generation must be deterministic except for `generatedAt` and refreshed hashes.
- Missing source paths should fail with actionable remediation instead of silently omitting entries.
- Auth/admin entries should be marked `needs-fixture` until a deterministic fixture/session is available.

## Initial route and source mapping

Use this as the first MVP review seed. It is intentionally route-level first; component variants can be added after the route catalog is stable.

| Flow | Surface | Route/state | Primary source paths | Fixture notes |
| --- | --- | --- | --- | --- |
| Home/map | Home map | `/` | `app/page.tsx`, `components/map/NaverMapView.tsx`, `components/layout/Header.tsx`, `components/layout/MobileBottomNav.tsx` | Public route; Naver map/API and geolocation states may need mocked location/data. |
| Home/map | Global map | `/global-map` | `app/global-map/page.tsx`, `components/map/NaverMapView.tsx` | Public route; map tiles and viewport gestures are flake risks. |
| Discovery | Feed | `/feed` | `app/feed/page.tsx`, `components/feed/FeedContent.tsx` | Public/auth-dependent content should document fixture source. |
| Discovery | Leaderboard | `/leaderboard` | `app/leaderboard/page.tsx` | Public route; stable seeded data preferred. |
| Discovery | Stamp | `/stamp` | `app/stamp/page.tsx` | Public route; include empty/loading states separately when feasible. |
| User | My page | `/mypage` | `app/mypage/page.tsx` | Authenticated fixture required. |
| User | Bookmarks | `/mypage/bookmarks` | `app/mypage/bookmarks/page.tsx` | Authenticated fixture required. |
| User | Reviews | `/mypage/reviews` | `app/mypage/reviews/page.tsx` | Authenticated fixture required. |
| User | New submission | `/mypage/submissions/new` | `app/mypage/submissions/new/page.tsx` | Mobile form/bottom-sheet behavior should be captured. |
| Review/submission | Submissions | `/submissions` | `app/submissions/page.tsx` | Public/auth fixture depends on current product state. |
| Review/submission | Review modal | component state | `components/reviews/ReviewModal.tsx`, `components/ui/mobile-sheet-frame.tsx` | Component/state capture; not a route-only screenshot. |
| Insights/admin | Insights | `/insights` | `app/insights/page.tsx` | May require mocked insight payloads. |
| Insights/admin | Admin insight | `/admin/insight` | `app/admin/insight/page.tsx` | Admin session fixture required. |
| Insights/admin | Admin evaluations | `/admin/evaluations` | `app/admin/evaluations/page.tsx` | Admin session fixture required; tables need stable row data. |
| Insights/admin | Admin submissions | `/admin/submissions` | `app/admin/submissions/page.tsx` | Admin session fixture required. |
| Auth/error/loading | Reset password | `/auth/reset-password` | `app/auth/reset-password/page.tsx` | Token/error variants should be separate states. |
| Auth/error/loading | Loading/error states | `loading.tsx`, `error.tsx` files | `app/loading.tsx`, route-level `loading.tsx`/`error.tsx` files | Capture as state entries, not canonical routes. |

## Reverse sync review queue contract

Pencil-to-code proposals must write review queue items only. A queue item is allowed to reference source files and acceptance criteria, but it is not allowed to apply changes.

Required Markdown sections:

- Summary
- Pencil evidence (`.pen` file, frame/node id, export image)
- Mapped route/component and candidate `sourcePaths`
- Visual delta
- Risk level (`low`, `medium`, `high`)
- Acceptance criteria
- Verification plan
- Reviewer decision (`pending`, `accepted`, `rejected`, `needs-info`)

Required JSON fields:

```json
{
  "schemaVersion": 1,
  "createdAt": "2026-04-30T00:00:00.000Z",
  "pencil": { "penPath": "design/pencil/pen/home-map.pen", "frameId": "", "exportPath": "" },
  "mapping": { "route": "/", "component": null, "sourcePaths": ["app/page.tsx"] },
  "deltaSummary": "",
  "risk": "medium",
  "acceptanceCriteria": [],
  "verification": [],
  "status": "pending"
}
```

Implementation review must reject any reverse-sync command that imports Pencil data and then writes runtime source in the same command.

## Code quality review gates for implementation PRs

Use this checklist when reviewing future storyboard sync code:

- **Boundary:** scripts read app routes/source and write only under `design/pencil/**` unless explicitly approved.
- **Determinism:** route ids, viewport names, and output paths are stable across runs.
- **Failure mode:** missing Pencil CLI/Desktop/auth/map fixtures produce clear remediation text and non-zero exits for `--check` commands.
- **No hidden codegen:** reverse sync produces review queue files only; runtime source edits remain a separate accepted implementation task.
- **Fixture transparency:** admin/auth/map screenshots must record the session/data fixture used.
- **Drift detection:** source/screenshot hash mismatches mark entries stale and do not silently overwrite reviewer decisions.
- **Reviewability:** generated index links every screenshot/export back to route/component source paths.
- **Dependency control:** do not add Storybook or other new visual tooling in the MVP unless a follow-up plan explicitly approves it.

## Verification commands for future implementation

Right-sized checks after storyboard code is added:

```bash
# Static/project health
npm run lint
npx tsc --noEmit
bun run test:unit

# Storyboard-specific checks once scripts exist
node scripts/pencil-storyboard-inventory.mjs --check
node scripts/pencil-storyboard-capture.mjs --flow home-map --viewport mobile,desktop
node scripts/pencil-storyboard-generate.mjs --flow home-map --export
node scripts/pencil-storyboard-drift-check.mjs
```

Manual or integration checks should additionally confirm Pencil Desktop can open generated `.pen` files and exports, but those checks must not be treated as permission to mutate app source directly.

## Current documentation review result

As of this documentation pass, `apps/web` has no committed Pencil storyboard implementation files yet. The main quality risk is therefore scope drift during implementation: direct Pencil-to-React generation, unbounded binary artifact commits, or screenshot scripts that mutate unrelated app source. Future implementation should start by adding schema/tests for `manifest.json` and review queue validation before broad capture/generation automation.
