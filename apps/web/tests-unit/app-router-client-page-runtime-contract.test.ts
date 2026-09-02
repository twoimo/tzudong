import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

const appDir = join(import.meta.dir, '..', 'app');
const SKIP_DIRS = new Set([
  'node_modules',
  '.next',
  'dist',
  'coverage',
  'tests',
  'tests-unit',
  'test',
  'fixtures',
]);
const SEGMENT_CONFIG_EXPORT = /^export const (runtime|preferredRegion|dynamic|revalidate|fetchCache|dynamicParams)\s*=/m;

function walkNamedFiles(root: string, names: ReadonlySet<string>): string[] {
  const found: string[] = [];
  const visit = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue;
        visit(fullPath);
        continue;
      }
      if (names.has(entry.name)) {
        found.push(relative(root, fullPath).split('\\').join('/'));
      }
    }
  };
  visit(root);
  return found.sort();
}

function isClientModule(source: string) {
  const firstLine = source.split('\n').find((line) => line.trim().length > 0) ?? '';
  return (
    firstLine === "'use client';"
    || firstLine === '"use client";'
    || firstLine === "'use client'"
    || firstLine === '"use client"'
  );
}

describe('app router client page segment config contract', () => {
  test('client page and layout roots do not export server-only segment configs', () => {
    const clientRoots: string[] = [];

    for (const relativePath of walkNamedFiles(appDir, new Set(['page.tsx', 'layout.tsx']))) {
      const source = readFileSync(join(appDir, relativePath), 'utf8');
      if (!isClientModule(source)) continue;
      clientRoots.push(relativePath);
      expect(source, relativePath).not.toMatch(SEGMENT_CONFIG_EXPORT);
    }

    expect(clientRoots.length).toBeGreaterThan(0);
    expect(clientRoots).not.toContain('admin/evaluations/page.tsx');
    expect(clientRoots).not.toContain('admin/submissions/page.tsx');
    expect(clientRoots).not.toContain('page.tsx');

    const homePageSource = readFileSync(join(appDir, 'page.tsx'), 'utf8');
    const homeClientSource = readFileSync(join(appDir, 'home-client.tsx'), 'utf8');
    const homeRuntimeShellSource = readFileSync(join(appDir, 'home-runtime-shell.tsx'), 'utf8');
    expect(isClientModule(homePageSource)).toBe(false);
    expect(homePageSource).not.toMatch(SEGMENT_CONFIG_EXPORT);
    expect(homePageSource).toContain("import HomeClient from './home-client'");
    expect(isClientModule(homeClientSource)).toBe(true);
    expect(homeClientSource).not.toMatch(SEGMENT_CONFIG_EXPORT);
    expect(isClientModule(homeRuntimeShellSource)).toBe(true);
    expect(homeRuntimeShellSource).not.toMatch(SEGMENT_CONFIG_EXPORT);
  });

  test('legacy evaluations route stays a server redirect into the admin console', () => {
    const routeSource = readFileSync(join(appDir, 'admin/evaluations/page.tsx'), 'utf8');
    const moduleSource = readFileSync(join(appDir, 'admin/evaluations/admin-evaluation-page.tsx'), 'utf8');
    const overviewSource = readFileSync(join(appDir, '..', 'components/admin/AdminConsoleOverview.tsx'), 'utf8');

    expect(isClientModule(routeSource)).toBe(false);
    expect(routeSource).toContain("redirect(buildCanonicalAdminEvaluationsHref");
    expect(routeSource).toContain("export const dynamic = 'force-dynamic'");
    expect(routeSource).toContain('await searchParams');
    expect(routeSource).not.toContain('EvaluationTableNew');

    expect(isClientModule(moduleSource)).toBe(true);
    expect(moduleSource).toContain('AdminEvaluationRoutePage.Embedded = AdminEvaluationPageWrapper');
    expect(overviewSource).toContain('import("@/app/admin/evaluations/admin-evaluation-page")');
    expect(overviewSource).not.toContain('import("@/app/admin/evaluations/page")');
  });
});
