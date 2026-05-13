import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const repoRoot = resolve(import.meta.dir, '..', '..', '..');
const appRoot = join(repoRoot, 'apps', 'web');
const repoSource = (relativePath: string) => readFileSync(join(repoRoot, relativePath), 'utf8');
const appSource = (relativePath: string) => readFileSync(join(appRoot, relativePath), 'utf8');

describe('repo design contract source', () => {
  test('DESIGN.md contains the required durable design checklist sections', () => {
    const designSource = repoSource('DESIGN.md');

    for (const heading of [
      '## Source of truth',
      '## Brand',
      '## Product goals',
      '## Personas and jobs',
      '## Information architecture',
      '## Design principles',
      '## Visual language',
      '## Components',
      '## Accessibility',
      '## Responsive behavior',
      '## Interaction states',
      '## Content voice',
      '## Implementation constraints',
      '## Open questions',
    ]) {
      expect(designSource).toContain(heading);
    }
  });

  test('current admin/home UI surfaces use the documented warm editorial token family', () => {
    const designSource = repoSource('DESIGN.md');
    const appGlobalsSource = appSource('app/app-globals.css');
    const adminConsoleSource = appSource('components/admin/AdminConsoleOverview.tsx');
    const headerSource = appSource('components/layout/Header.tsx');

    expect(designSource).toContain('warm ivory');
    expect(designSource).toContain('red primary');
    expect(designSource).toContain('Noto Serif KR');
    expect(appGlobalsSource).toContain("font-family: 'Noto Serif KR'");
    expect(appGlobalsSource).toContain('--primary: 0 74% 42%');
    expect(appGlobalsSource).toContain('--shadow-primary');
    expect(adminConsoleSource).toContain('bg-gradient-to-br from-card via-card to-primary/5');
    expect(adminConsoleSource).toContain('rounded-2xl border border-border');
    expect(adminConsoleSource).toContain('shadow-primary');
    expect(headerSource).toContain('font-serif');
    expect(headerSource).toContain('bg-red-800 hover:bg-red-900');
  });
});
