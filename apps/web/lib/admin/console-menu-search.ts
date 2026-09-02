import {
  ADMIN_CONSOLE_MENU_LIST,
  type AdminConsoleMenuDefinition,
  type AdminConsoleSectionLabel,
} from "@/lib/admin/console-menu-registry";

export type ModuleGridFilter = {
  readonly committedQuery: string;
  readonly section: AdminConsoleSectionLabel | null;
};

export function filterAdminConsoleMenus(
  filter: ModuleGridFilter,
): readonly AdminConsoleMenuDefinition[] {
  const needle = filter.committedQuery.trim().toLocaleLowerCase("ko-KR");
  return ADMIN_CONSOLE_MENU_LIST.filter((menu) => {
    if (filter.section !== null && menu.section !== filter.section) {
      return false;
    }
    if (needle.length === 0) {
      return true;
    }
    const haystack = `${menu.title}\n${menu.purpose}`.toLocaleLowerCase("ko-KR");
    return haystack.includes(needle);
  });
}
