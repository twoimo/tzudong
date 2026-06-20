import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";



import { hidePopupOverlay } from "./helpers";

const SUPABASE_URL_ENV = "NEXT_PUBLIC_SUPABASE_URL";
const SUPABASE_ANON_KEY_ENV = "NEXT_PUBLIC_SUPABASE_ANON_KEY";
const LIVE_ENABLE_ENV = "THUMBNAIL_LIVE_HELPER_E2E";
const LIVE_PRODUCTION_ORIGIN_ENV = "THUMBNAIL_LIVE_PRODUCTION_ORIGIN";
const LIVE_BRIDGE_URL_ENV = "THUMBNAIL_LIVE_BRIDGE_URL";
const LIVE_BRIDGE_TOKEN_ENV = "THUMBNAIL_LIVE_BRIDGE_TOKEN";
const MAX_COOKIE_CHUNK_SIZE = 3180;
const THUMBNAIL_MODULE_PATH = "/admin?module=youtube-thumbnail-generator";

const envFileCache = new Map<string, string>();

function readEnvFromLocalFile(key: string): string {
  if (envFileCache.has(key)) {
    return envFileCache.get(key) ?? "";
  }

  for (const envFile of [".env.local", ".env"]) {
    const envPath = resolve(process.cwd(), envFile);
    try {
      const lines = readFileSync(envPath, "utf8").split(/\r?\n/);
      const parsed = new Map<string, string>();
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;

        const separator = trimmed.indexOf("=");
        if (separator <= 0) continue;

        const parsedKey = trimmed.slice(0, separator).trim();
        const parsedValue = trimmed.slice(separator + 1).trim();
        const normalizedValue =
          (parsedValue.startsWith('"') && parsedValue.endsWith('"')) ||
          (parsedValue.startsWith("'") && parsedValue.endsWith("'"))
            ? parsedValue.slice(1, -1)
            : parsedValue;
        parsed.set(parsedKey, normalizedValue);
      }

      const value = parsed.get(key) ?? "";
      envFileCache.set(key, value);
      if (value) return value;
    } catch {
      // Continue to the next fallback source.
    }
  }

  envFileCache.set(key, "");
  return "";
}

function readEnvWithFallback(key: string): string {
  const fromProcess = String(process.env[key] ?? "").trim();
  if (fromProcess) return fromProcess;
  return readEnvFromLocalFile(key);
}

function getAdminCookieFromStorageState(statePath: string) {
  try {
    const raw = readFileSync(statePath, "utf8");
    const state = JSON.parse(raw) as { cookies?: Array<{ name?: string; value?: string }> };
    const cookies = Array.isArray(state.cookies) ? state.cookies : [];
    const adminCookies = cookies.filter(
      (cookie) => typeof cookie?.name === "string" && cookie.name.startsWith("sb-") && typeof cookie?.value === "string",
    );
    if (adminCookies.length === 0) return null;
    const header = adminCookies.map((cookie) => `${cookie.name}=${cookie.value}`).join("; ");
    return header || null;
  } catch {
    return null;
  }
}

function buildAdminCookieStateCandidates() {
  const cwd = process.cwd();
  const initCwd = typeof process.env.INIT_CWD === "string" ? process.env.INIT_CWD : "";
  const baseDirectories = [cwd, resolve(cwd, ".."), resolve(cwd, "..", ".."), resolve(__dirname, "..")] as const;
  const paths = new Set<string>();

  const explicitCookieFile = String(process.env.INSIGHTS_CHAT_ADMIN_COOKIE_FILE ?? "").trim();
  if (explicitCookieFile) {
    paths.add(resolve(explicitCookieFile));
  }

  for (const base of initCwd ? [...baseDirectories, initCwd] : baseDirectories) {
    paths.add(resolve(base, "tests", ".auth", "admin.json"));
    paths.add(resolve(base, "apps", "web", "tests", ".auth", "admin.json"));
  }

  return [...paths];
}

function resolveAdminSessionCookieHeader() {
  const envCookie = String(process.env.INSIGHTS_CHAT_ADMIN_COOKIE ?? "").trim();
  if (envCookie) return envCookie;

  for (const statePath of buildAdminCookieStateCandidates()) {
    const cookie = getAdminCookieFromStorageState(statePath);
    if (cookie) return cookie;
  }

  return null;
}


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

function getSupabaseStorageKey(supabaseUrl: string): string {
  const projectRef = new URL(supabaseUrl).hostname.split(".")[0];
  return `sb-${projectRef}-auth-token`;
}

