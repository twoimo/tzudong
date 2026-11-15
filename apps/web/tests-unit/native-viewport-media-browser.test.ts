import { afterAll, beforeAll, expect, test } from 'bun:test';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { chromium, expect as ui, type Browser, type Frame, type Page } from '@playwright/test';
import { BREAKPOINTS, DESKTOP_MIN_WIDTH_QUERY, TABLET_MIN_WIDTH_QUERY } from '../lib/viewport-breakpoints';
import { NativeViewportProbe } from './fixtures/native-viewport-probe';
import { chromeForTestingExecutable } from './fixtures/chrome-for-testing';
import { compileResponsiveCss } from './fixtures/responsive-css';

const root = path.resolve(import.meta.dir, '..');
const FRACTIONAL_VIEWPORT_ZOOM = 4;
const FRACTIONAL_VIEWPORT_HEIGHT = 1000;
let browser: Browser;
let bundle: string;
const serverMarkup = renderToString(createElement(NativeViewportProbe));

type ProbeWindow = Window & {
  viewportProbe: {
    unmount: () => void;
    mountImmediate: () => void;
    unmountImmediate: () => void;
    activeListeners: () => number;
    redirects: string[];
    installRedirect: (effect: string, continuation?: string) => void;
    removeRedirect: () => void;
    isRouteHidden: (guard: string, hasReviewContinuation?: boolean) => boolean;
    closeReview: (body: string, continuation: string) => { open: boolean; continuation: string | null };
  };
};

