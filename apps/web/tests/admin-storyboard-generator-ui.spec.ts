import { expect, test, type TestInfo } from "@playwright/test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  E2E_ADMIN_ROUTE_BYPASS_HEADER,
  E2E_ADMIN_ROUTE_BYPASS_TOKEN_HEADER,
} from "../lib/e2e-admin-route-bypass";
import { hidePopupOverlay } from "./helpers";

function getE2EAdminRouteBypassToken(testInfo: TestInfo) {
  const token = testInfo.config.metadata.e2eAdminRouteBypassToken;
  if (typeof token !== "string" || !token.trim()) {
    throw new Error(
      "playwright.config.ts must provide metadata.e2eAdminRouteBypassToken for this test.",
    );
  }

  return token;
}

function readEnvWithFallback(key: string) {
  const value = process.env[key]?.trim();
  if (value) return value;

  for (const envFile of [".env.local", ".env"]) {
    const envPath = resolve(process.cwd(), envFile);
    try {
      const line = readFileSync(envPath, "utf8")
        .split(/\r?\n/)
        .find((entry) => entry.trim().startsWith(`${key}=`));
      const rawValue = line?.slice(line.indexOf("=") + 1).trim() ?? "";
      if (rawValue) return rawValue.replace(/^["']|["']$/g, "");
    } catch {
      // Continue to the next fallback source.
    }
  }

  return "";
}

function getSupabaseAuthStorageKey() {
  const supabaseUrl = readEnvWithFallback("NEXT_PUBLIC_SUPABASE_URL");
  const hostname = supabaseUrl
    ? new URL(supabaseUrl).hostname
    : "local.supabase.co";
  return `sb-${hostname.split(".")[0]}-auth-token`;
}

test("storyboard canvas counts only visible trusted GPT Image 2 storyboard panels", async ({
  page,
}, testInfo) => {
  test.setTimeout(90_000);
  await page.setExtraHTTPHeaders({
    [E2E_ADMIN_ROUTE_BYPASS_HEADER]: "1",
    [E2E_ADMIN_ROUTE_BYPASS_TOKEN_HEADER]:
      getE2EAdminRouteBypassToken(testInfo),
  });
  await page.addInitScript(
    ({ storageKey }) => {
      const encodeBase64Url = (value: unknown) =>
        btoa(JSON.stringify(value))
          .replace(/\+/g, "-")
          .replace(/\//g, "_")
          .replace(/=+$/g, "");
      const expiresAt = Math.floor(Date.now() / 1000) + 60 * 60;
      const userId = "00000000-0000-4000-8000-000000000004";
      const accessToken = [
        encodeBase64Url({ alg: "HS256", typ: "JWT" }),
        encodeBase64Url({
          aud: "authenticated",
          exp: expiresAt,
          sub: userId,
          email: "storyboard-ui-e2e@example.com",
          role: "authenticated",
        }),
        "storyboard-ui-e2e",
      ].join(".");

      window.localStorage.setItem("tzudong:e2e-admin-shell-bypass", "1");
      window.localStorage.setItem(
        storageKey,
        JSON.stringify({
          access_token: accessToken,
          refresh_token: "storyboard-ui-e2e-refresh-token",
          expires_at: expiresAt,
          expires_in: 3600,
          token_type: "bearer",
          user: {
            id: userId,
            aud: "authenticated",
            role: "authenticated",
            email: "storyboard-ui-e2e@example.com",
            app_metadata: {},
            user_metadata: {},
            created_at: new Date().toISOString(),
          },
        }),
      );
    },
    { storageKey: getSupabaseAuthStorageKey() },
  );

  await page.setViewportSize({ width: 1920, height: 1000 });
  await page.goto("/admin?module=storyboard", {
    waitUntil: "domcontentloaded",
    timeout: 90_000,
  });
  await hidePopupOverlay(page);

  const storyboardModule = page.locator(
    '[data-admin-storyboard-generator="true"]',
  );
  await expect(storyboardModule).toBeVisible({ timeout: 30_000 });
  await expect(
    storyboardModule.locator('[data-storyboard-frame-grid="true"]'),
  ).toBeVisible({ timeout: 30_000 });
  await expect(
    storyboardModule.locator(
      '[data-storyboard-canvas-toolbar="thumbnail-like"]',
    ),
  ).toBeVisible();
  await expect(
    storyboardModule.locator('[data-storyboard-export-preset="true"]'),
  ).toBeVisible();
  await expect(
    storyboardModule.locator('[data-storyboard-safe-area-toggle="true"]'),
  ).toBeVisible();
  await expect(
    storyboardModule.locator('[data-storyboard-generate-images="local-codex"]'),
  ).toBeVisible();
  await expect(
    storyboardModule.locator('[data-storyboard-export-png="true"]'),
  ).toBeVisible();
  await expect(
    storyboardModule.locator('[data-storyboard-input-panel="chat-stream"]'),
  ).toBeVisible();
  await expect(
    storyboardModule.locator('[data-storyboard-chat-header="true"]'),
  ).toBeVisible();
  await expect(
    storyboardModule.locator('[data-storyboard-chat-header-actions="true"]'),
  ).toBeVisible();
  await expect(
    storyboardModule.locator('[data-storyboard-chat-style="thumbnail-like"]'),
  ).toBeVisible();
  await expect(
    storyboardModule
      .locator('[data-storyboard-chat-message-meta="true"]')
      .first(),
  ).toBeVisible();
  await expect(
    storyboardModule
      .locator('[data-storyboard-chat-message-bubble="true"]')
      .first(),
  ).toBeVisible();
  await expect(
    storyboardModule.locator('[data-storyboard-chat-composer="true"] textarea'),
  ).toBeVisible();
  await expect(
    storyboardModule.locator('[data-storyboard-chat-real-data-trace="true"]'),
  ).toHaveCount(0);
  await expect(
    storyboardModule.locator('[data-storyboard-case-history="true"]'),
  ).toHaveCount(0);

  const storyboardSettingsToggle = storyboardModule.locator(
    '[data-storyboard-chat-settings-toggle="true"]',
  );
  await expect(storyboardSettingsToggle).toBeVisible();
  await expect(storyboardSettingsToggle).toHaveAttribute(
    "data-storyboard-chat-settings-open",
    "false",
  );
  await storyboardSettingsToggle.click();
  const storyboardSettingsDropdown = page.locator(
    '[data-storyboard-chat-settings-dropdown="true"]',
  );
  const storyboardSettingsPanel = page.locator(
    '[data-storyboard-chat-settings-panel="true"]',
  );
  await expect(storyboardSettingsDropdown).toBeVisible();
  await expect(storyboardSettingsPanel).toBeVisible();
  await expect(storyboardSettingsToggle).toHaveAttribute(
    "data-storyboard-chat-settings-open",
    "true",
  );
  await expect(
    storyboardSettingsPanel.locator(
      '[data-storyboard-chat-settings-source-trace="true"]',
    ),
  ).toContainText(/Codex CLI/);
  await expect(
    storyboardSettingsPanel.locator(
      '[data-storyboard-chat-settings-source-trace="true"]',
    ),
  ).toContainText(/선택 \d+개/);
  await expect(
    storyboardSettingsPanel.locator(
      '[data-storyboard-chat-settings-image-command="true"]',
    ),
  ).toBeVisible();
  await expect(
    storyboardSettingsPanel.locator('[data-storyboard-chat-settings-reset="true"]'),
  ).toBeVisible();
  await expect(
    storyboardSettingsPanel.locator(
      '[data-storyboard-user-perspective-readiness="true"]',
    ),
  ).toBeVisible();
  await expect(
    storyboardSettingsPanel.locator(
      '[data-storyboard-user-perspective-role="host"]',
    ),
  ).toContainText(/쯔양님\/진행자/);
  await expect(
    storyboardSettingsPanel.locator(
      '[data-storyboard-user-perspective-role="manager"]',
    ),
  ).toContainText(/매니저/);
  await expect(
    storyboardSettingsPanel.locator('[data-storyboard-user-perspective-role="pd"]'),
  ).toContainText(/PD/);
  await expect(
    storyboardSettingsPanel.locator(
      '[data-storyboard-user-perspective-role="editor"]',
    ),
  ).toContainText(/편집자/);
  await expect(
    storyboardSettingsPanel.locator(
      '[data-storyboard-omitted-scene-count="true"]',
    ),
  ).toContainText(/무이미지\/미검증 컷/);
  await storyboardSettingsPanel
    .locator('[data-storyboard-chat-settings-close="true"]')
    .click();
  await expect(storyboardSettingsPanel).toHaveCount(0);
  await expect(storyboardSettingsDropdown).toHaveCount(0);

  const storyboardHistoryToggle = storyboardModule.locator(
    '[data-storyboard-history-panel-toggle="true"]',
  );
  await expect(storyboardHistoryToggle).toBeVisible();
  await expect(storyboardHistoryToggle).toHaveText("");
  await expect(storyboardHistoryToggle).toHaveAttribute(
    "data-storyboard-history-dropdown-trigger",
    "icon-only",
  );
  await storyboardHistoryToggle.click();
  const storyboardHistoryDropdown = page.locator(
    '[data-storyboard-history-dropdown="true"]',
  );
  const storyboardHistoryPanel = page.locator(
    '[data-storyboard-history-panel="true"]',
  );
  await expect(storyboardHistoryDropdown).toBeVisible({ timeout: 30_000 });
  await expect(storyboardHistoryPanel).toBeVisible({ timeout: 30_000 });
  await expect(storyboardHistoryPanel).toHaveAttribute(
    "data-storyboard-history-status",
    "ready",
    { timeout: 30_000 },
  );
  await expect
    .poll(
      async () => {
        const historyCount = await storyboardHistoryPanel.getAttribute(
          "data-storyboard-history-count",
        );
        return Number(historyCount ?? "0");
      },
      { timeout: 30_000 },
    )
    .toBeGreaterThanOrEqual(4);
  const storyboardHistoryRows = storyboardHistoryPanel.locator(
    '[data-storyboard-history-run="true"]',
  );
  await expect(storyboardHistoryRows.nth(0)).toBeVisible();
  await expect(storyboardHistoryRows.nth(1)).toBeVisible();
  await expect(
    storyboardHistoryRows.nth(0).locator('[data-storyboard-history-title="true"]'),
  ).toBeVisible();
  await expect(
    storyboardHistoryRows
      .nth(0)
      .locator('[data-storyboard-history-scenes="true"]'),
  ).toContainText(/컷/);
  const latestHistoryRow = storyboardHistoryRows.nth(0);
  await expect(latestHistoryRow).toBeVisible();
  const loadedGeneratedAt =
    (await latestHistoryRow
      .locator('[data-storyboard-history-generated-at="true"]')
      .getAttribute("datetime")) ?? "";
  expect(loadedGeneratedAt).not.toBe("");
  await latestHistoryRow.locator('[data-storyboard-history-load-run]').click();
  await expect(
    storyboardModule.locator('[data-storyboard-latest-real-data-loaded="true"]'),
  ).toHaveCount(0);
  await expect(
    storyboardModule.locator('[data-storyboard-real-data-mode="true"]'),
  ).toHaveCount(0);
  await expect(
    storyboardModule.getByText(/히스토리 케이스 로드 완료/),
  ).toBeVisible({ timeout: 10_000 });
  await expect(
    storyboardModule.locator(
      '[data-storyboard-image-frame="1"] [data-storyboard-frame-script="true"]',
    ),
  ).toBeVisible();
  await expect(
    storyboardModule.locator(
      '[data-storyboard-image-frame="1"] [data-storyboard-frame-script-placement="separated"]',
    ),
  ).toBeVisible();
  await expect(
    storyboardModule.locator(
      '[data-storyboard-image-frame="1"] [data-storyboard-frame-audio="true"]',
    ),
  ).toContainText(/Audio/);
  await expect(
    storyboardModule.locator(
      '[data-storyboard-image-frame="1"] [data-storyboard-frame-subtitle="true"]',
    ),
  ).toContainText(/Subtitle/);
  const storyboardPageIndicator = storyboardModule.locator(
    '[data-storyboard-page-indicator="true"]',
  );
  await expect(storyboardPageIndicator).toContainText(/1 \/ \d+/);
  const storyboardPageIndicatorText = await storyboardPageIndicator.innerText();
  const initialStoryboardTotalPages =
    Number(storyboardPageIndicatorText.match(/\/\s*(\d+)/)?.[1] ?? "1") || 1;
  const storyboardFrameRangeText = await storyboardModule
    .locator('[data-storyboard-frame-page-range="true"]')
    .innerText();
  const visibleTrustedStoryboardCutCount =
    Number(storyboardFrameRangeText.match(/\/\s*0?(\d+)/)?.[1] ?? "4") || 4;
  await storyboardModule
    .locator('[data-storyboard-image-frame="1"]')
    .dispatchEvent("click");
  await expect(
    storyboardModule.locator('[data-storyboard-chat-canvas-context="true"]'),
  ).toBeVisible();
  await expect(
    storyboardModule.locator('[data-storyboard-canvas-focus-label="true"]'),
  ).toContainText("CUT 01");
  await expect(
    storyboardModule.locator('[data-storyboard-canvas-focus-detail="true"]'),
  ).toBeVisible();
  await expect(
    storyboardModule.locator('[data-storyboard-image-frame="1"]'),
  ).toHaveAttribute("data-storyboard-selected-frame", "true");
  await expect(
    storyboardModule.locator('[data-storyboard-chat-composer="true"] textarea'),
  ).toHaveAttribute("placeholder", /CUT 01/);
  await expect(
    storyboardModule.locator(
      '[data-storyboard-live-canvas-text-summary="true"]',
    ),
  ).toHaveCount(0);
  await expect(
    storyboardModule.locator('[data-storyboard-chat-command-row="true"]'),
  ).toHaveCount(0);

  const chatInput = storyboardModule.locator(
    '[data-storyboard-chat-composer="true"] textarea',
  );
  const canonicalPromptState = storyboardModule.locator(
    '[data-storyboard-chat-topic-state="true"]',
  );
  const initialCanonicalPrompt = await canonicalPromptState.inputValue();
  const transientDraft =
    "채팅 draft만 반영되고 canonical prompt는 유지되어야 함";
  await chatInput.fill(transientDraft);
  await expect(
    storyboardModule.locator('[data-storyboard-chat-draft-preview="true"]'),
  ).toBeVisible();
  await expect(
    storyboardModule.locator(
      '[data-storyboard-image-frame="1"] [data-storyboard-chat-streaming-preview="true"]',
    ),
  ).toHaveCount(0);
  await expect(canonicalPromptState).toHaveValue(initialCanonicalPrompt);
  expect(initialCanonicalPrompt).not.toBe(transientDraft);

  await chatInput.fill("상태");
  await chatInput.press("Enter");
  const statusBubble = storyboardModule
    .locator('[data-storyboard-chat-message-bubble="true"]')
    .filter({ hasText: /현재 상태 · CUT/ })
    .last();
  await expect(statusBubble).toBeVisible({ timeout: 10_000 });
  await expect(statusBubble).toContainText(/실제 히트맵 데이터/);
  await expect(statusBubble).toContainText(/스캔 \d+파일/);
  await expect(statusBubble).toContainText(/피크 \d+개/);
  await expect(statusBubble).toContainText(/무이미지\/미검증 컷/);
  await expect(canonicalPromptState).toHaveValue(initialCanonicalPrompt);
  await expect(
    storyboardModule.getByText(/현재 맥락 CUT 01 선택됨/),
  ).toBeVisible();
  await expect(
    storyboardModule.getByText(
      /‘점검’, ‘생성’, ‘4컷 재생성’, ‘초기화’도 채팅으로 실행/,
    ),
  ).toBeVisible();

  await chatInput.fill("점검");
  await chatInput.press("Enter");
  const reviewBubble = storyboardModule
    .locator('[data-storyboard-chat-message-bubble="true"]')
    .filter({ hasText: /사용자 관점 점검/ })
    .last();
  await expect(reviewBubble).toBeVisible({ timeout: 10_000 });
  await expect(reviewBubble).toContainText(/쯔양님\/진행자/);
  await expect(reviewBubble).toContainText(/매니저/);
  await expect(reviewBubble).toContainText(/PD/);
  await expect(reviewBubble).toContainText(/편집자/);
  await expect(reviewBubble).toContainText(/이미지 \d+\/\d+/);
  await expect(reviewBubble).toContainText(/실제 히트맵 데이터/);
  await expect(canonicalPromptState).toHaveValue(initialCanonicalPrompt);

  await chatInput.fill("이 컷 자막만 더 짧게 바꿔줘");
  await chatInput.press("Enter");
  await expect(
    storyboardModule.locator(
      '[data-storyboard-image-frame="1"] [data-storyboard-frame-subtitle="true"]',
    ),
  ).toContainText(/요청 반영/, { timeout: 15_000 });
  await expect(storyboardModule.getByText(/CUT 01 부분 수정 패치/)).toBeVisible(
    { timeout: 15_000 },
  );

  const currentVisibleTrustedImages = await storyboardModule
    .locator(
      '[data-storyboard-frame-grid="true"] [data-storyboard-generated-image="local-codex"]',
    )
    .count();
  const imageCountLabel = await storyboardModule
    .locator('[data-storyboard-generated-image-count="true"]')
    .innerText();
  const currentMatch = imageCountLabel.match(/이미지\s*(\d+)\/4/);

  expect(currentMatch?.[1]).toBe(String(currentVisibleTrustedImages));
  expect(currentVisibleTrustedImages).toBeGreaterThan(0);
  await expect(
    storyboardModule.locator(
      '[data-storyboard-image-frame="1"] [data-storyboard-generated-image="local-codex"]',
    ),
  ).toHaveCount(1);
  expect(imageCountLabel).toMatch(/전체\s*\d+\/\d+/);

  const imageGenerationRequests: string[] = [];
  page.on("request", (request) => {
    if (
      request.method() === "POST" &&
      request.url().includes("/api/admin/storyboard/images")
    ) {
      imageGenerationRequests.push(request.url());
    }
  });
  const imageGenerationRequestCountBeforeNavigation =
    imageGenerationRequests.length;

  await chatInput.fill("5컷 보여줘");
  await chatInput.press("Enter");
  if (visibleTrustedStoryboardCutCount >= 5 && initialStoryboardTotalPages > 1) {
    await expect(storyboardPageIndicator).toContainText(
      `2 / ${initialStoryboardTotalPages}`,
      { timeout: 15_000 },
    );
    await expect(
      storyboardModule.locator('[data-storyboard-frame-grid="true"]'),
    ).toHaveAttribute("data-storyboard-frame-page", "2");
    await expect(
      storyboardModule.locator('[data-storyboard-image-frame="5"]'),
    ).toBeVisible({ timeout: 15_000 });
    await expect(
      storyboardModule.locator('[data-storyboard-canvas-focus-label="true"]'),
    ).toContainText("CUT 05");
  } else {
    await expect(storyboardPageIndicator).toContainText("1 / 1", {
      timeout: 15_000,
    });
    await expect(
      storyboardModule.locator('[data-storyboard-frame-grid="true"]'),
    ).toHaveAttribute("data-storyboard-frame-page", "1");
    await expect(
      storyboardModule.locator('[data-storyboard-image-frame="5"]'),
    ).toHaveCount(0);
    await expect(
      storyboardModule.getByText(
        new RegExp(
          `CUT 05는 현재 ${visibleTrustedStoryboardCutCount}컷 결과에 없어 선택을 해제`,
        ),
      ),
    ).toBeVisible({
      timeout: 15_000,
    });
  }
  expect(imageGenerationRequests).toHaveLength(
    imageGenerationRequestCountBeforeNavigation,
  );

  await chatInput.fill("99컷 보여줘");
  await chatInput.press("Enter");
  await expect(
    storyboardModule.getByText(/CUT 99는 현재 \d+컷 결과에 없어 선택을 해제/),
  ).toBeVisible({
    timeout: 15_000,
  });
  await expect(
    storyboardModule.locator('[data-storyboard-chat-canvas-context="true"]'),
  ).toHaveCount(0);
  expect(imageGenerationRequests).toHaveLength(
    imageGenerationRequestCountBeforeNavigation,
  );

  await chatInput.fill("4컷 자막만 요청 반영으로 바꿔줘");
  await chatInput.press("Enter");
  await expect(storyboardPageIndicator).toContainText(
    `1 / ${initialStoryboardTotalPages}`,
    { timeout: 15_000 },
  );
  await expect(
    storyboardModule.locator('[data-storyboard-frame-grid="true"]'),
  ).toHaveAttribute("data-storyboard-frame-page", "1");
  await expect(
    storyboardModule.locator(
      '[data-storyboard-image-frame="4"] [data-storyboard-frame-subtitle="true"]',
    ),
  ).toContainText(/요청 반영/, { timeout: 15_000 });
  await expect(
    storyboardModule.locator('[data-storyboard-canvas-focus-label="true"]'),
  ).toContainText("CUT 04");
});
