import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const component = readFileSync(
  join(
    import.meta.dir,
    "../components/admin/thumbnail-generator/AdminYoutubeThumbnailGenerator.tsx",
  ),
  "utf8",
);

describe("thumbnail generator responsive canvas layout", () => {
  test("keeps the output-first mobile canvas at its 16:9 aspect ratio", () => {
    expect(component).toContain(
      "grid-cols-1 auto-rows-max content-start gap-2 overflow-x-hidden overflow-y-auto",
    );
    expect(component).toContain(
      'order-1 flex h-fit min-h-0 self-start flex-col overflow-hidden',
    );
    expect(component).toContain(
      'aspect-video w-full min-h-0 self-start overflow-hidden',
    );
    expect(component).toContain('data-thumbnail-canvas-aspect-frame="16:9"');
    expect(component).toContain("min-h-[420px]");
  });

  test("desktop controls follow the rendered canvas while a short viewport can shrink the canvas", () => {
    const viewportStart = component.indexOf('ref={canvasViewportRef}');
    expect(viewportStart).toBeGreaterThan(0);
    const contentStart = component.lastIndexOf('<CardContent', viewportStart);
    expect(contentStart).toBeGreaterThan(0);
    const contentClasses = component.slice(contentStart, viewportStart)
      .match(/className="([^"]+)"/)?.[1].split(/\s+/) ?? [];
    for (const token of ['min-h-0', 'flex-1', 'lg:flex', 'lg:flex-col', 'lg:gap-3', 'lg:overflow-hidden']) {
      expect(contentClasses).toContain(token);
    }
    expect(contentClasses).not.toContain('lg:grid-rows-[minmax(0,1fr)_auto]');
    const viewportClasses = component.slice(viewportStart)
      .match(/className="([^"]+)"/)?.[1].split(/\s+/) ?? [];
    for (const token of ['aspect-video', 'w-full', 'min-h-0', 'lg:flex-[0_1_auto]']) {
      expect(viewportClasses).toContain(token);
    }
    expect(viewportClasses).not.toContain('lg:aspect-auto');
    expect(viewportClasses).not.toContain('lg:h-full');
    const toolbarClasses = component.match(/<div className="([^"]+)">\s*<div className="[^"]+" data-thumbnail-editor-toolbar="true"/)?.[1].split(/\s+/) ?? [];
    expect(toolbarClasses).toContain('lg:shrink-0');
  });

  test("continues sizing the canvas and pointer coordinates from its rendered box", () => {
    expect(component).toContain(
      "Math.min(width, height * (TARGET_WIDTH / TARGET_HEIGHT))",
    );
    expect(component).toContain("nextHeight = Math.max(1, nextWidth * (TARGET_HEIGHT / TARGET_WIDTH))");
    expect(component).toContain("((clientX - rect.left) / rect.width) * TARGET_WIDTH");
    expect(component).toContain("((clientY - rect.top) / rect.height) * TARGET_HEIGHT");
  });
});
