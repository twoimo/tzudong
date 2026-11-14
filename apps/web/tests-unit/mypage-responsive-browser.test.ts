import { afterAll, beforeAll, expect, test } from 'bun:test';
import { chromium, expect as ui, type Browser, type Locator, type Page } from '@playwright/test';
import { RESTAURANT_CATEGORIES } from '../constants/categories';
import { chromeForTestingExecutable } from './fixtures/chrome-for-testing';
import { compileResponsiveCss } from './fixtures/responsive-css';
import {
  approvedRestaurantName,
  approvedReviewId,
  buildMyPageResponsiveFixture,
  rejectedRestaurantName,
  rejectedReviewId,
} from './fixtures/mypage-responsive-fixture';

let browser: Browser;
let script: string;
let css: string;

beforeAll(async () => {
  [script, css] = await Promise.all([
    buildMyPageResponsiveFixture(),
    compileResponsiveCss(['globals.css', 'app-globals.css', '../styles/product-ui.css']),
  ]);
}, 60_000);

afterAll(async () => { await browser?.close(); });

async function openMyPage(route: 'profile' | 'reviews', width: number, height: number) {
  browser ??= await chromium.launch({ executablePath: chromeForTestingExecutable(), headless: true });
  const context = await browser.newContext({ viewport: { width, height }, reducedMotion: 'reduce' });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  const url = `https://mypage.fixture.test/mypage/${route}`;
  await page.route('**/*', request => request.request().resourceType() === 'document' && request.request().url() === url
    ? request.fulfill({ contentType: 'text/html', body: '<!doctype html><html lang="ko"><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div></body></html>' })
    : request.abort());
  await page.goto(url);
  await page.addStyleTag({ content: css });
  await page.addScriptTag({ content: script });
  await ui(page.locator(route === 'profile' ? '[data-mypage-profile-page]' : '[data-mypage-responsive-list="reviews"]')).toBeVisible();
  if (width >= 768) await ui(page.locator('[data-mypage-left-panel-expanded="true"]')).toBeVisible();
  if (route === 'reviews') {
    // The synthetic cleanup read is intentionally unavailable; wait for its
    // settled recovery notice before measuring the loaded review cards.
    await ui(page.getByRole('button', { name: '사진 정리 다시 시도', exact: true })).toBeEnabled();
  }
  expect(await page.evaluate(() => [innerWidth, innerHeight])).toEqual([width, height]);
  return { context, page, errors };
}

async function expectVisibleBounds(page: Page, target: Locator, clip?: Locator, scroll = true) {
  await ui(target).toBeVisible();
  if (scroll) await target.scrollIntoViewIfNeeded();
  await ui.poll(() => target.evaluate(element => {
    const box = element.getBoundingClientRect();
    for (let parent: Element | null = element; parent;) {
      const style = getComputedStyle(parent), bounds = parent.getBoundingClientRect();
      if (/auto|scroll|hidden|clip/.test(style.overflowX) && (box.left < bounds.left - 1 || box.right > bounds.right + 1)) return false;
      if (/auto|scroll|hidden|clip/.test(style.overflowY) && (box.top < bounds.top - 1 || box.bottom > bounds.bottom + 1)) return false;
      // Programmatic scrolling of a hidden ancestor cannot establish touch or
      // keyboard reachability, even when the target ends up inside the viewport.
      if (/hidden|clip/.test(style.overflowX) && Math.abs(parent.scrollLeft) > 1) return false;
      if (/hidden|clip/.test(style.overflowY) && Math.abs(parent.scrollTop) > 1) return false;
      const root = parent.getRootNode();
      parent = parent.parentElement ?? (root instanceof ShadowRoot ? root.host : null);
    }
    return true;
  })).toBe(true);
  const box = (await target.boundingBox())!;
  const viewport = page.viewportSize()!;
  expect(box.width).toBeGreaterThan(0);
  expect(box.height).toBeGreaterThan(0);
  expect(box.x).toBeGreaterThanOrEqual(-1);
  expect(box.y).toBeGreaterThanOrEqual(-1);
  expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + 1);
  expect(box.y + box.height).toBeLessThanOrEqual(viewport.height + 1);
  if (clip) {
    const frame = (await clip.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(frame.x - 1);
    expect(box.y).toBeGreaterThanOrEqual(frame.y - 1);
    expect(box.x + box.width).toBeLessThanOrEqual(frame.x + frame.width + 1);
    expect(box.y + box.height).toBeLessThanOrEqual(frame.y + frame.height + 1);
  }
}

