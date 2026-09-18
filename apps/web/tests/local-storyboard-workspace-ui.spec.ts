import { expect, test, type Page, type Route } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { createServer, type Server } from "node:http";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  STORYBOARD_WORKFLOW,
  buildStoryboardDraftPrompt,
  storyboardProductionDocumentSchema,
  storyboardProductionRequestSchema,
} from "../lib/admin/storyboard/production-contract";

// UI contracts only: the real React components run against mocked HTTP in Chromium.
// No backend, authentication session, external provider, or model success is claimed.
// The isolated harness also catches accidental server-only imports in the client bundle.
const WEB_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
type HarnessWindow = Window & {
  copiedPrompt?: string;
  opened?: string[][];
  noteStoryboardAbort?: (url: string) => Promise<void>;
};
const API = "/api/admin/storyboard/production";
const ID = "10000000-0000-4000-8000-000000000001";
const OTHER_ID = "10000000-0000-4000-8000-000000000002";
const ASSET_ID = "10000000-0000-4000-8000-000000000003";
const REQUEST_ID = "10000000-0000-4000-8000-000000000004";
const NOW = "2026-09-18T01:00:00.000Z";
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jO1sAAAAASUVORK5CYII=", "base64");
const REQUEST = storyboardProductionRequestSchema.parse({
  workflow: STORYBOARD_WORKFLOW, requestId: REQUEST_ID, prompt: "한국어 영상의 실제 촬영용 장면을 작성합니다.", sceneCount: 5,
  providers: { externalAI: false, text: { id: "local-mlx", model: "installed-text" }, image: { id: "local-mlx", model: "installed-image" } },
});
const DRAFT = {
  title: "UI 계약용 프로젝트", logline: "이 데이터는 모델 성공 증거가 아닌 UI 계약 테스트 픽스처입니다.",
  scenes: Array.from({ length: 5 }, (_, index) => ({
    sceneNo: index + 1, title: `촬영 장면 ${index + 1}`, durationSec: 10,
    description: "정지된 작업 공간의 세부 모습을 보여 줍니다.", visualDirection: "정면 중간 구도에서 촬영합니다.",
    narration: "제작 요청의 장면을 설명합니다.", caption: "작업 공간", productionNotes: ["고정된 카메라를 사용합니다."],
    imagePrompt: "A still life in a quiet workshop, natural window light, no lettering.", sourceIds: [],
  })),
};
const PROVENANCE = {
  providerId: "manual", model: "", verification: "user-import", generatedAt: NOW,
  requestId: REQUEST_ID, responseId: null, responseModel: null, modelEvidence: "unverified",
};
const DOCUMENT = storyboardProductionDocumentSchema.parse({
  ...DRAFT, schema: STORYBOARD_WORKFLOW, projectId: ID, revision: 4, generatedAt: NOW, textProvenance: PROVENANCE,
  scenes: DRAFT.scenes.map((scene) => ({ ...scene, revision: 4, image: null, imageError: null })),
});
function saved(id = ID) {
  return {
    ok: true as const,
    project: { id, revision: 4, request: structuredClone(REQUEST), document: { ...structuredClone(DOCUMENT), projectId: id },
      status: "partial", createdAt: NOW, updatedAt: NOW },
    job: null as null | { id: string; status: string; stage: string; sceneNo: number | null; errorCode: string | null; attempts: number; lastHeartbeat: string | null },
    events: [{ action: "create", revision: 1, createdAt: NOW }],
  };
}
function activeJob(status = "queued") {
  return { id: "job-ui-contract", status, stage: "image", sceneNo: 1, errorCode: null, attempts: 1, lastHeartbeat: NOW };
}
function summary(id: string, title: string) { return { id, title, revision: 4, status: "partial", createdAt: NOW, updatedAt: NOW }; }
const CATALOG = {
  ok: true, projects: [summary(ID, "UI 계약용 프로젝트"), summary(OTHER_ID, "다른 프로젝트")],
  workers: [{ id: "local-worker", online: true, lastHeartbeat: NOW, models: [
    { id: "installed-text", capabilities: ["chat"], loaded: true, bytes_on_disk: 4 * 1024 ** 3, bytes_resident: 4 * 1024 ** 3 },
    { id: "installed-image", capabilities: ["image"], loaded: false, bytes_on_disk: 2 * 1024 ** 3, bytes_resident: 0 },
    { id: "not-installed", capabilities: ["chat", "image"], loaded: false, bytes_on_disk: 0, bytes_resident: 0 },
  ] }],
};
function asset() {
  const variant = (width: number, basename: string) => ({ path: `private/${ID}/${basename}`, sha256: "a".repeat(64), mime: "image/png" as const, width, height: width, bytes: PNG.byteLength });
  return { id: ASSET_ID, trustPolicy: "storyboard-private-asset-v1" as const,
    original: variant(1024, "original.png"), web: [variant(320, "web-320.png"), variant(640, "web-640.png")],
    provenance: DOCUMENT.textProvenance };
}
async function fulfill(route: Route, body: unknown, status = 200) {
  await route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
}
let server: Server;
let origin: string;
let temporary: string;

