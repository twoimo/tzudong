import { afterAll, beforeAll, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, expect as browserExpect, type Browser, type Page } from "@playwright/test";

const chrome = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const browserTest = existsSync(chrome) ? test : test.skip;
const root = join(import.meta.dir, "..");
const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
let browser: Browser | undefined;
let script: string;
let css: string;
let temporary: string;

type CatalogMode = "normal" | "failure" | "empty" | "pending";
type Fixture = { mode: CatalogMode; allowDeparture: boolean; calls: string[]; confirmations: string[]; release: () => void };
declare global { interface Window { storyboardLibraryFixture: Fixture } }

// The production component and its real CSS run in an isolated browser. All API
// reads are fixtures; writes fail the test. No provider or app server is contacted.
beforeAll(async () => {
  if (!existsSync(chrome)) return;
  const fixture = `
import React from 'react';
import { createRoot } from 'react-dom/client';
import { LocalStoryboardWorkspace } from './components/admin/storyboard/LocalStoryboardWorkspace';
import { STORYBOARD_WORKFLOW } from './lib/admin/storyboard/production-contract';
const now='2026-10-05T01:00:00.000Z', A='${A}', B='${B}';
const titles={ [A]:'서울 시장 먹방', [B]:'부산 골목의 오래된 가게에서 만난 따뜻한 국밥과 반찬을 소개하는 촬영 기획' };
const scene=n=>({sceneNo:n,title:'장면 '+n,durationSec:10,description:'촬영 내용',visualDirection:'가게 전경',narration:'음식 소개',caption:'오늘의 맛집',productionNotes:['고정 카메라'],imagePrompt:'Food',sourceIds:[],revision:1,image:null,imageError:null});
const summary=id=>({id,title:titles[id],revision:1,status:id===A?'partial':'failed',createdAt:now,updatedAt:id===A?'2026-10-04T01:00:00.000Z':now});
const project=id=>({...summary(id),request:{workflow:STORYBOARD_WORKFLOW,requestId:id,prompt:'촬영 기획',sceneCount:5,retrieval:'none',sources:[],imageWidth:1024,imageHeight:576,providers:{externalAI:false,text:{id:'manual',model:''},image:{id:'manual',model:''}}},
 document:{schema:STORYBOARD_WORKFLOW,projectId:id,revision:1,generatedAt:now,title:titles[id],logline:'저장된 기획',
 textProvenance:{providerId:'manual',model:'',verification:'user-import',generatedAt:now,requestId:id,responseId:null,responseModel:null,modelEvidence:'unverified'},scenes:Array.from({length:5},(_,i)=>scene(i+1))}});
const fixture=window.storyboardLibraryFixture={mode:'normal',allowDeparture:false,calls:[],confirmations:[],release:()=>{}};
window.confirm=text=>{fixture.confirmations.push(text);return fixture.allowDeparture;};
window.fetch=async(url,init={})=>{
 const method=init.method||'GET',path=new URL(url,location.href).pathname;
 fixture.calls.push(method+' '+path);
 if(method!=='GET')throw new Error('Writes are prohibited in the library fixture');
 if(path==='/api/admin/storyboard/production'){
  if(fixture.mode==='pending')await new Promise(resolve=>{fixture.release=resolve;});
  if(fixture.mode==='failure')throw new TypeError('Fixture offline');
  return new Response(JSON.stringify({ok:true,projects:fixture.mode==='empty'?[]:[summary(A),summary(B)],workers:[]}));
 }
 const id=path.split('/').at(-1);
 if(id!==A&&id!==B)throw new Error('Unexpected fixture read');
 return new Response(JSON.stringify({ok:true,project:project(id),job:null,events:[]}));
};
createRoot(document.getElementById('root')).render(<LocalStoryboardWorkspace/>);
`;
  const bundle = await Bun.build({
    entrypoints: ["storyboard-library-fixture"], target: "browser", format: "iife", write: false,
    define: { "process.env.NODE_ENV": '"test"' },
    plugins: [{ name: "library-fixture", setup(builder) {
      builder.onResolve({ filter: /^storyboard-library-fixture$/ }, () => ({ path: "fixture.tsx", namespace: "fixture" }));
      builder.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({ contents: fixture, loader: "tsx", resolveDir: root }));
      builder.onResolve({ filter: /^@\// }, ({ path }) => {
        const target = join(root, path.slice(2));
        const resolved = ["", ".ts", ".tsx", "/index.ts", "/index.tsx"].map(suffix => target + suffix).find(existsSync);
        return resolved ? { path: resolved } : undefined;
      });
    } }],
  });
  expect(bundle.success).toBe(true);
  script = await bundle.outputs[0].text();
  temporary = mkdtempSync(join(tmpdir(), "storyboard-library-ui-"));
  const cssPath = join(temporary, "app.css");
  execFileSync(process.execPath, [join(root, "node_modules/@tailwindcss/cli/dist/index.mjs"),
    "-i", join(root, "tests/fixtures/local-storyboard-ui/input.css"), "-o", cssPath], { cwd: root, stdio: "pipe" });
  css = `${readFileSync(cssPath, "utf8")}\n${readFileSync(join(root, "styles/admin-ui.css"), "utf8")}`;
  browser = await chromium.launch({ executablePath: chrome, headless: true });
}, 30_000);
afterAll(async () => {
  await browser?.close();
  if (temporary) rmSync(temporary, { recursive: true, force: true });
});

