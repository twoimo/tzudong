import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { Group, Panel, Separator } from "react-resizable-panels";
import { cn } from "../lib/utils";

const renderWithoutWarnings = (element: ReturnType<typeof createElement>) => {
  const warnings: unknown[][] = [];
  const originalError = console.error;
  console.error = (...args: unknown[]) => warnings.push(args);

  try {
    const html = renderToStaticMarkup(element);
    expect(warnings).toEqual([]);
    return html;
  } finally {
    console.error = originalError;
  }
};

describe("dependency modernization compatibility", () => {
  test("uses the production cn adapter to merge utility conflicts", () => {
    expect(cn("px-2 px-4", false && "hidden")).toBe("px-4");
    expect(cn("text-sm", "text-lg", { "hover:bg-blue-500": true })).toBe(
      "text-lg hover:bg-blue-500",
    );
    expect(cn("p-4", "px-2")).toBe("p-4 px-2");
  });

  test("renders percentage defaults; browser interaction coverage verifies resizing", () => {
    const html = renderWithoutWarnings(
      createElement(
        Group,
        { orientation: "horizontal" },
        createElement(Panel, { id: "navigation", defaultSize: "40%", minSize: "25%" }, "navigation"),
        createElement(Separator, { "aria-label": "패널 너비 조절" }),
        createElement(Panel, { id: "content", defaultSize: "60%", minSize: "25%" }, "content"),
      ),
    );

    expect(html).toContain('data-group="true"');
    expect(html).toContain('id="navigation"');
    expect(html).toContain('id="content"');
    expect(html).toContain('flex-basis:40%');
    expect(html).toContain('flex-basis:60%');
    expect(html).toContain('role="separator"');
  });
});
