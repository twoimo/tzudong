import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { MapMenuLoadShell } from "../components/home/home-control-panel";
import { DESKTOP_MIN_WIDTH_QUERY } from "../lib/viewport-breakpoints";

const source = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

describe("map menu first paint", () => {
  test("a pending control chunk does not paint the map menu", () => {
    const html = renderToStaticMarkup(
      <MapMenuLoadShell failed={false} onRetry={() => undefined} className="pending-shell" />,
    );

    expect(html).toBe("");
  });

  test("a failed control chunk keeps the retryable map menu", () => {
    const html = renderToStaticMarkup(
      <MapMenuLoadShell failed onRetry={() => undefined} className="failed-shell" />,
    );

    expect(html).toContain("지도 메뉴");
    expect(html).toContain("다시 시도");
    expect(html).toContain('data-deferred-panel-state="error"');
  });

  test("desktop first paint hides mobile routes that the client will leave", () => {
    const globals = source("app/globals.css");
    const feed = source("app/feed/page.tsx");
    const stamp = source("app/stamp/page.tsx");
    const leaderboard = source("app/leaderboard/page.tsx");

    expect(DESKTOP_MIN_WIDTH_QUERY).toBe("(min-width: 1280px)");
    expect(globals).toContain(
      `@media ${DESKTOP_MIN_WIDTH_QUERY} {\n  [data-mobile-only-route] {\n    display: none !important;\n  }\n}`,
    );
    expect(feed).toContain('<div data-mobile-only-route="true">');
    expect(stamp).toContain('data-mobile-only-route={hasReviewContinuation ? undefined : "true"}');
    expect(leaderboard).toContain('data-mobile-only-route="true"');
  });
});
