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
    expect(component).toContain("lg:aspect-auto lg:h-full lg:self-stretch");
    expect(component).toContain('data-thumbnail-canvas-aspect-frame="16:9"');
    expect(component).toContain("min-h-[420px]");
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
