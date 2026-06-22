import { expect, test, type TestInfo } from "@playwright/test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  E2E_ADMIN_ROUTE_BYPASS_HEADER,
  E2E_ADMIN_ROUTE_BYPASS_TOKEN_HEADER,
} from "../lib/e2e-admin-route-bypass";
import { getAdminSessionCookie, hidePopupOverlay } from "./helpers";


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

const STORYBOARD_LIVE_HELPER_E2E_ENV = "STORYBOARD_LIVE_HELPER_E2E";
const STORYBOARD_LIVE_PRODUCTION_ORIGIN_ENV = "STORYBOARD_LIVE_PRODUCTION_ORIGIN";
const STORYBOARD_LIVE_BRIDGE_URL_ENV = "STORYBOARD_LIVE_BRIDGE_URL";
const STORYBOARD_LIVE_BRIDGE_TOKEN_ENV = "STORYBOARD_LIVE_BRIDGE_TOKEN";
const STORYBOARD_MODULE_PATH = "/admin?module=storyboard";
const MAX_COOKIE_CHUNK_SIZE = 3180;

function toBase64Url(value: string): string {
  return Buffer.from(value, "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function createCookieChunks(key: string, value: string): Array<{ name: string; value: string }> {
  const encodedValue = encodeURIComponent(value);
  if (encodedValue.length <= MAX_COOKIE_CHUNK_SIZE) {
    return [{ name: key, value }];
  }

  const chunks: string[] = [];
  let remaining = encodedValue;
  while (remaining.length > 0) {
    let encodedChunkHead = remaining.slice(0, MAX_COOKIE_CHUNK_SIZE);
    const lastEscapePos = encodedChunkHead.lastIndexOf("%");
    if (lastEscapePos > MAX_COOKIE_CHUNK_SIZE - 3) {
      encodedChunkHead = encodedChunkHead.slice(0, lastEscapePos);
    }

    let decodedChunk = "";
    while (encodedChunkHead.length > 0) {
      try {
        decodedChunk = decodeURIComponent(encodedChunkHead);
        break;
      } catch (error) {
        if (
          error instanceof URIError &&
          encodedChunkHead.at(-3) === "%" &&
          encodedChunkHead.length > 3
        ) {
          encodedChunkHead = encodedChunkHead.slice(0, encodedChunkHead.length - 3);
        } else {
          throw error;
        }
      }
    }

    chunks.push(decodedChunk);
    remaining = remaining.slice(encodedChunkHead.length);
  }

  return chunks.map((chunkValue, index) => ({
    name: `${key}.${index}`,
    value: chunkValue,
  }));
}

function isLoopbackHost(hostname: string): boolean {
  return hostname === "127.0.0.1" || hostname === "localhost";
}

async function createSupabaseSessionCookies(
  email: string,
  password: string,
  productionOrigin: URL,
) {
  const supabaseUrl = readEnvWithFallback("NEXT_PUBLIC_SUPABASE_URL").replace(/\/+$/, "");
  const supabaseAnonKey = readEnvWithFallback("NEXT_PUBLIC_SUPABASE_ANON_KEY");
  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL/NEXT_PUBLIC_SUPABASE_ANON_KEY missing");
  }

  const response = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: {
      apikey: supabaseAnonKey,
      Authorization: `Bearer ${supabaseAnonKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ email, password }),
  });

  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as
      | { msg?: string; error?: string }
      | null;
    const detail = String(payload?.msg ?? payload?.error ?? "").trim();
    throw new Error(
      `Supabase password auth failed: ${response.status}${detail ? ` (${detail})` : ""}`,
    );
  }

  const session = (await response.json()) as Record<string, unknown>;
  const accessToken = session.access_token;
  const refreshToken = session.refresh_token;
  const expiresIn = session.expires_in;
  if (typeof accessToken !== "string" || typeof refreshToken !== "string") {
    throw new Error("Supabase password auth returned no access/refresh token");
  }
  if (typeof session.expires_at !== "number" && typeof expiresIn === "number") {
    session.expires_at = Math.floor(Date.now() / 1000) + expiresIn;
  }

  const cookieValue = `base64-${toBase64Url(JSON.stringify(session))}`;
  const cookieName = getSupabaseAuthStorageKey();
  const secure = productionOrigin.protocol === "https:";
  return createCookieChunks(cookieName, cookieValue).map(({ name, value }) => ({
    name,
    value,
    domain: productionOrigin.hostname,
    path: "/",
    httpOnly: false,
    secure,
    sameSite: "Lax" as const,
  }));
}

function createCookiesFromAdminCookieHeader(cookieHeader: string, productionOrigin: URL) {
  const secure = productionOrigin.protocol === "https:";
  return cookieHeader
    .split(";")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .flatMap((entry) => {
      const separator = entry.indexOf("=");
      if (separator <= 0) return [];
      const name = entry.slice(0, separator).trim();
      const value = entry.slice(separator + 1).trim();
      if (!name || !value || !name.startsWith("sb-")) return [];
      return [{
        name,
        value,
        domain: productionOrigin.hostname,
        path: "/",
        httpOnly: false,
        secure,
        sameSite: "Lax" as const,
      }];
    });
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
    "Set STORYBOARD_LIVE_IMAGE_E2E=1 after running bun run storyboard:image-proof to execute real Codex OAuth gpt-image-2 generation.",
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

test("production-origin storyboard helper flow stays off direct page-to-loopback fetches", async ({
  page,
  context,
}) => {
  const liveEnabled = process.env[STORYBOARD_LIVE_HELPER_E2E_ENV] === "1";
  const adminEmail = String(process.env.E2E_ADMIN_EMAIL ?? "").trim();
  const adminPassword = String(process.env.E2E_ADMIN_PASSWORD ?? "").trim();
  const adminCookieHeader = getAdminSessionCookie();
  const productionOrigin =
    readEnvWithFallback(STORYBOARD_LIVE_PRODUCTION_ORIGIN_ENV) || "https://www.tzudong.app";
  const bridgeUrl =
    readEnvWithFallback(STORYBOARD_LIVE_BRIDGE_URL_ENV) || "http://127.0.0.1:17873";
  const bridgeToken = readEnvWithFallback(STORYBOARD_LIVE_BRIDGE_TOKEN_ENV);

  test.skip(
    !liveEnabled,
    `Set ${STORYBOARD_LIVE_HELPER_E2E_ENV}=1 after starting the local bridge helper and providing live admin auth material.`,
  );
  test.skip(
    !adminCookieHeader && (!adminEmail || !adminPassword),
    "Provide E2E_ADMIN_EMAIL/E2E_ADMIN_PASSWORD or INSIGHTS_CHAT_ADMIN_COOKIE/tests/.auth/admin.json before running this production-origin smoke.",
  );
  test.skip(
    !bridgeToken,
    `Set ${STORYBOARD_LIVE_BRIDGE_TOKEN_ENV} to the active local bridge pairing token before running this production-origin smoke.`,
  );
  test.setTimeout(15 * 60_000);

  const productionOriginUrl = new URL(productionOrigin);
  const helperOrigin = new URL(bridgeUrl).origin;
  const storyboardUrl = new URL(STORYBOARD_MODULE_PATH, productionOriginUrl).toString();

  await context.addCookies(
    adminCookieHeader
      ? createCookiesFromAdminCookieHeader(adminCookieHeader, productionOriginUrl)
      : await createSupabaseSessionCookies(adminEmail, adminPassword, productionOriginUrl),
  );

  const directProductionLoopbackRequests: Array<{ method: string; path: string; frameUrl: string }> = [];
  const helperLoopbackRequests: Array<{ method: string; path: string; frameUrl: string }> = [];
  const nonLoopbackTokenLeaks: string[] = [];
  const serverStoryboardImagePosts: string[] = [];

  context.on("request", (request) => {
    const url = new URL(request.url());
    let frameUrl = "";
    try {
      frameUrl = request.frame()?.url() ?? "";
    } catch {
      frameUrl = "";
    }
    const authHeader = request.headers().authorization ?? "";
    const body = request.postData() ?? "";

    if (!isLoopbackHost(url.hostname) && (authHeader.includes(bridgeToken) || body.includes(bridgeToken))) {
      nonLoopbackTokenLeaks.push(`${request.method()} ${url.origin}${url.pathname}`);
    }

    if (
      url.origin === productionOriginUrl.origin &&
      url.pathname === "/api/admin/storyboard/images" &&
      request.method() === "POST"
    ) {
      serverStoryboardImagePosts.push(request.url());
    }

    if (!isLoopbackHost(url.hostname)) return;

    const target = { method: request.method(), path: url.pathname, frameUrl };
    if (frameUrl.startsWith(productionOriginUrl.origin)) {
      directProductionLoopbackRequests.push(target);
      return;
    }

    helperLoopbackRequests.push(target);
  });

  await page.goto(storyboardUrl, { waitUntil: "domcontentloaded" });
  await hidePopupOverlay(page);

  const storyboardModule = page.locator('[data-admin-storyboard-generator="true"]');
  await expect(storyboardModule).toBeVisible({ timeout: 60_000 });
  await storyboardModule.locator('[data-storyboard-chat-settings-toggle="true"]').click();

  const settingsPanel = page.locator('[data-storyboard-chat-settings-panel="true"]');
  await expect(settingsPanel).toBeVisible({ timeout: 30_000 });
  await settingsPanel.locator('[data-storyboard-api-router-option="local-bridge"]').click();

  const localBridgeSettings = settingsPanel.locator(
    '[data-storyboard-local-bridge-settings="session-only"]',
  );
  await expect(localBridgeSettings).toBeVisible();
  await localBridgeSettings.locator('[data-storyboard-local-bridge-url-input="true"]').fill(bridgeUrl);
  await localBridgeSettings.locator('[data-storyboard-local-bridge-token-input="true"]').fill(bridgeToken);
  const helperRequestsBeforeSave = helperLoopbackRequests.length;
  const productionLoopbackBeforeSave = directProductionLoopbackRequests.length;
  await localBridgeSettings.locator('[data-storyboard-local-bridge-save="true"]').click();
  await page.waitForTimeout(1_500);
  expect(helperLoopbackRequests).toHaveLength(helperRequestsBeforeSave);
  expect(directProductionLoopbackRequests).toHaveLength(productionLoopbackBeforeSave);
  await expect(
    localBridgeSettings.locator('[data-storyboard-local-bridge-status="needs_reconnect"]'),
  ).toBeVisible({ timeout: 30_000 });
  await expect(localBridgeSettings.locator('[data-storyboard-local-bridge-message="true"]')).toContainText(
    /로컬 브릿지 다시 연결|helper/i,
  );
  await expect(localBridgeSettings.locator('[data-storyboard-local-bridge-message="true"]')).not.toContainText(
    bridgeToken,
  );

  const helperPopupPromise = page.waitForEvent("popup");
  await localBridgeSettings.locator('[data-storyboard-local-bridge-connect="true"]').click();
  const helperPopup = await helperPopupPromise;
  await helperPopup.waitForLoadState("domcontentloaded");

  const helperUrl = new URL(helperPopup.url());
  expect(helperUrl.origin).toBe(helperOrigin);
  expect(helperUrl.pathname).toBe("/helper");
  expect(helperUrl.searchParams.get("origin")).toBe(productionOriginUrl.origin);
  expect(helperUrl.searchParams.get("surface")).toBe("storyboard");

  await expect(
    localBridgeSettings.locator('[data-storyboard-local-bridge-status="connected"]'),
  ).toBeVisible({ timeout: 30_000 });
  await expect(localBridgeSettings.locator('[data-storyboard-local-bridge-message="true"]')).toContainText(
    /연결(?:됨| 완료)|connected/i,
  );

  await page.reload({ waitUntil: "domcontentloaded" });
  await hidePopupOverlay(page);
  await expect(storyboardModule).toBeVisible({ timeout: 60_000 });
  await storyboardModule.locator('[data-storyboard-chat-settings-toggle="true"]').click();
  await expect(page.locator('[data-storyboard-chat-settings-dropdown="true"]')).toBeVisible();
  await expect(
    page.locator('[data-storyboard-api-router-option="local-bridge"]').first(),
  ).toHaveAttribute("data-storyboard-api-router-option-selected", "true");
  await expect(
    localBridgeSettings.locator('[data-storyboard-local-bridge-status="needs_reconnect"]'),
  ).toBeVisible({ timeout: 30_000 });

  const reconnectPopupPromise = page.waitForEvent("popup", { timeout: 5_000 }).catch(() => null);
  await localBridgeSettings.locator('[data-storyboard-local-bridge-connect="true"]').click();
  const reconnectPopup = await reconnectPopupPromise;
  if (reconnectPopup) {
    await reconnectPopup.waitForLoadState("domcontentloaded");
  }
  await expect(
    localBridgeSettings.locator('[data-storyboard-local-bridge-status="connected"]'),
  ).toBeVisible({ timeout: 30_000 });

  await page.locator('[data-storyboard-chat-settings-close="true"]').click({ force: true });
  await expect(page.locator('[data-storyboard-chat-settings-panel="true"]')).toHaveCount(0, {
    timeout: 15_000,
  });


  const helperRequestsBeforeGeneration = helperLoopbackRequests.length;
  const serverGenerationPostsBefore = serverStoryboardImagePosts.length;
  const productionLoopbackBeforeGeneration = directProductionLoopbackRequests.length;

  const generateButton = storyboardModule.locator('[data-storyboard-generate-images="local-codex"]');
  await expect(generateButton).toHaveAttribute(
    "data-storyboard-image-provider-action-status",
    /ready|connected/,
    { timeout: 60_000 },
  );
  await generateButton.click();

  await expect(
    storyboardModule.locator(
      '[data-storyboard-frame-grid="true"] [data-storyboard-generated-image="local-codex"]',
    ),
  ).toHaveCount(4, { timeout: 10 * 60_000 });

  const helperRequestsAfterGeneration = helperLoopbackRequests.slice(helperRequestsBeforeGeneration);
  const helperPathsAfterGeneration = helperRequestsAfterGeneration.map(
    (entry) => `${entry.method} ${entry.path}`,
  );
  const postStoryboardImageCount = helperPathsAfterGeneration.filter(
    (entry) => entry === "POST /v1/storyboard/images",
  ).length;

  expect(postStoryboardImageCount).toBeGreaterThanOrEqual(1);
  expect(serverStoryboardImagePosts).toHaveLength(serverGenerationPostsBefore);
  expect(directProductionLoopbackRequests).toHaveLength(productionLoopbackBeforeGeneration);
  expect(nonLoopbackTokenLeaks).toHaveLength(0);
  if (reconnectPopup) expect(new URL(reconnectPopup.url()).origin).toBe(helperOrigin);
});
