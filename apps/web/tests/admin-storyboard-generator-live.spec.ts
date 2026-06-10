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

function isExactStoryboardImageProvenance(value: unknown) {
  if (!value || typeof value !== "object") return false;
  const provenance = value as Record<string, unknown>;
  return (
    provenance.providerId === "local-codex" &&
    provenance.authMode === "codex_oauth" &&
    provenance.endpoint === "https://chatgpt.com/backend-api/codex/responses" &&
    provenance.requestToolType === "image_generation" &&
    provenance.requestToolModel === "gpt-image-2" &&
    provenance.model === "gpt-image-2" &&
    provenance.modelProvenance === "exact" &&
    provenance.hasOpenAIAPIKey === false &&
    typeof provenance.responseId === "string" &&
    typeof provenance.imageCallId === "string" &&
    typeof provenance.requestHash === "string" &&
    /^[a-f0-9]{64}$/i.test(provenance.requestHash) &&
    typeof provenance.responseHash === "string" &&
    /^[a-f0-9]{64}$/i.test(provenance.responseHash) &&
    Array.isArray(provenance.rawImageItemTypes) &&
    provenance.rawImageItemTypes[0] === "image_generation_call"
  );
}

test("live operator path generates four storyboard images and persists exact gpt-image-2 proof history", async ({
  page,
}, testInfo) => {
  test.skip(
    process.env.STORYBOARD_LIVE_IMAGE_E2E !== "1",
    "Set STORYBOARD_LIVE_IMAGE_E2E=1 after running npm run storyboard:image-proof to execute real Codex OAuth gpt-image-2 generation.",
  );
  test.setTimeout(12 * 60_000);

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
      const userId = "00000000-0000-4000-8000-000000000014";
      const accessToken = [
        encodeBase64Url({ alg: "HS256", typ: "JWT" }),
        encodeBase64Url({
          aud: "authenticated",
          exp: expiresAt,
          sub: userId,
          email: "storyboard-live-e2e@example.com",
          role: "authenticated",
        }),
        "storyboard-live-e2e",
      ].join(".");

      window.localStorage.setItem("tzudong:e2e-admin-shell-bypass", "1");
      window.localStorage.setItem(
        storageKey,
        JSON.stringify({
          access_token: accessToken,
          refresh_token: "storyboard-live-e2e-refresh-token",
          expires_at: expiresAt,
          expires_in: 3600,
          token_type: "bearer",
          user: {
            id: userId,
            aud: "authenticated",
            role: "authenticated",
            email: "storyboard-live-e2e@example.com",
            app_metadata: {},
            user_metadata: {},
            created_at: new Date().toISOString(),
          },
        }),
      );
    },
    { storageKey: getSupabaseAuthStorageKey() },
  );

  const imagePostPayloads: Array<Record<string, unknown>> = [];
  const imagePostResponses: Array<Record<string, unknown>> = [];
  page.on("request", (request) => {
    if (
      request.method() === "POST" &&
      request.url().includes("/api/admin/storyboard/images")
    ) {
      const data = request.postData();
      if (data) imagePostPayloads.push(JSON.parse(data) as Record<string, unknown>);
    }
  });
  page.on("response", (response) => {
    if (
      response.request().method() === "POST" &&
      response.url().includes("/api/admin/storyboard/images")
    ) {
      void response
        .json()
        .then((payload) =>
          imagePostResponses.push(payload as Record<string, unknown>),
        )
        .catch(() => undefined);
    }
  });

  await page.goto("/admin?module=storyboard");
  await hidePopupOverlay(page);
  const storyboardModule = page.locator(
    '[data-admin-storyboard-generator="true"]',
  );
  await expect(storyboardModule).toBeVisible({ timeout: 30_000 });

  const providerPayload = await page.evaluate(async () => {
    const response = await fetch("/api/admin/storyboard/images", {
      cache: "no-store",
      headers: { Accept: "application/json" },
    });
    return {
      ok: response.ok,
      status: response.status,
      json: await response.json().catch(() => null),
    };
  });
  expect(providerPayload.ok, JSON.stringify(providerPayload.json)).toBe(true);
  expect(providerPayload.json?.provider).toMatchObject({
    available: true,
    providerId: "local-codex",
    model: "gpt-image-2",
    modelProvenance: "exact",
    reason: "ready",
  });

  const generateButton = storyboardModule.locator(
    '[data-storyboard-generate-images="local-codex"]',
  );
  await expect(generateButton).toBeVisible();
  await expect(generateButton).toHaveAttribute(
    "data-storyboard-image-provider-action-status",
    "ready",
    { timeout: 30_000 },
  );
  const chatInput = storyboardModule.locator(
    '[data-storyboard-chat-composer="true"] textarea',
  );
  await chatInput.fill("생성");
  await storyboardModule.locator('[data-storyboard-chat-submit="true"]').click();
  await expect(
    storyboardModule
      .locator('[data-storyboard-chat-message-bubble="true"]')
      .filter({ hasText: /스토리보드 생성 완료/ })
      .last(),
  ).toBeVisible({ timeout: 90_000 });
  await expect(generateButton).toContainText(/4컷/);

  await generateButton.click();

  await expect
    .poll(() => imagePostResponses.length, {
      timeout: 10 * 60_000,
      intervals: [1000, 2500, 5000],
    })
    .toBeGreaterThanOrEqual(4);

  const latestFourPayloads = imagePostPayloads.slice(-4);
  expect(latestFourPayloads).toHaveLength(4);
  for (const payload of latestFourPayloads) {
    expect(Array.isArray(payload.scenes)).toBe(true);
    expect((payload.scenes as unknown[]).length).toBe(1);
  }

  await expect(
    storyboardModule.locator(
      '[data-storyboard-frame-grid="true"] [data-storyboard-generated-image="local-codex"]',
    ),
  ).toHaveCount(4, { timeout: 60_000 });
  await expect(
    storyboardModule.locator('[data-storyboard-image-frame="5"]'),
  ).toHaveCount(0);

  const generatedSceneNos = latestFourPayloads.flatMap((payload) =>
    (payload.scenes as Array<{ sceneNo?: number }>).flatMap((scene) =>
      typeof scene.sceneNo === "number" ? [scene.sceneNo] : [],
    ),
  );
  expect(new Set(generatedSceneNos).size).toBe(4);

  const latestHistory = await page.evaluate(async () => {
    const response = await fetch("/qa-history/storyboard/latest-real-data.json", {
      cache: "no-store",
      headers: { Accept: "application/json" },
    });
    return response.ok ? await response.json() : null;
  });
  expect(latestHistory).toBeTruthy();
  const latestScenes = latestHistory?.result?.storyboard?.scenes;
  expect(Array.isArray(latestScenes)).toBe(true);
  const provenanceBySceneNo = new Map<number, unknown>(
    (latestScenes as Array<{ sceneNo?: number; generatedImage?: unknown }>).flatMap(
      (scene) => {
        const image = scene.generatedImage as
          | { provenance?: unknown }
          | undefined;
        return typeof scene.sceneNo === "number"
          ? [[scene.sceneNo, image?.provenance] as const]
          : [];
      },
    ),
  );
  for (const sceneNo of generatedSceneNos) {
    expect(
      isExactStoryboardImageProvenance(provenanceBySceneNo.get(sceneNo)),
    ).toBe(true);
  }

  await storyboardModule
    .locator('[data-storyboard-history-panel-toggle="true"]')
    .click();
  const historyPanel = page.locator('[data-storyboard-history-panel="true"]');
  await expect(historyPanel).toBeVisible({ timeout: 30_000 });
  const latestHistoryRun = historyPanel
    .locator('[data-storyboard-history-run="true"]')
    .first();
  await expect(latestHistoryRun).toBeVisible();
  await latestHistoryRun
    .locator('[data-storyboard-history-proof-toggle="true"]')
    .click();
  await expect(
    latestHistoryRun.locator('[data-storyboard-history-proof-panel="true"]'),
  ).toBeVisible();
  await expect(
    latestHistoryRun.locator('[data-storyboard-history-proof-provider="true"]'),
  ).toContainText(/local-codex.*codex_oauth/);
  await expect(
    latestHistoryRun.locator('[data-storyboard-history-proof-model="true"]'),
  ).toContainText(/gpt-image-2 exact/);
  await expect(
    latestHistoryRun.locator('[data-storyboard-history-proof-response="true"]'),
  ).toHaveCount(4);
  await expect(
    latestHistoryRun.locator('[data-storyboard-history-proof-hashes="true"]'),
  ).toHaveCount(4);
});
