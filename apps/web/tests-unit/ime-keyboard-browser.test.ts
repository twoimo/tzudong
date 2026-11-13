import { afterAll, beforeAll, expect, test } from 'bun:test';
import { chromium, expect as browserExpect, type Browser, type Locator, type Page } from '@playwright/test';
import { chromeForTestingExecutable } from './fixtures/chrome-for-testing';
import { buildImeBrowserFixture } from './fixtures/ime-keyboard';

let browser: Browser;
let script: string;

beforeAll(async () => {
  script = await buildImeBrowserFixture();
  browser = await chromium.launch({ executablePath: chromeForTestingExecutable(), headless: true });
}, 30_000);

afterAll(async () => { await browser?.close(); });

async function withFixture(run: (page: Page) => Promise<void>) {
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', route => route.abort());
    await page.setContent('<!doctype html><html lang="ko"><body><div id="root"></div></body></html>');
    await page.addScriptTag({ content: script });
    await run(page);
    expect(errors).toEqual([]);
  } finally {
    await context.close();
  }
}

// Playwright cannot drive an OS IME. Dispatch the native event sequences that
// reach React, including Safari's compositionend-before-Enter/keyCode 229 case.
async function keydown(target: Locator, init: KeyboardEventInit) {
  const result = await target.evaluate((element, properties) => {
    const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...properties });
    element.dispatchEvent(event);
    return { prevented: event.defaultPrevented, keyCode: event.keyCode, isComposing: event.isComposing };
  }, init);
  expect(result.keyCode).toBe(init.keyCode ?? 0);
  expect(result.isComposing).toBe(init.isComposing ?? false);
  return result.prevented;
}

for (const kind of ['admin', 'submission']) {
  test(`${kind} category waits for Korean IME confirmation and adds once on a later Enter`, async () => {
    await withFixture(async page => {
      const section = page.locator(`[data-fixture="${kind}"]`);
      const input = section.getByRole('textbox');
      await input.fill('한');
      await input.dispatchEvent('compositionstart', { data: '한' });
      await input.fill('한식');
      expect(await keydown(input, { key: 'Enter', code: 'Enter', keyCode: 13, isComposing: true })).toBe(true);
      await browserExpect(input).toHaveValue('한식');
      await browserExpect(section.locator('[data-categories]')).toHaveText('[]');

      await input.dispatchEvent('compositionend', { data: '한식' });
      expect(await keydown(input, { key: 'Enter', code: 'Enter', keyCode: 229, isComposing: false })).toBe(true);
      await browserExpect(input).toHaveValue('한식');
      await browserExpect(section.locator('[data-categories]')).toHaveText('[]');
      await browserExpect(section.locator('[data-submits]')).toHaveText('0');

      await input.press('Enter');
      await browserExpect(section.locator('[data-categories]')).toHaveText('["한식"]');
      await browserExpect(input).toHaveValue('');
      await input.press('Enter');
      await input.fill('한식');
      await input.press('Enter');
      await browserExpect(section.locator('[data-categories]')).toHaveText('["한식"]');
      await browserExpect(input).toHaveValue(kind === 'admin' ? '' : '한식');
      await input.fill('분식');
      await input.press('Escape');
      expect(await keydown(input, { key: 'a', keyCode: 229 })).toBe(false);
      await browserExpect(input).toHaveValue('분식');
      await browserExpect(section.locator('[data-submits]')).toHaveText('0');
    });
  }, 20_000);
}

test('inline text keeps composing Enter/Escape in the editor and preserves normal commit, focus and undo', async () => {
  await withFixture(async page => {
    const section = page.locator('[data-fixture="inline"]');
    const input = section.getByRole('textbox');
    await input.fill('한상 문구');
    await input.dispatchEvent('compositionstart', { data: '문구' });
    expect(await keydown(input, { key: 'Enter', keyCode: 13, isComposing: true })).toBe(true);
    expect(await keydown(input, { key: 'Escape', keyCode: 27, isComposing: true })).toBe(false);
    await input.dispatchEvent('compositionend', { data: '문구' });
    expect(await keydown(input, { key: 'Enter', keyCode: 229 })).toBe(true);
    expect(await keydown(input, { key: 'Escape', keyCode: 229 })).toBe(false);
    await browserExpect(input).toHaveText('한상 문구');
    await browserExpect(input).toBeFocused();
    await browserExpect(section.locator('[data-commits]')).toHaveText('0');
    await browserExpect(section.locator('[data-bubbled]')).toHaveText('0');

    await input.press('Control+z');
    await browserExpect(section.locator('[data-undos]')).toHaveText('1');
    await input.press('Enter');
    await browserExpect(input).toHaveCount(0);
    await browserExpect(section.locator('[data-commits]')).toHaveText('1');
    await browserExpect(section.locator('canvas')).toBeFocused();

    await section.getByRole('button', { name: 'Edit again' }).click();
    await input.press('Escape');
    await browserExpect(input).toHaveCount(0);
    await browserExpect(section.locator('[data-commits]')).toHaveText('2');
    await browserExpect(section.locator('canvas')).toBeFocused();
  });
}, 20_000);

test('thumbnail chat suppresses Safari 229 after compositionend and preserves Enter/Shift+Enter', async () => {
  await withFixture(async page => {
    const section = page.locator('[data-fixture="chat"]');
    const input = section.getByRole('textbox');
    await input.fill('한식 썸네일');
    await input.dispatchEvent('compositionstart', { data: '썸네일' });
    await keydown(input, { key: 'Enter', keyCode: 13, isComposing: false });
    await input.dispatchEvent('compositionend', { data: '썸네일' });
    await keydown(input, { key: 'Enter', keyCode: 13, isComposing: true });
    await keydown(input, { key: 'Enter', keyCode: 229 });
    await browserExpect(input).toHaveValue('한식 썸네일');
    await browserExpect(section.locator('[data-sends]')).toHaveText('0');

    await input.press('End');
    await input.press('Shift+Enter');
    await browserExpect(input).toHaveValue('한식 썸네일\n');
    await browserExpect(section.locator('[data-sends]')).toHaveText('0');
    await input.press('Enter');
    await browserExpect(section.locator('[data-sends]')).toHaveText('1');
    await input.press('Escape');
    await browserExpect(section.locator('[data-sends]')).toHaveText('1');
  });
}, 20_000);
