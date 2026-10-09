# 공개 이슈 초안 — 아직 전송하지 않음

대상: `vercel/vercel-plugin`의 공식 GitHub Issues. 포함 정보는 공개 skill 버전·경로, 공개 Next 문서, 비밀값이 없는 재현 예제뿐이다. 계정·프로젝트·키·운영 환경·비공개 경로는 포함하지 않는다. 사용자 승인 전 게시하지 않는다.

Title: Correct Next.js test environment load order in the env-vars skill

The published env-vars skill in Vercel plugin 0.54.1 says environment-specific local files are skipped in tests. Next.js skips only generic `.env.local`; `.env.test.local` is loaded and has precedence over `.env.test`.

The official load order is:

1. Existing `process.env`
2. `.env.$NODE_ENV.local`
3. `.env.local` (except when `NODE_ENV=test`)
4. `.env.$NODE_ENV`
5. `.env`

Reproduction with synthetic values using `loadEnvConfig` from `@next/env` 16.3.8:

```text
.env.test.local: TEST_ENV_SENTINEL=test-local
.env.local:      TEST_ENV_SENTINEL=generic-local
.env.test:       TEST_ENV_SENTINEL=test
.env:            TEST_ENV_SENTINEL=base
NODE_ENV=test    → TEST_ENV_SENTINEL=test-local
```

Please correct the test exception to apply only to `.env.local` and include `.env.test.local` in the documented precedence. No credentials are needed to reproduce.

Official reference: https://nextjs.org/docs/app/guides/environment-variables#environment-variable-load-order

Local verification: three synthetic load-order conditions passed. The source proposal and test evidence are retained separately; no user environment file was modified.
