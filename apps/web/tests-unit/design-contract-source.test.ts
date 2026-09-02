import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const repoRoot = resolve(import.meta.dir, '..', '..', '..');
const appRoot = join(repoRoot, 'apps', 'web');
const repoSource = (relativePath: string) => readFileSync(join(repoRoot, relativePath), 'utf8');
const appSource = (relativePath: string) => readFileSync(join(appRoot, relativePath), 'utf8');

describe('repo design contract source', () => {
  test('docs/product/DESIGN.md contains the required durable design checklist sections', () => {
    const designSource = repoSource('docs/product/DESIGN.md');

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

  test('current admin/home UI surfaces use documented semantic typography tokens', () => {
    const designSource = repoSource('docs/product/DESIGN.md');
    const appGlobalsSource = appSource('app/app-globals.css');
    const adminConsoleSource = appSource('components/admin/AdminConsoleOverview.tsx');
    const adminOverviewSource = appSource('components/admin/AdminOverviewDashboard.tsx');
    const headerSource = appSource('components/layout/Header.tsx');
    const announcementPanelSource = appSource('components/announcement/AnnouncementPanel.tsx');

    expect(designSource).toContain('warm ivory');
    expect(designSource).toContain('red primary');
    expect(designSource).toContain('Pretendard for Korean UI/body density');
    expect(designSource).toContain('Noto Serif KR remains the intentional display/editorial role');
    expect(appGlobalsSource).toContain('--font-sans: var(--font-pretendard');
    expect(appGlobalsSource).toContain('--font-noto-serif-kr: var(--font-display');
    expect(appGlobalsSource).toContain('@apply bg-background text-foreground font-sans tracking-normal;');
    expect(appGlobalsSource).not.toContain("font-family: 'Noto Serif KR'");
    expect(appGlobalsSource).not.toContain('@apply bg-background text-foreground font-serif tracking-tight;');
    expect(appGlobalsSource).toContain('@import "../styles/light-root-tokens.css";');
    expect(appSource('styles/light-root-tokens.css')).toContain('--primary: 0 74% 42%');
    expect(appGlobalsSource).toContain('--shadow-primary');
    expect(adminConsoleSource).toContain('rounded-2xl border border-border');
    expect(adminConsoleSource).toContain('shadow-primary');
    expect(adminConsoleSource).not.toContain('공지사항');
    expect(announcementPanelSource).toContain('쯔동여지도 공지');
    expect(adminConsoleSource).toContain('사용자 관리');
    expect(adminOverviewSource).toContain('aria-label="관리자 지도 운영 개요 2분할"');
    expect(adminOverviewSource).toContain('getNaverIndividualMarkerVisual');
    expect(headerSource).toContain('font-sans');
    expect(headerSource).toContain('bg-red-800 hover:bg-red-900');
    expect(designSource).toContain('StyleGallery');
    expect(designSource).toContain('data-horizontal-scroll-owner');
    expect(designSource).toContain('mobile-theme-filter-reel');
    expect(designSource).toContain('command-surface');
  });

  test('public surface inventory contract exists as the slice-1 page matrix owner', () => {
    expect(appSource('tests-unit/public-surface-design-contract.test.ts')).toContain(
      'page inventory is exactly the 29-row matrix',
    );
    expect(appSource('tests-unit/public-surface-design-contract.test.ts')).toContain(
      'pins all five CSS owner-to-importer mappings',
    );
  });
});
