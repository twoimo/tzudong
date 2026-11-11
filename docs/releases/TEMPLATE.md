# Release-note template

Copy the template below into a draft GitHub release. Replace bracketed fields
with observed values, delete unused sections, and write highlights in the
release's intended language. Mirror the short summary in both root changelogs.
See the [release guide](README.md) for channel definitions and the publication
sequence. This file itself is a template, not a release or verification receipt.

```markdown
# Tzudong [version] — [short title]

## Highlights

- [User-visible change and why it matters.]

## Changes

### Added

- [Capability and linked PR. Omit this heading when empty.]

### Changed / Fixed

- [Behavior before and after, with the linked PR.]

## Source and verification

| Item | Record |
| --- | --- |
| Channel | [Stable source / local Nightly prerelease / local-stack prerelease] |
| Tag | [Exact published or proposed tag; identify which] |
| Source commit | [Full commit SHA] |
| Previous release | [Exact previous tag and comparison link] |
| Promotion | [Actual feature → develop → data → main PR links, as applicable] |
| Checks | [Commands or workflow links, their results and the tested revision] |
| Evidence | [Relevant retained reports or release assets, if any] |

## Deployment status

[State whether deployment was performed for this release. If none, write:
"No production deployment was performed for this source release."]

[If performed, record the actual project, deployment ID, deployment Git SHA,
live URL, observation time, readback result and rollback SHA. Keep the source
tag SHA separate when it differs. Link the dated receipt.]

## Known limitations

- [Remaining issue, skipped check, unavailable prerequisite or measured regression.]
- [Scope of measurements: local/synthetic/production, relevant dates and report.]

## Full comparison

[Previous tag] → [New tag]: [GitHub compare URL]
```

For local prereleases, retain their existing publication rules and sanitized
asset allowlist. Include the workflow run and exact source SHA. Never attach
credentials, cookies, raw provider payloads, private rows or local environment
files. A passing CI job or local benchmark does not establish deployment state.