test.beforeAll(async () => {
  temporary = mkdtempSync(join(tmpdir(), "tzudong-local-storyboard-ui-"));
  const entry = join(temporary, "entry.ts");
  const js = join(temporary, "bundle.js");
  const buildScript = join(temporary, "build.mjs");
  const nextImageEntry = join(temporary, "next-image.mjs");
  const cssInput = join(temporary, "input.css");
  const cssOutput = join(temporary, "bundle.css");
  writeFileSync(entry, [
    `import { createElement } from ${JSON.stringify(join(WEB_ROOT, "node_modules/react/index.js"))};`,
    `import { createRoot } from ${JSON.stringify(join(WEB_ROOT, "node_modules/react-dom/client.js"))};`,
    `import { AdminStoryboardGenerator } from ${JSON.stringify(join(WEB_ROOT, "components/admin/storyboard/AdminStoryboardGenerator.tsx"))};`,
    "const root = createRoot(document.getElementById('root'));",
    "root.render(createElement(AdminStoryboardGenerator));",
  ].join("\n"));
  // Use the real Next image component through its named export: the CJS default
  // entry relies on Next's bundler interop, which this isolated Bun harness lacks.
  writeFileSync(nextImageEntry, `export { Image as default } from ${JSON.stringify(join(WEB_ROOT, "node_modules/next/dist/client/image-component.js"))};`);
  writeFileSync(buildScript, [
    "const result = await Bun.build({",
    `entrypoints: [${JSON.stringify(entry)}], target: 'browser',`,
    `define: { 'process.env.NODE_ENV': '"development"' },`,
    `plugins: [{ name: 'next-image-entry', setup(build) { build.onResolve({ filter: /^next\\/image$/ }, () => ({ path: ${JSON.stringify(nextImageEntry)} })); } }],`,
    "});",
    "if (!result.success) throw new AggregateError(result.logs, 'UI bundle failed');",
    "if (result.outputs.length !== 1) throw new Error('Expected one browser bundle');",
    `await Bun.write(${JSON.stringify(js)}, result.outputs[0]);`,
  ].join("\n"));
  execFileSync("bun", [buildScript], { cwd: WEB_ROOT, stdio: "pipe" });
  writeFileSync(cssInput, `@import ${JSON.stringify(join(WEB_ROOT, "app/globals.css"))};\n@import ${JSON.stringify(join(WEB_ROOT, "app/app-globals.css"))};`);
  execFileSync("bun", [join(WEB_ROOT, "node_modules/@tailwindcss/cli/dist/index.mjs"), "-i", cssInput, "-o", cssOutput], { cwd: WEB_ROOT, stdio: "pipe" });
  const javascript = readFileSync(js);
  const css = readFileSync(cssOutput);
  server = createServer((request, response) => {
    if (request.url === "/bundle.js") { response.writeHead(200, { "Content-Type": "text/javascript" }); response.end(javascript); }
    else if (request.url === "/bundle.css") { response.writeHead(200, { "Content-Type": "text/css" }); response.end(css); }
    else if (request.url?.startsWith("/admin")) {
      response.writeHead(200, { "Content-Type": "text/html" });
      response.end('<!doctype html><html lang="ko"><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/bundle.css"><style>html,body,#root{height:100%;margin:0}#root{min-width:0}body{overflow:hidden}</style></head><body><div id="root"></div><script>window.process={env:{NODE_ENV:"development"}}</script><script type="module" src="/bundle.js"></script></body></html>');
    } else { response.writeHead(404, { "Content-Type": "application/json" }); response.end('{"ok":false}'); }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("UI harness did not bind a loopback port");
  origin = `http://127.0.0.1:${address.port}`;
});
test.afterAll(async () => {
  if (server) await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  if (temporary) rmSync(temporary, { recursive: true, force: true });
});
test.beforeEach(async ({ page }) => {
  await page.route("**/*", async (route) => {
    if (new URL(route.request().url()).origin === origin) await route.continue();
    else await route.abort();
  });
  await page.route(`**${API}**`, async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === API) await fulfill(route, CATALOG);
    else if (path.includes("/assets/")) await route.fulfill({ contentType: "image/png", body: PNG });
    else await fulfill(route, saved(path.split("/").at(-1)));
  });
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async (text: string) => {
      (window as HarnessWindow).copiedPrompt = text;
    } } });
  });
});
test.afterEach(async ({ page }) => {
  expect((await page.pageErrors()).map((error) => error.message), "unhandled browser errors in the isolated UI harness").toEqual([]);
});
async function open(page: Page, id?: string) {
  await page.goto(`${origin}/admin?module=storyboard${id ? `&storyboardProject=${id}` : ""}#workspace`);
  await expect(page.getByRole("heading", { name: "로컬 스토리보드", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "목록 새로고침", exact: true })).toBeEnabled();
  if (id) await expect(page.getByRole("heading", { name: "UI 계약용 프로젝트", exact: true })).toBeVisible();
}

