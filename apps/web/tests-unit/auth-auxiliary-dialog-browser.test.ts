import { expect, test } from "bun:test";
import { chromium, expect as ui } from "@playwright/test";
import { chromeForTestingExecutable } from "./fixtures/chrome-for-testing";
import { buildAuthModalFocusFixture } from "./fixtures/auth-modal-focus-fixture";
import { compileResponsiveCss } from "./fixtures/responsive-css";

const viewports = [
  { width: 390, height: 844 },
  { width: 820, height: 1180 },
  { width: 1024, height: 768 },
  { width: 844, height: 390 },
  { width: 454, height: 312 },
  { width: 1363, height: 936 },
];

const fixtureScript = buildAuthModalFocusFixture(true);
const fixtureStyles = compileResponsiveCss([
  "globals.css",
  "home-app-globals.css",
  "home-interactive-globals.css",
]);

for (const viewport of viewports) {
  test(`authentication auxiliary dialogs own focus and fit ${viewport.width}x${viewport.height}`, async () => {
    const browser = await chromium.launch({ executablePath: chromeForTestingExecutable(), headless: true });
    try {
      const page = await browser.newPage({ viewport });
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.route("**/*", (route) => route.request().resourceType() === "document"
        ? route.fulfill({ contentType: "text/html", body: '<!doctype html><html lang="ko"><body><div id="root"></div></body></html>' })
        : route.abort());
      await page.goto("https://auth-responsive.test/");
      await page.addStyleTag({ content: await fixtureStyles });
      await page.addScriptTag({ content: await fixtureScript });
      expect(await page.evaluate(() => ({ width: innerWidth, height: innerHeight }))).toEqual(viewport);

      const authOpener = page.getByRole("button", { name: "상단 로그인 열기", exact: true });
      await authOpener.click();
      const authDialog = page.getByRole("dialog", { name: "쯔동여지도", exact: true });
      await ui(authDialog).toBeVisible();

      const recoveryOpener = page.getByRole("button", { name: "비밀번호를 잊으셨나요?", exact: true });
      await recoveryOpener.click();
      const recovery = page.getByRole("dialog", { name: "비밀번호 찾기", exact: true });
      await ui(recovery).toBeVisible();
      const recoveryEmail = recovery.getByRole("textbox", { name: "이메일", exact: true });
      await ui(recoveryEmail).toBeFocused();
      expect(await recoveryEmail.evaluate((element) => {
        const bounds = element.getBoundingClientRect();
        const hit = document.elementFromPoint(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
        return hit === element || element.contains(hit);
      })).toBe(true);

      // Wrapping Tab stays in the child even while the sheet's keyboard handlers
      // remain mounted. Escape dismisses exactly that child and restores its opener.
      await page.keyboard.press("Shift+Tab");
      await ui(recovery.getByRole("button", { name: "재설정 링크 발송", exact: true })).toBeFocused();
      await page.keyboard.press("Tab");
      await ui(recoveryEmail).toBeFocused();
      await page.keyboard.press("Escape");
      await ui(recovery).toHaveCount(0);
      await ui(authDialog).toBeVisible();
      await ui(recoveryOpener).toBeFocused();

      await recoveryOpener.click();
      await ui(recovery).toBeVisible();
      await page.mouse.click(8, 8);
      await ui(recovery).toHaveCount(0);
      await ui(authDialog).toBeVisible();
      await ui(recoveryOpener).toBeFocused();

      await authDialog.getByRole("tab", { name: "회원가입", exact: true }).click();
      const nickname = page.locator("#signup-username");
      await nickname.fill("화면 확인 합성 계정");
      await ui(page.locator("#privacy-agree")).toHaveAttribute("aria-checked", "false");
      const policyOpener = page.getByRole("button", { name: "개인정보 처리방침", exact: true });
      await policyOpener.click();
      const policy = page.getByRole("dialog", { name: "개인정보 처리방침", exact: true });
      await ui(policy).toBeVisible();
      const agree = policy.getByRole("button", { name: "동의하기", exact: true });
      const geometry = await agree.evaluate((element) => {
        const button = element.getBoundingClientRect();
        const dialog = element.closest('[role="dialog"]')!.getBoundingClientRect();
        const hit = document.elementFromPoint(button.x + button.width / 2, button.y + button.height / 2);
        return {
          buttonTop: button.top,
          buttonBottom: button.bottom,
          dialogTop: dialog.top,
          dialogBottom: dialog.bottom,
          viewportHeight: innerHeight,
          unobstructed: hit === element || element.contains(hit),
        };
      });
      expect(geometry.buttonTop).toBeGreaterThanOrEqual(geometry.dialogTop);
      expect(geometry.buttonBottom).toBeLessThanOrEqual(geometry.dialogBottom + 1);
      expect(geometry.dialogBottom).toBeLessThanOrEqual(geometry.viewportHeight - 15);
      expect(geometry.unobstructed).toBe(true);

      const policyScroll = policy.locator("[data-radix-scroll-area-viewport]");
      expect(await policyScroll.evaluate((element) => element.clientHeight)).toBeGreaterThan(24);
      expect(await policyScroll.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(true);
      await policyScroll.hover();
      await page.mouse.wheel(0, 30_000);
      await ui.poll(() => policyScroll.evaluate((element) =>
        element.scrollHeight - element.clientHeight - element.scrollTop)).toBeLessThanOrEqual(1);

      // Close without selecting consent or sending a reset email.
      await policy.getByRole("button", { name: "닫기", exact: true }).first().click();
      await ui(policy).toHaveCount(0);
      await ui(authDialog).toBeVisible();
      await ui(policyOpener).toBeFocused();
      await ui(nickname).toHaveValue("화면 확인 합성 계정");
      await ui(page.locator("#privacy-agree")).toHaveAttribute("aria-checked", "false");
      await page.keyboard.press("Escape");
      await ui(page.getByRole("dialog")).toHaveCount(0);
      await ui(authOpener).toBeFocused();
      expect(await page.evaluate(() => (globalThis as unknown as { __authFocusWrites: number }).__authFocusWrites)).toBe(0);
      expect(errors).toEqual([]);
    } finally {
      await browser.close();
    }
  }, 30_000);
}
