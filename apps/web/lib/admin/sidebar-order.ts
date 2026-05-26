export const ADMIN_SIDEBAR_SECTIONS = ["홈", "검수", "운영", "실험실"] as const;
export const ADMIN_SIDEBAR_ITEM_IDS = [
  "overview",
  "restaurants",
  "submissions",
  "reviews",
  "routes",
  "storyboard",
  "banners",
  "users",
  "insights",
  "audit",
  "llm",
] as const;

export type AdminSidebarSectionLabel = (typeof ADMIN_SIDEBAR_SECTIONS)[number];
export type AdminSidebarItemId = (typeof ADMIN_SIDEBAR_ITEM_IDS)[number];

export type AdminSidebarOrderPreference = {
  sections: string[];
  items: Record<string, AdminSidebarItemId[]>;
};

export const DEFAULT_ADMIN_SIDEBAR_ORDER: AdminSidebarOrderPreference = {
  sections: [...ADMIN_SIDEBAR_SECTIONS],
  items: {
    홈: ["overview"],
    검수: ["restaurants", "submissions", "reviews"],
    운영: ["routes", "storyboard", "banners", "users", "insights"],
    실험실: ["audit", "llm"],
  },
};

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

export function normalizeAdminSidebarOrder(
  value: unknown,
): AdminSidebarOrderPreference {
  const record = isRecord(value) ? value : {};
  const itemRecord = isRecord(record.items) ? record.items : {};
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
