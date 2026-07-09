const NONCRITICAL_CHROME_SUPPRESSED_EXACT_PATHS = new Set([
  "/admin",
  "/feed",
  "/stamp",
  "/leaderboard",
  "/mypage",
  "/insights",
]);

const NONCRITICAL_CHROME_SUPPRESSED_PREFIXES = [
  "/auth/",
  "/admin/",
  "/mypage/",
  "/insights/",
];

export function shouldSuppressNoncriticalChromeForPathname(
  pathname: string | null | undefined,
): boolean {
  if (!pathname) return false;
  if (NONCRITICAL_CHROME_SUPPRESSED_EXACT_PATHS.has(pathname)) return true;
  return NONCRITICAL_CHROME_SUPPRESSED_PREFIXES.some((prefix) =>
    pathname.startsWith(prefix),
  );
}
