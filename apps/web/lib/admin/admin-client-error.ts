import type { AdminConsoleMenuId } from "@/lib/admin/console-menu-registry";

export function reportAdminClientError(
  menuId: AdminConsoleMenuId,
  code: string,
): void {
  console.error(JSON.stringify({ menu: menuId, code }));
}
