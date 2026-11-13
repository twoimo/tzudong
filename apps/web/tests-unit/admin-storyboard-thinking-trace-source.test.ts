import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const source = (relativePath: string) =>
  readFileSync(join(import.meta.dir, "..", relativePath), "utf8");

describe("admin storyboard thinking trace source contract", () => {
  test("streams structured trace events from the storyboard chat route", () => {
    const routeSource = source("app/api/admin/storyboard/chat/route.ts");

    expect(routeSource).toContain("retiredStoryboardApi");
    expect(routeSource).not.toContain("send('trace'");
    expect(routeSource).not.toContain("generateStoryboardChatWithBackendAgent");
  });

  test("renders server-owned project events instead of a retired client reasoning stream", () => {
    const componentSource = source(
      "components/admin/storyboard/LocalStoryboardWorkspace.tsx",
    );

    expect(componentSource).toContain("프로젝트 변경 이력");
    expect(componentSource).toContain("view.events.map");
    expect(componentSource).toContain("event.revision");
    expect(componentSource).toContain("event.createdAt");
    expect(componentSource).not.toContain("StoryboardThinkingTracePanel");
    expect(componentSource).not.toContain('data-storyboard-thinking-trace="true"');
  });

  test("keeps the storyboard operator workspace on one compact CMS surface", () => {
    const componentSource = source(
      "components/admin/storyboard/LocalStoryboardWorkspace.tsx",
    );

    expect(componentSource).toContain('data-admin-storyboard-toolbar="true"');
    expect(componentSource).toContain('className="min-w-0 p-3 pb-24 sm:p-4 sm:pb-6"');
    expect(componentSource).toContain('const panelClass = "min-w-0 rounded-none bg-card');
    expect(componentSource).not.toContain("StoryboardChat");
    expect(componentSource).not.toContain("browser-openai-api-key");
  });

  test("uses measured module previews without retired cut-image shimmer rules", () => {
    const globalsSource = source("app/globals.css");
    const appGlobalsSource = source("app/app-globals.css");

    const consoleSource = source("components/admin/AdminConsoleOverview.tsx");
    expect(consoleSource).toContain("<LoadingSurface");
    expect(consoleSource).toContain('data-storyboard-module-loading-frame-grid="true"');
    expect(consoleSource).toContain('data-storyboard-viewport-fit="bounded"');
    expect(consoleSource).not.toContain("admin-module-loading-shimmer");
    for (const cssSource of [globalsSource, appGlobalsSource]) {
      expect(cssSource).not.toContain("storyboard-glass-shimmer");
      expect(cssSource).not.toContain('[data-storyboard-cut-image-skeleton="true"]');
      expect(cssSource).not.toContain('[data-storyboard-cut-image-shimmer="true"]');
      expect(cssSource).not.toContain('[data-storyboard-cut-image-skeleton-active="true"]');
    }
  });
});
