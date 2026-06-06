import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import {
  persistLocalThumbnailHistory,
  readThumbnailHistory,
  resolveThumbnailHistoryRoot,
  THUMBNAIL_HISTORY_DEFAULT_ROOT,
  THUMBNAIL_HISTORY_PUBLIC_IMAGE_BASE_URL,
} from "../lib/admin/youtube-thumbnail-generator/history";
import type { ThumbnailGenerationResult, ThumbnailGeneratorPayload } from "../lib/admin/youtube-thumbnail-generator/types";

const payload: ThumbnailGeneratorPayload = {
  providerId: "local-codex",
  generationMode: "direct_provider",
  topic: "해외 야시장 길거리 음식 전경",
  headline: "역대급 먹방",
  subHeadline: "한입만 가능?",
  acknowledgedSafety: true,
};

const result: ThumbnailGenerationResult = {
  baseImage: {
    dataUrl: "data:image/png;base64,iVBORw0KGgo=",
    mime: "image/png",
    targetWidth: 1280,
    targetHeight: 720,
    providerId: "local-codex",
    model: "requested:gpt-image-2",
    modelProvenance: "requested-label",
  },
  prompt: "thumbnail prompt",
  warnings: ["local_codex_real_generation"],
};

function tempDir(name: string) {
  return mkdtempSync(join(tmpdir(), name));
}

