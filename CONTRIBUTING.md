# Contributing to Tzudong

Tzudong is a Korean-first restaurant map. Bug reports, documentation improvements,
and focused code changes are welcome in Korean or English.

[Project overview](README.md) · [한국어 소개](README.ko.md) · [Documentation](docs/README.md) · [Repository map](docs/repository-layout.md)

## Choose a starting point

| Work | Start here |
| --- | --- |
| Public map, community, or admin UI | [Web setup](apps/web/README.md) and `apps/web/` |
| Crawling, evaluation, media, or batch processing | [Backend setup](backend/README.md), [architecture](backend/ARCHITECTURE.md), and [data contracts](backend/DATA_CONTRACTS.md) |
| Local database | [Local stack](backend/supabase/README.md) and the [bootstrap runbook](docs/operations/nightly-regression.md#local-compose-bootstrap) |
| Documentation | [Documentation index](docs/README.md) and [file placement rules](docs/repository-layout.md#where-new-files-belong) |
| Releases | [Release guide](docs/releases/README.md) |

## Set up a development branch

Start a feature branch from current `main`. If you do not have repository write
access, fork the repository and use your fork as the push remote.

```sh
git clone --branch main https://github.com/twoimo/tzudong.git
cd tzudong
git switch -c docs/your-change
```

Existing checkouts should fetch current `main` before creating the branch.
Keep unrelated local changes separate. Open feature and dependency PRs against
protected **`main`** after the [main-first transition](docs/operations/main-first-transition.md)
is installed and verified. The transition candidate itself is the final change
promoted through **`develop → data → main`** under the old trusted policy;
do not retarget PRs early. The [promotion policy](.github/PROMOTION_POLICY.md)
defines the exact installation boundary. `data` remains for legacy data consumers.

## Install and run

| Tool | Requirement and source |
| --- | --- |
| Node.js | `24.x`, declared in [apps/web/package.json](apps/web/package.json) |
| npm | `11.6.2`; `package.json` and `package-lock.json` define the release package |
| Bun | Used by the web unit runner; [web CI](.github/workflows/web-admin-ci.yml) pins `1.4.0` |
| Python and Docker Compose | Follow the versions and preparation in the [local bootstrap runbook](docs/operations/nightly-regression.md#local-compose-bootstrap) |

From `apps/web`, install with `npm ci`. Prepare and migrate the repository-managed
local stack using the linked runbook, then start the web app with `npm run dev`.
Open `http://127.0.0.1:3000`. The development runner checks the local stack and
migration ledger before starting Next.js. The [web guide](apps/web/README.md)
explains map-provider setup and the separate hosted debugging command.

For backend tests, create the virtual environment and install
`backend/test-requirements.txt` as described in the [backend guide](backend/README.md).
Use generated local environment files and keep operator credentials outside Git.

## Verify the change

Choose checks for the affected behavior using the [verification guide](docs/agents/verification.md).
Record the commands, results, and any unmet prerequisites in the PR.

| Change | Useful starting checks |
| --- | --- |
| Docs or navigation | Resolve relative links and heading anchors; inspect the diff; run `git diff --check` |
| Folder layout | From the root: `python3 backend/bin/check_layout_manifest.py --json` |
| Web behavior | From `apps/web`: `npm run lint`, focused Bun tests, and `npm run typecheck:parity` |
| Web unit inventory | From `apps/web`: `npm run test:unit`; Bun must be installed. Sharding is supported, for example `npm run test:unit -- --shard 2/4` |
| Backend behavior | Run the affected `unittest` modules with the backend test environment |
| Shared build inputs | From `apps/web`: `npm run build`, plus the affected contract checks |

Documentation changes do not need wording-only tests. New behavior should be
covered through observable results and failure paths. Report skipped checks as
skipped. Required CI and release checks still apply.

## Submit a useful issue or PR

Use the [issue forms](https://github.com/twoimo/tzudong/issues/new/choose) for a bug
or feature request. A useful bug report includes the page or command, reproducible
steps, expected and actual behavior, and the browser or runtime version. For
security reports, follow [SECURITY.md](SECURITY.md).

Keep each PR focused. Explain the problem, what changes for the user or operator,
and how you verified it. Include screenshots for a visible change and identify
any migration or rollout dependency. Existing title conventions include
`fix(map): …`, `feat(pipeline): …`, `docs: …`, and `chore: …`.

When changing file locations, update callers, links, and the
[layout manifest](backend/layout-manifest.v1.json) together. Keep applied
migrations, release tags, and hash-bound evidence at their established paths.
Keep the English and Korean root READMEs and changelogs in sync.

Published source, CI results, and production deployment are separate records.
See the [release guide](docs/releases/README.md) when preparing a release.
