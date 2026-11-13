import { expect, test } from "bun:test";
import { chromium, expect as ui } from "@playwright/test";
import { chromeForTestingExecutable } from "./fixtures/chrome-for-testing";
import { buildAuthModalFocusFixture } from "./fixtures/auth-modal-focus-fixture";

for (const keepMounted of [true, false]) {
  test(`actual authentication dialog restores each keyboard opener when ${keepMounted ? "kept mounted" : "unmounted on close"}`, async () => {
    const script = await buildAuthModalFocusFixture(keepMounted);
    const browser = await chromium.launch({ executablePath: chromeForTestingExecutable(), headless: true });
    try {
      const page = await browser.newPage({ viewport: { width: 1363, height: 936 } });
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.route("**/*", (route) => route.request().resourceType() === "document"
        ? route.fulfill({ contentType: "text/html", body: '<!doctype html><html lang="ko"><body><div id="root"></div></body></html>' })
        : route.abort());
      await page.goto("https://auth-focus.test/");
      await page.addScriptTag({ content: script });
      const first = page.getByRole("button", { name: "상단 로그인 열기", exact: true });
      await first.focus();
      await first.press("Enter");
      await ui(page.getByRole("dialog")).toBeVisible();
      await page.keyboard.press("Escape");
      await ui(page.getByRole("dialog")).toHaveCount(0);
      await ui(first).toBeFocused();

      const next = page.getByRole("button", { name: "다른 위치에서 로그인 열기", exact: true });
      await next.focus();
      await next.press("Enter");
      await ui(page.getByRole("dialog")).toBeVisible();
      await page.getByRole("dialog").getByRole("button", { name: "닫기", exact: true }).click();
      await ui(page.getByRole("dialog")).toHaveCount(0);
      await ui(next).toBeFocused();
      expect(await page.evaluate(() => (globalThis as unknown as { __authFocusWrites: number }).__authFocusWrites)).toBe(0);
      expect(errors).toEqual([]);
    } finally {
      await browser.close();
    }
  }, 30_000);
}
