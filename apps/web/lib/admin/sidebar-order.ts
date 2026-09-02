import {
  ADMIN_CONSOLE_MENU_IDS,
  ADMIN_CONSOLE_MENUS,
  ADMIN_CONSOLE_SECTION_LABELS,
  isRetiredAdminSectionLabel,
  type AdminConsoleMenuId,
  type AdminConsoleSectionLabel,
} from "@/lib/admin/console-menu-registry";

export const ADMIN_SIDEBAR_SECTIONS = ADMIN_CONSOLE_SECTION_LABELS;
export const ADMIN_SIDEBAR_ITEM_IDS = ADMIN_CONSOLE_MENU_IDS;

export type AdminSidebarSectionLabel = AdminConsoleSectionLabel;
export type AdminSidebarItemId = AdminConsoleMenuId;

export type AdminSidebarOrderPreference = {
  sections: string[];
  items: Record<string, AdminSidebarItemId[]>;
};

export type AdminSidebarOrderRevertedReason =
  | "retired-section"
  | "cross-section-item"
  | null;

export type AdminSidebarOrderNormalization = {
  order: AdminSidebarOrderPreference;
  revertedReason: AdminSidebarOrderRevertedReason;
};

function createDefaultAdminSidebarOrder(): AdminSidebarOrderPreference {
  return {
    sections: [...ADMIN_SIDEBAR_SECTIONS],
    items: Object.fromEntries(
      ADMIN_SIDEBAR_SECTIONS.map((section) => [
        section,
        ADMIN_CONSOLE_MENU_IDS.filter(
          (id) => ADMIN_CONSOLE_MENUS[id].section === section,
        ),
      ]),
    ),
  };
}

export const DEFAULT_ADMIN_SIDEBAR_ORDER: AdminSidebarOrderPreference =
  createDefaultAdminSidebarOrder();

const sectionSet = new Set<string>(ADMIN_SIDEBAR_SECTIONS);
const itemSet = new Set<string>(ADMIN_SIDEBAR_ITEM_IDS);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function uniqueKnownSections(value: unknown): string[] {
  if (!Array.isArray(value)) return [];

  const seen = new Set<string>();
  return value.filter((section): section is AdminSidebarSectionLabel => {
    if (
      typeof section !== "string" ||
      !sectionSet.has(section) ||
      seen.has(section)
    ) {
      return false;
    }

    seen.add(section);
    return true;
  });
}

function uniqueKnownItems(
  value: unknown,
  usedItemIds: Set<string>,
  allowedItemIds: ReadonlySet<string>,
): AdminSidebarItemId[] {
  if (!Array.isArray(value)) return [];

  return value.filter((item): item is AdminSidebarItemId => {
    if (
      typeof item !== "string" ||
      !itemSet.has(item) ||
      !allowedItemIds.has(item) ||
      usedItemIds.has(item)
    ) {
      return false;
    }

    usedItemIds.add(item);
    return true;
  });
}

function collectDeclaredSectionNames(
  record: Record<string, unknown>,
  itemRecord: Record<string, unknown>,
): string[] {
  const names: string[] = [];
  if (Array.isArray(record.sections)) {
    for (const section of record.sections) {
      if (typeof section === "string") {
        names.push(section);
      }
    }
  }
  names.push(...Object.keys(itemRecord));
  return names;
}

function hasRetiredSectionName(
  record: Record<string, unknown>,
  itemRecord: Record<string, unknown>,
): boolean {
  return collectDeclaredSectionNames(record, itemRecord).some((section) =>
    isRetiredAdminSectionLabel(section),
  );
}

function hasItemsOutsideCurrentSection(value: Record<string, unknown>): boolean {
  return DEFAULT_ADMIN_SIDEBAR_ORDER.sections.some((section) => {
    const rawItems = value[section];
    if (!Array.isArray(rawItems)) return false;

    const allowedItemIds = new Set(
      DEFAULT_ADMIN_SIDEBAR_ORDER.items[section] ?? [],
    );
    return rawItems.some(
      (item) =>
        typeof item === "string" &&
        itemSet.has(item) &&
        !allowedItemIds.has(item as AdminSidebarItemId),
    );
  });
}

export function mergeSidebarItemsWithDefaultSlots<Item extends string>(
  preferredItems: Item[],
  defaultItems: readonly Item[],
) {
  const preferredQueue = preferredItems.filter(
    (item, index) => preferredItems.indexOf(item) === index,
  );
  const preferredItemSet = new Set(preferredQueue);
  const mergedItems: Item[] = [];

  for (const defaultItem of defaultItems) {
    if (!preferredItemSet.has(defaultItem)) {
      mergedItems.push(defaultItem);
      continue;
    }

    while (preferredQueue.length > 0) {
      const preferredItem = preferredQueue.shift();
      if (!preferredItem) break;
      mergedItems.push(preferredItem);
      if (preferredItem === defaultItem) break;
    }
  }

  mergedItems.push(...preferredQueue);

  return mergedItems;
}

function mergeKnownSidebarOrder(
  record: Record<string, unknown>,
  itemRecord: Record<string, unknown>,
): AdminSidebarOrderPreference {
  const preferredSections = uniqueKnownSections(record.sections);
  const sections = [
    ...preferredSections,
    ...DEFAULT_ADMIN_SIDEBAR_ORDER.sections.filter(
      (section) => !preferredSections.includes(section),
    ),
  ];
  const usedItemIds = new Set<string>();
  const items = Object.fromEntries(
    DEFAULT_ADMIN_SIDEBAR_ORDER.sections.map((section) => {
      const defaultSectionItems = DEFAULT_ADMIN_SIDEBAR_ORDER.items[section] ?? [];
      const sectionItemIds = new Set(defaultSectionItems);
      const preferredItems = uniqueKnownItems(
        itemRecord[section],
        usedItemIds,
        sectionItemIds,
      );
      const normalizedItems = mergeSidebarItemsWithDefaultSlots(
        preferredItems,
        defaultSectionItems,
      );
      normalizedItems.forEach((itemId) => usedItemIds.add(itemId));
      return [section, normalizedItems];
    }),
  );

  return { sections, items };
}

export function normalizeAdminSidebarOrderWithReason(
  value: unknown,
): AdminSidebarOrderNormalization {
  if (!isRecord(value)) {
    return {
      order: DEFAULT_ADMIN_SIDEBAR_ORDER,
      revertedReason: null,
    };
  }

  const itemRecord = isRecord(value.items) ? value.items : {};
  if (hasRetiredSectionName(value, itemRecord)) {
    return {
      order: DEFAULT_ADMIN_SIDEBAR_ORDER,
      revertedReason: "retired-section",
    };
  }
  if (hasItemsOutsideCurrentSection(itemRecord)) {
    return {
      order: DEFAULT_ADMIN_SIDEBAR_ORDER,
      revertedReason: "cross-section-item",
    };
  }

  return {
    order: mergeKnownSidebarOrder(value, itemRecord),
    revertedReason: null,
  };
}

export function normalizeAdminSidebarOrder(
  value: unknown,
): AdminSidebarOrderPreference {
  return normalizeAdminSidebarOrderWithReason(value).order;
}
