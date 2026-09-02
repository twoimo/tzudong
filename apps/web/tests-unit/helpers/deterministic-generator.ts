import {
  ADMIN_CONSOLE_MENU_IDS,
  ADMIN_CONSOLE_MENU_LIST,
  ADMIN_CONSOLE_SECTION_LABELS,
  RETIRED_ADMIN_SECTION_LABELS,
  getAdminConsoleMenuIdsBySection,
} from "../../lib/admin/console-menu-registry";

export function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pickIndex(random: () => number, length: number): number {
  return Math.min(length - 1, Math.floor(random() * length));
}

function shuffled<T>(items: readonly T[], random: () => number): T[] {
  const next = [...items];
  for (let index = next.length - 1; index > 0; index -= 1) {
    const swapIndex = pickIndex(random, index + 1);
    const current = next[index];
    const swapped = next[swapIndex];
    if (current === undefined || swapped === undefined) continue;
    next[index] = swapped;
    next[swapIndex] = current;
  }
  return next;
}

function defaultSectionItems() {
  return Object.fromEntries(
    ADMIN_CONSOLE_SECTION_LABELS.map((section) => [
      section,
      [...getAdminConsoleMenuIdsBySection(section)],
    ]),
  );
}

function requiredSidebarOrderCases(): unknown[] {
  const reversedItems = Object.fromEntries(
    ADMIN_CONSOLE_SECTION_LABELS.map((section) => [
      section,
      [...getAdminConsoleMenuIdsBySection(section)].reverse(),
    ]),
  );
  const crossSectionItems = defaultSectionItems();
  crossSectionItems["운영"] = [
    "insights",
    ...(crossSectionItems["운영"] ?? []).filter((id) => id !== "routes"),
  ];

  return [
    null,
    12,
    "not-an-object",
    [],
    {},
    { sections: ["알 수 없는 섹션"], items: {} },
    {
      sections: ["홈", "판단"],
      items: { 홈: ["overview"], 판단: ["insights"] },
    },
    {
      sections: ["실험실"],
      items: { 실험실: ["storyboard"] },
    },
    {
      sections: [...ADMIN_CONSOLE_SECTION_LABELS],
      items: {
        ...defaultSectionItems(),
        판단: ["unknown-menu", "overview"],
      },
    },
    {
      sections: [...ADMIN_CONSOLE_SECTION_LABELS],
      items: {
        ...defaultSectionItems(),
        판단: ["overview", "overview", "insights"],
      },
    },
    {
      sections: ["판단"],
      items: { 판단: ["overview"] },
    },
    {
      sections: [...ADMIN_CONSOLE_SECTION_LABELS].reverse(),
      items: reversedItems,
    },
    {
      sections: [...ADMIN_CONSOLE_SECTION_LABELS],
      items: crossSectionItems,
    },
  ];
}

export function generateSidebarOrderCases(count: number): unknown[] {
  const cases = requiredSidebarOrderCases();
  const random = mulberry32(20260902);
  const primitives: unknown[] = [undefined, false, 0, "", 3.14];

  while (cases.length < count) {
    const roll = random();
    if (roll < 0.08) {
      cases.push(primitives[pickIndex(random, primitives.length)]);
      continue;
    }
    if (roll < 0.16) {
      cases.push({});
      continue;
    }

    const sections = shuffled(
      [
        ...ADMIN_CONSOLE_SECTION_LABELS,
        ...(random() < 0.2
          ? [RETIRED_ADMIN_SECTION_LABELS[pickIndex(random, 2)]]
          : []),
        ...(random() < 0.15 ? ["미등록 섹션"] : []),
      ],
      random,
    );
    const items: Record<string, unknown> = {};
    for (const section of sections) {
      if (typeof section !== "string") continue;
      const knownItems = (ADMIN_CONSOLE_SECTION_LABELS as readonly string[]).includes(
        section,
      )
        ? [
            ...getAdminConsoleMenuIdsBySection(
              section as (typeof ADMIN_CONSOLE_SECTION_LABELS)[number],
            ),
          ]
        : [...ADMIN_CONSOLE_MENU_IDS];
      let nextItems: unknown[] = shuffled(knownItems, random);
      if (random() < 0.2 && nextItems.length > 0) {
        nextItems = nextItems.slice(0, pickIndex(random, nextItems.length) + 1);
      }
      if (random() < 0.15) {
        nextItems.push("unknown-menu");
      }
      if (random() < 0.15 && nextItems[0] !== undefined) {
        nextItems.push(nextItems[0]);
      }
      if (random() < 0.12) {
        nextItems.push(
          ADMIN_CONSOLE_MENU_IDS[pickIndex(random, ADMIN_CONSOLE_MENU_IDS.length)],
        );
      }
      items[section] = nextItems;
    }
    cases.push({ sections, items });
  }

  return cases.slice(0, count);
}