describe("admin youtube thumbnail history", () => {
  test("keeps thumbnail history inside the generator page instead of static html", () => {
    const componentSource = readFileSync(new URL("../components/admin/thumbnail-generator/AdminYoutubeThumbnailGenerator.tsx", import.meta.url), "utf8");
    const routeSource = readFileSync(new URL("../app/api/admin/youtube-thumbnail-generator/history/route.ts", import.meta.url), "utf8");

    expect(componentSource).toContain('const THUMBNAIL_HISTORY_API_URL = "/api/admin/youtube-thumbnail-generator/history";');
    expect(componentSource).toContain('data-thumbnail-history-panel="true"');
    expect(componentSource).toContain('data-thumbnail-history-run="true"');
    expect(componentSource).toContain('data-thumbnail-history-load-run=');
    expect(componentSource).not.toContain("THUMBNAIL_QA_HISTORY_URL");
    expect(componentSource).not.toContain("THUMBNAIL_QA_HISTORY_JSON_URL");
    expect(componentSource).not.toContain('data-thumbnail-qa-history-link=');
    expect(componentSource).not.toContain("window.open(THUMBNAIL");
    expect(routeSource).toContain("readThumbnailHistory(process.env)");
    expect(routeSource).toContain("'Cache-Control': 'no-store'");
  });

  test("keeps the admin route wired to non-fatal server-side history persistence", () => {
    const routeSource = readFileSync(new URL("../app/api/admin/youtube-thumbnail-generator/route.ts", import.meta.url), "utf8");

    expect(routeSource).toContain("persistLocalThumbnailHistory");
    expect(routeSource).toContain("buildThumbnailProviderRequestEnv");
    expect(routeSource).toContain("providerEnv: providerRequestEnv");
    expect(routeSource).toContain("const responseResult = { ...result, warnings: [...result.warnings] };");
    expect(routeSource.indexOf("const result = payload.generationMode")).toBeLessThan(
      routeSource.indexOf("await persistLocalThumbnailHistory(responseResult, payload, process.env, { runId: generationRunId });"),
    );
    expect(routeSource).toContain("thumbnail_history_persist_failed");
    expect(routeSource).toContain("return NextResponse.json(responseResult, { headers: noStoreHeaders });");
  });

  test("resolves the default canonical root outside public history", () => {
    const root = resolveThumbnailHistoryRoot({ NODE_ENV: "test" }, {});
    expect(root).toBe(resolve(process.cwd(), THUMBNAIL_HISTORY_DEFAULT_ROOT));
    expect(root).not.toContain("public/qa-history/youtube-thumbnail-generator");
  });

  test("rejects canonical metadata roots under public qa-history", () => {
    expect(() => resolveThumbnailHistoryRoot(
      { NODE_ENV: "test", THUMBNAIL_HISTORY_ROOT: "public/qa-history/youtube-thumbnail-generator" },
      {},
    )).toThrow("thumbnail_history_root_must_not_be_public");
  });

  test("returns an empty list for missing or malformed canonical history", async () => {
    const historyRoot = tempDir("thumbnail-history-empty-");
    try {
      expect(await readThumbnailHistory({ NODE_ENV: "test" }, { historyRoot, includeLegacyFallback: false })).toEqual({
        updatedAt: null,
        runs: [],
      });
      writeFileSync(join(historyRoot, "history.json"), "not json");
      expect(await readThumbnailHistory({ NODE_ENV: "test" }, { historyRoot, includeLegacyFallback: false })).toEqual({
        updatedAt: null,
        runs: [],
      });
    } finally {
      rmSync(historyRoot, { recursive: true, force: true });
    }
  });

  test("filters legacy synthetic, failed, invalid provider, and unsafe image path runs", async () => {
    const historyRoot = tempDir("thumbnail-history-filter-");
    try {
      writeFileSync(join(historyRoot, "history.json"), JSON.stringify({
        updatedAt: "2026-06-05T09:00:00.000Z",
        runs: [
          { timestamp: "mock", completedAt: "mock", status: "passed", providerId: "local-codex", imagePath: "./ok.png", mockUsed: true },
          { timestamp: "failed", completedAt: "failed", status: "failed", providerId: "local-codex", imagePath: "./ok.png" },
          { timestamp: "bad-provider", completedAt: "bad-provider", status: "passed", providerId: "mock", imagePath: "./ok.png" },
          { timestamp: "bad-path", completedAt: "bad-path", status: "passed", providerId: "local-codex", imagePath: "https://example.com/x.png" },
          { timestamp: "good", completedAt: "good", status: "passed", providerId: "local-codex", model: "requested:gpt-image-2", generationMode: "direct_provider", imagePath: "./ok.png", headline: "역대급 먹방" },
        ],
      }));

      const history = await readThumbnailHistory({ NODE_ENV: "test" }, { historyRoot, includeLegacyFallback: false });
      expect(history.runs).toHaveLength(1);
      expect(history.runs[0]).toMatchObject({
        id: "good",
        providerId: "local-codex",
        imagePath: `${THUMBNAIL_HISTORY_PUBLIC_IMAGE_BASE_URL}/ok.png`,
      });
      expect(history.runs[0]).not.toHaveProperty("mockUsed");
    } finally {
      rmSync(historyRoot, { recursive: true, force: true });
    }
  });

  test("persists local canonical metadata outside public and writes no html files", async () => {
    const historyRoot = tempDir("thumbnail-history-write-");
    const imageRoot = tempDir("thumbnail-history-images-");
    try {
      const disabled = await persistLocalThumbnailHistory(result, payload, { NODE_ENV: "development" }, { historyRoot, publicImageRoot: imageRoot });
      expect(disabled).toEqual({ persisted: false, reason: "disabled" });

      const persisted = await persistLocalThumbnailHistory(
        result,
        payload,
        { NODE_ENV: "development", THUMBNAIL_LOCAL_HISTORY_WRITE: "1" },
        { historyRoot, publicImageRoot: imageRoot, now: new Date("2026-06-05T09:10:00.000Z"), runId: "run-001" },
      );
      expect(persisted.persisted).toBe(true);
      if (!persisted.persisted) throw new Error("expected persisted history");
      expect(persisted.run.imagePath).toBe(`${THUMBNAIL_HISTORY_PUBLIC_IMAGE_BASE_URL}/run-001.png`);
      expect(existsSync(join(historyRoot, "history.json"))).toBe(true);
      expect(existsSync(join(historyRoot, "latest.json"))).toBe(true);
      expect(existsSync(join(historyRoot, "runs", "run-001.json"))).toBe(true);
      expect(existsSync(join(historyRoot, "run-001.html"))).toBe(false);
      expect(existsSync(join(historyRoot, "latest.html"))).toBe(false);
      expect(existsSync(join(imageRoot, "run-001.png"))).toBe(true);

      const raw = readFileSync(join(historyRoot, "runs", "run-001.json"), "utf8");
      expect(raw).not.toContain("data:image/png;base64");
      expect(raw).not.toContain("mockUsed");
      expect(raw).not.toContain("thumbnailSessionOpenaiApiKey");
      expect(raw).not.toContain("thumbnailSessionGeminiApiKey");
      expect(raw).not.toContain("sk-session-openai");
      expect(raw).not.toContain("AIza-session-gemini");
      expect(readFileSync(join(historyRoot, "history.json"), "utf8")).not.toContain("mockUsed");
      expect(readFileSync(join(historyRoot, "latest.json"), "utf8")).not.toContain("mockUsed");
      expect(readFileSync(join(historyRoot, "history.json"), "utf8")).not.toContain("thumbnailSessionOpenaiApiKey");
      expect(readFileSync(join(historyRoot, "latest.json"), "utf8")).not.toContain("thumbnailSessionGeminiApiKey");
      expect(persisted.run).not.toHaveProperty("mockUsed");
      const history = await readThumbnailHistory({ NODE_ENV: "test" }, { historyRoot, publicImageRoot: imageRoot, includeLegacyFallback: false });
      expect(history.runs[0]?.headline).toBe("역대급 먹방");
      expect(history.runs[0]).not.toHaveProperty("mockUsed");
    } finally {
      rmSync(historyRoot, { recursive: true, force: true });
      rmSync(imageRoot, { recursive: true, force: true });
    }
  });
});
