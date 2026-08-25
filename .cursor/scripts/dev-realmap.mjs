#!/usr/bin/env node
// Hybrid dev runner: local Supabase stack (seeded data) + the REAL Naver map.
//
// The default `bun run dev` path forces an offline Naver stub
// (NEXT_PUBLIC_TZUDONG_LOCAL_RUNTIME=1 + NEXT_PUBLIC_NAVER_MAPS_SCRIPT_URL=
// /__local/naver-maps.js) so it never calls a map provider. This runner keeps
// every other local behavior intact but points the Naver Maps script at the
// real provider using a caller-supplied NEXT_PUBLIC_NAVER_CLIENT_ID (ncpKeyId),
// so the actual Naver tiles render while the app still reads the local stack.
//
// Requires NEXT_PUBLIC_NAVER_CLIENT_ID in the environment (add it as a secret).
// The client id's Naver Cloud console "Web service URL" allowlist must include
// http://127.0.0.1:8080 and http://localhost:8080, otherwise Naver returns 401.
import { spawn } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const webRoot = path.join(repoRoot, 'apps', 'web');
const runtime = await import(path.join(webRoot, 'scripts', 'local-supabase-runtime.mjs'));

const clientId = process.env.NEXT_PUBLIC_NAVER_CLIENT_ID?.trim();
if (!clientId) {
  process.stderr.write(
    '[dev-realmap] NEXT_PUBLIC_NAVER_CLIENT_ID is required. Add it as a secret (Naver Cloud ncpKeyId) and retry.\n',
  );
  process.exit(2);
}

const port = Number(process.env.TZUDONG_REALMAP_PORT || '8080');
if (!Number.isInteger(port) || port < 1024 || port > 65535) {
  process.stderr.write('[dev-realmap] invalid TZUDONG_REALMAP_PORT\n');
  process.exit(2);
}

let local;
try {
  local = runtime.loadLocalSupabaseEnvironment();
  runtime.assertLocalSupabaseReady(local);
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : '[local-supabase] admission_failed'}\n`);
  process.exit(2);
}

const env = {
  ...runtime.buildLocalWebEnvironment(
    local,
    runtime.loadLocalWebInputEnvironment({ repositoryRoot: local.repositoryRoot }),
  ),
  __NEXT_PROCESSED_ENV: 'true',
  NEXT_PUBLIC_SITE_URL: `http://127.0.0.1:${port}`,
  TZUDONG_NEXT_DIST_DIR: `.next-realmap-${port}`,
  // Real Naver map overrides. buildLocalWebEnvironment pins the offline stub,
  // so these must be applied afterwards. Everything else stays local.
  NEXT_PUBLIC_NAVER_CLIENT_ID: clientId,
  NEXT_PUBLIC_NAVER_MAPS_SCRIPT_URL:
    `https://oapi.map.naver.com/openapi/v3/maps.js?ncpKeyId=${clientId}`,
};

process.stdout.write(
  `[dev-realmap] admitted project=${local.projectName} app=http://127.0.0.1:${port} supabase=${local.supabaseOrigin} map=real-naver\n`,
);

const child = spawn(
  'node',
  ['node_modules/next/dist/bin/next', 'dev', '--webpack', '--port', String(port), '--hostname', '127.0.0.1'],
  { cwd: webRoot, env, stdio: 'inherit' },
);
child.once('exit', (code, signal) => process.exit(signal ? 1 : (code ?? 0)));
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => child.kill(sig));