function requiredSearchQueryCases(): string[] {
  const titledMenu = ADMIN_CONSOLE_MENU_LIST.find((menu) =>
    menu.title.includes("대시보드"),
  );
  const partial = titledMenu ? titledMenu.title.slice(0, 3) : "맛집";
  return [
    "",
    "   ",
    "맛",
    "zzzznotamenu",
    partial,
    "kpi",
    "KPI",
    "a".repeat(65),
    "없는메뉴검색어xyz",
    "KPI 맛집",
  ];
}

export function generateSearchQueryCases(count: number): string[] {
  const cases = requiredSearchQueryCases();
  const random = mulberry32(11);
  const alphabet = [..."abcdefghijklmnopqrstuvwxyz맛집검수운영판단콘텐츠KPI OCR"];

  while (cases.length < count) {
    const length = pickIndex(random, 80);
    let query = "";
    for (let index = 0; index < length; index += 1) {
      query += alphabet[pickIndex(random, alphabet.length)] ?? "";
    }
    if (random() < 0.1) {
      query = ` ${query} `;
    }
    cases.push(query);
  }

  return cases.slice(0, count);
}

export type CanonicalHrefCase = {
  moduleId: string;
  query: Record<string, string>;
};

function requiredCanonicalHrefCases(): CanonicalHrefCase[] {
  const invalid: CanonicalHrefCase[] = [
    { moduleId: "", query: {} },
    { moduleId: "unknown-module", query: { video_id: "v1" } },
    { moduleId: " overview ", query: {} },
    { moduleId: "OVERVIEW", query: { issue: "좌표" } },
    { moduleId: "overview?x=1", query: { reason: "중복" } },
  ];
  const valid = ADMIN_CONSOLE_MENU_IDS.flatMap((moduleId) => [
    { moduleId, query: {} },
    {
      moduleId,
      query: { video_id: "video-1", issue: "좌표 오류", reason: "중복 후보" },
    },
  ]);
  return [...invalid, ...valid];
}

export function generateCanonicalHrefCases(count: number): CanonicalHrefCase[] {
  const cases = requiredCanonicalHrefCases();
  const random = mulberry32(13);
  const extraKeys = ["view", "tab", "foo"];

  while (cases.length < count) {
    const moduleId =
      random() < 0.85
        ? ADMIN_CONSOLE_MENU_IDS[pickIndex(random, ADMIN_CONSOLE_MENU_IDS.length)] ??
          "overview"
        : ["", "unknown", " Reviews ", "reviews?x"][pickIndex(random, 4)] ?? "";
    const query: Record<string, string> = {};
    if (random() < 0.7) query.video_id = `vid-${Math.floor(random() * 1000)}`;
    if (random() < 0.5) query.issue = random() < 0.5 ? "좌표" : "";
    if (random() < 0.5) query.reason = "중복";
    if (random() < 0.3) {
      const extra = extraKeys[pickIndex(random, extraKeys.length)];
      if (extra) query[extra] = "legacy";
    }
    cases.push({ moduleId, query });
  }

  return cases.slice(0, count);
}
