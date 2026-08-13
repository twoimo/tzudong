import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import postcss from "postcss";
import tailwindcssPostcss from "@tailwindcss/postcss";
import {
  ADMIN_ROUTE_CSS_MAX_BYTES,
  ADMIN_ROUTE_CSS_MAX_TRANSFER_BYTES,
  DEFERRED_ROUTE_CSS_MAX_BYTES,
  DEFERRED_ROUTE_CSS_MAX_TRANSFER_BYTES,
  GENERAL_APP_ROUTE_CSS_MAX_BYTES,
  GENERAL_APP_ROUTE_CSS_MAX_TRANSFER_BYTES,
  HOME_ROUTE_CSS_MAX_BYTES,
  HOME_ROUTE_CSS_MAX_TRANSFER_BYTES,
  hasCssDeclaration,
  hasCssDeclarationInMedia,
  parseClientReferenceManifest,
  verifyBuildRouteCssBoundaries,
} from "../scripts/verify-route-css-boundaries.mjs";

const source = (relativePath: string) =>
  readFileSync(join(import.meta.dir, "..", relativePath), "utf8");
const exists = (relativePath: string) =>
  existsSync(join(import.meta.dir, "..", relativePath));
const importWebConfig = async () => import("../next.config.mjs");
const sourceFilesUnder = (relativeDir: string): string[] => {
  const absoluteDir = join(import.meta.dir, "..", relativeDir);
  return readdirSync(absoluteDir, { withFileTypes: true }).flatMap((entry) => {
    const relativePath = `${relativeDir}/${entry.name}`;
    if (entry.isDirectory()) {
      if (entry.name === ".next" || entry.name === "node_modules") return [];
      return sourceFilesUnder(relativePath);
    }

    return /\.(?:ts|tsx|js|jsx)$/.test(entry.name) ? [relativePath] : [];
  });
};
const countSourceMatches = (contents: string, pattern: RegExp) =>
  contents.match(pattern)?.length ?? 0;

const tailwindEntries = {
  "app/app-globals.css": {
    sources: ['"../app"', '"../components"', '"../pages"', '"../lib"'],
    exclusions: [
      'not "../**/*.{test,spec}.{js,jsx,ts,tsx}"',
      'not "../**/*.{stories,story}.{js,jsx,ts,tsx}"',
      'not "../{tests-unit,test,tests,fixtures}/**"',
    ],
  },
  "app/home-app-globals.css": {
    sources: [
      '"./page.tsx"', '"./home-runtime-shell.tsx"', '"./home-client.tsx"',
      '"./home-client-effects.tsx"', '"./app-providers.tsx"', '"./providers.tsx"',
      '"../hooks"', '"../contexts"', '"../components/home"', '"../components/layout"',
      '"../components/map"', '"../components/search"', '"../components/filters"',
      '"../components/region"', '"../components/skeletons"', '"../components/ui"',
      '"../lib/naver-map-overlay-position-helpers.ts"',
    ],
    exclusions: [],
  },
  "app/home-deferred-globals.css": {
    sources: ['"./home-client-sidepanels.tsx"', '"../components/admin"', '"../components/announcement"', '"../components/modals"', '"../components/ui"'],
    exclusions: ['not "../**/*.test.*"', 'not "../tests-unit"'],
  },
  "app/home-detail-globals.css": {
    sources: ['"../components/restaurant"', '"../components/reviews"', '"../components/auth"', '"../components/ui"'],
    exclusions: ['not "../**/*.test.*"', 'not "../tests-unit"'],
  },
} as const;

const escapedClassSelector = (utility: string) =>
  `.${[...utility].map((character) => /[A-Za-z0-9_-]/.test(character) ? character : `\\${character}`).join("")}`;

