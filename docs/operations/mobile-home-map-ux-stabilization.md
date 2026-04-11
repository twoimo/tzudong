# Mobile home map UX stabilization contract

This note documents the phase-1 mobile-home fix from `.omx/plans/ralplan-mobile-home-map-ux-improvement.md` so future changes keep the same ownership model and do not reintroduce the original state divergence.

## Scope

- mobile **home** flow only
- search selection, marker tap, swipe navigation, close/reset transitions
- parent-owned state in:
  - `apps/web/app/home-client.tsx`
  - `apps/web/app/hooks/useHomeState.ts`
  - `apps/web/app/hooks/useHomeHandlers.ts`
- map-layer guard + regression seam in:
  - `apps/web/lib/mobile-home-search-selection.ts`
  - `apps/web/tests-unit/mobile-home-search-selection.test.ts`

## Canonical ownership model

The detail sheet must have one parent-owned source of truth.

| State | Role | Rule |
| --- | --- | --- |
| `selectedRestaurant` | canonical selected detail restaurant | use for the active restaurant across search, marker taps, and swipe |
| `panelRestaurant` | rendered detail-sheet restaurant | mirror the canonical selection while the panel is open |
| `searchedRestaurant` | transient map-focus intent | set only for search-origin focus and clear as soon as another selection path takes ownership |

`searchedRestaurant` is **not** a long-lived alternate owner of the open sheet. Treat it as disposable navigation intent only.

The map layer should rely on `apps/web/lib/mobile-home-search-selection.ts` to decide whether a searched restaurant is still the active selection instead of inferring that from ad-hoc local comparisons.

## Required transitions

### Search result selection

- open the detail panel through the same parent-owned selection helper as other flows
- set `searchedRestaurant` only as transient search focus so the map can center once

### Marker tap or swipe selection

- replace the current selection through the same parent-owned helper
- clear any stale `searchedRestaurant` ownership
- if the entry came from `?r=` / `?restaurant=`, consume those params without causing a route reset

### Close / mode change / region change / country change

- clear `selectedRestaurant`
- clear `panelRestaurant`
- clear `searchedRestaurant`
- close the panel from the same shared clear helper

## URL cleanup rule

Restaurant deep-link params should be removed with `history.replaceState`, not `router.replace('/')`, after the detail panel is opened. This preserves unrelated query params while avoiding the mobile-home refresh/reset loop that previously happened after close -> marker tap.

## Quality review summary

- No blocking issues were found in the parent-owned state lane after the canonical selection helper was introduced.
- The main recurrence risk remains any future code that lets map-local behavior treat `searchedRestaurant` as durable selection state.
- Future fixes in map/container code should keep consuming the parent-owned contract instead of rebuilding a second selection owner.

## Verification snapshot

- modified-file diagnostics: clean
- `apps/web` typecheck: clean
- targeted mobile-map regression tests: pass (`home-map-keyboard-navigation`, `naver-map-render-guard`, `mobile-home-search-selection`)
- full `bun test tests-unit`: currently has unrelated baseline failures in existing insight/Next-module suites; those failures were not introduced by this lane
