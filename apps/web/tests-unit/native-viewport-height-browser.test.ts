import { afterAll, beforeAll, expect, test } from 'bun:test';
import { join } from 'node:path';
import postcss from 'postcss';
import tailwind from '@tailwindcss/postcss';
import { chromium, expect as ui, type Browser, type Page } from '@playwright/test';
import { chromeForTestingExecutable } from './fixtures/chrome-for-testing';

const root = join(import.meta.dir, '..');
const stylesheets = {
  root: ['globals.css'],
  home: ['globals.css', 'home-app-globals.css'],
  detail: ['globals.css', 'home-app-globals.css', 'home-detail-globals.css'],
  deferred: ['globals.css', 'home-app-globals.css', 'home-deferred-globals.css'],
  app: ['globals.css', 'app-globals.css'],
} as const;
type Stylesheet = keyof typeof stylesheets;
const compiled = new Map<Stylesheet, string>();
let browser: Browser;

beforeAll(async () => {
  for (const name of Object.keys(stylesheets) as Stylesheet[]) {
    const source = stylesheets[name].map(file => `@import "./app/${file}";`).join('\n');
    const result = await postcss([tailwind()]).process(source, {
      from: join(root, `native-viewport-${name}-fixture.css`),
    });
    compiled.set(name, result.css);
  }
}, 60000);

afterAll(async () => { await browser?.close(); });

async function run(
  stylesheet: Stylesheet,
  check: (page: Page) => Promise<void>,
  { local = false, legal = false }: { local?: boolean; legal?: boolean } = {},
) {
  browser ??= await chromium.launch({ executablePath: chromeForTestingExecutable(), headless: true });
  // The application cannot run a resize handler or bootstrap in this context.
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 }, javaScriptEnabled: false,
  });
  const page = await context.newPage();
  await page.route('**/*', route => route.fulfill({
    contentType: 'text/html',
    body: `<!doctype html><html ${local ? 'data-local-workspace="true"' : ''}><head>
      <meta name="viewport" content="width=device-width, initial-scale=1">
      <style>${compiled.get(stylesheet)}</style></head><body>
      ${local ? '<aside data-local-workspace-banner="true"></aside>' : ''}
      <div data-local-workspace-app="true"><main id="screen"
        ${legal ? 'data-legal-page="true" style="min-height:1900px"' : 'style="height:var(--full-height);overflow:auto"'}>
        <div style="height:1800px">Viewport content</div>
      </main></div></body></html>`,
  }));
  try {
    await page.goto('http://native-viewport-height.fixture.test/');
    await check(page);
  } finally { await context.close(); }
}

for (const stylesheet of Object.keys(stylesheets) as Stylesheet[]) {
  test(`${stylesheet} CSS follows viewport height before JavaScript at every layout size`, async () => run(stylesheet, async page => {
    for (const [width, height] of [[390, 844], [390, 620], [820, 1180], [1280, 900], [1440, 700]]) {
      await page.setViewportSize({ width, height });
      await ui.poll(async () => (await page.locator('#screen').boundingBox())?.height).toBe(height);
      await ui.poll(async () => (await page.locator('[data-local-workspace-app]').boundingBox())?.height).toBe(height);
      expect(await page.locator('#screen').evaluate(element => element.scrollHeight)).toBeGreaterThan(height);
      expect(await page.evaluate(() => document.documentElement.style.getPropertyValue('--full-height'))).toBe('');
    }
  }));
}

test('native viewport sizing subtracts a local banner and still responds to height changes', async () => run('home', async page => {
  await page.evaluate(() => document.documentElement.style.setProperty('--local-workspace-banner-height', '32px'));
  for (const height of [844, 620]) {
    await page.setViewportSize({ width: 390, height });
    await ui.poll(async () => (await page.locator('[data-local-workspace-banner]').boundingBox())?.height).toBe(32);
    await ui.poll(async () => (await page.locator('#screen').boundingBox())?.height).toBe(height - 32);
    expect((await page.locator('#screen').boundingBox())?.y).toBe(32);
  }
}, { local: true }));

test('legal documents retain document scrolling inside the native viewport shell', async () => run('root', async page => {
  await ui.poll(async () => (await page.locator('[data-local-workspace-app]').boundingBox())?.height).toBeGreaterThan(1800);
  expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBeGreaterThan(1800);
  await page.keyboard.press('PageDown');
  await ui.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
}, { local: true, legal: true }));
