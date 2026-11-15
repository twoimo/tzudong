import { afterAll, beforeAll, expect, test } from 'bun:test';
import { chromium, expect as ui, type Browser, type Page } from '@playwright/test';
import { AUTH_NAV_ROUTES } from '../components/layout/navigation-routes';
import { chromeForTestingExecutable } from './fixtures/chrome-for-testing';
import { buildMobileBottomNavPrefetchFixture } from './fixtures/mobile-bottom-nav-prefetch-fixture';

type NavEvent = { kind: 'prefetch' | 'push'; path: string };
type FixtureState = {
  pathname: string;
  user: { id: string } | null;
  events: NavEvent[];
  authRequests: Array<{ source?: string; route?: string; reason?: string }>;
  throwPrefetch: boolean;
  effectsReady: boolean;
  flushIdle: () => void;
};
type FixtureWindow = Window & { __bottomNavFixture: FixtureState };

let browser: Browser;
let script: string;
beforeAll(async () => { script = await buildMobileBottomNavPrefetchFixture(); });
afterAll(async () => { await browser?.close(); });

async function state(page: Page) {
  return page.evaluate(() => {
    const value = (window as FixtureWindow).__bottomNavFixture;
    return { events: value.events, authRequests: value.authRequests };
  });
}
async function reset(page: Page) {
  await page.evaluate(() => {
    (window as FixtureWindow).__bottomNavFixture.events = [];
    (window as FixtureWindow).__bottomNavFixture.authRequests = [];
  });
}
async function run(options: { width?: number; pathname?: string; loggedIn?: boolean; idle?: boolean }, check: (page: Page) => Promise<void>) {
  // This deliberately uses the repository's exact browser verifier. A missing
  // or unlaunchable local browser must not become a false passing test.
  browser ??= await chromium.launch({ executablePath: chromeForTestingExecutable(), headless: true });
  const width = options.width ?? 390;
  const context = await browser.newContext({ viewport: { width, height: width === 820 ? 1180 : 844 }, isMobile: true, hasTouch: true });
  const page = await context.newPage();
  const errors: string[] = [], external: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.clock.install();
  await page.addInitScript(({ pathname, loggedIn, idle }) => {
    let nextId = 0;
    const callbacks = new Map<number, () => void>();
    (window as FixtureWindow).__bottomNavFixture = {
      pathname, user: loggedIn ? { id: 'synthetic-nav-user' } : null,
      events: [], authRequests: [], throwPrefetch: false, effectsReady: false,
      flushIdle() {
        if (callbacks.size > 20) throw new Error('FIXTURE_IDLE_QUEUE_UNBOUNDED');
        const queued = [...callbacks.values()]; callbacks.clear(); queued.forEach(callback => callback());
      },
    };
    Object.defineProperty(window, 'requestIdleCallback', { configurable: true, value: idle
      ? (callback: () => void) => { const id = ++nextId; callbacks.set(id, callback); return id; } : undefined });
    Object.defineProperty(window, 'cancelIdleCallback', { configurable: true, value: idle
      ? (id: number) => { callbacks.delete(id); } : undefined });
  }, { pathname: options.pathname ?? '/', loggedIn: options.loggedIn ?? false, idle: options.idle ?? true });
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.origin !== 'https://bottom-nav-intent.test' || route.request().resourceType() !== 'document') {
      external.push(url.origin); return route.abort();
    }
    return route.fulfill({ contentType: 'text/html', body: '<!doctype html><html lang="ko"><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="icon" href="data:,"></head><body><div id="root"></div></body></html>' });
  });
  try {
    await page.goto('https://bottom-nav-intent.test' + (options.pathname ?? '/'));
    await page.addScriptTag({ content: script });
    await ui(page.getByTestId('bottom-nav')).toBeVisible();
    await ui.poll(() => page.evaluate(() => (window as FixtureWindow).__bottomNavFixture.effectsReady)).toBe(true);
    expect(await page.evaluate(() => innerWidth)).toBe(width);
    await check(page);
    expect(errors).toEqual([]); expect(external).toEqual([]);
  } finally { await context.close(); }
}

