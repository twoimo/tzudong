import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { getMobileScrollNavVisibilityAction } from "../lib/mobile-scroll-nav-visibility";

describe("mobile scroll nav visibility", () => {
  test("hides the bottom nav while scrolling down through the review feed", () => {
    expect(
      getMobileScrollNavVisibilityAction({
        previousScrollTop: 40,
        currentScrollTop: 72,
        isHidden: false,
      }),
    ).toBe("hide");
  });

  test("shows the bottom nav when scrolling back up", () => {
    expect(
      getMobileScrollNavVisibilityAction({
        previousScrollTop: 120,
        currentScrollTop: 84,
        isHidden: true,
      }),
    ).toBe("show");
  });

  test("shows the bottom nav near the top even after it was hidden", () => {
    expect(
      getMobileScrollNavVisibilityAction({
        previousScrollTop: 40,
        currentScrollTop: 0,
        isHidden: true,
      }),
    ).toBe("show");
  });

  test("ignores tiny scroll jitter", () => {
    expect(
      getMobileScrollNavVisibilityAction({
        previousScrollTop: 100,
        currentScrollTop: 106,
        isHidden: false,
      }),
    ).toBe("unchanged");
  });

  test("mobile auto-hide collapses the header banner with the bottom nav", () => {
    const hookSource = readFileSync(
      join(import.meta.dir, "..", "hooks/use-mobile-bottom-nav-auto-hide.ts"),
      "utf8",
    );

    expect(hookSource).toContain("hideBottomNav: true");
    expect(hookSource).toContain("headerHideProgress: 1");
    expect(hookSource).not.toContain("headerHideProgress: 0");
  });
});

describe("mobile mypage scroll frame guards", () => {
  const readProjectFile = (relativePath: string) =>
    readFileSync(join(import.meta.dir, "..", relativePath), "utf8");

  test("mypage scroll frame uses the parent viewport instead of a nested 100vh calc", () => {
    const layoutSource = readProjectFile(
      "app/mypage/mypage-layout-content.tsx",
    );

    expect(layoutSource).not.toContain("h-[calc(100vh-64px)]");
    expect(layoutSource).toContain(
      "h-full min-h-0 bg-background overflow-hidden",
    );
    expect(layoutSource).toContain("flex-1 h-full min-h-0 overflow-y-auto");
    expect(layoutSource).toContain("flex min-h-full w-full flex-col");
    expect(layoutSource).toContain(
      'data-mypage-viewport-layout="edge-to-edge"',
    );
    expect(layoutSource).toContain("w-full max-w-none");
    expect(layoutSource).toContain('data-mypage-content-width="viewport-fill"');
    expect(layoutSource).not.toContain("md:mx-auto md:w-full md:max-w-6xl");
    expect(layoutSource).toContain("md:px-5 md:py-3");
    expect(layoutSource).toContain("Skeleton");
    expect(layoutSource).not.toContain("GlobalLoader");
    expect(layoutSource).not.toContain("fullScreen");
  });

  test("mypage scroll frame avoids snap locking so the top area remains freely scrollable", () => {
    const layoutSource = readProjectFile(
      "app/mypage/mypage-layout-content.tsx",
    );
    const bookmarksSource = readProjectFile("app/mypage/bookmarks/page.tsx");
    const reviewsSource = readProjectFile("app/mypage/reviews/page.tsx");

    expect(layoutSource).not.toContain("snap-y");
    expect(bookmarksSource).not.toContain("snap-start");
    expect(reviewsSource).not.toContain("snap-start");
  });
});
