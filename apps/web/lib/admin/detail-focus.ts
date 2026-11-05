/** Returns focus from a closed detail to its row, or to `fallback` once the row is gone, unless focus already moved elsewhere. */
export function restoreAdminDetailFocus(detailSelector: string, row: HTMLButtonElement | null, fallback: HTMLElement | null): void {
  const active = document.activeElement;
  if (active && active !== document.body && active !== document.documentElement && !active.closest(detailSelector)) return;
  (row?.isConnected && !row.disabled ? row : fallback)?.focus();
}
