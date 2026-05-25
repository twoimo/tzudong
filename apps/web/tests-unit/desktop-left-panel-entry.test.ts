import { describe, expect, test } from "bun:test";
import { shouldExpandDesktopLeftPanelForRoute } from "../lib/desktop-left-panel-entry";

describe("desktop left panel route entry helpers", () => {
  test("expands for admin, mypage, and home left-panel routes with extra URL state", () => {
    expect(shouldExpandDesktopLeftPanelForRoute("/admin")).toBe(true);
    expect(
      shouldExpandDesktopLeftPanelForRoute("/admin/users?tab=active"),
    ).toBe(true);
    expect(shouldExpandDesktopLeftPanelForRoute("/mypage/profile")).toBe(true);
    expect(shouldExpandDesktopLeftPanelForRoute("/?panel=settings")).toBe(true);
    expect(shouldExpandDesktopLeftPanelForRoute("/?panel=profile")).toBe(true);
    expect(shouldExpandDesktopLeftPanelForRoute("/?panel=bookmarks")).toBe(
      true,
    );
    expect(shouldExpandDesktopLeftPanelForRoute("/?panel=notifications")).toBe(
      true,
    );
    expect(shouldExpandDesktopLeftPanelForRoute("/?panel=feed")).toBe(true);
    expect(shouldExpandDesktopLeftPanelForRoute("/?panel=stamp")).toBe(true);
    expect(shouldExpandDesktopLeftPanelForRoute("/?panel=leaderboard")).toBe(
      true,
    );
    expect(shouldExpandDesktopLeftPanelForRoute("/?panel=announcement")).toBe(
      true,
    );
    expect(
      shouldExpandDesktopLeftPanelForRoute(
        "/?panel=settings&from=mypage#layout",
      ),
    ).toBe(true);
    expect(
      shouldExpandDesktopLeftPanelForRoute(
        "https://tzudong.app/?panel=settings&from=menu",
      ),
    ).toBe(true);
  });

  test("does not expand for unknown map panels or malformed input", () => {
    expect(shouldExpandDesktopLeftPanelForRoute("/")).toBe(false);
    expect(shouldExpandDesktopLeftPanelForRoute("/?panel=unknown")).toBe(false);
    expect(shouldExpandDesktopLeftPanelForRoute("/feed")).toBe(false);
    expect(shouldExpandDesktopLeftPanelForRoute("   ")).toBe(false);
    expect(shouldExpandDesktopLeftPanelForRoute("http://[invalid")).toBe(false);
  });
});