async function run(check: (page: Page) => Promise<void>, width = 1423, id?: string) {
  if (!browser) throw new Error("Local Chrome prerequisite missing");
  const context = await browser.newContext({ viewport: { width, height: 1000 }, reducedMotion: "reduce" });
  const page = await context.newPage();
  page.setDefaultTimeout(5000);
  const errors: string[] = [], blocked: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.route("**/*", route => {
    if (route.request().isNavigationRequest() && route.request().url().startsWith("http://storyboard-library.fixture.test/")) {
      return route.fulfill({ contentType: "text/html", body: '<!doctype html><html lang="ko"><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body style="margin:0"><div id="root" style="height:100vh;min-width:0"></div></body></html>' });
    }
    blocked.push(route.request().url()); return route.abort();
  });
  try {
    await page.goto(`http://storyboard-library.fixture.test/admin?module=storyboard${id ? `&storyboardProject=${id}` : ""}`);
    await page.addStyleTag({ content: css });
    await page.addScriptTag({ content: script });
    await page.getByRole("heading", { name: "스토리보드", exact: true }).waitFor();
    await browserExpect(page.getByLabel("프로젝트 선택", { exact: true }).locator("option")).toHaveCount(3);
    await check(page);
    expect(errors).toEqual([]); expect(blocked).toEqual([]);
    expect(await page.evaluate(() => window.storyboardLibraryFixture.calls.every(call => call.startsWith("GET ")))).toBe(true);
  } finally { await context.close(); }
}
const list = (page: Page) => page.getByRole("list", { name: "저장된 프로젝트 목록", exact: true });
const refresh = (page: Page) => page.getByRole("button", { name: "프로젝트 목록 다시 불러오기", exact: true });
const firstProject = (page: Page) => list(page).getByRole("button", { name: /^서울 시장 먹방/ });
const secondProject = (page: Page) => list(page).getByRole("button", { name: /^부산 골목/ });

browserTest("library filters, clears filters, sorts newest first and opens detail with the keyboard", () => run(async page => {
  expect(await list(page).getByRole("button").first().innerText()).toContain("부산 골목");
  await page.getByRole("searchbox", { name: "프로젝트 검색" }).fill(" 서울 ");
  expect(await list(page).getByRole("button").count()).toBe(1);
  await page.getByRole("combobox", { name: "프로젝트 상태", exact: true }).selectOption("failed");
  await page.getByText("검색 조건에 맞는 프로젝트가 없습니다.", { exact: true }).waitFor();
  await page.getByRole("button", { name: "검색 조건 초기화", exact: true }).click();
  expect(await list(page).getByRole("button").count()).toBe(2);
  await firstProject(page).focus(); await page.keyboard.press("Enter");
  await page.getByRole("heading", { name: "서울 시장 먹방", exact: true }).waitFor();
  expect(page.url()).toContain(A);
  expect(await page.getByRole("heading", { name: "서울 시장 먹방", exact: true }).evaluate(node => node === document.activeElement)).toBe(true);
  expect(await list(page).count()).toBe(0);
  await page.getByRole("button", { name: "프로젝트 목록", exact: true }).click();
  expect(await firstProject(page).getAttribute("aria-current")).toBe("true");
}), 15_000);

