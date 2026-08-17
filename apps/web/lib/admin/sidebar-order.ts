export const ADMIN_SIDEBAR_SECTIONS = ["홈", "검수", "운영", "실험실"] as const;
export const ADMIN_SIDEBAR_ITEM_IDS = [
  "overview",
  "restaurants",
  "restaurant-refresh-history",
  "submissions",
  "reviews",
  "map-overlays",
  "users",
  "banners",
  "insights",
  "pipeline",
  "youtube-thumbnail-generator",
  "storyboard",
  "routes",
  "llm",
  "audit",
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
    검수: ["restaurants", "restaurant-refresh-history", "submissions", "reviews"],
    운영: ["map-overlays", "users", "banners", "insights", "pipeline"],
    실험실: ["youtube-thumbnail-generator", "storyboard", "routes", "llm", "audit"],
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

function hasItemsOutsideCurrentSection(value: Record<string, unknown>): boolean {
  return DEFAULT_ADMIN_SIDEBAR_ORDER.sections.some((section) => {
    const rawItems = value[section];
    if (!Array.isArray(rawItems)) return false;

    const allowedItemIds = new Set(DEFAULT_ADMIN_SIDEBAR_ORDER.items[section] ?? []);
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

export function normalizeAdminSidebarOrder(
  value: unknown,
): AdminSidebarOrderPreference {
  const record = isRecord(value) ? value : {};
  const itemRecord = isRecord(record.items) ? record.items : {};
  if (hasItemsOutsideCurrentSection(itemRecord)) {
    return DEFAULT_ADMIN_SIDEBAR_ORDER;
  }

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
