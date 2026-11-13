# Changelog

Release highlights for Tzudong Map, newest first. Dates below are GitHub
publication dates in **Asia/Seoul (KST)**. The linked release notes retain the
full scope, verification records and limitations of each release.

[한국어](CHANGELOG.ko.md) · [Latest stable release](https://github.com/twoimo/tzudong/releases/latest) · [Release guide](docs/releases/README.md)

## Unreleased

### Changed

- Organize repository and documentation entry points for users and contributors.
- Restore the bilingual release chronology and preserve the original August
  operational records in the [changelog archive](docs/archive/changelog/CHANGELOG.md).
- Add release channels, a release-note template and GitHub note categories.

## [1.2.10](https://github.com/twoimo/tzudong/releases/tag/v1.2.10) — 2026-11-14

### Fixed

- Restore native bookmark detail and map links while preserving domestic/overseas
  navigation and search return paths ([#3828](https://github.com/twoimo/tzudong/pull/3828)).
- Distinguish failed reads from empty results; retain input and page context with
  retry and filter recovery, and show zero counts only for queried regions.
- Restore opener focus after closing authentication and review dialogs, and move
  focus to the first invalid restaurant-submission field.
- Add explicit retry and a 15-second timeout for policy reads while preserving
  signup input and consent choices; ignore cancelled or superseded responses.
- Clarify discovery labels and account-setting hierarchy; improve spacing with
  44px primary controls and 16px inputs on small screens.
- Replace interpolated hook source in the My Page render fixture with a static
  literal for the CodeQL follow-up, preserving the existing assertions.

## [1.2.8](https://github.com/twoimo/tzudong/releases/tag/v1.2.8) — 2026-11-13

- Compact the administrator dashboard and storyboard controls; add opt-in, ephemeral macOS receipt OCR with no automatic cloud fallback.
- Simplify project guidance and preserve existing routes, data and fail-closed readiness.
- Source publication only: production was not promoted because post-merge checks found a missing documentation ownership entry. The follow-up correction is tracked in PR #3831.

## [1.2.7](https://github.com/twoimo/tzudong/releases/tag/v1.2.7) — 2026-09-27

- Preserve the home page's child tree while its lazy provider initializes.
- Reconcile Google map markers by ID and refine swipe ordering and search history.
- The release notes retain synthetic benchmark results, a search-revisit
  regression, and the deployment readback recorded at publication. Those records
  do not establish current production performance or deployment state.

## [1.2.6](https://github.com/twoimo/tzudong/releases/tag/v1.2.6) — 2026-09-09

- Promote recovery work through `develop → data → main`, including scoped agent
  guidance, restaurant refresh, address merging and local database reconstruction.
- This was a source release; the notes do not claim production cutover, hosted
  apply, map publication or a passing Nightly run.

## [1.2.5](https://github.com/twoimo/tzudong/releases/tag/v1.2.5) — 2026-08-26

- Add the daily single-video pending-insert pipeline shared by GitHub Actions
  and the Mac LaunchAgent, plus the admin crawler's GitHub fallback.
- Harden crawler failure handling and the local regression stack. Automatic map
  publication and a passing Nightly run were outside this release's claims.

## [1.2.4](https://github.com/twoimo/tzudong/releases/tag/v1.2.4) — 2026-08-16

- Restore the then-deployable web lockfile after a Next.js upgrade broke builds.
- Shorten the public README and separate live-app deployment records from
  background operations; use prereleases for local Nightly evidence.

## [1.2.3](https://github.com/twoimo/tzudong/releases/tag/v1.2.3) — 2026-07-07

- Fix stale mobile map details after marker taps, search, swipes and cluster
  expansion; add nearest-restaurant fallback for single-result swipes.
- Open the restaurant sheet for visible mobile markers and prevent stale review
  pages when changing restaurants.

## [1.2.2](https://github.com/twoimo/tzudong/releases/tag/v1.2.2) — 2026-07-05

- Restore desktop/mobile map history and Back navigation, align filter commits,
  and improve the mobile detail action area.
- Strengthen restaurant-submission idempotency and readback, admin destructive
  actions, address presentation and image-provider readiness checks.

## [1.2.1](https://github.com/twoimo/tzudong/releases/tag/v1.2.1) — 2026-07-04

- Add five topic filters and make restaurant-detail close controls explicit Back
  navigation on desktop and mobile.
- Separate region/category controls from topic filters.

## [1.2.0](https://github.com/twoimo/tzudong/releases/tag/v1.2.0) — 2026-07-04

- Strengthen admin mutation, audit, readback and provider-readiness contracts.
- Redact sensitive provider and OCR payloads from logs and public responses;
  document the Preview → Confirm → Apply → Readback → Audit flow.

## [1.1.1](https://github.com/twoimo/tzudong/releases/tag/v1.1.1) — 2026-06-29

- Align README and storyboard/RAG claims with committed evidence and the web
  runtime, and remove generated operational noise from the tracked tree.
- Extend ignore rules for local QA, temporary tools and accidental root lockfiles.

## Historical records and prereleases

The [original August 2026 changelog](docs/archive/changelog/CHANGELOG.md) retains
its dated operational detail and original date conventions. The concise entries
above summarize published release notes; they are not a replacement for those
records or a claim that every later commit has been released.

Local Nightly and local-stack prereleases remain in the
[GitHub Releases feed](https://github.com/twoimo/tzudong/releases). Their scope and
tag conventions are explained in the [release guide](docs/releases/README.md).