browserTest("library keeps loaded rows during refresh errors and exposes recovery and loading", () => run(async page => {
  await page.evaluate(() => { window.storyboardLibraryFixture.mode = "failure"; });
  await refresh(page).click();
  await page.getByRole("alert").waitFor();
  expect(await list(page).getByRole("button").count()).toBe(2);
  await page.evaluate(() => { window.storyboardLibraryFixture.mode = "pending"; });
  await refresh(page).click();
  await page.getByText("프로젝트 목록 확인 중…", { exact: true }).waitFor();
  expect(await refresh(page).isDisabled()).toBe(true);
  await page.evaluate(() => { window.storyboardLibraryFixture.mode = "normal"; window.storyboardLibraryFixture.release(); });
  await browserExpect(refresh(page)).toBeEnabled();
  expect(await page.getByRole("alert").count()).toBe(0);
  await page.evaluate(() => { window.storyboardLibraryFixture.mode = "empty"; });
  await refresh(page).click();
  await page.getByRole("button", { name: "새 제작 요청 작성", exact: true }).click();
  await browserExpect(page.getByLabel("제작 요청", { exact: true })).toBeFocused();
}), 15_000);

browserTest("choosing a library row retains unsaved edits until departure is explicitly confirmed", () => run(async page => {
  await page.getByRole("button", { name: "장면 1 편집", exact: true }).click();
  await page.getByLabel("장면 제목", { exact: true }).fill("저장 전 편집");
  await page.getByRole("button", { name: "프로젝트 목록", exact: true }).click();
  await secondProject(page).click();
  expect(await page.getByLabel("장면 제목", { exact: true }).inputValue()).toBe("저장 전 편집");
  expect(page.url()).toContain(A);
  expect(await page.evaluate(() => window.storyboardLibraryFixture.confirmations.length)).toBe(1);
  await page.evaluate(() => { window.storyboardLibraryFixture.allowDeparture = true; });
  await secondProject(page).click();
  await page.getByRole("heading", { name: /^부산 골목/ }).waitFor();
  expect(page.url()).toContain(B);
  await page.getByRole("button", { name: "프로젝트 목록", exact: true }).click();
  await page.evaluate(() => { window.storyboardLibraryFixture.mode = "empty"; });
  await refresh(page).click();
  await page.getByRole("button", { name: "새 제작 요청 작성", exact: true }).click();
  await browserExpect(page.getByLabel("제작 요청", { exact: true })).toBeFocused();
  expect(page.url()).not.toContain("storyboardProject");
}, 1423, A), 15_000);

for (const width of [390, 834, 1423]) browserTest(`library and selected detail fit ${width}px with real CSS`, () => run(async page => {
  expect(page.viewportSize()?.width).toBe(width);
  const evidence = process.env.STORYBOARD_LIBRARY_EVIDENCE_DIR;
  const measure = async () => page.evaluate(() => {
    const workspace = document.querySelector<HTMLElement>("[data-local-storyboard-workspace]")!;
    return { document: document.documentElement.scrollWidth - window.innerWidth, workspace: workspace.scrollWidth - workspace.clientWidth };
  });
  expect(await measure()).toEqual({ document: 0, workspace: 0 });
  if (evidence) {
    mkdirSync(evidence, { recursive: true });
    await page.screenshot({ path: join(evidence, `storyboard-library-${width}.png`), fullPage: true });
  }
  await firstProject(page).click();
  await page.getByRole("heading", { name: "서울 시장 먹방", exact: true }).waitFor();
  await page.getByRole("button", { name: "프로젝트 목록", exact: true }).click();
  expect(await measure()).toEqual({ document: 0, workspace: 0 });
  if (evidence) await page.screenshot({ path: join(evidence, `storyboard-library-detail-${width}.png`), fullPage: true });
}, width), 15_000);
