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
      const initializationFailure = new Promise<never>((_, reject) => {
        page.on("pageerror", (error) => {
          errors.push(error.message);
          reject(new Error(`AUTH_FOCUS_FIXTURE_PAGE_ERROR: ${error.message}`));
        });
      });
      await page.route("**/*", (route) => route.request().resourceType() === "document"
        ? route.fulfill({ contentType: "text/html", body: '<!doctype html><html lang="ko"><body><div id="root"></div></body></html>' })
        : route.abort());
      const first = page.getByRole("button", { name: "상단 로그인 열기", exact: true });
      await Promise.race([
        (async () => {
          await page.goto("https://auth-focus.test/");
          await page.addScriptTag({ content: script });
          await first.waitFor({ state: "visible", timeout: 5_000 });
        })(),
        initializationFailure,
      ]);
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

test("policy retry replaces a failed read without resetting signup input or selecting consent", async () => {
  const script = await buildAuthModalFocusFixture(false, true);
  const browser = await chromium.launch({ executablePath: chromeForTestingExecutable(), headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1363, height: 936 } });
    const errors: string[] = [];
    const initializationFailure = new Promise<never>((_, reject) => {
      page.on("pageerror", (error) => {
        errors.push(error.message);
        reject(new Error(`AUTH_POLICY_FIXTURE_PAGE_ERROR: ${error.message}`));
      });
    });
    await page.route("**/*", (route) => route.request().resourceType() === "document"
      ? route.fulfill({ contentType: "text/html", body: '<!doctype html><html lang="ko"><body><div id="root"></div></body></html>' })
      : route.abort());
    const opener = page.getByRole("button", { name: "상단 로그인 열기", exact: true });
    await Promise.race([
      (async () => {
        await page.goto("https://auth-policy.test/");
        await page.addScriptTag({ content: script });
        await opener.waitFor({ state: "visible", timeout: 5_000 });
      })(), initializationFailure,
    ]);
    await opener.click();
    await page.getByRole("tab", { name: "회원가입", exact: true }).click();
    await ui(page.getByRole("alert")).toContainText("개인정보 처리방침을 불러오지 못했습니다");
    await page.locator("#signup-username").fill("정책 재시도 합성 계정");
    await page.getByRole("radio", { name: "만 14세 이상입니다", exact: true }).check();
    await page.locator("summary").filter({ hasText: "마케팅 수신 동의" }).click();
    const signup = page.getByRole("button", { name: "회원가입", exact: true });
    await ui(signup).toBeDisabled();
    await page.getByRole("button", { name: "처리방침 다시 확인", exact: true }).click();
    await ui(page.getByRole("alert")).toHaveCount(0);
    await ui(page.getByText("최신 개인정보 처리방침을 확인하는 중입니다.", { exact: true })).toHaveCount(0);
    await ui(page.getByRole("tab", { name: "회원가입", exact: true })).toHaveAttribute("aria-selected", "true");
    await ui(page.locator("#signup-username")).toHaveValue("정책 재시도 합성 계정");
    await ui(page.getByRole("radio", { name: "만 14세 이상입니다", exact: true })).toBeChecked();
    await ui(page.locator("#privacy-agree")).toHaveAttribute("aria-checked", "false");
    for (const channel of ["email", "sms", "push", "night_email", "night_sms", "night_push"]) {
      await ui(page.locator(`#marketing-${channel}`)).toHaveAttribute("aria-checked", "false");
      if (channel.startsWith("night_")) await ui(page.locator(`#marketing-${channel}`)).toBeDisabled();
    }
    await ui(signup).toBeDisabled();
    expect(await page.evaluate(() => (globalThis as unknown as { __authPolicyGets: number }).__authPolicyGets)).toBe(2);
    expect(await page.evaluate(() => (globalThis as unknown as { __authFocusWrites: number }).__authFocusWrites)).toBe(0);
    expect(errors).toEqual([]);
  } finally {
    await browser.close();
  }
}, 30_000);
