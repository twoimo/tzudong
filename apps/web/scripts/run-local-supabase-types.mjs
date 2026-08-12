import { spawnSync } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import {
  assertLocalSupabaseReady,
  buildLocalTypeGenerationEnvironment,
  loadLocalSupabaseEnvironment,
} from './local-supabase-runtime.mjs';

try {
  const local = loadLocalSupabaseEnvironment();
  assertLocalSupabaseReady(local);
  const webRoot = path.join(local.repositoryRoot, 'apps', 'web');
  const result = spawnSync(process.execPath, ['scripts/supabase-gen-types.mjs'], {
    cwd: webRoot,
    env: buildLocalTypeGenerationEnvironment(local),
    stdio: 'inherit',
  });
  if (result.error || result.signal || result.status !== 0) process.exit(2);
} catch (error) {
  const message = error instanceof Error ? error.message : '[local-supabase] type_generation_failed';
  process.stderr.write(`${message}\n`);
  process.exit(2);
}
