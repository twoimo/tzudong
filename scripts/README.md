# Repository scripts

[Repository map](../docs/repository-layout.md) · [Contributing](../CONTRIBUTING.md)

These tools work across repository components. Package-specific tools stay in
[`apps/web/scripts/`](../apps/web/scripts/) or [`backend/bin/`](../backend/bin/).

| Tool | Purpose | Related guide |
| --- | --- | --- |
| [sync-release-branches.mjs](sync-release-branches.mjs) | Coordinate source promotion between release branches | [Release policy](../docs/agents/release.md) |
| [pencil-storyboard-core.mjs](pencil-storyboard-core.mjs) | Shared storyboard/Pencil synchronization helpers | [Pencil synchronization](../apps/web/docs/pencil-storyboard-sync.md) |
| [codex-imagegen-thumbnail-provider.py](codex-imagegen-thumbnail-provider.py) | Thumbnail provider bridge | [Thumbnail generator](../apps/web/docs/admin-youtube-thumbnail-generator.md) |
| [seed-youtube-thumbnail-qa-cases.py](seed-youtube-thumbnail-qa-cases.py) | Thumbnail QA case seeding | [Thumbnail generator](../apps/web/docs/admin-youtube-thumbnail-generator.md) |
| [security/scan_tracked_secrets.py](security/scan_tracked_secrets.py) | Inspect tracked source for credential patterns | [Security policy](../SECURITY.md) |
| [security/audit_supabase_public_api.py](security/audit_supabase_public_api.py) | Audit the configured Supabase API surface | [Security policy](../SECURITY.md) |

Read the tool's arguments and linked guide before execution. Promotion,
provider calls, seeding, and configured remote audits depend on explicit targets
and operator configuration; this index does not run them.
