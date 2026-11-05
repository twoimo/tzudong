import { createHash } from 'node:crypto';
import {
  cpSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

import { expect, mock, test } from 'bun:test';

mock.module('server-only', () => ({}));

const {
  STORYBOARD_RUNTIME_SOURCE_PATHS,
  calculateStoryboardRuntimeSourceBinding,
} = await import('../lib/admin/storyboard/runtime-source-binding');
const { evaluateStoryboardRuntimePolicy } = await import('../lib/admin/storyboard/runtime-policy');

const repositoryRoot = resolve(import.meta.dir, '../../..');

function copiedSourceRoot() {
  const root = mkdtempSync(join(tmpdir(), 'storyboard-runtime-source-binding-'));
  for (const sourcePath of STORYBOARD_RUNTIME_SOURCE_PATHS) {
    const destination = join(root, sourcePath);
    mkdirSync(dirname(destination), { recursive: true });
    cpSync(join(repositoryRoot, sourcePath), destination);
  }
  return root;
}

function sourceFilesBelow(root: string): string[] {
  const files: string[] = [];
  const visit = (directory: string) => {
    for (const entry of readdirSync(directory)) {
      const absolute = join(directory, entry);
      if (statSync(absolute).isDirectory()) visit(absolute);
      else if (entry.endsWith('.ts')) files.push(absolute);
    }
  };
  visit(root);
  return files;
}

function repositoryPath(absolute: string): string {
  return absolute.slice(repositoryRoot.length + 1).replaceAll('\\', '/');
}

test('next config injects the deterministic digest of every declared production execution source', async () => {
  const first = calculateStoryboardRuntimeSourceBinding({ repositoryRoot });
  const second = calculateStoryboardRuntimeSourceBinding({ repositoryRoot });
  expect(first).toEqual(second);
  expect(first.sha256).toMatch(/^[0-9a-f]{64}$/);
  expect(first.sources.map(({ path }) => path)).toEqual([...STORYBOARD_RUNTIME_SOURCE_PATHS]);
  for (const source of first.sources) {
    expect(source.sha256).toBe(createHash('sha256').update(readFileSync(join(repositoryRoot, source.path))).digest('hex'));
  }

  const { default: nextConfig, storyboardRuntimeSourceBinding } = await import('../next.config.mjs');
  expect(storyboardRuntimeSourceBinding).toEqual(first);
  expect(nextConfig.env.STORYBOARD_RUNTIME_SOURCE_BINDING_SHA256).toBe(first.sha256);
});

test('a fallback edit in the real worker path changes both source binding and canonical policy digest', () => {
  const root = copiedSourceRoot();
  try {
    const before = calculateStoryboardRuntimeSourceBinding({ repositoryRoot: root });
    const workerPath = join(root, 'apps/web/scripts/storyboard-gemini-worker.ts');
    writeFileSync(workerPath, `${readFileSync(workerPath, 'utf8')}\n// fixture: non-Gemini fallback branch\n`);
    const after = calculateStoryboardRuntimeSourceBinding({ repositoryRoot: root });
    expect(after.sha256).not.toBe(before.sha256);
    expect(evaluateStoryboardRuntimePolicy(after.sha256).canonicalPolicySha256)
      .not.toBe(evaluateStoryboardRuntimePolicy(before.sha256).canonicalPolicySha256);
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

test('binds every worker entrypoint and every route delegated to the retired API', () => {
  const apiSources = sourceFilesBelow(join(repositoryRoot, 'apps/web/app/api'));
  const delegatedRoutes = apiSources
    .filter((sourcePath) => {
      const source = readFileSync(sourcePath, 'utf8');
      return source.includes('storyboardProductionApi.worker') || source.includes('retiredStoryboardApi');
    })
    .map(repositoryPath)
    .sort();

  expect(delegatedRoutes).toEqual([
    'apps/web/app/api/admin/storyboard/chat/route.ts',
    'apps/web/app/api/admin/storyboard/images/route.ts',
    'apps/web/app/api/admin/storyboard/jobs/route.ts',
    'apps/web/app/api/admin/storyboard/production/[id]/images/route.ts',
    'apps/web/app/api/admin/storyboard/route.ts',
    'apps/web/app/api/storyboard-worker/images/route.ts',
    'apps/web/app/api/storyboard-worker/route.ts',
  ]);
  for (const sourcePath of delegatedRoutes) {
    expect(STORYBOARD_RUNTIME_SOURCE_PATHS).toContain(sourcePath);
  }
  expect(STORYBOARD_RUNTIME_SOURCE_PATHS).toContain('apps/web/lib/admin/storyboard/retired-api.ts');
});

test('worker and retired-route boundary edits change both source and policy digests', () => {
  const root = copiedSourceRoot();
  try {
    const before = calculateStoryboardRuntimeSourceBinding({ repositoryRoot: root });
    const paths = [
      'apps/web/app/api/storyboard-worker/route.ts',
      'apps/web/app/api/storyboard-worker/images/route.ts',
      'apps/web/lib/admin/storyboard/retired-api.ts',
      'apps/web/app/api/admin/storyboard/route.ts',
      'apps/web/app/api/admin/storyboard/jobs/route.ts',
    ];
    for (const sourcePath of paths) {
      const isolatedRoot = copiedSourceRoot();
      try {
        const absolute = join(isolatedRoot, sourcePath);
        writeFileSync(absolute, `${readFileSync(absolute, 'utf8')}\n// fixture: policy boundary drift\n`);
        const after = calculateStoryboardRuntimeSourceBinding({ repositoryRoot: isolatedRoot });
        expect(after.sha256).not.toBe(before.sha256);
        expect(evaluateStoryboardRuntimePolicy(after.sha256).canonicalPolicySha256)
          .not.toBe(evaluateStoryboardRuntimePolicy(before.sha256).canonicalPolicySha256);
      } finally {
        rmSync(isolatedRoot, { force: true, recursive: true });
      }
    }
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

test('binds the production asset and worker memory gates imported by declared execution sources', () => {
  const productionStore = readFileSync(
    join(repositoryRoot, 'apps/web/lib/admin/storyboard/production-store.ts'),
    'utf8',
  );
  const outboundWorker = readFileSync(
    join(repositoryRoot, 'apps/web/lib/admin/storyboard/outbound-worker.ts'),
    'utf8',
  );
  expect(productionStore).toMatch(/from ['"]\.\/production-assets['"]/);
  expect(outboundWorker).toMatch(/from ['"]\.\/resource-invariants\.ts['"]/);
  expect(STORYBOARD_RUNTIME_SOURCE_PATHS).toContain(
    'apps/web/lib/admin/storyboard/production-assets.ts',
  );
  expect(STORYBOARD_RUNTIME_SOURCE_PATHS).toContain(
    'apps/web/lib/admin/storyboard/resource-invariants.ts',
  );
});

test('asset validation and memory admission edits change both source and policy digests', () => {
  const before = calculateStoryboardRuntimeSourceBinding({ repositoryRoot });
  const executionGates = [
    'apps/web/lib/admin/storyboard/production-assets.ts',
    'apps/web/lib/admin/storyboard/resource-invariants.ts',
  ];
  for (const sourcePath of executionGates) {
    const root = copiedSourceRoot();
    try {
      const absolute = join(root, sourcePath);
      writeFileSync(absolute, `${readFileSync(absolute, 'utf8')}\n// fixture: execution gate drift\n`);
      const after = calculateStoryboardRuntimeSourceBinding({ repositoryRoot: root });
      expect(after.sha256).not.toBe(before.sha256);
      expect(evaluateStoryboardRuntimePolicy(after.sha256).canonicalPolicySha256)
        .not.toBe(evaluateStoryboardRuntimePolicy(before.sha256).canonicalPolicySha256);
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  }
});

test('binds the dynamic budget module, its Python target, and the privileged Storage client', () => {
  const geminiClient = readFileSync(
    join(repositoryRoot, 'apps/web/lib/admin/storyboard/gemini-client.ts'),
    'utf8',
  );
  const providerBudget = readFileSync(
    join(repositoryRoot, 'backend/utils/provider-budget.mjs'),
    'utf8',
  );
  const productionStore = readFileSync(
    join(repositoryRoot, 'apps/web/lib/admin/storyboard/production-store.ts'),
    'utf8',
  );
  expect(geminiClient).toMatch(
    /import\(['"]\.\.\/\.\.\/\.\.\/\.\.\/\.\.\/backend\/utils\/provider-budget\.mjs['"]\)/,
  );
  expect(providerBudget).toMatch(
    /\['-m', 'backend\.utils\.provider_budget', \.\.\.args\]/,
  );
  expect(productionStore).toMatch(
    /from ['"]@\/lib\/supabase\/storage-server['"]/,
  );
  expect(STORYBOARD_RUNTIME_SOURCE_PATHS).toContain('backend/utils/provider-budget.mjs');
  expect(STORYBOARD_RUNTIME_SOURCE_PATHS).toContain('backend/utils/provider_budget.py');
  expect(STORYBOARD_RUNTIME_SOURCE_PATHS).toContain('apps/web/lib/supabase/storage-server.ts');
});

test('budget and Storage execution dependency edits change both source and policy digests', () => {
  const before = calculateStoryboardRuntimeSourceBinding({ repositoryRoot });
  const executionDependencies = [
    'backend/utils/provider-budget.mjs',
    'backend/utils/provider_budget.py',
    'apps/web/lib/supabase/storage-server.ts',
  ];
  for (const sourcePath of executionDependencies) {
    const root = copiedSourceRoot();
    try {
      const absolute = join(root, sourcePath);
      const comment = sourcePath.endsWith('.py') ? '# fixture: execution dependency drift'
        : '// fixture: execution dependency drift';
      writeFileSync(absolute, `${readFileSync(absolute, 'utf8')}\n${comment}\n`);
      const after = calculateStoryboardRuntimeSourceBinding({ repositoryRoot: root });
      expect(after.sha256).not.toBe(before.sha256);
      expect(evaluateStoryboardRuntimePolicy(after.sha256).canonicalPolicySha256)
        .not.toBe(evaluateStoryboardRuntimePolicy(before.sha256).canonicalPolicySha256);
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  }
});

test('fails closed if a declared execution source is missing', () => {
  const root = copiedSourceRoot();
  try {
    rmSync(join(root, STORYBOARD_RUNTIME_SOURCE_PATHS[0]));
    expect(() => calculateStoryboardRuntimeSourceBinding({ repositoryRoot: root })).toThrow();
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});
