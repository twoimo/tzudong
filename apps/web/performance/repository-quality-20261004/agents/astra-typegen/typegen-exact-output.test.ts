import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, test } from 'bun:test';

const sourceRoot = '/Users/twoimo/.codex/worktrees/review-commit-recovery-20261004/tzudong';
const node = '/opt/homebrew/opt/node@24/bin/node';
const generated = await readFile(new URL('./database.types.generated.ts', import.meta.url), 'utf8');
const provenance = JSON.parse(await readFile(new URL('./typegen-source-evidence.json', import.meta.url), 'utf8'));

test('actual nightly source survives the generator unchanged at its consumed default path', async () => {
  expect(createHash('sha256').update(generated).digest('hex')).toBe(provenance.new_sha256);
  const root = await mkdtemp(path.join(tmpdir(), 'tz-typegen-exact-'));
  const requests: string[] = [];
  const server = createServer((request, response) => {
    requests.push(request.url ?? '');
    response.writeHead(200, { 'Content-Type': 'text/plain' });
    response.end(generated);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('fixture_address_missing');
    const appTypes = path.join(root, 'integrations/supabase/types.ts');
    await mkdir(path.dirname(appTypes), { recursive: true });
    await writeFile(appTypes, 'application-types-preserved\n');
    const run = () => new Promise<number | null>((resolve, reject) => {
      const child = spawn(node, [path.join(sourceRoot, 'apps/web/scripts/supabase-gen-types.mjs')], {
        cwd: root, stdio: 'ignore', env: {
          PATH: '/opt/homebrew/opt/node@24/bin:/usr/bin:/bin',
          SUPABASE_PG_META_URL: `http://127.0.0.1:${address.port}`,
        },
      });
      child.on('error', reject);
      child.on('close', resolve);
    });
    expect(await run()).toBe(0);
    expect(await readFile(path.join(root, 'integrations/supabase/database.types.ts'), 'utf8')).toBe(generated);
    expect(await readFile(appTypes, 'utf8')).toBe('application-types-preserved\n');
    expect(await run()).toBe(0);
    expect(await readFile(path.join(root, 'integrations/supabase/database.types.ts'), 'utf8')).toBe(generated);
    expect(requests).toEqual([
      '/generators/typescript?included_schemas=public,auth,storage',
      '/generators/typescript?included_schemas=public,auth,storage',
    ]);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(root, { recursive: true, force: true });
  }
});
