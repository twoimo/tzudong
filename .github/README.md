# GitHub maintenance

[Contributing](../CONTRIBUTING.md) · [Release guide](../docs/releases/README.md) · [Repository map](../docs/repository-layout.md)

| Path | Responsibility |
| --- | --- |
| [workflows/](workflows/) | CI, scheduled jobs, and explicit operator workflows |
| [scripts/](scripts/) | Workflow support and verification tools |
| [cloudflare/](cloudflare/README.md) | Bounded Workers Builds governance and verified receipt deployment |
| [PROMOTION_POLICY.md](PROMOTION_POLICY.md) | Protected feature → develop → data → main promotion |
| [CODEOWNERS](CODEOWNERS) | Ownership of security-sensitive automation |
| [dependabot.yml](dependabot.yml) | Dependency update configuration |
| [ISSUE_TEMPLATE/](ISSUE_TEMPLATE/) | Bug and feature request forms |
| [pull_request_template.md](pull_request_template.md) | Problem, changes, and verification prompts |
| [release.yml](release.yml) | Categories for GitHub's generated release notes |

The JSON manifests and publication allowlist in this directory are inputs to
existing workflow and verification contracts. Their filenames and recorded
identities belong to those contracts. Check consumers before reorganizing them.

Release-note categories organize the output of **Generate release notes**.
They do not create tags, publish a release, or change deployment behavior.
Feature PRs target `develop`; the [promotion policy](PROMOTION_POLICY.md) defines
how accepted source reaches the protected release branches.