describe("Tailwind v4 source contracts", () => {
  test("parses exact source directives and compiles all production entries with retained utilities", async () => {
    const retainedUtilities: string[] = [];
    const compiledEntries = new Map<string, string>();
    for (const [entry, contract] of Object.entries(tailwindEntries)) {
      const entrySource = source(entry);
      const root = postcss.parse(entrySource, { from: join(import.meta.dir, "..", entry) });
      const directives = root.nodes
        .filter((node) => node.type === "atrule")
        .map((node) => ({ name: node.name, params: node.params }));

      expect(directives.filter((directive) =>
        directive.name === "import" && directive.params === '"tailwindcss" source(none)',
      )).toHaveLength(1);
      expect(directives.filter((directive) => directive.name === "source" && !directive.params.startsWith("inline("))
        .map((directive) => directive.params)).toEqual([...contract.sources, ...contract.exclusions]);
      expect(directives.filter((directive) => directive.name === "source" && directive.params.startsWith("inline("))
        .every((directive) => /^inline\("[^"]+"\)$/.test(directive.params))).toBe(true);

      for (const directive of directives.filter((directive) => directive.name === "source" && directive.params.startsWith("inline("))) {
        retainedUtilities.push(...directive.params.slice('inline("'.length, -2).split(/\s+/).filter(Boolean));
      }

      const compiled = await postcss([tailwindcssPostcss()]).process(entrySource, {
        from: join(import.meta.dir, "..", entry),
      });
      compiledEntries.set(entry, compiled.css);
      const compiledRoot = postcss.parse(compiled.css);
      expect(compiledRoot.nodes.some((node) => node.type === "rule")).toBe(true);
    }

    expect(retainedUtilities.length).toBeGreaterThan(0);
    expect(new Set(retainedUtilities).size).toBe(retainedUtilities.length);
    const compiledAppRoot = postcss.parse(compiledEntries.get("app/app-globals.css")!);
    const selectors: string[] = [];
    compiledAppRoot.walkRules((rule) => {
      selectors.push(rule.selector);
    });
    for (const utility of retainedUtilities) {
      const selector = escapedClassSelector(utility);
      expect(selectors.some((value) => value.includes(selector))).toBe(true);
    }

    const tailwindConfigSource = source("tailwind.config.ts");
    expect(source("app/globals.css")).not.toMatch(/@import\s+["']tailwindcss["'];?/);
    expect(tailwindConfigSource).not.toMatch(/\bcontent\s*:/);
    expect(tailwindConfigSource).not.toContain("SAFELIST");
    expect(tailwindConfigSource).not.toContain("_CLASSES");
  }, 60_000);
});
const wrapClientReferenceManifest = (routeKey: string, serialized: string) =>
  `globalThis.__RSC_MANIFEST=(globalThis.__RSC_MANIFEST||{});globalThis.__RSC_MANIFEST[${JSON.stringify(routeKey)}]=${serialized};`;

const routeCssFixture = (overrides: Partial<Record<"home" | "general" | "admin" | "deferred", string>> = {}) => {
  const nextDirectory = mkdtempSync(join(tmpdir(), "tzudong-route-css-"));
  const cssDirectory = join(nextDirectory, "static", "css");
  mkdirSync(cssDirectory, { recursive: true });
  const css = {
    shared: ":root{--shared-route-css:1}",
    home: ".bg-background{background-color:hsl(var(--background))}.scrollbar-hide{scrollbar-width:none}@media (min-width:1024px){.lg\\:grid{display:grid}}",
    general: ':root{--admin-sidebar-expanded-max-width:min(17.5rem,27vw)}@media (min-width:768px){[data-admin-console-layout="sidebar-content"]{grid-template-columns:minmax(0,1fr)}}.feed-card{display:grid;grid-template-columns:minmax(0,1fr)}.feed-toolbar{display:flex;align-items:center;justify-content:space-between}.feed-panel{min-height:12rem}',
    admin: ':root{--admin-sidebar-expanded-max-width:min(17.5rem,27vw)}@media (min-width:768px){[data-admin-console-layout="sidebar-content"]{grid-template-columns:minmax(0,1fr)}}',
    deferred: ".scrollbar-hide{scrollbar-width:none}@media (max-width:767px){:where(.scrollbar-hide-mobile,[data-mobile-scrollbarless=true],[class*=overflow-y-auto],[class*=overflow-x-auto],[class*=overflow-auto]){scrollbar-width:none}}",
    ...overrides,
  };
  for (const [name, contents] of Object.entries(css)) writeFileSync(join(cssDirectory, `${name}.css`), contents);
  const manifests = [
    ["page_client-reference-manifest.js", "/page", ["shared.css", "home.css"]],
    ["feed/page_client-reference-manifest.js", "/feed/page", ["shared.css", "general.css"]],
    ["admin/page_client-reference-manifest.js", "/admin/page", ["shared.css", "admin.css"]],
    ["home-frame/page_client-reference-manifest.js", "/home-frame/page", ["shared.css", "deferred.css"]],
  ] as const;
  const fixtureRoot = "C:\\fixture\\apps\\web";
  const routeOwners = {
    "/page": `${fixtureRoot}\\app\\page`,
    "/feed/page": `${fixtureRoot}\\app\\feed\\layout`,
    "/admin/page": `${fixtureRoot}\\app\\admin\\layout`,
    "/home-frame/page": `${fixtureRoot}\\app\\home-frame\\page`,
  } as const;
  for (const [manifestPath, routeKey, assets] of manifests) {
    const manifestFile = join(nextDirectory, "server", "app", manifestPath);
    mkdirSync(resolve(manifestFile, ".."), { recursive: true });
    const toAsset = (asset: string) => ({ inlined: false, path: `static/css/${asset}` });
    const entryCSSFiles = {
      [`${fixtureRoot}\\app\\layout`]: [toAsset(assets[0])],
      [routeOwners[routeKey]]: assets.slice(1).map(toAsset),
    };
    const manifest = {
      moduleLoading: { prefix: "/_next/" },
      ssrModuleMapping: {},
      edgeSSRModuleMapping: {},
      clientModules: {},
      entryCSSFiles,
      rscModuleMapping: {},
      edgeRscModuleMapping: {},
    };
    writeFileSync(manifestFile, wrapClientReferenceManifest(routeKey, JSON.stringify(manifest)));
  }
  return nextDirectory;
};

const withRouteCssFixture = (overrides: Partial<Record<"home" | "general" | "admin" | "deferred", string>>, assertion: (nextDirectory: string) => void) => {
  const nextDirectory = routeCssFixture(overrides);
  try {
    assertion(nextDirectory);
  } finally {
    rmSync(nextDirectory, { recursive: true, force: true });
  }
};
const routeCssBases = {
  home: ".bg-background{background-color:hsl(var(--background))}.scrollbar-hide{scrollbar-width:none}@media (min-width:1024px){.lg\\:grid{display:grid}}",
  general: ':root{--admin-sidebar-expanded-max-width:min(17.5rem,27vw)}@media (min-width:768px){[data-admin-console-layout="sidebar-content"]{grid-template-columns:minmax(0,1fr)}}',
  admin: ':root{--admin-sidebar-expanded-max-width:min(17.5rem,27vw)}@media (min-width:768px){[data-admin-console-layout="sidebar-content"]{grid-template-columns:minmax(0,1fr)}}',
  deferred: ".scrollbar-hide{scrollbar-width:none}@media (max-width:767px){:where(.scrollbar-hide-mobile,[data-mobile-scrollbarless=true],[class*=overflow-y-auto],[class*=overflow-x-auto],[class*=overflow-auto]){scrollbar-width:none}}",
} as const;
const sharedCss = ":root{--shared-route-css:1}";
const gzipBytes = (css: string) => gzipSync(css).byteLength;
const padToRawBytes = (css: string, targetBytes: number) => {
  const paddingBytes = targetBytes - Buffer.byteLength(css);
  if (paddingBytes < 4) throw new Error("raw padding target is too small");
  return `${css}/*${"x".repeat(paddingBytes - 4)}*/`;
};
const deterministicPayload = (length: number) => {
  const alphabet = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
  let state = 0x9e3779b9;
  let payload = "";
  for (let index = 0; index < length; index += 1) {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    payload += alphabet[(state >>> 0) % alphabet.length];
  }
  return payload;
};
const padToTransferBytes = (css: string, targetBytes: number) => {
  const candidate = (length: number) => `${css}/*${deterministicPayload(length)}*/`;
  let low = 0;
  let high = Math.max(targetBytes * 2, 1);
  while (gzipBytes(candidate(high)) < targetBytes) high *= 2;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (gzipBytes(candidate(middle)) < targetBytes) low = middle;
    else high = middle - 1;
  }
  for (let length = Math.max(0, low - 64); length <= low + 512; length += 1) {
    const padded = candidate(length);
    if (gzipBytes(padded) === targetBytes) return padded;
  }
  throw new Error(`cannot construct deterministic CSS at ${targetBytes} gzip bytes`);
};


describe("route CSS boundary verifier fixtures", () => {
  test("inventories shared and exclusive home, general, admin, and deferred assets", () => {
    withRouteCssFixture({}, (nextDirectory) => {
      const result = verifyBuildRouteCssBoundaries({ nextDirectory });
      expect(result.sharedAssetPaths).toEqual(["static/css/shared.css"]);
      expect(result.exclusiveAssetPaths).toEqual({
        home: ["static/css/home.css"],
        generalApp: ["static/css/general.css"],
        admin: ["static/css/admin.css"],
        deferred: ["static/css/deferred.css"],
      });
    });
  });

  test("rejects malformed, decoy, negated-media, and budget-bypass CSS", () => {
    expect(hasCssDeclaration('.bg-background{--probe:background-color}a{content:"}"}', ".bg-background", "background-color")).toBe(false);
    expect(hasCssDeclaration(".bg-background{background-color:red}", ".bg-background", "background-color")).toBe(true);
    expect(hasCssDeclarationInMedia("@media not all and (min-width:1024px){.lg\\:grid{display:grid}}", ["min-width:1024px"], ".lg\\:grid", "display:grid")).toBe(false);
    expect(hasCssDeclarationInMedia("@media (min-width:1024px){@media not all{.lg\\:grid{display:grid}}}", ["min-width:1024px"], ".lg\\:grid", "display:grid")).toBe(false);
    expect(hasCssDeclarationInMedia("@media (min-width:1024pxx){.lg\\:grid{display:grid}}", ["min-width:1024px"], ".lg\\:grid", "display:grid")).toBe(false);
    expect(hasCssDeclarationInMedia("@media screen and (min-width:1024px){.lg\\:grid{display:grid}}", ["min-width:1024px"], ".lg\\:grid", "display:grid")).toBe(false);
    expect(hasCssDeclaration("@supports (display: decoy){.bg-background{background-color:red}}", ".bg-background", "background-color")).toBe(false);
    expect(hasCssDeclarationInMedia("@media (min-width:1024px){@media (min-width:1024px){.lg\\:grid{display:grid}}}", ["min-width:1024px"], ".lg\\:grid", "display:grid")).toBe(false);
    expect(() => parseClientReferenceManifest(
      wrapClientReferenceManifest(
        "/page",
        '{"moduleLoading":{},"ssrModuleMapping":{},"edgeSSRModuleMapping":{},"clientModules":{},"entryCSSFiles":{},"entryCSSFiles":{"owner":[{"inlined":false,"path":"static/css/home.css"}]},"rscModuleMapping":{},"edgeRscModuleMapping":{}}',
      ),
      "/page",
    )).toThrow("duplicate key");
    expect(hasCssDeclaration(".bg-background{background-color:red", ".bg-background", "background-color")).toBe(false);
    withRouteCssFixture({ home: ".bg-background{background-color:hsl(var(--background))}" }, (nextDirectory) => {
      expect(() => verifyBuildRouteCssBoundaries({ nextDirectory })).toThrow("scrollbar-hide");
    });
    withRouteCssFixture({ general: padToRawBytes(routeCssBases.general, GENERAL_APP_ROUTE_CSS_MAX_BYTES - Buffer.byteLength(sharedCss) + 1) }, (nextDirectory) => {
      expect(() => verifyBuildRouteCssBoundaries({ nextDirectory })).toThrow("raw ceiling");
    });
    withRouteCssFixture({ deferred: padToRawBytes(routeCssBases.deferred, DEFERRED_ROUTE_CSS_MAX_BYTES - Buffer.byteLength(sharedCss) + 1) }, (nextDirectory) => {
      expect(() => verifyBuildRouteCssBoundaries({ nextDirectory })).toThrow("raw ceiling");
    });
    withRouteCssFixture({ admin: ':root{--admin-sidebar-expanded-max-width:1}@media (max-width:767px){[data-admin-console-layout="sidebar-content"]{grid-template-columns:minmax(0,1fr)}}' }, (nextDirectory) => {
      expect(() => verifyBuildRouteCssBoundaries({ nextDirectory })).toThrow("media-scoped selector");
    });
  });
});
describe("route CSS ceiling boundaries", () => {
  test("enforces exact and one-over raw and transfer ceilings for every route", () => {
    const ceilings = [
      { route: "home", raw: HOME_ROUTE_CSS_MAX_BYTES, transfer: HOME_ROUTE_CSS_MAX_TRANSFER_BYTES, resultKey: "homeBytes", transferResultKey: "homeTransferBytes" },
      { route: "general", raw: GENERAL_APP_ROUTE_CSS_MAX_BYTES, transfer: GENERAL_APP_ROUTE_CSS_MAX_TRANSFER_BYTES, resultKey: "generalAppBytes", transferResultKey: "generalAppTransferBytes" },
      { route: "admin", raw: ADMIN_ROUTE_CSS_MAX_BYTES, transfer: ADMIN_ROUTE_CSS_MAX_TRANSFER_BYTES, resultKey: "adminBytes", transferResultKey: "adminTransferBytes" },
      { route: "deferred", raw: DEFERRED_ROUTE_CSS_MAX_BYTES, transfer: DEFERRED_ROUTE_CSS_MAX_TRANSFER_BYTES, resultKey: "deferredBytes", transferResultKey: "deferredTransferBytes" },
    ] as const;

    for (const ceiling of ceilings) {
      const rawExact = padToRawBytes(
        routeCssBases[ceiling.route],
        ceiling.raw - Buffer.byteLength(sharedCss),
      );
      withRouteCssFixture({ [ceiling.route]: rawExact }, (nextDirectory) => {
        expect(verifyBuildRouteCssBoundaries({ nextDirectory })[ceiling.resultKey]).toBe(ceiling.raw);
      });
      const rawOneOver = padToRawBytes(
        routeCssBases[ceiling.route],
        ceiling.raw - Buffer.byteLength(sharedCss) + 1,
      );
      withRouteCssFixture({ [ceiling.route]: rawOneOver }, (nextDirectory) => {
        expect(() => verifyBuildRouteCssBoundaries({ nextDirectory })).toThrow("raw ceiling");
      });

      const exactTransfer = padToTransferBytes(
        routeCssBases[ceiling.route],
        ceiling.transfer - gzipBytes(sharedCss),
      );
      withRouteCssFixture({ [ceiling.route]: exactTransfer }, (nextDirectory) => {
        expect(verifyBuildRouteCssBoundaries({ nextDirectory })[ceiling.transferResultKey]).toBe(ceiling.transfer);
      });
      const oneOverTransfer = padToTransferBytes(
        routeCssBases[ceiling.route],
        ceiling.transfer - gzipBytes(sharedCss) + 1,
      );
      withRouteCssFixture({ [ceiling.route]: oneOverTransfer }, (nextDirectory) => {
        expect(() => verifyBuildRouteCssBoundaries({ nextDirectory })).toThrow("transfer ceiling");
      });
    }
  }, 60_000);
});

describe("web quality performance source contracts", () => {
  test("map marker HTML keeps image markers with WebP delivery and PNG fallback", () => {
    const clusterMarkerSource = source("lib/cluster-marker.ts");

    expect(clusterMarkerSource).toContain("CATEGORY_IMAGES");
    expect(clusterMarkerSource).toContain(
      "/images/maker-images/webp/${name}.webp",
    );
    expect(clusterMarkerSource).toContain("/images/maker-images/${name}.png");
    expect(clusterMarkerSource).toContain('type="image/webp"');
    expect(clusterMarkerSource).toContain('src="${image.png}"');
    expect(clusterMarkerSource).toContain('srcset="${image.webp}"');
    expect(clusterMarkerSource).not.toContain("createCategoryMarkerGlyphHTML");
  });

  test("global map exposes bounded Google failure exploration fallback", () => {
    const globalMapSource = source("app/global-map/page.tsx");
    const googleMapsHookSource = source("hooks/use-google-maps.tsx");

    expect(googleMapsHookSource).toContain(
      'GOOGLE_MAPS_LOAD_STATE_EVENT = "tzudong:google-maps-load-state"',
    );
    expect(googleMapsHookSource).toContain("window.gm_authFailure = () =>");
    expect(googleMapsHookSource).toContain(
      "dispatchGoogleMapsLoadState({ status: \"error\"",
    );
    expect(googleMapsHookSource).toContain(
      "dispatchGoogleMapsLoadState({ status: \"loaded\"",
    );

    expect(globalMapSource).toContain("GOOGLE_MAPS_LOAD_STATE_EVENT");
    expect(globalMapSource).toContain(
      'data-global-map-fallback-source="globalRestaurants"',
    );
    expect(globalMapSource).toContain("GLOBAL_MAP_FALLBACK_RESULT_LIMIT = 10");
    expect(globalMapSource).toContain(
      "fallbackRestaurants.slice(0, GLOBAL_MAP_FALLBACK_RESULT_LIMIT)",
    );
    expect(globalMapSource).toContain(
      'aria-label="글로벌 지도 대체 목록 검색"',
    );
    expect(globalMapSource).toContain("setFallbackSearchQuery");
    expect(globalMapSource).toContain("globalRestaurants.filter((restaurant)");
    expect(globalMapSource).toContain("filters.categories.some");
    expect(globalMapSource).toContain("setSelectedRestaurant(restaurant);");
    expect(globalMapSource).toContain("setPanelRestaurant(restaurant);");
    expect(globalMapSource).toContain("setIsPanelOpen(true);");
    expect(globalMapSource).toContain(
      "onClick={() => handleFallbackRestaurantSelect(restaurant)}",
    );
  });

  test("map marker WebP assets are present and substantially smaller than PNG fallbacks", () => {
    const markerDir = join(import.meta.dir, "..", "public/images/maker-images");
    const webpDir = join(markerDir, "webp");
    const pngFiles = readdirSync(markerDir).filter((file) =>
      file.endsWith(".png"),
    );

    expect(pngFiles.length).toBeGreaterThan(0);

    let pngTotal = 0;
    let webpTotal = 0;

    for (const file of pngFiles) {
      const pngPath = join(markerDir, file);
      const webpPath = join(webpDir, file.replace(/\.png$/, ".webp"));

      expect(existsSync(webpPath)).toBe(true);
      pngTotal += statSync(pngPath).size;
      webpTotal += statSync(webpPath).size;
    }

    expect(webpTotal).toBeLessThan(pngTotal * 0.1);
  });

  test("popup ad banners load immediately for first-screen exposure while distant media has no src", () => {
    const popupSource = source("components/layout/CombinedPopup.tsx");
    const hookSource = source("hooks/use-ad-banners.tsx");

    expect(popupSource).toContain("POPUP_BANNER_IDLE_DELAY_MS = 0");
    expect(popupSource).toContain(
      "usePopupAdBanners({ enabled: canLoadBanners })",
    );
    expect(popupSource).toContain(
      "src={shouldLoadMedia ? banner.video_url : undefined}",
    );
    expect(popupSource).toContain("banner.image_url && shouldLoadMedia");
    expect(popupSource).toContain(
      "shouldLoadMedia={Math.abs(index - trackSlide) <= 1}",
    );
    expect(popupSource).toContain("filterPopupBannersWithTrustedPosterMedia(banners)");
    expect(popupSource).toContain("getPopupBannerLoopResetIndex");
    expect(popupSource).toContain("getPopupBannerNavigationTarget");
    expect(popupSource).toContain("getPopupBannerTrackIndexForSourceIndex");
    expect(popupSource).toContain(
      "const target = getPopupBannerNavigationTarget(currentSlideRef.current, posterBanners.length, direction)",
    );
    expect(popupSource).toContain(
      "absolute bottom-12 left-0 right-0 z-20 flex justify-center gap-1.5",
    );
    expect(popupSource).toContain("flex h-5 w-5 items-center justify-center");
    expect(popupSource).toContain("h-1.5 w-1.5 rounded-full transition-all");
    expect(popupSource).not.toContain("텍스트 전용 배너");
    expect(popupSource).toContain(
      "['pointerdown', 'keydown', 'wheel', 'touchstart']",
    );
    expect(hookSource).toContain("options: { enabled?: boolean } = {}");
    expect(hookSource).toContain("enabled: options.enabled ?? true");
  });

  test("home filter count queries run before dropdown open so triggers do not show stale zero counts", () => {
    const regionSelectorSource = source("components/region/RegionSelector.tsx");
    const categoryFilterSource = source(
      "components/filters/CategoryFilter.tsx",
    );

    expect(regionSelectorSource).toContain("queryKey: ['restaurants-count']");
    expect(regionSelectorSource).toContain("enabled: true,");
    expect(regionSelectorSource).not.toContain("enabled: isOpen,");
    expect(categoryFilterSource).toContain("queryKey: categoryQueryKey");
    expect(categoryFilterSource).toContain(
      "? ['restaurants-categories', selectedRegion, selectedCountry]",
    );
    expect(categoryFilterSource).toContain(": ['restaurants-count']");
    expect(categoryFilterSource).toContain("enabled: true,");
    expect(categoryFilterSource).not.toContain("enabled: isOpen,");
    expect(regionSelectorSource).toContain("contentSide?:");
    expect(regionSelectorSource).toContain("z-[180]");
    expect(regionSelectorSource).toContain(
      '<span className="whitespace-nowrap">대한민국</span>',
    );
    expect(regionSelectorSource).not.toContain("<span>전국</span>");
    expect(categoryFilterSource).toContain("contentSide?:");
    expect(categoryFilterSource).toContain("카테고리 검색…");
    expect(categoryFilterSource).toContain("z-[180]");
    expect(categoryFilterSource).toContain("rounded-2xl border-border bg-card");
  });

  test("home map runtime renders directly while supporting queries stay intent-gated", () => {
    const pageSource = source("app/page.tsx");
    const homeClientSource = source("app/home-client.tsx");
    const homeRuntimeShellSource = source("app/home-runtime-shell.tsx");
    const homeClientSidePanelsSource = source("app/home-client-sidepanels.tsx");
    const restaurantSearchSource = source(
      "components/search/RestaurantSearch.tsx",
    );
    const mobileControlSource = source(
      "components/home/MobileControlOverlay.tsx",
    );
    const mobileNotificationSource = source(
      "components/home/MobileNotificationMenuButton.tsx",
    );
    const homeControlPanelSource = source(
      "components/home/home-control-panel.tsx",
    );
    const homeDesktopControlPanelSource = source(
      "components/home/home-desktop-control-panel.tsx",
    );
    const desktopLeftPanelMapHomeSource = source(
      "components/home/DesktopLeftPanelMapHome.tsx",
    );
    const popularRestaurantsSource = source("lib/popular-restaurants.ts");
    const popularRankSnapshotsMigrationSource = source(
      "supabase/migrations/20260523093000_create_restaurant_popular_rank_snapshots.sql",
    );
    const stampCardSource = source("components/stamp/StampCard.tsx");
    const homeAppGlobalsSource = source("app/home-app-globals.css");
    const desktopBookmarksSource = source(
      "components/home/DesktopLeftPanelBookmarks.tsx",
    );
    const desktopNotificationsSource = source(
      "components/home/DesktopLeftPanelNotifications.tsx",
    );
    const homeClientEffectsSource = source("app/home-client-effects.tsx");
    const homeViewportModeSource = source("hooks/useHomeViewportMode.ts");
    const regionSelectorSource = source("components/region/RegionSelector.tsx");
    const categoryFilterSource = source(
      "components/filters/CategoryFilter.tsx",
    );
    const mapQuerySource = source("lib/map-query-helpers.ts");
    const naverMapSource = source("components/map/NaverMapView.tsx");
    const mapViewSidepanelsSource = source(
      "components/map/map-view-sidepanels.tsx",
    );
    const naverMapSidepanelsSource = source(
      "components/map/naver-map-sidepanels.tsx",
    );
    const headerSource = source("components/layout/Header.tsx");
    const bannerAnnouncementsHookSource = source(
      "hooks/use-banner-announcements.tsx",
    );
    const deviceTypeSource = source("hooks/useDeviceType.ts");
    const mapIndicatorsSource = source(
      "components/map/naver-map-overlay-indicators.tsx",
    );
    const mapOverlayNoticeSource = source(
      "components/map/map-overlay-notice.tsx",
    );
    const mapViewIndicatorsSource = source(
      "components/map/map-view-overlay-indicators.tsx",
    );
    const overlayStackSource = source(
      "components/map/naver-map-overlay-stack.tsx",
    );
    const overlayPositionSource = source(
      "lib/naver-map-overlay-position-helpers.ts",
    );
    const overlayLayoutSource = source("components/layout/OverlayLayout.tsx");
    const floatingNavSource = source(
      "components/layout/FloatingNavButtons.tsx",
    );

    expect(pageSource).toContain(
      "import { HomeRuntimeShell } from './home-runtime-shell'",
    );
    expect(pageSource).toContain("import HomeClient from './home-client'");
    expect(pageSource).toContain("<HomeRuntimeShell>");
    expect(pageSource).toContain("<HomeClient />");
    expect(pageSource).not.toContain("<HomeInitialShell />");
    expect(pageSource).not.toContain("homeFrameBootstrap");
    expect(pageSource).not.toContain("homeDeepLinkPreviewBootstrap");
    expect(pageSource).not.toContain(
      "frame.src = '/home-frame' + window.location.search + window.location.hash",
    );
    expect(pageSource).not.toContain("function HomeDeepLinkPreview()");
    expect(pageSource).not.toContain('id="home-deep-link-preview"');
    expect(pageSource).not.toContain("searchParams: Promise");
    expect(pageSource).not.toContain("export default async function HomePage");
    expect(pageSource).not.toContain("fetchHomeDeepLinkPreviewRestaurant");
    expect(pageSource).not.toContain(
      "fetchSupabaseRows<HomeDeepLinkPreviewRestaurant>",
    );
    expect(pageSource).not.toContain("HomeLandingShell");
    expect(pageSource).not.toContain("HomeMapIsland");
    expect(pageSource).not.toContain("지도 준비하기");
    expect(source("app/home-frame/page.tsx")).toContain("<HomeRuntimeShell>");
    expect(source("app/home-frame/page.tsx")).toContain("<HomeClient />");
    expect(source("proxy.ts")).not.toContain(
      "NextResponse.rewrite(new URL('/home-static.html', request.url))",
    );
    expect(source("proxy.ts")).not.toContain("isRootPageRequest");
    expect(source("lib/auth/public-eligibility-session.ts")).toContain("'/'");
    expect(source("lib/auth/public-eligibility-session.ts")).toContain("'/home-frame'");
    expect(exists("app/home-initial-shell.tsx")).toBe(false);
    expect(exists("public/home-static.html")).toBe(false);
    expect(homeClientSource).toContain("<HomeMapContainer");
    expect(homeClientSource).toContain("<HomeControlPanel");
    expect(homeClientSource).toContain("isPanelCollapsed={isPanelCollapsed}");
    expect(homeClientSource).toContain("desktopMapLayout={desktopMapLayout}");
    expect(homeClientSource).toContain("desktopPanelSide={desktopPanelSide}");
    expect(homeClientSource).toContain(
      "setDesktopMapLayout(preferences.desktopMapLayout)",
    );
    expect(homeClientSource).toContain(
      "setDesktopPanelSide(preferences.desktopPanelSide)",
    );
    expect(homeClientSource).toContain(
      "setDesktopMapLayout(customEvent.detail.preferences.desktopMapLayout)",
    );
    expect(homeClientSource).toContain(
      "setDesktopPanelSide(customEvent.detail.preferences.desktopPanelSide)",
    );
    expect(homeClientSource).toContain(
      "onTogglePanelCollapse={togglePanelCollapse}",
    );
    expect(homeClientSource.indexOf("<HomeMapContainer")).toBeLessThan(
      homeClientSource.indexOf(
        "{isViewportResolved && !(isMobileOrTablet && isMapFullscreen)",
      ),
    );
    expect(source("components/home/home-map-container.tsx")).not.toContain(
      "import { useRestaurantWithMergeContext }",
    );
    expect(source("components/home/home-map-container.tsx")).toContain(
      "HydratedDetailRestaurant",
    );
    const hydratedDetailSource = source(
      "components/home/HydratedDetailRestaurant.tsx",
    );
    expect(hydratedDetailSource).toContain("@/hooks/use-restaurant-detail");
    expect(hydratedDetailSource).not.toContain(
      "DETAIL_HYDRATION_IDLE_DELAY_MS",
    );
    expect(hydratedDetailSource).toContain(
      "useRestaurantWithMergeContext(restaurant)",
    );
    expect(hydratedDetailSource).not.toContain(
      "shouldHydrateDetail ? restaurant : null",
    );
    expect(source("hooks/use-restaurants.tsx")).not.toContain(
      "useRestaurantWithMergeContext",
    );
    expect(homeClientSource).not.toContain(
      "지도를 먼저 그리고 맛집 데이터를 순서대로 연결합니다",
    );
    expect(homeClientSource).not.toContain("홈 지도 화면 준비 중");
    expect(homeClientSource).not.toContain("쯔동여지도 로딩 중");
    expect(homeClientSource).toContain("tzudong:home-initial-intent");
    expect(homeClientSource).toContain(
      "initialIntent={initialMobileOverlayIntent}",
    );
    expect(homeClientSource).toContain('setActivePanel("control")');
    expect(
      source("components/restaurant/RestaurantDetailPanel.tsx"),
    ).not.toContain("RESTAURANT_DETAIL_REVIEW_IDLE_DELAY_MS");
    expect(
      source("components/restaurant/RestaurantDetailPanel.tsx"),
    ).not.toContain("리뷰를 잠시 후 불러옵니다");
    expect(source("components/restaurant/RestaurantDetailPanel.tsx")).toContain(
      "const shouldLoadReviewData = Boolean(restaurantId);",
    );
    expect(source("components/home/home-map-container.tsx")).toContain(
      "handleSheetHandleKeyDown",
    );
    expect(source("components/home/home-map-container.tsx")).toContain(
      "onKeyDown={handleSheetHandleKeyDown}",
    );
    expect(source("components/home/home-map-container.tsx")).toContain(
      "event.key === 'ArrowUp'",
    );
    expect(source("components/home/home-map-container.tsx")).toContain(
      "event.key === 'Escape'",
    );
    expect(source("components/home/home-map-container.tsx")).toContain(
      "focus-visible:ring-2",
    );
    expect(source("components/home/home-map-container.tsx")).toContain(
      'aria-label="상세 패널 닫기"',
    );
    expect(source("components/home/home-map-container.tsx")).toContain(
      "flex h-12 w-11 items-center",
    );
    expect(homeClientSource).not.toContain(
      "function HomeControlPanelLoadingShell()",
    );
    expect(homeClientSource).not.toContain("쯔동여지도 검색하기");
    expect(homeClientSource).toContain("loading: () => null");
    expect(homeRuntimeShellSource).toContain("import './home-app-globals.css'");
    expect(homeRuntimeShellSource).toContain("function MobileHomeLayout");
    expect(homeRuntimeShellSource).toContain(
      "function HomeRuntimePendingShell",
    );
    expect(homeRuntimeShellSource).not.toContain(
      "function HomeRuntimeProgressiveShell",
    );
    expect(homeRuntimeShellSource).not.toContain(
      "function HomeRuntimeLoadingSpinner",
    );
    expect(homeRuntimeShellSource).not.toContain(
      "<HomeRuntimeProgressiveShell />",
    );
    expect(homeRuntimeShellSource).not.toContain('role="status"');
    expect(homeRuntimeShellSource).not.toContain(
      'aria-label="쯔동여지도 로딩 중"',
    );
    expect(homeRuntimeShellSource).not.toContain("animate-spin rounded-full");
    expect(homeRuntimeShellSource).not.toContain(
      'aria-label="쯔동여지도 홈 미리보기"',
    );
    expect(homeRuntimeShellSource).not.toContain(
      'role="status" aria-live="polite"',
    );
    expect(homeRuntimeShellSource).not.toContain('aria-busy="true"');
    expect(homeRuntimeShellSource).not.toContain('data-home-intent="search"');
    expect(homeRuntimeShellSource).not.toContain("지도를 준비하고 있어요");
    expect(homeRuntimeShellSource).not.toContain(
      "지도 화면을 먼저 준비하고 맛집 정보를 순서대로 불러옵니다",
    );
    expect(homeRuntimeShellSource).not.toContain("bg-gradient-to-r");
    expect(homeRuntimeShellSource).not.toContain("motion-reduce:animate-none");
    expect(homeRuntimeShellSource).not.toContain("motion-reduce:hidden");
    expect(homeRuntimeShellSource).not.toContain("홈 지도 준비 단계");
    expect(homeRuntimeShellSource).not.toContain(
      "rounded-3xl border border-border bg-background/90 px-8 py-7",
    );
    expect(homeRuntimeShellSource).not.toContain("animate-bounce");
    expect(homeRuntimeShellSource).not.toContain("@keyframes");
    expect(homeRuntimeShellSource).not.toContain("지도를 준비하고 있어요");
    expect(homeRuntimeShellSource).not.toContain("쯔동여지도 검색하기");
    expect(homeRuntimeShellSource).not.toContain("bg-[radial-gradient");
    expect(homeRuntimeShellSource).not.toContain("bg-[linear-gradient");
    expect(homeRuntimeShellSource).toContain(
      "import MobileBottomNav from '@/components/layout/MobileBottomNav'",
    );
    expect(homeRuntimeShellSource).toContain("<MobileBottomNav");
    expect(homeRuntimeShellSource).not.toContain(
      "MOBILE_BOTTOM_NAV_IDLE_DELAY_MS",
    );
    expect(homeRuntimeShellSource).not.toContain(
      "function MobileBottomNavLoadingShell",
    );
    expect(homeRuntimeShellSource).not.toContain(
      "MOBILE_BOTTOM_NAV_LOADING_ITEMS",
    );
    expect(homeRuntimeShellSource).not.toContain(
      "handleBottomNavLoadingIntent",
    );
    expect(homeRuntimeShellSource).not.toContain(
      "requestAuthUi({ source: 'mobile-bottom-nav-loading-shell-my'",
    );
    expect(homeRuntimeShellSource).not.toContain("router.push(path)");
    expect(homeRuntimeShellSource).not.toContain(
      "function MobileTopControlPendingShell",
    );
    expect(homeRuntimeShellSource).not.toContain("shouldLoadMobileBottomNav");
    expect(homeRuntimeShellSource).toContain("const OverlayLayout = lazy(");
    expect(homeRuntimeShellSource).toContain("<QueryProvider>");
    expect(homeRuntimeShellSource).toContain(
      "fallback={<HomeRuntimePendingShell>{children}</HomeRuntimePendingShell>}",
    );
    expect(homeRuntimeShellSource).not.toContain(
      'fallback={<div className="h-full w-full">{children}</div>}',
    );
    expect(homeRuntimeShellSource).not.toContain("if (!hasMounted)");
    expect(homeRuntimeShellSource).not.toContain("setHasMounted");
    expect(homeRuntimeShellSource).toContain("if (viewportMode === 'pending')");
    expect(homeRuntimeShellSource).toContain("if (viewportMode === 'desktop')");
    expect(homeRuntimeShellSource).not.toContain(
      "from '@/hooks/useDeviceType'",
    );
    expect(homeClientSource).toContain(
      "const viewportMode = useHomeViewportMode()",
    );
    expect(homeClientSource).toContain(
      'const isViewportResolved = viewportMode !== "pending"',
    );
    expect(homeClientSource).toContain(
      "isViewportResolved && !(isMobileOrTablet && isMapFullscreen)",
    );
    expect(homeClientSource).toContain(
      "isViewportResolved && shouldRenderSidePanels",
    );
    expect(homeClientSource).toContain(
      "const shouldRenderSidePanels = Boolean(",
    );
    expect(homeClientSource).not.toContain(
      "activeRightPanel ||\n    isAnnouncementSheetOpen",
    );
    expect(homeClientSidePanelsSource).not.toContain("void activeRightPanel");
    expect(homeClientSidePanelsSource).not.toContain("activeRightPanel:");
    expect(homeClientSource).not.toContain(
      "const { isDesktop, isMobileOrTablet } = useDeviceType()",
    );
    expect(homeViewportModeSource).toContain(
      "export type HomeViewportMode = 'pending' | 'mobileOrTablet' | 'desktop'",
    );
    expect(homeViewportModeSource).toContain(
      "const [mode, setMode] = useState<HomeViewportMode>('pending')",
    );
    expect(homeViewportModeSource).toContain(
      "window.innerWidth <= BREAKPOINTS.tabletMax",
    );
    expect(homeViewportModeSource).toContain(
      "previousMode === nextMode ? previousMode : nextMode",
    );
    expect(homeRuntimeShellSource).not.toContain(
      "<MainLayout>{children}</MainLayout>",
    );
    expect(homeClientSource).not.toContain("home-map-activate-button");
    expect(homeClientSource).toContain("resolveDeviceLocationStateUpdatePlan");
    expect(deviceTypeSource).toContain(
      "function calculateDeviceTypeSnapshot()",
    );
    expect(deviceTypeSource).toContain(
      "const [deviceType, setDeviceType] = useState<DeviceType>(getDesktopDeviceType)",
    );
    expect(deviceTypeSource).toContain(
      "function resolveDeviceTypeState(previous: DeviceType, next: DeviceType): DeviceType",
    );
    expect(deviceTypeSource).toContain(
      "areDeviceTypesEqual(previous, next) ? previous : next",
    );
    expect(homeClientSource).toContain("clearRestaurantDetailSelection");
    expect(homeClientSource).toContain("openRestaurantDetailSelection");
    expect(homeClientSource).toContain("releaseSearchSelectionOwnership");
    expect(homeClientSource).toContain("DEFAULT_HOME_MAP_USER_PREFERENCES");
    expect(homeClientSource).toContain(
      "const preferences = readLastHomeMapUserPreferences();",
    );
    expect(homeClientEffectsSource).toContain(
      "clearRestaurantDetailSelection: () => void",
    );
    expect(homeClientEffectsSource).toContain(
      "isAnnouncementSheetOpen: boolean",
    );
    expect(homeClientEffectsSource).toContain("wasAnnouncementUrlActiveRef");
    expect(homeClientEffectsSource).toContain("lastAnnouncementRequestKeyRef");
    expect(homeClientEffectsSource).toContain(
      "lastRestaurantDeepLinkRequestKeyRef",
    );
    expect(homeClientEffectsSource).toContain("lastCoordinateRequestKeyRef");
    expect(homeClientEffectsSource).toContain("pendingAnnouncementRequestRef");
    expect(homeClientEffectsSource).toContain(
      "pendingRestaurantDeepLinkRequestRef",
    );
    expect(homeClientEffectsSource).toContain("pendingCoordinateRequestRef");
    expect(homeClientEffectsSource).toContain("setSelectedAnnouncement(null)");
    expect(homeClientEffectsSource).toContain(
      "setSelectedAnnouncement(announcement ?? null)",
    );
    expect(homeDesktopControlPanelSource).toContain(
      "const shouldShowDesktopSearchResults =",
    );
    expect(homeDesktopControlPanelSource).toContain("const hasDesktopSearchIntent =");
    expect(homeDesktopControlPanelSource).toContain("!isPanelOpen &&");
    expect(homeClientEffectsSource).not.toContain(
      "MOBILE_RESTAURANT_DEEP_LINK_IDLE_DELAY_MS",
    );
    expect(homeClientEffectsSource).not.toContain(
      "MOBILE_RESTAURANT_DEEP_LINK_ACTIVATION_EVENTS",
    );
    expect(homeClientEffectsSource).not.toContain(
      "function isEmbeddedHomeRuntime()",
    );
    expect(homeClientEffectsSource).toContain(
      "runRestaurantDeepLinkResolution(() =>",
    );
    expect(homeClientEffectsSource).toContain("let isCancelled = false");
    expect(homeClientEffectsSource).toContain(
      "const clearRegisteredRequestKeys = () =>",
    );
    expect(homeClientEffectsSource).toContain("clearRegisteredRequestKeys();");
    expect(homeClientEffectsSource).toContain("window.clearTimeout(timer)");
    expect(homeClientEffectsSource).not.toContain(
      "type HomeState = ReturnType<typeof useHomeState>",
    );
    expect(homeClientEffectsSource).not.toContain(
      "state.clearRestaurantDetailSelection()",
    );
    expect(headerSource).toContain("useBannerAnnouncements();");
    expect(headerSource).toContain("loadAnnouncementPanel");
    expect(headerSource).toContain("HeaderAnnouncementPanel");
    expect(headerSource).toContain('adminActionsMode="inline"');
    expect(headerSource).not.toContain(
      "useActiveAnnouncements(isAnnouncementSheetOpen);",
    );
    expect(headerSource).not.toContain(
      "const activeAnnouncements = activeAnnouncementsData ?? bannerAnnouncements;",
    );
    expect(bannerAnnouncementsHookSource).toContain("fetchSupabaseRows");
    expect(bannerAnnouncementsHookSource).toContain(
      "export function useBannerAnnouncements(enabled = true)",
    );
    expect(bannerAnnouncementsHookSource).toContain(
      "['show_on_banner', 'eq.true']",
    );
    expect(bannerAnnouncementsHookSource).toContain(
      "BANNER_ANNOUNCEMENTS_STALE_TIME_MS",
    );
    expect(bannerAnnouncementsHookSource).not.toContain(
      "@/hooks/use-announcements",
    );
    expect(restaurantSearchSource).toContain(
      "enabled: isFocused || isInlineView",
    );
    expect(homeControlPanelSource).toContain(
      "const loadHomeDesktopControlPanel = async () =>",
    );
    expect(homeControlPanelSource).toContain(
      "import('@/components/home/home-desktop-control-panel')",
    );
    expect(homeControlPanelSource).toContain(
      "const loadMobileControlOverlay = async () =>",
    );
    expect(homeControlPanelSource).toContain(
      "import('@/components/home/MobileControlOverlay')",
    );
    expect(homeControlPanelSource).not.toContain(
      "function MobileControlOverlayLoadingShell",
    );
    expect(homeControlPanelSource).toContain(
      "type MobileControlOverlayIntent = 'search' | 'bookmark' | 'notification' | 'user'",
    );
    expect(homeControlPanelSource).toContain("pendingMobileOverlayIntent");
    expect(homeControlPanelSource).not.toContain(
      "onClick={() => onActivate('search')}",
    );
    expect(homeControlPanelSource).not.toContain(
      "onClick={() => onActivate('bookmark')}",
    );
    expect(homeControlPanelSource).not.toContain(
      "onClick={() => onActivate('notification')}",
    );
    expect(homeControlPanelSource).not.toContain(
      "onClick={() => onActivate('user')}",
    );
    expect(homeControlPanelSource).toContain(
      "Boolean(initialIntent) || (typeof window !== 'undefined' && window.innerWidth <= BREAKPOINTS.tabletMax)",
    );
    expect(homeControlPanelSource).toContain(
      "setPendingMobileOverlayIntent(initialIntent)",
    );
    expect(homeControlPanelSource).toContain(
      "initialIntent={pendingMobileOverlayIntent}",
    );
    expect(homeControlPanelSource).toContain("initialIntent={initialIntent}");
    expect(homeControlPanelSource).not.toContain(
      "MOBILE_CONTROL_OVERLAY_IDLE_DELAY_MS",
    );
    expect(homeControlPanelSource).toContain(
      "useDeferredComponent<MobileControlOverlayProps>",
    );
    expect(homeControlPanelSource).toContain(
      "shouldRenderMobile && shouldLoadMobileOverlay",
    );
    expect(homeControlPanelSource).not.toContain(
      "window.addEventListener('pointerdown', requestMobileOverlay",
    );
    expect(homeControlPanelSource).not.toContain(
      "window.addEventListener('touchstart', requestMobileOverlay",
    );
    expect(homeControlPanelSource).toContain("return null;");
    expect(homeControlPanelSource).toContain("shouldLoadDesktopPanel");
    expect(homeControlPanelSource).not.toContain(
      "function DesktopControlPanelLoadingShell()",
    );
    expect(homeControlPanelSource).toContain(
      "setShouldLoadDesktopPanel(window.innerWidth > BREAKPOINTS.tabletMax)",
    );
    expect(homeControlPanelSource).toContain("window.requestAnimationFrame");
    expect(homeControlPanelSource).not.toContain(
      "return <DesktopControlPanelLoadingShell />;",
    );
    expect(homeControlPanelSource).not.toContain(
      "import MobileControlOverlay from '@/components/home/MobileControlOverlay'",
    );
    expect(homeControlPanelSource).not.toContain("useOverseasCountryCounts");
    expect(homeControlPanelSource).not.toContain(
      "const HomeDesktopControlPanel = lazy(",
    );
    expect(homeControlPanelSource).not.toContain(
      "components/search/RestaurantSearch",
    );
    expect(homeControlPanelSource).not.toContain(
      "components/region/RegionSelector",
    );
    expect(homeControlPanelSource).not.toContain(
      "components/filters/CategoryFilter",
    );
    expect(homeDesktopControlPanelSource).toContain(
      "const loadDesktopRestaurantSearch = async () =>",
    );
    expect(homeDesktopControlPanelSource).toContain(
      'import("@/components/search/RestaurantSearch")',
    );
    expect(homeDesktopControlPanelSource).not.toContain(
      "DesktopRestaurantSearchLoadingShell",
    );
    expect(homeDesktopControlPanelSource).toContain(
      "useDeferredComponent<RestaurantSearchComponentProps>",
    );
    expect(homeDesktopControlPanelSource).toContain(
      'import DesktopLeftPanelMapHome from "@/components/home/DesktopLeftPanelMapHome";',
    );
    expect(homeDesktopControlPanelSource).not.toContain(
      "const loadDesktopLeftPanelMapHome = async () =>",
    );
    expect(homeDesktopControlPanelSource).not.toContain(
      'import("@/components/home/DesktopLeftPanelMapHome")',
    );
    expect(homeDesktopControlPanelSource).not.toContain(
      "useDeferredComponent<DesktopLeftPanelMapHomeComponentProps>",
    );
    expect(homeDesktopControlPanelSource).toContain(
      "shouldShowDesktopSearchResults",
    );
    expect(homeDesktopControlPanelSource).toContain("shouldShowDesktopMapHome");
    expect(homeDesktopControlPanelSource).toContain(
      'activeLeftPanelView === "map" &&\n    hasDesktopSearchIntent',
    );
    expect(homeDesktopControlPanelSource).toContain("<DesktopLeftPanelMapHome");
    expect(homeDesktopControlPanelSource).not.toContain(
      "<DeferredDesktopLeftPanelMapHome",
    );
    expect(homeDesktopControlPanelSource).not.toContain(
      '<DesktopLeftPanelLoadingState label="홈 추천" />',
    );
    expect(homeDesktopControlPanelSource).not.toContain(
      'source: "desktop-left-panel-home-feed"',
    );
    expect(homeDesktopControlPanelSource).toContain("selectedRegion={");
    expect(homeDesktopControlPanelSource).toContain(
      'isKoreanOnly={mapMode === "domestic"}',
    );
    expect(homeDesktopControlPanelSource).toContain(
      "setIsDesktopSearchActive(false);",
    );
    expect(desktopLeftPanelMapHomeSource).toContain(
      'data-desktop-left-panel-map-home="true"',
    );
    expect(desktopLeftPanelMapHomeSource).toContain(
      'data-desktop-left-panel-popular-restaurants="true"',
    );
    expect(desktopLeftPanelMapHomeSource).toContain(
      'data-desktop-left-panel-home-scroll="true"',
    );
    expect(desktopLeftPanelMapHomeSource).toContain(
      'className="h-full overflow-y-auto pb-4"',
    );
    expect(desktopLeftPanelMapHomeSource).not.toContain(
      'className="min-h-0 flex-1 overflow-y-auto px-3 pb-4 pt-1"',
    );
    expect(desktopLeftPanelMapHomeSource).not.toContain(
      'className="shrink-0 bg-background px-3 pb-2 pt-3"',
    );
    expect(desktopLeftPanelMapHomeSource).toContain(
      "POPULAR_RESTAURANT_LIMIT = 5",
    );
    expect(desktopLeftPanelMapHomeSource).toContain(
      "POPULAR_RESTAURANT_QUERY_LIMIT = 60",
    );
    expect(desktopLeftPanelMapHomeSource).toContain("맛집 5곳");
    expect(desktopLeftPanelMapHomeSource).toContain("TOP 5");
    expect(desktopLeftPanelMapHomeSource).toContain("fetchPopularRestaurants");
    expect(desktopLeftPanelMapHomeSource).toContain("fetchLatestRestaurantPage");
    expect(desktopLeftPanelMapHomeSource).toContain(
      "getPopularRestaurantsQueryKey",
    );
    expect(desktopLeftPanelMapHomeSource).toContain(
      "getLatestRestaurantsQueryKey",
    );
    expect(homeDesktopControlPanelSource).toContain(
      "onRestaurantSearch(optimisticRestaurant);",
    );
    expect(homeDesktopControlPanelSource).not.toContain(
      "onRestaurantSelect(optimisticRestaurant);",
    );
    expect(desktopLeftPanelMapHomeSource).toContain(
      "desktopLeftPanelHomePopularQueryKey",
    );
    expect(desktopLeftPanelMapHomeSource).toContain(
      "desktopLeftPanelHomeLatestQueryKey",
    );
    expect(desktopLeftPanelMapHomeSource).toContain(
      "LATEST_RESTAURANT_INITIAL_RENDER_COUNT = 3",
    );
    expect(desktopLeftPanelMapHomeSource).toContain(
      'data-desktop-left-panel-popular-skeleton="true"',
    );
    expect(desktopLeftPanelMapHomeSource).toContain(
      'className="divide-y divide-border/70"',
    );
    expect(desktopLeftPanelMapHomeSource).toContain(
      'data-desktop-left-panel-latest-skeleton="true"',
    );
    expect(desktopLeftPanelMapHomeSource).toContain(
      "Array.from({ length: POPULAR_RESTAURANT_LIMIT }",
    );
    expect(desktopLeftPanelMapHomeSource).toContain(
      "LATEST_RESTAURANT_INITIAL_RENDER_COUNT",
    );
    expect(desktopLeftPanelMapHomeSource).toContain("useInfiniteQuery");
    expect(desktopLeftPanelMapHomeSource).toContain(
      'data-desktop-left-panel-latest-load-more="true"',
    );
    expect(desktopLeftPanelMapHomeSource).toContain(
      "latestRestaurantSortOptions",
    );
    expect(desktopLeftPanelMapHomeSource).toContain(
      "useState<LatestRestaurantSort>('latest')",
    );
    expect(desktopLeftPanelMapHomeSource).toContain(
      "sort: latestRestaurantSort",
    );
    expect(desktopLeftPanelMapHomeSource).toContain("selectedRegion");
    expect(desktopLeftPanelMapHomeSource).toContain("isKoreanOnly");
    expect(popularRestaurantsSource).toContain("POPULAR_RESTAURANTS_QUERY_KEY");
    expect(popularRestaurantsSource).toContain("LATEST_RESTAURANTS_QUERY_KEY");
    expect(popularRestaurantsSource).toContain(
      "POPULAR_RANK_SNAPSHOTS_QUERY_KEY",
    );
    expect(popularRestaurantsSource).toContain("export type PopularRankTrend");
    expect(popularRestaurantsSource).toContain(
      "export type PopularRestaurantWithTrend",
    );
    expect(popularRestaurantsSource).toContain("getPopularRankScopeKey");
    expect(popularRestaurantsSource).toContain("fetchPopularRankSnapshots");
    expect(popularRestaurantsSource).toContain(
      "restaurant_popular_rank_snapshots",
    );
    expect(popularRestaurantsSource).toContain("attachPopularRankTrends");
    expect(popularRestaurantsSource).toContain("hasSnapshotPeriod");
    expect(popularRestaurantsSource).toContain(
      "console.warn('인기 맛집 순위 스냅샷 조회 실패:');",
    );
    expect(popularRestaurantsSource).not.toContain("스냅샷 조회 실패:', error");
    expect(popularRestaurantsSource).toContain("? 'unknown'");
    expect(popularRestaurantsSource).toContain(
      "POPULAR_RANK_SNAPSHOTS_QUERY_KEY",
    );
    expect(popularRestaurantsSource).toContain("export type PopularRankTrend");
    expect(popularRestaurantsSource).toContain(
      "export type PopularRestaurantWithTrend",
    );
    expect(popularRestaurantsSource).toContain("getPopularRankScopeKey");
    expect(popularRestaurantsSource).toContain("fetchPopularRankSnapshots");
    expect(popularRestaurantsSource).toContain(
      "restaurant_popular_rank_snapshots",
    );
    expect(popularRestaurantsSource).toContain("attachPopularRankTrends");
    expect(popularRestaurantsSource).toContain("hasSnapshotPeriod");
    expect(popularRestaurantsSource).toContain(
      "console.warn('인기 맛집 순위 스냅샷 조회 실패:');",
    );
    expect(popularRestaurantsSource).toContain("? 'unknown'");
    expect(popularRestaurantsSource).toContain(
      "export type LatestRestaurantSort = 'latest' | 'oldest' | 'popular'",
    );
    expect(popularRestaurantsSource).toContain("KOREAN_RESTAURANT_REGIONS");
    expect(popularRestaurantsSource).toContain(
      "getRestaurantRegionAddressKeywords",
    );
    expect(popularRestaurantsSource).toContain(
      "buildRestaurantRegionAddressOrFilter",
    );
    expect(popularRestaurantsSource).toContain(
      "applyRestaurantRegionAddressFilter",
    );
    expect(popularRestaurantsSource).toContain("const isApprovedRestaurant");
    expect(popularRestaurantsSource).toContain(
      "restaurant.status === 'approved'",
    );
    expect(popularRestaurantsSource).toContain(".filter(isApprovedRestaurant)");
    expect(popularRestaurantsSource).toContain(".gt('weekly_search_count', 0)");
    expect(popularRestaurantsSource).toContain(
      ".order('created_at', { ascending: false })",
    );
    expect(popularRestaurantsSource).toContain(
      ".order('weekly_search_count', { ascending: false })",
    );
    expect(popularRestaurantsSource).toContain(
      "sort === 'oldest' ? aTime - bTime : bTime - aTime",
    );
    expect(popularRestaurantsSource).toContain("reasoning_basis");
    expect(popularRestaurantsSource).toContain("selectedRegion");
    expect(popularRestaurantsSource).toContain("isKoreanOnly");
    expect(popularRestaurantsSource).toContain(".slice(0, limit)");
    expect(restaurantSearchSource).toContain("fetchPopularRestaurants");
    expect(restaurantSearchSource).toContain("getPopularRestaurantsQueryKey");
    expect(
      desktopLeftPanelMapHomeSource.indexOf(
        'data-desktop-left-panel-popular-restaurants="true"',
      ),
    ).toBeLessThan(
      desktopLeftPanelMapHomeSource.indexOf(
        'data-desktop-left-panel-latest-restaurants="true"',
      ),
    );
    expect(desktopLeftPanelMapHomeSource).toContain(
      'data-desktop-left-panel-latest-restaurants="true"',
    );
    expect(desktopLeftPanelMapHomeSource).toContain(
      '<Clock className="h-4 w-4 text-primary"',
    );
    expect(desktopLeftPanelMapHomeSource).toContain("최근 추가된 맛집");
    expect(desktopLeftPanelMapHomeSource).toContain(
      "먼저 3곳을 보여주고 스크롤하면 이어서 불러와요",
    );
    expect(desktopLeftPanelMapHomeSource).toContain("<Select");
    expect(desktopLeftPanelMapHomeSource).toContain("<SelectTrigger");
    expect(desktopLeftPanelMapHomeSource).toContain(
      'aria-label="최근 맛집 정렬"',
    );
    expect(desktopLeftPanelMapHomeSource).toContain(
      '<SelectValue placeholder="정렬" />',
    );
    expect(desktopLeftPanelMapHomeSource).toContain("<SelectItem");
    expect(desktopLeftPanelMapHomeSource).toContain("최신순");
    expect(desktopLeftPanelMapHomeSource).toContain("오래된순");
    expect(desktopLeftPanelMapHomeSource).toContain("인기순");
    expect(desktopLeftPanelMapHomeSource).not.toContain(
      "aria-pressed={isSelected}",
    );
    expect(desktopLeftPanelMapHomeSource).toContain("grid grid-cols-1 gap-3");
    expect(desktopLeftPanelMapHomeSource).toContain(
      "function DesktopRestaurantCardSkeleton",
    );
    expect(desktopLeftPanelMapHomeSource).toContain(
      "function getPopularRankTrendBadge",
    );
    expect(desktopLeftPanelMapHomeSource).toContain(
      "trend.trend === 'unknown'",
    );
    expect(desktopLeftPanelMapHomeSource).toContain("trend.trend === 'same'");
    expect(desktopLeftPanelMapHomeSource).toContain(
      "이전 인기 검색 스냅샷 대비",
    );
    expect(desktopLeftPanelMapHomeSource).toContain("trendBadge.label");
    expect(desktopLeftPanelMapHomeSource).toContain(
      "divide-y divide-border/70",
    );
    expect(desktopLeftPanelMapHomeSource).toContain(
      "group flex w-full items-center gap-2 px-1 py-2 text-left",
    );
    expect(desktopLeftPanelMapHomeSource).toContain(
      '<MapPin className="h-3 w-3 shrink-0"',
    );
    expect(desktopLeftPanelMapHomeSource).not.toContain(
      "popularThumbnailIndexes",
    );
    expect(desktopLeftPanelMapHomeSource).not.toContain(
      "handlePopularThumbnailChange",
    );
    expect(desktopLeftPanelMapHomeSource).not.toContain(
      "absolute left-2 top-2 z-20",
    );
    expect(desktopLeftPanelMapHomeSource).not.toContain(
      "<DesktopRestaurantCardSkeleton key={index} withRank />",
    );
    expect(desktopLeftPanelMapHomeSource).toContain(
      "<DesktopRestaurantCardSkeleton key={index} />",
    );
    expect(desktopLeftPanelMapHomeSource).toContain("<StampCard");
    expect(desktopLeftPanelMapHomeSource).toContain('size="default"');
    expect(desktopLeftPanelMapHomeSource).toContain('stampSize="compact"');
    expect(desktopLeftPanelMapHomeSource).toContain("showAddress");
    expect(desktopLeftPanelMapHomeSource).toContain('categoryFallback="맛집"');
    expect(stampCardSource).toContain("showAddress?: boolean");
    expect(stampCardSource).toContain("categoryFallback?: string");
    expect(stampCardSource).toContain("const displayAddress");
    expect(stampCardSource).toContain("const inferRestaurantCategory");
    expect(stampCardSource).toContain("RESTAURANT_CATEGORIES.find");
    expect(stampCardSource).toContain("categoryFallback ?? null");
    expect(stampCardSource).toContain("restaurant.reasoning_basis");
    expect(stampCardSource).toContain(
      "readYoutubeMetaTitle(restaurant.youtube_meta)",
    );
    expect(popularRankSnapshotsMigrationSource).toContain(
      "create table if not exists public.restaurant_popular_rank_snapshots",
    );
    expect(popularRankSnapshotsMigrationSource).toContain(
      "alter table public.restaurant_popular_rank_snapshots enable row level security",
    );
    expect(popularRankSnapshotsMigrationSource).toContain(
      "grant select on table public.restaurant_popular_rank_snapshots to anon",
    );
    expect(popularRankSnapshotsMigrationSource).toContain(
      "grant select on table public.restaurant_popular_rank_snapshots to authenticated",
    );
    expect(popularRankSnapshotsMigrationSource).toContain(
      "create schema if not exists private",
    );
    expect(popularRankSnapshotsMigrationSource).toContain(
      "create or replace function private.capture_restaurant_popular_rank_snapshot",
    );
    expect(popularRankSnapshotsMigrationSource).toContain("security definer");
    expect(popularRankSnapshotsMigrationSource).not.toContain(
      "function public.capture_restaurant_popular_rank_snapshot",
    );
    expect(popularRankSnapshotsMigrationSource).toContain(
      "grant execute on function private.capture_restaurant_popular_rank_snapshot",
    );
    expect(stampCardSource).toContain("flex items-center gap-2 min-w-0");
    expect(stampCardSource).toContain('"font-medium truncate"');
    expect(stampCardSource).toContain("{showAddress && displayAddress && (");
    expect(desktopLeftPanelMapHomeSource).not.toContain(
      "사용자 맛집 리뷰</h2>",
    );
    expect(desktopLeftPanelMapHomeSource).not.toContain(
      "아래로 스크롤해 계속 보기",
    );
    expect(desktopLeftPanelMapHomeSource).not.toContain(
      "rounded-2xl border border-border bg-card px-3 py-2 text-left",
    );
    expect(desktopLeftPanelMapHomeSource).not.toContain(
      'data-desktop-left-panel-review-feed="true"',
    );
    expect(desktopLeftPanelMapHomeSource).not.toContain("shouldLoadReviewFeed");
    expect(desktopLeftPanelMapHomeSource).not.toContain("requestReviewFeed");
    expect(desktopLeftPanelMapHomeSource).not.toContain(
      "사용자 맛집 리뷰 불러오기",
    );
    expect(desktopLeftPanelMapHomeSource).not.toContain("FeedContent");
    expect(desktopLeftPanelMapHomeSource).not.toContain("hideReviewModal");
    expect(homeDesktopControlPanelSource).toContain(
      'activeLeftPanelView === "map"',
    );
    expect(homeDesktopControlPanelSource).toContain("!isPanelOpen");
    expect(homeDesktopControlPanelSource).toContain("hasDesktopSearchIntent");
    expect(homeDesktopControlPanelSource).not.toContain(
      'activeLeftPanelView === "map" && isDesktopSearchActive',
    );
    expect(homeDesktopControlPanelSource).toContain(
      'document.addEventListener("pointerdown", handlePointerDown)',
    );
    expect(homeDesktopControlPanelSource).not.toContain(
      'document.addEventListener("mousedown", handlePointerDown)',
    );
    expect(source("components/search/RestaurantSearch.tsx")).toContain(
      "hideHistoryAndPopular?: boolean",
    );
    expect(source("components/search/RestaurantSearch.tsx")).toContain(
      "!hideHistoryAndPopular &&",
    );
    expect(homeDesktopControlPanelSource).not.toContain(
      'import RestaurantSearch from "@/components/search/RestaurantSearch"',
    );
    expect(homeDesktopControlPanelSource).toContain(
      "components/region/RegionSelector",
    );
    expect(homeDesktopControlPanelSource).toContain(
      "components/filters/CategoryFilter",
    );
    expect(homeDesktopControlPanelSource).toContain(
      "useOverseasCountryCounts(mapMode)",
    );
    expect(homeDesktopControlPanelSource).toContain(
      'data-desktop-left-map-panel="true"',
    );
    expect(homeDesktopControlPanelSource).toContain(
      "desktop-left-panel-scrollbarless",
    );
    expect(homeAppGlobalsSource).toContain(
      ".desktop-left-panel-scrollbarless,",
    );
    expect(homeAppGlobalsSource).toContain(
      ".desktop-left-panel-scrollbarless :where(",
    );
    expect(homeAppGlobalsSource).toContain('[class*="overflow-y-auto"]');
    expect(homeAppGlobalsSource).toContain('[class*="overflow-x-auto"]');
    expect(homeAppGlobalsSource).toContain(
      "-ms-overflow-style: none !important",
    );
    expect(homeAppGlobalsSource).toContain("scrollbar-width: none !important");
    expect(homeAppGlobalsSource).toContain(")::-webkit-scrollbar");
    expect(homeAppGlobalsSource).toContain("display: none !important");
    expect(homeAppGlobalsSource).toContain("width: 0 !important");
    expect(homeAppGlobalsSource).toContain("height: 0 !important");
    expect(homeDesktopControlPanelSource).toContain(
      'import Image from "next/image"',
    );
    expect(homeDesktopControlPanelSource).toContain(
      'data-desktop-left-panel-search-bar="true"',
    );
    expect(homeDesktopControlPanelSource).toContain(
      'data-desktop-left-panel-search-results="true"',
    );
    expect(homeDesktopControlPanelSource).toContain(
      'data-desktop-left-panel-search-home="true"',
    );
    expect(homeDesktopControlPanelSource).toContain(
      "rounded-full border border-border bg-background/95",
    );
    expect(homeDesktopControlPanelSource).toContain(
      "pointer-events-auto flex items-center gap-1.5 min-h-11 rounded-full shadow-lg bg-background/95 backdrop-blur-sm border border-border px-1.5",
    );
    expect(homeDesktopControlPanelSource).toContain(
      "flex-1 h-9 rounded-full flex items-center gap-2 px-2 bg-secondary/40 min-w-0",
    );
    expect(homeDesktopControlPanelSource).toContain(
      "h-9 w-9 shrink-0 rounded-full border border-border bg-background hover:bg-secondary/80 focus-visible:ring-2 focus-visible:ring-primary touch-manipulation",
    );
    expect(homeDesktopControlPanelSource).not.toContain(
      'aria-label="검색어 지우기"',
    );
    expect(homeDesktopControlPanelSource).toContain('aria-label="검색 닫기"');
    expect(homeDesktopControlPanelSource).toContain(
      "const hasDesktopSearchQuery = desktopSearchQuery.trim().length > 0",
    );
    expect(homeDesktopControlPanelSource).toContain("{hasDesktopSearchQuery ? (");
    expect(homeDesktopControlPanelSource).toContain('aria-label="지도 메뉴 열기"');
    expect(homeDesktopControlPanelSource).toContain(
      'data-desktop-map-menu-trigger="true"',
    );
    expect(homeDesktopControlPanelSource).toContain(
      'data-desktop-map-menu="true"',
    );
    expect(homeDesktopControlPanelSource).toContain(
      "const desktopMapMenuItemClass =",
    );
    expect(homeDesktopControlPanelSource).toContain(
      "z-[180] w-max min-w-[max-content] max-w-[min(24rem,calc(100vw-2rem))] rounded-2xl border-border bg-card p-1.5 font-sans shadow-2xl",
    );
    expect(homeDesktopControlPanelSource).not.toContain(
      "z-[180] w-44 rounded-2xl border-border bg-card p-1.5 font-sans shadow-2xl",
    );
    expect(homeDesktopControlPanelSource).not.toContain(
      "DropdownMenuLabel",
    );
    expect(homeDesktopControlPanelSource).not.toContain(
      ">지도 메뉴<",
    );
    expect(homeDesktopControlPanelSource).not.toContain(
      "max-w-[min(22rem,calc(100vw-4rem))] rounded-xl px-3 py-2 text-foreground",
    );
    expect(homeDesktopControlPanelSource).toContain(
      "cursor-pointer rounded-xl px-3 py-2.5 text-sm font-medium text-foreground whitespace-nowrap focus:bg-accent focus:text-foreground",
    );
    expect(homeDesktopControlPanelSource).toContain(
      '<Menu className="h-5 w-5" aria-hidden="true" />',
    );
    expect(homeDesktopControlPanelSource).toContain('alt="로고"');
    expect(homeDesktopControlPanelSource).toContain("width={24}");
    expect(homeDesktopControlPanelSource).toContain("height={24}");
    expect(homeDesktopControlPanelSource).toContain(
      "text-sm text-foreground outline-none placeholder:text-foreground/70",
    );
    expect(homeDesktopControlPanelSource).toContain("bg-secondary/40");
    expect(homeDesktopControlPanelSource).toContain("hideSearchControls");
    expect(homeDesktopControlPanelSource).toContain(
      'className="h-full min-h-0 px-0 py-0"',
    );
    expect(homeDesktopControlPanelSource).toContain("maxItems={12}");
    expect(homeDesktopControlPanelSource).toContain("popularMaxItems={10}");
    expect(homeDesktopControlPanelSource).toContain("captureDetailReturnView");
    expect(homeDesktopControlPanelSource).toContain("handleDetailPanelClose");
    expect(homeDesktopControlPanelSource).toContain("DesktopDetailReturnState");
    expect(homeDesktopControlPanelSource).toContain("detailReturnStateRef");
    expect(homeDesktopControlPanelSource).toContain(
      "pendingDetailReturnCaptureRef",
    );
    expect(homeDesktopControlPanelSource).toContain(
      "pendingDetailOpen?: boolean",
    );
    expect(homeDesktopControlPanelSource).toContain(
      "!pendingDetailReturnCaptureRef.current",
    );
    expect(homeDesktopControlPanelSource).toContain(
      "captureDetailReturnView(activeLeftPanelViewRef.current, {",
    );
    expect(homeDesktopControlPanelSource).toContain(
      "if (pendingDetailReturnCaptureRef.current) return;",
    );
    expect(homeDesktopControlPanelSource).toContain(
      'captureDetailReturnView("map", { pendingDetailOpen: true })',
    );
    expect(homeDesktopControlPanelSource).toContain(
      "setDesktopSearchQuery(returnState.searchQuery)",
    );
    expect(homeDesktopControlPanelSource).toContain(
      "setDesktopSearchType(returnState.searchType)",
    );
    expect(homeDesktopControlPanelSource).toContain(
      "setIsDesktopSearchActive(returnState.isSearchActive)",
    );
    expect(homeDesktopControlPanelSource).toContain(
      "HOME_DESKTOP_DETAIL_RETURN_CAPTURE_EVENT",
    );
    expect(homeDesktopControlPanelSource).toContain(
      "handleExternalDetailReturnCapture",
    );
    expect(homeClientSource).toContain("requestDesktopDetailReturnCapture();");
    expect(homeClientSource).toContain("returnToRestaurantListPanel");
    expect(homeClientSource).toContain("closeRestaurantDetailPanel");
    expect(homeDesktopControlPanelSource).toContain(
      "const returnRoute = getDesktopLeftPanelRoute(",
    );
    expect(homeDesktopControlPanelSource).toContain(
      "(onDetailPanelBack ?? onPanelClose)?.()",
    );
    expect(homeDesktopControlPanelSource).toContain(
      "router.replace(returnRoute, { scroll: false })",
    );
    expect(homeDesktopControlPanelSource).toContain(
      "replaceBrowserHistoryRoute(returnRoute)",
    );
    expect(homeDesktopControlPanelSource).toContain(
      'replaceBrowserHistoryRoute("/")',
    );
    expect(homeDesktopControlPanelSource).toContain(
      "onClose={handleDetailPanelClose}",
    );
    expect(homeDesktopControlPanelSource).toContain(
      "onClose={handleReturnToMapPanel}",
    );
    expect(homeDesktopControlPanelSource).toContain("showBackButton");
    expect(homeDesktopControlPanelSource).toContain("edgeToEdgeInlineLayout");
    expect(homeDesktopControlPanelSource).toContain(
      "searchQueryValue={desktopSearchQuery}",
    );
    expect(homeDesktopControlPanelSource).toContain(
      'data-desktop-map-mode-toggle="true"',
    );
    expect(homeDesktopControlPanelSource).toContain(
      'className="fixed right-4 top-4 z-[70] min-w-0"',
    );
    expect(homeDesktopControlPanelSource).toContain(
      'data-desktop-map-theme-filters="true"',
    );
    expect(homeDesktopControlPanelSource).toContain(
      "const desktopMapFloatingControlStyle = {",
    );
    expect(homeDesktopControlPanelSource).toContain(
      'data-desktop-map-floating-filters="true"',
    );
    expect(homeDesktopControlPanelSource).toContain(
      "grid auto-rows-auto grid-cols-[max-content] items-start gap-2",
    );
    expect(homeDesktopControlPanelSource).toContain(
      "const DESKTOP_MAP_FLOATING_FILTER_WIDTH = \"10.9375rem\"",
    );
    expect(homeDesktopControlPanelSource).toContain(
      '"--desktop-map-floating-filter-width": DESKTOP_MAP_FLOATING_FILTER_WIDTH',
    );
    expect(homeDesktopControlPanelSource).toContain(
      "flex w-[var(--desktop-map-floating-filter-width)] items-center gap-0.5 rounded-full",
    );
    expect(homeDesktopControlPanelSource).toContain("HOME_MAP_THEME_FILTERS.map");
    expect(homeDesktopControlPanelSource).toContain("<span>{theme.label}</span>");
    expect(homeDesktopControlPanelSource).not.toContain("theme.shortLabel");
    expect(homeDesktopControlPanelSource).toContain("!w-full !min-w-max");
    expect(homeDesktopControlPanelSource).toContain("국내 맛집 지도 보기");
    expect(homeDesktopControlPanelSource).toContain("해외 맛집 지도 보기");
    expect(homeDesktopControlPanelSource).toContain("쯔동여지도 검색하기");
    expect(homeDesktopControlPanelSource).toContain("hideHistoryAndPopular");
    expect(homeDesktopControlPanelSource).not.toContain(
      "검색·필터·상세를 왼쪽에서 빠르게 확인하세요.",
    );
    expect(homeDesktopControlPanelSource).toContain(
      "fixed inset-y-0 z-[90] flex",
    );
    expect(homeDesktopControlPanelSource).toContain(
      'desktopPanelSide === "right" ? "right-0 border-l" : "left-0 border-r"',
    );
    expect(homeDesktopControlPanelSource).toContain(
      "data-desktop-panel-side={desktopPanelSide}",
    );
    expect(homeDesktopControlPanelSource).toContain(
      "motion-reduce:transition-none",
    );
    expect(homeDesktopControlPanelSource).toContain(
      "aria-pressed={preferences.desktopPanelSide === value}",
    );
    expect(homeDesktopControlPanelSource).toContain(
      "aria-pressed={preferences.desktopMapLayout === value}",
    );
    expect(homeDesktopControlPanelSource).toContain(
      "aria-pressed={preferences.desktopPanelDefault === value}",
    );

    expect(homeDesktopControlPanelSource).toContain(
      'data-panel-collapsed={isPanelCollapsed ? "true" : "false"}',
    );
    expect(homeDesktopControlPanelSource).toContain(
      'desktopPanelSide === "right"',
    );
    expect(homeDesktopControlPanelSource).toContain('"translate-x-full"');
    expect(homeDesktopControlPanelSource).toContain('"-translate-x-full"');
    expect(homeDesktopControlPanelSource).toContain(
      "const panelToggleLabel = isPanelCollapsed",
    );
    expect(homeDesktopControlPanelSource).toContain(
      'const panelSideLabel = desktopPanelSide === "right" ? "우측" : "좌측"',
    );
    expect(homeDesktopControlPanelSource).toContain(
      "`${panelSideLabel} 패널 펼치기`",
    );
    expect(homeDesktopControlPanelSource).toContain(
      "`${panelSideLabel} 패널 접기`",
    );
    expect(homeDesktopControlPanelSource).toContain(
      'aria-controls="desktop-left-map-panel"',
    );
    expect(homeDesktopControlPanelSource).toContain(
      "aria-expanded={!isPanelCollapsed}",
    );
    expect(homeDesktopControlPanelSource).toContain(
      "aria-hidden={isPanelCollapsed}",
    );
    expect(homeDesktopControlPanelSource).toContain("inert={isPanelCollapsed}");
    expect(homeDesktopControlPanelSource).toContain('event.key !== "Escape"');
    expect(homeDesktopControlPanelSource).toContain("flex h-12 w-6");
    expect(homeDesktopControlPanelSource).toContain("rounded-r-lg");
    expect(homeDesktopControlPanelSource).toContain("<ChevronLeft");
    expect(homeDesktopControlPanelSource).toContain("<ChevronRight");
    expect(homeDesktopControlPanelSource).toContain(
      'data-desktop-left-panel-announcement="true"',
    );
    expect(homeDesktopControlPanelSource).toContain(
      'initialRoutePanel === "announcement" && !isPublicRestrictedMode ? "announcement" : "map"',
    );
    expect(homeDesktopControlPanelSource).toContain(
      'panelParam !== "announcement"',
    );
    expect(homeDesktopControlPanelSource).toContain(
      "!isPublicRestrictedMode",
    );
    expect(source("app/home-client-effects.tsx")).toContain(
      "isPublicRestrictedMode && panelParam === 'announcement'",
    );
    expect(homeDesktopControlPanelSource).toContain(
      'activeLeftPanelView === "announcement" && !isPublicRestrictedMode',
    );
    expect(homeDesktopControlPanelSource).toContain("window.addEventListener(");
    expect(homeDesktopControlPanelSource).toContain('"openAnnouncementDetail"');
    expect(homeDesktopControlPanelSource).toContain(
      "revealAnnouncementLeftPanel",
    );
    expect(homeDesktopControlPanelSource).toContain(
      'router.push("/?panel=announcement", { scroll: false })',
    );
    expect(homeDesktopControlPanelSource).not.toContain(
      'router.replace("/?panel=announcement", { scroll: false })',
    );
    expect(homeDesktopControlPanelSource).toContain(
      'data-desktop-left-panel-admin-reviews="true"',
    );
    expect(homeDesktopControlPanelSource).not.toContain(
      'data-desktop-left-panel-loading="true"',
    );
    expect(homeDesktopControlPanelSource).not.toContain(
      'import { Skeleton } from "@/components/ui/skeleton"',
    );
    expect(homeDesktopControlPanelSource).not.toContain(
      "bg-muted animate-pulse",
    );
    expect(homeDesktopControlPanelSource).not.toContain(
      "aria-label={`${label} 패널 불러오는 중`}",
    );
    expect(homeDesktopControlPanelSource).toContain(
      "isInlinePanelViewActive ? null",
    );
    expect(homeDesktopControlPanelSource).toContain(
      "min-h-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-contain",
    );
    expect(desktopBookmarksSource).toContain(
      "min-h-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-contain",
    );
    expect(desktopNotificationsSource).toContain(
      "min-h-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-contain",
    );
    expect(desktopNotificationsSource).not.toContain("<Fragment");
    expect(homeDesktopControlPanelSource).not.toContain(
      "isInlineDetailOpenPending &&",
    );
    expect(homeDesktopControlPanelSource).not.toContain(
      "setIsInlineDetailOpenPending(true)",
    );
    expect(homeDesktopControlPanelSource).not.toContain(
      "isDetailPanelTransitionPending",
    );
    expect(homeDesktopControlPanelSource).not.toContain(
      '<DesktopLeftPanelLoadingState label="맛집 상세" />',
    );
    expect(homeDesktopControlPanelSource).toContain(
      "onRestaurantSelect(restaurant)",
    );
    expect(homeDesktopControlPanelSource).toContain("{!hasActiveDetail && (");
    expect(homeDesktopControlPanelSource).toContain(
      '{activeLeftPanelView === "feed" && DeferredFeedOverlay ? (',
    );
    expect(homeDesktopControlPanelSource).toContain(
      "onOpenReviewModal={onReviewModalOpen}",
    );
    expect(homeDesktopControlPanelSource).toContain(
      "hideReviewModal={Boolean(onReviewModalOpen)}",
    );
    expect(homeDesktopControlPanelSource).not.toContain(
      "hideFloatingButton\n              initialReviewId",
    );
    expect(homeDesktopControlPanelSource).not.toContain("다음 단계 후보");
    expect(homeDesktopControlPanelSource).not.toContain(
      "관리자 계정은 운영 화면 진입 시 사이드 패널 펼침 정책을 유지합니다.",
    );
    expect(homeDesktopControlPanelSource).toContain("loadAnnouncementPanel");
    expect(homeDesktopControlPanelSource).toContain("loadAdminReviewPanel");
    expect(homeDesktopControlPanelSource).toContain(
      "HydratedDetailRestaurant restaurant={panelRestaurant}",
    );
    expect(homeDesktopControlPanelSource).toContain("<RestaurantDetailPanel");
    expect(homeDesktopControlPanelSource).toContain("showDesktopBackButton");
    expect(source("components/restaurant/RestaurantDetailPanel.tsx")).toContain(
      "showDesktopBackButton?: boolean",
    );
    const restaurantDetailPanelSource = source(
      "components/restaurant/RestaurantDetailPanel.tsx",
    );
    expect(restaurantDetailPanelSource).toContain(
      'aria-label="이전 목록으로 돌아가기"',
    );
    expect(restaurantDetailPanelSource).toContain(
      "{isAdmin && onEditRestaurant && viewMode === 'detail' && (",
    );
    expect(restaurantDetailPanelSource).toContain(
      "{showDesktopBackButton && !isMobile && viewMode === 'detail' && (",
    );
    expect(
      restaurantDetailPanelSource.indexOf(
        '<Settings className="h-4 w-4" aria-hidden="true" />',
      ),
    ).toBeLessThan(
      restaurantDetailPanelSource.indexOf('aria-label="이전 목록으로 돌아가기"'),
    );
    expect(restaurantDetailPanelSource).not.toContain(
      'className="mr-1 h-9 w-9 shrink-0 rounded-full border border-border bg-background hover:bg-secondary/80"',
    );
    expect(restaurantDetailPanelSource).not.toContain("뒤로가기");
    expect(restaurantDetailPanelSource).toContain(
      'size="icon"',
    );
    expect(restaurantDetailPanelSource).not.toContain(
      'className="h-9 w-9 shrink-0 rounded-full"',
    );
    expect(restaurantDetailPanelSource).toContain(
      '<ArrowLeft className="h-4 w-4" aria-hidden="true" />',
    );
    expect(homeDesktopControlPanelSource).toContain('resultView="inline"');
    expect(homeDesktopControlPanelSource).toContain("hideSearchControls");
    expect(homeDesktopControlPanelSource).not.toContain(
      'data-desktop-map-floating-nav="true"',
    );
    expect(homeDesktopControlPanelSource).not.toContain(
      'className="fixed top-4 z-[70] flex flex-col items-start gap-2"',
    );
    expect(homeDesktopControlPanelSource).not.toContain(
      "DESKTOP_FLOATING_NAV_ROW_STARTS",
    );
    expect(homeDesktopControlPanelSource).not.toContain(
      "data-desktop-map-floating-nav-row={",
    );
    expect(homeDesktopControlPanelSource).not.toContain(
      'rowStart === 0 ? "account" : "content"',
    );
    expect(homeDesktopControlPanelSource).not.toContain(
      "DESKTOP_FLOATING_NAV_BUTTON_WIDTH",
    );
    expect(homeDesktopControlPanelSource).not.toContain(
      '"--desktop-floating-nav-button-width": DESKTOP_FLOATING_NAV_BUTTON_WIDTH',
    );
    expect(homeDesktopControlPanelSource).toContain(
      '!isPanelCollapsed && desktopPanelSide === "left"',
    );
    expect(homeDesktopControlPanelSource).toContain(': "1rem"');
    expect(homeDesktopControlPanelSource).toContain(
      "`calc(min(${DESKTOP_LEFT_PANEL_WIDTH_PX}px, calc(100vw - 32px)) + 1rem)`",
    );
    expect(homeDesktopControlPanelSource).not.toContain(
      "pointer-events-auto h-9 w-[var(--desktop-floating-nav-button-width)] shrink-0 justify-center rounded-full",
    );
    expect(homeDesktopControlPanelSource).toContain(
      "style={desktopMapFloatingControlStyle}",
    );
    expect(homeDesktopControlPanelSource).toContain(
      "const DESKTOP_MAP_MENU_ITEMS = [",
    );
    expect(homeDesktopControlPanelSource).toContain(
      "] as const satisfies ReadonlyArray<DesktopMapMenuItem>;",
    );
    expect(homeDesktopControlPanelSource).toContain(
      "const handleDesktopMapMenuItemSelect = useCallback",
    );
    expect(homeDesktopControlPanelSource).toContain('case "profile":');
    expect(homeDesktopControlPanelSource).toContain("handleAccountClick();");
    expect(homeDesktopControlPanelSource).toContain('case "bookmarks":');
    expect(homeDesktopControlPanelSource).toContain("handleBookmarkClick();");
    expect(homeDesktopControlPanelSource).toContain('case "notifications":');
    expect(homeDesktopControlPanelSource).toContain("handleNotificationClick();");
    expect(homeDesktopControlPanelSource).toContain("handleShortcutClick(id);");
    expect(homeDesktopControlPanelSource).toContain(
      "DESKTOP_MAP_MENU_ITEMS.map((item) =>",
    );
    expect(homeDesktopControlPanelSource).toContain(
      "onClick={() => handleDesktopMapMenuItemSelect(item.id)}",
    );
    expect(homeDesktopControlPanelSource).not.toContain(
      "const desktopMapMenuItems = useMemo",
    );
    expect(homeDesktopControlPanelSource).toContain(
      "The hamburger menu intentionally lives in the expanded desktop search slot.",
    );
    expect(homeDesktopControlPanelSource).toContain(
      "we do not add a second map-floating nav because the old map overlay buttons",
    );
    expect(homeDesktopControlPanelSource).not.toContain("지도 필터");
    expect(homeDesktopControlPanelSource).toContain(
      "const hasActiveDetail = isPanelOpen && Boolean(panelRestaurant)",
    );
    expect(homeDesktopControlPanelSource).toContain("{!hasActiveDetail && (");
    expect(homeDesktopControlPanelSource).not.toContain(
      "{!hasActiveDetail && !isDetailPanelTransitionPending && (",
    );
    expect(homeDesktopControlPanelSource).toContain("hasActiveDetail ||");
    expect(homeDesktopControlPanelSource).not.toContain(
      "isDetailPanelTransitionPending ||",
    );
    expect(homeDesktopControlPanelSource).toContain(
      "isInlinePanelViewActive ||",
    );
    expect(homeDesktopControlPanelSource).toContain(' ? "px-0 py-0"');
    expect(homeDesktopControlPanelSource).toContain(' : "px-4 py-4"');
    expect(homeDesktopControlPanelSource).toContain(
      'data-desktop-left-panel-detail-fill="true"',
    );
    expect(homeDesktopControlPanelSource).toContain(
      'data-desktop-left-panel-search-shell="true"',
    );
    expect(homeDesktopControlPanelSource).toContain(
      'className="rounded-none border-0 shadow-none"',
    );
    expect(homeDesktopControlPanelSource).toContain(
      "h-full min-h-0 overflow-hidden",
    );
    const homeMapContainerSource = source(
      "components/home/home-map-container.tsx",
    );
    expect(homeMapContainerSource).toContain(
      "desktopMapLayout?: HomeMapLayoutMode",
    );
    expect(homeMapContainerSource).toContain(
      "desktopPanelSide?: HomeMapPanelSide",
    );
    expect(homeMapContainerSource).toContain(
      "desktopMapLayout = 'panel-aware'",
    );
    expect(homeMapContainerSource).toContain(
      "desktopMapLayout === 'panel-aware'",
    );
    expect(homeMapContainerSource).toContain("motion-reduce:transition-none");
    expect(homeMapContainerSource).toContain(
      'data-home-map-reserved-left-panel={shouldReserveDesktopLeftPanel ? "true" : "false"}',
    );
    expect(homeMapContainerSource).toContain(
      'data-home-map-reserved-right-panel={shouldReserveDesktopRightPanel ? "true" : "false"}',
    );
    expect(homeMapContainerSource).toContain(
      "data-home-map-panel-side={desktopPanelSide}",
    );
    expect(homeMapContainerSource).toContain(
      "reservesDesktopLeftPanelSpace={shouldReserveDesktopSidePanel}",
    );
    expect(source("components/map/NaverMapView.tsx")).toContain(
      "usesExternalPanel: Boolean(onMarkerClick) && !reservesDesktopLeftPanelSpace",
    );
    expect(source("components/map/NaverMapView.tsx")).toContain(
      "reservesDesktopLeftPanelSpace,",
    );

    expect(homeDesktopControlPanelSource).not.toContain(
      "h-[calc(100vh-260px)] min-h-[560px]",
    );
    expect(homeDesktopControlPanelSource).not.toContain(
      "rounded-xl border border-border bg-background shadow-sm",
    );
    expect(homeDesktopControlPanelSource).not.toContain(
      "window.requestAnimationFrame",
    );
    expect(homeDesktopControlPanelSource).toContain("initialIntent");
    expect(homeDesktopControlPanelSource).toContain(
      'initialIntent !== "search"',
    );
    expect(homeDesktopControlPanelSource).not.toContain(
      "setShouldLoadSearch(true)",
    );
    expect(mobileControlSource).toContain("useOverseasCountryCounts(mapMode)");
    expect(mobileControlSource).toContain(
      "initialIntent?: 'search' | 'bookmark' | 'notification' | 'user' | null",
    );
    expect(mobileControlSource).toContain(
      "type MobileTopDropdown = 'bookmark' | 'notification' | 'user' | null",
    );
    expect(mobileControlSource).toContain(
      "const [openTopDropdown, setOpenTopDropdown] = useState<MobileTopDropdown>",
    );
    expect(mobileControlSource).toContain("setActiveSheet('search')");
    expect(mobileControlSource).toContain(
      "<DropdownMenu open={isBookmarkMenuOpen} onOpenChange={handleBookmarkMenuOpenChange}>",
    );
    expect(mobileControlSource).toContain(
      "<DropdownMenu open={isNotificationMenuOpen} onOpenChange={handleNotificationMenuOpenChange}>",
    );
    expect(mobileControlSource).toContain(
      "enabled: activeSheet === 'region' || activeSheet === 'category'",
    );
    expect(mobileControlSource).toContain('role="dialog"');
    expect(mobileControlSource).not.toContain("transition-all");
    expect(mobileControlSource).toContain('aria-modal="true"');
    expect(mobileControlSource).toContain(
      'aria-labelledby="mobile-map-search-title"',
    );
    expect(mobileControlSource).toContain("handleSearchLayerKeyDown");
    expect(mobileControlSource).toContain(
      "getFocusTrapContainers(searchLayerRef.current",
    );
    expect(mobileControlSource).toContain(
      "searchPreviouslyFocusedElementRef.current?.focus",
    );
    expect(mobileControlSource).toContain("inertSibling.inert = true");
    expect(mobileControlSource).toContain("aria-pressed={isSelected}");
    expect(mobileControlSource).toContain("aria-label={`${theme.ariaLabel}${isSelected ? ' 선택됨' : ''}`}");
    expect(mobileControlSource).toContain("카테고리 필터 열기");
    expect(mobileControlSource).toContain("min-h-11");
    expect(mobileControlSource).toContain('role="status"');
    expect(mobileControlSource).toContain("목록을 불러오는 중입니다");
    expect(mobileControlSource).toContain(
      "useDeferredComponent<MobileNotificationMenuButtonProps>",
    );
    expect(mobileControlSource).not.toContain("useNotifications()");
    expect(mobileControlSource).not.toContain(
      "formatDistanceToNow(notification.createdAt",
    );
    expect(mobileNotificationSource).toContain("useNotifications()");
    expect(mobileNotificationSource).toContain(
      "formatDistanceToNow(notification.createdAt",
    );
    expect(regionSelectorSource).toContain("enabled: true,");
    expect(regionSelectorSource).toContain("fetchSupabaseRows");
    expect(regionSelectorSource).not.toContain(
      "@/integrations/supabase/client",
    );
    expect(categoryFilterSource).toContain("enabled: true,");
    expect(categoryFilterSource).toContain("fetchSupabaseRows");
    expect(categoryFilterSource).toContain(
      "? ['restaurants-categories', selectedRegion, selectedCountry]",
    );
    expect(categoryFilterSource).toContain(": ['restaurants-count']");
    expect(categoryFilterSource).not.toContain(
      "@/integrations/supabase/client",
    );
    expect(mapQuerySource).toContain("includeVerifiedReviewCounts: false");
    expect(naverMapSource).toContain("autoLoad: false");
    expect(naverMapSource).toContain("strategy: 'afterInteractive'");
    expect(naverMapSource).not.toContain("strategy: 'lazyOnload'");
    expect(naverMapSource).toContain("buildHomeMapActivationPlan");
    expect(naverMapSource).toContain("isEmbeddedHomeRuntimeWindow");
    expect(naverMapSource).toContain("activationPlan.activateImmediately");
    expect(naverMapSource).not.toContain(
      "window.setTimeout(activateMapRuntime, activationPlan.delayMs)",
    );
    expect(naverMapSource).not.toContain("activationPlan.events.forEach");
    expect(source("app/home-map-runtime-activation.ts")).toContain(
      "export const HOME_MAP_AUTO_ACTIVATION_DELAY_MS = 0",
    );
    expect(source("app/home-map-runtime-activation.ts")).toContain(
      "activateImmediately: true",
    );
    expect(source("app/home-map-runtime-activation.ts")).toContain(
      "events: []",
    );
    expect(naverMapSource).not.toContain("{ timeout: 2000 }");
    expect(naverMapSource).toContain("NaverMapAnnouncementRuntime");
    expect(naverMapSource).not.toContain(
      'useBannerAnnouncements } from "@/hooks/use-banner-announcements"',
    );
    expect(naverMapSource).not.toContain(
      "useBannerAnnouncements(shouldRunNoncriticalMapEffects)",
    );
    expect(source("components/map/NaverMapAnnouncementRuntime.tsx")).toContain(
      "useBannerAnnouncements(true)",
    );
    expect(source("app/home-client.tsx")).toContain(
      'panel === "announcement"',
    );
    expect(source("components/home/home-desktop-control-panel.tsx")).toContain(
      "!isPublicRestrictedMode",
    );
    expect(source("app/home-client.tsx")).toContain("announcementId");
    expect(naverMapSource).toContain("!isPublicRestrictedMode");
    expect(naverMapSource).toContain("!isPublicRestrictedMode");
    expect(naverMapSource).toContain(
      "setShouldRunNoncriticalMapEffects((previous) => previous ? previous : true)",
    );
    expect(naverMapSource).toContain("activateNoncriticalMapEffects();");
    expect(naverMapSource).not.toContain(
      "NONCRITICAL_MAP_SIDE_EFFECT_DELAY_MS",
    );
    expect(naverMapSource).not.toContain(
      "setTimeout(activateNoncriticalMapEffects",
    );
    expect(naverMapSource).toContain("NaverMapPresenceRuntime");
    expect(naverMapSource).toContain("HydratedDetailRestaurant");
    expect(naverMapSource).not.toContain("useRestaurantWithMergeContext");
    expect(naverMapSource).not.toContain(
      "import('@/lib/naver-map-presence-client')",
    );
    expect(source("components/map/NaverMapPresenceRuntime.tsx")).toContain(
      "startNaverMapPresence",
    );
    expect(naverMapSource).toContain(
      "areClusterFeaturesEqual(previous, newClusters) ? previous : newClusters",
    );
    expect(naverMapSource).toContain(
      "areRegionalClustersEqual(previous, newRegionalClusters) ? previous : newRegionalClusters",
    );
    expect(naverMapSource).toContain("RESTAURANT_COUNT_TOAST_SETTLE_DELAY_MS");
    expect(naverMapSource).toContain("isFetching: isFetchingRestaurants");
    expect(naverMapSource).toContain(
      "isLoadingRestaurants || isFetchingRestaurants",
    );
    expect(naverMapSource).toContain(
      "setRestaurantCountToastCount(restaurants.length)",
    );
    expect(naverMapSource).toContain(
      "restaurantCountToastCount={restaurantCountToastCount}",
    );
    expect(naverMapSource).not.toContain("count={restaurants.length}");
    expect(source("components/map/naver-map-overlay-stack.tsx")).toContain(
      "count={restaurantCountToastCount}",
    );
    expect(naverMapSource).not.toContain(
      'import { supabase } from "@/integrations/supabase/client"',
    );
    expect(source("hooks/use-restaurants.tsx")).toContain("fetchSupabaseRows");
    expect(source("hooks/use-restaurants.tsx")).not.toContain(
      'import { supabase } from "@/integrations/supabase/client"',
    );
    expect(source("components/home/MobileControlOverlay.tsx")).toContain(
      "fetchSupabaseRows",
    );
    expect(source("components/home/MobileControlOverlay.tsx")).not.toContain(
      "import { supabase } from '@/integrations/supabase/client'",
    );
    expect(mapOverlayNoticeSource).toContain("max-w-[calc(100vw-2rem)]");
    expect(mapOverlayNoticeSource).toContain(
      "export const MAP_OVERLAY_NOTICE_SURFACE_CLASS_NAME =",
    );
    expect(mapOverlayNoticeSource).toContain(
      "const baseNoticeClass = MAP_OVERLAY_NOTICE_CLASS_NAME;",
    );
    expect(mapOverlayNoticeSource).toContain(
      "MAP_OVERLAY_NOTICE_SURFACE_CLASS_NAME} text-left",
    );
    expect(mapOverlayNoticeSource).toContain(
      "className={cn(baseNoticeClass, className)}",
    );
    expect(mapOverlayNoticeSource).toContain("export const MAP_OVERLAY_NOTICE_CLASS_NAME =");
    expect(mapOverlayNoticeSource).toContain(
      "export const MAP_OVERLAY_NOTICE_SURFACE_CLASS_NAME =\n    '!border !border-border !bg-card/95 !text-foreground !rounded-2xl !px-3 !py-2';",
    );
    expect(mapIndicatorsSource).toContain("<MapOverlayNotice");
    expect(mapIndicatorsSource).toContain("<MapOverlayNoticeButton");
    expect(mapIndicatorsSource).not.toContain("dark:bg-");
    for (const visualToken of [
      "!border",
      "!border-border",
      "!bg-card/95",
      "!text-foreground",
      "!rounded-2xl",
      "!px-3 !py-2",
    ]) {
      expect(mapOverlayNoticeSource).toContain(visualToken);
    }
    expect(mapOverlayNoticeSource).not.toContain("hover:bg-secondary/70");
    expect(mapOverlayNoticeSource).toContain("sm:hover:!bg-secondary/70");
    expect(mapOverlayNoticeSource).toContain("appearance-none");
    expect(mapOverlayNoticeSource).toContain("aria-label={ariaLabel}");
    expect(mapOverlayNoticeSource).toContain(
      "export const MAP_OVERLAY_NOTICE_SINGLE_LINE_CLASS_NAME = 'map-overlay-notice-single-line';",
    );
    expect(mapIndicatorsSource).toContain("mobile-map-announcement-toast");
    expect(mapIndicatorsSource).toContain(
      "className={`${MAP_OVERLAY_TOAST_CLASS_NAME} animate-in",
    );
    expect(overlayStackSource).toContain(
      "className={`${MAP_OVERLAY_TOAST_CLASS_NAME} ${floatingToastPositionClass}",
    );
    expect(mapIndicatorsSource).toContain(
      "contentClassName={MAP_OVERLAY_NOTICE_SINGLE_LINE_CLASS_NAME}",
    );
    expect(overlayStackSource).toContain('showOnlineUsers && !showRestaurantCount && !isLoadingRestaurants && isLoaded');
    expect(overlayStackSource).toContain('showAnnouncementToast && !showRestaurantCount && !showOnlineUsers && !isLoadingRestaurants && isLoaded && announcementToastTitle');
    expect(mapOverlayNoticeSource).toContain("min-h-9");
    expect(mapOverlayNoticeSource).toContain("w-fit");
    expect(mapOverlayNoticeSource).not.toContain("flex w-[calc(100vw-2rem)]");
    expect(mapOverlayNoticeSource).toContain("grid-cols-[1.25rem_max-content]");
    expect(mapOverlayNoticeSource).toContain("max-w-full");
    expect(mapOverlayNoticeSource).toContain("whitespace-nowrap");
    expect(mapOverlayNoticeSource).not.toContain("whitespace-normal");
    expect(mapOverlayNoticeSource).not.toContain("[overflow-wrap:anywhere]");
    expect(mapOverlayNoticeSource).not.toContain("truncate break-keep");
    expect(mapOverlayNoticeSource).toContain("aria-live={ariaLive}");
    expect(mapOverlayNoticeSource).toContain("aria-busy={ariaBusy}");
    expect(mapOverlayNoticeSource).toContain('aria-hidden="true">');
    expect(mapIndicatorsSource).toContain("MapOverlayNotice");
    expect(mapIndicatorsSource).toContain("motion-reduce:animate-none");
    expect(mapIndicatorsSource).toContain("isBusy = !isLoaded");
    expect(mapIndicatorsSource).toContain(
      "animate-[fadeInOut_3s_ease-in-out_forwards]",
    );
    expect(mapIndicatorsSource).not.toContain("animation: 'fadeInOut");
    expect(mapIndicatorsSource).not.toContain("🔥 {count}개의 맛집 발견");
    expect(mapViewIndicatorsSource).toContain("ariaBusy");
    expect(mapViewIndicatorsSource).toContain("motion-reduce:animate-none");
    expect(overlayStackSource).toContain(
      "isBusy={isLoadingRestaurants || !isLoaded}",
    );
    expect(overlayStackSource).toContain(
      "role={mapToast.type === 'error' ? 'alert' : 'status'}",
    );
    expect(overlayStackSource).toContain(
      "ariaLive={mapToast.type === 'error' ? 'assertive' : 'polite'}",
    );
    expect(overlayStackSource).toContain("emptyStateMessage?: string");
    expect(overlayStackSource).toContain("className={floatingToastPositionClass}");
    expect(overlayStackSource).toContain("<EmptyStateIndicator message={emptyStateMessage} />");
    expect(mapIndicatorsSource).toContain("이 지역에 등록된 맛집이 없습니다");
    expect(naverMapSource).toContain("resolveNaverRestaurantEmptyStateMessage(filters)");
    expect(naverMapSource).not.toContain("선택한 필터에 맞는 맛집이 없습니다");
    expect(overlayPositionSource).toContain(
      "bottom-[calc(var(--mobile-bottom-nav-effective-height",
    );
    expect(overlayPositionSource).toContain("absolute right-4 bottom-4");
    expect(overlayPositionSource).toContain(
      "const MOBILE_MAP_STATUS_BADGE_STACK_OFFSET_CLASS =",
    );
    expect(overlayPositionSource).toContain(
      "'top-[calc(env(safe-area-inset-top)_+_114px)]'",
    );
    expect(overlayPositionSource).toContain(
      "mobile-map-status-badge fixed ${MOBILE_MAP_STATUS_BADGE_STACK_OFFSET_CLASS}",
    );
    expect(overlayPositionSource).toContain("z-[70]");
    expect(homeAppGlobalsSource).toContain('@source "../lib/naver-map-overlay-position-helpers.ts";');
    expect(mobileControlSource).toContain("document.documentElement.toggleAttribute('data-mobile-search-open', activeSheet === 'search')");
    expect(homeAppGlobalsSource).toContain('.mobile-map-status-badge');
    expect(homeAppGlobalsSource).toContain('@media (max-width: 1279px)');
    expect(homeAppGlobalsSource).toContain('@media (orientation: landscape) and (max-height: 520px)');
    expect(homeAppGlobalsSource).toContain('margin-top: 0');
    expect(homeAppGlobalsSource).toContain('max-width: calc(100vw - 2rem)');
    expect(homeAppGlobalsSource).toContain(
      ".mobile-map-status-badge.mobile-map-announcement-toast {\n  width: max-content;\n  max-width: calc(100vw - 2rem);",
    );
    expect(homeAppGlobalsSource).toContain(
      ".mobile-map-status-badge.mobile-map-announcement-toast",
    );
    expect(homeAppGlobalsSource).toContain("height: 2.25rem");
    expect(homeAppGlobalsSource).toContain(
      ".mobile-map-status-badge.mobile-map-announcement-toast .map-overlay-notice-single-line",
    );
    expect(homeAppGlobalsSource).toContain("overflow: hidden");
    expect(homeAppGlobalsSource).toContain("text-overflow: ellipsis");
    expect(homeAppGlobalsSource).toContain("white-space: nowrap");
    expect(homeAppGlobalsSource).toContain(
      "html[data-mobile-search-open] .mobile-map-status-badge {\n    display: none;",
    );
    expect(homeAppGlobalsSource).toContain(
      "10px safe area + 48px search row + 8px gap + 40px filter reel + 8px toast gap = 114px.",
    );
    expect(mobileControlSource).toContain(
      "pt-[calc(env(safe-area-inset-top)+10px)]",
    );
    expect(mobileControlSource).toContain("flex h-12");
    expect(mobileControlSource).toContain(
      "className=\"pointer-events-auto mt-2 flex w-full",
    );
    expect(mobileControlSource).toContain("inline-flex h-9");
    expect(mobileControlSource).toContain("py-0.5");
    expect(homeAppGlobalsSource).toContain('overflow-wrap: anywhere');
    expect(homeAppGlobalsSource).toContain('grid-template-columns: 1.25rem minmax(0, 1fr)');
    expect(homeAppGlobalsSource).toContain('max-height: min(20rem, calc(100dvh - 24rem))');
    expect(homeAppGlobalsSource).toContain('overflow-y: auto');
    expect(overlayPositionSource).not.toContain(
      "fixed top-[calc(env(safe-area-inset-top)+114px)] left-1/2 -translate-x-1/2 transition-[left] ease-in-out z-[70]",
    );
    expect(overlayPositionSource).not.toContain(
      "top-[calc(env(safe-area-inset-top)+132px)]",
    );
    expect(overlayLayoutSource).toContain("지도 본문으로 건너뛰기");
    expect(overlayLayoutSource).toContain('id="tzudong-map-main"');
    expect(floatingNavSource).toContain('aria-label="지도 화면 보조 탐색"');
    expect(floatingNavSource).toContain("aria-pressed={mapMode ===");
  });
  test("mobile toast dark tokens and G007 announcement width stay explicit", () => {
    const rootGlobalsSource = source("app/globals.css");
    const homeAppGlobalsSource = source("app/home-app-globals.css");
    const rootDarkTokenBlock =
      rootGlobalsSource.match(/\.dark\s*\{[\s\S]*?\n\}/)?.[0] ?? "";

    expect(rootDarkTokenBlock).toContain(".dark {");
    for (const declaration of [
      "--background: 24 10% 10%;",
      "--foreground: 38 30% 96%;",
      "--card: 24 9% 13%;",
      "--card-foreground: 38 30% 96%;",
      "--border: 24 6% 24%;",
      "--secondary: 24 7% 18%;",
      "--secondary-foreground: 38 30% 96%;",
      "--muted: 24 7% 18%;",
      "--muted-foreground: 24 7% 68%;",
      "--accent: 24 7% 18%;",
      "--accent-foreground: 38 30% 96%;",
    ]) {
      expect(rootDarkTokenBlock).toContain(declaration);
    }

    expect(homeAppGlobalsSource).toContain(
      ".mobile-map-status-badge.mobile-map-announcement-toast {\n  width: max-content;\n  max-width: calc(100vw - 2rem);",
    );
    expect(homeAppGlobalsSource).toContain("height: 2.25rem");
    expect(homeAppGlobalsSource).toContain(
      "10px safe area + 48px search row + 8px gap + 40px filter reel + 8px toast gap = 114px.",
    );
  });

  test("naver marker click centering avoids slow duplicate recenter loops", () => {
    const naverMapSource = source("components/map/NaverMapView.tsx");

    expect(naverMapSource).toContain("applyNaverImmediateMarkerCenter({");
    expect(naverMapSource).toContain(
      "lastImmediateMarkerCenterRef.current = immediateCenterResult.markerCenter",
    );
    expect(naverMapSource).toContain(
      "lastImmediateMarkerCenterRef.current = null;",
    );

    const interactionListenerIndex = naverMapSource.indexOf(
      "const mapEventListeners = interactionListenerPlan.mapEventNames.map",
    );
    const deferredSkipIndex = naverMapSource.indexOf(
      "shouldSkipNaverDeferredCenterAfterImmediateMarkerClick({",
    );

    expect(interactionListenerIndex).toBeGreaterThan(-1);
    expect(deferredSkipIndex).toBeGreaterThan(-1);
    expect(interactionListenerIndex).toBeLessThan(deferredSkipIndex);
  });

  test("device location floating action does not show expanding circle animations", () => {
    const mobileControlSource = source(
      "components/home/MobileControlOverlay.tsx",
    );
    const submissionFloatingButtonSource = source(
      "components/home/SubmissionFloatingButton.tsx",
    );
    const restaurantSubmissionSource = source(
      "components/modals/RestaurantSubmissionModal.tsx",
    );
    const editRestaurantSource = source(
      "components/modals/EditRestaurantModal.tsx",
    );
    const homeClientSidePanelsSource = source("app/home-client-sidepanels.tsx");
    const homeClientSource = source("app/home-client.tsx");
    const naverMapSource = source("components/map/NaverMapView.tsx");

    expect(mobileControlSource).not.toContain(
      "isDeviceLocationPending && 'animate-pulse opacity-80'",
    );
    expect(submissionFloatingButtonSource).toContain(
      "resolveDeviceLocationButtonLabel",
    );
    expect(homeClientSidePanelsSource).toContain(
      "presentation={isMobileOrTablet ? 'auto' : 'map-panel'}",
    );
    expect(editRestaurantSource).toContain(
      "presentation?: 'auto' | 'map-panel'",
    );
    expect(editRestaurantSource).toContain(
      'data-desktop-map-edit-panel="true"',
    );
    expect(editRestaurantSource).toContain("mobileSheetStyles.frame");
    expect(editRestaurantSource).toContain("data-desktop-map-edit-drag-handle");
    expect(editRestaurantSource).toContain("handleDesktopEditPanelPointerDown");
    expect(editRestaurantSource).toContain("setPointerCapture");
    expect(editRestaurantSource).toContain(
      "translate3d(${desktopEditPanelPosition.x}px, ${desktopEditPanelPosition.y}px, 0)",
    );
    expect(restaurantSubmissionSource).toContain(
      'data-desktop-map-submission-panel="true"',
    );
    expect(restaurantSubmissionSource).toContain("shouldRenderMapPanel");
    expect(restaurantSubmissionSource).toContain("mobileSheetStyles.frame");
    expect(restaurantSubmissionSource).toContain(
      "data-desktop-map-submission-drag-handle",
    );
    expect(restaurantSubmissionSource).toContain(
      "handleDesktopSubmissionPanelPointerDown",
    );
    expect(restaurantSubmissionSource).toContain("setPointerCapture");
    expect(restaurantSubmissionSource).toContain(
      "translate3d(${desktopSubmissionPanelPosition.x}px, ${desktopSubmissionPanelPosition.y}px, 0)",
    );
    expect(restaurantSubmissionSource).toContain(
      'layoutSource="restaurant-submission"',
    );
    expect(submissionFloatingButtonSource).toContain("onDeviceLocationClick");
    expect(submissionFloatingButtonSource).toContain(
      "aria-label={deviceLocationButtonLabel}",
    );
    expect(submissionFloatingButtonSource).toContain(
      "desktopPanelSide?: HomeMapPanelSide",
    );
    expect(submissionFloatingButtonSource).toContain(
      "shouldOffsetForRightPanel",
    );
    expect(submissionFloatingButtonSource).toContain(
      "DESKTOP_MAP_SIDE_PANEL_WIDTH_CSS",
    );
    expect(
      submissionFloatingButtonSource.indexOf('aria-label="맛집 제보하기"'),
    ).toBeLessThan(
      submissionFloatingButtonSource.indexOf(
        "aria-label={deviceLocationButtonLabel}",
      ),
    );
    expect(
      mobileControlSource.indexOf('aria-label="맛집 제보하기"'),
    ).toBeLessThan(
      mobileControlSource.indexOf("aria-label={deviceLocationButtonLabel}"),
    );
    expect(submissionFloatingButtonSource).toContain(
      'isDeviceLocationPending && "opacity-80"',
    );
    expect(submissionFloatingButtonSource).not.toContain("animate-pulse");
    expect(homeClientSource).toContain(
      "onDeviceLocationClick={handleDeviceLocationClick}",
    );
    expect(homeClientSource).toContain(
      "isDeviceLocationPending={isDeviceLocationPending}",
    );
    expect(homeClientSource).toContain("desktopPanelSide={desktopPanelSide}");
    expect(homeClientSource).toContain("isPanelCollapsed={isPanelCollapsed}");
    expect(naverMapSource).not.toContain("new naver.maps.Circle");
    expect(naverMapSource).not.toContain("deviceLocationAccuracyCircleRef");
  });

  test("profile/stamp/map regressions stay fixed while preserving deferred map loading", () => {
    const overlayPanelSource = source("components/layout/OverlayPagePanel.tsx");
    const stampCardSource = source("components/stamp/StampCard.tsx");
    const stampPageSource = source("app/stamp/page.tsx");
    const stampUtilsSource = source("components/stamp/stamp-utils.ts");
    const stampLoadingSource = source("app/stamp/loading.tsx");
    const skeletonLoadersSource = source("components/ui/skeleton-loaders.tsx");
    const userProfilePanelSource = source(
      "components/profile/UserProfilePanel.tsx",
    );
    const userProfileProgressiveSkeletonSource = source(
      "components/profile/UserProfileProgressiveSkeleton.tsx",
    );
    const naverMapSource = source("components/map/NaverMapView.tsx");
    const mapViewSidepanelsSource = source(
      "components/map/map-view-sidepanels.tsx",
    );
    const naverMapSidepanelsSource = source(
      "components/map/naver-map-sidepanels.tsx",
    );

    const userProfilePanelIndex =
      overlayPanelSource.indexOf("<UserProfilePanel");

    expect(userProfilePanelIndex).toBeGreaterThan(0);
    expect(
      overlayPanelSource.lastIndexOf(
        '"w-[min(400px,calc(100vw-1rem))]"',
        userProfilePanelIndex,
      ),
    ).toBeGreaterThan(0);
    expect(
      overlayPanelSource.lastIndexOf(
        '"rounded-2xl border border-border shadow-2xl overflow-hidden"',
        userProfilePanelIndex,
      ),
    ).toBeGreaterThan(0);
    expect(stampCardSource).toContain(
      "getRestaurantDisplayName(typedRestaurant)",
    );
    expect(stampCardSource).toContain(
      "alt={`${restaurantDisplayName} 썸네일`}",
    );
    expect(stampCardSource).toContain("title={restaurantDisplayName}");
    expect(stampCardSource).toContain(
      "absolute inset-0 z-10 flex items-center justify-center",
    );
    expect(stampCardSource).toContain(
      'isStampMobile ? "overflow-visible" : "overflow-hidden"',
    );
    expect(stampCardSource).toContain("<img");
    expect(stampCardSource).toContain('src="/images/stamp-clear.png"');
    expect(stampCardSource).toContain(
      "stampSize?: 'default' | 'compact' | 'mobile'",
    );
    expect(stampCardSource).toContain(
      "const resolvedStampSize = stampSize ?? size",
    );
    expect(stampCardSource).toContain(
      "const isStampCompact = resolvedStampSize === 'compact'",
    );
    expect(stampCardSource).toContain(
      "const isStampMobile = resolvedStampSize === 'mobile'",
    );
    expect(stampCardSource).toContain("const stampImageStyle = isStampMobile");
    expect(stampCardSource).toContain("translateY(0.375rem) rotate(-45deg)");
    expect(stampCardSource).toContain("height: '74%'");
    expect(stampCardSource).toContain("maxHeight: '9rem'");
    expect(stampCardSource).toContain("maxWidth: '44%'");
    expect(stampCardSource).toContain(
      'role={isGuideCard ? undefined : "button"}',
    );
    expect(stampCardSource).toContain("onKeyDown={handleCardKeyDown}");
    expect(stampCardSource).toContain("focus-visible:ring-primary");
    expect(stampCardSource).toContain("transition-[filter,opacity,transform]");
    expect(stampCardSource).toContain("style={{ objectFit: 'cover' }}");
    expect(stampCardSource).toContain("getYouTubeFallbackThumbnailUrl");
    expect(stampPageSource).toContain("style={{ objectFit: 'cover' }}");
    expect(stampUtilsSource).toContain("mqdefault.jpg");
    expect(stampUtilsSource).toContain("hqdefault.jpg");
    expect(stampUtilsSource).not.toContain("/hq720.jpg");
    expect(stampCardSource).toContain("const category = useMemo(");
    expect(stampCardSource).not.toContain("transition-all");
    expect(stampCardSource).not.toContain(
      "style={showStamp ? { filter: 'grayscale(1)' } : undefined}",
    );
    expect(stampCardSource).toContain(
      "pointer-events-none absolute inset-0 flex items-center justify-center",
    );
    expect(stampCardSource).toContain("w-36 h-36 md:w-40 md:h-40");
    expect(stampCardSource).toContain("w-48 h-48 sm:w-56 sm:h-56");
    expect(stampPageSource).toContain(
      'stampSize={isDesktop ? "compact" : "mobile"}',
    );
    expect(stampPageSource).toContain('name="stamp-page-search"');
    expect(stampPageSource).toContain('autoComplete="off"');
    expect(stampPageSource).not.toContain("transition-all duration-300");
    expect(stampCardSource).toContain("grayscale opacity-60");
    expect(stampCardSource).not.toContain("absolute inset-0 bg-black/");
    expect(skeletonLoadersSource).toContain(
      "function StampPageSkeletonComponent",
    );
    expect(skeletonLoadersSource).toContain(
      'data-testid="stamp-page-skeleton"',
    );
    expect(skeletonLoadersSource).toContain(
      "shrink-0 space-y-4 border-b border-border bg-background px-3 py-3 sm:px-5 sm:py-4",
    );
    expect(skeletonLoadersSource).toContain(
      "basis-[min(11rem,100%)] space-y-2",
    );
    expect(skeletonLoadersSource).toContain(
      "ml-auto flex shrink-0 items-center gap-1.5 sm:gap-2",
    );
    expect(stampLoadingSource).toContain('import { StampPageSkeleton }');
    expect(stampLoadingSource).toContain("return <StampPageSkeleton />");
    expect(stampPageSource).toContain(
      'data-stamp-loading-behavior="static-shell-dynamic-skeleton"',
    );
    expect(stampPageSource).toContain("includeVerifiedReviewCounts: false");
    expect(stampPageSource).toContain("const isStampDynamicLoading =");
    expect(stampPageSource).not.toContain("shouldWaitForStampState");
    expect(stampPageSource).toContain("const STAMP_PAGE_SIZE = 5");
    expect(stampPageSource).toContain(
      "const [displayLimit, setDisplayLimit] = useState(STAMP_PAGE_SIZE)",
    );
    expect(stampPageSource).toContain("setDisplayLimit(STAMP_PAGE_SIZE)");
    expect(stampPageSource).toContain(
      "setDisplayLimit(prev => prev + STAMP_PAGE_SIZE)",
    );
    expect(stampPageSource).toContain(
      "StampGridSkeleton count={STAMP_PAGE_SIZE}",
    );
    expect(countSourceMatches(stampPageSource, /<StampGridSkeleton\b/g)).toBe(
      1,
    );
    expect(stampPageSource).toContain(
      "const gridRestaurantLimit = Math.max(displayLimit - guideSlotCount, 0)",
    );
    expect(stampPageSource).toContain(
      "const loadedRestaurantCount = viewMode === 'grid' ? displayedGridRestaurants.length : displayedRestaurants.length",
    );
    expect(stampPageSource).toContain("const isStampDynamicLoading =");
    expect(stampPageSource).toContain(
      "const shouldShowStampFilterToggle = !isMounted || isMobileOrTablet",
    );
    expect(stampPageSource).toContain(
      "const shouldShowStampViewToggle = isMounted && !isMobileOrTablet",
    );
    expect(stampPageSource).toContain(
      "const shouldShowStampFilters = isMounted && (!isMobileOrTablet || isFilterExpanded)",
    );
    expect(stampPageSource).toContain('data-stamp-total-count-skeleton="true"');
    expect(stampPageSource).toContain('!shouldShowStampFilters && "hidden"');
    expect(stampPageSource).not.toContain(
      'isMobileOrTablet && !isFilterExpanded && "hidden"',
    );
    expect(stampPageSource).not.toContain("return <StampPageSkeleton />");
    expect(userProfilePanelSource).toContain("import { StampCard }");
    expect(userProfilePanelSource).toContain("import { ReviewCard }");
    expect(userProfilePanelSource).toContain(
      "const USER_PROFILE_PAGE_SIZE = 15",
    );
    expect(userProfilePanelSource).toContain("const PROFILE_TABS = [");
    expect(userProfilePanelSource).toContain('role="tablist"');
    expect(userProfilePanelSource).toContain(
      "grid w-full grid-cols-3 gap-1 rounded-xl bg-muted/60 p-1",
    );
    expect(userProfilePanelSource).toContain(
      "onClick={() => handleTabChange(tab.value)}",
    );
    expect(userProfilePanelSource).toContain("aria-selected={isActive}");
    expect(userProfilePanelSource).toContain(
      "whitespace-nowrap rounded-lg border px-2 py-2.5 text-xs",
    );
    expect(userProfilePanelSource).toContain(
      "border-border/70 bg-background text-foreground shadow-sm",
    );
    expect(userProfilePanelSource).toContain("grid w-full grid-cols-3 gap-2");
    expect(
      userProfilePanelSource.split(
        "gridTemplateColumns: 'repeat(3, minmax(0, 1fr))'",
      ).length - 1,
    ).toBe(2);
    expect(userProfilePanelSource).toContain(
      "border border-border/60 bg-card/80",
    );
    expect(userProfilePanelSource).toContain(
      "const ProfileSectionHeader = memo",
    );
    expect(userProfilePanelSource).toContain("방문 도장과 리뷰 활동");
    expect(userProfilePanelSource).toContain("visibleStampCount");
    expect(userProfilePanelSource).toContain("stampLoadMoreRef");
    expect(userProfilePanelSource).toContain(
      'className="flex-shrink-0 -mr-2 h-10 w-10"',
    );
    expect(userProfilePanelSource).toContain("<StampCard");
    expect(userProfilePanelSource).toContain("<ReviewCard");
    expect(userProfilePanelSource).toContain('size="default"');
    expect(userProfilePanelSource).toContain('stampSize="compact"');
    expect(userProfilePanelSource).not.toContain(
      "import { Tabs, TabsContent, TabsList, TabsTrigger }",
    );
    expect(userProfilePanelSource).not.toContain("<TabsTrigger");
    expect(userProfilePanelSource).not.toContain(
      "const StampItem = memo(function StampItem",
    );
    expect(userProfilePanelSource).not.toContain(
      "const ReviewItem = memo(function ReviewItem",
    );
    expect(userProfilePanelSource).not.toContain(
      '<ScrollArea className="h-full">',
    );
    expect(userProfileProgressiveSkeletonSource).toContain(
      "data-user-profile-panel-skeleton",
    );
    expect(userProfileProgressiveSkeletonSource).toContain("data-user-profile-tab-skeleton");
    expect(userProfilePanelSource).toContain(
      "UserProfileProgressiveSkeleton, UserProfileTabSkeleton",
    );
    expect(userProfileProgressiveSkeletonSource).toContain(
      'import { Skeleton } from "@/components/ui/skeleton"',
    );
    expect(userProfilePanelSource).not.toContain(
      'import { GlobalLoader } from "@/components/ui/global-loader"',
    );
    expect(mapViewSidepanelsSource).toContain("showDesktopBackButton");
    expect(mapViewSidepanelsSource).toContain("data-map-detail-panel-skeleton");
    expect(naverMapSidepanelsSource).toContain("showDesktopBackButton");
    expect(naverMapSidepanelsSource).toContain(
      "data-map-detail-panel-skeleton",
    );
    expect(naverMapSidepanelsSource).toContain("<Suspense fallback={null}>");
    expect(naverMapSidepanelsSource).not.toContain(
      "<Suspense fallback={<NaverMapDetailPanelSkeleton />}>",
    );
    expect(naverMapSource).toContain("resolveNaverRestaurantQueryBounds");
    expect(naverMapSource).toContain(
      "shouldUseFullMapData: shouldRunNoncriticalMapEffects",
    );
    expect(
      naverMapSource.match(/activateNoncriticalMapEffects\(\);/g)?.length,
    ).toBeGreaterThanOrEqual(3);
  });

  test("review like heart keeps the previous feed-style mobile and desktop overlay layout", () => {
    const reviewCardSource = source("components/reviews/ReviewCard.tsx");
    const feedContentSource = source("components/feed/FeedContent.tsx");
    const profilePanelSource = source(
      "components/profile/UserProfilePanel.tsx",
    );
    const restaurantDetailSource = source(
      "components/restaurant/RestaurantDetailPanel.tsx",
    );
    const stampPageSource = source("app/stamp/page.tsx");

    expect(reviewCardSource).toContain(
      "const [optimisticLike, setOptimisticLike] = useState",
    );
    expect(reviewCardSource).toContain(
      "import { Avatar, AvatarFallback, AvatarImage }",
    );
    expect(reviewCardSource).toContain(
      '<Avatar className="h-8 w-8 bg-primary/10">',
    );
    expect(reviewCardSource).toContain("<AvatarImage");
    expect(reviewCardSource).toContain(
      '<AvatarFallback className="bg-primary/10">',
    );
    expect(reviewCardSource).toContain("setOptimisticLike({");
    expect(reviewCardSource).toContain("pendingLikeRef.current");
    expect(reviewCardSource).toContain(
      "const pendingLike = pendingLikeRef.current",
    );
    expect(reviewCardSource).toContain(
      "onLike(review.id, optimisticLike.isLiked, optimisticLike.count)",
    );
    expect(reviewCardSource).toContain("optimisticLike.isLiked ?");
    expect(reviewCardSource).toContain(
      "typeof (result as Promise<void>).catch === 'function'",
    );
    expect(reviewCardSource).not.toContain("if (!currentUserId)");
    expect(reviewCardSource).toContain("import { cn } from");
    expect(reviewCardSource).toContain(
      "group -m-1.5 flex items-center gap-1 rounded-full",
    );
    expect(reviewCardSource).toContain("active:text-red-500");
    expect(reviewCardSource).toContain("data-liked={optimisticLike.isLiked}");
    expect(reviewCardSource).toContain("const LIKED_HEART_COLOR = '#ef4444';");
    expect(reviewCardSource).toContain(
      "color={optimisticLike.isLiked ? LIKED_HEART_COLOR : undefined}",
    );
    expect(reviewCardSource).toContain(
      'fill={optimisticLike.isLiked ? LIKED_HEART_COLOR : "none"}',
    );
    expect(reviewCardSource).toContain(
      'stroke={optimisticLike.isLiked ? LIKED_HEART_COLOR : "currentColor"}',
    );
    expect(reviewCardSource).toContain(
      "group-active:fill-red-500 group-active:text-red-500",
    );
    expect(reviewCardSource).toContain(
      "[&_path]:fill-red-500 [&_path]:stroke-red-500",
    );
    expect(reviewCardSource).toContain(
      "text-xs font-medium transition-colors group-active:text-red-500",
    );
    expect(reviewCardSource).toContain('"text-muted-foreground');
    expect(reviewCardSource).toContain('"text-red-500"');
    expect(reviewCardSource).not.toContain(
      'className="group relative flex h-8 w-8 items-center justify-center rounded-full',
    );
    expect(reviewCardSource).toContain(
      "aria-label={`좋아요 ${optimisticLike.count}개${optimisticLike.isLiked ? ' 취소' : ' 누르기'}`}",
    );
    expect(reviewCardSource).toContain("aria-pressed={optimisticLike.isLiked}");
    expect(reviewCardSource).toContain(
      'aria-label={isShareCopied ? "리뷰 링크 복사됨" : "리뷰 공유"}',
    );
    expect(reviewCardSource).toContain(
      "aria-label={`${review.restaurantName} 맛집 상세 보기`}",
    );
    expect(reviewCardSource).not.toContain(
      "aria-label={`좋아요 ${review.likeCount}개`}",
    );
    expect(reviewCardSource).not.toContain(
      "absolute inset-0 flex items-center justify-center text-[9px]",
    );
    expect(reviewCardSource).not.toContain(
      "text-[10px] font-bold leading-none tabular-nums",
    );
    expect(feedContentSource).toContain(
      "onLike={(reviewId, currentIsLiked, currentCount) => toggleLike(reviewId, currentIsLiked, currentCount)}",
    );
    expect(restaurantDetailSource).toContain(
      "const handleLikeReview = async (reviewId: string, currentIsLiked?: boolean)",
    );
    expect(restaurantDetailSource).toContain(
      "const isCurrentlyLiked = currentIsLiked ?? likedReviews.has(reviewId);",
    );
    expect(profilePanelSource).toContain(
      "const handleLike = useCallback(async (reviewId: string, currentIsLikedOverride?: boolean)",
    );
    expect(profilePanelSource).toContain(
      "const currentIsLiked = currentIsLikedOverride ?? targetReview.isLikedByUser;",
    );

    for (const parentSource of [
      feedContentSource,
      profilePanelSource,
      restaurantDetailSource,
      stampPageSource,
    ]) {
      expect(parentSource).not.toContain("throw new Error('LOGIN_REQUIRED')");
      expect(parentSource).toContain("throw error;");
    }
  });

  test("auth-gated review actions open UI prompts without uncaught LOGIN_REQUIRED throws", () => {
    const feedContentSource = source("components/feed/FeedContent.tsx");
    const profilePanelSource = source(
      "components/profile/UserProfilePanel.tsx",
    );
    const restaurantDetailSource = source(
      "components/restaurant/RestaurantDetailPanel.tsx",
    );
    const stampPageSource = source("app/stamp/page.tsx");

    expect(feedContentSource).toContain("if (!user) {");
    expect(feedContentSource).toContain("if (onOpenAuth) {");
    expect(feedContentSource).toContain("onOpenAuth();");
    expect(feedContentSource).toContain("return;");
    expect(profilePanelSource).toContain("title: '로그인 필요'");
    expect(restaurantDetailSource).toContain("setIsAuthModalOpen(true);");
    expect(stampPageSource).toContain("console.warn('로그인이 필요합니다.');");

    for (const authGateSource of [
      feedContentSource,
      profilePanelSource,
      restaurantDetailSource,
      stampPageSource,
    ]) {
      expect(authGateSource).not.toContain("LOGIN_REQUIRED");
    }
  });

  test("overlay and review icon buttons expose stable accessible names", () => {
    const feedContentSource = source("components/feed/FeedContent.tsx");
    const restaurantReviewsPanelSource = source(
      "components/stamp/RestaurantReviewsPanel.tsx",
    );
    const stampOverlaySource = source(
      "components/overlay-pages/StampOverlay.tsx",
    );
    const leaderboardOverlaySource = source(
      "components/overlay-pages/LeaderboardOverlay.tsx",
    );
    const leaderboardListSource = source(
      "components/leaderboard/LeaderboardList.tsx",
    );
    const leaderboardPageSource = source("app/leaderboard/page.tsx");
    const leaderboardLoadingSource = source("app/leaderboard/loading.tsx");
    const leaderboardSkeletonSource = source(
      "components/ui/skeleton-loaders.tsx",
    );
    const leaderboardUtilsSource = source(
      "components/leaderboard/leaderboard-utils.ts",
    );

    expect(feedContentSource).toContain(
      'aria-label={showMyReviewsOnly ? "모든 리뷰 보기" : "내 리뷰만 보기"}',
    );
    expect(feedContentSource).toContain(
      'aria-label={isFilterExpanded ? "검색 필터 접기" : "검색 필터 펼치기"}',
    );
    expect(feedContentSource).toContain('aria-label="리뷰 패널 닫기"');
    expect(feedContentSource).toContain(
      'className="h-10 w-10 rounded-full bg-muted/45 shadow-none hover:bg-muted"',
    );
    expect(feedContentSource).not.toContain(
      'className="h-8 w-8 rounded-full hover:bg-muted"',
    );
    expect(feedContentSource).not.toContain(
      'className="h-9 w-9 hover:bg-muted rounded-full"',
    );
    expect(feedContentSource).toContain('aria-label="리뷰 작성"');
    expect(feedContentSource).toContain(
      "flex flex-wrap items-start justify-between gap-3",
    );
    expect(feedContentSource).toContain("basis-[min(11rem,100%)]");
    expect(feedContentSource).toContain("text-balance");
    expect(feedContentSource).toContain("text-pretty");
    expect(feedContentSource).toContain(
      'placeholder="맛집명, 작성자, 내용 검색…"',
    );
    expect(restaurantReviewsPanelSource).toContain(
      'aria-label="맛집 리뷰 패널 닫기"',
    );
    expect(stampOverlaySource).toContain('"모든 맛집 보기"');
    expect(stampOverlaySource).toContain('"안 가본 곳만 보기"');
    expect(stampOverlaySource).toContain('"도장 필터 접기"');
    expect(stampOverlaySource).toContain('"도장 필터 펼치기"');
    expect(stampOverlaySource).toContain('aria-label="도장 패널 닫기"');
    expect(stampOverlaySource).toContain(
      'className="h-10 w-10 rounded-full bg-muted/45 shadow-none hover:bg-muted"',
    );
    expect(stampOverlaySource).not.toContain(
      'className="h-8 w-8 rounded-full hover:bg-muted"',
    );
    expect(stampOverlaySource).not.toContain(
      'className="h-9 w-9 hover:bg-muted rounded-full"',
    );
    expect(stampOverlaySource).toContain(
      'data-desktop-left-panel-stamp-mobile-parity="true"',
    );
    expect(stampOverlaySource).toContain(
      "flex flex-wrap items-start justify-between gap-3",
    );
    expect(stampOverlaySource).toContain("basis-[min(11rem,100%)]");
    expect(stampOverlaySource).toContain("tabular-nums");
    expect(stampOverlaySource).toContain('stampSize="mobile"');
    expect(stampOverlaySource).toContain('size="default"');
    expect(stampOverlaySource).toContain("const STAMP_PAGE_SIZE = 5");
    expect(stampOverlaySource).toContain(
      "const skeletonCardCount = STAMP_PAGE_SIZE",
    );
    expect(stampOverlaySource).toContain("shouldShowStampOverlaySkeleton");
    expect(stampOverlaySource).toContain("count={skeletonCardCount}");
    expect(
      countSourceMatches(stampOverlaySource, /<StampGridSkeleton\b/g),
    ).toBe(1);
    expect(stampOverlaySource).toContain(
      "const skeletonGridColumns = singleColumnCards",
    );
    expect(stampOverlaySource).toContain(
      "grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 md:gap-4",
    );
    expect(stampOverlaySource).toContain("columns={skeletonGridColumns}");
    expect(stampOverlaySource).toContain(
      "mt-4 grid grid-cols-1 gap-2 overflow-hidden sm:grid-cols-2",
    );
    expect(stampOverlaySource).toContain(
      "border-0 bg-muted/45 shadow-none focus-visible:ring-1 focus-visible:ring-primary/40",
    );
    expect(stampOverlaySource).toContain("style={{ paddingLeft: '2.5rem' }}");
    expect(stampOverlaySource).toContain(
      'variant="ghost" className="justify-between bg-muted/45 shadow-none hover:bg-muted"',
    );
    expect(stampOverlaySource).toContain(
      "pb-[calc(var(--mobile-bottom-nav-effective-height,var(--mobile-bottom-nav-height,60px))+1.5rem)]",
    );
    expect(stampOverlaySource).toContain("md:pb-6");
    expect(stampOverlaySource).toContain("filters.fanVisitsMin");
    expect(stampOverlaySource).toContain("<Slider");
    expect(stampOverlaySource).toContain('aria-label="도장 맛집 검색"');
    expect(stampOverlaySource).toContain('name="stamp-overlay-search"');
    expect(stampOverlaySource).toContain('placeholder="맛집명 검색…"');
    expect(stampOverlaySource).toContain(
      "const deferredSearchQuery = useDeferredValue(filters.searchQuery)",
    );
    expect(stampOverlaySource).toContain(
      "function getStampRestaurantCategories(restaurant: Restaurant): string[]",
    );
    expect(stampOverlaySource).toContain(
      "const normalizedCategoriesByRestaurantId = useMemo(() => new Map(",
    );
    expect(stampOverlaySource).toContain(
      "normalizedCategoriesByRestaurantId.get(r.id) ?? []",
    );
    expect(stampOverlaySource).toContain("value={[filters.fanVisitsMin ?? 0]}");
    expect(stampOverlaySource).not.toContain(
      "defaultValue={[filters.fanVisitsMin ?? 0]}",
    );
    expect(stampOverlaySource).toContain("isError: isRestaurantsError");
    expect(stampOverlaySource).toContain("도장 맛집을 불러오지 못했습니다");
    expect(stampOverlaySource).toContain("조건에 맞는 도장 맛집이 없습니다");
    expect(leaderboardOverlaySource).toContain(
      'aria-label="랭킹 및 티어 산정 기준 보기"',
    );
    expect(leaderboardOverlaySource).toContain('aria-label="랭킹 패널 닫기"');
    expect(leaderboardOverlaySource).toContain(
      'data-desktop-left-panel-leaderboard-list="true"',
    );
    expect(leaderboardOverlaySource).toContain(
      "flex flex-wrap items-start justify-between gap-3",
    );
    expect(leaderboardOverlaySource).toContain("basis-[min(11rem,100%)]");
    expect(leaderboardOverlaySource).toContain("text-pretty");
    expect(leaderboardOverlaySource).toContain(
      "DESKTOP_LEFT_PANEL_LEADERBOARD_LIST_STYLE",
    );
    expect(leaderboardOverlaySource).toContain("width: 'calc(100% - 1.5rem)'");
    expect(leaderboardOverlaySource).toContain("maxWidth: '368px'");
    expect(leaderboardOverlaySource).toContain("marginInline: 'auto'");
    expect(leaderboardOverlaySource).toContain(
      'className="flex h-10 items-center justify-center"',
    );
    expect(leaderboardOverlaySource).toContain("compactLeftPanel");
    expect(leaderboardOverlaySource).toContain(
      "const scrollRef = useRef<HTMLDivElement>(null);",
    );
    expect(leaderboardOverlaySource).toContain(
      "{ root: scrollRef.current, threshold: 0.1 }",
    );
    expect(leaderboardOverlaySource).toContain(
      'className="h-full overflow-y-auto overflow-x-hidden overscroll-contain"',
    );
    expect(leaderboardOverlaySource).not.toContain(
      'import { ScrollArea } from "@/components/ui/scroll-area"',
    );
    expect(leaderboardOverlaySource).not.toContain("<ScrollArea");
    expect(leaderboardListSource).toContain("compactLeftPanel?: boolean");
    expect(leaderboardListSource).toContain("mobilePanel?: boolean");
    expect(leaderboardListSource).toContain(
      '? "flex w-full max-w-full items-center gap-2 overflow-hidden pl-2 pr-5',
    );
    expect(leaderboardListSource).toContain("pl-2 pr-2 sm:px-6");
    expect(leaderboardListSource).not.toContain("pl-2 pr-4 sm:px-6");
    expect(leaderboardListSource).not.toContain("px-4 sm:px-6 md:px-6");
    expect(leaderboardPageSource).not.toContain(
      "MOBILE_LEADERBOARD_PANEL_LIST_STYLE",
    );
    expect(leaderboardPageSource).toContain(
      'data-mobile-leaderboard-panel-list="true"',
    );
    expect(leaderboardPageSource).toContain("mobilePanel");
    expect(leaderboardPageSource).toContain('className="px-4"');
    expect(leaderboardPageSource).toContain(
      "flex flex-wrap items-start justify-between gap-3",
    );
    expect(leaderboardPageSource).toContain("basis-[min(11rem,100%)]");
    expect(leaderboardLoadingSource).not.toContain("compactLeftPanel");
    expect(leaderboardLoadingSource).toContain("return null");
    expect(leaderboardLoadingSource).toContain("한 번만");
    expect(leaderboardPageSource).toContain('className="px-4"');
    expect(leaderboardSkeletonSource).toContain("compactLeftPanel?: boolean");
    expect(leaderboardSkeletonSource).toContain("compactLeftPanel = false");
    expect(leaderboardSkeletonSource).toContain(
      'compactLeftPanel ? "px-2 py-4" : "p-4"',
    );
    expect(leaderboardSkeletonSource).toContain(
      'compactLeftPanel ? "gap-2" : "gap-3"',
    );
    expect(leaderboardSkeletonSource).toContain(
      'compactLeftPanel ? "w-7" : "w-9"',
    );
    expect(leaderboardOverlaySource).toContain("compactLeftPanel");
    expect(leaderboardListSource).toContain(
      "const COMPACT_LEFT_PANEL_ROW_STYLE = {",
    );
    expect(leaderboardListSource).toContain("paddingLeft: '0.5rem'");
    expect(leaderboardListSource).toContain("paddingRight: '1.25rem'");
    expect(leaderboardListSource).toContain("? COMPACT_LEFT_PANEL_ROW_STYLE");
    expect(leaderboardListSource).toContain('compactLeftPanel && "w-7 sm:w-7"');
    expect(leaderboardListSource).toContain('mobilePanel && "w-9 sm:w-10"');
    expect(leaderboardUtilsSource).toContain("getRankIconElement");
    expect(leaderboardUtilsSource).not.toContain("getRankIcon =");
    expect(leaderboardPageSource).toContain(
      "{ root: scrollRef.current, threshold: 0.1 }",
    );
    expect(leaderboardPageSource).toContain(
      'aria-label="랭킹 및 티어 산정 기준 보기"',
    );
  });

  test("desktop direct feature routes hand off to the home left panel and suppress popup blockers", () => {
    const feedPageSource = source("app/feed/page.tsx");
    const stampPageSource = source("app/stamp/page.tsx");
    const leaderboardPageSource = source("app/leaderboard/page.tsx");
    const overlayLayoutSource = source("components/layout/OverlayLayout.tsx");
    const mainLayoutSource = source("components/layout/MainLayout.tsx");
    const combinedPopupSource = source("components/layout/CombinedPopup.tsx");
    const testHelpersSource = source("tests/helpers.ts");
    const noncriticalChromeRoutesSource = source("lib/noncritical-chrome-routes.ts");

    expect(feedPageSource).toContain(
      "const target = reviewId ? `/?panel=feed&review=${encodeURIComponent(reviewId)}` : '/?panel=feed';",
    );
    expect(stampPageSource).toContain("router.replace('/?panel=stamp')");
    expect(leaderboardPageSource).toContain(
      "router.replace('/?panel=leaderboard')",
    );
    expect(overlayLayoutSource).toContain("function getDirectOverlayPanel");
    expect(overlayLayoutSource).toContain("const DIRECT_OVERLAY_PANELS");
    expect(overlayLayoutSource).toContain(
      "setActiveOverlayPanel(directPanelParam);",
    );
    expect(overlayLayoutSource).toContain(
      'HOME_OVERLAY_PANEL_OPENED_EVENT = "homeOverlayPanelOpened"',
    );
    expect(overlayLayoutSource).toContain(
      "new CustomEvent(HOME_OVERLAY_PANEL_OPENED_EVENT",
    );
    const homeClientSourceForOverlayEvents = source("app/home-client.tsx");
    const homeClientEffectsSource = source("app/home-client-effects.tsx");
    const desktopLeftPanelEntrySource = source(
      "lib/desktop-left-panel-entry.ts",
    );
    expect(homeClientSourceForOverlayEvents).toContain(
      "window.addEventListener(",
    );
    expect(homeClientSourceForOverlayEvents).toContain(
      '"homeOverlayPanelOpened"',
    );
    expect(homeClientEffectsSource).toContain("selectBookmarkRestaurant");
    expect(homeClientEffectsSource).toContain("notifyInlineDetailOpenFailed");
    expect(homeClientEffectsSource).toContain(
      "HOME_DESKTOP_INLINE_DETAIL_OPEN_FAILED_EVENT",
    );
    expect(desktopLeftPanelEntrySource).toContain(
      '"home:desktop-inline-detail-open-failed"',
    );
    expect(homeClientSourceForOverlayEvents).toContain(
      "handleHomeOverlayPanelOpened",
    );
    expect(source("components/home/home-desktop-control-panel.tsx")).toContain(
      "DESKTOP_LEFT_PANEL_ROUTE_VIEWS",
    );
    expect(source("components/home/home-desktop-control-panel.tsx")).toContain(
      "router.push(`/?panel=${panel}`, { scroll: false })",
    );
    expect(source("components/home/home-desktop-control-panel.tsx")).toContain(
      'router.push("/?panel=profile", { scroll: false })',
    );
    expect(source("components/home/home-desktop-control-panel.tsx")).toContain(
      'router.push("/?panel=bookmarks", { scroll: false })',
    );
    expect(source("components/home/home-desktop-control-panel.tsx")).toContain(
      'label: "알림"',
    );
    expect(source("components/home/home-desktop-control-panel.tsx")).toContain(
      'case "notifications":',
    );
    expect(source("components/home/home-desktop-control-panel.tsx")).toContain(
      "handleNotificationClick();",
    );
    expect(source("components/home/home-desktop-control-panel.tsx")).toContain(
      'router.push("/?panel=notifications", { scroll: false })',
    );
    expect(source("components/home/home-desktop-control-panel.tsx")).toContain(
      '"settings"',
    );
    expect(source("components/home/home-desktop-control-panel.tsx")).toContain(
      'data-desktop-left-panel-view="settings"',
    );
    expect(source("components/home/home-desktop-control-panel.tsx")).toContain(
      "writeHomeMapUserPreferences(",
    );
    expect(source("components/home/home-desktop-control-panel.tsx")).toContain(
      "user.id,",
    );
    expect(source("app/home-client.tsx")).toContain(
      "readLastHomeMapUserPreferences",
    );
    expect(source("app/home-client.tsx")).toContain(
      "DEFAULT_HOME_MAP_USER_PREFERENCES.desktopPanelSide",
    );
    expect(source("app/home-client.tsx")).toContain(
      "setDesktopPanelSide(preferences.desktopPanelSide)",
    );
    expect(source("app/home-client.tsx")).toContain(
      "readHomeMapUserPreferences(user.id)",
    );
    expect(source("app/home-client.tsx")).toContain(
      "HOME_MAP_USER_PREFERENCES_EVENT",
    );
    expect(source("app/home-client.tsx")).toContain(
      "!customEvent.detail.preservePanelCollapse",
    );
    expect(source("components/home/home-desktop-control-panel.tsx")).toContain(
      "preservePanelCollapse: true",
    );
    expect(source("lib/home-map-user-preferences.ts")).toContain(
      "preservePanelCollapse?: boolean",
    );
    expect(source("lib/home-map-user-preferences.ts")).toContain(
      "LAST_HOME_MAP_USER_PREFERENCES_KEY",
    );
    expect(source("lib/home-map-user-preferences.ts")).toContain(
      "readLastHomeMapUserPreferences",
    );
    expect(overlayLayoutSource).toContain(
      'router.replace("/", { scroll: false });',
    );
    expect(overlayLayoutSource).toContain(
      'router.replace(buildDirectOverlayHref("feed", reviewId),',
    );
    expect(overlayLayoutSource).toContain("scroll: false");
    expect(mainLayoutSource).toContain("shouldSuppressNoncriticalChromeForPathname(pathname)");
    expect(noncriticalChromeRoutesSource).toContain('"/feed"');
    expect(noncriticalChromeRoutesSource).toContain('"/stamp"');
    expect(noncriticalChromeRoutesSource).toContain('"/leaderboard"');
    expect(noncriticalChromeRoutesSource).toContain('"/mypage"');
    expect(noncriticalChromeRoutesSource).toContain('"/insights"');
    expect(mainLayoutSource).toContain("const shouldSuppressMobileBottomNav =");
    expect(mainLayoutSource).toContain("const shouldRenderMobileBottomNav = !shouldSuppressMobileBottomNav;");
    expect(mainLayoutSource).not.toContain(
      "const shouldRenderMobileBottomNav = !shouldSuppressNoncriticalChrome;",
    );
    const mobileBottomNavSuppressionBlock =
      mainLayoutSource.match(
        /const shouldSuppressMobileBottomNav =([\s\S]*?)const shouldRenderMobileBottomNav/,
      )?.[1] ?? "";
    expect(mobileBottomNavSuppressionBlock).toContain('pathname?.startsWith("/auth/")');
    expect(mobileBottomNavSuppressionBlock).not.toContain('pathname?.startsWith("/admin")');
    expect(mobileBottomNavSuppressionBlock).not.toContain('pathname === "/feed"');
    expect(mobileBottomNavSuppressionBlock).not.toContain('pathname === "/stamp"');
    expect(mobileBottomNavSuppressionBlock).not.toContain('pathname === "/leaderboard"');
    expect(overlayLayoutSource).toContain("routeDirectPanelParam !== null");
    expect(overlayLayoutSource).toContain("shouldSuppressNoncriticalChromeForPathname(pathname)");
    expect(overlayLayoutSource).toContain(
      "const directPanelParam = isHomeRoute ? null : routeDirectPanelParam",
    );
    expect(combinedPopupSource).toContain('data-popup-overlay="true"');
    expect(testHelpersSource).toContain('[data-popup-overlay="true"]');
  });

  test("direct utility routes render clear fallback states instead of blank or invalid panel configs", () => {
    const resetPasswordSource = source("app/auth/reset-password/page.tsx");
    const authRequiredSource = source("app/auth/required/page.tsx");
    const globalMapSource = source("app/global-map/page.tsx");
    const middlewareSource = source("lib/supabase/middleware.ts");

    expect(resetPasswordSource).not.toContain(`if (!isValidSession) {
        return null;
    }`);
    expect(resetPasswordSource).toContain(
      "비밀번호 재설정 링크를 확인해주세요",
    );
    expect(resetPasswordSource).toContain("홈으로 돌아가기");
    expect(authRequiredSource).toContain("로그인이 필요합니다");
    expect(authRequiredSource).not.toContain(
      "관리자 콘솔은 관리자 계정으로 로그인한 뒤 사용할 수 있습니다.",
    );
    expect(authRequiredSource).toContain("buildHomeAuthLoginPath");
    expect(authRequiredSource).toContain(
      "마이페이지는 로그인한 뒤 사용할 수 있습니다.",
    );
    expect(middlewareSource).toContain(
      "new URL('/auth/required', request.url)",
    );
    expect(middlewareSource).toContain(
      "redirectUrl.searchParams.set('reason', reason)",
    );
    expect(middlewareSource).toContain(
      "redirectAdminLoginWithSessionCookies",
    );
    expect(middlewareSource).toContain("AUTH_LOGIN_QUERY_VALUE");
    expect(middlewareSource).toContain("redirectAdminHomeWithSessionCookies");
    expect(middlewareSource).toContain("const isMyPageRequest");
    expect(middlewareSource).toContain(
      "pathname === '/mypage' || pathname.startsWith('/mypage/')",
    );
    expect(middlewareSource).toMatch(
      /const getCanonicalSameOriginNextPath = \(request: NextRequest\) => \{[\s\S]*?const requestedPath = `\$\{pathname\}\$\{search\}`;[\s\S]*?decodeURIComponent\(requestedPath\);[\s\S]*?return getSafeAuthNextPath\(requestedPath\);/,
    );
    expect(middlewareSource).toContain(
      "redirectMyPageAuthRequiredWithSessionCookies",
    );
    expect(globalMapSource).toContain(
      'defaultSize={panelRestaurant && isPanelOpen ? "75%" : "100%"}',
    );
    expect(globalMapSource).toContain('minSize="40%"');
    expect(globalMapSource).toContain('maxSize="100%"');
    expect(globalMapSource).toContain('data-global-map-panel="map"');
    expect(globalMapSource).toContain(
      'aria-label={isGridMode ? "단일 지도 보기" : "국가별 지도 보기"}',
    );
    expect(globalMapSource).toContain("restaurantMatchesOverseasCountry");
    expect(source("lib/overseas-region-matching.ts")).toContain(
      "getOverseasSearchTermsForCountry",
    );
    expect(source("components/filters/CategoryFilter.tsx")).toContain(
      "buildOverseasCountryAddressOrFilter(selectedCountry,",
    );
    expect(source("hooks/use-google-maps.tsx")).toContain(
      "window.gm_authFailure",
    );
    const mapViewSource = source("components/map/MapView.tsx");
    expect(mapViewSource).toContain("hasGoogleRuntimeError");
    expect(mapViewSource).toContain(
      "This page didn't load Google Maps correctly",
    );
    expect(mapViewSource).toContain(
      "markersRef.current.push({ marker, restaurantId: restaurant.id });",
    );
    expect(mapViewSource).toContain(
      "const restaurant = restaurantsById.get(restaurantId);",
    );
    expect(mapViewSource).toContain(
      "console.warn('MapView: Advanced marker creation skipped', { restaurantId: restaurant.id });",
    );
    expect(mapViewSource).toContain(
      "console.warn('MapView: keeping previous valid bounds after bounds query failure');",
    );
    expect(source("lib/map-view-state-helpers.ts")).toContain(
      "throw new Error('Google Maps bounds contain non-finite coordinates')",
    );
    expect(globalMapSource).not.toContain(
      "defaultSize={panelRestaurant && isPanelOpen ? 75 : 100} minSize={40} maxSize={80}",
    );
  });

  test("admin utility APIs stay behind admin auth and short URLs cannot become open redirects", () => {
    const proxySource = source("proxy.ts");
    const naverSearchSource = source("app/api/naver-search/route.ts");
    const naverGeocodeSource = source("app/api/naver-geocode/route.ts");
    const youtubeMetaSource = source("app/api/youtube-meta/route.ts");
    const authCallbackSource = source("app/auth/callback/route.ts");
    const authRedirectSource = source("lib/auth/auth-redirect.ts");
    const shortenSource = source("app/api/shorten/route.ts");
    const shortRedirectSource = source("app/s/[code]/page.tsx");
    const publicEligibilitySource = source("lib/auth/public-eligibility-session.ts");

    expect(proxySource).not.toContain("'/api/naver-'");
    expect(proxySource).not.toContain("'/api/youtube-meta'");
    expect(publicEligibilitySource).toContain("'/api/shorten'");
    for (const routeSource of [
      naverSearchSource,
      naverGeocodeSource,
      youtubeMetaSource,
    ]) {
      expect(routeSource).toContain(
        "import { requireAdmin } from '@/lib/auth/require-admin';",
      );
      expect(routeSource).toContain("const auth = await requireAdmin();");
      const authIndex = routeSource.indexOf("const auth = await requireAdmin();");
      const requestParseIndex = routeSource.indexOf("readBoundedJsonRequest(request");
      expect(requestParseIndex).toBeGreaterThanOrEqual(0);
      expect(authIndex).toBeLessThan(requestParseIndex);
    }

    expect(shortenSource).toContain("function getAllowedShortUrlTarget");
    expect(shortenSource).toContain("function getRequesterBucket");
    expect(shortenSource).toContain("createHmac('sha256', privacyHashKey)");
    expect(shortenSource).toContain(".rpc('allocate_short_url', {");
    expect(shortenSource).toContain("if (allocation.rate_limited) {");
    expect(shortenSource).toContain("'Retry-After': String(Math.max(1, allocation.retry_after_seconds))");
    expect(shortenSource).toContain("export const runtime = 'nodejs';");
    expect(shortenSource).toContain("import { createHmac, randomInt } from 'node:crypto';");
    expect(shortenSource).toContain("randomInt(SHORT_CODE_ALPHABET.length)");
    expect(shortenSource).not.toContain("Math.random() * chars.length");
    expect(shortenSource).toContain("trimmedTargetUrl.startsWith('//')");
    expect(shortenSource).toContain("function isValidReviewId");
    expect(shortenSource).toContain(".from('reviews')");
    expect(shortenSource).toContain(".maybeSingle();");
    expect(shortenSource).toContain(
      "p_target_url: allowedTarget.canonicalTargetUrl,",
    );
    expect(shortenSource).toContain("p_restaurant_id: review.restaurant_id,");
    expect(shortenSource).toContain("p_review_id: allowedTarget.reviewId,");
    expect(shortenSource).not.toContain("restaurantId || null");
    expect(shortenSource).not.toContain("restaurantName || null");
    expect(shortenSource).not.toContain(
      "SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY",
    );
    expect(shortRedirectSource).toContain("function isSafeRedirectTarget");
    expect(shortRedirectSource).toContain("trimmedTargetUrl.startsWith('//')");
    expect(shortRedirectSource).toContain(
      "isValidReviewId(target.searchParams.get",
    );
    expect(shortRedirectSource).toContain("redirect('/');");
    expect(authCallbackSource).toContain("function getTrustedRedirectOrigin");
    expect(authCallbackSource).toContain("getSafeAuthNextPath(searchParams.get('next'))");
    expect(authRedirectSource).toContain("export function getSafeAuthNextPath");
    expect(authRedirectSource).toContain("next.startsWith('//')");
    expect(authRedirectSource).toContain("SAFE_AUTH_NEXT_PATH_PATTERN");
    expect(authCallbackSource).not.toContain("if (!next.startsWith('/'))");
    expect(authCallbackSource).toContain("DEFAULT_PRODUCTION_REDIRECT_ORIGIN");
    expect(authCallbackSource).toContain("https://www.tzudong.app");
    expect(authCallbackSource).toContain("NEXT_PUBLIC_SITE_URL");
    expect(authCallbackSource).toContain("new URL(configuredSiteUrl).origin");
    expect(authCallbackSource).toContain(
      "process.env.NODE_ENV !== 'production'",
    );
    expect(authCallbackSource).toContain("new URL(requestOrigin).origin");
    expect(authCallbackSource).toContain(
      "return DEFAULT_PRODUCTION_REDIRECT_ORIGIN;",
    );
    expect(authCallbackSource).toContain("getTrustedRedirectOrigin(origin)}");
    expect(authCallbackSource).not.toContain("x-forwarded-host");
    expect(shortenSource).toContain(
      "const DEFAULT_SITE_ORIGIN = 'https://www.tzudong.app';",
    );
    expect(shortenSource).toContain("process.env.NODE_ENV !== 'production'");
    expect(shortenSource).toContain("return DEFAULT_SITE_ORIGIN;");
  });

  test("feed direct route defers heavy modals and detail panels until interaction", () => {
    const feedPageSource = source("app/feed/page.tsx");
    const feedContentSource = source("components/feed/FeedContent.tsx");
    const homeSidePanelsSource = source("app/home-client-sidepanels.tsx");
    const reviewModalSource = source("components/reviews/ReviewModal.tsx");

    expect(homeSidePanelsSource).toContain('presentation="map-panel"');
    expect(homeSidePanelsSource).not.toContain('presentation="inline"');
    expect(reviewModalSource).toContain("presentation?: 'auto' | 'map-panel'");
    expect(reviewModalSource).toContain("shouldRenderMapPanel");
    expect(reviewModalSource).toContain('data-desktop-map-review-panel="true"');
    expect(reviewModalSource).toContain('role="dialog"');
    expect(reviewModalSource).toContain("tabIndex={-1}");
    expect(reviewModalSource).toContain(
      "desktopReviewMapPanelRef.current?.focus({ preventScroll: true })",
    );
    expect(reviewModalSource).toContain(
      "desktopReviewMapPanelOpenerRef.current?.focus({ preventScroll: true })",
    );
    expect(reviewModalSource).toContain(
      'data-desktop-map-review-drag-handle={shouldRenderMapPanel ? "true" : undefined}',
    );
    expect(reviewModalSource).toContain(
      'role={shouldRenderMapPanel ? "group" : undefined}',
    );
    expect(reviewModalSource).toContain(
      "tabIndex={shouldRenderMapPanel ? 0 : undefined}",
    );
    expect(reviewModalSource).toContain(
      'aria-label={shouldRenderMapPanel ? "리뷰 작성 창 이동 핸들" : undefined}',
    );
    expect(reviewModalSource).toContain(
      "onKeyDown={shouldRenderMapPanel ? handleDesktopReviewMapPanelKeyDown : undefined}",
    );
    expect(reviewModalSource).toContain(
      "getDesktopReviewMapPanelKeyboardDelta(event.key)",
    );
    expect(reviewModalSource).toContain("mobileSheetStyles.frame");
    expect(reviewModalSource).toContain(
      "handleDesktopReviewMapPanelPointerDown",
    );
    expect(reviewModalSource).toContain("setPointerCapture(event.pointerId)");
    expect(reviewModalSource).toContain(
      "releasePointerCapture(event.pointerId)",
    );
    expect(reviewModalSource).toContain(
      "style={{ transform: `translate3d(${desktopReviewMapPanelPosition.x}px, ${desktopReviewMapPanelPosition.y}px, 0)` }}",
    );

    expect(feedPageSource).toContain("const RestaurantDetailPanel = dynamic(");
    expect(feedPageSource).toContain("const ReviewModal = dynamic(");
    expect(feedPageSource).toContain("const EditRestaurantModal = dynamic(");
    expect(feedPageSource).not.toContain(
      "import { RestaurantDetailPanel } from '@/components/restaurant/RestaurantDetailPanel';",
    );
    expect(feedPageSource).toContain("{isReviewModalOpen && (");
    expect(feedContentSource).toContain("const ReviewModal = dynamic(");
    expect(feedContentSource).toContain("const ReviewEditModal = dynamic(");
    expect(feedContentSource).toContain(
      "{!hideReviewModal && isReviewModalOpen && (",
    );
    expect(feedContentSource).toContain("{editingReview && (");
  });

  test("/mypage avoids client-side redirect work and defers desktop-only sidebar cost", () => {
    const myPageSource = source("app/mypage/page.tsx");
    const myPageLayoutSource = source("app/mypage/layout.tsx");
    const myPageLayoutContentSource = source(
      "app/mypage/mypage-layout-content.tsx",
    );
    const myPageLoadingSource = source("app/mypage/loading.tsx");
    const myPageSidebarSource = source("components/mypage/MyPageSidebar.tsx");
    const myPageTopActionsSource = source(
      "components/mypage/MyPageTopActions.tsx",
    );
    const returnToMapButtonSource = source(
      "components/layout/ReturnToMapButton.tsx",
    );
    const myPageSectionSkeletonSource = source(
      "components/mypage/MyPageSectionSkeleton.tsx",
    );
    const myPageProfileSource = source("app/mypage/profile/page.tsx").replace(/\r\n/g, "\n");
    const myPageSectionSources = [
      source("app/mypage/bookmarks/page.tsx"),
      source("app/mypage/reviews/page.tsx"),
      source("app/mypage/submissions/new/page.tsx"),
      source("app/mypage/submissions/edit/page.tsx"),
      source("app/mypage/submissions/recommend/page.tsx"),
    ];

    expect(myPageSource).toContain('redirect("/mypage/submissions/new")');
    expect(myPageSource).not.toContain('"use client"');
    expect(myPageSource).not.toContain("useEffect");
    expect(myPageSource).not.toContain("useRouter");
    expect(myPageLayoutSource).toContain("<AppRuntimeLayout>");
    expect(myPageLayoutContentSource).toContain("dynamic(");
    expect(myPageLayoutContentSource).not.toContain(
      "function MyPageMobileBrandHeader()",
    );
    expect(myPageLayoutContentSource).not.toContain(
      'data-mypage-mobile-brand-logo="true"',
    );
    expect(myPageLayoutContentSource).not.toContain(
      "<MyPageMobileBrandHeader />",
    );
    expect(myPageLayoutContentSource).toContain(
      'data-mypage-viewport-layout="edge-to-edge"',
    );
    expect(myPageLayoutContentSource).not.toContain(
      'data-mypage-return-slot="true"',
    );
    expect(myPageLayoutContentSource).not.toContain(
      'className="mb-2 hidden items-center justify-between gap-3 md:flex"',
    );
    expect(myPageLayoutContentSource).not.toContain(
      'data-mypage-return-skeleton="true"',
    );
    expect(
      myPageLayoutContentSource.match(/<ReturnToMapButton/g)?.length ?? 0,
    ).toBe(0);
    expect(myPageLayoutContentSource).not.toContain(
      '<ReturnToMapButton className="w-fit md:h-9 md:min-h-9 md:px-2.5" />',
    );
    expect(myPageLayoutContentSource).not.toContain("<MyPageTopActions />");
    expect(myPageTopActionsSource).toContain(
      'data-mypage-top-actions="map-style"',
    );
    expect(myPageTopActionsSource).toContain(
      'data-mypage-fullscreen-toggle="true"',
    );
    expect(myPageTopActionsSource).toContain('data-mypage-user-menu="true"');
    expect(myPageTopActionsSource).toContain(
      'useUserProfileIdentity(user?.id ?? "")',
    );
    expect(source("hooks/useUserProfile.ts")).toContain(
      "export function useUserProfileIdentity",
    );
    expect(source("hooks/useUserProfile.ts")).toContain(
      "queryKey: ['user-profile-identity', userId]",
    );
    expect(myPageTopActionsSource).not.toContain("mypage-top-actions-avatar");
    expect(myPageLayoutContentSource).not.toContain(
      '<ReturnToMapButton className="mb-3 w-fit md:hidden" />',
    );
    expect(myPageLayoutContentSource).not.toContain(
      'data-mypage-mobile-return-slot="true"',
    );
    expect(myPageLayoutContentSource).not.toContain(
      'data-mypage-mobile-return-skeleton="true"',
    );
    expect(myPageLayoutContentSource).toContain("w-full max-w-none");
    expect(myPageLayoutContentSource).toContain(
      'data-mypage-content-width="viewport-fill"',
    );
    expect(myPageLayoutContentSource).toContain(
      'data-mypage-content-density="viewport-profile"',
    );
    expect(myPageLayoutContentSource).toContain("md:h-full md:min-h-0");
    expect(myPageLayoutContentSource).toContain(
      "flex min-h-full w-full flex-col",
    );
    expect(myPageLayoutContentSource).not.toContain(
      "md:mx-auto md:w-full md:max-w-6xl",
    );
    expect(myPageLayoutContentSource).not.toContain(
      "container mx-auto h-full min-h-0 max-w-6xl flex",
    );
    expect(myPageLayoutContentSource).toContain("shouldRenderSidebar");
    expect(myPageLayoutContentSource).toContain(
      "function MyPageSidebarExpandedPlaceholder()",
    );
    expect(myPageLayoutContentSource).toContain(
      'data-mypage-left-panel-expanded="pending"',
    );
    expect(myPageLayoutContentSource).toContain(
      "const shouldShowSidebarFrame = userLoading || Boolean(user);",
    );
    expect(myPageLayoutContentSource).toContain(
      "if (!shouldShowSidebarFrame) return null;",
    );
    expect(myPageLayoutContentSource).toContain(
      "function MyPageContentLoadingState()",
    );
    expect(myPageLayoutContentSource).toContain(
      'data-mypage-content-loading="true"',
    );
    expect(myPageLayoutContentSource).toContain(
      'data-mypage-content-actions-skeleton="true"',
    );
    expect(myPageLayoutContentSource).toContain(
      'data-mypage-content-loading-behavior="static-shell-dynamic-skeleton"',
    );
    expect(myPageLayoutContentSource).toContain(
      'data-mypage-content-hero-skeleton="borderless-mobile"',
    );
    expect(myPageLayoutContentSource).toContain(
      "space-y-5 md:rounded-3xl md:border md:border-border md:bg-card md:p-5",
    );
    expect(myPageLayoutContentSource).not.toContain(
      "rounded-3xl border border-border bg-card p-4",
    );
    expect(myPageLayoutContentSource).toContain("STAT_SKELETON_WIDTHS.map");
    expect(myPageLayoutContentSource).toContain("ACTION_SKELETON_WIDTHS.map");
    expect(myPageLayoutContentSource).toContain("<Skeleton");
    expect(myPageLayoutContentSource).not.toContain("<GlobalLoader");
    expect(myPageSectionSkeletonSource).toContain(
      'data-mypage-section-loading="true"',
    );
    expect(myPageSectionSkeletonSource).toContain(
      'data-mypage-section-skeleton-card="borderless-mobile"',
    );
    expect(myPageSectionSkeletonSource).toContain(
      "rounded-2xl bg-muted/30 p-4 md:border md:border-border md:bg-card",
    );
    expect(myPageSectionSkeletonSource).not.toContain(
      "rounded-2xl border border-border bg-card p-4",
    );
    expect(myPageSectionSkeletonSource).toContain("<Skeleton");
    expect(myPageLoadingSource).toContain("return null;");
    expect(myPageLoadingSource).toContain("동적 영역만 해당 위치에서 한 번");
    expect(myPageLoadingSource).not.toContain("<MyPageSectionSkeleton />");
    expect(myPageLoadingSource).not.toContain("animate-pulse");
    for (const sectionSource of myPageSectionSources) {
      expect(sectionSource).toContain("<MyPageSectionSkeleton");
      expect(sectionSource).not.toContain("GlobalLoader");
      expect(sectionSource).not.toContain("fullScreen");
    }
    expect(myPageLayoutContentSource).not.toContain('router.replace("/")');
    expect(myPageLayoutContentSource).not.toContain(
      "requestAuthUi({ source: 'mypage-guard'",
    );
    expect(myPageLayoutContentSource).not.toContain("fullScreen");
    expect(myPageLayoutContentSource).toContain(
      'window.matchMedia("(min-width: 768px)")',
    );
    expect(myPageLayoutContentSource).toContain(
      'data-mypage-mobile-route-header-action="logout"',
    );
    expect(myPageLayoutContentSource).toContain("await signOut();");
    expect(myPageLayoutContentSource).toContain('aria-label="로그아웃"');
    expect(myPageLayoutContentSource).toContain(
      'className="h-9 w-9 shrink-0 rounded-xl text-muted-foreground hover:bg-muted hover:text-foreground"',
    );
    expect(myPageLayoutContentSource).not.toContain("<span>로그아웃</span>");
    expect(myPageSidebarSource).toContain(
      'data-mypage-left-panel-expanded="true"',
    );
    expect(myPageSidebarSource).not.toContain(
      'data-mypage-sidebar-brand="true"',
    );
    expect(myPageSidebarSource).not.toContain(
      'data-mypage-sidebar-logo="true"',
    );
    expect(myPageSidebarSource).not.toContain("ReturnToMapButton");
    expect(myPageSidebarSource).not.toContain(
      'aria-label="쯔동여지도 홈으로 이동"',
    );
    expect(myPageSidebarSource).not.toContain(
      '<span className="truncate">쯔동여지도</span>',
    );
    expect(myPageSidebarSource).not.toContain('src="/logo.png"');
    expect(myPageSidebarSource).toContain(
      'aria-current={isActive ? "page" : undefined}',
    );
    expect(myPageSidebarSource).toContain(
      "focus-visible:ring-2 focus-visible:ring-primary",
    );
    expect(returnToMapButtonSource).toContain(
      'data-return-to-map-button="true"',
    );
    expect(returnToMapButtonSource).toContain("function canUseBrowserBack()");
    expect(returnToMapButtonSource).toContain("window.history.length <= 1");
    expect(returnToMapButtonSource).toContain(
      "new URL(document.referrer).origin === window.location.origin",
    );
    expect(returnToMapButtonSource).toContain("router.back()");
    expect(returnToMapButtonSource).toContain("router.push(fallbackHref)");
    expect(returnToMapButtonSource).toContain('fallbackHref = "/"');
    expect(myPageSidebarSource).toContain('await import("@/lib/image-utils")');
    expect(myPageSidebarSource).not.toContain(
      "import { compressImage } from '@/lib/image-utils'",
    );
    expect(myPageSidebarSource).toContain('import NextImage from "next/image"');
    expect(myPageSidebarSource).toContain(
      'htmlFor="mypage-sidebar-avatar-upload"',
    );
    expect(myPageSidebarSource).toContain('id="mypage-sidebar-avatar-upload"');
    expect(myPageSidebarSource).toContain(
      'className="relative flex h-20 w-20 cursor-pointer items-center justify-center overflow-hidden rounded-full border-2',
    );
    expect(myPageSidebarSource).toContain('aspectRatio: "1 / 1"');
    expect(myPageSidebarSource).toContain('borderRadius: "9999px"');
    expect(myPageSidebarSource).toContain("<NextImage");
    expect(myPageSidebarSource).toContain('sizes="80px"');
    expect(myPageSidebarSource).toContain(
      'className="rounded-full object-cover"',
    );
    expect(myPageSidebarSource).not.toContain("AvatarImage");
    expect(myPageProfileSource).toContain('data-mypage-profile-page="true"');
    expect(myPageProfileSource).toContain(
      'data-mypage-profile-hero="mobile-only"',
    );
    expect(myPageProfileSource).toContain(
      'className="overflow-hidden shadow-none md:hidden"',
    );
    expect(myPageProfileSource).toContain('data-mypage-profile-summary="true"');
    expect(myPageProfileSource).toContain(
      'data-mypage-profile-main-column="true"',
    );
    expect(myPageProfileSource).toContain(
      'data-mypage-profile-side-column="true"',
    );
    expect(myPageProfileSource).toContain(
      'data-mypage-profile-side-layout="matrix"',
    );
    expect(myPageProfileSource).toContain(
      "grid min-w-0 gap-3 sm:gap-5 md:contents",
    );
    expect(myPageProfileSource).toContain(
      'CardTitle className="flex items-center gap-2 text-base"',
    );
    expect(myPageProfileSource).not.toContain("lg:text-xs");
    expect(myPageProfileSource).not.toContain("lg:text-base");
    expect(myPageProfileSource).toContain(
      'data-mypage-profile-density="dashboard-matrix"',
    );
    expect(myPageProfileSource).toContain(
      'data-mypage-profile-viewport-fit="true"',
    );
    expect(myPageProfileSource).toContain("md:min-h-0");
    expect(myPageProfileSource).toContain(
      "md:content-stretch md:items-stretch",
    );
    expect(myPageProfileSource).not.toContain(
      'data-mypage-profile-account-column="true"',
    );
    expect(myPageSidebarSource).toContain(
      'data-mypage-sidebar-nickname-controls="true"',
    );
    expect(myPageSidebarSource).toContain(
      'data-mypage-sidebar-nickname-field="display"',
    );
    expect(myPageSidebarSource).toContain(
      'data-mypage-sidebar-nickname-field="edit"',
    );
    expect(myPageSidebarSource).toContain("수정");
    expect(myPageSidebarSource).toContain("저장");
    expect(myPageSidebarSource).toContain("취소");
    expect(myPageSidebarSource).toContain(
      '<h3 className="truncate text-lg font-bold">{displayName}</h3>',
    );
    expect(myPageSidebarSource).toContain('id="mypage-sidebar-nickname"');
    expect(myPageSidebarSource).toContain(
      'data-mypage-sidebar-session-action="logout"',
    );
    expect(myPageProfileSource).toContain("md:h-full");
    expect(myPageProfileSource).toContain("md:grid-rows-2");
    expect(myPageProfileSource).not.toContain(
      "lg:max-h-[calc(100dvh-6.25rem)]",
    );
    expect(myPageProfileSource).toContain("md:grid-cols-2");
    expect(myPageProfileSource).toContain("lg:gap-3");
    expect(myPageProfileSource).toContain("md:order-1");
    expect(myPageProfileSource).toContain("md:order-2");
    expect(myPageProfileSource).toContain(
      'data-mypage-quick-actions="combined"',
    );
    expect(myPageProfileSource).not.toContain("const profileQuickActions = [");
    expect(myPageProfileSource).toContain("const quickActionSections = [");
    expect(myPageProfileSource).toContain(
      'data-mypage-mobile-quick-actions="grouped"',
    );
    expect(myPageProfileSource).toContain(
      'data-mypage-desktop-tier-dashboard="true"',
    );
    expect(myPageProfileSource).toContain(
      "data-mypage-mobile-action-section={section.id}",
    );
    expect(myPageProfileSource).toContain(
      'data-mypage-mobile-action-row="true"',
    );
    expect(myPageProfileSource).toContain("data-mypage-desktop-tier-progress");
    expect(myPageProfileSource).toContain(
      'data-mypage-desktop-tier-metrics="true"',
    );
    expect(myPageProfileSource).toContain(
      'data-mypage-desktop-recent-activity="true"',
    );
    expect(myPageProfileSource).toContain(
      'data-mypage-password-guidance="true"',
    );
    expect(myPageProfileSource).toContain(
      'data-mypage-danger-zone-guidance="compact"',
    );
    expect(myPageProfileSource).toContain(
      "완전 삭제는 복구할 수 없으며, 서버 미리보기와 읽기검증을 거칩니다.",
    );
    expect(myPageProfileSource).not.toContain("진행 전 확인");
    expect(myPageProfileSource).toContain(
      'className="min-w-0 md:order-2 md:col-start-2 md:row-start-1 md:flex md:h-full md:min-h-0 md:flex-col md:overflow-hidden md:rounded-3xl md:border-border/70 md:bg-background/85 md:shadow-sm md:backdrop-blur-sm"',
    );
    expect(myPageProfileSource).toContain(
      'className="hidden min-w-0 md:order-3 md:col-start-1 md:row-start-2 md:flex md:h-full md:min-h-0 md:flex-col md:overflow-hidden md:rounded-3xl md:border-border/70 md:bg-background/85 md:shadow-sm md:backdrop-blur-sm"',
    );
    expect(myPageProfileSource).toContain(
      'data-mypage-desktop-recent-activity-row="true"',
    );
    expect(myPageProfileSource).toContain("최근 활동");
    expect(myPageProfileSource).toContain("취향 신호");
    expect(myPageProfileSource).toContain("등급 핵심");
    expect(myPageProfileSource).toContain("신뢰도 반영");
    expect(myPageProfileSource).toContain("저장하고 작성한 기록");
    expect(myPageProfileSource).toContain("새 맛집과 정보 수정");
    expect(myPageProfileSource).not.toContain("바로 할 수 있는 일");
    expect(myPageProfileSource).not.toContain(
      "grid grid-cols-2 gap-2 lg:grid-cols-1 xl:grid-cols-2",
    );
    expect(myPageProfileSource).not.toContain("lg:min-h-8 lg:rounded-xl");
    expect(myPageProfileSource).toContain('data-mypage-next-actions="true"');
    expect(myPageProfileSource).not.toContain(
      'data-mypage-mobile-secondary-actions="true"',
    );
    expect(myPageProfileSource).not.toContain(
      'data-mypage-session-card="true"',
    );
    expect(myPageProfileSource).not.toContain(
      'data-mypage-profile-photo-controls="true"',
    );
    expect(
      myPageProfileSource.match(/data-mypage-session-card="true"/g)?.length ??
        0,
    ).toBe(0);
    expect(myPageProfileSource).toContain(
      'className="grid min-w-0 gap-3 sm:gap-5',
    );
    expect(myPageProfileSource).toContain(
      'data-mypage-profile-hero-layout="sidebar-match"',
    );
    expect(myPageProfileSource).toContain(
      "flex flex-col items-center space-y-4 p-6 text-center md:hidden",
    );
    expect(myPageProfileSource).not.toContain(
      "flex flex-col items-center space-y-4 border-b border-border p-6 text-center md:hidden",
    );
    expect(myPageProfileSource).toContain(
      'data-mypage-profile-identity="sidebar-match"',
    );
    expect(myPageProfileSource).not.toContain(
      'data-mypage-profile-hero-layout="standard"',
    );
    expect(myPageProfileSource).not.toContain(
      'data-mypage-profile-identity="standard"',
    );
    expect(myPageProfileSource).toContain(
      "rounded-full border-2 border-border shadow-sm",
    );
    expect(myPageProfileSource).toContain(
      "transition-[border-color,box-shadow]",
    );
    expect(myPageProfileSource).toContain(
      "border-2 border-border shadow-sm transition-[border-color,box-shadow]",
    );
    expect(myPageProfileSource).toContain("truncate text-lg font-bold");
    expect(myPageProfileSource).toContain(
      "truncate text-xs text-muted-foreground",
    );
    expect(myPageProfileSource).toContain("grid w-full grid-cols-3 gap-2 pt-2");
    expect(myPageProfileSource).toContain("useUserProfile");
    expect(myPageProfileSource).toContain("userProfile?.tier");
    expect(myPageProfileSource).toContain("도장");
    expect(myPageProfileSource).toContain("리뷰");
    expect(myPageProfileSource).toContain("좋아요");
    expect(myPageProfileSource).not.toContain(
      'data-mypage-profile-session-action="logout"',
    );
    expect(myPageProfileSource).toContain("const activityActions = [");
    expect(myPageProfileSource).toContain("const reportActions = [");
    expect(myPageProfileSource).toContain(
      "data-mypage-action-group={section.id}",
    );
    expect(myPageProfileSource).not.toContain(
      "const MOBILE_SECONDARY_ACTIONS = [",
    );
    expect(myPageProfileSource).not.toContain("MOBILE_SECONDARY_ACTIONS.map");
    expect(myPageSidebarSource).toContain(
      'className="h-9 w-full rounded-xl text-xs"',
    );
    expect(myPageProfileSource).toContain("내 활동");
    expect(myPageProfileSource).toContain("제보하기");
    expect(myPageProfileSource).not.toContain("지도 환경설정");
    expect(myPageProfileSource).toContain("수정 요청");
    expect(myPageProfileSource).toContain("쯔양 제보");
    expect(myPageProfileSource).toContain(
      "data-mypage-mobile-action-grid={section.id}",
    );
    expect(myPageProfileSource).not.toContain(
      "const PRIMARY_QUICK_ACTION_HREFS = new Set",
    );
    expect(myPageProfileSource).toContain("{user.email}");
    expect(myPageProfileSource).not.toContain("가입일 {joinedDateLabel}");
    expect(myPageProfileSource).not.toContain('href: "/?panel=settings"');
    expect(myPageProfileSource).not.toContain(
      "const profileCompletionPercent = Math.round",
    );
    expect(myPageProfileSource).not.toContain("const joinedDateLabel");
    expect(myPageProfileSource).not.toContain(
      'htmlFor="profile-avatar-upload"',
    );
    expect(myPageProfileSource).not.toContain('id="profile-avatar-upload"');
    expect(myPageProfileSource).toContain(
      'data-mypage-mobile-avatar-controls="true"',
    );
    expect(myPageProfileSource).toContain(
      'htmlFor="mypage-mobile-avatar-upload"',
    );
    expect(myPageProfileSource).toContain('id="mypage-mobile-avatar-upload"');
    expect(myPageProfileSource).toContain(
      'className="relative flex h-24 w-24 cursor-pointer items-center justify-center overflow-hidden rounded-full border-2',
    );
    expect(myPageProfileSource).toContain('sizes="96px"');
    expect(myPageProfileSource).toContain("handleMobileAvatarUpload");
    expect(myPageProfileSource).toContain("handleMobileAvatarDelete");
    expect(myPageProfileSource).toContain('accept="image/*"');
    expect(myPageProfileSource).toContain('aria-label="프로필 사진 변경"');
    expect(myPageProfileSource).toContain('aria-label="프로필 사진 삭제"');
    expect(myPageSidebarSource).toContain(
      'htmlFor="mypage-sidebar-avatar-upload"',
    );
    expect(myPageSidebarSource).toContain('id="mypage-sidebar-avatar-upload"');
    expect(myPageSidebarSource).toContain('aspectRatio: "1 / 1"');
    expect(myPageSidebarSource).toContain('borderRadius: "9999px"');
    expect(myPageSidebarSource).toContain("<NextImage");
    expect(myPageSidebarSource).toContain('sizes="80px"');
    expect(myPageSidebarSource).toContain(
      'className="rounded-full object-cover"',
    );
    expect(myPageSidebarSource).toContain(
      'className="flex h-full w-full items-center justify-center rounded-full bg-muted"',
    );
    expect(myPageSidebarSource).toContain(
      'className="absolute inset-0 flex items-center justify-center rounded-full',
    );
    expect(myPageProfileSource).toContain("현재 비밀번호 숨기기");
    expect(myPageProfileSource).toContain("현재 비밀번호 보기");
    expect(myPageProfileSource).toContain("새 비밀번호 숨기기");
    expect(myPageProfileSource).toContain("새 비밀번호 보기");
    expect(myPageProfileSource).toContain("새 비밀번호 확인 숨기기");
    expect(myPageProfileSource).toContain("새 비밀번호 확인 보기");
    expect(myPageProfileSource).toContain(
      "disabled:bg-muted disabled:text-muted-foreground",
    );
    expect(myPageProfileSource).toContain('data-mypage-danger-zone="true"');
    expect(myPageProfileSource).toContain(
      'data-mypage-danger-zone-layout="matrix-bottom-right"',
    );
    expect(myPageProfileSource).toContain(
      'className="min-w-0 border-border/70 md:order-4 md:col-start-2 md:row-start-2 md:flex md:h-full md:min-h-0 md:flex-col md:overflow-hidden md:rounded-3xl md:bg-background/85 md:shadow-sm md:backdrop-blur-sm"',
    );
    expect(myPageProfileSource).not.toContain("계정 위험 작업");
    expect(myPageProfileSource).not.toContain(
      "자주 쓰지 않는 작업은 한곳에 모았습니다.",
    );
    expect(myPageProfileSource).toContain(
      'className="min-h-0 p-3 md:flex md:flex-1 md:flex-col lg:p-3"',
    );
    expect(myPageProfileSource).toContain(
      'className="group p-1 md:flex md:flex-1 md:flex-col lg:p-0"',
    );
    expect(myPageProfileSource).not.toContain(
      'className="group rounded-2xl border border-border/70 bg-background p-3 md:flex md:flex-1 md:flex-col lg:p-2.5"',
    );
    expect(myPageProfileSource).toContain("<details\n              open");
    expect(myPageProfileSource).toContain("계정 삭제 옵션 보기");
    expect(myPageProfileSource).toContain(
      'className="mt-3 grid gap-2 md:flex-1"',
    );
    expect(myPageProfileSource).not.toContain(
      'data-mypage-danger-zone-impact-grid="true"',
    );
    expect(myPageProfileSource).not.toContain("재로그인 복구");
    expect(myPageProfileSource).not.toContain("리뷰 표시");
    expect(myPageProfileSource).not.toContain(
      'className="mt-3 grid gap-2 sm:grid-cols-2"',
    );
    expect(myPageProfileSource).toContain("h-24 w-24");
    expect(myPageProfileSource).toContain('sizes="96px"');
    expect(myPageProfileSource).not.toContain("AvatarImage");
    expect(myPageProfileSource).not.toContain("sm:h-18 sm:w-18");
  });

  test("page-level loaders keep route fallbacks single-owner while map fallbacks stay embedded", () => {
    const globalLoaderSource = source("components/ui/global-loader.tsx");
    const mapSkeletonSource = source("components/skeletons/MapSkeleton.tsx");
    const globalMapLoadingSource = source("app/global-map/loading.tsx");
    const globalMapPageSource = source("app/global-map/page.tsx");
    const resetPasswordLoadingSource = source(
      "app/auth/reset-password/loading.tsx",
    );
    const resetPasswordPageSource = source("app/auth/reset-password/page.tsx");
    const userProfileLoadingSource = source("app/user/[userId]/loading.tsx");
    const userProfileSkeletonSource = source(
      "components/profile/UserProfileProgressiveSkeleton.tsx",
    );
    const leaderboardLoadingSource = source("app/leaderboard/loading.tsx");

    expect(globalLoaderSource).toContain("h-[var(--full-height,100vh)]");
    expect(mapSkeletonSource).toContain('variant?: "embedded" | "fullscreen"');
    expect(mapSkeletonSource).toContain('decorative?: boolean');
    expect(mapSkeletonSource).toContain('variant = "embedded"');
    expect(mapSkeletonSource).toContain(
      "fixed inset-0 z-50 h-[var(--full-height,100vh)]",
    );
    expect(mapSkeletonSource).toContain("relative h-full min-h-[320px]");
    expect(mapSkeletonSource).toContain(
      'message = "지도 화면을 준비하고 있어요"',
    );
    expect(mapSkeletonSource).toContain('className="sr-only"');
    expect(mapSkeletonSource).not.toContain("bg-[radial-gradient");
    expect(mapSkeletonSource).not.toContain("bg-[linear-gradient");
    expect(mapSkeletonSource).not.toContain("rgba(239,68,68");
    expect(mapSkeletonSource).not.toContain("left-[18%]");
    expect(mapSkeletonSource).not.toContain("rounded-2xl bg-background/90");
    expect(mapSkeletonSource).not.toContain("GlobalLoader");
    expect(mapSkeletonSource).not.toContain("맛있는 발견을 준비하고 있습니다");
    expect(resetPasswordLoadingSource).toContain("return null");
    expect(resetPasswordLoadingSource).toContain("한 번만");
    expect(resetPasswordLoadingSource).not.toContain(
      "<ResetPasswordProgressiveSkeleton />",
    );
    expect(resetPasswordLoadingSource).not.toContain("GlobalLoader");
    expect(resetPasswordPageSource).toContain(
      "<ResetPasswordProgressiveSkeleton />",
    );
    expect(resetPasswordPageSource).not.toContain("animate-spin");
    expect(source("components/auth/ResetPasswordProgressiveSkeleton.tsx")).toContain(
      'data-reset-password-progressive-skeleton="true"',
    );
    expect(source("components/auth/ResetPasswordProgressiveSkeleton.tsx")).toContain(
      'role="status"',
    );
    expect(globalMapLoadingSource).toContain("return null");
    expect(globalMapLoadingSource).toContain("한 번만");
    expect(globalMapLoadingSource).not.toContain("<MapSkeleton");
    expect(globalMapLoadingSource).not.toContain("GlobalLoader");
    expect(globalMapPageSource).toContain("function GlobalMapSearchSkeleton()");
    expect(globalMapPageSource).toContain(
      'data-global-map-search-skeleton="true"',
    );
    expect(globalMapPageSource).toContain("loading: () => null");
    expect(globalMapPageSource).toContain("<Suspense fallback={null}>");
    expect(globalMapPageSource).not.toContain(
      'message="글로벌 지도 모듈을 준비하고 있어요"',
    );
    expect(globalMapPageSource).not.toContain(
      'message={`${country} 지도 캔버스를 준비하고 있어요`}',
    );
    expect(globalMapPageSource).not.toContain('variant="fullscreen"');
    expect(source("components/home/home-map-container.tsx")).toContain(
      "<Suspense fallback={null}>",
    );
    expect(source("components/home/home-map-container.tsx")).not.toContain(
      "<Suspense fallback={<MapSkeleton />}>",
    );
    expect(userProfileLoadingSource).toContain("return null");
    expect(userProfileLoadingSource).toContain("한 번만");
    expect(userProfileLoadingSource).not.toContain(
      "<UserProfileProgressiveSkeleton />",
    );
    expect(userProfileLoadingSource).not.toContain("GlobalLoader");
    expect(userProfileSkeletonSource).toContain(
      'data-user-profile-route-skeleton="true"',
    );
    expect(userProfileSkeletonSource).toContain(
      'data-user-profile-panel-skeleton="true"',
    );
    expect(userProfileSkeletonSource).toContain(
      "export function UserProfileTabSkeleton",
    );
    expect(userProfileSkeletonSource).toContain('live={false}');
    expect(userProfileSkeletonSource).toContain('role={live ? "status" : undefined}');
    expect(source("components/profile/UserProfilePanel.tsx")).toContain(
      "<UserProfileProgressiveSkeleton",
    );
    expect(source("components/profile/UserProfilePanel.tsx")).not.toContain(
      "function UserProfileHeaderSkeleton",
    );
    expect(leaderboardLoadingSource).toContain("return null");
    expect(leaderboardLoadingSource).not.toContain("<LeaderboardSkeleton");
    expect(source("app/leaderboard/page.tsx")).toContain(
      "<LeaderboardSkeleton",
    );
    expect(source("app/loading.tsx")).toContain("return null");
    expect(
      countSourceMatches(source("app/stamp/loading.tsx"), /<StampPageSkeleton\s*\/>/g),
    ).toBe(1);
    expect(source("app/loading.tsx")).not.toContain("<MapSkeleton");
    expect(source("app/home-client-loader.tsx")).not.toContain("<GlobalLoader");
    expect(source("app/home-client-loader.tsx")).toContain(
      'className="sr-only"',
    );
    expect(source("app/feed/page.tsx")).toContain("<GlobalLoader");

    const appLoaderTags = sourceFilesUnder("app").flatMap((relativePath) => {
      const contents = source(relativePath);
      return (contents.match(/<GlobalLoader[\s\S]*?(?:\/>|>)/g) ?? []).map(
        (tag) => ({ relativePath, tag }),
      );
    });

    expect(appLoaderTags.length).toBeGreaterThan(0);
    for (const { relativePath, tag } of appLoaderTags) {
      expect(`${relativePath}: ${tag}`).toContain("fullScreen");
    }
  });

  test("route loading boundaries keep skeleton ownership single-pass", () => {
    const loadingFiles = sourceFilesUnder("app")
      .filter((relativePath) => relativePath.endsWith("/loading.tsx"))
      .sort();
    const routeOwnedSkeletonPages = [
      "app/admin/loading.tsx",
      "app/loading.tsx",
      "app/auth/reset-password/loading.tsx",
      "app/global-map/loading.tsx",
      "app/insights/loading.tsx",
      "app/leaderboard/loading.tsx",
      "app/mypage/loading.tsx",
      "app/user/[userId]/loading.tsx",
    ];

    expect(loadingFiles).toEqual([
      "app/admin/loading.tsx",
      "app/auth/reset-password/loading.tsx",
      "app/global-map/loading.tsx",
      "app/insights/loading.tsx",
      "app/leaderboard/loading.tsx",
      "app/loading.tsx",
      "app/mypage/loading.tsx",
      "app/stamp/loading.tsx",
      "app/user/[userId]/loading.tsx",
    ]);

    for (const relativePath of routeOwnedSkeletonPages) {
      const loadingSource = source(relativePath);
      expect(loadingSource).toContain("return null");
      expect(loadingSource).not.toContain("<Skeleton");
      expect(loadingSource).not.toContain("<MapSkeleton");
      expect(loadingSource).not.toContain("<LeaderboardSkeleton");
      expect(loadingSource).not.toContain("<StampPageSkeleton");
      expect(loadingSource).not.toContain("<UserProfileProgressiveSkeleton");
      expect(loadingSource).not.toContain("<ResetPasswordProgressiveSkeleton");
      expect(loadingSource).not.toContain("<GlobalLoader");
    }

    expect(source("app/stamp/loading.tsx")).toContain("return <StampPageSkeleton />");
    expect(source("app/stamp/loading.tsx")).not.toContain("return null");

    const skeletonOwnerContracts = [
      {
        route: "app/auth/reset-password/loading.tsx",
        owner: "app/auth/reset-password/page.tsx",
        marker: "<ResetPasswordProgressiveSkeleton />",
      },
      {
        route: "app/global-map/loading.tsx",
        owner: "app/global-map/page.tsx",
        marker: "loading: () => null",
      },
      {
        route: "app/leaderboard/loading.tsx",
        owner: "app/leaderboard/page.tsx",
        marker: "<LeaderboardSkeleton",
      },
      {
        route: "app/mypage/loading.tsx",
        owner: "app/mypage/mypage-layout-content.tsx",
        marker:
          'data-mypage-content-loading-behavior="static-shell-dynamic-skeleton"',
      },
      {
        route: "app/stamp/loading.tsx",
        owner: "app/stamp/page.tsx",
        marker: "<StampPageSkeleton />",
      },
      {
        route: "app/user/[userId]/loading.tsx",
        owner: "components/profile/UserProfilePanel.tsx",
        marker: "<UserProfileProgressiveSkeleton",
      },
    ];

    for (const { route, owner, marker } of skeletonOwnerContracts) {
      expect(source(route)).toContain(route === "app/stamp/loading.tsx" ? marker : "return null");
      expect(source(owner)).toContain(
        route === "app/stamp/loading.tsx"
          ? 'data-stamp-loading-behavior="static-shell-dynamic-skeleton"'
          : marker,
      );
    }

    expect(source("app/loading.tsx")).toContain("return null");
    expect(
      countSourceMatches(source("app/stamp/loading.tsx"), /<StampPageSkeleton\s*\/>/g),
    ).toBe(1);
    expect(source("app/loading.tsx")).not.toContain("<MapSkeleton");
    expect(
      countSourceMatches(
        source("app/auth/reset-password/page.tsx"),
        /<ResetPasswordProgressiveSkeleton\s*\/>/g,
      ),
    ).toBe(1);
    expect(
      countSourceMatches(
        source("app/auth/reset-password/loading.tsx"),
        /<ResetPasswordProgressiveSkeleton\b/g,
      ),
    ).toBe(0);
    expect(
      countSourceMatches(
        source("app/leaderboard/page.tsx"),
        /<LeaderboardSkeleton\b/g,
      ),
    ).toBe(1);
    expect(
      countSourceMatches(
        source("app/leaderboard/loading.tsx"),
        /<LeaderboardSkeleton\b/g,
      ),
    ).toBe(0);
    expect(
      countSourceMatches(
        source("components/profile/UserProfilePanel.tsx"),
        /<UserProfileProgressiveSkeleton\b/g,
      ),
    ).toBe(1);
    expect(
      countSourceMatches(
        source("app/user/[userId]/loading.tsx"),
        /<UserProfileProgressiveSkeleton\b/g,
      ),
    ).toBe(0);
    expect(
      countSourceMatches(
        source("app/global-map/page.tsx"),
        /<GlobalMapSearchSkeleton\s*\/>/g,
      ),
    ).toBe(1);
  });

  test("intent-loaded mobile modal shells do not render desktop dialog on the first client paint", () => {
    const deviceTypeSource = source("hooks/useDeviceType.ts");
    const mobileSheetModalPaths = [
      "components/auth/AuthModal.tsx",
      "components/modals/EditRestaurantModal.tsx",
      "components/modals/RestaurantSubmissionModal.tsx",
      "components/profile/NicknameSetupModal.tsx",
      "components/profile/ProfileModal.tsx",
      "components/reviews/ReviewEditModal.tsx",
      "components/reviews/ReviewModal.tsx",
    ];

    expect(deviceTypeSource).toContain(
      "function isBrowserMobileOrTabletViewport()",
    );
    expect(deviceTypeSource).toContain(
      "window.innerWidth <= BREAKPOINTS.tabletMax",
    );
    expect(deviceTypeSource).toContain(
      "export function useImmediateMobileOrTablet()",
    );

    for (const relativePath of mobileSheetModalPaths) {
      const modalSource = source(relativePath);
      expect(modalSource).toContain("useImmediateMobileOrTablet");
      expect(modalSource).not.toContain(
        "const { isMobileOrTablet } = useDeviceType()",
      );
    }

    const authModalSource = source("components/auth/AuthModal.tsx");
    const reviewModalSource = source("components/reviews/ReviewModal.tsx");
    expect(authModalSource).toContain("AUTH_MODAL_DESKTOP_CONTENT_CLASS_NAME");
    expect(authModalSource).toContain("AUTH_MODAL_DESKTOP_CONTENT_STYLE");
    expect(authModalSource).toContain("min(calc(100vw - 2rem), 28rem)");
    expect(authModalSource).toContain("dispatchHomeAuthSessionUpdated");
    expect(reviewModalSource).toContain("<BottomSheet");
    expect(reviewModalSource).toContain("MOBILE_FULL_FORM_SHEET");
    expect(reviewModalSource).toContain("REVIEW_MODAL_SCROLLBARLESS_CLASS");
    expect(reviewModalSource).toContain("[scrollbar-width:'none']");
    expect(reviewModalSource).toContain("[&::-webkit-scrollbar]:hidden");
    expect(reviewModalSource).toContain('layoutSource="review-modal"');
    expect(reviewModalSource).toContain('aria-label="리뷰 작성 단계 진행률"');
    expect(reviewModalSource).toContain(
      "영수증 인증부터 후기 등록까지 3단계로 쉽게 작성해주세요.",
    );
    expect(reviewModalSource).not.toContain(
      'className="fixed inset-0 z-[110] h-[100dvh] bg-background"',
    );
  });

  test("auth user state lookups have Supabase index migration coverage", () => {
    const migrationDir = join(import.meta.dir, "..", "supabase/migrations");
    const migrationFile = readdirSync(migrationDir).find((file) =>
      file.endsWith("_optimize_auth_user_state_indexes.sql"),
    );

    expect(migrationFile).toBeDefined();

    const migrationSource = source(`supabase/migrations/${migrationFile}`);
    expect(migrationSource).toContain("information_schema.columns");
    expect(migrationSource).toContain("profiles_user_id_idx");
    expect(migrationSource).toContain("on public.profiles (user_id)");
    expect(migrationSource).toContain("user_roles_user_id_role_idx");
    expect(migrationSource).toContain("on public.user_roles (user_id, role)");
  });

  test("user-facing Supabase reads avoid wide fanout and redundant stamp fetches", () => {
    const feedSource = source("components/feed/FeedContent.tsx");
    const detailSource = source(
      "components/restaurant/RestaurantDetailPanel.tsx",
    );
    const stampSource = source("app/stamp/page.tsx");
    const leaderboardSource = source("hooks/useLeaderboard.ts");
    const userProfileSource = source("hooks/useUserProfile.ts");
    const myReviewsSource = source("app/mypage/reviews/page.tsx");
    const appIndexMigration = source(
      "supabase/migrations/20260506085634_optimize_app_query_indexes.sql",
    );

    expect(feedSource).toContain("FEED_REVIEW_SELECT");
    expect(feedSource).toContain("Promise.all([");
    expect(feedSource).toContain("likeCount: reviewRow.like_count || 0");
    expect(feedSource).not.toContain(
      ".from('reviews')\n                .select('*')",
    );

    expect(detailSource).toContain("RESTAURANT_DETAIL_REVIEW_SELECT");
    expect(detailSource).toContain(
      "queryKey: ['restaurant-reviews', restaurant?.id, user?.id]",
    );
    expect(detailSource).toContain(
      "const RESTAURANT_DETAIL_REVIEW_STALE_MS = 60 * 1000",
    );
    expect(detailSource).toContain(
      "const RESTAURANT_DETAIL_REVIEW_GC_MS = 5 * 60 * 1000",
    );
    expect(detailSource).toContain(
      "staleTime: RESTAURANT_DETAIL_REVIEW_STALE_MS",
    );
    expect(detailSource).toContain("gcTime: RESTAURANT_DETAIL_REVIEW_GC_MS");
    expect(detailSource).toContain("if (viewMode !== 'reviews') return;");
    expect(detailSource).not.toContain("refetchOnMount: 'always'");
    expect(detailSource).not.toContain("staleTime: 0");
    expect(detailSource).toContain("likeCount: review.like_count || 0");
    expect(detailSource).not.toContain(".select('review_id, user_id')");

    expect(stampSource).toContain("STAMP_REVIEW_SELECT");
    expect(stampSource).toContain("isLoading: isRestaurantsLoading");
    expect(stampSource).not.toContain("queryKey: ['restaurants-stamp']");

    expect(leaderboardSource).toContain(
      "readCompletePublicProfileLeaderboard(supabase, period)",
    );
    expect(leaderboardSource).not.toContain(".from('profiles')");
    expect(leaderboardSource).not.toContain(".from('reviews')");
    expect(userProfileSource).toContain("USER_PROFILE_RESTAURANT_SELECT");
    expect(userProfileSource).toContain("viewerLikesResult");
    expect(userProfileSource).toContain("likeCount: r.like_count || 0");
    expect(myReviewsSource).toContain("MY_REVIEWS_SELECT");
    expect(myReviewsSource).not.toContain('.select("*")');

    expect(appIndexMigration).toContain("restaurants_status_review_count_idx");
    expect(appIndexMigration).toContain(
      "reviews_restaurant_verified_created_idx",
    );
    expect(appIndexMigration).toContain("review_likes_review_user_idx");
    expect(appIndexMigration).toContain(
      "announcements_active_banner_priority_created_idx",
    );
    expect(appIndexMigration).toContain(
      "restaurant_submissions_status_created_idx",
    );
    expect(appIndexMigration).toContain("notifications_user_created_idx");
    expect(appIndexMigration).toContain("ad_banners_active_priority_idx");
    expect(appIndexMigration).toContain("ocr_logs_user_success_created_idx");
  });

  test("admin review queue avoids fetching approved review history", () => {
    const evaluationsSource = source("app/admin/evaluations/page.tsx");

    expect(evaluationsSource).toContain(
      "queryKey: ['admin-reviews-inline', user?.id, isAdmin]",
    );
    expect(evaluationsSource).toContain(".select(ADMIN_REVIEW_SELECT)");
    expect(evaluationsSource).toContain(".eq('is_verified', false)");
    expect(evaluationsSource).toContain(
      ".order('created_at', { ascending: false })",
    );
  });

  test("Supabase reads use explicit response shapes instead of broad selects", () => {
    const broadSelectPattern =
      /(?:\.select\(\s*(['"])\*\1|\.select\(\s*\)|\['select',\s*['"]\*|['"]\*, name:approved_name)/;
    const offenders = ["app", "components", "contexts", "hooks", "lib"]
      .flatMap(sourceFilesUnder)
      .filter((relativePath) => broadSelectPattern.test(source(relativePath)));

    expect(offenders).toEqual([]);

    const restaurantSource = source("hooks/use-restaurants.tsx");
    expect(restaurantSource).toContain("RESTAURANT_MERGE_SELECT");
    expect(restaurantSource).not.toContain("'unique_id'");
    expect(restaurantSource).not.toContain("'ai_rating'");
    expect(restaurantSource).not.toContain("'visit_count'");
    expect(restaurantSource).not.toContain("'description'");
  });

  test("global chrome assets stay small and cacheable without changing page UI", async () => {
    const layoutSource = source("app/layout.tsx");
    const appRuntimeShellSource = source("app/app-runtime-shell.tsx");
    const appProvidersSource = source("app/app-providers.tsx");
    const appToasterSource = source("components/ui/app-toaster.tsx");
    const toastSource = source("components/ui/toast.tsx");
    const homeRuntimeShellSource = source("app/home-runtime-shell.tsx");
    const noToastSource = source("lib/no-toast.ts");
    const homeAppGlobalsSource = source("app/home-app-globals.css");
    const homeTailwindConfigSource = source("tailwind.home.config.ts");
    const mainLayoutSource = source("components/layout/MainLayout.tsx");
    const headerSource = source("components/layout/Header.tsx");
    const mobileControlSource = source(
      "components/home/MobileControlOverlay.tsx",
    );
    const homeMapUserMenuSource = source("components/home/HomeMapUserMenu.tsx");
    const navigationPrefetcherSource = source(
      "components/layout/NavigationPrefetcher.tsx",
    );
    const mobileBottomNavSource = source(
      "components/layout/MobileBottomNav.tsx",
    );
    const nextConfigSource = source("next.config.mjs");
    const nextConfig = (await importWebConfig()).default;
    const configuredHeaders = await nextConfig.headers();
    const globalSecurityHeaderRoute = configuredHeaders.find(
      (entry) => entry.source === "/:path*",
    );
    expect(globalSecurityHeaderRoute?.headers).toEqual(
      expect.arrayContaining([
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        { key: "X-Frame-Options", value: "DENY" },
        {
          key: "Strict-Transport-Security",
          value: "max-age=31536000; includeSubDomains",
        },
        {
          key: "Permissions-Policy",
          value: "camera=(), microphone=(), geolocation=(self)",
        },
        { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
        { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
        { key: "Origin-Agent-Cluster", value: "?1" },
        { key: "X-DNS-Prefetch-Control", value: "off" },
        { key: "X-Permitted-Cross-Domain-Policies", value: "none" },
      ]),
    );
    const proxySecuritySource = source("proxy.ts");
    const middlewareSecuritySource = source("lib/supabase/middleware.ts");
    expect(proxySecuritySource).toContain("const nonce = btoa(crypto.randomUUID())");
    expect(proxySecuritySource).toContain("requestHeaders.set('x-nonce', nonce)");
    expect(proxySecuritySource).toContain("response.headers.set('Content-Security-Policy', policy)");
    expect(proxySecuritySource).toContain("\"object-src 'none'\"");
    expect(proxySecuritySource).toContain("\"base-uri 'none'\"");
    expect(proxySecuritySource).toContain("\"form-action 'self'\"");
    expect(proxySecuritySource).toContain("\"frame-ancestors 'none'\"");
    expect(proxySecuritySource).toContain("'strict-dynamic'");
    expect(middlewareSecuritySource).toContain("request: { headers: forwardedRequestHeaders }");
    expect(layoutSource).not.toContain('import Script from "next/script"');
    expect(layoutSource).toContain('VIEWPORT_HEIGHT_BOOTSTRAP_SOURCE');
    expect(layoutSource).toContain('nonce={nonce}');
    for (const staticRoute of [
      "/images/:path*",
      "/fonts/:path*",
      "/favicon.ico",
      "/logo.png",
      "/logo.webp",
      "/:icon(favicon-32x32|apple-touch-icon).png",
      "/scripts/:path*",
    ]) {
      const staticRouteHeaders = configuredHeaders.find(
        (entry) => entry.source === staticRoute,
      )?.headers;
      expect(staticRouteHeaders).toEqual(
        expect.arrayContaining(globalSecurityHeaderRoute?.headers ?? []),
      );
    }
    const viewportFixSource = source("public/scripts/viewport-height-fix.js");
    const authContextSource = source("contexts/AuthContext.tsx");
    const faviconPath = join(import.meta.dir, "..", "public/favicon.ico");
    const faviconPngPath = join(
      import.meta.dir,
      "..",
      "public/favicon-32x32.png",
    );
    const appleIconPath = join(
      import.meta.dir,
      "..",
      "public/apple-touch-icon.png",
    );
    const logoWebpPath = join(import.meta.dir, "..", "public/logo.webp");

    expect(statSync(faviconPath).size).toBeLessThan(16 * 1024);
    expect(statSync(faviconPngPath).size).toBeLessThan(8 * 1024);
    expect(statSync(appleIconPath).size).toBeLessThan(32 * 1024);
    expect(statSync(logoWebpPath).size).toBeLessThan(80 * 1024);
    expect(layoutSource).toContain(
      "{ url: '/favicon-32x32.png', sizes: '32x32', type: 'image/png' }",
    );
    expect(layoutSource).toContain(
      "{ url: '/apple-touch-icon.png', sizes: '180x180', type: 'image/png' }",
    );
    expect(layoutSource).toContain('href="https://oapi.map.naver.com"');
    expect(layoutSource).toContain('href="https://openapi.map.naver.com"');
    expect(layoutSource).toContain('href="https://ssl.pstatic.net"');
    expect(layoutSource).toContain('href="https://img.youtube.com"');
    expect(layoutSource).toContain("supabasePreconnectUrl");
    expect(layoutSource).not.toContain("supabaseDnsPrefetchUrl");
    expect(layoutSource).toContain(
      '<link rel="preconnect" href={supabasePreconnectUrl} crossOrigin="anonymous" />',
    );
    expect(layoutSource).toContain(
      '<link rel="preconnect" href="https://oapi.map.naver.com" crossOrigin="anonymous" />',
    );
    expect(layoutSource).not.toContain(
      '<link rel="preconnect" href="https://img.youtube.com" crossOrigin="anonymous" />',
    );
    expect(layoutSource).toContain(
      '<link rel="dns-prefetch" href="https://img.youtube.com" />',
    );
    expect(layoutSource).not.toContain(
      '<link rel="preconnect" href="https://openapi.map.naver.com" crossOrigin="anonymous" />',
    );
    expect(layoutSource).not.toContain(
      '<link rel="preconnect" href="https://ssl.pstatic.net" crossOrigin="anonymous" />',
    );
    expect(layoutSource).toContain(
      '<link rel="dns-prefetch" href="https://openapi.map.naver.com" />',
    );
    expect(layoutSource).toContain(
      '<link rel="dns-prefetch" href="https://ssl.pstatic.net" />',
    );
    expect(layoutSource).toContain('href="//nrbe.map.naver.net"');
    expect(layoutSource).toContain('href="//static.naver.net"');
    expect(layoutSource).toContain('VIEWPORT_HEIGHT_BOOTSTRAP_SOURCE');
    expect(layoutSource).toContain('nonce={nonce}');
    expect(layoutSource).not.toContain('import Script from "next/script"');
    expect(layoutSource).not.toContain('strategy="beforeInteractive"');
    expect(layoutSource).toContain('import localFont from "next/font/local"');
    expect(layoutSource).toContain(
      'import { Noto_Serif_KR } from "next/font/google"',
    );
    expect(layoutSource).toContain("variable: \"--font-pretendard\"");
    expect(layoutSource).toContain("variable: \"--font-display\"");
    expect(layoutSource).toContain('src: "./fonts/pretendard/PretendardVariable.woff2"');
    expect(layoutSource).toContain('weight: "45 920"');
    expect(layoutSource).toContain("preload: false");
    expect(layoutSource).toContain("className={`${pretendard.variable} ${notoSerifKr.variable}`}");
    expect(layoutSource).not.toContain("QueryProvider");
    expect(layoutSource).not.toContain("AppProviders");
    expect(layoutSource).not.toContain("MainLayout");
    expect(appRuntimeShellSource).toContain("import './app-globals.css'");
    expect(source("app/providers.tsx")).toContain(
      "let browserQueryClient: QueryClient | undefined;",
    );
    expect(source("app/providers.tsx")).toContain(
      "browserQueryClient ??= makeQueryClient();",
    );
    expect(appRuntimeShellSource).toContain("<QueryProvider>");
    expect(appRuntimeShellSource).toContain("<AppProviders>");
    expect(appRuntimeShellSource).toContain(
      "<MainLayout>{children}</MainLayout>",
    );
    const siteConfigSource = source("lib/site-config.ts");
    expect(headerSource).toContain("siteConfig.operator.copyrightLabel");
    expect(mobileControlSource).toContain("siteConfig.operator.copyrightLabel");
    expect(homeMapUserMenuSource).toContain(
      "siteConfig.operator.copyrightLabel",
    );
    expect(homeMapUserMenuSource).toContain(
      "siteConfig.operator.businessRegistrationNumber",
    );
    expect(siteConfigSource).toContain("NEXT_PUBLIC_COPYRIGHT_LABEL");
    expect(siteConfigSource).toContain(
      "NEXT_PUBLIC_OPERATOR_BUSINESS_REGISTRATION_NUMBER",
    );
    expect(homeMapUserMenuSource).toContain(
      'aria-label="사업자 정보 펼치기/접기"',
    );
    expect(headerSource).not.toContain("v1.0.0 © 타이니번");
    expect(mobileControlSource).not.toContain("v1.0.0 © 타이니번");
    expect(headerSource).not.toContain("v2.0.0 @ 타이니번");
    expect(mobileControlSource).not.toContain("v2.0.0 @ 타이니번");
    expect(homeMapUserMenuSource).not.toContain("v2.0.0 @ 타이니번");
    expect(appProvidersSource).toContain("<AppToaster />");
    expect(homeRuntimeShellSource).toContain(
      "import { AppToaster } from '@/components/ui/app-toaster';",
    );
    expect(homeRuntimeShellSource).toContain("<AppToaster />");
    expect(noToastSource).toContain(
      'import { toast as appToast } from "@/hooks/use-toast";',
    );
    expect(noToastSource).toContain("createElement(AppToaster)");
    expect(noToastSource).not.toContain("toast-disabled");
    expect(appToasterSource).toContain(
      '<ToastProvider swipeDirection="right">',
    );
    expect(appToasterSource).toContain("usePathname()");
    expect(appToasterSource).toContain(
      "HOME_MAP_TOAST_VIEWPORT_CLASS_NAME",
    );
    expect(appToasterSource).toContain(
      "bottom-[calc(var(--mobile-bottom-nav-effective-height,var(--mobile-bottom-nav-height,60px))+env(safe-area-inset-bottom)+0.75rem)]",
    );
    expect(appToasterSource).not.toContain(
      "top-[calc(env(safe-area-inset-top)+114px)]",
    );
    expect(appToasterSource).toContain(
      "APP_MOBILE_TOAST_VIEWPORT_CLASS_NAME",
    );
    expect(appToasterSource).toContain(
      "bottom-[calc(var(--mobile-bottom-nav-effective-height,var(--mobile-bottom-nav-height,60px))+env(safe-area-inset-bottom)+0.75rem)]",
    );
    expect(appToasterSource).toContain(
      "<ToastViewport className={toastViewportClassName} />",
    );
    expect(appToasterSource).not.toContain(
      "top-[calc(env(safe-area-inset-top)+132px)]",
    );
    expect(appToasterSource).not.toContain(
      "top-[calc(env(safe-area-inset-top)+7.25rem)]",
    );
    expect(toastSource).toContain("z-[250]");
    expect(toastSource).toContain("bottom-4 right-3");
    expect(toastSource).toContain("w-[min(360px,calc(100vw-1.5rem))]");
    expect(toastSource).toContain("sm:w-max");
    expect(toastSource).toContain("sm:max-w-[min(42rem,calc(100vw-2rem))]");
    expect(toastSource).toContain("sm:right-4");
    expect(toastSource).toContain("items-end");
    expect(toastSource).toContain("sm:whitespace-nowrap");
    expect(toastSource).not.toContain("pr-7");
    expect(toastSource).not.toContain("absolute right-2 top-2");
    expect(toastSource).toContain("data-[state=open]:fade-in-0");
    expect(toastSource).not.toContain(
      "data-[state=open]:slide-in-from-top-full",
    );
    expect(toastSource).toContain("opacity-100");
    expect(homeRuntimeShellSource).toContain("import './home-app-globals.css'");
    expect(homeRuntimeShellSource).toContain("function MobileHomeLayout");
    expect(homeRuntimeShellSource).toContain(
      "function HomeRuntimePendingShell",
    );
    expect(homeRuntimeShellSource).not.toContain(
      "function HomeRuntimeProgressiveShell",
    );
    expect(homeRuntimeShellSource).not.toContain(
      "function HomeRuntimeLoadingSpinner",
    );
    expect(homeRuntimeShellSource).not.toContain(
      "<HomeRuntimeProgressiveShell />",
    );
    expect(homeRuntimeShellSource).toContain("const OverlayLayout = lazy(");
    expect(homeRuntimeShellSource).toContain("<QueryProvider>");
    expect(homeRuntimeShellSource).toContain(
      "fallback={<HomeRuntimePendingShell>{children}</HomeRuntimePendingShell>}",
    );
    expect(homeRuntimeShellSource).not.toContain(
      "<MainLayout>{children}</MainLayout>",
    );
    expect(homeAppGlobalsSource).toContain(
      '@config "../tailwind.home.config.ts"',
    );
    expect(homeTailwindConfigSource).toContain("./components/home/**/*");
    expect(homeTailwindConfigSource).not.toContain("./components/admin/");
    expect(homeTailwindConfigSource).not.toContain(
      "./components/restaurant/**/*",
    );
    expect(source("tailwind.home.detail.config.ts")).toContain(
      "./components/restaurant/**/*",
    );
    expect(source("components/map/map-view-deferred-panels.tsx")).toContain(
      "import '@/app/home-detail-globals.css'",
    );
    expect(source("tailwind.home.deferred.config.ts")).toContain(
      "./components/admin/AdminRestaurantModal.tsx",
    );
    expect(source("app/home-client-sidepanels.tsx")).toContain(
      "import './home-deferred-globals.css'",
    );
    expect(source("app/home-frame/page.tsx")).toContain("<HomeRuntimeShell>");
    expect(authContextSource).toContain("HOME_AUTH_BOOTSTRAP_DELAY_MS = 30000");
    expect(source("components/map/NaverMapView.tsx")).not.toContain(
      "NONCRITICAL_MAP_SIDE_EFFECT_DELAY_MS",
    );
    expect(source("components/map/NaverMapView.tsx")).not.toContain(
      "setTimeout(activateNoncriticalMapEffects",
    );
    expect(authContextSource).toContain("shouldDelayAuthBootstrap");
    expect(authContextSource).toContain("hasPersistedSupabaseSessionHint");
    expect(authContextSource).toContain(
      "&& !hasPersistedSupabaseSessionHint()",
    );
    expect(authContextSource).toContain("hasSupabaseAuthSessionHint");
    expect(authContextSource).toContain(
      "shouldBootstrapAuthOnGeneralInteraction",
    );
    expect(authContextSource).not.toContain("AUTH_USER_STATE_CACHE_TTL_MS");
    expect(authContextSource).not.toContain("authUserStateRequests");
    expect(authContextSource).not.toContain("loadAuthUserState");
    expect(authContextSource).toContain("const state = await fetchAuthUserState(userId);");
    expect(authContextSource).toContain("activeAuthUserIdRef");
    expect(authContextSource).toContain(
      "window.setTimeout(startOnce, HOME_AUTH_BOOTSTRAP_DELAY_MS)",
    );
    expect(authContextSource).toContain("signOut({ scope: 'local' })");
    expect(authContextSource).toContain("dispatchHomeAuthSessionUpdated");
    expect(authContextSource).toContain(
      'import("@/integrations/supabase/client")',
    );
    expect(authContextSource).not.toContain("const checkAdminRole");
    expect(authContextSource).not.toContain("const checkProfileStatus");
    expect(authContextSource).not.toContain("import { supabase }");
    expect(source("app/home-runtime-shell.tsx")).toContain(
      "!isPublicRestrictedMode && hasSupabaseAuthSessionHint()",
    );
    expect(source("app/home-runtime-shell.tsx")).toContain(
      "<AnonymousHomeAuthProvider isLoading={isPublicRestrictedMode ? false : hasStoredSession}>",
    );
    expect(source("app/home-runtime-shell.tsx")).toContain(
      "if (!isPublicRestrictedMode) {",
    );
    expect(source("app/home-runtime-shell.tsx")).toContain(
      "if (isPublicRestrictedMode) return;",
    );
    expect(source("lib/auth-ui-events.ts")).toContain(
      "AUTH_UI_SESSION_HINT_GRACE_MS",
    );
    expect(source("lib/auth-ui-events.ts")).toContain(
      "hasSupabaseAuthSessionHint()",
    );
    expect(source("contexts/NotificationContext.tsx")).toContain(
      "import('@/integrations/supabase/client')",
    );
    expect(source("contexts/NotificationContext.tsx")).not.toContain(
      "import { supabase }",
    );
    expect(source("app/home-client-effects.tsx")).not.toContain(
      "@/integrations/supabase/client",
    );
    expect(source("app/home-client-effects.tsx")).toContain(
      "import('./home-supabase-actions')",
    );
    expect(source("app/home-supabase-actions.ts")).toContain(
      "fetchSupabaseRows",
    );
    expect(source("app/home-supabase-actions.ts")).not.toContain(
      "@/integrations/supabase/client",
    );
    expect(source("components/map/NaverMapView.tsx")).not.toContain(
      "@/integrations/supabase/client",
    );
    expect(source("components/map/NaverMapView.tsx")).toContain(
      "NaverMapAnnouncementRuntime",
    );
    expect(source("components/map/NaverMapAnnouncementRuntime.tsx")).toContain(
      "useBannerAnnouncements(true)",
    );
    expect(source("components/map/NaverMapView.tsx")).toContain(
      "NaverMapPresenceRuntime",
    );
    expect(source("components/map/NaverMapView.tsx")).toContain(
      "HydratedDetailRestaurant",
    );
    expect(source("components/map/NaverMapView.tsx")).not.toContain(
      "useRestaurantWithMergeContext",
    );
    expect(source("components/map/NaverMapView.tsx")).not.toContain(
      "import('@/lib/naver-map-presence-client')",
    );
    expect(source("components/map/NaverMapPresenceRuntime.tsx")).toContain(
      "startNaverMapPresence",
    );
    expect(source("components/admin/AdminConsoleOverview.tsx")).toContain(
      'fetch("/api/admin/pending-counts"',
    );
    expect(source("components/admin/AdminConsoleOverview.tsx")).not.toContain(
      "fetchSupabaseExactCount",
    );
    expect(source("components/layout/Header.tsx")).not.toContain(
      "fetchSupabaseExactCount",
    );
    expect(source("components/home/MobileControlOverlay.tsx")).not.toContain(
      "fetchSupabaseExactCount",
    );
    const bottomSheetSource = source("components/ui/bottom-sheet.tsx");
    expect(bottomSheetSource).toContain("dragHeightRafRef");
    expect(bottomSheetSource).toContain("pendingDragHeightRef");
    expect(bottomSheetSource).toContain(
      "scheduleDragHeightRender(nextHeightSafe);",
    );
    expect(bottomSheetSource).toContain("cancelPendingDragHeightRender();");
    expect(bottomSheetSource).toContain("one pending RAF");
    expect(source("components/home/MobileControlOverlay.tsx")).not.toContain(
      "dragTransformRafRef",
    );
    expect(source("components/layout/Header.tsx")).not.toContain(
      "import { supabase }",
    );
    expect(source("components/layout/Header.tsx")).not.toContain(
      "useBookmarks",
    );
    expect(source("components/layout/Header.tsx")).not.toContain(
      "import { RankingWidget }",
    );
    expect(source("components/layout/Header.tsx")).toContain(
      "useDeferredComponent<HeaderDeferredComponentProps>(shouldLoadAuthenticatedHeaderWidgets, loadRankingWidget)",
    );
    expect(source("components/layout/Header.tsx")).toContain(
      "useDeferredComponent<HeaderDeferredComponentProps>(shouldShowHeaderIcons, loadHeaderBookmarkMenuButton)",
    );
    expect(source("components/layout/HeaderBookmarkMenuButton.tsx")).toContain(
      "useBookmarks",
    );
    expect(mainLayoutSource).toContain("if (!hasMounted)");
    expect(mainLayoutSource).toContain("{children}");
    expect(mainLayoutSource).not.toContain(
      'min-h-screen bg-background" aria-hidden="true"',
    );
    expect(mainLayoutSource).toContain("NONCRITICAL_CHROME_DELAY_MS = 0");
    expect(mainLayoutSource).toContain(
      "canMountNoncriticalChrome && !shouldSuppressNoncriticalChrome",
    );
    expect(mainLayoutSource).toContain("<CombinedPopup />");
    expect(navigationPrefetcherSource).not.toContain(
      "HOME_ROUTE_PREFETCH_DELAY_MS = 8000",
    );
    expect(navigationPrefetcherSource).toContain(
      "HOME_ROUTE_PREFETCH_IDLE_TIMEOUT_MS = 2500",
    );
    expect(navigationPrefetcherSource).toContain(
      "runWhenIdle(runPrefetch, HOME_ROUTE_PREFETCH_IDLE_TIMEOUT_MS)",
    );
    expect(navigationPrefetcherSource).not.toContain("homeDelayTimer");
    expect(mobileBottomNavSource).not.toContain(
      "HOME_NAV_PREFETCH_DELAY_MS = 8000",
    );
    expect(mobileBottomNavSource).toContain(
      "HOME_NAV_PREFETCH_IDLE_TIMEOUT_MS = 2500",
    );
    expect(mobileBottomNavSource).toContain(
      "runHomeNavPrefetchWhenIdle(prefetchNavigationTargets)",
    );
    expect(mobileBottomNavSource).toContain("MOBILE_BOTTOM_NAV_BUTTON_STYLE");
    expect(mobileBottomNavSource).toContain("minHeight: 60");
    expect(mobileBottomNavSource).toContain(
      "style={MOBILE_BOTTOM_NAV_BUTTON_STYLE}",
    );
    expect(mobileBottomNavSource).toContain("'mobile-bottom-nav'");
    expect(mobileBottomNavSource).not.toContain("testId: 'submissions'");
    expect(mobileBottomNavSource).not.toContain("label: '제보'");
    expect(mobileBottomNavSource).toContain("'font-sans'");
    expect(mobileBottomNavSource).not.toContain(
      "MOBILE_BOTTOM_NAV_FONT_FAMILY",
    );
    expect(mobileBottomNavSource).not.toContain(
      "fontFamily: MOBILE_BOTTOM_NAV_FONT_FAMILY",
    );
    expect(mobileBottomNavSource).toContain(
      "'text-foreground/65 active:text-foreground'",
    );
    expect(mobileBottomNavSource).toContain(
      "'text-[12px] font-medium leading-none tracking-normal'",
    );
    expect(mobileBottomNavSource).toContain("isActive && 'font-semibold'");
    expect(viewportFixSource).toContain(
      "if (window.CSS?.supports?.('height', '100dvh'))",
    );
    expect(viewportFixSource).toContain(
      "window.requestAnimationFrame(updateViewportHeight)",
    );
    expect(nextConfigSource).toContain("source: '/favicon.ico'");
    expect(nextConfigSource).toContain("source: '/logo.png'");
    expect(nextConfigSource).toContain("source: '/logo.webp'");
    expect(nextConfigSource).toContain(
      "source: '/:icon(favicon-32x32|apple-touch-icon).png'",
    );
    expect(nextConfigSource).toContain("source: '/scripts/:path*'");
    const rootGlobalsSource = source("app/globals.css");
    const appGlobalsSource = source("app/app-globals.css");

    expect(source("tailwind.config.ts")).not.toContain("tailwindcss-animate");
    expect(layoutSource).toContain('import "./globals.css"');
    expect(layoutSource).not.toContain('import "./app-globals.css"');
    expect(appRuntimeShellSource).toContain("import './app-globals.css'");
    expect(homeRuntimeShellSource).not.toContain("import './app-globals.css'");
    expect(rootGlobalsSource).not.toMatch(
      /@import\s+["']tailwindcss["'];?/,
    );
    expect(rootGlobalsSource).not.toContain("@config");
    expect(rootGlobalsSource).toContain(":root {");
    expect(rootGlobalsSource).toContain("box-sizing: border-box");
    expect(rootGlobalsSource).toContain("html {");
    expect(rootGlobalsSource).toContain("body {");
    expect(rootGlobalsSource).toContain("margin: 0;");
    expect(countSourceMatches(appGlobalsSource, /@import\s+["']tailwindcss["'];?/g)).toBe(1);
    expect(countSourceMatches(appGlobalsSource, /@config\s+["']\.\.\/tailwind\.config\.ts["'];?/g)).toBe(1);
    expect(appGlobalsSource).toContain(
      "General-runtime Tailwind v4 owner",
    );
    expect(appGlobalsSource).toContain("@keyframes tz-enter");
    expect(appGlobalsSource).toContain(
      ".slide-in-from-top-\\[48\\%\\]",
    );
  });

  test("restaurant search controls keep accessible names and keyboard-safe rows", () => {
    const restaurantSearchSource = source(
      "components/search/RestaurantSearch.tsx",
    );
    const searchHistorySource = source("hooks/use-search-history.ts");
    const mobileControlSource = source(
      "components/home/MobileControlOverlay.tsx",
    );
    const desktopControlSource = source(
      "components/home/home-desktop-control-panel.tsx",
    );

    expect(restaurantSearchSource).toContain('name="restaurant-search"');
    expect(restaurantSearchSource).toContain('aria-label="맛집 검색어 입력"');
    expect(restaurantSearchSource).toContain('aria-label="검색어 지우기"');
    expect(restaurantSearchSource).not.toContain('role="button"');
    expect(restaurantSearchSource).not.toContain("맛집 이름 검색...");
    expect(restaurantSearchSource).not.toContain("검색 중...");
    expect(restaurantSearchSource).toContain("맛집 이름 검색…");
    expect(restaurantSearchSource).toContain("검색 중…");
    expect(restaurantSearchSource).toContain("isPopularRestaurantsLoading");
    expect(restaurantSearchSource).toContain("인기 맛집을 불러오는 중…");
    expect(restaurantSearchSource).toContain(
      "검색하면 최근 검색 맛집이 여기에 쌓입니다.",
    );
    expect(restaurantSearchSource).toContain(
      "edgeToEdgeInlineLayout?: boolean",
    );
    expect(restaurantSearchSource).toContain(
      "const effectiveMaxItems = maxItems ?? 5",
    );
    expect(restaurantSearchSource).toContain("popularMaxItems?: number");
    expect(restaurantSearchSource).toContain(
      "const effectivePopularMaxItems = popularMaxItems ?? effectiveMaxItems",
    );
    expect(restaurantSearchSource).toContain(
      "const popularRestaurantLimit = Math.max(effectivePopularMaxItems, 5)",
    );
    expect(restaurantSearchSource).toContain(
      'edgeToEdgeInlineLayout && "min-h-0 w-full"',
    );
    expect(restaurantSearchSource).toContain(
      '? "min-h-full border-y px-4 py-6"',
    );
    expect(searchHistorySource).toContain("const MAX_HISTORY = 12");
    expect(countSourceMatches(searchHistorySource, /\.slice\(0, MAX_HISTORY\)/g)).toBe(2);
    expect(restaurantSearchSource).toContain(
      "focus-visible:ring-2 focus-visible:ring-primary",
    );
    expect(restaurantSearchSource).toContain('aria-hidden="true" />');
    expect(mobileControlSource).toContain(
      'name="mobile-home-restaurant-search"',
    );
    expect(desktopControlSource).toContain(
      'name="desktop-left-panel-restaurant-search"',
    );
  });

  test("mobile leaderboard rows keep stats visible inside narrow viewports", () => {
    const leaderboardListSource = source(
      "components/leaderboard/LeaderboardList.tsx",
    );

    expect(leaderboardListSource).toContain(
      "flex w-full max-w-full items-center gap-2 overflow-hidden",
    );
    expect(leaderboardListSource).toContain('"flex-1 basis-0 min-w-0"');
    expect(leaderboardListSource).toContain(
      '"ml-auto flex min-w-max shrink-0 items-center gap-1.5 text-base tabular-nums',
    );
    expect(leaderboardListSource).toContain(
      'data-leaderboard-mobile-stats="no-clip"',
    );
    expect(leaderboardListSource).toContain('aria-hidden="true">❤️</span>');
    expect(leaderboardListSource).toContain("flex-shrink-0 w-8 sm:w-10");
    expect(leaderboardListSource).toContain("font-bold text-base");
    expect(leaderboardListSource).toContain("flex items-center gap-1 shrink-0");
    expect(leaderboardListSource).not.toContain("pl-2 pr-4 sm:px-6");
    expect(leaderboardListSource).not.toContain("max-w-[42vw]");
  });

  test("direct mobile routes use a self-hosted Korean font before fallback stacks", () => {
    const rootLayoutSource = source("app/layout.tsx");
    const rootGlobalsSource = source("app/globals.css");
    const tailwindConfigSource = source("tailwind.config.ts");

    expect(rootLayoutSource).toContain('import localFont from "next/font/local"');
    expect(rootLayoutSource).toContain(
      'import { Noto_Serif_KR } from "next/font/google"',
    );
    expect(rootLayoutSource).toContain("PretendardVariable.woff2");
    expect(rootLayoutSource).toContain('variable: "--font-pretendard"');
    expect(rootLayoutSource).toContain('variable: "--font-display"');
    expect(rootLayoutSource).toContain('subsets: ["latin"]');
    expect(rootLayoutSource).toContain('weight: "45 920"');
    expect(rootLayoutSource).toContain("preload: false");
    for (const staticWeightFile of [
      "Pretendard-Regular.woff2",
      "Pretendard-Medium.woff2",
      "Pretendard-SemiBold.woff2",
      "Pretendard-Bold.woff2",
      "Pretendard-ExtraBold.woff2",
      "Pretendard-Black.woff2",
    ]) {
      expect(rootLayoutSource).not.toContain(staticWeightFile);
    }
    expect(rootLayoutSource).not.toContain("cdn.jsdelivr.net/gh/orioncactus/pretendard");
    expect(rootLayoutSource).toContain("className={`${pretendard.variable} ${notoSerifKr.variable}`}");
    expect(rootGlobalsSource).toContain("--font-sans: var(--font-pretendard");
    expect(rootGlobalsSource).toContain("--font-noto-serif-kr: var(--font-display");
    expect(rootGlobalsSource).toContain("font-family: var(--font-sans);");
    expect(rootGlobalsSource).not.toContain("font-family: var(--font-noto-serif-kr");
    expect(tailwindConfigSource).toContain('"var(--font-sans)"');
    expect(tailwindConfigSource).toContain('"var(--font-display, var(--font-display-fallback))"');
    expect(tailwindConfigSource).toContain('"var(--font-mono)"');
  });
});
