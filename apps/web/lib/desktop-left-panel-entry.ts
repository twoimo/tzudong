export const DESKTOP_LEFT_PANEL_EXPAND_ON_ENTRY_EVENT =
  "home:desktop-left-panel-expand-on-entry";

export const HOME_DESKTOP_INLINE_DETAIL_OPEN_FAILED_EVENT =
  "home:desktop-inline-detail-open-failed";

export function shouldExpandDesktopLeftPanelForRoute(href: string) {
  return (
    href === "/admin" ||
    href.startsWith("/admin?") ||
    href.startsWith("/admin/") ||
    href === "/mypage" ||
    href.startsWith("/mypage/")
  );
}
