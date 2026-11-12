# Releases

[Latest stable release](https://github.com/twoimo/tzudong/releases/latest) · [All releases](https://github.com/twoimo/tzudong/releases) · [Changelog](../../CHANGELOG.md) · [한국어 변경 기록](../../CHANGELOG.ko.md)

Tzudong publishes source releases and local verification prereleases. Use the
channel and the linked evidence to understand what each publication covers.

## Channels

| Channel | Tags | What it records |
| --- | --- | --- |
| Stable source | `vX.Y.Z` | A named source revision and its release notes. Deployment status is recorded separately when a deployment was performed. |
| Local Nightly | `v1.2.4-nightly.<run>.g<sha>` | A successful local regression publication with the workflow's allowlisted artifacts. It is a prerelease, not a production deployment. |
| Local stack | For example, `v1.2.4-local-stack.20261110` | A scoped local-tooling change, published as a prerelease with its own verification notes. |

The older `nightly-local-<sha>` tag is retained as historical evidence. Published
tags and assets keep their existing URLs.

## Current published baseline

Checked on **2026-11-12 KST**:

- Latest stable source release: [v1.2.7](https://github.com/twoimo/tzudong/releases/tag/v1.2.7),
  tag commit `157ced98a2414d434132c99f74c72bbe5f796ca4`.
- The release feed contains nine stable source releases and 17 prereleases
  (16 Nightly publications and one local-stack publication).
- The web package still declares `1.2.4`, and the Nightly workflow uses the
  `v1.2.4-nightly…` prefix. These are existing identifiers; use the exact tag and
  commit to identify a release, rather than inferring it from the package version.

This snapshot describes published GitHub records. For newer publications use the
[latest-release link](https://github.com/twoimo/tzudong/releases/latest) or the
[full feed](https://github.com/twoimo/tzudong/releases). A historical deployment
receipt in a release note does not establish the currently deployed revision.

## Prepare release notes

1. Add a short entry under `Unreleased` in both root changelogs. Keep the two
   languages aligned and leave long operational receipts in their dated documents.
2. Follow the existing [release policy](../agents/release.md) and protected
   `feature → develop → data → main` promotion path. Identify the exact source
   commit, tag and previous release before preparing a publication.
3. Start from the [release-note template](TEMPLATE.md). GitHub's **Generate release
   notes** uses [`.github/release.yml`](../../.github/release.yml) to group merged
   PRs by label. Select the intended previous stable tag explicitly so a nearby
   Nightly tag does not accidentally define the comparison range.
4. Edit the generated list into readable highlights. Include verification scope,
   missing checks and known regressions. Link measurements with their limitations;
   avoid turning local or synthetic results into production claims.
5. Record deployment status separately from source publication. If deployment is
   part of the release, retain the rollback SHA and actual deployment/live-URL
   readback required by the release policy. Otherwise state that no deployment was
   performed for this source release. Replace `Unreleased` with the published
   version and KST publication date only after publication is verified.

The note configuration formats generated text; it does not bump versions,
create tags, publish releases, or change the existing Nightly workflow. Unlabeled
PRs remain visible in **Other changes**. Labels can refine categories without
becoming a new requirement for contribution.

## Release resources

| Resource | Purpose |
| --- | --- |
| [Release-note template](TEMPLATE.md) | Highlights, verification, deployment scope and comparison links. |
| [Hosted operations and release](../agents/release.md) | Current promotion, deployment and rollback requirements. |
| [Trusted promotion policy](../../.github/PROMOTION_POLICY.md) | The protected promotion workflow and its trust boundary. |
| [Verification guide](../agents/verification.md) | Select checks according to the changed behavior. |
| [Nightly runbook](../operations/nightly-regression.md) | Local regression setup and operations. |
| [Nightly publication workflow](../../.github/workflows/nightly-local-regression.yml) | Existing automated prerelease publication. |
| [Publication allowlist](../../.github/nightly-local-publication-allowlist.txt) | Files permitted in a Nightly release. |
| [Original changelog](../archive/changelog/CHANGELOG.md) · [한국어](../archive/changelog/CHANGELOG.ko.md) | Preserved August 2026 operational history. |

The categorized-note pattern follows [Immich's release configuration](https://github.com/immich-app/immich/blob/main/.github/release.yml)
and [GitHub's generated release-note format](https://docs.github.com/en/repositories/releasing-projects-on-github/automatically-generated-release-notes).
Tzudong keeps its existing promotion and evidence requirements.
