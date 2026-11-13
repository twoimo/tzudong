# GitHub maintenance

[Contributing](../CONTRIBUTING.md) · [Release guide](../docs/releases/README.md) · [Repository map](../docs/repository-layout.md)

| Path | Responsibility |
| --- | --- |
| [workflows/](workflows/) | CI, scheduled jobs, and explicit operator workflows |
| [scripts/](scripts/) | Workflow support and verification tools |
| [cloudflare/](cloudflare/README.md) | Bounded Workers Builds governance and verified receipt deployment |
| [PROMOTION_POLICY.md](PROMOTION_POLICY.md) | Trusted main-first source policy and its final serial installation |
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
After the [main-first transition](../docs/operations/main-first-transition.md)
is installed and verified, feature and dependency PRs target protected `main`.
The policy-changing candidate itself follows the final `develop → data → main`
installation under the previously trusted policy. The `data` branch remains for
its existing data consumers, outside the source-promotion path.
