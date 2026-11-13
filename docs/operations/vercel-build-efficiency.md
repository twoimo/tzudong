# Vercel build efficiency

The Git-integrated project is `tzudong` (`prj_sau35J5uUtShIQ9OKofRtOVVnTSl`)
in `twoimos-projects`, with `apps/web` as its root directory. These changes keep
the existing Hobby build resources, Seoul function region, and production
approval policy.

## Branch and change selection

`apps/web/vercel.json` uses a `**` deny rule with explicit `main`, transitional
`develop`, and one-level `preview/*` allow rules. Vercel uses minimatch for branch patterns: `*` alone does not cover
slash-separated names such as `dependabot/github_actions/develop/...`.
The ignore script remains a second check for deployments that already exist
or originate from an older source revision.

Production builds still require all of the following:

- The environment is production and the branch is `main`.
- The reviewed config explicitly enables `main`.
- `TZUDONG_APPROVED_PRODUCTION_SHA` is a complete lowercase Git SHA and exactly
  matches `VERCEL_GIT_COMMIT_SHA`.

For `preview/<name>` and transitional `develop` previews, the ignore script compares the current checked-out
commit with `VERCEL_GIT_PREVIOUS_SHA`, the last successful deployment for that
project and branch. It skips only a verified diff consisting entirely of the
explicit non-application paths in the script. It does not compare just `HEAD^`:
an application change in an earlier failed or canceled deployment still needs
to be built.

Ordinary feature/dependency branches and nested `preview/a/b` names remain disabled.
The preview prefix is an explicit review opt-in after the
[main-first policy](main-first-transition.md) is installed. Formal release evidence
still requires its provider preview identity to name the exact current `main`
release; a feature preview does not substitute for it. Production-domain assignment
remains manual and one operator promotes the verified staged production build.

Missing, invalid, unavailable, unrelated, or mismatched Git history keeps the
preview build enabled. A redeploy of the same SHA also builds, allowing project
settings and environment changes to take effect. Application, dependency,
backend, and unknown paths keep the build enabled. In particular, backend
provider sources contribute to the storyboard runtime source binding, so
changes outside `apps/web` cannot all be ignored safely.

## Keep the incremental cache, rebuild the output

`scripts/clean-next.mjs` preserves only a real `.next/cache` directory when
`VERCEL=1` and the child command is an actual Next.js build. It still removes
previous manifests, server output, and static output. The next build must
regenerate those files, including removal of deleted routes.

The same rule applies to an explicitly selected supported Next dist directory.
Symlinks are not preserved as cache directories. Local and nightly builds keep
their existing full cleanup behavior; `--skip-clean` retains its existing
meaning for callers such as the standalone server launcher.

When a cache was retained, the build emits this fixed, non-sensitive line:

```text
[clean-next] preserved Vercel build cache; removed previous build output
```

The production command remains `npm run build`, including Next's type check
and `verify-route-css-boundaries.mjs`. `npm ci` remains the authoritative
installation path. A cold diagnostic redeploy can leave **Use existing Build
Cache** unchecked; keep **Use project's Ignore Build Step** checked so the
production approval guard still runs.

## Verification

The focused behavioral suites are:

```sh
cd apps/web
bun test tests-unit/vercel-ignore-build.test.ts tests-unit/clean-next-cache.test.ts
bun test tests-unit/standalone-static-source.test.ts tests-unit/local-supabase-runtime.test.ts tests-unit/next-sync-patch.test.ts
```

For hosted verification, record the exact project, branch, source SHA,
deployment ID, and build log. A retained-cache log proves preservation, not a
particular speed improvement. Compare observed build phases separately from
queue time; Vercel can create and upload the next cache after a deployment is
already ready. No percentage improvement is claimed from a single build.

Install the main-first policy through one final protected `develop -> data -> main`
path. After trusted policy and protection readback, source PRs target main directly.
Keep the exact production SHA guard and verify the actual live deployment identity
after each manual production promotion. Changing source configuration is not a
provider-setting or deployment readback.

## References

- [Vercel Git configuration](https://vercel.com/docs/project-configuration/git-configuration)
- [Vercel system environment variables](https://vercel.com/docs/environment-variables/system-environment-variables#vercel_git_previous_sha)
- [Next.js CI build caching](https://nextjs.org/docs/app/guides/ci-build-caching)
- [Hosted operations and release](../agents/release.md)
