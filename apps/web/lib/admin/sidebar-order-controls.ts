import {
  normalizeAdminSidebarOrder,
  type AdminSidebarItemId,
  type AdminSidebarOrderPreference,
} from "@/lib/admin/sidebar-order";

function moveItemInArray<T>(items: T[], index: number, direction: -1 | 1): T[] {
  const nextIndex = index + direction;
  if (nextIndex < 0 || nextIndex >= items.length) return items;

  const nextItems = [...items];
  const [item] = nextItems.splice(index, 1);
  nextItems.splice(nextIndex, 0, item);
  return nextItems;
}

export function moveAdminSidebarSection(
  order: AdminSidebarOrderPreference,
  section: string,
  direction: -1 | 1,
): AdminSidebarOrderPreference {
  const normalized = normalizeAdminSidebarOrder(order);
  const index = normalized.sections.indexOf(section);
  return {
    ...normalized,
    sections:
      index < 0
        ? normalized.sections
        : moveItemInArray(normalized.sections, index, direction),
  };
}

export function moveAdminSidebarItem(
  order: AdminSidebarOrderPreference,
  section: string,
  itemId: AdminSidebarItemId,
  direction: -1 | 1,
): AdminSidebarOrderPreference {
  const normalized = normalizeAdminSidebarOrder(order);
  const sectionItems = normalized.items[section] ?? [];
  const index = sectionItems.indexOf(itemId);

  return {
    ...normalized,
    items: {
      ...normalized.items,
      [section]:
        index < 0
          ? sectionItems
          : moveItemInArray(sectionItems, index, direction),
    },
  };
}

export function canPersistAdminSidebarOrder(input: {
  enabled: boolean;
  loadFailed: boolean;
  isLoading: boolean;
  isSaving: boolean;
}): boolean {
  return input.enabled && !input.loadFailed && !input.isLoading && !input.isSaving;
}
