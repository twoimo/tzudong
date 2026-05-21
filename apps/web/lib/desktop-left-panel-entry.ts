export const DESKTOP_LEFT_PANEL_EXPAND_ON_ENTRY_EVENT =
  "home:desktop-left-panel-expand-on-entry";

export const HOME_DESKTOP_INLINE_DETAIL_OPEN_FAILED_EVENT =
  "home:desktop-inline-detail-open-failed";

export function shouldExpandDesktopLeftPanelForRoute(href: string) {
  const trimmedHref = href.trim();
  if (!trimmedHref) return false;

  try {
    const url = new URL(trimmedHref, "https://tzudong.local");
    const { pathname, searchParams } = url;

    return (
      pathname === "/admin" ||
      pathname.startsWith("/admin/") ||
      pathname === "/mypage" ||
      pathname.startsWith("/mypage/") ||
      (pathname === "/" && searchParams.get("panel") === "settings")
    );
  } catch {
    return false;
  }
}
