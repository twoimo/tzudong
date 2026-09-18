import { afterAll, describe, expect, test } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const appRoot = resolve(import.meta.dir, '..');
const tempDirs: string[] = [];

const source = (relativePath: string) =>
  readFileSync(join(appRoot, relativePath), 'utf8');

afterAll(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

const DEFERRED_PANEL_BARREL = '@/components/map/map-view-deferred-panels';
const PANEL_MODULE_SPECIFIERS = [
  '@/components/restaurant/RestaurantDetailPanel',
  '@/components/reviews/ReviewModal',
] as const;

// Every module reachable from the home route that renders the restaurant detail
// panel or the review modal. The home Tailwind entry (app/home-app-globals.css)
// does not scan components/restaurant or components/reviews, so these modules
// must pull app/home-detail-globals.css in with them.
const HOME_ROUTE_PANEL_OWNERS = [
  'components/home/home-desktop-control-panel.tsx',
  'components/home/home-map-container.tsx',
  'components/map/naver-map-sidepanels.tsx',
  'components/map/map-view-sidepanels.tsx',
  'components/layout/OverlayPagePanel.tsx',
] as const;

function moduleSpecifiers(css: string) {
  return [...css.matchAll(/(?:from\s*|import\(\s*)['"]([^'"]+)['"]/g)].map(
    (match) => match[1]!,
  );
}

describe('home detail stylesheet ownership', () => {
  test('the deferred-panel barrel is the single carrier of the detail stylesheet', () => {
    const barrel = source('components/map/map-view-deferred-panels.tsx');

    expect(barrel).toContain("import '@/app/home-detail-globals.css'");
    for (const specifier of PANEL_MODULE_SPECIFIERS) {
      expect(barrel).toContain(specifier);
    }
  });

  test('home-route panel modules load the panel through the barrel, not directly', () => {
    for (const relativePath of HOME_ROUTE_PANEL_OWNERS) {
      const specifiers = moduleSpecifiers(source(relativePath));

      for (const forbidden of PANEL_MODULE_SPECIFIERS) {
        expect(
          specifiers,
          `${relativePath} must not import ${forbidden} directly: it would drop app/home-detail-globals.css`,
        ).not.toContain(forbidden);
      }

      expect(
        specifiers,
        `${relativePath} should load panels through ${DEFERRED_PANEL_BARREL}`,
      ).toContain(DEFERRED_PANEL_BARREL);
    }
  });

  test('the detail Tailwind entry emits the utilities the panel depends on', () => {
    const workDir = mkdtempSync(join(tmpdir(), 'tzudong-home-detail-css-'));
    tempDirs.push(workDir);
    const outputPath = join(workDir, 'detail.css');

    execFileSync(
      'node',
      [
        './node_modules/@tailwindcss/cli/dist/index.mjs',
        '-i',
        join(appRoot, 'app', 'home-detail-globals.css'),
        '-o',
        outputPath,
        '--cwd',
        appRoot,
      ],
      {
        cwd: appRoot,
        env: {
          ...process.env,
          BASELINE_BROWSER_MAPPING_IGNORE_OLD_DATA: 'true',
          BROWSERSLIST_IGNORE_OLD_DATA: 'true',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );

    const css = readFileSync(outputPath, 'utf8');

    // Without these the video play badge and its `영상 N` chip render unstyled:
    // no background, no ring, and the chip falls back to its static position.
    expect(css).toContain('.top-2');
    expect(css).toContain('.bg-black\\/55');
    expect(css).toContain('.bg-black\\/70');
    expect(css).toContain('.ring-1');
    expect(css).toContain('.backdrop-blur-\\[1px\\]');
    expect(css).toContain('.aspect-video');
  }, 60_000);
});
