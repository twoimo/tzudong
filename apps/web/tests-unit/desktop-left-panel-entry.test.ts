import { describe, expect, test } from "bun:test";
import { shouldExpandDesktopLeftPanelForRoute } from "../lib/desktop-left-panel-entry";

describe("desktop left panel route entry helpers", () => {
  test("expands for admin, mypage, and settings routes with extra URL state", () => {
    expect(shouldExpandDesktopLeftPanelForRoute("/admin")).toBe(true);
    expect(shouldExpandDesktopLeftPanelForRoute("/admin/users?tab=active")).toBe(true);
    expect(shouldExpandDesktopLeftPanelForRoute("/mypage/profile")).toBe(true);
    expect(shouldExpandDesktopLeftPanelForRoute("/?panel=settings")).toBe(true);
    expect(shouldExpandDesktopLeftPanelForRoute("/?panel=settings&from=mypage#layout")).toBe(true);
    expect(shouldExpandDesktopLeftPanelForRoute("https://tzudong.app/?panel=settings&from=menu")).toBe(true);
  });

  test("does not expand for unrelated map panels or malformed input", () => {
    expect(shouldExpandDesktopLeftPanelForRoute("/")).toBe(false);
    expect(shouldExpandDesktopLeftPanelForRoute("/?panel=profile")).toBe(false);
    expect(shouldExpandDesktopLeftPanelForRoute("/feed")).toBe(false);
    expect(shouldExpandDesktopLeftPanelForRoute("   ")).toBe(false);
    expect(shouldExpandDesktopLeftPanelForRoute("http://[invalid")).toBe(false);
  });
});