test.describe("Local storyboard UI contracts (mock HTTP, no real model success)", () => {
  test("defaults to local, filters model capabilities, and mounts legacy only after a keyboard click", async ({ page }) => {
    const requests: string[] = [];
    page.on("request", (request) => requests.push(request.url()));
    await page.clock.install();
    await open(page);
    await expect(page.getByLabel("텍스트 생성 방식", { exact: true })).toHaveValue("local-mlx");
    await expect(page.getByLabel("이미지 생성 방식", { exact: true })).toHaveValue("local-mlx");
    await expect(page.getByLabel("외부 AI 사용 허용", { exact: false })).not.toBeChecked();
    await expect(page.locator('option[value="chatgpt-manual"]')).toHaveCount(0);
    await expect(page.locator('option[value="grok-manual"]')).toHaveCount(0);
    await expect(page.locator('#local-text-provider option[value="openai-api"]')).toBeDisabled();
    await expect(page.locator('#local-image-provider option[value="xai-api"]')).toBeDisabled();
    await expect(page.locator('#local-text-model option[value="installed-image"]')).toHaveCount(0);
    await expect(page.locator('#local-image-model option[value="installed-text"]')).toHaveCount(0);
    await expect(page.locator('option[value="not-installed"]')).toHaveCount(0);
    await page.clock.fastForward(20_000);
    expect(requests.filter((url) => url.includes("/api/") || url.includes("/qa-history/"))).toEqual([`${origin}${API}`]);
    await expect(page.locator('[data-admin-storyboard-generator="true"]')).toHaveCount(0);
    const legacy = page.getByRole("button", { name: "기존 스토리보드 UI 열기 (레거시)", exact: true });
    await legacy.focus(); await page.keyboard.press("Enter");
    await expect(page.locator('[data-local-storyboard-workspace="true"]')).toHaveCount(0);
    await expect(page.locator('[data-admin-storyboard-generator="true"]')).toBeVisible();
    await page.getByRole("button", { name: "로컬 작업 공간으로 돌아가기" }).click();
    await expect(page.locator('[data-admin-storyboard-generator="true"]')).toHaveCount(0);
  });

  test("keeps text/image selections independent and clears web providers when consent is withdrawn", async ({ page }) => {
    await open(page);
    await page.getByLabel("텍스트 생성 방식", { exact: true }).selectOption("manual");
    await expect(page.getByLabel("이미지 생성 방식", { exact: true })).toHaveValue("local-mlx");
    await page.getByLabel("외부 AI 사용 허용", { exact: false }).check();
    await page.getByLabel("텍스트 생성 방식", { exact: true }).selectOption("chatgpt-manual");
    await page.getByLabel("이미지 생성 방식", { exact: true }).selectOption("grok-manual");
    await page.getByLabel("외부 AI 사용 허용", { exact: false }).uncheck();
    await expect(page.getByLabel("텍스트 생성 방식", { exact: true })).toHaveValue("manual");
    await expect(page.getByLabel("이미지 생성 방식", { exact: true })).toHaveValue("manual");
    await expect(page.locator('option[value="chatgpt-manual"]')).toHaveCount(0);
  });

  test("creates the schema request without cloud calls and reuses the UUID after an uncertain identical create", async ({ page }) => {
    const posts: Record<string, unknown>[] = [];
    let created = saved();
    await page.route(`**${API}`, async (route) => {
      if (route.request().method() !== "POST") return fulfill(route, CATALOG);
      const body = route.request().postDataJSON(); posts.push(body);
      if (posts.length === 1) return fulfill(route, { ok: false, error: "private-provider-diagnostic-do-not-render" }, 503);
      created = saved(); created.project.request = storyboardProductionRequestSchema.parse(body);
      return fulfill(route, created);
    });
    await page.route(`**${API}/${ID}`, (route) => fulfill(route, created));
    await open(page);
    await page.getByLabel("제작 요청", { exact: true }).fill(REQUEST.prompt);
    await page.getByLabel("장면 수 (5–12)", { exact: true }).fill("5");
    await page.getByLabel("텍스트 생성 방식", { exact: true }).selectOption("manual");
    await page.getByLabel("이미지 모델", { exact: true }).selectOption("installed-image");
    await page.getByRole("button", { name: "프로젝트 만들기", exact: true }).click();
    await expect(page.getByRole("alert")).toContainText("자동 재전송하지 않습니다");
    await expect(page.getByText("private-provider-diagnostic-do-not-render", { exact: false })).toHaveCount(0);
    expect(posts).toHaveLength(1);
    await page.getByRole("button", { name: "프로젝트 만들기", exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`module=storyboard&storyboardProject=${ID}#workspace`));
    expect(posts).toHaveLength(2);
    expect(posts[0].requestId).toBe(posts[1].requestId);
    expect(posts[1]).toMatchObject({ workflow: STORYBOARD_WORKFLOW, retrieval: "none", sources: [], providers: {
      externalAI: false, text: { id: "manual", model: "" }, image: { id: "local-mlx", model: "installed-image" },
    } });
  });

  test("does not restore external consent from a saved project; opening either website needs an explicit button", async ({ page }) => {
    const current = saved();
    current.project.request.providers = { externalAI: true, text: { id: "chatgpt-manual", model: "" }, image: { id: "grok-manual", model: "" } };
    await page.route(`**${API}/${ID}`, (route) => fulfill(route, current));
    await page.addInitScript(() => {
      (window as HarnessWindow).opened = [];
      window.open = (...args) => { (window as HarnessWindow).opened?.push(args.map(String)); return null; };
    });
    await open(page, ID);
    await expect(page.getByRole("button", { name: "ChatGPT 웹 직접 열기" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "장면 1 재생성", exact: true })).toBeDisabled();
    await page.getByLabel("외부 AI 사용 허용", { exact: false }).check();
    expect(await page.evaluate(() => (window as HarnessWindow).opened)).toEqual([]);
    await page.getByRole("button", { name: "ChatGPT 웹 직접 열기" }).click();
    await page.getByRole("button", { name: "Grok 웹 직접 열기" }).click();
    expect(await page.evaluate(() => (window as HarnessWindow).opened)).toEqual([
      ["https://chatgpt.com", "_blank", "noopener,noreferrer"], ["https://grok.com", "_blank", "noopener,noreferrer"],
    ]);
  });

  test("polls queued/claimed jobs, locks scene edits, and stops after a terminal response", async ({ page }) => {
    await page.clock.install();
    let reads = 0;
    await page.route(`**${API}/${ID}`, async (route) => {
      reads++;
      const current = saved();
      if (reads < 3) { current.project.status = "generating"; current.job = activeJob(reads === 1 ? "queued" : "claimed"); }
      await fulfill(route, current);
    });
    await open(page, ID);
    await expect(page.getByRole("button", { name: "장면 1 편집", exact: true })).toBeDisabled();
    await page.clock.fastForward(2600); await expect.poll(() => reads).toBe(2);
    await page.clock.fastForward(2600); await expect.poll(() => reads).toBe(3);
    await expect(page.getByRole("button", { name: "장면 1 편집", exact: true })).toBeEnabled();
    await page.clock.fastForward(30_000); expect(reads).toBe(3);
  });

  test("aborts a pending read on project change and ignores the late result; back navigation restores the query", async ({ page }) => {
    let pending: Route | null = null;
    const aborted: string[] = [];
    await page.exposeFunction("noteStoryboardAbort", (url: string) => aborted.push(url));
    await page.addInitScript(() => {
      const original = window.fetch;
      window.fetch = (input, init) => {
        init?.signal?.addEventListener("abort", () => { void (window as HarnessWindow).noteStoryboardAbort?.(String(input)); });
        return original(input, init);
      };
    });
    await page.route(`**${API}/${ID}`, async (route) => { pending = route; });
    await open(page);
    await page.getByRole("button", { name: /^UI 계약용 프로젝트/ }).click();
    await expect.poll(() => pending !== null).toBe(true);
    await page.getByRole("button", { name: /^다른 프로젝트/ }).click();
    await expect(page).toHaveURL(new RegExp(`storyboardProject=${OTHER_ID}`));
    await expect.poll(() => aborted).toContain(`${API}/${ID}`);
    await expect(page.getByRole("heading", { name: "UI 계약용 프로젝트", exact: true })).toBeVisible();
    const late = saved(); late.project.document.title = "늦은 응답으로 덮어쓰면 안 됩니다";
    await fulfill(pending!, late);
    await expect(page.getByRole("heading", { name: late.project.document.title })).toHaveCount(0);
    await page.getByRole("button", { name: "새 프로젝트", exact: true }).click();
    await expect(page).not.toHaveURL(/storyboardProject=/);
    await page.goBack();
    await expect(page).toHaveURL(new RegExp(`module=storyboard&storyboardProject=${OTHER_ID}#workspace`));
  });

  test("stops on failed polling, shows fixed errors, and resumes only on explicit refresh", async ({ page }) => {
    await page.clock.install();
    let reads = 0;
    await page.route(`**${API}/${ID}`, async (route) => {
      reads++;
      if (reads === 2) return fulfill(route, { ok: false, error: "sensitive-provider-response" }, 502);
      const current = saved();
      if (reads === 1) { current.project.status = "waiting_worker"; current.job = activeJob(); }
      await fulfill(route, current);
    });
    await open(page, ID);
    await page.clock.fastForward(2600);
    await expect(page.getByRole("alert")).toContainText("요청 상태를 확인하지 못했습니다");
    await page.clock.fastForward(30_000); expect(reads).toBe(2);
    await expect(page.getByText("sensitive-provider-response", { exact: false })).toHaveCount(0);
    await page.getByRole("button", { name: "프로젝트 새로고침", exact: true }).click();
    await expect.poll(() => reads).toBe(3);
    await expect(page.getByRole("button", { name: "장면 1 편집", exact: true })).toBeEnabled();
  });

  for (const navigateDuringReadback of [false, true]) {
    test(`edits saved scenes with the captured revision and ${navigateDuringReadback ? "preserves keyboard navigation during" : "restores keyboard focus after"} delayed readback`, async ({ page }) => {
      const posts: Record<string, unknown>[] = [];
      const current = saved();
      let readback: Route | null = null;
      await page.route(`**${API}/${ID}`, async (route) => {
        if (route.request().method() === "POST") {
          const body = route.request().postDataJSON(); posts.push(body);
          current.project.revision++;
          current.project.document.scenes[0] = { ...current.project.document.scenes[0], ...body.scene, revision: 5 };
        } else if (posts.length > 0) {
          readback = route;
          return;
        }
        await fulfill(route, current);
      });
      await open(page, ID);
      const edit = page.getByRole("button", { name: "장면 1 편집", exact: true });
      await edit.click();
      await expect(page.getByLabel("장면 제목", { exact: true })).toBeFocused();
      await page.getByLabel("장면 제목", { exact: true }).fill("수정한 장면");
      await page.getByRole("button", { name: "장면 저장", exact: true }).focus();
      await page.keyboard.press("Enter");
      await expect(page.getByRole("heading", { name: "1. 수정한 장면", exact: true })).toBeVisible();
      expect(posts[0]).toEqual({ action: "edit", revision: 4, sceneNo: 1, scene: { ...DRAFT.scenes[0], title: "수정한 장면" } });
      await expect.poll(() => readback !== null).toBe(true);
      await expect(edit).toBeDisabled();
      await expect(page.getByRole("form", { name: "장면 1 편집 양식" })).toHaveCount(0);
      // Keep the readback pending for two frames so an early focus attempt cannot pass by timing luck.
      await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
      await expect(page.getByRole("heading", { name: "UI 계약용 프로젝트", exact: true })).toBeFocused();
      const exportButton = page.getByRole("button", { name: "파일 포함 JSON 내보내기", exact: true });
      if (navigateDuringReadback) {
        await page.keyboard.press("Tab");
        await expect(exportButton).toBeFocused();
      }
      await fulfill(readback!, current);
      await expect(edit).toBeEnabled();
      await expect(navigateDuringReadback ? exportButton : edit).toBeFocused();
      await edit.click(); await page.keyboard.press("Escape");
      await expect(page.getByRole("form", { name: "장면 1 편집 양식" })).toHaveCount(0);
      await expect(edit).toBeFocused();
    });
  }

  test("retains unsaved scene edits on 409 and prevents rebasing them silently onto a new revision", async ({ page }) => {
    let current = saved();
    let posts = 0;
    await page.route(`**${API}/${ID}`, async (route) => {
      if (route.request().method() === "POST") {
        posts++; current = saved(); current.project.revision = 5;
        return fulfill(route, { ok: false, error: "revision_conflict" }, 409);
      }
      await fulfill(route, current);
    });
    await open(page, ID);
    await page.getByRole("button", { name: "장면 1 편집", exact: true }).click();
    await page.getByLabel("장면 제목", { exact: true }).fill("보존할 미저장 입력");
    await page.getByRole("button", { name: "장면 저장", exact: true }).click();
    await expect(page.getByLabel("장면 제목", { exact: true })).toHaveValue("보존할 미저장 입력");
    await expect(page.getByRole("button", { name: "장면 저장", exact: true })).toBeDisabled();
    await expect(page.getByText("편집을 시작한 뒤 버전이 변경되었습니다.", { exact: false })).toBeVisible();
    expect(posts).toBe(1);
  });

  test("surfaces the server's own 409 reason instead of reporting a revision conflict", async ({ page }) => {
    const current = saved();
    const posts: Record<string, unknown>[] = [];
    await page.route(`**${API}/${ID}`, async (route) => {
      if (route.request().method() === "POST") {
        posts.push(route.request().postDataJSON());
        return fulfill(route, { ok: false, error: "nothing_to_retry" }, 409);
      }
      await fulfill(route, current);
    });
    await open(page, ID);
    await page.getByRole("button", { name: "재시도", exact: true }).click();
    await expect(page.getByText("다시 생성할 장면이 없습니다. 모든 장면의 이미지가 이미 저장되어 있습니다.")).toBeVisible();
    await expect(page.getByText("다른 편집 또는 생성으로 장면이 변경되었습니다.", { exact: false })).toHaveCount(0);
    expect(posts).toHaveLength(1);
  });

  test("disables retry once every stored scene already has an image", async ({ page }) => {
    const current = saved();
    current.project.status = "cancelled";
    current.project.document.scenes = current.project.document.scenes.map((scene, index) => ({
      ...scene, image: { ...asset(), id: `10000000-0000-4000-8000-00000000001${index}` } }));
    await page.route(`**${API}/${ID}`, (route) => fulfill(route, current));
    await open(page, ID);
    await expect(page.getByRole("button", { name: "재시도", exact: true })).toBeDisabled();
  });

  test("sends retry, cancel, and per-scene regeneration with server revisions and explicit UUIDs", async ({ page }) => {
    const current = saved(); current.project.status = "failed";
    const posts: Record<string, unknown>[] = [];
    await page.route(`**${API}/${ID}`, async (route) => {
      if (route.request().method() === "POST") {
        const body = route.request().postDataJSON(); posts.push(body); current.project.revision++;
        current.project.status = body.action === "cancel" ? "cancelled" : "generating";
        current.job = activeJob(body.action === "cancel" ? "cancelled" : "queued");
      }
      await fulfill(route, current);
    });
    await open(page, ID);
    await page.getByRole("button", { name: "재시도", exact: true }).click();
    await expect(page.getByRole("button", { name: "작업 취소", exact: true })).toBeEnabled();
    await page.getByRole("button", { name: "작업 취소", exact: true }).click();
    await expect(page.getByRole("button", { name: "장면 1 재생성", exact: true })).toBeEnabled();
    await page.getByRole("button", { name: "장면 1 재생성", exact: true }).click();
    await expect.poll(() => posts.length).toBe(3);
    expect(posts[0]).toMatchObject({ action: "retry", revision: 4 });
    expect(posts[1]).toEqual({ action: "cancel", revision: 5, jobId: "job-ui-contract" });
    expect(posts[2]).toMatchObject({ action: "regenerate", revision: 6, sceneNo: 1 });
    expect(posts[0].requestId).toMatch(/^[a-f0-9-]{36}$/);
    expect(posts[2].requestId).not.toBe(posts[0].requestId);
  });

  test("copies the real schema prompt and imports only a matching versioned text envelope", async ({ page }) => {
    const posts: Record<string, unknown>[] = [];
    await page.route(`**${API}/${ID}`, async (route) => {
      if (route.request().method() === "POST") posts.push(route.request().postDataJSON());
      await fulfill(route, saved());
    });
    await open(page, ID);
    await page.getByRole("button", { name: "현재 텍스트 프롬프트 복사", exact: true }).click();
    const copied = await page.evaluate(() => (window as HarnessWindow).copiedPrompt);
    expect(copied).toContain(buildStoryboardDraftPrompt(REQUEST));
    expect(copied).toContain(`"schema":"${STORYBOARD_WORKFLOW}","projectId":"${ID}","revision":4`);
    expect(copied).toContain('"productionNotes"');
    const input = page.getByLabel("버전이 포함된 JSON", { exact: false });
    const envelope = { schema: STORYBOARD_WORKFLOW, projectId: ID, revision: 4, draft: DRAFT };
    for (const invalid of [{ ...envelope, projectId: OTHER_ID }, { ...envelope, revision: 3 }, { ...envelope, schema: "unversioned" }, { ...envelope, draft: { ...DRAFT, scenes: DRAFT.scenes.slice(0, 4) } }, { ...envelope, provenance: PROVENANCE }]) {
      await input.fill(JSON.stringify(invalid));
      await page.getByRole("button", { name: "텍스트 가져오기", exact: true }).click();
      await expect(page.getByRole("alert")).toContainText("현재 프로젝트의 schema");
    }
    expect(posts).toHaveLength(0);
    await input.fill(JSON.stringify(envelope));
    await page.getByRole("button", { name: "텍스트 가져오기", exact: true }).click();
    await expect(input).toHaveValue("");
    expect(posts).toEqual([{ action: "import-text", ...envelope }]);
    await expect(page.getByText("모델 미검증", { exact: false })).toBeVisible();
  });

  test("validates image files, sends only the multipart contract, and renders authenticated responsive variants", async ({ page }) => {
    const current = saved();
    let uploaded: FormData | null = null;
    await page.route(`**${API}/${ID}`, (route) => fulfill(route, current));
    await page.route(`**${API}/${ID}/images`, async (route) => {
      const body = route.request().postDataBuffer();
      uploaded = await new Response(new Uint8Array(body!), { headers: { "content-type": route.request().headers()["content-type"] } }).formData();
      current.project.document.scenes[0].image = asset(); current.project.revision++;
      await fulfill(route, current);
    });
    await open(page, ID);
    const input = page.getByLabel("장면 1 이미지 파일", { exact: false });
    const apply = page.getByRole("button", { name: "장면 1 이미지 가져오기 적용", exact: true });
    await input.setInputFiles({ name: "blocked.svg", mimeType: "image/svg+xml", buffer: Buffer.from("<svg/>") });
    await apply.click(); await expect(page.getByRole("alert")).toContainText("PNG, JPEG, WebP"); expect(uploaded).toBeNull();
    await input.setInputFiles({ name: "too-large.png", mimeType: "image/png", buffer: Buffer.alloc(12 * 1024 ** 2 + 1) });
    await apply.click(); await expect(page.getByRole("alert")).toContainText("허용 범위"); expect(uploaded).toBeNull();
    await input.setInputFiles({ name: "scene.png", mimeType: "image/png", buffer: PNG });
    await apply.click();
    await expect.poll(() => uploaded !== null).toBe(true);
    expect([...uploaded!.keys()].sort()).toEqual(["file", "projectId", "revision", "sceneNo", "schema"]);
    expect(uploaded!.get("revision")).toBe("4"); expect(uploaded!.get("projectId")).toBe(ID);
    expect(uploaded!.get("sceneNo")).toBe("1"); expect(uploaded!.get("schema")).toBe(STORYBOARD_WORKFLOW);
    const image = page.getByRole("img", { name: "촬영 장면 1", exact: true });
    await expect(image).toHaveAttribute("src", `${API}/${ID}/assets/${ASSET_ID}?variant=web-640.png`);
    await expect(image).toHaveAttribute("srcset", `${API}/${ID}/assets/${ASSET_ID}?variant=web-320.png 320w, ${API}/${ID}/assets/${ASSET_ID}?variant=web-640.png 640w`);
    await expect(image).toHaveAttribute("sizes", /100vw/);
    expect(await image.evaluate((node: HTMLImageElement) => node.src.startsWith(window.location.origin))).toBe(true);
  });

  test("downloads the server export including actual fixture file bytes and hashes", async ({ page }) => {
    const exported = { document: DOCUMENT, request: REQUEST, files: [{ path: "original.png", base64: PNG.toString("base64"), sha256: "a".repeat(64) }] };
    await page.route(`**${API}/${ID}/export`, (route) => fulfill(route, exported));
    await open(page, ID);
    const received = page.waitForEvent("download");
    await page.getByRole("button", { name: "파일 포함 JSON 내보내기", exact: true }).click();
    const download = await received;
    expect(download.suggestedFilename()).toBe(`storyboard-${ID}.json`);
    const path = await download.path();
    expect(JSON.parse(readFileSync(path!, "utf8"))).toEqual(exported);
  });

  test("rejects mismatched project responses instead of showing fake success", async ({ page }) => {
    await page.route(`**${API}/${ID}`, (route) => fulfill(route, saved(OTHER_ID)));
    await open(page);
    await page.getByRole("button", { name: /^UI 계약용 프로젝트/ }).click();
    await expect(page.getByRole("alert")).toContainText("서버 응답 형식을 확인할 수 없습니다");
    await expect(page.getByRole("heading", { name: "저장된 장면", exact: false })).toHaveCount(0);
  });

  for (const viewport of [{ width: 390, height: 844 }, { width: 768, height: 1024 }, { width: 1440, height: 900 }]) {
    for (const dark of [false, true]) {
      test(`responsive ${viewport.width}x${viewport.height} ${dark ? "dark" : "light"}`, async ({ page }, testInfo) => {
        await page.setViewportSize(viewport);
        const current = saved(); current.project.document.scenes[0].image = asset();
        current.project.document.scenes[0].description = "긴장면설명과촬영방향".repeat(80);
        await page.route(`**${API}/${ID}`, (route) => fulfill(route, current));
        await open(page, ID);
        await page.evaluate((value) => document.documentElement.classList.toggle("dark", value), dark);
        const workspace = page.locator('[data-local-storyboard-workspace="true"]');
        const overflow = () => workspace.evaluate((element) => element.scrollWidth - element.clientWidth);
        expect(await overflow()).toBeLessThanOrEqual(1);
        expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1);
        await page.screenshot({ path: testInfo.outputPath("workspace.png") });
        const edit = page.getByRole("button", { name: "장면 1 편집", exact: true });
        await edit.click();
        await expect(page.getByLabel("장면 제목", { exact: true })).toBeFocused();
        expect(await overflow()).toBeLessThanOrEqual(1);
        await page.keyboard.press("Escape");
        await expect(edit).toBeFocused();
        await page.getByRole("heading", { name: "1. 촬영 장면 1", exact: true }).scrollIntoViewIfNeeded();
        await page.screenshot({ path: testInfo.outputPath("saved-scenes.png") });
      });
    }
  }
});
