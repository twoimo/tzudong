import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const source = (relativePath: string) =>
  readFileSync(join(import.meta.dir, "..", relativePath), "utf8");

describe("admin storyboard thinking trace source contract", () => {
  test("streams structured trace events from the storyboard chat route", () => {
    const routeSource = source("app/api/admin/storyboard/chat/route.ts");

    expect(routeSource).toContain("send('trace'");
    expect(routeSource).toContain("createRouteTraceEntry");
    expect(routeSource).toContain("route-received");
    expect(routeSource).toContain("route-agent");
    expect(routeSource).toContain("route-decision");
    expect(routeSource).toContain("getRouteDecisionTraceDetail");
    expect(routeSource).not.toContain("promptAddendum");
  });

  test("renders a collapsible thinking timeline and keeps image generation steps in it", () => {
    const componentSource = source(
      "components/admin/storyboard/AdminStoryboardGenerator.tsx",
    );

    expect(componentSource).toContain('data-storyboard-thinking-trace="true"');
    expect(componentSource).toContain("StoryboardThinkingTracePanel");
    expect(componentSource).toContain("getStoryboardThinkingTraceDurationLabel");
    expect(componentSource).toContain("formatStoryboardThinkingDuration");
    expect(componentSource).toContain('data-storyboard-thinking-duration="true"');
    expect(componentSource).toContain("동안 생각함");
    expect(componentSource).toContain("storyboard-generate");
    expect(componentSource).toContain("storyboard-evidence");
    expect(componentSource).toContain("image-provider-check");
    expect(componentSource).toContain("image-plan");
    expect(componentSource).toContain("`image-cut-${scene.sceneNo}`");
    expect(componentSource).toContain("image-generation-skip");
  });

  test("keeps the chat composer from showing stacked nested borders", () => {
    const componentSource = source(
      "components/admin/storyboard/AdminStoryboardGenerator.tsx",
    );

    expect(componentSource).toContain("rounded-2xl bg-muted/45");
    expect(componentSource).toContain(
      "rounded-[1.75rem] border border-border/80 bg-background/95",
    );
    expect(componentSource).toContain('style={{ borderRadius: "1.75rem" }}');
    expect(componentSource).not.toContain(
      "rounded-full border border-primary/20 bg-primary/5",
    );
    expect(componentSource).not.toContain(
      "rounded-3xl border border-border/60 bg-background p-2 shadow-sm",
    );
  });

  test("keeps the glass shimmer skeleton available in both global style bundles", () => {
    const globalsSource = source("app/globals.css");
    const appGlobalsSource = source("app/app-globals.css");

    for (const cssSource of [globalsSource, appGlobalsSource]) {
      expect(cssSource).toContain("storyboard-glass-shimmer");
      expect(cssSource).toContain(
        '[data-storyboard-cut-image-skeleton="true"]',
      );
      expect(cssSource).toContain(
        '[data-storyboard-cut-image-shimmer="true"]',
      );
      expect(cssSource).toContain(
        '[data-storyboard-cut-image-skeleton-active="true"]',
      );
    }
  });
});
