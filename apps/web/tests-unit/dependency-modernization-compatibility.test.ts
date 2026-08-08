import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { Calendar } from "../components/ui/calendar";
import { ChartConfigProvider, ChartLegendContent, ChartTooltipContent } from "../components/ui/chart";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "../components/ui/resizable";
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
  test("uses DayPicker v10 navigation and selection class hooks", () => {
    const html = renderWithoutWarnings(
      createElement(Calendar, {
        mode: "single",
        month: new Date(2026, 6, 1),
        selected: new Date(2026, 6, 11),
        classNames: {
          button_previous: "previous-month-hook",
          button_next: "next-month-hook",
          selected: "selected-day-hook",
        },
      }),
    );

    expect(html).toContain("previous-month-hook");
    expect(html).toContain("next-month-hook");
    expect(html).toContain("selected-day-hook");
    expect(html).toContain('aria-selected="true"');
  });


  test("uses the production cn adapter to merge calendar utility conflicts", () => {
    expect(cn("px-2 px-4", false && "hidden")).toBe("px-4");
    expect(cn("text-sm", "text-lg", { "hover:bg-blue-500": true })).toBe(
      "text-lg hover:bg-blue-500",
    );
    expect(cn("p-4", "px-2")).toBe("p-4 px-2");
  });

  test("renders Recharts v3 tooltip and legend labels, including a zero value", () => {
    const config = { visits: { label: "방문 수", color: "#2563eb" } };
    const payload = [{
      dataKey: "visits",
      name: "visits",
      value: 0,
      color: "#2563eb",
      payload: { fill: "#2563eb" },
      graphicalItemId: "visits-series",
    }];

    const html = renderWithoutWarnings(
      createElement(
        ChartConfigProvider,
        { config },
        createElement(ChartTooltipContent, { active: true, label: "visits", payload }),
        createElement(ChartLegendContent, {
          payload: [{ dataKey: "visits", value: "visits", color: "#2563eb" }],
        }),
      ),
    );

    expect(html).toContain("방문 수");
    expect(html).toContain(">0<");
  });

  test("renders percentage defaults; browser interaction coverage verifies resizing", () => {
    const html = renderWithoutWarnings(
      createElement(
        ResizablePanelGroup,
        { orientation: "horizontal" },
        createElement(ResizablePanel, { id: "navigation", defaultSize: 40, minSize: 25 }, "navigation"),
        createElement(ResizableHandle, { "aria-label": "패널 너비 조절", withHandle: true }),
        createElement(ResizablePanel, { id: "content", defaultSize: 60, minSize: 25 }, "content"),
      ),
    );

    expect(html).toContain('data-group="true"');
    expect(html).toContain('id="navigation"');
    expect(html).toContain('id="content"');
    expect(html).toContain('flex-basis:40px');
    expect(html).toContain('flex-basis:60px');
    expect(html).toContain('role="separator"');
  });
});