for (const width of [390, 820]) for (const idle of [true, false]) {
  test(`home does not fetch unchosen routes at ${width}px with ${idle ? 'idle callbacks' : 'timer fallback'}`, async () => {
    await run({ width, idle }, async page => {
      await page.evaluate(() => (window as FixtureWindow).__bottomNavFixture.flushIdle());
      await page.clock.runFor(3000);
      await page.evaluate(() => (window as FixtureWindow).__bottomNavFixture.flushIdle());
      expect(await state(page)).toEqual({ events: [], authRequests: [] });
    });
  }, 30_000);
}

test('hover and keyboard focus prefetch their target, while an active home intent stays idle', async () => {
  await run({}, async page => {
    const home = page.getByTestId('bottom-nav-home');
    await home.hover(); await home.focus();
    expect((await state(page)).events).toEqual([]);
    await page.getByTestId('bottom-nav-feed').hover();
    expect((await state(page)).events).toEqual([{ kind: 'prefetch', path: '/feed' }]);
    await reset(page);
    const stamp = page.getByTestId('bottom-nav-stamp');
    await stamp.focus();
    expect((await state(page)).events).toEqual([{ kind: 'prefetch', path: '/stamp' }]);
    await stamp.press('Enter');
    expect((await state(page)).events.filter(event => event.kind === 'push')).toEqual([{ kind: 'push', path: '/stamp' }]);
  });
}, 30_000);

test('touch intent starts prefetch before navigation, and prefetch failure does not block a click', async () => {
  await run({}, async page => {
    const box = await page.getByTestId('bottom-nav-leaderboard').boundingBox();
    if (!box) throw new Error('TOUCH_NAVIGATION_TARGET_MISSING');
    const session = await page.context().newCDPSession(page);
    await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: box.x + box.width / 2, y: box.y + box.height / 2, id: 1 }] });
    // Inspect before releasing the touch: click's own prefetch cannot make
    // this assertion pass if touch-start intent handling is accidentally lost.
    const beforeRelease = (await state(page)).events;
    expect(beforeRelease.some(event => event.kind === 'prefetch' && event.path === '/leaderboard')).toBe(true);
    expect(beforeRelease.filter(event => event.kind === 'push')).toEqual([]);
    await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await session.detach();
    await ui.poll(async () => (await state(page)).events.filter(event => event.kind === 'push').length).toBe(1);
    const events = (await state(page)).events;
    expect(events.filter(event => event.kind === 'push')).toEqual([{ kind: 'push', path: '/leaderboard' }]);
    expect(events.findIndex(event => event.kind === 'prefetch' && event.path === '/leaderboard'))
      .toBeLessThan(events.findIndex(event => event.kind === 'push'));
    await reset(page);
    await page.evaluate(() => { (window as FixtureWindow).__bottomNavFixture.throwPrefetch = true; });
    await page.getByTestId('bottom-nav-feed').click();
    expect((await state(page)).events.filter(event => event.kind === 'push')).toEqual([{ kind: 'push', path: '/feed' }]);
  });
}, 30_000);

test('anonymous MY activation requests auth without navigating', async () => {
  await run({}, async page => {
    await page.getByTestId('bottom-nav-my').click();
    await ui.poll(async () => (await state(page)).authRequests.length).toBe(1);
    const result = await state(page);
    expect(result.events.filter(event => event.kind === 'push')).toEqual([]);
    expect(result.authRequests[0]).toEqual(expect.objectContaining({ source: 'mobile-bottom-nav-my', route: '/', reason: 'mypage' }));
  });
}, 30_000);

test('signed-in MY intent keeps account subroutes warm and non-home mounting retains automatic warming', async () => {
  await run({ loggedIn: true }, async page => {
    await page.getByTestId('bottom-nav-my').focus();
    const result = await state(page);
    expect(result.events.map(event => event.path)).toEqual([...AUTH_NAV_ROUTES]);
    expect(result.authRequests).toEqual([]);
  });
  await run({ pathname: '/feed' }, async page => {
    expect((await state(page)).events).toEqual(['/', '/feed', '/stamp', '/leaderboard', '/mypage/profile']
      .map(path => ({ kind: 'prefetch', path })));
  });
}, 30_000);
