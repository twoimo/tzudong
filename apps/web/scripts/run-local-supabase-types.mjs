import { spawnSync } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import {
  assertLocalSupabaseReady,
  loadLocalSupabaseEnvironment,
} from './local-supabase-runtime.mjs';

try {
  const local = loadLocalSupabaseEnvironment();
  assertLocalSupabaseReady(local);
  const databaseUrl = new URL(local.values.SUPABASE_DB_URL);
  databaseUrl.username = `${databaseUrl.username}.${local.values.POOLER_TENANT_ID}`;
  const result = spawnSync('node', ['scripts/supabase-gen-types.mjs'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      SUPABASE_DB_URL: databaseUrl.toString(),
      SUPABASE_SCHEMAS: 'public,auth,storage',
      SUPABASE_CLI: path.resolve(
        process.cwd(),
        'node_modules',
        '.bin',
        process.platform === 'win32' ? 'supabase.cmd' : 'supabase',
      ),
    },
    stdio: 'inherit',
  });
  if (result.error || result.signal || result.status !== 0) process.exit(2);
} catch (error) {
  const message = error instanceof Error ? error.message : '[local-supabase] type_generation_failed';
  process.stderr.write(`${message}\n`);
  process.exit(2);
}