beforeAll(async () => {
  const built = await Bun.build({
    entrypoints: ['native-viewport-entry'], target: 'browser', format: 'iife', write: false,
    plugins: [{ name: 'native-viewport', setup(builder) {
      builder.onResolve({ filter: /^native-viewport-entry$/ }, () => ({ path: 'entry', namespace: 'native-viewport' }));
      builder.onResolve({ filter: /^@\// }, args => ({ path: Bun.resolveSync('./' + args.path.slice(2), root) }));
      builder.onLoad({ filter: /.*/, namespace: 'native-viewport' }, () => ({ loader: 'tsx', resolveDir: root, contents: `
        import { createRoot, hydrateRoot } from 'react-dom/client';
        import { NativeViewportProbe, ImmediateViewportProbe } from './tests-unit/fixtures/native-viewport-probe';
        import { DESKTOP_MIN_WIDTH_QUERY } from './lib/viewport-breakpoints';
        import { buildDesktopStampHomeRedirectPath } from './lib/auth/auth-redirect';
        const active = new Map();
        const originalAdd = MediaQueryList.prototype.addEventListener;
        const originalRemove = MediaQueryList.prototype.removeEventListener;
        MediaQueryList.prototype.addEventListener = function(type, listener, options) {
          if (type === 'change') {
            const listeners = active.get(this) ?? new Set();
            listeners.add(listener); active.set(this, listeners);
          }
          return originalAdd.call(this, type, listener, options);
        };
        MediaQueryList.prototype.removeEventListener = function(type, listener, options) {
          if (type === 'change') active.get(this)?.delete(listener);
          return originalRemove.call(this, type, listener, options);
        };
        const root = hydrateRoot(document.getElementById('root'), <NativeViewportProbe />);
        let immediateRoot;
        let removeRedirect = () => {};
        const redirects = [];
        window.viewportProbe = {
          unmount: () => root.unmount(),
          mountImmediate: () => {
            immediateRoot = createRoot(document.getElementById('immediate'));
            immediateRoot.render(<ImmediateViewportProbe />);
          },
          unmountImmediate: () => immediateRoot.unmount(),
          activeListeners: () => [...active.values()].reduce((count, listeners) => count + listeners.size, 0),
          redirects,
          installRedirect: (effect, continuation) => {
            removeRedirect();
            removeRedirect = new Function('setIsMounted', 'router', 'searchParams', 'DESKTOP_MIN_WIDTH_QUERY',
              'reviewContinuationHandled', 'buildDesktopStampHomeRedirectPath', effect)(
              () => {}, { replace: href => redirects.push(href) }, new URLSearchParams(location.search),
              DESKTOP_MIN_WIDTH_QUERY, { current: continuation ?? null }, buildDesktopStampHomeRedirectPath);
          },
          removeRedirect: () => removeRedirect(),
          isRouteHidden: (guard, hasReviewContinuation = false) =>
            new Function('DESKTOP_MIN_WIDTH_QUERY', 'hasReviewContinuation', guard + '; return false')(
              DESKTOP_MIN_WIDTH_QUERY, hasReviewContinuation) === null,
          closeReview: (body, continuation) => {
            let open = true;
            const reviewContinuationHandled = { current: continuation };
            new Function('setIsReviewModalOpen', 'reviewContinuationHandled', 'DESKTOP_MIN_WIDTH_QUERY',
              'router', 'buildDesktopStampHomeRedirectPath', body)(
              value => { open = value; }, reviewContinuationHandled, DESKTOP_MIN_WIDTH_QUERY,
              { replace: href => redirects.push(href) }, buildDesktopStampHomeRedirectPath);
            return { open, continuation: reviewContinuationHandled.current };
          },
        };
      ` }));
    } }],
  });
  if (!built.success) throw new Error('NATIVE_VIEWPORT_FIXTURE_BUILD_FAILED');
  bundle = await built.outputs[0].text();
});

afterAll(async () => { await browser?.close(); });

async function run(width: number, height: number, check: (page: Page) => Promise<void>, hasTouch = false) {
  browser ??= await chromium.launch({ executablePath: chromeForTestingExecutable(), headless: true });
  const context = await browser.newContext({ viewport: { width, height }, hasTouch });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.route('**/*', route => route.fulfill({ contentType: 'text/html', body:
    `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root">${serverMarkup}</div><div id="immediate"></div></body></html>`,
  }));
  try {
    await page.goto('https://viewport.fixture.test/');
    await page.addScriptTag({ content: bundle });
    await ui(page.locator('#viewport-probe')).not.toHaveAttribute('data-home', 'pending');
    await check(page);
    expect(errors).toEqual([]);
  } finally { await context.close(); }
}

async function expectViewport(page: Page | Frame, viewportClass: 'mobile' | 'tablet' | 'desktop', landscape: boolean, touch = false) {
  const mobile = viewportClass === 'mobile';
  const desktop = viewportClass === 'desktop';
  await ui(page.locator('#viewport-probe')).toHaveAttribute('data-home', desktop ? 'desktop' : 'mobileOrTablet');
  await ui(page.locator('#viewport-probe')).toHaveAttribute('data-mobile', String(mobile));
  await ui.poll(async () => JSON.parse(await page.locator('#viewport-probe').innerText())).toEqual({
    isMobile: mobile,
    isTablet: viewportClass === 'tablet',
    isDesktop: desktop,
    isMobileOrTablet: !desktop,
    isLandscape: landscape,
    viewportClass,
    isTouch: touch,
  });
}

async function resizeIframe(page: Page, width: number, height = FRACTIONAL_VIEWPORT_HEIGHT) {
  const iframe = page.locator('#fractional-viewport');
  await iframe.evaluate((element, width) => {
    (element as HTMLIFrameElement).style.width = `${width}px`;
  }, width);
  await ui.poll(() => iframe.evaluate((element, { width, height, tabletQuery, desktopQuery }) => {
    const frame = (element as HTMLIFrameElement).contentWindow;
    if (!frame) throw new Error('NATIVE_VIEWPORT_IFRAME_WINDOW_MISSING');
    const bounds = element.getBoundingClientRect();
    return {
      physicalWidth: bounds.width,
      physicalHeight: bounds.height,
      exactWidth: frame.matchMedia(`(width: ${width}px)`).matches,
      exactHeight: frame.matchMedia(`(height: ${height}px)`).matches,
      tabletOrDesktop: frame.matchMedia(tabletQuery).matches,
      desktop: frame.matchMedia(desktopQuery).matches,
      landscape: frame.matchMedia('(orientation: landscape)').matches,
    };
  }, {
    width, height, tabletQuery: TABLET_MIN_WIDTH_QUERY, desktopQuery: DESKTOP_MIN_WIDTH_QUERY,
  })).toEqual({
    physicalWidth: width * FRACTIONAL_VIEWPORT_ZOOM,
    physicalHeight: height * FRACTIONAL_VIEWPORT_ZOOM,
    exactWidth: true,
    exactHeight: true,
    tabletOrDesktop: width >= 768,
    desktop: width >= 1280,
    landscape: width > height,
  });
}

async function createFractionalViewport(page: Page, width: number, height: number): Promise<Frame> {
  await page.evaluate(({ width, height, zoom }) => {
    const iframe = document.createElement('iframe');
    iframe.id = 'fractional-viewport';
    // Quarter-pixel CSS sizes become whole frame pixels before Chromium's viewport rounding.
    iframe.style.cssText = `display:block;border:0;zoom:${zoom};width:${width}px;height:${height}px`;
    iframe.src = 'https://viewport.fixture.test/';
    document.body.append(iframe);
  }, { width, height, zoom: FRACTIONAL_VIEWPORT_ZOOM });
  const handle = await page.locator('#fractional-viewport').elementHandle();
  const frame = await handle?.contentFrame();
  if (!frame) throw new Error('NATIVE_VIEWPORT_IFRAME_MISSING');
  await frame.waitForURL('https://viewport.fixture.test/');
  await resizeIframe(page, width, height);
  await frame.addScriptTag({ content: bundle });
  await ui(frame.locator('#viewport-probe')).not.toHaveAttribute('data-home', 'pending');
  return frame;
}

test('shared viewport queries preserve the public breakpoints and use gap-free minimum widths', () => {
  expect(BREAKPOINTS).toEqual({ mobileMax: 767, tabletMax: 1279 });
  expect(TABLET_MIN_WIDTH_QUERY).toBe('(min-width: 768px)');
  expect(DESKTOP_MIN_WIDTH_QUERY).toBe('(min-width: 1280px)');
});

test('viewport hooks keep their browser-independent server snapshot', () => {
  expect(serverMarkup).toContain('data-home="pending"');
  expect(serverMarkup).toContain('data-mobile="false"');
  expect(serverMarkup).toContain('&quot;viewportClass&quot;:&quot;desktop&quot;');
});

test('native viewport queries hydrate, cross exact breakpoints, and react to orientation', async () => run(390, 844, async page => {
  await expectViewport(page, 'mobile', false);
  for (const [width, height, viewportClass, landscape] of [
    [767, 1000, 'mobile', false], [768, 1000, 'tablet', false],
    [1279, 1000, 'tablet', true], [1280, 1000, 'desktop', true],
    [1440, 1600, 'desktop', false], [1440, 1440, 'desktop', false],
    [820, 390, 'tablet', true], [390, 844, 'mobile', false],
  ] as const) {
    await page.setViewportSize({ width, height });
    await expectViewport(page, viewportClass, landscape);
  }
}));

test('actual hooks and route guards cover fractional iframe widths on both sides of each breakpoint', async () => run(1440, 1600, async page => {
  const frame = await createFractionalViewport(page, 767.25, 1000);
  await frame.evaluate(() => (window as ProbeWindow).viewportProbe.mountImmediate());
  await ui(frame.locator('#immediate-probe')).toHaveAttribute('data-initial-mobile', 'true');
  const guards = (['feed', 'leaderboard', 'stamp'] as const).map(route => renderGuard(route));
  for (const [width, viewportClass] of [
    [767.25, 'mobile'], [767.75, 'mobile'], [768, 'tablet'],
    [1279.25, 'tablet'], [1279.75, 'tablet'], [1280, 'desktop'],
    [1279.75, 'tablet'], [767.75, 'mobile'],
  ] as const) {
    await resizeIframe(page, width);
    await expectViewport(frame, viewportClass, width > 1000);
    await ui(frame.locator('#immediate-probe')).toHaveText(String(viewportClass !== 'desktop'));
    expect(await frame.evaluate(guards => guards.map(guard =>
      (window as ProbeWindow).viewportProbe.isRouteHidden(guard)), guards))
      .toEqual([width >= 1280, width >= 1280, width >= 1280]);
    expect(await frame.evaluate(guard =>
      (window as ProbeWindow).viewportProbe.isRouteHidden(guard, true), guards[2])).toBe(false);
  }
  await frame.evaluate(() => {
    (window as ProbeWindow).viewportProbe.unmountImmediate();
    (window as ProbeWindow).viewportProbe.unmount();
  });
  expect(await frame.evaluate(() => (window as ProbeWindow).viewportProbe.activeListeners())).toBe(0);
}), 15_000);

test('compiled home readiness CSS agrees with the device hook through fractional desktop boundaries', async () => run(1440, 1600, async page => {
  const frame = await createFractionalViewport(page, 767.75, 1000);
  await frame.addStyleTag({ content: await compileResponsiveCss(['globals.css', 'home-app-globals.css']) });
  await frame.evaluate(() => {
    // Sentinels isolate the readiness/search rules; the actual viewport hook
    // remains mounted alongside them in this verified fractional CSS viewport.
    const skeleton = document.createElement('div');
    skeleton.id = 'home-readiness-skeleton';
    skeleton.setAttribute('data-home-static-skeleton', 'true');
    const badge = document.createElement('div');
    badge.id = 'home-search-status';
    badge.className = 'mobile-map-status-badge';
    document.body.append(skeleton, badge);
  });
  for (const width of [767.75, 768, 1279, 1279.25, 1279.75, 1280, 1280.25, 1279.75]) {
    await resizeIframe(page, width);
    await expectViewport(frame, width >= 1280 ? 'desktop' : width >= 768 ? 'tablet' : 'mobile', width > 1000);
    await frame.evaluate(() => {
      document.documentElement.removeAttribute('data-home-mobile-chrome-ready');
      document.documentElement.removeAttribute('data-mobile-search-open');
    });
    await ui(frame.locator('#home-readiness-skeleton')).toHaveCSS('display', 'block');
    await ui(frame.locator('#home-search-status')).toHaveCSS('display', 'block');
    await frame.evaluate(() => {
      document.documentElement.setAttribute('data-home-mobile-chrome-ready', 'true');
      document.documentElement.setAttribute('data-mobile-search-open', '');
    });
    const expectedDisplay = width < 1280 ? 'none' : 'block';
    await ui(frame.locator('#home-readiness-skeleton')).toHaveCSS('display', expectedDisplay);
    await ui(frame.locator('#home-search-status')).toHaveCSS('display', expectedDisplay);
  }
}), 20_000);

test('touch capability and immediate mobile modal selection survive initial hydration', async () => run(820, 1180, async page => {
  await expectViewport(page, 'tablet', false, true);
  await page.evaluate(() => (window as ProbeWindow).viewportProbe.mountImmediate());
  await ui(page.locator('#immediate-probe')).toHaveAttribute('data-initial-mobile', 'true');
  await ui(page.locator('#immediate-probe')).toHaveText('true');
  await page.setViewportSize({ width: 1280, height: 1180 });
  await expectViewport(page, 'desktop', true, true);
  await ui(page.locator('#immediate-probe')).toHaveText('false');
  await page.evaluate(() => (window as ProbeWindow).viewportProbe.unmountImmediate());
  expect(await page.evaluate(() => (window as ProbeWindow).viewportProbe.activeListeners())).toBeGreaterThan(0);
  await page.evaluate(() => (window as ProbeWindow).viewportProbe.unmount());
  expect(await page.evaluate(() => (window as ProbeWindow).viewportProbe.activeListeners())).toBe(0);
  await page.setViewportSize({ width: 390, height: 844 });
  await ui(page.locator('#root')).toBeEmpty();
}, true));

function redirectEffect(route: 'feed' | 'leaderboard' | 'stamp') {
  const source = readFileSync(path.join(root, 'app', route, 'page.tsx'), 'utf8');
  const match = source.match(/useEffect\(\(\) => \{\s*(setIsMounted\(true\);[\s\S]*?)\n    \}, \[router(?:, searchParams)?\]\);/);
  if (!match) throw new Error('NATIVE_VIEWPORT_REDIRECT_EFFECT_MISSING');
  return match[1];
}

function renderGuard(route: 'feed' | 'leaderboard' | 'stamp') {
  const source = readFileSync(path.join(root, 'app', route, 'page.tsx'), 'utf8');
  const match = source.match(/^\s*if \(typeof window !== 'undefined' && .*return null;$/m);
  if (!match) throw new Error('NATIVE_VIEWPORT_ROUTE_RENDER_GUARD_MISSING');
  return match[0];
}

for (const route of ['feed', 'leaderboard', 'stamp'] as const) {
  test(`${route} redirects only on desktop entry from fractional widths and removes its media subscription`, async () => run(1440, 1600, async page => {
    const frame = await createFractionalViewport(page, 1279.25, 1000);
    const query = route === 'feed' ? '?review=fixture-review' : '';
    const expected = route === 'feed' ? '/?panel=feed&review=fixture-review' : `/?panel=${route}`;
    await frame.evaluate(({ route, query, effect }) => {
      history.replaceState({}, '', `/${route}${query}`);
      (window as ProbeWindow).viewportProbe.installRedirect(effect);
    }, { route, query, effect: redirectEffect(route) });
    expect(await frame.evaluate(() => (window as ProbeWindow).viewportProbe.redirects)).toEqual([]);
    await resizeIframe(page, 1279.75);
    await expectViewport(frame, 'tablet', true);
    expect(await frame.evaluate(() => (window as ProbeWindow).viewportProbe.redirects)).toEqual([]);
    await resizeIframe(page, 1280);
    await ui.poll(() => frame.evaluate(() => (window as ProbeWindow).viewportProbe.redirects)).toEqual([expected]);
    await resizeIframe(page, 1440);
    await expectViewport(frame, 'desktop', true);
    expect(await frame.evaluate(() => (window as ProbeWindow).viewportProbe.redirects)).toEqual([expected]);
    await frame.evaluate(() => (window as ProbeWindow).viewportProbe.removeRedirect());
    await resizeIframe(page, 1279);
    await expectViewport(frame, 'tablet', true);
    await resizeIframe(page, 1280);
    await expectViewport(frame, 'desktop', true);
    expect(await frame.evaluate(() => (window as ProbeWindow).viewportProbe.redirects)).toEqual([expected]);
    await frame.evaluate(() => (window as ProbeWindow).viewportProbe.unmount());
    expect(await frame.evaluate(() => (window as ProbeWindow).viewportProbe.activeListeners())).toBe(0);
  }));
}

test('stamp review close uses the same desktop boundary in a fractional iframe', async () => run(1440, 1600, async page => {
  const frame = await createFractionalViewport(page, 1279.25, 1000);
  const source = readFileSync(path.join(root, 'app/stamp/page.tsx'), 'utf8');
  const body = source.split('{/* 리뷰 모달 (Review Modal) */}')[1]
    .split('onClose={() => {')[1].split('}}\n                    restaurant=')[0];
  const id = '11111111-1111-4111-8111-111111111111';
  await frame.evaluate(id => history.replaceState({}, '', `/stamp?restaurant=${id}&writeReview=1`), id);
  for (const width of [1279.25, 1279.75, 1280]) {
    await resizeIframe(page, width);
    const result = await frame.evaluate(({ body, id }) =>
      (window as ProbeWindow).viewportProbe.closeReview(body, id), { body, id });
    expect(result).toEqual({ open: false, continuation: null });
    expect(await frame.evaluate(() => (window as ProbeWindow).viewportProbe.redirects))
      .toEqual(width >= 1280 ? [`/?restaurant=${id}&panel=stamp`] : []);
  }
}));

test('stamp preserves review continuation and path guards on initial desktop entry', async () => run(1440, 1000, async page => {
  const id = '11111111-1111-4111-8111-111111111111';
  const effect = redirectEffect('stamp');
  for (const [url, continuation] of [
    [`/stamp?restaurant=${id}&writeReview=1`, undefined],
    [`/stamp?restaurant=${id}`, id],
    [`/feed?restaurant=${id}`, undefined],
  ] as const) {
    await page.evaluate(({ url, effect, continuation }) => {
      history.replaceState({}, '', url);
      (window as ProbeWindow).viewportProbe.installRedirect(effect, continuation);
    }, { url, effect, continuation });
    expect(await page.evaluate(() => (window as ProbeWindow).viewportProbe.redirects)).toEqual([]);
  }
  await page.evaluate(({ id, effect }) => {
    history.replaceState({}, '', `/stamp?restaurant=${id}`);
    (window as ProbeWindow).viewportProbe.installRedirect(effect);
  }, { id, effect });
  expect(await page.evaluate(() => (window as ProbeWindow).viewportProbe.redirects)).toEqual([`/?restaurant=${id}&panel=stamp`]);
}));
