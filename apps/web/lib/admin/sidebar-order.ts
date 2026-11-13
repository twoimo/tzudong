export const ADMIN_SIDEBAR_SECTIONS = [
  "대시보드",
  "검수·데이터",
  "콘텐츠",
  "사이트 운영",
  "플랫폼 도구",
] as const;

export const ADMIN_SIDEBAR_ITEM_IDS = [
  "overview",
  "restaurants",
  "submissions",
  "reviews",
  "insights",
  "storyboard",
  "youtube-thumbnail-generator",
  "users",
  "banners",
  "pipeline",
  "knowledge-graph",
  "sentry",
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
    대시보드: ["overview"],
    "검수·데이터": ["restaurants", "submissions", "reviews"],
    콘텐츠: ["insights", "storyboard", "youtube-thumbnail-generator"],
    "사이트 운영": ["users", "banners"],
    "플랫폼 도구": ["pipeline", "knowledge-graph", "sentry", "routes", "llm", "audit"],
  },
};

const sectionSet = new Set<string>(ADMIN_SIDEBAR_SECTIONS);
const itemSet = new Set<string>(ADMIN_SIDEBAR_ITEM_IDS);
const sectionAliases: Record<string, AdminSidebarSectionLabel> = {
  홈: "대시보드",
  검수: "검수·데이터",
  운영: "사이트 운영",
  실험실: "플랫폼 도구",
};
const legacyItemSection: Record<string, AdminSidebarSectionLabel> = {
  overview: "대시보드",
  restaurants: "검수·데이터",
  submissions: "검수·데이터",
  reviews: "검수·데이터",
  insights: "콘텐츠",
  storyboard: "콘텐츠",
  "youtube-thumbnail-generator": "콘텐츠",
  users: "사이트 운영",
  banners: "사이트 운영",
  pipeline: "플랫폼 도구",
  "knowledge-graph": "플랫폼 도구",
  sentry: "플랫폼 도구",
  routes: "플랫폼 도구",
  llm: "플랫폼 도구",
  audit: "플랫폼 도구",
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function normalizeSection(value: unknown): AdminSidebarSectionLabel | null {
  if (typeof value !== "string") return null;
  if (sectionSet.has(value)) return value as AdminSidebarSectionLabel;
  return sectionAliases[value] ?? null;
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
  const preferredSections = Array.isArray(record.sections)
    ? record.sections.map(normalizeSection).filter((item): item is AdminSidebarSectionLabel => item !== null)
    : [];
  const sections = [
    ...preferredSections.filter((item, index) => preferredSections.indexOf(item) === index),
    ...ADMIN_SIDEBAR_SECTIONS.filter((section) => !preferredSections.includes(section)),
  ];

  const preferredItemsBySection = new Map<AdminSidebarSectionLabel, AdminSidebarItemId[]>();
  for (const section of ADMIN_SIDEBAR_SECTIONS) preferredItemsBySection.set(section, []);

  for (const [sourceSection, rawItems] of Object.entries(itemRecord)) {
    if (!Array.isArray(rawItems)) continue;
    for (const rawItem of rawItems) {
      if (typeof rawItem !== "string" || !itemSet.has(rawItem)) continue;
      const destination = legacyItemSection[rawItem];
      const items = preferredItemsBySection.get(destination);
      if (items && !items.includes(rawItem as AdminSidebarItemId)) items.push(rawItem as AdminSidebarItemId);
      // Section names are intentionally not used to relocate modules: old saved
      // preferences remain valid after the navigation taxonomy changes.
      void sourceSection;
    }
  }

  const items = Object.fromEntries(
    ADMIN_SIDEBAR_SECTIONS.map((section) => [
      section,
      mergeSidebarItemsWithDefaultSlots(
        preferredItemsBySection.get(section) ?? [],
        DEFAULT_ADMIN_SIDEBAR_ORDER.items[section] ?? [],
      ),
    ]),
  );
  return { sections, items };
}