function isLoopbackHost(hostname: string): boolean {
  return hostname === "127.0.0.1" || hostname === "localhost";
}

async function createSupabaseSessionCookies(
  email: string,
  password: string,
  productionOrigin: URL,
) {
  const supabaseUrl = readEnvWithFallback(SUPABASE_URL_ENV).replace(/\/+$/, "");
  const supabaseAnonKey = readEnvWithFallback(SUPABASE_ANON_KEY_ENV);
  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error(`${SUPABASE_URL_ENV}/${SUPABASE_ANON_KEY_ENV} missing`);
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
  const cookieName = getSupabaseStorageKey(supabaseUrl);
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


test("production-origin thumbnail helper flow stays off direct page-to-loopback fetches", async ({
  page,
  context,
}) => {
  const liveEnabled = process.env[LIVE_ENABLE_ENV] === "1";
  const adminEmail = String(process.env.E2E_ADMIN_EMAIL ?? "").trim();
  const adminPassword = String(process.env.E2E_ADMIN_PASSWORD ?? "").trim();
  const adminCookieHeader = resolveAdminSessionCookieHeader();
  const productionOrigin =
    readEnvWithFallback(LIVE_PRODUCTION_ORIGIN_ENV) || "https://www.tzudong.app";
  const bridgeUrl =
    readEnvWithFallback(LIVE_BRIDGE_URL_ENV) || "http://127.0.0.1:17873";
  const bridgeToken = readEnvWithFallback(LIVE_BRIDGE_TOKEN_ENV);

  test.skip(
    !liveEnabled,
    `Set ${LIVE_ENABLE_ENV}=1 after starting the local bridge helper and providing live admin auth material.`,
  );
  test.skip(
    !adminCookieHeader && (!adminEmail || !adminPassword),
    "Provide E2E_ADMIN_EMAIL/E2E_ADMIN_PASSWORD or INSIGHTS_CHAT_ADMIN_COOKIE/tests/.auth/admin.json before running this production-origin smoke.",
  );
  test.skip(
    !bridgeToken,
    `Set ${LIVE_BRIDGE_TOKEN_ENV} to the active local bridge pairing token before running this production-origin smoke.`,
  );
  test.setTimeout(12 * 60_000);

  const productionOriginUrl = new URL(productionOrigin);
  const helperOrigin = new URL(bridgeUrl).origin;
  const thumbnailUrl = new URL(THUMBNAIL_MODULE_PATH, productionOriginUrl).toString();

  await context.addCookies(
    adminCookieHeader
      ? createCookiesFromAdminCookieHeader(adminCookieHeader, productionOriginUrl)
      : await createSupabaseSessionCookies(adminEmail, adminPassword, productionOriginUrl),
  );

  const directProductionLoopbackRequests: Array<{ method: string; path: string; frameUrl: string }> = [];
  const helperLoopbackRequests: Array<{ method: string; path: string; frameUrl: string }> = [];
  const nonLoopbackTokenLeaks: string[] = [];
  const serverGenerationPosts: string[] = [];

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
      url.pathname === "/api/admin/youtube-thumbnail-generator" &&
      request.method() === "POST"
    ) {
      serverGenerationPosts.push(request.url());
    }

    if (!isLoopbackHost(url.hostname)) return;

    const target = { method: request.method(), path: url.pathname, frameUrl };
    if (frameUrl.startsWith(productionOriginUrl.origin)) {
      directProductionLoopbackRequests.push(target);
      return;
    }

    helperLoopbackRequests.push(target);
  });

  await page.goto(thumbnailUrl, { waitUntil: "domcontentloaded" });
  await hidePopupOverlay(page);

  const thumbnailModule = page.locator('[data-admin-youtube-thumbnail-generator="true"]');
  await expect(thumbnailModule).toBeVisible({ timeout: 60_000 });

  await thumbnailModule.locator('[data-thumbnail-chat-settings-toggle="true"]').click();
  await expect(page.locator('[data-thumbnail-chat-settings-dropdown="true"]')).toBeVisible();
  await page.locator('[data-thumbnail-api-router-option="local-bridge"]').click();

  const localBridgeSettings = page.locator('[data-thumbnail-local-bridge-settings="session-only"]');
  await expect(localBridgeSettings).toBeVisible();
  await localBridgeSettings.locator('[data-thumbnail-local-bridge-url-input="true"]').fill(bridgeUrl);
  await localBridgeSettings.locator('[data-thumbnail-local-bridge-token-input="true"]').fill(bridgeToken);
  const helperRequestsBeforeSave = helperLoopbackRequests.length;
  const productionLoopbackBeforeSave = directProductionLoopbackRequests.length;
  await localBridgeSettings.locator('[data-thumbnail-local-bridge-save="true"]').click();
  await page.waitForTimeout(1_500);
  expect(helperLoopbackRequests).toHaveLength(helperRequestsBeforeSave);
  expect(directProductionLoopbackRequests).toHaveLength(productionLoopbackBeforeSave);
  await expect(
    localBridgeSettings.locator('[data-thumbnail-local-bridge-status="needs_reconnect"]'),
  ).toBeVisible({ timeout: 30_000 });
  await expect(localBridgeSettings.locator('[data-thumbnail-local-bridge-message="true"]')).toContainText(
    /로컬 브릿지 연결|Reconnect local bridge/i,
  );
  await expect(localBridgeSettings.locator('[data-thumbnail-local-bridge-message="true"]')).not.toContainText(
    bridgeToken,
  );

  const helperPopupPromise = page.waitForEvent("popup");
  await localBridgeSettings.locator('[data-thumbnail-local-bridge-connect="true"]').click();
  const helperPopup = await helperPopupPromise;
  await helperPopup.waitForLoadState("domcontentloaded");

  const helperUrl = new URL(helperPopup.url());
  expect(helperUrl.origin).toBe(helperOrigin);
  expect(helperUrl.pathname).toBe("/helper");
  expect(helperUrl.searchParams.get("origin")).toBe(productionOriginUrl.origin);
  expect(helperUrl.searchParams.get("surface")).toBe("thumbnail");

  await expect(
    localBridgeSettings.locator('[data-thumbnail-local-bridge-status="connected"]'),
  ).toBeVisible({ timeout: 30_000 });
  await expect(localBridgeSettings.locator('[data-thumbnail-local-bridge-message="true"]')).toContainText(
    /연결됨|connected/i,
  );
  await page.locator('[data-thumbnail-chat-settings-close="true"]').click();
  await expect(page.locator('[data-thumbnail-chat-settings-dropdown="true"]')).toHaveCount(0);

  const fileChooserPromise = page.waitForEvent("filechooser");
  await thumbnailModule.locator('[data-thumbnail-chat-reference-upload="true"]').click();
  const fileChooser = await fileChooserPromise;
  await fileChooser.setFiles(resolve(process.cwd(), "public/images/admin/youtube-thumbnail-food-only-preview.png"));
  await expect(thumbnailModule.locator('[data-thumbnail-chat-message="assistant"]').last()).toContainText("참고 이미지 1장");

  const helperRequestsBeforeGeneration = helperLoopbackRequests.length;
  const serverGenerationPostsBefore = serverGenerationPosts.length;
  const productionLoopbackBeforeGeneration = directProductionLoopbackRequests.length;

  const chatComposer = thumbnailModule.locator('[data-thumbnail-chat-composer="true"] textarea');
  await chatComposer.fill("새 썸네일 이미지를 만들고 캔버스에 넣었습니다 메시지 테스트 생성해줘");
  await chatComposer.press("Enter");

  await expect(
    thumbnailModule.locator('[data-thumbnail-chat-message-mode="live"]').last(),
  ).toContainText("새 썸네일 이미지를 만들고 화면에 넣었습니다", {
    timeout: 10 * 60_000,
  });

  const helperRequestsAfterGeneration = helperLoopbackRequests.slice(helperRequestsBeforeGeneration);
  const helperPathsAfterGeneration = helperRequestsAfterGeneration.map(
    (entry) => `${entry.method} ${entry.path}`,
  );
  const healthIndex = helperPathsAfterGeneration.indexOf("GET /health");
  const authIndex = helperPathsAfterGeneration.findIndex(
    (entry, index) => index > healthIndex && entry === "GET /auth-status",
  );
  const imageIndex = helperPathsAfterGeneration.findIndex(
    (entry, index) => index > authIndex && entry === "POST /v1/youtube-thumbnail/images",
  );

  expect(healthIndex).toBeGreaterThanOrEqual(0);
  expect(authIndex).toBeGreaterThan(healthIndex);
  expect(imageIndex).toBeGreaterThan(authIndex);
  expect(serverGenerationPosts).toHaveLength(serverGenerationPostsBefore);
  expect(directProductionLoopbackRequests).toHaveLength(productionLoopbackBeforeGeneration);
  expect(nonLoopbackTokenLeaks).toHaveLength(0);
});