async function expectReachable(page: Page, target: Locator, clip: Locator, scroll = true) {
  await expectVisibleBounds(page, target, clip, scroll);
  expect(await target.evaluate(element => {
    const rect = element.getBoundingClientRect();
    const painted = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
    return painted === element || (painted !== null && element.contains(painted));
  })).toBe(true);
}

async function expectReadOnly(page: Page, errors: string[]) {
  expect(await page.evaluate(() => (globalThis as unknown as {
    __mypageResponsiveFixture: { forbidden: string[] };
  }).__mypageResponsiveFixture.forbidden)).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(errors).toEqual([]);
}

for (const [width, height] of [[390, 844], [820, 1180], [1024, 768], [454, 312]]) {
  test(`account deletion dialog keeps instructions, fields and keyboard cancellation reachable at ${width}x${height}`, async () => {
    const { context, page, errors } = await openMyPage('profile', width, height);
    try {
      const disclosure = page.locator('#account-deletion summary');
      await disclosure.focus();
      await disclosure.press('Enter');
      const trigger = page.getByRole('button', { name: '계정 완전 삭제', exact: true });
      await trigger.focus();
      await trigger.press('Enter');
      const dialog = page.getByRole('alertdialog', { name: '계정을 완전히 삭제하시겠습니까?', exact: true });
      const cancel = dialog.getByRole('button', { name: '취소', exact: true });
      await ui(cancel).toBeFocused();
      await expectVisibleBounds(page, dialog);
      const dialogBox = (await dialog.boundingBox())!;
      expect(dialogBox.y).toBeGreaterThanOrEqual(15);
      expect(dialogBox.y + dialogBox.height).toBeLessThanOrEqual(height - 15);
      await expectReachable(page, cancel, dialog, false);
      if (height === 312) {
        expect(await dialog.evaluate(element => element.scrollHeight > element.clientHeight)).toBe(true);
        expect(await dialog.evaluate(element => element.scrollTop)).toBeGreaterThan(0);
      }

      await expectVisibleBounds(page, dialog.getByRole('heading', { name: '계정을 완전히 삭제하시겠습니까?' }), dialog);
      await expectVisibleBounds(page, dialog.getByText('최근 로그인 후 확인 문구를 정확히 입력해 주세요.', { exact: false }), dialog);

      // Radix initially focuses Cancel. Tab must wrap to the first field, then
      // reach the visibility control, confirmation field and Cancel again.
      // No test-driven scrolling may make keyboard focus appear reachable.
      // No password or valid deletion confirmation is entered or submitted.
      await cancel.press('Tab');
      const password = dialog.getByLabel('계정 삭제 재인증 비밀번호', { exact: true });
      await ui(password).toBeFocused();
      await expectReachable(page, password, dialog, false);
      await password.press('Tab');
      const visibility = dialog.getByRole('button', { name: '비밀번호 보기', exact: true });
      await ui(visibility).toBeFocused();
      await expectReachable(page, visibility, dialog, false);
      await visibility.press('Tab');
      const confirmation = dialog.getByLabel('계정 삭제 확인 문구', { exact: true });
      await ui(confirmation).toBeFocused();
      await confirmation.fill('합성 오입력');
      await expectReachable(page, confirmation, dialog, false);
      await ui(dialog.getByRole('button', { name: '삭제 범위 확인', exact: true })).toBeDisabled();
      await confirmation.press('Tab');
      await ui(cancel).toBeFocused();
      await expectReachable(page, cancel, dialog, false);
      await cancel.press('Enter');
      await ui(dialog).toHaveCount(0);
      await ui(trigger).toBeFocused();

      await trigger.press('Enter');
      await ui(dialog).toBeVisible();
      await ui(password).toHaveValue('');
      await ui(confirmation).toHaveValue('');
      await ui(cancel).toBeFocused();
      await expectReachable(page, cancel, dialog, false);
      await cancel.press('Enter');
      await ui(dialog).toHaveCount(0);
      await expectReadOnly(page, errors);
    } finally { await context.close(); }
  }, 45_000);

  test(`review categories wrap and named actions remain reachable at ${width}x${height}`, async () => {
    const { context, page, errors } = await openMyPage('reviews', width, height);
    try {
      expect(RESTAURANT_CATEGORIES).toHaveLength(15);
      const frame = page.locator('[data-fixture-mypage-frame]');
      for (const [id, name, actionName] of [
        [rejectedReviewId, rejectedRestaurantName, `${rejectedRestaurantName} 리뷰 수정 후 재제출`],
        [approvedReviewId, approvedRestaurantName, `${approvedRestaurantName} 리뷰 수정`],
      ]) {
        const card = page.locator(`#review-${id}`);
        await ui(card.getByRole('heading', { name, exact: true })).toBeVisible();
        const edit = card.getByRole('button', { name: actionName, exact: true });
        const remove = card.getByRole('button', { name: `${name} 리뷰 삭제 확인 열기`, exact: true });
        await ui(edit).toBeEnabled();
        for (const action of [edit, remove]) {
          await action.focus();
          await ui(action).toBeFocused();
          await expectReachable(page, action, frame, false);
          const buttonBox = (await action.boundingBox())!;
          const cardBox = (await card.boundingBox())!;
          expect(buttonBox.x).toBeGreaterThanOrEqual(cardBox.x);
          expect(buttonBox.x + buttonBox.width).toBeLessThanOrEqual(cardBox.x + cardBox.width);
          expect(buttonBox.width).toBeGreaterThanOrEqual(44);
          expect(buttonBox.height).toBeGreaterThanOrEqual(44);
        }

        for (const category of RESTAURANT_CATEGORIES) {
          const badge = card.getByText(category, { exact: true });
          await expectVisibleBounds(page, badge, frame);
          expect(await badge.evaluate(element => {
            const rect = element.getBoundingClientRect();
            const row = element.parentElement!;
            const column = row.parentElement!.getBoundingClientRect();
            const controls = row.parentElement!.nextElementSibling!.getBoundingClientRect();
            const overlapsControls = rect.left < controls.right && rect.right > controls.left
              && rect.top < controls.bottom && rect.bottom > controls.top;
            return rect.left >= column.left - 1 && rect.right <= column.right + 1
              && element.scrollWidth <= element.clientWidth + 1
              && row.scrollWidth <= row.clientWidth + 1 && !overlapsControls;
          })).toBe(true);
        }
        const rowCount = await card.getByText(RESTAURANT_CATEGORIES[0], { exact: true }).evaluate(element =>
          new Set([...element.parentElement!.children].map(child => Math.round(child.getBoundingClientRect().top))).size);
        expect(rowCount).toBeGreaterThan(1);

        // Opening the existing inline confirmation and cancelling is read-only.
        // The actual delete control remains disabled throughout the interaction.
        await remove.focus();
        await remove.press('Enter');
        const confirmation = card.getByRole('region', { name: '리뷰 삭제 확인', exact: true });
        await ui(confirmation).toBeVisible();
        await ui(confirmation.getByRole('button', { name: '삭제', exact: true })).toBeDisabled();
        const cancel = confirmation.getByRole('button', { name: '취소', exact: true });
        await cancel.focus();
        await ui(cancel).toBeFocused();
        await expectReachable(page, cancel, frame, false);
        await cancel.press('Enter');
        await ui(confirmation).toHaveCount(0);
      }
      await expectReadOnly(page, errors);
    } finally { await context.close(); }
  }, 45_000);
}
