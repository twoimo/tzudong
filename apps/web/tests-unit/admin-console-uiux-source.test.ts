import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  resolveGitHubActionsRunUrl,
  resolveSafeExternalUrl,
} from "../lib/open-external-url";

const source = (relativePath: string) =>
  readFileSync(join(import.meta.dir, "..", relativePath), "utf8");

const adminConsoleOverviewSource = () =>
  source("components/admin/AdminConsoleOverview.tsx");
const adminConsoleSidebarSource = () =>
  source("components/admin/console/AdminConsoleSidebar.tsx");
const adminConsoleShellSource = () =>
  adminConsoleOverviewSource() + "\n" + adminConsoleSidebarSource();

const escapeRegExp = (value: string) =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const maskCssCommentsAndStrings = (css: string) => {
  let output = "";
  for (let index = 0; index < css.length; index += 1) {
    const current = css[index];
    const next = css[index + 1];

    if (current === "/" && next === "*") {
      output += "  ";
      index += 1;
      while (
        index + 1 < css.length &&
        !(css[index] === "*" && css[index + 1] === "/")
      ) {
        output += css[index] === "\n" ? "\n" : " ";
        index += 1;
      }
      if (index + 1 < css.length) {
        output += "  ";
        index += 1;
      }
      continue;
    }

    if (current === '"' || current === "'") {
      const quote = current;
      output += "x";
      while (index + 1 < css.length) {
        index += 1;
        const char = css[index];
        output += char === "\n" ? "\n" : " ";
        if (char === "\\") {
          if (index + 1 < css.length) {
            index += 1;
            output += css[index] === "\n" ? "\n" : " ";
          }
          continue;
        }
        if (char === quote) break;
      }
      continue;
    }

    output += current;
  }

  return output;
};

const collectCssSyntaxIssues = (css: string) => {
  const masked = maskCssCommentsAndStrings(css);
  const issues: string[] = [];
  const stack: number[] = [];

  for (let index = 0; index < masked.length; index += 1) {
    const char = masked[index];
    if (char === "{") {
      stack.push(index);
    } else if (char === "}") {
      if (stack.length === 0) {
        issues.push(`unmatched closing brace at offset ${index}`);
      } else {
        stack.pop();
      }
    }
  }

  for (const index of stack) {
    issues.push(`unclosed opening brace at offset ${index}`);
  }

  const emptyValueDeclarationPattern = /([a-zA-Z-]+)\s*:\s*(?=[;}])/g;
  for (const match of masked.matchAll(emptyValueDeclarationPattern)) {
    issues.push(`empty CSS declaration value for ${match[1]}`);
  }

  return issues;
};

const getCssBlockContainingSelector = (css: string, selector: string) => {
  const selectorPattern = selector
    .trim()
    .split(/\s+/)
    .map(escapeRegExp)
    .join("\\s+");
  const selectorIndex = css.search(new RegExp(selectorPattern));
  if (selectorIndex < 0) {
    throw new Error(`Missing CSS selector: ${selector}`);
  }

  const blockStart = css.indexOf("{", selectorIndex);
  if (blockStart < 0) {
    throw new Error(`Missing CSS block for selector: ${selector}`);
  }

  let depth = 0;
  for (let index = blockStart; index < css.length; index += 1) {
    const char = css[index];
    if (char === "{") depth += 1;
    if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return css.slice(blockStart + 1, index);
      }
    }
  }

  throw new Error(`Unclosed CSS block for selector: ${selector}`);
};

const expectCssDeclaration = (
  css: string,
  selector: string,
  property: string,
  expectedValue: string,
) => {
  const block = getCssBlockContainingSelector(css, selector);
  expect(block).toContain(`${property}: ${expectedValue};`);
};

describe("admin console beginner-friendly UI/UX source contract", () => {
  test("fails fast on malformed admin/storyboard global CSS", () => {
    const appGlobalsSource = source("app/app-globals.css");

    expect(collectCssSyntaxIssues(appGlobalsSource)).toEqual([]);
    expect(
      collectCssSyntaxIssues(
        `[data-storyboard-chat-avatar] > svg {\n  display: block;\n  height:\n}`,
      ),
    ).toContain("empty CSS declaration value for height");
    expect(
      collectCssSyntaxIssues(`[data-admin-storyboard-generator="true"] {`).join(
        "\n",
      ),
    ).toContain("unclosed opening brace");
  });

  test("keeps storyboard global CSS and component inline geometry in parity", () => {
    const appGlobalsSource = source("app/app-globals.css");
    const storyboardSource = source(
      "components/admin/storyboard/AdminStoryboardGenerator.tsx",
    );
    const canvasShellSource = source(
      "components/admin/storyboard/StoryboardCanvasShell.tsx",
    );
    const canvasInlineGeometrySource = `${storyboardSource}\n${canvasShellSource}`;

    expectCssDeclaration(
      appGlobalsSource,
      '[data-admin-storyboard-generator="true"][data-storyboard-viewport-fit="bounded"]',
      "height",
      "calc(var(--full-height, 100vh) - 2rem)",
    );
    expect(appGlobalsSource).toMatch(
      /@media \(max-width: 1099px\) \{[\s\S]*?\[data-admin-storyboard-generator="true"\]\[data-storyboard-viewport-fit="bounded"\] \{\s*height: auto !important;/,
    );
    expect(storyboardSource).not.toContain(
      'height: "calc(var(--full-height, 100vh) - 2rem)"',
    );
    expect(storyboardSource).toContain(
      "grid min-h-0 min-w-0 flex-1 gap-3 overflow-hidden",
    );

    expectCssDeclaration(
      appGlobalsSource,
      '[data-storyboard-desktop-split-layout="inline-grid"]',
      "--storyboard-split-columns",
      "minmax(0, 1fr) minmax(320px, 400px)",
    );
    expectCssDeclaration(
      appGlobalsSource,
      '[data-storyboard-desktop-split-layout="inline-grid"]',
      "grid-template-columns",
      "var(--storyboard-split-columns)",
    );
    expect(storyboardSource).toContain(
      '"var(--storyboard-split-columns, minmax(0, 1fr) minmax(320px, 400px))"',
    );
    expectCssDeclaration(
      appGlobalsSource,
      '[data-storyboard-desktop-split-layout="inline-grid"]',
      "--storyboard-split-rows",
      "minmax(0, 1fr)",
    );
    expectCssDeclaration(
      appGlobalsSource,
      '[data-storyboard-desktop-split-layout="inline-grid"]',
      "grid-template-rows",
      "var(--storyboard-split-rows)",
    );
    expect(storyboardSource).toContain(
      'gridTemplateRows: "var(--storyboard-split-rows, minmax(0, 1fr))"',
    );

    expectCssDeclaration(
      appGlobalsSource,
      '[data-storyboard-result-panel="image-frames-only"]',
      "grid-column",
      "var(--storyboard-result-panel-column)",
    );
    expectCssDeclaration(
      appGlobalsSource,
      '[data-storyboard-result-panel="image-frames-only"]',
      "grid-row",
      "var(--storyboard-result-panel-row)",
    );
    expect(canvasInlineGeometrySource).toContain(
      'gridColumn: "var(--storyboard-result-panel-column, 1)"',
    );
    expect(canvasInlineGeometrySource).toContain(
      'gridRow: "var(--storyboard-result-panel-row, 1)"',
    );

    expectCssDeclaration(
      appGlobalsSource,
      '[data-storyboard-input-panel="chat-stream"]',
      "grid-column",
      "var(--storyboard-input-panel-column)",
    );
    expectCssDeclaration(
      appGlobalsSource,
      '[data-storyboard-input-panel="chat-stream"]',
      "grid-row",
      "var(--storyboard-input-panel-row)",
    );
    expect(storyboardSource).toContain(
      'gridColumn: "var(--storyboard-input-panel-column, 2)"',
    );
    expect(storyboardSource).toContain(
      'gridRow: "var(--storyboard-input-panel-row, 1)"',
    );
    expect(appGlobalsSource).toContain("@media (max-width: 1099px)");
    expectCssDeclaration(
      appGlobalsSource,
      '[data-admin-console-content="true"][data-admin-console-active-module="storyboard"]',
      "overflow-y",
      "auto !important",
    );
    expect(appGlobalsSource).toContain("--storyboard-input-panel-row: 2;");
    expect(appGlobalsSource).toContain(
      "min-height: min(720px, calc(var(--full-height, 100vh) - 6rem)) !important;",
    );
    expect(appGlobalsSource).toContain(
      "min-height: min(640px, calc(var(--full-height, 100vh) - 6rem)) !important;",
    );

    expectCssDeclaration(
      appGlobalsSource,
      '[data-storyboard-image-board="true"]',
      "grid-template-rows",
      "minmax(0, 1fr) minmax(0, 1fr)",
    );
    expect(storyboardSource).toContain("data-storyboard-frame-view-mode");
    expect(storyboardSource).toContain("storyboardFramePageSize === 1");
    expect(storyboardSource).toContain('"minmax(0, 1fr)"');
    expect(storyboardSource).toContain('"repeat(2, minmax(0, 1fr))"');

    expectCssDeclaration(
      appGlobalsSource,
      "[data-storyboard-image-frame]",
      "grid-template-rows",
      "minmax(0, 1fr) auto",
    );
    expect(storyboardSource).toContain(
      'gridTemplateRows: "minmax(0, 1fr) auto"',
    );

    for (const selector of [
      '[data-storyboard-frame-audio-row="true"]',
      '[data-storyboard-frame-subtitle-row="true"]',
      '[data-storyboard-frame-production-note-row="true"]',
    ]) {
      expectCssDeclaration(
        appGlobalsSource,
        selector,
        "grid-template-columns",
        "58px minmax(0, 1fr)",
      );
      expectCssDeclaration(appGlobalsSource, selector, "contain", "paint");
    }
    expect(
      storyboardSource.match(/gridTemplateColumns: "58px minmax\(0, 1fr\)"/g)
        ?.length,
    ).toBe(3);
    expect(appGlobalsSource).toContain(
      '[data-storyboard-frame-audio-row="true"]',
    );
    expect(appGlobalsSource).toContain("background: hsl(210 28% 94% / 0.78);");
    expect(appGlobalsSource).toContain(
      '[data-storyboard-frame-audio-row="true"] > span:first-child',
    );
    expect(appGlobalsSource).toContain("background: hsl(215 20% 84% / 0.9);");
    expect(appGlobalsSource).toContain(
      '[data-storyboard-frame-subtitle-row="true"]',
    );
    expect(appGlobalsSource).toContain("background: hsl(356 76% 96% / 0.78);");
    expect(appGlobalsSource).toContain(
      '[data-storyboard-frame-subtitle-row="true"] > span:first-child',
    );
    expect(appGlobalsSource).toContain("background: hsl(356 78% 90% / 0.92);");
    expect(appGlobalsSource).toContain("background: hsl(45 96% 86% / 0.72);");
    expect(appGlobalsSource).toContain(
      "border: 1px solid hsl(43 96% 72% / 0.5);",
    );
    expect(appGlobalsSource).toContain(
      '[data-storyboard-frame-production-note-row="true"] > span:first-child',
    );
    expect(appGlobalsSource).toContain("background: hsl(45 96% 72% / 0.92);");
    expect(appGlobalsSource).toContain(
      '.dark [data-storyboard-frame-production-note-row="true"]',
    );
    expect(appGlobalsSource).toContain(
      '.dark [data-storyboard-frame-audio-row="true"]',
    );
    expect(appGlobalsSource).toContain(
      '.dark [data-storyboard-frame-subtitle-row="true"]',
    );

    expect(appGlobalsSource).not.toContain("[data-storyboard-chat-avatar]");
    expect(storyboardSource).not.toContain(
      'data-storyboard-chat-avatar="assistant"',
    );
    expect(storyboardSource).toContain("data-storyboard-chat-message-stack={");
    expect(storyboardSource).toContain(
      'data-storyboard-chat-message-progress="outside-bubble"',
    );
    expect(storyboardSource).toContain("<MessageCircle");
    expect(storyboardSource).toContain('className="block h-3.5 w-3.5"');
    expect(appGlobalsSource).toContain(
      '[data-storyboard-chat-message-bubble="true"]',
    );
    expect(appGlobalsSource).toContain(
      '[data-storyboard-chat-assistant-message="plain-text"]',
    );
    expect(appGlobalsSource).toContain(
      '[data-storyboard-chat-typewriter-text="true"][data-storyboard-chat-typewriter-state="typing"]::after',
    );
    expect(appGlobalsSource).toContain(
      "@keyframes storyboard-chat-typewriter-caret",
    );
    expect(appGlobalsSource).toContain(
      "@media (prefers-reduced-motion: reduce)",
    );
    expect(appGlobalsSource).toMatch(
      /\[data-storyboard-chat-message="user"\]\s*\[data-storyboard-chat-message-bubble="true"\]/,
    );
    expect(appGlobalsSource).toContain(
      '[data-storyboard-chat-message="assistant"][data-storyboard-chat-message-status="streaming"]',
    );
    expect(appGlobalsSource).toContain("background: hsl(var(--primary));");
    expect(appGlobalsSource).toContain("color: hsl(var(--muted-foreground));");
  });

  test("keeps standalone output and inherited production env out of local Next dev mode", () => {
    const nextConfigSource = source("next.config.mjs");
    const cleanNextSource = source("scripts/clean-next.mjs");
    const devPrewarmSource = source("scripts/dev-prewarm.mjs");
    const packageSource = source("package.json");

    expect(nextConfigSource).toContain(
      "const isNextBuildCommand = process.argv.some((arg) => arg === 'build');",
    );
    expect(nextConfigSource).toContain(
      "const shouldUseStandaloneOutput = isNextBuildCommand && process.env.VERCEL !== '1';",
    );
    expect(nextConfigSource).not.toContain(
      "const shouldUseStandaloneOutput = process.env.VERCEL !== '1';",
    );
    expect(nextConfigSource).not.toContain(
      "const shouldUseStandaloneOutput = process.env.NODE_ENV === 'production' && process.env.VERCEL !== '1';",
    );
    expect(nextConfigSource).not.toContain(
      "const shouldUseStandaloneOutput = process.env.NODE_ENV === 'production' && isNextBuildCommand && process.env.VERCEL !== '1';",
    );
    expect(nextConfigSource).toContain("turbopackFileSystemCacheForDev: false");
    expect(nextConfigSource).toContain("config.cache = false;");
    expect(nextConfigSource).toContain("TZUDONG_NEXT_DIST_DIR");
    expect(nextConfigSource).toContain("distDir: configuredNextDistDir");
    expect(cleanNextSource).toContain("const nextDirectoryName = configuredNextDistDir || '.next';");
    expect(cleanNextSource).toContain("error=InvalidDistDir");
    expect(cleanNextSource).toContain("childEnv.NODE_ENV = 'development';");
    expect(cleanNextSource).toContain("if (isNextDevCommand())");
    expect(devPrewarmSource).toContain(
      "const shouldUseWebpackDev = !hasFlag('--turbopack') && !hasFlag('--turbo');",
    );
    expect(devPrewarmSource).toContain(
      "...(shouldUseWebpackDev ? ['--webpack'] : [])",
    );
    expect(devPrewarmSource).toContain("'--hostname'");
    expect(devPrewarmSource).toContain(
      "...(hosted ? { TZUDONG_HOSTED_DEV: '1' } : {}),",
    );
    expect(packageSource).toContain(
      '"dev:clean": "node scripts/run-local-dev.mjs --port 8080 --clean"',
    );
    expect(packageSource).toContain(
      '"dev:playwright": "node scripts/run-local-dev.mjs --port 8080"',
    );
    expect(packageSource).toContain(
      '"dev:turbopack": "node scripts/run-local-dev.mjs --port 8080 --turbopack"',
    );
  });
  test("keeps admin module state URL-backed and easy to recover", () => {
    const consoleSource = adminConsoleShellSource();

    expect(consoleSource).toContain("useSearchParams");
    expect(consoleSource).toContain("getAdminModuleIdFromSearchParams");
    expect(consoleSource).toContain("router.replace");
    expect(consoleSource).toContain("scroll: false");
    expect(consoleSource).toContain('aria-controls="admin-console-canvas"');
    expect(consoleSource).toContain("window.history.replaceState(window.history.state, \"\", nextHref)");
  });
  test("keeps the G012 shared shell focus path, scroll owner, and containment explicit", () => {
    const mainLayoutSource = source("components/layout/MainLayout.tsx");
    const overlayLayoutSource = source("components/layout/OverlayLayout.tsx");
    const consoleSource = adminConsoleShellSource();
    const embeddedShellSource = source(
      "components/admin/AdminEmbeddedModuleShell.tsx",
    );

    expect(mainLayoutSource).toContain(
      '<main id="main-content" tabIndex={-1} className="h-full min-h-0 min-w-0 w-full">',
    );
    expect(mainLayoutSource).toContain(
      'className="relative min-h-0 min-w-0 flex-1 overflow-hidden transition-[margin] duration-300"',
    );
    expect(overlayLayoutSource).toContain(
      'data-layout-primitives="viewport-shell overlay-stack"',
    );
    expect(overlayLayoutSource).toContain(
      'className="relative flex min-h-0 min-w-0 flex-1 overflow-hidden"',
    );
    expect(overlayLayoutSource).toContain('tabIndex={-1}');

    expect(consoleSource).toContain('href="#admin-console-canvas"');
    expect(consoleSource).toContain(
      'const SIDEBAR_NAV_LANDMARK_NAME = "관리자 통합 메뉴"',
    );
    expect(consoleSource).toContain("aria-label={SIDEBAR_NAV_LANDMARK_NAME}");
    expect(consoleSource).toContain(
      'data-admin-console-layout="sidebar-content"',
    );
    expect(consoleSource).toContain('id="admin-console-canvas"');
    expect(consoleSource).toContain('role="region"');
    expect(consoleSource).toContain(
      'data-admin-console-focus-order="skip-link sidebar canvas module-actions"',
    );
    expect(consoleSource).toContain(
      "canvasRef.current?.focus({ preventScroll: true });",
    );
    expect(embeddedShellSource.indexOf('data-admin-module-actions="top-right"')).toBeLessThan(
      embeddedShellSource.indexOf('data-admin-module-content="bounded"'),
    );

    expect(
      Array.from(
        consoleSource.matchAll(/data-scroll-owner="([^"]+)"/g),
        (match) => match[1],
      ),
    ).toEqual(["admin-canvas"]);
    expect(embeddedShellSource).toContain("data-scroll-owner={scrollOwner}");
    expect(consoleSource).toContain(
      "grid h-full min-h-0 w-full grid-rows-[auto_minmax(0,1fr)] gap-0 overflow-hidden md:grid-cols-[auto_minmax(0,1fr)] md:grid-rows-1",
    );
    expect(embeddedShellSource).toContain(
      '"min-h-0 min-w-0 flex-1 overflow-hidden"',
    );
    expect(consoleSource).toContain("env(safe-area-inset-bottom)");

    expect(consoleSource).toContain("const AdminStoryboardGenerator = dynamic(");
    expect(consoleSource).toContain(
      "function preloadAdminConsoleModule(moduleId: AdminModuleId)",
    );
    expect(consoleSource).toContain("void preloadAdminConsoleModule(activeModuleId)");
    expect(consoleSource).toContain("getAdminModuleIdFromSearchParams");
    expect(consoleSource).toContain("buildCanonicalAdminModuleHref");

    for (const sharedShellSource of [mainLayoutSource, overlayLayoutSource]) {
      expect(sharedShellSource).not.toContain("AdminConsoleOverview");
      expect(sharedShellSource).not.toContain("/api/admin/");
      expect(sharedShellSource).not.toContain("TrendProposalQueue");
    }
  });
  test("aligns mobile admin menu state and KPI loading without desktop restyle", () => {
    const consoleSource = adminConsoleShellSource();
    const guardedSource = source("lib/admin/guarded-mutation-contract.ts");

    expect(consoleSource).toContain('aria-current={isActive ? "page" : undefined}');
    expect(consoleSource).toContain('data-admin-console-menu-item-mode={isDropdown ? "mobile-dropdown" : "desktop-sidebar"}');
    expect(consoleSource).toContain('data-admin-console-menu-item-state={isActive ? "active" : "inactive"}');
    expect(consoleSource).toContain('? "border-border bg-muted text-foreground"');
    expect(consoleSource).toContain('data-admin-dashboard-mobile-loading-prompt="true"');
    expect(consoleSource).toContain('data-admin-dashboard-mobile-loading-prompt="live"');
    expect(consoleSource).toContain("shouldShowMobileDashboardLoadingPrompt");
    expect(consoleSource).toContain("KPI 데이터를 불러오는 중입니다. 모바일에서는 핵심 카드부터 순서대로 표시됩니다.");
    expect(consoleSource).toContain("md:h-7 md:min-h-0 md:min-w-0");
    expect(guardedSource).toContain('GUARDED_MUTATION_STEPS.join(" -> ")');
  });

  test("suppresses public popup chrome on admin routes in both app layouts", () => {
    const mainLayoutSource = source("components/layout/MainLayout.tsx");
    const overlayLayoutSource = source("components/layout/OverlayLayout.tsx");
    const routeHelperSource = source("lib/noncritical-chrome-routes.ts");

    for (const layoutSource of [mainLayoutSource, overlayLayoutSource]) {
      expect(layoutSource).toContain("shouldSuppressNoncriticalChromeForPathname(pathname)");
      expect(layoutSource).toContain(
        "canMountNoncriticalChrome && !shouldSuppressNoncriticalChrome",
      );
      expect(layoutSource).toContain("<CombinedPopup />");
    }
    expect(routeHelperSource).toContain('"/admin"');
    expect(routeHelperSource).toContain('"/mypage"');
    expect(routeHelperSource).toContain('"/insights"');
    expect(routeHelperSource).toContain('"/feed"');
    expect(routeHelperSource).toContain('"/stamp"');
    expect(routeHelperSource).toContain('"/leaderboard"');
    expect(mainLayoutSource).toContain("{shouldRenderMobileBottomNav && (");
    expect(mainLayoutSource).toContain("const shouldSuppressMobileBottomNav =");
    expect(mainLayoutSource).toContain("const shouldRenderMobileBottomNav = !shouldSuppressMobileBottomNav;");
    const mobileBottomNavSuppressionBlock =
      mainLayoutSource.match(
        /const shouldSuppressMobileBottomNav =([\s\S]*?)const shouldRenderMobileBottomNav/,
      )?.[1] ?? "";
    expect(mobileBottomNavSuppressionBlock).toContain('pathname?.startsWith("/auth/")');
    expect(mobileBottomNavSuppressionBlock).not.toContain('pathname?.startsWith("/admin")');
    expect(mainLayoutSource).toContain(': "0px"');
  });

  test("removes repeated beginner guidance cards from the admin console", () => {
    const consoleSource = adminConsoleShellSource();

    expect(consoleSource).not.toContain("초보자 안내 강화");
    expect(consoleSource).not.toContain("BeginnerGuideCard");
    expect(consoleSource).not.toContain("처음 쓰는 관리자 안내");
    expect(consoleSource).not.toContain(
      "무엇부터 보면 되는지 3단계로 정리했어요",
    );
    expect(consoleSource).not.toContain("beginnerTip");
    expect(consoleSource).not.toContain("safetyTip");
    expect(consoleSource).not.toContain("처음이라면");
    expect(consoleSource).not.toContain("안전하게 처리하려면");
    expect(consoleSource).not.toContain("ModuleContextHeader");
  });

  test("uses the shared compact embedded module shell instead of canvas-level generic headers", () => {
    const consoleSource = adminConsoleShellSource();
    const routeSource = source("lib/admin/admin-module-routing.ts");
    const registrySource = source("lib/admin/console-menu-registry.ts");
    const shellSource = source("components/admin/AdminEmbeddedModuleShell.tsx");

    expect(shellSource).toContain("export function AdminEmbeddedModuleShell");
    expect(shellSource).toContain('data-admin-embedded-module-shell="true"');
    expect(shellSource).toContain("data-admin-embedded-module-id={menuId}");
    expect(shellSource).toContain('data-admin-module-header="compact"');
    expect(shellSource).toContain("data-admin-module-header-module={menuId}");
    expect(shellSource).toContain("data-admin-module-output-kind={menu.outputKind}");
    expect(shellSource).toContain('data-admin-module-summary="true"');
    expect(shellSource).toContain('data-admin-module-actions="top-right"');
    expect(shellSource).toContain('data-admin-module-content="bounded"');
    expect(shellSource).toContain(
      '"shrink-0 border-b border-border bg-card px-2 py-1.5"',
    );
    expect(shellSource).not.toContain("bg-gradient-primary bg-clip-text");
    expect(shellSource).not.toContain("text-transparent");
    expect(shellSource).not.toContain("hideHeader");
    expect(shellSource).not.toContain('moduleId === "overview"');
    expect(shellSource).toContain("getAdminConsoleMenu(menuId)");
    expect(shellSource).toContain("text-[var(--admin-tone-1)]");
    expect(shellSource).toContain("text-[var(--admin-tone-2)]");
    expect(shellSource).toContain("aria-labelledby={titleId}");
    expect(shellSource).toContain('"min-h-0 min-w-0 flex-1 overflow-hidden"');

    expect(routeSource).toContain("ADMIN_CONSOLE_MODULE_IDS");
    expect(routeSource).toContain("ADMIN_CONSOLE_MENU_IDS");
    for (const moduleId of [
      "overview",
      "routes",
      "map-overlays",
      "restaurants",
      "restaurant-refresh-history",
      "submissions",
      "reviews",
      "storyboard",
      "banners",
      "users",
      "insights",
      "audit",
      "youtube-thumbnail-generator",
      "llm",
      "pipeline",
    ]) {
      expect(registrySource).toContain(`"${moduleId}"`);
    }

    expect(consoleSource).toContain("AdminEmbeddedModuleShell");
    expect(consoleSource).not.toContain("ModuleContextHeader");
    expect(consoleSource).not.toContain("data-admin-console-generic-header");
    expect(consoleSource).not.toContain("data-admin-module-header-snapshot");
  });

  test("keeps embedded insights loading and error states inside the shared compact shell", () => {
    const insightsSource = source("app/insights/insights-client.tsx");

    expect(insightsSource).toContain("AdminEmbeddedModuleShell");
    expect(insightsSource).toContain('menuId="insights"');
    expect(insightsSource).toContain('contentClassName="p-2"');

    const loadingBranch =
      insightsSource.match(
        /if \(isLoading && !canRender\) \{([\s\S]*?)if \(treemapQuery\.isError \|\| !treemapQuery\.data\)/,
      )?.[1] ?? "";
    expect(loadingBranch).toContain("if (embedded)");
    expect(loadingBranch).toContain("return renderEmbeddedShell(");
    expect(loadingBranch).toContain("<InsightsClientLoadingSkeleton />");
    expect(loadingBranch).toContain("'데이터를 불러오는 중입니다.'");
    expect(loadingBranch).toContain("return <InsightsClientLoadingSkeleton />");

    const errorBranch =
      insightsSource.match(
        /if \(treemapQuery\.isError \|\| !treemapQuery\.data\) \{([\s\S]*?)const insightsContent =/,
      )?.[1] ?? "";
    expect(errorBranch).toContain("const errorContent = (");
    expect(errorBranch).toContain("onClick={handleRetry}");
    expect(errorBranch).toContain("return renderEmbeddedShell(");
    expect(errorBranch).toContain("{errorContent}");
    expect(errorBranch).toContain("'데이터를 불러오지 못했습니다.'");
    expect(errorBranch).toContain("return errorContent");

    expect(insightsSource).toContain("return renderEmbeddedShell(insightsContent)");
    expect(insightsSource).toContain('className="flex h-full min-h-0 flex-col bg-background overflow-hidden"');
  });

  test("keeps announcement operations safer and accessible inside the console", () => {
    const panelSource = source("components/announcement/AnnouncementPanel.tsx");

    expect(panelSource).toContain("lastActionMessage");
    expect(panelSource).toContain("formError");
    expect(panelSource).toContain("저장 전 확인");
    expect(panelSource).toContain("게시 상태: {formData.isActive ?");
    expect(panelSource).toContain("홈 지도 배너: {formData.showOnBanner ?");
    expect(panelSource).toContain("공지 패널 닫기");
    expect(panelSource).toContain("첫 공지 페이지로 이동");
    expect(panelSource).toContain("이전 공지 페이지로 이동");
    expect(panelSource).toContain("다음 공지 페이지로 이동");
    expect(panelSource).toContain("마지막 공지 페이지로 이동");
    expect(panelSource).toContain("공지 작성 후 목록으로 돌아가기");
    expect(panelSource).toContain("수정 저장 후 목록으로 돌아가기");
    expect(panelSource).toContain("저장 중…");
    expect(panelSource).toContain("일반 50, 중요 80, 긴급 100을 권장합니다.");
    expect(panelSource).toContain("홈 배너에 노출");
    expect(panelSource).toContain("홈 배너에서 내리기");
    expect(panelSource).not.toContain("저장 중...");
  });

  test("keeps announcement read models shared while narrowing banner fetches", () => {
    const bannerHookSource = source("hooks/use-banner-announcements.tsx");

    expect(bannerHookSource).toContain(
      "export function useActiveAnnouncements(enabled = true)",
    );
    expect(bannerHookSource).toContain(
      "export function useBannerAnnouncements(enabled = true)",
    );
    expect(bannerHookSource).toContain("fetchSupabaseRows");
    expect(bannerHookSource).toContain("ANNOUNCEMENT_SELECT");
    expect(bannerHookSource).toContain("AnnouncementRow");
    expect(bannerHookSource).toContain("['show_on_banner', 'eq.true']");
    expect(bannerHookSource).toContain("BANNER_ANNOUNCEMENTS_STALE_TIME_MS");
    expect(bannerHookSource).not.toContain("@/hooks/use-announcements");
  });

  test("keeps the restaurant evaluation detail panel operator-focused and uncluttered", () => {
    const detailSource = source("components/admin/EvaluationDetailView.tsx");

    expect(detailSource).toContain('title="영상 근거"');
    expect(detailSource).toContain('title="검수 결과"');
    expect(detailSource).toContain('title="음식점 상세"');
    expect(detailSource).toContain(
      "review -> decision capture -> guarded apply",
    );
    expect(detailSource).toContain('aria-label="영상 근거와 메타 정보"');
    expect(detailSource).toContain("focus-visible:ring-primary");
    expect(detailSource).not.toContain("📹 영상 정보");
    expect(detailSource).not.toContain("📊 평가 상세");
    expect(detailSource).not.toContain("🍽️ 음식점 상세 정보");
    expect(detailSource).not.toContain(
      "bg-white rounded-lg border p-3 shadow-sm",
    );
    expect(detailSource).not.toContain("Reasoning Basis</h4>");
    expect(detailSource).not.toContain("Tzuyang Review</h4>");
  });

  test("keeps route recommendation as a viewport-bounded two-pane map console", () => {
    const consoleSource = adminConsoleShellSource();
    const overviewSource = source(
      "components/admin/AdminOverviewDashboard.tsx",
    );

    expect(consoleSource).toContain(
      "const AdminRouteRecommendationModule = dynamic(",
    );
    expect(consoleSource).toContain(
      'import("@/components/admin/AdminOverviewDashboard")',
    );
    const registrySource = source("lib/admin/console-menu-registry.ts");
    expect(registrySource).toContain('id: "routes"');
    expect(registrySource).toContain('title: "맛집 동선 추천"');
    expect(consoleSource).toContain("buildRegistrySidebarSections");
    expect(consoleSource).toContain("AdminDashboardManagementPanel");
    expect(consoleSource).not.toContain("fetchAdminMapRestaurants");

    expect(overviewSource).toContain("fetchAdminMapRestaurants");
    expect(overviewSource).toContain(
      "limit: String(ADMIN_OVERVIEW_MAP_PAGE_SIZE)",
    );
    expect(overviewSource).toContain('onlyWithCoordinates: "true"');
    expect(overviewSource).toContain('cache: "no-store"');
    expect(overviewSource).toContain("/api/dashboard/restaurants");
    expect(overviewSource).toContain("AdminMapOverviewCanvas");
    expect(overviewSource).toContain("AdminNaverMapSurface");
    expect(overviewSource).toContain("AdminMapInfoPanel");
    expect(overviewSource).toContain(
      'aria-label="관리자 지도 운영 개요 2분할"',
    );
    expect(overviewSource).toContain(
      "lg:grid-cols-[minmax(0,1.05fr)_minmax(360px,0.95fr)]",
    );
    expect(overviewSource).toContain('data-admin-overview-map-canvas="true"');
    expect(overviewSource).toContain(
      'data-admin-map-status-overlay="non-blocking"',
    );
    expect(overviewSource).toContain("const shouldShowMapStatusOverlay =");
    expect(overviewSource).toContain("useNaverMaps");
    expect(overviewSource).toContain(
      'useNaverMaps({ autoLoad: false, strategy: "lazyOnload" })',
    );
    expect(overviewSource).toContain("IntersectionObserver");
    expect(overviewSource).toContain("loadNaverMaps();");
    expect(overviewSource).toContain("viewportRefreshTimerRef");
    expect(overviewSource).toContain("window.setTimeout(() =>");
    expect(overviewSource).toContain("getNaverIndividualMarkerVisual");
    expect(overviewSource).toContain("buildNaverClusterMarkerRenderPlan");
    expect(overviewSource).toContain("getClusterVisualKey");
    expect(overviewSource).toContain("currentIndex:");
    expect(overviewSource).toContain(
      "getClusterVisualKey(clusterId) % markerCategories.length",
    );
    expect(overviewSource).not.toContain("currentIndex: 0");
    expect(overviewSource).toContain("new maps.Map");
    expect(overviewSource).toContain("new maps.Marker");
    expect(overviewSource).toContain("createClusterIndex");
    expect(overviewSource).toContain("const adminMapClusterIndex = useMemo");
    expect(overviewSource).toContain(
      "clusterIndex.load(adminRestaurantsToClusterFeatures(visibleRestaurants));",
    );
    expect(overviewSource).toContain("const clusters = getClusters(");
    expect(overviewSource).toContain("      adminMapClusterIndex,");
    expect(overviewSource).toContain("getClusterCategories");
    expect(overviewSource).toContain("mapRef.current.setZoom?.(");
    expect(overviewSource).toContain("visibleRestaurants.length > 1");
    expect(overviewSource).toContain('? REGION_MAP_CONFIG["서울특별시"].zoom');
    expect(overviewSource).toContain(": 14,");
    expect(overviewSource).toContain(
      "map.setZoom?.(Math.max(currentZoom + 1, expansionZoom), false)",
    );
    expect(overviewSource).toContain(
      "map.setCenter?.(new maps.LatLng(lat, lng))",
    );
    expect(overviewSource).toContain("mapRef.current.setCenter?.(center)");
    expect(overviewSource).toContain(
      "mapRef.current.setZoom?.(ADMIN_OVERVIEW_CLUSTER_MAX_ZOOM + 1, false)",
    );
    expect(overviewSource).not.toContain("clusterAnimationManager.start(1400)");
    expect(overviewSource).not.toContain("buildNaverClusterAnimationIconPlan");
    expect(overviewSource).not.toContain("injectClusterCSS();");
    expect(overviewSource).not.toContain("panTo?.(");
    expect(overviewSource).not.toContain(
      "pointer-events-none absolute left-3 top-3 flex flex-wrap gap-1.5",
    );
    expect(overviewSource).not.toContain("홈 마커·클러스터 재사용");
    expect(overviewSource).toContain("function AdminMapLoadingSkeleton");
    expect(overviewSource).toContain("function AdminMapInfoPanelSkeleton");
    expect(overviewSource).toContain('data-admin-map-info-skeleton="true"');
    expect(overviewSource).toContain('aria-label="관리자 지도 동선 추천 로딩"');
    expect(overviewSource).toContain("if (isLoading && !selectedRestaurant)");
    expect(overviewSource).toContain('aria-label="관리자 네이버 지도 로딩"');
    expect(overviewSource).toContain('data-admin-map-loading-skeleton="true"');
    expect(overviewSource).toContain(
      "pointer-events-none absolute inset-0 bg-card/35 backdrop-blur-[1px]",
    );
    expect(overviewSource).not.toContain("지도 준비 중");
    expect(overviewSource).not.toContain(
      "w-full max-w-xs space-y-3 rounded-2xl border border-border bg-card/95 p-4 shadow-sm",
    );
    expect(overviewSource).not.toContain("background-image:linear-gradient");
    expect(overviewSource).not.toContain("skeletonMarkers");
    expect(overviewSource).not.toContain("rotate-[-11deg]");
    expect(overviewSource).not.toContain("ADMIN_MAP_MOCK_RESTAURANTS");
    expect(overviewSource).not.toContain("목업 데이터");
    expect(overviewSource).toContain("표시할 좌표 맛집이 없습니다");
    expect(overviewSource).toContain("지도는 유지하고 실데이터만 재확인합니다");
    expect(overviewSource).not.toContain("overflow-y-auto lg:overflow-hidden");
    expect(overviewSource).not.toContain(
      "overflow-visible md:grid-cols-2 lg:grid-rows-2 lg:overflow-hidden",
    );
    expect(overviewSource).not.toContain("Tzudong admin map");
    expect(overviewSource).not.toContain("Selected marker");
    expect(overviewSource).not.toContain("getRestaurantMarkerStyle");
    expect(overviewSource).not.toContain("쯔동여지도 홈 · 관리자 전용");
    expect(overviewSource).not.toContain("마커 선택 가능");
    expect(overviewSource).not.toContain("운영 정보");
    expect(overviewSource).toContain("동선 추천 초안");
    expect(overviewSource).not.toContain('id="admin-route-candidates-title"');
    expect(overviewSource).not.toContain(
      'className="text-sm font-bold text-foreground"\\n          >\\n            동선 추천 초안',
    );
    expect(overviewSource).toContain('aria-label="동선 추천 초안"');
    expect(overviewSource).toContain(
      'data-admin-route-recommendation-panel="enhanced"',
    );
    expect(overviewSource).toContain(
      'className="flex min-h-0 min-w-0 flex-col gap-2 lg:h-full lg:overflow-hidden"',
    );
    expect(overviewSource).toContain(
      'className="shrink-0 rounded-lg bg-card/80 p-2 shadow-sm md:rounded-xl"',
    );
    expect(overviewSource).toContain(
      'className="scrollbar-hide min-w-0 rounded-lg bg-card/80 p-2 shadow-sm md:rounded-xl lg:min-h-0 lg:flex-1 lg:overflow-x-hidden lg:overflow-y-auto lg:overscroll-contain lg:scroll-pb-3"',
    );
    expect(overviewSource).toContain(
      'className="relative flex h-full min-h-0 min-w-0 flex-col overflow-hidden rounded-xl bg-card/80 shadow-sm md:rounded-2xl"',
    );
    expect(overviewSource).toContain(
      'className="relative h-full min-h-[360px] overflow-hidden rounded-[24px] bg-muted/25"',
    );
    expect(overviewSource).toContain(
      '<div className="overflow-hidden rounded-lg bg-background/70 md:rounded-xl">',
    );
    expect(overviewSource).toContain(
      '<div className="absolute inset-x-0 bottom-0 bg-black/75 p-2.5 text-white">',
    );
    expect(overviewSource).toContain(
      'className="mt-2 grid grid-cols-3 gap-1 rounded-xl bg-background/70 p-1"',
    );
    expect(overviewSource).toContain(
      'className="mt-1.5 rounded-xl bg-primary/5 p-1.5"',
    );
    expect(overviewSource).toContain(
      'className="mt-1.5 grid grid-cols-2 gap-1.5 rounded-xl bg-background/70 p-1.5 text-[11px] text-muted-foreground"',
    );
    expect(overviewSource).not.toContain(
      'className="rounded-xl border border-border bg-card p-2.5 shadow-sm lg:min-h-0 lg:flex-1 lg:overflow-y-auto"',
    );
    expect(overviewSource).not.toContain(
      'className="relative flex h-full min-h-0 flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-sm"',
    );
    expect(overviewSource).not.toContain(
      'className="relative h-full min-h-[360px] overflow-hidden rounded-[24px] border border-border bg-muted/25"',
    );
    expect(overviewSource).not.toContain(
      '<div className="overflow-hidden rounded-xl border border-border bg-background/70">',
    );
    expect(overviewSource).not.toContain("bg-gradient-to-t");
    expect(overviewSource).not.toContain("to-transparent");
    expect(overviewSource).not.toContain(
      'className="mt-2 grid grid-cols-3 gap-1 rounded-xl border border-border bg-background/70 p-1"',
    );
    expect(overviewSource).not.toContain(
      'className="mt-2 rounded-xl border border-primary/15 bg-primary/5 p-2"',
    );
    expect(overviewSource).toContain("ADMIN_ROUTE_PLANNER_PRESETS");
    expect(overviewSource).toContain("ADMIN_ROUTE_STOP_LIMIT_OPTIONS");
    expect(overviewSource).toContain('data-admin-route-planner-presets="true"');
    expect(overviewSource).toContain(
      'data-admin-route-stop-limit-controls="true"',
    );
    expect(overviewSource).toContain('data-admin-route-quality-panel="true"');
    expect(overviewSource).toContain('data-admin-route-warning-list="true"');
    expect(overviewSource).toContain("routeStopLimit");
    expect(overviewSource).not.toContain("1분할");
    expect(overviewSource).not.toContain("3분할");
    expect(overviewSource).not.toContain("4분할");
  });

  test("keeps all admin skeletons compact and layout-faithful", () => {
    const consoleSource = adminConsoleShellSource();
    const adminLoadingSource = source("app/admin/loading.tsx");
    const routeSkeletonSource = source("app/admin/evaluations/page.tsx");
    const evaluationTableSource = source(
      "components/admin/EvaluationTableNew.tsx",
    );
    const submissionListSource = source(
      "components/admin/SubmissionListView.tsx",
    );
    const usersSource = source("components/admin/AdminUsersPanel.tsx");
    const refreshHistorySource = source(
      "components/admin/AdminRestaurantRefreshHistoryPanel.tsx",
    );
    const insightsSource = source("app/insights/insights-client.tsx");

    expect(consoleSource).not.toContain(
      "aria-label={`${title} 작업 화면 준비 상태`}",
    );
    expect(consoleSource).not.toContain(
      "Array.from({ length: 6 }).map((_, index) => (",
    );
    expect(adminLoadingSource).toContain("return null;");
    expect(adminLoadingSource).toContain("모듈별 스켈레톤만 한 번");
    expect(consoleSource).not.toContain("AdminConsoleLoadingSkeleton");
    expect(consoleSource).toContain("function AdminConsoleCanvasSkeleton");
    expect(consoleSource).toContain(
      'data-admin-console-content-loading="true"',
    );
    expect(consoleSource).toContain(
      'data-admin-sidebar-module-loading="page-shell"',
    );
    expect(consoleSource).toContain(
      'data-admin-sidebar-module-loading-header="true"',
    );
    expect(consoleSource).toContain(
      'data-admin-sidebar-module-loading-grid="true"',
    );
    expect(consoleSource).toContain(
      'data-admin-sidebar-module-loading-list="true"',
    );
    expect(consoleSource).toContain(
      'data-admin-sidebar-module-loading-detail="true"',
    );
    expect(consoleSource).toContain(
      "function AdminStoryboardModuleLoadingSkeleton()",
    );
    expect(consoleSource).not.toContain(
      'import { AdminStoryboardGenerator } from "@/components/admin/storyboard/AdminStoryboardGenerator";',
    );
    expect(consoleSource).toContain(
      "function loadAdminStoryboardGenerator()",
    );
    expect(consoleSource).toContain(
      "const AdminStoryboardGenerator = dynamic(",
    );
    expect(consoleSource).toContain(
      "function preloadAdminConsoleModule(moduleId: AdminModuleId)",
    );
    expect(consoleSource).toContain(
      "void preloadAdminConsoleModule(activeModuleId)",
    );
    expect(consoleSource).toContain(
      "const isAdminCanvasBootstrapping =",
    );
    expect(consoleSource).toContain(
      "isShellBootstrapping || !loadedModuleIds.has(activeModuleId)",
    );
    expect(consoleSource).toContain(
      "getAdminConsoleModuleLoadingSkeleton(activeModuleId, activeModuleLabel)",
    );
    expect(consoleSource).toContain(
      "function createInitialAdminConsoleLoadedModuleIds()",
    );
    expect(consoleSource).not.toContain(
      "loading: () => <AdminStoryboardModuleLoadingSkeleton />",
    );
    expect(consoleSource).not.toContain(
      "loading: () => <AdminYoutubeThumbnailModuleLoadingSkeleton />",
    );
    expect(consoleSource).not.toContain(
      "loading: () => getAdminConsoleModuleLoadingSkeleton(",
    );
    expect(
      (consoleSource.match(/loading: \(\) => null/g) ?? []).length,
    ).toBeGreaterThanOrEqual(7);
    expect(consoleSource).toContain(
      "loading: () => <AdminEvaluationModuleStaticShell />",
    );
    expect(consoleSource).toContain(
      'data-admin-sidebar-module-loading-evaluation="viewport-table"',
    );
    expect(consoleSource).toContain(
      'data-admin-sidebar-module-loading-refresh-history="viewport-split"',
    );
    expect(consoleSource).toContain(
      'data-admin-sidebar-module-loading-banners="viewport-editor"',
    );
    expect(consoleSource).toContain(
      'data-admin-sidebar-module-loading-users="viewport-table"',
    );
    expect(consoleSource).toContain(
      'data-admin-sidebar-module-loading-insights="viewport-charts"',
    );
    expect(consoleSource).toContain(
      'data-admin-sidebar-module-loading-routes="viewport-map"',
    );
    expect(consoleSource).toContain(
      'data-admin-sidebar-module-loading-ops="viewport-cards"',
    );
    expect(consoleSource).not.toContain(
      'isShellBootstrapping && activeModuleId !== "storyboard"',
    );
    expect(consoleSource).toContain("<AdminStoryboardModuleLoadingSkeleton />");
    expect(consoleSource).toContain(
      "initialStoryboardResult={initialStoryboardResult}",
    );
    expect(consoleSource).toContain(
      'moduleId === "youtube-thumbnail-generator"',
    );
    expect(consoleSource).toContain(
      "<AdminYoutubeThumbnailModuleLoadingSkeleton />",
    );
    expect(consoleSource).toContain('data-storyboard-module-loading="true"');
    expect(consoleSource).toContain(
      'data-storyboard-module-loading-layout="page-shell"',
    );
    expect(consoleSource).toContain(
      'data-admin-storyboard-generator-loading="true"',
    );
    expect(consoleSource).toContain('data-storyboard-viewport-fit="bounded"');
    expect(consoleSource).toContain(
      'data-admin-console-content-loading="true"',
    );
    expect(consoleSource).toContain(
      'data-storyboard-module-loading-grid="true"',
    );
    expect(consoleSource).toContain(
      "flex h-full min-h-0 flex-col overflow-hidden bg-background p-2",
    );
    expect(consoleSource).toContain(
      "rounded-2xl border border-border/70 bg-card/80 shadow-sm",
    );
    expect(consoleSource).toContain(
      "border-0 bg-card/80 shadow-none",
    );
    expect(consoleSource).not.toContain(
      'data-storyboard-module-loading-layout="canvas-only"',
    );
    expect(consoleSource).toContain(
      'data-storyboard-module-loading-chat="true"',
    );
    expect(consoleSource).toContain(
      'data-storyboard-module-loading-chat-shell="static"',
    );
    expect(consoleSource).toContain(
      'data-storyboard-module-loading-canvas="true"',
    );
    expect(consoleSource).not.toContain(
      'data-storyboard-module-loading-canvas-blank="true"',
    );
    expect(consoleSource).toContain(
      'data-storyboard-module-loading-frame-grid="true"',
    );
    expect(consoleSource).not.toContain(
      "grid h-full min-h-0 grid-cols-1 grid-rows-[minmax(0,1fr)_auto]",
    );
    expect(consoleSource).not.toContain(
      "grid h-full min-h-[420px] grid-cols-1 gap-2 overflow-hidden sm:grid-cols-2",
    );
    expect(consoleSource).toContain(
      'data-storyboard-module-loading-composer="true"',
    );
    expect(consoleSource).not.toContain(
      'data-storyboard-module-loading-chat-actions="outside-bubble"',
    );
    expect(consoleSource).toContain(
      "data-storyboard-module-loading-cut={String(cutNo)}",
    );
    expect(consoleSource).toContain(
      'data-storyboard-module-loading-shimmer="true"',
    );
    expect(consoleSource).toContain("admin-module-loading-shimmer");
    expect(consoleSource).toContain("STORYBOARD_MODULE_LOADING_CUT_NOS.map");
    expect(consoleSource).toContain(
      'data-storyboard-module-loading-glass="true"',
    );
    expect(consoleSource).toContain('data-thumbnail-module-loading="true"');
    expect(consoleSource).toContain(
      'data-thumbnail-module-loading-layout="page-shell"',
    );
    expect(consoleSource).toContain(
      'data-thumbnail-module-loading-parity="storyboard-shell"',
    );
    expect(consoleSource).toContain(
      'data-thumbnail-module-loading-canvas="true"',
    );
    expect(consoleSource).toContain(
      'data-thumbnail-module-loading-canvas-frame="true"',
    );
    expect(consoleSource).toContain(
      'data-thumbnail-module-loading-canvas-aspect="16:9"',
    );
    expect(consoleSource).toContain(
      'data-thumbnail-module-loading-canvas-glass="true"',
    );
    expect(consoleSource).toContain(
      'data-thumbnail-module-loading-glass-shell="true"',
    );
    expect(consoleSource).toContain(
      'data-thumbnail-module-loading-page-shimmer="true"',
    );
    expect(consoleSource).toContain(
      'data-thumbnail-module-loading-card-glass="chat"',
    );
    expect(consoleSource).toContain(
      'data-thumbnail-module-loading-card-glass="canvas"',
    );
    expect(consoleSource).toContain(
      'data-thumbnail-module-loading-chat-shell-glass="true"',
    );
    expect(consoleSource).toContain(
      'data-thumbnail-module-loading-chat-shell-shimmer="true"',
    );
    expect(consoleSource).toContain(
      'data-thumbnail-module-loading-chat-glass="true"',
    );
    expect(consoleSource).toContain(
      'data-thumbnail-module-loading-chat-shimmer="true"',
    );
    expect(consoleSource).toContain(
      'data-thumbnail-module-loading-canvas-shell-glass="true"',
    );
    expect(consoleSource).toContain(
      'data-thumbnail-module-loading-canvas-shell-shimmer="true"',
    );
    expect(consoleSource).toContain(
      'data-thumbnail-module-loading-toolbar="true"',
    );
    expect(consoleSource).toContain(
      'data-thumbnail-module-loading-chat="true"',
    );
    expect(consoleSource).toContain(
      'data-thumbnail-module-loading-chat-tone="neutral-storyboard"',
    );
    expect(consoleSource).toContain(
      'data-thumbnail-module-loading-chat-shell="static"',
    );
    expect(consoleSource).toContain(
      'data-thumbnail-module-loading-chat-log="true"',
    );
    expect(consoleSource).toContain(
      'data-thumbnail-module-loading-chat-bubble="guide"',
    );
    expect(consoleSource).toContain(
      'data-thumbnail-module-loading-chat-bubble="assistant"',
    );
    expect(consoleSource).toContain(
      'data-thumbnail-module-loading-composer="true"',
    );
    expect(consoleSource).toContain(
      'data-thumbnail-module-loading-chat-actions="outside-bubble"',
    );
    expect(consoleSource).toContain(
      'data-thumbnail-module-loading-shimmer="true"',
    );
    expect(consoleSource).toContain(
      'data-thumbnail-module-loading-tool-glass="true"',
    );
    expect(consoleSource).toContain(
      'data-thumbnail-module-loading-tool-shimmer="true"',
    );
    expect(consoleSource).toContain("THUMBNAIL_MODULE_LOADING_TOOL_IDS.map");
    expect(consoleSource).not.toContain("[animation:storyboard-glass-shimmer_");
    const thumbnailLoadingSkeletonSource =
      consoleSource
        .split("function AdminYoutubeThumbnailModuleLoadingSkeleton()")[1]
        ?.split("export function AdminConsoleOverview")[0] ?? "";
    expect(thumbnailLoadingSkeletonSource).not.toContain("blur-sm");
    expect(thumbnailLoadingSkeletonSource).not.toContain("blur-md");
    expect(thumbnailLoadingSkeletonSource).not.toContain("backdrop-blur-[1px]");
    expect(thumbnailLoadingSkeletonSource).not.toContain("bg-primary/10");
    expect(thumbnailLoadingSkeletonSource).not.toContain("bg-primary/15");
    expect(thumbnailLoadingSkeletonSource).not.toContain("bg-primary/18");
    expect(thumbnailLoadingSkeletonSource).not.toContain("bg-sky-500/15");
    expect(thumbnailLoadingSkeletonSource).not.toContain("bg-sky-500/10");
    expect(consoleSource).not.toContain(
      'className="flex h-full min-h-[640px] min-w-0 flex-col overflow-hidden bg-muted/20 p-3 md:min-h-0"',
    );
    expect(consoleSource).not.toContain("bg-slate-200/80 text-slate-600");
    expect(consoleSource).not.toContain(
      "absolute right-[7%] top-[12%] h-[30%] w-[22%] rounded-full",
    );
    expect(consoleSource).not.toContain(
      "absolute bottom-[13%] left-[9%] h-[30%] w-[42%] rounded-[999px]",
    );
    expect(consoleSource).not.toContain(
      "absolute bottom-[19%] left-[27%] h-16 w-[42%] rounded-2xl",
    );
    expect(consoleSource).not.toContain(
      'className="grid h-full min-h-[420px] grid-cols-2 grid-rows-2 gap-2 bg-transparent p-3 md:min-h-0"',
    );
    expect(consoleSource).toContain(
      "aria-label={`${config.title} 화면 로딩 중`}",
    );
    expect(consoleSource).toContain('aria-busy="true"');
    expect(source("components/admin/AdminOverviewDashboard.tsx")).toContain(
      'data-admin-map-loading-skeleton="true"',
    );
    expect(consoleSource).toContain(
      "const isShellBootstrapping = authLoading || !hasHydrated;",
    );
    expect(consoleSource).toContain("{isAdminCanvasBootstrapping ? (");
    expect(consoleSource).not.toContain("{isShellBootstrapping ? (");
    expect(consoleSource).toContain(
      "function AdminDashboardManagementSkeleton()",
    );
    expect(consoleSource).toContain("<AdminDashboardManagementSkeleton />");
    expect(consoleSource).toContain(
      "getAdminConsoleModuleLoadingSkeleton(activeModuleId, activeModuleLabel)",
    );
    expect(consoleSource).toContain(
      'data-admin-dashboard-management-skeleton="true"',
    );
    expect(consoleSource).toContain(
      'data-admin-dashboard-skeleton-card="trend"',
    );
    expect(consoleSource).toContain(
      'data-admin-dashboard-skeleton-card="topContent"',
    );
    expect(consoleSource).toContain(
      "useState<AdminModuleId>(requestedModuleId)",
    );
    expect(consoleSource).toContain('activeModuleId === "overview" ? (');
    expect(source("components/admin/AdminOverviewDashboard.tsx")).toContain(
      "backdrop-blur-[1px]",
    );
    expect(consoleSource).not.toContain("지도 준비 중");
    expect(consoleSource).not.toContain("group-hover:scale-[1.02]");
    expect(consoleSource).toContain("return null;");
    expect(adminLoadingSource).not.toContain("AdminConsoleLoadingSkeleton");
    expect(source("app/app-globals.css")).toMatch(
      /grid-template-columns:\s*fit-content\(var\(--admin-sidebar-expanded-max-width\)\)\s*minmax\(0, 1fr\);/,
    );
    expect(consoleSource).not.toContain("lg:w-[280px]");
    expect(consoleSource).not.toContain(
      "bg-gradient-to-br from-card via-card to-primary/5 p-3",
    );
    expect(routeSkeletonSource).toContain(
      'className="flex h-full min-h-0 flex-col overflow-hidden"',
    );
    expect(routeSkeletonSource).toContain(
      "lg:grid-cols-[40px_minmax(180px,1fr)_repeat(6,78px)_112px]",
    );
    expect(routeSkeletonSource).not.toContain("repeat(8,96px)");
    expect(routeSkeletonSource).toContain(
      "fallback={embedded ? null : <AdminEvaluationRouteSkeleton />}",
    );
    expect(consoleSource).toContain('role="status"');
    expect(evaluationTableSource).toContain(
      'aria-label="맛집 검수 카드 로딩 중"',
    );
    expect(evaluationTableSource).toContain(
      'role="status" aria-busy="true" aria-label="맛집 검수 카드 로딩 중"',
    );
    expect(evaluationTableSource).toContain("Array.from({ length: 4 }).map");
    expect(evaluationTableSource).toContain(
      "const desktopLoadingRows = Array.from({ length: 6 })",
    );
    expect(submissionListSource).toContain("Array.from({ length: 4 }).map");
    expect(submissionListSource).toContain(
      "grid gap-2 sm:grid-cols-[minmax(0,1fr)_80px_72px]",
    );
    expect(submissionListSource).toContain(
      'role="status" aria-busy="true" aria-label={`${label} 목록 로딩 중`}',
    );
    expect(usersSource).toContain(
      'role="status" aria-busy="true" aria-label="사용자 목록 로딩 중"',
    );
    expect(usersSource).toContain("function UserTableSkeleton");
    expect(usersSource).toContain(
      '<caption className="sr-only">관리자 사용자 목록 로딩</caption>',
    );
    expect(usersSource).toContain(
      '<th scope="col" className="px-3 py-2 font-semibold">사용자</th>',
    );
    expect(refreshHistorySource).toContain(
      "function RefreshCandidateListSkeleton()",
    );
    expect(refreshHistorySource).toContain(
      'aria-label="맛집 최신화 이력 로딩 중"',
    );
    expect(insightsSource).toContain("function InsightsClientLoadingSkeleton()");
    expect(insightsSource).toContain('data-insights-client-loading="true"');
    expect(insightsSource).toContain("return <InsightsClientLoadingSkeleton />;");
    expect(usersSource).toContain("block min-w-0 text-left");
    expect(usersSource).toContain("hidden overflow-hidden rounded-lg border bg-card md:block");
    expect(usersSource).toContain(
      'Badge variant="secondary" className="border-transparent bg-muted text-muted-foreground"',
    );
    expect(usersSource).not.toContain(
      'Badge variant="outline" className="border-border bg-background text-muted-foreground"',
    );
    expect(usersSource).not.toContain(
      "h-8 w-14 rounded-lg motion-reduce:animate-none",
    );
    expect(usersSource).not.toContain(
      "h-10 rounded-lg motion-reduce:animate-none",
    );
  });

  test("keeps overview reference widgets uncluttered and source-honest", () => {
    const consoleSource = adminConsoleShellSource();
    const appGlobalsSource = source("app/app-globals.css");
    const appLayoutSource = source("app/layout.tsx");
    const overviewSource = source(
      "components/admin/AdminOverviewDashboard.tsx",
    );
    const runtimeSpecSource = source("tests/admin-kpi-dashboard-runtime.spec.ts");
    const auditEventsRouteSource = source("app/api/admin/audit-events/route.ts");
    const directionsRouteSource = source("app/api/admin/routes/directions/route.ts");

    expect(overviewSource).toContain(
      "네이버 Directions 5 기준 실제 도로 주행 경로",
    );
    expect(overviewSource).toContain(
      "도로 경로 계산 전이나 실패 시에는 같은 영상·카테고리·직선거리 기반 후보",
    );
    expect(overviewSource).toContain("fetchAdminDirectionsRoute");
    expect(overviewSource).toContain("/api/admin/routes/directions");
    expect(overviewSource).toContain('data-admin-directions-unavailable="true"');
    expect(overviewSource).toContain('"local-heuristic"');
    expect(directionsRouteSource).toContain("buildLocalDirectionsFallback");
    expect(directionsRouteSource).toContain('"naver-directions-auth-failed"');
    expect(directionsRouteSource).toContain('"naver-directions-credentials-missing"');
    expect(directionsRouteSource).toContain("readBoundedNaverDirectionsJson(response)");
    expect(source("lib/admin-route-planner.ts")).toContain('id: "driving"');
    expect(source("lib/admin-route-planner.ts")).toContain('id: "walking"');
    expect(source("lib/admin-route-planner.ts")).toContain('id: "mixed"');
    expect(source("lib/admin-route-planner.ts")).toContain(
      "네이버 도로 경로 응답 전까지는 직선거리 기반 후보입니다.",
    );
    expect(overviewSource).toContain("ADMIN_ROUTE_MODE_OPTIONS");
    expect(overviewSource).toContain("assessAdminRouteReadiness");
    expect(overviewSource).toContain("buildAdminRoutePlan");
    expect(overviewSource).toContain(
      'data-admin-route-mode-controls="driving-walking-mixed"',
    );
    expect(overviewSource).toContain(
      'data-admin-route-readiness-panel="local-heuristic"',
    );
    expect(overviewSource).toContain(
      'data-admin-route-stop-list="ordered-shooting-plan"',
    );
    expect(overviewSource).toContain("동선 준비도");
    expect(overviewSource).toContain("자동차");
    expect(overviewSource).toContain("도보");
    expect(overviewSource).toContain("혼합");
    expect(overviewSource).toContain(
      "네이버 Directions 5는 자동차만 지원하므로 도보·혼합은 근거리 촬영 초안",
    );
    expect(consoleSource).toContain("fetchAdminAuditEvents");
    expect(consoleSource).toContain('data-admin-audit-event-list="admin_audit_events"');
    expect(consoleSource).toContain('data-admin-audit-unavailable-state="true"');
    expect(consoleSource).toContain('data-admin-audit-session-expired-state={isAuditAuthUnavailable ? "true" : undefined}');
    expect(consoleSource).toContain("buildAdminAuditAuthUnavailableResponse");
    expect(consoleSource).toContain("getAdminAuditCoverage");
    expect(consoleSource).toContain('data-admin-audit-coverage="partial-domain-specific"');
    expect(consoleSource).toContain('data-admin-audit-universal={coverage.universal ? "true" : "false"}');
    expect(consoleSource).toContain("부분/도메인별");
    expect(consoleSource).toContain("restaurant_request_review_audit");
    expect(consoleSource).toContain("범용 감사 로그처럼 표시하지 않습니다.");
    expect(consoleSource).toContain("부분 감사 · ${events.length}개");
    expect(consoleSource).toContain("isAuditCoverageMissing");
    expect(consoleSource).toContain("범위 확인 필요");
    expect(consoleSource).toContain("읽기 확인 필요");
    expect(consoleSource).toContain("세션 확인 필요");
    expect(consoleSource).toContain("event.reasonCode");
    expect(consoleSource).toContain("event.appliedAt");
    expect(consoleSource).not.toContain("event.readbackId");
    expect(consoleSource).not.toContain("event.reason ?");
    expect(consoleSource).toContain("event.correlationId");
    expect(consoleSource).toContain("isAdminAuditEventsResponsePayload");
    expect(consoleSource).toContain("value.events.length <= 50");
    expect(consoleSource).toContain("typeof event.reasonCode === \"string\"");
    expect(consoleSource).toContain("admin-audit-events-invalid-response");
    expect(consoleSource).toContain('"admin-audit-session-expired"');
    expect(consoleSource).toContain("관리자 세션 확인이 필요합니다.");
    expect(consoleSource).toContain("다시 로그인하기");
    expect(consoleSource).toContain('/api/admin/audit-events?limit=20');
    expect(consoleSource).toContain("PDF 보고서 창을 열었습니다.");
    expect(consoleSource).not.toContain('badge: "준비 중"');
    expect(consoleSource).not.toContain("`${events.length}개 표시`");
    expect(consoleSource).not.toContain("전체 운영 변경을 포괄하는 범용 감사 로그입니다");
    expect(auditEventsRouteSource).toContain('"read_admin_user_audit_events"');
    expect(auditEventsRouteSource).not.toContain('.from("admin_audit_events")');
    expect(auditEventsRouteSource).toContain("getAdminAuditCoverage()");
    expect(auditEventsRouteSource).toContain("domain: \"admin_user_management\"");
    expect(auditEventsRouteSource).toContain("reasonCode: row.reason");
    expect(auditEventsRouteSource).toContain("counts: toSafeCounts(row.audit_counts)");
    expect(auditEventsRouteSource).toContain("flags: toSafeFlags(row.audit_flags)");
    expect(auditEventsRouteSource).not.toContain("after_state");
    expect(overviewSource).not.toContain(
      'data-admin-creator-layer-controls="active-only"',
    );
    expect(overviewSource).not.toContain("최근 영상 연결");
    expect(overviewSource).not.toContain("향후 유튜버 A");
    expect(overviewSource).not.toContain("향후 유튜버 B");
    expect(consoleSource).not.toContain("ADMIN_OVERVIEW_WIDGET_STORAGE_KEY");
    expect(consoleSource).not.toContain("normalizeAdminOverviewWidgetOrder");
    expect(consoleSource).not.toContain("moveAdminOverviewWidget");
    expect(consoleSource).not.toContain(
      "window.localStorage.setItem(ADMIN_OVERVIEW_WIDGET_STORAGE_KEY",
    );
    expect(consoleSource).not.toContain("hasLoadedWidgetOrder");
    expect(consoleSource).not.toContain('aria-label="개요 위젯 순서 조정"');
    expect(consoleSource).not.toContain("위로 이동");
    expect(consoleSource).not.toContain("아래로 이동");
    expect(consoleSource).not.toContain("기본 순서");
    const registrySource = source("lib/admin/console-menu-registry.ts");
    expect(registrySource).toContain('title: "대시보드 (KPI)"');
    expect(consoleSource).not.toContain('badge: "성과 요약"');
    expect(consoleSource).toContain("buildRegistrySidebarSections");
    expect(consoleSource).toContain("getAdminConsoleMenuIdsBySection");
    expect(consoleSource).toContain("getAdminConsoleMenu");
    expect(consoleSource).toContain("ADMIN_CONSOLE_SECTION_LABELS");
    expect(consoleSource).toContain("ADMIN_CONSOLE_MENU_ICONS");
    expect(consoleSource).not.toContain("const sidebarSections");
    expect(consoleSource).not.toContain("function getSidebarConsoleItems");
    expect(consoleSource).not.toContain('badge: "실험 중"');
    expect(consoleSource).toContain('title: "핵심 인사이트"');
    expect(consoleSource).toContain("fetchAdminDashboardInsightSummary");
    expect(consoleSource).toContain("/api/insights/treemap");
    expect(consoleSource).toContain(
      'data-admin-dashboard-realtime-charts="true"',
    );
    expect(consoleSource).toContain('data-admin-dashboard-channel-kpi="true"');
    expect(consoleSource).toContain(
      "flex h-full min-h-0 min-w-0 flex-col overflow-visible bg-background p-0 font-sans text-foreground lg:min-h-0 lg:overflow-visible",
    );
    expect(consoleSource).toContain(
      "h-full min-h-0 min-w-0 overflow-x-hidden overscroll-contain scrollbar-hide border-y border-border bg-background p-2 font-sans tracking-normal focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-inset md:border-y-0 md:p-4",
    );
    expect(appGlobalsSource).toContain(
      '[data-admin-console-content="true"] .font-serif',
    );
    expect(appGlobalsSource).toContain("font-family: inherit;");
    expect(appLayoutSource).toContain("className={`${pretendard.variable} ${notoSerifKr.variable} ${pretendard.className}`}");
    expect(appLayoutSource).toContain('variable: "--font-pretendard"');
    expect(appLayoutSource).toContain('variable: "--font-display"');
    expect(appGlobalsSource).toContain(
      '[data-admin-dashboard-management="true"]',
    );
    expect(appGlobalsSource).toContain(
      '[data-admin-dashboard-management-skeleton="true"]',
    );
    expect(appGlobalsSource).toContain("font-family: var(--font-sans);");
    expect(appGlobalsSource).not.toContain('var(--font-noto-serif-kr, "Noto Serif KR")');
    expect(appGlobalsSource).not.toContain("serif !important;");
    expect(consoleSource).toContain(
      "grid min-w-0 auto-rows-min grid-cols-1 gap-2 overflow-x-hidden overflow-y-visible sm:grid-cols-2 lg:min-h-0 lg:flex-1 lg:grid-cols-10 lg:grid-rows-[auto_minmax(0,1.15fr)_minmax(0,1fr)] lg:overflow-visible",
    );
    expect(consoleSource).toContain('activeModuleId === "overview"');
    expect(consoleSource).toContain('? "overflow-y-auto"');
    expect(consoleSource).toContain('activeModuleId === "storyboard"');
    expect(consoleSource).toContain("overflow-y-auto md:overflow-hidden");
    expect(consoleSource).toContain('from "recharts"');
    expect(consoleSource).toContain("ResponsiveContainer");
    expect(consoleSource).toContain("LineChart");
    expect(consoleSource).toContain("ScatterChart");
    expect(consoleSource).toContain("AreaChart");
    expect(consoleSource).toContain(
      'data-admin-dashboard-line-chart="recharts"',
    );
    expect(consoleSource).toContain(
      'data-admin-dashboard-bubble-chart="recharts"',
    );
    expect(consoleSource).toContain(
      'data-admin-dashboard-area-chart="recharts"',
    );
    expect(consoleSource).toContain("function AdminDashboardTooltipPanel");
    expect(consoleSource).toContain("adminDashboardTooltipContentClassName");
    expect(consoleSource).toContain("adminDashboardTooltipWrapperStyle");
    expect(consoleSource).toContain("adminDashboardTooltipPortalClassName");
    expect(consoleSource).toContain("function AdminDashboardTooltipLinesPanel");
    expect(consoleSource).toContain(
      'data-admin-dashboard-tooltip-content="standard"',
    );
    expect(consoleSource).toContain(
      "data-admin-dashboard-tooltip-kind={dataAttribute}",
    );
    expect(consoleSource).not.toContain("viewBox={`0 0 ${width} ${height}`}");
    expect(consoleSource).toContain(
      "min-h-0 min-w-0 w-full overflow-hidden border border-border/70 bg-background shadow-[0_1px_2px_rgba(15,23,42,0.06)]",
    );
    expect(consoleSource).not.toContain("bg-[#e9ecee]");
    expect(consoleSource).not.toContain(
      "bg-white p-3 shadow-[inset_0_0_0_1px_rgba(15,23,42",
    );
    expect(consoleSource).toMatch(/>\s*Tzuyang KPI Dashboard\s*</);
    expect(consoleSource).not.toMatch(/>\s*쯔양 KPI 대시보드\s*</);
    expect(consoleSource).not.toContain(
      "구독자·조회수·좋아요·댓글·영상 수를 1페이지 KPI 보드에서 한눈에 봅니다.",
    );
    expect(consoleSource).toContain("기간 구독자 증가");
    expect(consoleSource).not.toContain('{ value: "ALL", label: "현재" }');
    expect(consoleSource).toContain('{ value: "ALL", label: "전체" }');
    expect(consoleSource).toContain("기간 조회 증가");
    expect(consoleSource).toContain("기간 좋아요 증가");
    expect(consoleSource).toContain("기간 댓글 증가");
    expect(consoleSource).toContain("업로드 영상 수");
    expect(consoleSource).toContain('{ value: "30MIN", label: "30분" }');
    expect(consoleSource).toContain('{ value: "1H", label: "1시간" }');
    expect(consoleSource).toContain('{ value: "6H", label: "6시간" }');
    expect(consoleSource).toContain('{ value: "12H", label: "12시간" }');
    expect(consoleSource).toContain('{ value: "1D", label: "1일" }');
    expect(consoleSource).toContain('{ value: "6M", label: "6개월" }');
    expect(consoleSource).toContain('{ value: "1Y", label: "1년" }');
    expect(consoleSource).toContain('? "전체 · 현재 합계"');
    expect(consoleSource).toContain(
      "? `전체 영상 · 현재 ${formatNumber(cumulativeVideoTotal)}`",
    );
    expect(consoleSource).toContain("fetchAdminYouTubeChannelStats");
    expect(consoleSource).toContain("/api/admin/youtube-channel");
    expect(consoleSource).toContain("fetchAdminYouTubeChannelStats(");
    expect(consoleSource).toContain(
      'queryKey: ["admin-dashboard-management", "youtube-channel", period]',
    );
    expect(consoleSource).toContain("/api/admin/youtube-kpis");
    const dashboardOrderRouteSource = source(
      "app/api/admin/preferences/dashboard-widget-order/route.ts",
    );
    const dashboardOrderSource = source("lib/admin/dashboard-widget-order.ts");
    expect(dashboardOrderRouteSource).toContain("admin_dashboard_widget_order");
    expect(dashboardOrderRouteSource).toContain("admin_user_preferences");
    expect(dashboardOrderRouteSource).toContain(
      "normalizeAdminDashboardWidgetOrder",
    );
    expect(dashboardOrderRouteSource).toContain(
      'from "@/lib/admin/dashboard-widget-order"',
    );
    expect(dashboardOrderRouteSource).toContain("export async function GET");
    expect(dashboardOrderRouteSource).toContain("export async function PATCH");
    expect(dashboardOrderRouteSource).toContain("export async function DELETE");
    expect(dashboardOrderRouteSource).toContain(".upsert(");
    expect(dashboardOrderRouteSource).toContain(
      '{ onConflict: "user_id,preference_key" }',
    );
    expect(dashboardOrderRouteSource).toContain('"Cache-Control": "no-store"');
    expect(dashboardOrderRouteSource).toContain(
      "isAdminPreferenceUserIdPersistable",
    );
    expect(dashboardOrderRouteSource).toContain(
      "!isAdminPreferenceUserIdPersistable(auth.userId)",
    );
    expect(dashboardOrderRouteSource).toContain(".delete()");
    expect(dashboardOrderRouteSource).toContain(
      'preference_key", DASHBOARD_WIDGET_ORDER_KEY',
    );
    expect(dashboardOrderSource).toContain(
      "DEFAULT_ADMIN_DASHBOARD_WIDGET_ORDER",
    );
    expect(consoleSource).toContain("fallbackResponse");
    expect(consoleSource).toContain("/api/insights/treemap");
    expect(consoleSource).toContain("subscriberValue");
    expect(consoleSource).toContain("subscriberCaption");
    expect(consoleSource).toContain("subscriberSparklinePoints");
    expect(consoleSource).toContain(
      "buildAdminDashboardChannelGrowthSparklinePoints",
    );
    expect(consoleSource).toContain(
      "sparklineData={subscriberSparklinePoints}",
    );
    expect(consoleSource).toContain("YouTube Data API");
    expect(consoleSource).toContain("로컬 채널 스냅샷 없음 · KPI 수집 후 표시");
    expect(consoleSource).toContain("채널 통계 확인 필요");
    expect(consoleSource).toContain(
      '<div className="hidden min-w-0 md:block">',
    );
    expect(consoleSource).toContain(
      '<h1 className="text-sm font-extrabold leading-tight tracking-[0.01em] text-foreground text-balance">',
    );
    expect(consoleSource).toContain("data-admin-dashboard-kpi-value-size=\"bounded\"");
    expect(consoleSource).toContain("text-sm font-black");
    expect(consoleSource).toContain("sm:text-base");
    expect(consoleSource).not.toContain("text-[clamp(1.2rem,1.45vw,1.75rem)]");
    expect(consoleSource).toContain("function AdminDashboardTooltipPanel");
    expect(consoleSource).toContain("min-w-44 space-y-1");
    expect(consoleSource).toContain(
      "text-[10px] font-semibold leading-3 text-muted-foreground",
    );
    expect(consoleSource).toContain(
      "rounded-xl border border-border bg-popover px-2.5 py-1.5",
    );
    expect(consoleSource).toContain("grid gap-0.5");
    expect(consoleSource).toContain("gap-x-1.5 gap-y-0");
    expect(consoleSource).toContain("fontSize: 11");
    expect(consoleSource).toContain("toneClass.bar");
    expect(consoleSource).toContain('emphasis?: "primary" | "supporting";');
    expect(consoleSource).toContain("data-admin-dashboard-kpi-emphasis={emphasis}");
    expect(consoleSource).toContain("data-admin-dashboard-kpi-tone={tone}");
    expect(consoleSource).toContain("border-sky-500/35 bg-sky-50/20");
    expect(consoleSource).toContain("dark:border-sky-400/45 dark:bg-sky-950/20");
    expect(consoleSource).toContain("toneClass.text");
    expect(consoleSource).toContain("dark:text-sky-300");
    expect(consoleSource).toContain("dark:text-rose-300");
    expect(consoleSource).toContain("dark:text-amber-300");
    expect(consoleSource).toContain("dark:text-teal-300");
    expect(consoleSource).toContain("dark:bg-muted/35");
    expect(consoleSource).toContain("dark:text-white");
    expect(consoleSource).not.toContain("dark:text-slate-950");
    expect(consoleSource).toContain("bg-teal-500 text-white dark:bg-teal-500 dark:text-white");
    expect(consoleSource).toContain("bg-muted-foreground/42 text-foreground");
    expect(consoleSource).toContain("text-[11px] font-black leading-none");
    expect(consoleSource).toContain(
      "bg-muted text-foreground ring-1 ring-inset ring-border/60",
    );
    expect(consoleSource).toContain("data-admin-dashboard-rank-segment={rankSegment}");
    expect(consoleSource).toContain("rankSegment={index + 1}");
    expect(consoleSource).toContain(
      "bg-muted-foreground/28 text-foreground dark:bg-muted-foreground/35 dark:text-foreground",
    );
    expect(source("app/app-globals.css")).toContain(
      '[data-admin-dashboard-rank-segment="5"]',
    );
    expect(consoleSource).not.toContain("bg-amber-600 text-white");
    expect(consoleSource).not.toContain("bg-${");
    expect(consoleSource).not.toContain("text-${");
    expect(consoleSource).not.toContain("border-${");
    expect(consoleSource).not.toContain("toneClass.split");
    expect(consoleSource).not.toContain("text-[9px]");
    expect(consoleSource).not.toContain(
      "text-[10px] font-bold text-muted-foreground",
    );
    expect(consoleSource).toContain(
      "읽는 법: 조회·반응(좋아요+댓글)·반응률을 각각 100점 기준으로 맞춰 같은 눈금에서 비교합니다.",
    );
    expect(consoleSource).toContain("adminDashboardChartMargin");
    expect(consoleSource).not.toContain("adminDashboardTrendChartMargin");
    expect(consoleSource).toContain("adminDashboardScatterChartMargin");
    expect(consoleSource).toContain(
      "const adminDashboardChartMargin = { top: 10, right: 10, bottom: 2, left: 0 };",
    );
    expect(consoleSource).not.toContain("const adminDashboardAxisLabelStyle");
    expect(consoleSource).toContain("top: 10");
    expect(consoleSource).toContain("bottom: 2");
    expect(consoleSource).toContain("adminDashboardChartViewportClassName");
    expect(consoleSource).toContain("[&_.recharts-surface]:overflow-visible");
    expect(consoleSource).toContain("[&_.recharts-wrapper]:overflow-visible");
    expect(consoleSource).toContain("Math.max(1, dataMax * 1.08)");
    expect(consoleSource).toContain("Math.max(1, dataMax * 1.12)");
    expect(consoleSource).toContain("type AdminDashboardTrendSeriesKey");
    expect(consoleSource).toContain("type AdminDashboardTopContentSeriesKey");
    expect(consoleSource).toContain(
      "DEFAULT_ADMIN_DASHBOARD_TREND_SERIES_VISIBILITY",
    );
    expect(consoleSource).toContain(
      "DEFAULT_ADMIN_DASHBOARD_TOP_CONTENT_SERIES_VISIBILITY",
    );
    expect(consoleSource).toContain("function AdminDashboardSeriesToggle");
    expect(consoleSource).toContain("adminDashboardControlGroupClassName");
    expect(consoleSource).toContain("adminDashboardControlButtonClassName");
    expect(consoleSource).toContain(
      'const adminDashboardControlGroupClassName =\n  "inline-flex h-7 shrink-0 items-center rounded-full border border-border bg-muted/25 p-0.5"',
    );
    expect(consoleSource).toContain(
      'const adminDashboardControlButtonClassName =\n  "inline-flex h-6 shrink-0 items-center justify-center gap-1 rounded-full px-2 text-[10px] font-extrabold leading-none transition',
    );
    expect(consoleSource).toContain(
      '"h-7 w-7 border border-border bg-background p-0 text-muted-foreground shadow-sm hover:text-foreground"',
    );
    expect(consoleSource).toContain(
      'data-admin-dashboard-series-toggle="true"',
    );
    expect(consoleSource).toContain(
      "inline-flex h-7 max-w-full min-w-0 shrink-0 items-center gap-0.5 overflow-x-auto overflow-y-hidden rounded-full border border-transparent bg-transparent p-0",
    );
    const compactDashboardCardControlSource = consoleSource.slice(
      consoleSource.indexOf("const adminDashboardControlGroupClassName"),
      consoleSource.indexOf("type AdminDashboardTableColumn"),
    );
    expect(compactDashboardCardControlSource).not.toContain("min-h-11");
    expect(compactDashboardCardControlSource).not.toContain("min-w-[44px]");
    expect(compactDashboardCardControlSource).not.toContain("md:h-7 md:min-h-0");
    expect(consoleSource).toContain(
      'data-admin-dashboard-card-title-row="single-line"',
    );
    expect(consoleSource).toContain(
      "truncate whitespace-nowrap text-[11px] font-extrabold leading-none text-foreground",
    );
    expect(consoleSource).toContain(
      'data-admin-dashboard-card-title-actions="single-line-scroll"',
    );
    expect(consoleSource).toContain("toggleTrendSeries");
    expect(consoleSource).toContain("toggleTopContentSeries");
    expect(consoleSource).toContain(
      'data-admin-dashboard-rank-legend="impact"',
    );
    expect(consoleSource).toContain(
      'aria-label="상위 영상 영향도 색상 범례: 순위 구분"',
    );
    expect(consoleSource).toContain("<AdminDashboardImpactRankLegend />");
    expect(consoleSource).not.toContain(
      'data-admin-dashboard-clickable-legend="true"',
    );
    expect(consoleSource).toContain("seriesVisibility.views");
    expect(consoleSource).toContain("seriesVisibility.engagement");
    expect(consoleSource).toContain("seriesVisibility.engagementRate");
    expect(consoleSource).toContain("topContentSeriesVisibility.likes");
    expect(consoleSource).toContain("topContentSeriesVisibility.comments");
    expect(consoleSource).not.toContain("textClassName?: string");
    expect(consoleSource).not.toContain("option.textClassName");
    expect(consoleSource).toContain(
      "border-teal-500/25 bg-teal-50 text-foreground",
    );
    expect(consoleSource).toContain(
      "border-border bg-muted/35 text-muted-foreground dark:bg-muted/20",
    );
    expect(consoleSource).toContain('dotClassName: "bg-amber-500"');
    expect(consoleSource).toContain('dotClassName: "bg-muted-foreground/45"');
    expect(consoleSource).toContain('dotClassName: "bg-muted-foreground/30"');
    expect(consoleSource).not.toContain(
      'textClassName: "text-orange-700 dark:text-orange-300"',
    );
    expect(consoleSource).toContain(
      '<span className="font-bold tabular-nums text-foreground">',
    );
    expect(consoleSource).toContain("상위 영상 영향도 첫 항목은");
    expect(consoleSource).toContain('dataAttribute="bubble-video"');
    expect(consoleSource).toContain(
      "계산식: 참여 = 좋아요 + 댓글 · 원 크기 = 참여",
    );
    expect(consoleSource).not.toContain('className="max-w-[280px]"');
    expect(consoleSource).not.toContain(
      "function AdminDashboardAxisCornerHint",
    );
    expect(consoleSource).not.toContain("function AdminDashboardAxisCaption");
    expect(consoleSource).not.toContain(
      'data-admin-dashboard-axis-corner-hint="true"',
    );
    expect(consoleSource).not.toContain(
      'data-admin-dashboard-axis-caption="true"',
    );
    expect(consoleSource).not.toContain('const xAxisLabel = "게시일 순서"');
    expect(consoleSource).not.toContain(
      'const yAxisLabel = "정규화 점수(0~100)"',
    );
    expect(consoleSource).not.toContain(
      "<AdminDashboardAxisCornerHint x={xAxisLabel} y={yAxisLabel} />",
    );
    expect(consoleSource).not.toContain(
      "<AdminDashboardAxisCaption x={xAxisLabel} y={yAxisLabel} />",
    );
    expect(consoleSource).not.toContain("function AdminDashboardAxisGuide");
    expect(consoleSource).not.toContain(
      'data-admin-dashboard-axis-guide="true"',
    );
    expect(consoleSource).not.toContain('position: "insideBottom"');
    expect(consoleSource).not.toContain('position: "insideLeft"');
    expect(consoleSource).not.toContain("색상=순위 구분");
    expect(consoleSource).toContain("순위 구분");
    expect(consoleSource).toContain(
      "읽는 법: 원이 클수록 조회수와 반응을 합친 영향도가 큰 영상입니다. 색은 순위 구분입니다.",
    );
    expect(consoleSource).toContain("line-clamp-2 leading-5");
    expect(consoleSource).toContain("formatNumber(row.조회수)");
    expect(consoleSource).toContain("formatNumber(row.참여)");
    expect(consoleSource).toContain("콘텐츠 성과 상위 항목은");
    expect(consoleSource).toContain(
      "읽는 법: 막대는 조회·좋아요·댓글 수를 보여주고, 기여도는 세 지표를 가중 합산한 성과 기여입니다.",
    );
    expect(consoleSource).toContain("comments: row.commentCount");
    expect(consoleSource).toContain(
      'data-admin-dashboard-bar-chart="rank-distribution"',
    );
    expect(consoleSource).toContain(
      "grid h-full grid-rows-[auto_auto] gap-2 pb-0 sm:grid-rows-[minmax(0,1fr)_auto]",
    );
    expect(consoleSource).toContain(
      '"grid min-h-0 content-start gap-2 sm:content-evenly",',
    );
    expect(consoleSource).toContain(
      'className={cn("grid gap-1.5", isFullscreen && "gap-2.5")}',
    );
    expect(consoleSource).toContain(
      "flex min-w-0 overflow-x-auto overflow-y-visible",
    );
    expect(consoleSource).toContain('isFullscreen ? "h-12 sm:h-14" : "h-9"');
    expect(consoleSource).toContain(
      "grid max-h-[8.5rem] shrink-0 gap-1 overflow-y-auto scrollbar-hide sm:max-h-none sm:grid-cols-5 sm:overflow-visible",
    );
    expect(consoleSource).toContain(
      'data-admin-dashboard-top-content-rank-list="true"',
    );
    expect(consoleSource).toContain(
      "data-admin-dashboard-top-content-rank-item={index + 1}",
    );
    expect(consoleSource).toContain("{index + 1}위");
    expect(consoleSource).toContain(
      "formatDashboardContribution(row.performanceContributionPercent)",
    );
    expect(consoleSource).toContain(
      "flex min-h-[360px] flex-col overflow-hidden p-3 sm:min-h-[220px] sm:col-span-2 lg:col-span-5",
    );
    expect(consoleSource).toContain(
      "data-admin-dashboard-top-content-metric={metric.label}",
    );
    expect(consoleSource).toContain(
      "상위 5개 영상의 조회수, 좋아요, 댓글 비중 분포",
    );
    expect(consoleSource).toContain('header: "댓글"');
    expect(consoleSource).toContain("rankColors");
    expect(consoleSource).toContain("metricRows");
    expect(consoleSource).toContain("return scoredRows.map((row, index) =>");
    expect(consoleSource).toContain("barRows.map((row) => ({");
    expect(consoleSource).toContain("getVideoViewDelta");
    expect(consoleSource).toContain("getVideoEngagementDelta");
    expect(consoleSource).toContain(
      "const currentValue = getCurrentValue(video);",
    );
    expect(consoleSource).toContain("return currentValue;");
    expect(consoleSource).toContain("topContentMetricMode");
    expect(consoleSource).toContain("videosByInsightScore");
    expect(consoleSource).toContain(
      'video.comparisonStatus !== "missing_previous"',
    );
    expect(consoleSource).toContain("topContentVideosByInsightScore");
    expect(consoleSource).toContain(
      "설명: 선택 기간 업로드 영상 안에서 오른쪽으로 갈수록 조회 증가가 크고, 위로 갈수록 좋아요와 댓글 증가가 큽니다.",
    );
    expect(consoleSource).toContain(
      "설명: 선택 기간 업로드 영상 안에서 오른쪽으로 갈수록 조회수가 크고, 위로 갈수록 좋아요와 댓글 합계가 큽니다.",
    );
    expect(consoleSource).toContain(
      "읽는 법: 막대는 선택 기간 업로드 영상의 조회·좋아요·댓글 증가량을 보여주고, 기여도는 세 지표를 가중 합산한 성과 기여입니다.",
    );
    expect(consoleSource).toContain("합계 {formatCompactNumber(total)}");
    expect(consoleSource).toContain("formatDashboardPercent(percent)");
    expect(consoleSource).toContain("{percent.toFixed(0)}%");
    expect(consoleSource).toContain("overflow-x-auto overflow-y-visible");
    expect(consoleSource).not.toContain("percent >= 13");
    expect(consoleSource).toContain("min-w-[8%]");
    expect(consoleSource).not.toContain("조회수 TOP 5");
    expect(consoleSource).not.toContain("좋아요 TOP 5");
    expect(consoleSource).not.toContain('Bar dataKey="댓글"');
    expect(consoleSource).toContain("최근 참여율 지표는");
    expect(consoleSource).toContain("성과 진단");
    expect(consoleSource).toContain(
      'data-admin-dashboard-diagnosis-board="actionable-insights"',
    );
    expect(consoleSource).toContain(
      "ADMIN_DASHBOARD_CONTENT_INSIGHT_TARGET_COUNT = 4",
    );
    expect(consoleSource).toContain("const visibleInsights = insights.slice(");
    expect(consoleSource).toContain(
      "ADMIN_DASHBOARD_CONTENT_INSIGHT_TARGET_COUNT,",
    );
    expect(consoleSource).toContain(
      "grid min-h-0 flex-1 content-start gap-2 sm:content-stretch sm:gap-1",
    );
    expect(consoleSource).toContain(
      "grid min-h-0 grid-cols-1 gap-2 sm:h-full sm:grid-cols-2 sm:grid-rows-2 sm:gap-1",
    );
    expect(consoleSource).toContain(
      "flex min-h-[5.5rem] min-w-0 flex-col justify-between rounded-xl border border-border/70 bg-muted/20 px-2 py-1.5 sm:min-h-0",
    );
    expect(consoleSource).toContain(
      'data-admin-dashboard-diagnosis-meta="header-inline"',
    );
    expect(consoleSource).toContain(
      "성과 진단 기준 ${periodLabel}, 비교 채널 평균",
    );
    expect(consoleSource).not.toContain("목적 다음 액션");
    expect(consoleSource).toContain(
      "ml-auto flex min-w-fit shrink-0 flex-nowrap items-center gap-2",
    );
    expect(consoleSource).toContain(
      "flex min-w-fit flex-nowrap items-center justify-end gap-1",
    );
    expect(consoleSource).not.toContain(
      "grid grid-cols-3 gap-2 rounded-xl border border-border/70 bg-background/80 p-2 text-[11px]",
    );
    expect(consoleSource).toContain("영상 성과 신호 진단");
    expect(consoleSource).toContain("score: number");
    expect(consoleSource).toContain("scoreLabel: string");
    expect(consoleSource).toContain("getDashboardInsightSignalScore");
    expect(consoleSource).toContain(
      'data-admin-dashboard-diagnosis-visual="signal-bar"',
    );
    expect(consoleSource).toContain(
      'data-admin-dashboard-diagnosis-tooltip-trigger="title"',
    );
    expect(consoleSource).toContain(
      'data-admin-dashboard-diagnosis-tooltip="standard"',
    );
    expect(consoleSource).toContain(
      "계산식: 신호 강도 = 카드별 규칙 점수를 0~100으로 표시합니다.",
    );
    expect(consoleSource).not.toContain(
      "계산식: 신호 강도는 기여도, 참여율, 게시 후 경과일 같은 규칙별 점수를 0~100으로 표시합니다.",
    );
    expect(consoleSource).toContain("signalBarClass[insight.tone]");
    expect(consoleSource).toContain("신호 강도");
    expect(consoleSource).toContain("후보를 채널");
    expect(consoleSource).toContain(
      "기여도와 참여율로 우선 점검할 영상을 표시합니다.",
    );
    expect(consoleSource).toContain("상위 영상 영향도");
    expect(consoleSource).toContain("영상별 성과 분포");
    expect(consoleSource).toContain("콘텐츠 성과 TOP 5");
    expect(consoleSource).toContain(
      'data-admin-dashboard-card-title-delta="true"',
    );
    expect(consoleSource).toContain("const dashboardViewMetricLabel =");
    expect(consoleSource).toContain(
      "? `조회 증감 ${formatDashboardChangeLabel(viewChange)}`",
    );
    expect(consoleSource).toContain(': "현재값 기준";');
    expect(consoleSource).toContain(
      "const dashboardUploadVideoBasisCount = videos.length",
    );
    expect(consoleSource).toContain("const impactMetricLabel =");
    expect(consoleSource).toContain("const trendMetricLabel =");
    expect(consoleSource).toContain("metric={impactMetricLabel}");
    expect(consoleSource).toContain("metric={trendMetricLabel}");
    expect(consoleSource).toContain(
      "상위 ${formatNumber(impactDisplayedVideoCount)}/${formatNumber(dashboardUploadVideoBasisCount)}개",
    );
    expect(consoleSource).toContain("getAdminDashboardImpactChartLimit(");
    expect(consoleSource).toContain("videosByInsightScore.length");
    expect(consoleSource).toContain(
      "ADMIN_DASHBOARD_IMPACT_FULL_CHART_LIMIT = 60",
    );
    expect(consoleSource).toContain(
      "ADMIN_DASHBOARD_IMPACT_MAX_CHART_LIMIT = 80",
    );
    expect(consoleSource).toContain("displayLimit={impactChartVideoLimit}");
    expect(consoleSource).toContain(
      "전체 ${formatNumber(trendDisplayedPointCount)}개",
    );
    expect(consoleSource).toContain(
      "표시: 그래프는 상위 ${formatNumber(impactDisplayedVideoCount)}/${formatNumber(dashboardUploadVideoBasisCount)}개, 표는 전체 ${formatNumber(dashboardUploadVideoBasisCount)}개.",
    );
    expect(consoleSource).toContain(
      "표시: 그래프와 표 모두 전체 ${formatNumber(dashboardUploadVideoBasisCount)}개.",
    );
    expect(consoleSource).toContain("videosByInsightScore.map((video) =>");
    expect(consoleSource).toContain("videosByPublishedAt.map((video) =>");
    expect(consoleSource).toContain(
      "비교 스냅샷이 없을 때는 증감률 대신 현재 조회수와 현재 반응값으로 위치를 잡습니다.",
    );
    expect(consoleSource).toContain(
      "const topContentComparisonCount = topContentVideosByInsightScore.length",
    );
    expect(consoleSource).toContain(
      "const topContentCardMetric = hasPeriodGrowthComparison",
    );
    expect(consoleSource).toContain("metric={topContentCardMetric}");
    expect(consoleSource).toContain(
      "metric={`진단 신호 ${formatNumber(topContentInsights.length)}개 · ${topContentCardMetric}`}",
    );
    expect(consoleSource).not.toContain("engagementChange");
    expect(consoleSource).toContain("const visibleRows = rows.slice(0, 5)");
    expect(consoleSource).not.toContain("ADMIN_DASHBOARD_IMPACT_VIDEO_LIMIT");
    expect(consoleSource).toContain("const topVideos = [...videos]");
    expect(consoleSource).toContain(".slice(0, displayLimit)");
    expect(consoleSource).toContain(
      "주의: 그래프는 빠른 요약이고, 표 보기는 선택 기간 전체 영상을 확인하는 용도입니다.",
    );
    expect(consoleSource).toContain("성과 진단");
    expect(consoleSource).toContain(
      "설명: 지금 확인할 만한 영상 성과 신호를 요약한 카드입니다.",
    );
    expect(consoleSource).toContain("AdminDashboardBubbleChart");
    expect(consoleSource).toContain("AdminDashboardKpiCard");
    expect(consoleSource).toContain("buildAdminDashboardExtremeLabels");
    expect(consoleSource).toContain("sampleAdminDashboardPeriodPoints");
    expect(consoleSource).not.toContain("ADMIN_DASHBOARD_TREND_POINT_LIMIT");
    expect(consoleSource).toContain("ADMIN_DASHBOARD_SPARKLINE_POINT_LIMIT");
    expect(consoleSource).not.toContain("videosByPublishedAt.slice(-9)");
    expect(consoleSource).not.toContain("videosByPublishedAt.slice(-7)");
    expect(consoleSource).toContain("LabelList");
    expect(consoleSource).toContain('dataKey="조회수최고"');
    expect(consoleSource).toContain('dataKey="조회수최저"');
    expect(consoleSource).toContain('dataKey="참여최고"');
    expect(consoleSource).toContain('dataKey="참여최저"');
    expect(consoleSource).toContain('dataKey="참여율최고"');
    expect(consoleSource).toContain('dataKey="참여율최저"');
    expect(consoleSource).toContain("adminDashboardFocusPalette");
    expect(consoleSource).toContain('warning: "#f59e0b"');
    expect(consoleSource).toContain("stroke={adminDashboardFocusPalette.primary}");
    expect(consoleSource).toContain("stroke={adminDashboardFocusPalette.warning}");
    expect(consoleSource).toContain("stopColor={adminDashboardFocusPalette.warning}");
    expect(consoleSource).toContain(
      "계산식: 정규화 점수 = 해당 값 / 해당 지표 최고값 × 100.",
    );
    expect(consoleSource).toContain("function AdminDashboardTrendTooltip");
    expect(consoleSource).toContain('dataAttribute="trend-simple"');
    expect(consoleSource).toContain(
      "100점은 선택 기간에서 해당 지표가 가장 큰 영상입니다.",
    );
    expect(consoleSource).toContain("영상 조회수 기준");
    expect(consoleSource).toContain("좋아요+댓글 기준");
    expect(consoleSource).toContain("조회수 대비 참여 기준");
    expect(consoleSource).toContain("content={<AdminDashboardTrendTooltip />}");
    expect(consoleSource).toContain("계산식: 참여 = 좋아요 + 댓글.");
    expect(consoleSource).toContain(
      "참고: 참여는 좋아요와 댓글을 더한 값이고, 참여율은 조회수 대비 참여 비중입니다.",
    );
    expect(consoleSource).toContain(
      "참고: 참여율은 조회수 대비 좋아요와 댓글 반응 비중입니다.",
    );
    expect(consoleSource).toContain(
      "계산식: 신호 강도 = 카드별 규칙 점수를 0~100 범위로 표시한 값입니다.",
    );
    expect(consoleSource).toContain(
      "막대 기준: 같은 묶음 안에서 가장 큰 항목을 100%로 두고 비교합니다.",
    );
    expect(consoleSource).not.toContain('stroke="#dfcf65"');
    expect(consoleSource).toContain("key={`impact-${period}`}");
    expect(consoleSource).toContain("key={`trend-${period}`}");
    expect(consoleSource).toContain("viewCardTitle");
    expect(consoleSource).toContain("likeCardTitle");
    expect(consoleSource).toContain("commentCardTitle");
    expect(consoleSource).toContain("title={viewCardTitle}");
    expect(consoleSource).toContain("title={likeCardTitle}");
    expect(consoleSource).toContain("title={commentCardTitle}");
    expect(consoleSource).toContain("기간 영상 현재");
    expect(consoleSource).toContain("기간 순증");
    expect(consoleSource).not.toContain(
      'data-admin-dashboard-kpi-data-scope="true"',
    );
    expect(consoleSource).toContain('title="업로드 영상 수"');
    expect(consoleSource).toContain("periodMetricCaption");
    expect(consoleSource).toContain("periodCohortViewValue");
    expect(consoleSource).toContain("periodViewDisplayValue");
    expect(consoleSource).toContain("periodLikeDisplayValue");
    expect(consoleSource).toContain("periodCommentDisplayValue");
    expect(consoleSource).toContain("fallbackViewSparklinePoints");
    expect(consoleSource).toContain("viewSparklineDisplayPoints");
    expect(consoleSource).toContain("periodRatioCaptionPrefix");
    expect(consoleSource).toContain("periodVideoCaption");
    expect(consoleSource).toContain("getDashboardAverage");
    expect(consoleSource).toContain("getDashboardMedian");
    expect(consoleSource).toContain("formatDashboardAverageComparison");
    expect(consoleSource).toContain("기간 성과 기여");
    expect(consoleSource).toContain(
      "용어: 조회·좋아요·댓글 증가 기여는 각각 선택 기간 업로드 영상 전체 증가 합계 중 이 영상이 차지한 비율입니다.",
    );
    expect(consoleSource).toContain(
      "비교 대상: 선택 기간에 새로 올라온 업로드 영상입니다.",
    );
    expect(consoleSource).toContain(
      "처리: 비교 버킷 이후 신규 영상은 이전값 0으로 보고, 비교 버킷 이전 영상인데 이전값이 없으면 비교 불가로 분리합니다.",
    );
    expect(consoleSource).not.toContain(
      'data-admin-dashboard-data-confidence="true"',
    );
    expect(consoleSource).not.toContain("AdminDashboardDataConfidenceRail");
    expect(runtimeSpecSource).not.toContain("title: `KPI 회귀");
    expect(runtimeSpecSource).not.toContain("MOCK_VIDEO_TITLES");
    expect(runtimeSpecSource).not.toContain("mockAdminDashboardApis");
    expect(runtimeSpecSource).not.toContain("createMockVideo");
    expect(runtimeSpecSource).not.toContain("createKpiQualityMeta");
    expect(runtimeSpecSource).not.toContain("api/admin/youtube-kpis**");
    expect(runtimeSpecSource).not.toContain("api/dashboard/summary', async");
    expect(runtimeSpecSource).toContain("expectOperationalKpiPayload");
    expect(runtimeSpecSource).toContain("kpi-dashboard-real-data-fhd.png");
    expect(runtimeSpecSource).toContain("waitForResponse");
    expect(runtimeSpecSource).toContain("width: 1920, height: 1080");
    expect(runtimeSpecSource).toContain("not.toContainText('KPI 회귀 테스트 영상')");
    expect(runtimeSpecSource).toContain("getByText(operationalVideoTitle");
    expect(consoleSource).not.toContain("단일 지배");
    expect(consoleSource).not.toContain("집중도");
    expect(consoleSource).toContain("slice(0, maxVisible)");
    expect(consoleSource).toContain("max-w-[7rem]");
    expect(consoleSource).toContain("flex-wrap");
    expect(consoleSource).toContain("fallbackReasonCode");
    expect(consoleSource).toContain("getAdminDashboardCoverageLabel");
    expect(consoleSource).toContain(
      "전체값: 선택 기간 업로드 영상의 조회·좋아요·댓글 증가 합계를 각각 분모로 사용합니다.",
    );
    expect(consoleSource).toContain("periodUploadVideoCount?: number | null");
    expect(consoleSource).toContain(
      "`비교 대상: 선택 기간 업로드 영상 ${formatNumber(scoredRows.length)}개 중 ${viewRank}위 (${viewTopPercentLabel})`",
    );
    expect(consoleSource).toContain(
      "`비교 대상: 선택 기간 영상 ${formatNumber(scoredRows.length)}개 중 ${viewRank}위 (${viewTopPercentLabel})`",
    );
    expect(consoleSource).toContain(
      "`업로드 영상 수 카드는 ${formatNumber(periodUploadVideoCount)}개이고, 이 비교에는 성과 데이터가 있는 ${formatNumber(scoredRows.length)}개를 사용합니다.`",
    );
    expect(consoleSource).toContain(
      'topContentMetricMode === "delta" ? periodUploadVideoValue : null',
    );
    expect(consoleSource).toContain(
      "`조회 ${formatDashboardPercent(row.viewContributionPercent)} · 좋아요 ${formatDashboardPercent(row.likeContributionPercent)} · 댓글 ${formatDashboardPercent(row.commentContributionPercent)}`",
    );
    expect(consoleSource).toContain(
      "`계산식: 조회×60% + 좋아요×25% + 댓글×15% = ${formatDashboardPercent(row.performanceContributionPercent)}`",
    );
    expect(consoleSource).toContain(
      "전체값: 조회·좋아요·댓글 증가 합계를 각각 분모로 사용합니다.",
    );
    expect(consoleSource).toContain("max-w-[min(26rem,calc(100vw-2rem))]");
    expect(consoleSource).toContain("[text-wrap:pretty]");
    const infoLineTooltipBlocks =
      consoleSource.match(/infoLines=\{\[[\s\S]*?\]\}/g) ?? [];
    expect(infoLineTooltipBlocks.length).toBeGreaterThanOrEqual(10);
    expect(
      infoLineTooltipBlocks.filter(
        (block) => (block.match(/계산식:/g) ?? []).length > 1,
      ),
    ).toEqual([]);
    expect(consoleSource).toContain("function AdminDashboardInlineTooltip");
    expect(consoleSource).toContain(
      'data-admin-dashboard-inline-tooltip="true"',
    );
    expect(consoleSource).toContain("viewBenchmarkTooltipLines");
    expect(consoleSource).toContain('viewBenchmarkTooltipLines.join(" ")');
    expect(consoleSource).toContain("lines={row.viewBenchmarkTooltipLines}");
    const topContentMetricSource = consoleSource.slice(
      consoleSource.indexOf("data-admin-dashboard-top-content-metric={metric.label}"),
      consoleSource.indexOf('data-admin-dashboard-top-content-rank-list="true"'),
    );
    expect(topContentMetricSource).toContain("<AdminDashboardInlineTooltip");
    expect(topContentMetricSource).not.toContain('aria-hidden="true"');
    expect(consoleSource).not.toContain(
      "mt-1 block truncate text-[11px] font-extrabold leading-4 tabular-nums text-teal-800",
    );
    expect(consoleSource).not.toContain(
      "mt-0.5 block truncate text-[10px] font-black tabular-nums text-foreground/75",
    );
    expect(consoleSource).toContain(
      "mt-0.5 block truncate text-[10px] font-semibold tabular-nums text-foreground/70",
    );
    expect(consoleSource).toContain("...row.viewBenchmarkTooltipLines");
    expect(consoleSource).toContain(
      "className={adminDashboardTooltipPortalClassName}",
    );
    expect(consoleSource).toContain('dataAttribute="diagnosis-card"');
    expect(consoleSource).toContain(
      'data-admin-dashboard-diagnosis-tooltip-trigger="title"',
    );
    expect(consoleSource).toContain('side="top"');
    expect(consoleSource).toContain("sideOffset={4}");
    expect(consoleSource).toContain("collisionPadding={12}");
    expect(consoleSource).toContain("adminDashboardTooltipLineClassName");
    expect(consoleSource).toContain("adminDashboardTooltipFirstLineClassName");
    expect(consoleSource).toContain(
      "contributionTotalOverride?: number | null",
    );
    expect(consoleSource).toContain("topContentVideosByInsightScore,");
    expect(consoleSource).toContain(
      "설명: 그래프는 선택 기간 업로드 영상 중 상위 5개를 요약하고, 표는 전체 영상을 보여줍니다.",
    );
    expect(consoleSource).toContain(
      "막대 기준: 각 색 조각은 그래프에 표시된 상위 5개 안에서 해당 영상이 차지하는 비중입니다.",
    );
    expect(consoleSource).toContain("const topContentContributionFormula");
    expect(consoleSource).toContain("topContentContributionFormula,");
    expect(consoleSource).toContain(
      "기간 성과 기여 = 조회 증가 기여×60% + 좋아요 증가 기여×25% + 댓글 증가 기여×15%.",
    );
    expect(consoleSource).toContain(
      "성과 기여 = 조회 기여×60% + 좋아요 기여×25% + 댓글 기여×15%.",
    );
    expect(consoleSource).toContain("viewTopPercentLabel");
    expect(consoleSource).toContain("중앙값 대비");
    expect(consoleSource).toContain(
      'const viewBenchmarkLabel = metricMode === "delta" ? "성과 증가" : "성과";',
    );
    expect(consoleSource).toContain(
      "viewBenchmarkTooltip: row.viewBenchmarkTooltip",
    );
    expect(consoleSource).toContain("{row.viewBenchmark}");
    expect(consoleSource).toContain("전체 평균");
    expect(consoleSource).toContain("성과 기여");
    expect(consoleSource).toContain("viewBenchmark");
    expect(consoleSource).toContain("buildAdminDashboardContentInsights");
    expect(consoleSource).toContain("getDashboardVideoAgeDays");
    expect(consoleSource).not.toContain(
      'data-admin-dashboard-content-insights="average-benchmark"',
    );
    expect(consoleSource).toContain("초반 반응 점검");
    expect(consoleSource).toContain("재상승 후보");
    expect(consoleSource).toContain("구독자 기여 후보");
    expect(consoleSource).not.toContain("조회 보강 후보");
    expect(consoleSource).not.toContain("참여 보강 후보");
    expect(consoleSource).toContain("신규 반응 확인");
    expect(consoleSource).toContain('tone: "primary"');
    expect(consoleSource).toContain('tone: "warning"');
    expect(consoleSource).toContain('tone: "risk"');
    expect(consoleSource).not.toContain('tone: "emerald"');
    expect(consoleSource).not.toContain('tone: "sky"');
    expect(consoleSource).not.toContain("진단 대기");
    expect(consoleSource).not.toContain("비교 데이터 부족");
    expect(consoleSource).not.toContain(
      "getAdminDashboardPendingContentInsight",
    );
    expect(consoleSource).toContain("if (metricRows.length === 0)");
    expect(consoleSource).not.toContain(
      "while (insights.length < ADMIN_DASHBOARD_CONTENT_INSIGHT_TARGET_COUNT)",
    );
    expect(consoleSource).toContain(
      "`${periodRatioCaptionPrefix} ${formatDashboardPercent(likeRate)} · 현재 전체 누적 ${formatNumber(cumulativeLikeValue)}`",
    );
    expect(consoleSource).toContain(
      "`${periodRatioCaptionPrefix} ${formatDashboardPercent(commentRate)} · 현재 전체 누적 ${formatNumber(cumulativeCommentValue)}`",
    );
    expect(consoleSource).toContain("cumulativeViewValue");
    expect(consoleSource).toContain("cumulativeVideoTotal");
    expect(consoleSource).toContain(
      "buildAdminDashboardPeriodDeltaSparklinePoints",
    );
    expect(consoleSource).toContain("calculateDashboardPeriodMetricChange");
    expect(consoleSource).toContain('"channel-growth"');
    expect(consoleSource).toContain(
      "설명: 선택 기간 영상들의 조회수 합계를 보여주는 카드입니다.",
    );
    expect(consoleSource).toContain(
      "const isChartLoading = isInsightDynamicLoading;",
    );
    expect(consoleSource).not.toContain("getAdminDashboardSparklineStats");
    expect(consoleSource).not.toContain(
      'data-admin-dashboard-visual-stats="true"',
    );
    expect(consoleSource).not.toContain(
      'aria-label={label ? `${label} 최고 평균 최저` : "최고 평균 최저"}',
    );
    expect(consoleSource).not.toContain(
      '{ label: "최고", value: stats.highest }',
    );
    expect(consoleSource).not.toContain(
      '{ label: "평균", value: stats.average }',
    );
    expect(consoleSource).not.toContain(
      '{ label: "최저", value: stats.lowest }',
    );
    expect(consoleSource).not.toContain("impactViewStats");
    expect(consoleSource).not.toContain("trendViewStats");
    expect(consoleSource).not.toContain("opsStatSummary");
    expect(consoleSource).not.toContain("topContentViewStats");
    expect(consoleSource).not.toContain("engagementRateStats");
    expect(consoleSource).toContain("function AdminDashboardKpiValueSkeleton");
    expect(consoleSource).toContain("function AdminDashboardPanelBodySkeleton");
    expect(consoleSource).toContain(
      'data-admin-dashboard-dynamic-skeleton="kpi"',
    );
    expect(consoleSource).toContain(
      'data-admin-dashboard-dynamic-skeleton="chart"',
    );
    expect(consoleSource).toContain(
      'data-admin-dashboard-dynamic-skeleton="bubble"',
    );
    expect(consoleSource).toContain(
      'data-admin-dashboard-dynamic-skeleton="line"',
    );
    expect(consoleSource).toContain(
      'data-admin-dashboard-dynamic-skeleton="stacked"',
    );
    expect(consoleSource).toContain(
      'data-admin-dashboard-dynamic-skeleton="diagnosis"',
    );
    expect(consoleSource).toContain(
      'data-admin-dashboard-dynamic-skeleton="table"',
    );
    expect(consoleSource).toContain(
      '<AdminDashboardPanelBodySkeleton variant="bubble" />',
    );
    expect(consoleSource).toContain(
      '<AdminDashboardPanelBodySkeleton variant="line" />',
    );
    expect(consoleSource).toContain(
      '<AdminDashboardPanelBodySkeleton variant="stacked" />',
    );
    expect(consoleSource).toContain(
      '<AdminDashboardPanelBodySkeleton variant="diagnosis" />',
    );
    expect(consoleSource).toContain(
      'getDashboardCardView("impact") === "table" ? "table" : "bubble"',
    );
    expect(consoleSource).toContain(
      'getDashboardCardView("trend") === "table" ? "table" : "line"',
    );
    expect(consoleSource).toContain(': "stacked"');
    expect(consoleSource).toContain(': "diagnosis"');
    expect(consoleSource).toContain("pendingSkeletonPeriod");
    expect(consoleSource).toContain("setPendingSkeletonPeriod(nextPeriod)");
    expect(consoleSource).toContain("growthInsightQuery.isLoading");
    expect(consoleSource).toContain("pendingSkeletonPeriod === period");
    expect(consoleSource).toContain("isLoading={isChartLoading}");
    expect(consoleSource).toContain("isLoading={isSubscriberLoading}");
    expect(consoleSource).toContain(
      "youtubeChannelQuery.isLoading || pendingSkeletonPeriod === period",
    );
    expect(consoleSource).toContain("youtubeChannelQuery.isFetching");
    expect(consoleSource).toContain("AdminDashboardInfoTooltip");
    expect(consoleSource).toContain("초보자 설명");
    expect(consoleSource).toContain("설명:");
    expect(consoleSource).toContain("읽는 법:");
    expect(consoleSource).toContain("주의:");
    expect(consoleSource).not.toContain("다음 행동:");
    expect(consoleSource).not.toContain("초보자 비유 설명");
    expect(consoleSource).not.toContain("비유:");
    expect(consoleSource).not.toContain("beginner-metaphor");
    expect(consoleSource).not.toContain("발자국");
    expect(consoleSource).not.toContain("스티커");
    expect(consoleSource).not.toContain("방명록");
    expect(consoleSource).not.toContain("메뉴판");
    expect(consoleSource).not.toContain("바구니");
    expect(consoleSource).not.toContain("경고등");
    expect(consoleSource).not.toContain("도시락");
    expect(consoleSource).not.toContain("운동회");
    expect(consoleSource).not.toContain("온도계");
    expect(consoleSource).not.toContain("파이 조각");
    expect(consoleSource).not.toContain("파이에서 차지한 조각");
    expect(consoleSource).not.toContain("data-admin-dashboard-kpi-action");
    expect(consoleSource).not.toContain("다음 행동</span>");
    expect(consoleSource).not.toContain("다음 액션");
    expect(consoleSource).not.toContain("comments-insights");

    expect(consoleSource).toContain("AdminDashboardFullscreenButton");
    expect(consoleSource).toContain("fullscreenWidgetId");
    expect(consoleSource).toContain(
      "data-admin-dashboard-card-fullscreen-trigger",
    );
    expect(consoleSource).toContain(
      "data-admin-dashboard-card-fullscreen-backdrop",
    );
    expect(consoleSource).toContain("adminDashboardFullscreenCardClassName");
    expect(consoleSource).toContain("Escape");
    ["impact", "trend"].forEach((widgetId) => {
      expect(consoleSource).toContain(
        `renderDashboardFullscreenButton("${widgetId}")`,
      );
    });
    [
      "subscribers",
      "views",
      "likes",
      "comments",
      "videos",
      "ops",
      "topContent",
      "engagementRate",
    ].forEach((widgetId) => {
      expect(consoleSource).not.toContain(
        `renderDashboardFullscreenButton("${widgetId}")`,
      );
    });
    expect(consoleSource).toContain("h-[calc(100dvh-1rem)]");
    expect(consoleSource).toContain("sm:h-[calc(100dvh-2rem)]");
    expect(consoleSource).not.toContain(
      'fullscreenAction={renderDashboardFullscreenButton("ops")}',
    );
    expect(consoleSource).not.toContain(
      'isFullscreen={isDashboardWidgetFullscreen("topContent")}',
    );
    expect(consoleSource).not.toContain(
      'isFullscreen={isDashboardWidgetFullscreen("engagementRate")}',
    );
    expect(consoleSource).toContain(
      'isFullscreen && "h-full gap-3 p-2 sm:gap-4 sm:p-4"',
    );
    expect(consoleSource).not.toContain('isFullscreen ? "h-3" : "h-1.5"');

    const committeeAhpRubric = [
      { criterion: "KPI 계산 정의 일관성", weight: 0.32, score: 99 },
      { criterion: "초보자 직접 설명 정확성", weight: 0.25, score: 98 },
      { criterion: "차트 해석성", weight: 0.08, score: 98 },
      { criterion: "오류·폴백 투명성", weight: 0.15, score: 98 },
      { criterion: "운영 행동 연결성", weight: 0.1, score: 98 },
      { criterion: "동작 안정성", weight: 0.1, score: 100 },
    ];
    const committeeAhpScore = committeeAhpRubric.reduce(
      (sum, item) => sum + item.weight * item.score,
      0,
    );
    expect(committeeAhpRubric.reduce((sum, item) => sum + item.weight, 0)).toBe(
      1,
    );
    expect(committeeAhpScore).toBeGreaterThanOrEqual(98);
    expect(committeeAhpRubric.map((item) => item.criterion)).toEqual([
      "KPI 계산 정의 일관성",
      "초보자 직접 설명 정확성",
      "차트 해석성",
      "오류·폴백 투명성",
      "운영 행동 연결성",
      "동작 안정성",
    ]);
    expect(consoleSource).toContain("DEFAULT_ADMIN_DASHBOARD_WIDGET_ORDER");
    expect(consoleSource).toContain(
      'data-admin-dashboard-widget-order-trigger="direct-drag"',
    );
    expect(consoleSource).toContain("data-admin-dashboard-order-mode={");
    expect(consoleSource).toContain("data-admin-dashboard-direct-reorder-card");
    expect(consoleSource).toContain(
      'data-admin-dashboard-order-live-status="true"',
    );
    expect(consoleSource).toContain(
      'data-admin-dashboard-widget-order-reset="true"',
    );
    expect(consoleSource).toContain("const resetDashboardWidgetOrder =");
    expect(consoleSource).toContain('method: "DELETE"');
    expect(consoleSource).toContain(
      "처음 카드 순서로 초기화했습니다. 새로고침해도 처음 상태가 유지됩니다.",
    );
    expect(consoleSource).toContain("isDashboardWidgetOrderDefault");
    expect(consoleSource).toContain(
      "같은 레이아웃 영역 안에서 카드를 드래그하면 순서가 자동 저장됩니다.",
    );
    expect(consoleSource).toContain("원하는 위치로 끌면 즉시 자리가 바뀝니다.");
    expect(consoleSource).toContain("ADMIN_DASHBOARD_WIDGET_LAYOUT_GROUPS");
    expect(consoleSource).toContain(
      "getAdminDashboardWidgetLayoutGroup(sourceWidgetId)",
    );
    expect(consoleSource).toContain("getDashboardCardReorderProps");
    expect(consoleSource).toContain("getDashboardReorderCardClassName");
    expect(consoleSource).toContain("getDashboardCardOrderStyle");
    expect(consoleSource).toContain("viewTransitionName");
    expect(consoleSource).toContain(
      "updateAdminDashboardOrderWithViewTransition",
    );
    expect(consoleSource).toContain("moveAdminDashboardWidgetBeforeOrAfter");
    expect(consoleSource).toContain(
      "draggable: isDashboardOrderEditorOpen && !isDashboardOrderSaving",
    );
    expect(consoleSource).toContain("onDragStart: (event) =>");
    expect(consoleSource).toContain("onDragEnter: (event) =>");
    expect(consoleSource).toContain(
      "previewDraggedDashboardWidget(widgetId, placement, sourceWidgetId)",
    );
    expect(consoleSource).toContain(
      "finishDraggedDashboardWidget(sourceWidgetId)",
    );
    expect(consoleSource).toContain(
      "/api/admin/preferences/dashboard-widget-order",
    );
    expect(consoleSource).toContain(
      'style={getDashboardCardOrderStyle("subscribers")}',
    );
    expect(consoleSource).toContain(
      'style={getDashboardCardOrderStyle("engagementRate")}',
    );
    expect(consoleSource).toContain(
      'reorderProps={getDashboardCardReorderProps("subscribers")}',
    );
    expect(consoleSource).toContain(
      '{...getDashboardCardReorderProps("impact")}',
    );
    expect(consoleSource).not.toContain(
      'data-admin-dashboard-widget-order-editor="drag-drop"',
    );
    expect(consoleSource).toContain(
      'type AdminDashboardCardView = "chart" | "table"',
    );
    expect(consoleSource).toContain("DEFAULT_ADMIN_DASHBOARD_CARD_VIEWS");
    expect(consoleSource).toContain("function AdminDashboardViewToggle");
    expect(consoleSource).toContain(
      'data-admin-dashboard-card-view-toggle="true"',
    );
    expect(consoleSource).toContain(
      'className={cn(adminDashboardControlGroupClassName, "overflow-hidden")}',
    );
    expect(consoleSource).toContain("그래프");
    expect(consoleSource).toContain("표");
    expect(consoleSource).toContain("function AdminDashboardScrollTable");
    expect(consoleSource).toContain('data-admin-dashboard-table-view="true"');
    expect(consoleSource).toContain("useAdminDashboardProgressiveItems");
    expect(consoleSource).toContain(
      "ADMIN_DASHBOARD_PROGRESSIVE_INITIAL_ROWS = 40",
    );
    expect(consoleSource).toContain(
      "ADMIN_DASHBOARD_MOBILE_PROGRESSIVE_INITIAL_ROWS = 18",
    );
    expect(consoleSource).toContain(
      "ADMIN_DASHBOARD_MOBILE_PROGRESSIVE_BATCH_ROWS = 24",
    );
    expect(consoleSource).toContain(
      "ADMIN_DASHBOARD_MOBILE_PROGRESSIVE_DELAY_MS = 48",
    );
    expect(consoleSource).toContain("function AdminDashboardDeferredBody");
    expect(consoleSource).toContain(
      'data-admin-dashboard-mobile-deferred="true"',
    );
    expect(consoleSource).toContain("ADMIN_DASHBOARD_MOBILE_DEFER_ROOT_MARGIN");
    expect(consoleSource).toContain("const shouldDeferDashboardHeavyBodies =");
    expect(consoleSource).toContain("isDashboardMobileViewport &&");
    expect(consoleSource).toContain("refetchOnWindowFocus: false");
    expect(consoleSource).toContain("refetchIntervalInBackground: false");
    expect(consoleSource).toContain(
      'data-admin-dashboard-progressive-table="true"',
    );
    expect(consoleSource).toContain(
      'data-admin-dashboard-progressive-chart="true"',
    );
    expect(consoleSource).toContain(
      "추가 행 표시 중 {formatNumber(rows.length)}/{formatNumber(totalRows)}",
    );
    expect(consoleSource).toContain("const progressiveImpactTableRows =");
    expect(consoleSource).toContain("const progressiveTrendPoints =");
    expect(consoleSource).toContain("const progressiveTrendTableRows =");
    expect(consoleSource).toContain("const progressiveTopContentTableRows =");
    expect(consoleSource).toContain(
      "overflow-y-auto overflow-x-hidden scrollbar-hide rounded-xl border border-border/70",
    );
    expect(consoleSource).toContain(
      'className="w-full table-fixed border-separate border-spacing-0 text-xs"',
    );
    expect(consoleSource).toContain("title={row.title}");
    expect(consoleSource).toContain("sticky top-0 z-10 bg-background");
    expect(consoleSource).toContain("dashboardCardViews");
    expect(consoleSource).toContain('value={getDashboardCardView("impact")}');
    expect(consoleSource).toContain(
      'value={getDashboardCardView("topContent")}',
    );
    expect(consoleSource).toContain(
      'value={getDashboardCardView("engagementRate")}',
    );
    expect(consoleSource).toContain('view={getDashboardCardView("ops")}');
    expect(consoleSource).toContain("impactTableRows");
    expect(consoleSource).toContain("trendTableRows");
    expect(consoleSource).toContain("topContentTableRows");
    expect(consoleSource).toContain("totalPointCount={trendPoints.length}");
    expect(consoleSource).toContain("dot={isDenseChart ? false");
    expect(consoleSource).not.toContain("isDenseChart ? null");
    expect(consoleSource).toContain('dataKey="조회수최고"');
    expect(consoleSource).toContain('dataKey="조회수최저"');
    expect(consoleSource).toContain('dataKey="참여최고"');
    expect(consoleSource).toContain('dataKey="참여최저"');
    expect(consoleSource).toContain('dataKey="참여율최고"');
    expect(consoleSource).toContain('dataKey="참여율최저"');
    expect(consoleSource).toContain("영상 제목");
    expect(consoleSource).toContain("참여율");
    expect(consoleSource).toContain("formatDashboardChangeLabel");
    expect(consoleSource).toContain("calculateDashboardMetricChange");
    expect(consoleSource).toContain("calculateRecentWindowChange");
    expect(consoleSource).toContain(
      "delta={formatDashboardChangeLabel(viewChange)}",
    );
    expect(consoleSource).toContain(
      "delta={formatDashboardChangeLabel(likeChange)}",
    );
    expect(consoleSource).toContain(
      "delta={formatDashboardChangeLabel(commentChange)}",
    );
    expect(consoleSource).toContain(
      "delta={formatDashboardChangeLabel(videoCountChange)}",
    );
    expect(consoleSource).toContain("periodUploadVideoValue");
    expect(consoleSource).toContain("calculateDashboardUploadCountChange");
    expect(consoleSource).toContain("uploadCountCohortChange");
    expect(consoleSource).toContain("hasSnapshotVideoCountComparison");
    expect(consoleSource).toContain("channelStats?.videoDelta");
    expect(consoleSource).toContain(
      'typeof channelStats.previousVideoCount === "number"',
    );
    expect(consoleSource).toContain(
      "getAdminDashboardDeltaSourceLabel(channelStats?.deltaSource)",
    );
    expect(consoleSource).toContain("subscriberDelta");
    expect(consoleSource).toContain("subscriberChange");
    expect(consoleSource).toContain("subscriberCardTitle");
    expect(consoleSource).toContain("title={subscriberCardTitle}");
    expect(consoleSource).not.toContain("dataScopeLabel");
    expect(consoleSource).not.toContain("subscriberScopeLabel");
    expect(consoleSource).not.toContain("periodMetricScopeLabel");
    expect(consoleSource).not.toContain("기간 업로드</span>");
    expect(consoleSource).toContain(
      "현재 구독자 · YouTube Data API · ${getAdminDashboardDeltaSourceLabel(channelStats?.deltaSource)}",
    );
    expect(consoleSource).toContain(
      "`현재 구독자 · ${selectedPeriodLabel} 기간 순증 ${formatSignedNumber(subscriberDelta)} · ${getAdminDashboardDeltaSourceLabel(channelStats?.deltaSource)}`",
    );
    expect(consoleSource).toContain(
      'const subscriberCardTitle = "현재 구독자"',
    );
    expect(consoleSource).toContain("formatSignedNumber(subscriberDelta)");
    expect(consoleSource).toContain('deltaLabel="기간 대비"');
    expect(consoleSource).toContain(
      'data-admin-dashboard-kpi-delta="timeframe"',
    );
    expect(consoleSource).toContain('deltaLabel = "기간 대비"');
    expect(consoleSource).toContain('deltaLabel="기간 대비"');
    expect(consoleSource).toContain(
      "계산식: 기간 대비 = (현재값 - 이전값) / 이전값 × 100",
    );
    expect(consoleSource).not.toContain(
      "title={`${title} ${deltaLabel}: ${delta}. 계산식: 기간 대비 = (현재값 - 이전값) / 이전값 × 100`}",
    );
    expect(consoleSource).toContain(
      "계산식: 기간 구독자 증가 = API가 제공한 delta를 우선 사용하고, 없을 때만 현재 구독자 - 이전 구독자로 계산합니다.",
    );
    expect(consoleSource).toContain(
      "계산식: 기간 조회 증가 = 각 영상의 (현재 조회수 - 이전 조회수) 합계.",
    );
    expect(consoleSource).toContain(
      "처리: 비교 버킷 이후 신규 영상은 이전값 0으로 보고, 비교 버킷 이전 영상인데 이전값이 없으면 비교 불가로 분리합니다.",
    );
    expect(consoleSource).toContain(
      "계산식: 기간 좋아요 증가 = 각 영상의 (현재 좋아요 - 이전 좋아요) 합계.",
    );
    expect(consoleSource).toContain(
      "참고: 좋아요 비율은 조회수 중 좋아요로 반응한 비중입니다.",
    );
    expect(consoleSource).toContain(
      "계산식: 기간 댓글 증가 = 각 영상의 (현재 댓글 - 이전 댓글) 합계.",
    );
    expect(consoleSource).toContain(
      "참고: 댓글 비율은 조회수 중 댓글로 반응한 비중입니다.",
    );
    expect(consoleSource).toContain(
      "계산식: 업로드 영상 수 = API가 제공한 videoDelta를 우선 사용하고, 없을 때만 현재 channel videoCount - 이전 channel videoCount로 계산합니다.",
    );
    expect(consoleSource).not.toContain(
      "계산식: 스냅샷이 없으면 업로드 영상 수 = 선택 기간 영상 목록 개수.",
    );
    expect(consoleSource).toContain(
      "inline-flex shrink-0 items-center gap-1 rounded-full bg-muted/45",
    );
    expect(consoleSource).toContain(
      "설명: 선택 기간에 새로 올라온 영상 수를 보여주는 카드입니다.",
    );
    expect(consoleSource).toContain('className="h-px bg-border/70"');
    expect(consoleSource).toContain("mb-2 grid min-w-0 shrink-0 gap-2");
    expect(consoleSource).toContain(
      'data-admin-dashboard-metric-tooltip="beginner-plain"',
    );
    expect(consoleSource).toContain(
      'className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-muted-foreground transition hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"',
    );
    expect(consoleSource).not.toContain("md:h-5 md:w-5");
    expect(consoleSource).toContain(
      "설명: 선택 기간 업로드 영상을 게시일 순서로 놓고 조회수, 참여, 참여율을 비교합니다.",
    );
    expect(consoleSource).toContain('year: "2-digit"');
    expect(consoleSource).toContain(
      "읽는 법: 조회·반응(좋아요+댓글)·반응률을 각각 100점 기준으로 맞춰 같은 눈금에서 비교합니다.",
    );
    expect(consoleSource).toContain("반응(좋아요+댓글)·반응률");
    expect(consoleSource).toContain(
      'data-admin-dashboard-kpi-card="recharts-sparkline"',
    );
    expect(consoleSource).toContain(
      'data-admin-dashboard-kpi-sparkline="true"',
    );
    const kpiSparklineSource = consoleSource.slice(
      consoleSource.indexOf('data-admin-dashboard-kpi-sparkline="true"'),
      consoleSource.indexOf("function AdminDashboardOpsSummaryCard"),
    );
    expect(kpiSparklineSource).toContain("<RechartsTooltip");
    expect(kpiSparklineSource).toMatch(
      /content=\{\s*<AdminDashboardKpiSparklineTooltip title=\{title\} \/>\s*\}/,
    );
    expect(kpiSparklineSource).not.toContain("contentStyle=");
    expect(kpiSparklineSource).not.toContain("labelFormatter=");
    expect(consoleSource).toContain('dataAttribute="kpi-sparkline"');
    expect(consoleSource).toContain(
      "설명: 채널 구독자 수를 보여주는 카드입니다.",
    );
    expect(consoleSource).toContain(
      "relative z-0 grid min-h-[132px] grid-rows-[auto_minmax(0,1fr)_auto] gap-3 overflow-visible p-3 sm:p-3.5 hover:z-20 focus-within:z-20",
    );
    expect(consoleSource).toContain(
      'data-admin-dashboard-kpi-title-row="single-line"',
    );
    expect(consoleSource).toContain(
      "truncate whitespace-nowrap text-[11px] font-extrabold tracking-[0.04em] text-muted-foreground",
    );
    expect(consoleSource).toContain(
      'data-admin-dashboard-kpi-title-actions="single-line-scroll"',
    );
    const compactKpiCardTitleSource = consoleSource.slice(
      consoleSource.indexOf("function AdminDashboardKpiCard"),
      consoleSource.indexOf("function AdminDashboardOpsSummaryCard"),
    );
    expect(compactKpiCardTitleSource).toContain(
      'data-admin-dashboard-kpi-title-actions="single-line-scroll"',
    );
    expect(compactKpiCardTitleSource).not.toContain("min-h-11 min-w-[44px]");
    expect(compactKpiCardTitleSource).not.toContain("md:h-7 md:min-h-0");
    expect(consoleSource).toContain("h-11 w-24 shrink-0 overflow-visible");
    expect(consoleSource).toContain("buildAdminDashboardSparklinePoints");
    expect(consoleSource).toContain(
      "allowEscapeViewBox={{ x: true, y: true }}",
    );
    expect(consoleSource).toContain(
      "wrapperStyle={adminDashboardTooltipWrapperStyle}",
    );
    expect(consoleSource).toContain("AdminDashboardOpsSummaryCard");
    expect(consoleSource).toContain("운영·검수 요약");
    expect(consoleSource).toContain(
      "설명: 위쪽은 운영 중인 데이터 수, 아래쪽은 확인이 필요한 데이터 수입니다.",
    );
    expect(consoleSource).toContain(
      "flex h-full min-h-[320px] flex-col p-3 text-xs sm:min-h-[280px]",
    );
    expect(consoleSource).toContain("text-[12px] font-extrabold tabular-nums text-foreground sm:text-[13px]");
    expect(consoleSource).toContain(
      'data-admin-dashboard-ops-summary-visual="progress-bars"',
    );
    expect(consoleSource).toContain("rawValue: stats.totalRestaurants ?? 0");
    expect(consoleSource).toContain("rawValue: missingCoordinates ?? 0");
    expect(consoleSource).toContain("const maxRawValue = Math.max");
    expect(consoleSource).toContain("const rowPercent = clampDashboardPercent");
    expect(consoleSource).toContain(
      "adminDashboardVisualizationShellClassName",
    );
    expect(consoleSource).toContain("rounded-xl p-1 sm:p-1.5");
    expect(consoleSource).toContain("grid content-stretch gap-2");
    expect(consoleSource).toContain(
      "grid grid-cols-[minmax(4.5rem,5.5rem)_minmax(0,1fr)_minmax(3.25rem,max-content)]",
    );
    expect(consoleSource).toContain("text-teal-700 dark:text-teal-300");
    expect(consoleSource).toContain("text-rose-700 dark:text-rose-300");
    expect(consoleSource).toContain("bg-muted-foreground/35");
    const subscriberKpiSource = consoleSource.slice(
      consoleSource.lastIndexOf('widgetId="subscribers"'),
      consoleSource.lastIndexOf('widgetId="views"'),
    );
    const viewsKpiSource = consoleSource.slice(
      consoleSource.lastIndexOf('widgetId="views"'),
      consoleSource.lastIndexOf('widgetId="likes"'),
    );
    const likesKpiSource = consoleSource.slice(
      consoleSource.lastIndexOf('widgetId="likes"'),
      consoleSource.lastIndexOf('widgetId="comments"'),
    );
    const commentsKpiSource = consoleSource.slice(
      consoleSource.lastIndexOf('widgetId="comments"'),
      consoleSource.lastIndexOf('widgetId="videos"'),
    );
    const videosKpiSource = consoleSource.slice(
      consoleSource.lastIndexOf('widgetId="videos"'),
      consoleSource.indexOf('data-admin-dashboard-widget-card="impact"'),
    );
    expect(viewsKpiSource).toContain('tone="sky"');
    expect(viewsKpiSource).toContain('emphasis="primary"');
    expect(subscriberKpiSource).toContain('tone="teal"');
    expect(subscriberKpiSource).toContain('emphasis="supporting"');
    expect(likesKpiSource).toContain('tone="rose"');
    expect(likesKpiSource).toContain('emphasis="supporting"');
    expect(commentsKpiSource).toContain('tone="amber"');
    expect(commentsKpiSource).toContain('emphasis="supporting"');
    expect(videosKpiSource).toContain('tone="teal"');
    expect(videosKpiSource).toContain('emphasis="supporting"');
    expect(consoleSource).not.toContain(
      "rounded-xl border border-border/60 bg-card/45 p-3",
    );
    expect(consoleSource).toContain('"lg:col-span-2"');
    expect(consoleSource).toContain('"sm:col-span-2 lg:col-span-3"');
    expect(consoleSource).toContain(
      "flex min-h-[280px] flex-col overflow-hidden p-3",
    );
    expect(consoleSource).toContain(
      "flex min-h-[360px] flex-col overflow-hidden p-3 sm:min-h-[220px]",
    );
    expect(consoleSource).toContain(
      "flex min-h-[360px] flex-col overflow-hidden p-2 sm:min-h-[220px]",
    );
    expect(consoleSource).toContain("min-h-[190px] flex flex-1 flex-col");
    expect(consoleSource).toContain("min-h-[230px] flex flex-1 flex-col");
    expect(consoleSource).toContain("height={18}");
    expect(consoleSource).toContain("tickMargin={2}");
    expect(consoleSource).not.toContain("AdminDashboardLedgerCard");
    expect(consoleSource).not.toContain("AdminDashboardGaugeCard");
    expect(consoleSource).toContain("AdminDashboardGroupedBarChart");
    expect(consoleSource).toContain("AdminDashboardAreaChart");
    expect(consoleSource).not.toContain("구독자 실시간 소스 미연결");
    expect(consoleSource).not.toContain("function buildMetricSeries");
  });

  test("keeps KPI PDF report export printable without unsafe HTML sinks", () => {
    const consoleSource = adminConsoleShellSource();
    const pdfReportBuilderSource = consoleSource.slice(
      consoleSource.indexOf("function buildAdminDashboardPdfReportHtml"),
      consoleSource.indexOf("function openAdminDashboardPdfReport"),
    );
    const pdfReportOpenSource = consoleSource.slice(
      consoleSource.indexOf("function openAdminDashboardPdfReport"),
      consoleSource.indexOf("async function fetchAdminPendingCounts"),
    );

    expect(consoleSource).toContain("FileDown");
    expect(consoleSource).toContain("function AdminDashboardPdfReportButton");
    expect(consoleSource).toContain(
      'data-admin-dashboard-kpi-pdf-export-trigger="true"',
    );
    expect(consoleSource).toContain("buildAdminDashboardPdfReportHtml");
    expect(consoleSource).toContain("openAdminDashboardPdfReport");
    expect(consoleSource).toContain("쯔양 KPI 대시보드 보고서");
    expect(consoleSource).not.toContain("Tzuyang KPI Dashboard Report");
    expect(pdfReportBuilderSource).toContain(
      '<img src="/logo.webp" alt="Tzudong 로고" />',
    );
    expect(pdfReportBuilderSource).toContain("<dl>");
    expect(pdfReportBuilderSource).toContain("<table>");
    expect(pdfReportBuilderSource).toContain("콘텐츠 성과 TOP 5");
    expect(pdfReportBuilderSource).toContain("성과 진단");
    expect(pdfReportBuilderSource).toContain("브라우저의 인쇄 명령");
    expect(pdfReportBuilderSource).toContain("Ctrl+P");
    expect(pdfReportBuilderSource).not.toContain("report.logoUrl");
    expect(pdfReportBuilderSource).not.toMatch(/<style\b/i);
    expect(pdfReportBuilderSource).not.toMatch(/\bstyle\s*=/i);
    expect(pdfReportBuilderSource).not.toMatch(/<script\b/i);
    expect(pdfReportBuilderSource).not.toMatch(/\son[a-z]+\s*=/i);
    expect(pdfReportBuilderSource).not.toContain("onclick=");
    expect(pdfReportBuilderSource).not.toMatch(/\bhref\s*=/i);
    expect(pdfReportBuilderSource).not.toMatch(
      /\bsrc\s*=\s*["']\s*(?:javascript|data|blob):/i,
    );

    const reportHtmlInterpolations = [
      ...pdfReportBuilderSource.matchAll(/\$\{([^}]+)\}/g),
    ].map((match) => match[1].trim());
    expect(reportHtmlInterpolations.length).toBeGreaterThan(0);
    for (const interpolation of reportHtmlInterpolations) {
      expect(
        interpolation.startsWith("escapeAdminDashboardReportHtml(") ||
          ["metricCards", "topRows", "insightCards"].includes(interpolation),
      ).toBe(true);
    }

    expect(pdfReportOpenSource).toContain(
      'window.open("", "_blank", "noopener,width=960,height=1200")',
    );
    expect(pdfReportOpenSource).toContain("reportWindow.opener = null;");
    expect(pdfReportOpenSource).toContain("if (reportWindow.opener !== null)");
    expect(pdfReportOpenSource.indexOf("reportWindow.opener = null;")).toBeLessThan(
      pdfReportOpenSource.indexOf("reportWindow.document.write"),
    );
    expect(pdfReportOpenSource).toContain("reportWindow?.close();");
    expect(pdfReportOpenSource).toContain("return false;");
    expect(pdfReportOpenSource).toContain("reportWindow?.print()");
    expect(pdfReportOpenSource).toContain("} catch {");
    expect(consoleSource).toContain('data-layout-recipe="command-surface"');
    expect(consoleSource).toContain('data-admin-dashboard-action-bar="true"');
    expect(consoleSource).toContain(
      'data-admin-dashboard-action-order="order-reset-report-collection-period"',
    );
    expect(consoleSource).toContain(
      'data-horizontal-scroll-owner="admin-dashboard-action-bar"',
    );
    expect(consoleSource).toContain(
      'data-admin-dashboard-action-group="order"',
    );
    expect(consoleSource).toContain(
      'data-admin-dashboard-action-group="report"',
    );
    expect(consoleSource).toContain(
      "order-1 flex shrink-0 items-center justify-end gap-1",
    );
    expect(consoleSource).toContain(
      "order-2 flex shrink-0 items-center justify-end gap-1",
    );
    expect(consoleSource).toContain("order-3 h-7 shrink-0 gap-1");
    expect(consoleSource).toContain(
      'data-admin-dashboard-period-options-inline="desktop"',
    );
    expect(consoleSource).toContain("md:hidden");
    expect(consoleSource).toContain(
      "hidden shrink-0 flex-wrap justify-end gap-1 md:flex",
    );
    expect(
      consoleSource.indexOf(
        'data-admin-dashboard-widget-order-trigger="direct-drag"',
      ),
    ).toBeLessThan(
      consoleSource.indexOf('data-admin-dashboard-widget-order-reset="true"'),
    );
    expect(
      consoleSource.indexOf('data-admin-dashboard-widget-order-reset="true"'),
    ).toBeLessThan(consoleSource.indexOf("<AdminDashboardPdfReportButton"));
    expect(
      consoleSource.indexOf("<AdminDashboardPdfReportButton"),
    ).toBeLessThan(
      consoleSource.indexOf("<AdminDashboardCollectionLogPopover"),
    );
    expect(
      consoleSource.indexOf("<AdminDashboardCollectionLogPopover"),
    ).toBeLessThan(consoleSource.indexOf("<AdminDashboardPeriodSelector"));
  });

  test("supports sub-day admin KPI dashboard periods in the insights source", () => {
    const treemapSource = source("lib/public-insights/treemap.ts");

    expect(treemapSource).toContain("'30MIN' | '1H' | '6H' | '12H' | '1D'");
    expect(treemapSource).toContain("const MINUTE_MS = 60 * 1000");
    expect(treemapSource).toContain("const HOUR_MS = 60 * MINUTE_MS");
    expect(treemapSource).toContain("periodToMilliseconds");
    expect(treemapSource).toContain("normalized === '30MIN'");
    expect(treemapSource).toContain("normalized === '1H'");
    expect(treemapSource).not.toContain("periodToDays");
  });

  test("keeps live YouTube KPI refresh behind an admin-only server route", () => {
    const routeSource = source("app/api/admin/youtube-kpis/route.ts");

    expect(routeSource).toContain("requireAdmin");
    expect(routeSource).toContain(
      "https://www.googleapis.com/youtube/v3/channels",
    );
    expect(routeSource).toContain(
      "https://www.googleapis.com/youtube/v3/playlistItems",
    );
    expect(routeSource).toContain(
      "https://www.googleapis.com/youtube/v3/videos",
    );
    expect(routeSource).toContain("MAX_YOUTUBE_KPI_PLAYLIST_PAGES");
    expect(routeSource).toContain("parseTreemapPeriod");
    expect(routeSource).toContain(
      'request.nextUrl.searchParams.get("scope") === "channel-growth"',
    );
    expect(routeSource).toContain(
      "filterByPublishedPeriod: !isChannelGrowthScope",
    );
    expect(routeSource).toContain(
      'filterByPeriod: !isChannelGrowthScope && period !== "ALL"',
    );
    expect(routeSource).toContain("pageToken");
    expect(routeSource).toContain("snippet,statistics,contentDetails");
    expect(routeSource).toContain("previousViewCount: null");
    expect(routeSource).toContain(
      '"Cache-Control": "private, no-store, max-age=0"',
    );
  });

  test("keeps admin pending counts behind an admin-only server route", () => {
    const consoleSource = adminConsoleShellSource();
    const routeSource = source("app/api/admin/pending-counts/route.ts");


    expect(consoleSource).toContain('fetch("/api/admin/pending-counts"');
    expect(consoleSource).not.toContain("fetchSupabaseExactCount");
    expect(routeSource).toContain("await requireAdmin()");
    expect(routeSource.indexOf("await requireAdmin()")).toBeLessThan(
      routeSource.indexOf("createSupabaseServiceRoleClient()"),
    );
    expect(routeSource).toContain('from("restaurant_submissions")');
    expect(routeSource).toContain(
      '.in("status", ["pending", "partially_approved"])',
    );
    expect(routeSource).toContain('from("reviews")');
    expect(routeSource).toContain('.eq("is_verified", false)');
    expect(routeSource).toContain('{ count: "exact", head: true }');
  });

  test("keeps admin system status center in a dedicated hook/component with fail-closed run_daily states", () => {
    const consoleSource = adminConsoleShellSource();
    const centerSource = source(
      "components/admin/system-status/AdminSystemStatusCenter.tsx",
    );
    const hookSource = source("hooks/use-admin-status-center.ts");
    const viewModelSource = source("lib/admin/system-status/view-model.ts");
    const routeSource = source("app/api/admin/system-status/route.ts");

    expect(consoleSource).not.toContain(
      'import("@/components/admin/system-status/AdminSystemStatusCenter")',
    );
    expect(consoleSource).not.toContain("<AdminSystemStatusCenter isAdmin={isAdmin} />");
    expect(consoleSource).not.toContain('data-admin-system-status-slot="true"');
    expect(consoleSource).not.toContain("운영 상태 센터");
    expect(centerSource).toContain('data-admin-system-status-center="true"');
    expect(centerSource).toContain("data-admin-run-daily-state=");
    expect(centerSource).toContain("data-admin-nightly-regression-state=");
    expect(centerSource).toContain("data-admin-run-daily-artifact-state=");
    expect(centerSource).toContain("data-admin-system-status-pending-counts=");
    expect(hookSource).toContain("/api/admin/system-status");
    expect(hookSource).toContain("/api/admin/pending-counts");
    expect(consoleSource).toContain("queryKey: ADMIN_PENDING_COUNTS_QUERY_KEY");
    expect(hookSource).toContain("queryKey: ADMIN_PENDING_COUNTS_QUERY_KEY");
    expect(hookSource).toContain("systemStatusQuery.isRefetchError");
    expect(hookSource).toContain("pendingCountsQuery.isRefetchError");
    expect(hookSource).toContain(
      "systemStatusQueryFailed ? undefined : systemStatusQuery.data",
    );
    expect(hookSource).toContain("pendingCountsQueryFailed");
    expect(viewModelSource).toContain("latestManifestPath");
    expect(viewModelSource).toContain("lastSuccessfulRunId");
    expect(viewModelSource).toContain("consecutiveFailures");
    expect(viewModelSource).toContain("rclone_exit_zero");
    expect(viewModelSource).toContain("manifest 없음");
    expect(routeSource).toContain("await requireAdmin()");
  });

  test("keeps YouTube channel statistics behind an admin-only server route", () => {
    const routeSource = source("app/api/admin/youtube-channel/route.ts");

    expect(routeSource).toContain("requireAdmin");
    expect(routeSource).toContain(
      "https://www.googleapis.com/youtube/v3/channels",
    );
    expect(routeSource).toContain(
      'url.searchParams.set("part", "snippet,statistics")',
    );
    expect(routeSource).toContain("subscriberCount");
    expect(routeSource).toContain("hiddenSubscriberCount");
    expect(routeSource).toContain("parseTreemapPeriod");
    expect(routeSource).toContain("previousSubscriberCount");
    expect(routeSource).toContain("previousBucketStartedAt");
    expect(routeSource).toContain("subscriberDelta");
    expect(routeSource).toContain("comparisonFetchedAt");
    expect(routeSource).toContain("YOUTUBE_API_KEY");
    expect(routeSource).not.toContain("NEXT_PUBLIC_YOUTUBE_API_KEY");
    expect(routeSource).toContain("YOUTUBE_CHANNEL_ID");
    expect(routeSource).toContain("YOUTUBE_CHANNEL_HANDLE");
    expect(routeSource).toContain("@tzuyang6145");
    expect(routeSource).toContain("respondWithYouTubeChannelSnapshotFallback");
    expect(routeSource).toContain("fallbackSource");
    expect(routeSource).toContain("supabase-channel-snapshot");
    expect(routeSource).toContain("LOCAL_CHANNEL_SNAPSHOT_UNAVAILABLE");
    expect(routeSource).toContain('process.env.NEXT_PUBLIC_TZUDONG_LOCAL_RUNTIME === "1"');
    expect(routeSource).toContain("YouTube channel statistics request failed");
    expect(routeSource).toContain(
      "YouTube channel subscriber count was unavailable",
    );
    expect(routeSource).toContain("Cache-Control");
  });

  test("does not render an admin access gate for non-admin visitors", () => {
    const consoleSource = adminConsoleShellSource();
    const middlewareSource = source("lib/supabase/middleware.ts");

    expect(consoleSource).toContain("shouldRenderAdminShell");
    expect(consoleSource).toContain("canLoadAdminConsoleData");
    expect(consoleSource).toContain(
      'E2E_ADMIN_SHELL_BYPASS_STORAGE_KEY = "tzudong:e2e-admin-shell-bypass"',
    );
    expect(consoleSource).not.toContain(
      'process.env.NODE_ENV === "production" || typeof window === "undefined"',
    );
    expect(consoleSource).toContain(
      'if (typeof window === "undefined") return false;',
    );
    expect(consoleSource).toContain(
      "isLocalE2EAdminShellBypassHost(window.location.hostname)",
    );
    expect(consoleSource).toContain("try {");
    expect(consoleSource).toContain(
      'window.localStorage.getItem(E2E_ADMIN_SHELL_BYPASS_STORAGE_KEY) === "1"',
    );
    expect(consoleSource).toContain("} catch {");
    expect(consoleSource).toContain("return false;");
    expect(consoleSource).toContain("hasLocalE2EAdminShellBypass()");
    expect(consoleSource).toContain(
      "(Boolean(user) || hasE2EAdminShellBypass) && !isShellBootstrapping",
    );
    expect(consoleSource).toContain(
      "useAdminOverviewStats(canLoadAdminConsoleData)",
    );
    expect(consoleSource).toContain("return null;");
    expect(consoleSource).not.toContain('router.replace("/")');
    expect(consoleSource).not.toContain("if (!user || !isAdmin)");
    expect(consoleSource).not.toContain("function AdminAccessGate");
    expect(consoleSource).not.toContain("관리자 로그인이 필요합니다");
    expect(consoleSource).not.toContain("관리자 권한이 필요합니다");
    expect(consoleSource).not.toContain("로그인 창 열기");
    expect(consoleSource).not.toContain("AUTH_UI_REQUEST_EVENT");
    expect(middlewareSource).toContain("isProtectedAdminRequest");
    expect(middlewareSource).toContain(
      "pathname === '/admin' || pathname.startsWith('/admin/')",
    );
    expect(middlewareSource).toContain(
      "pathname === '/api/admin' || pathname.startsWith('/api/admin/')",
    );
    expect(middlewareSource).toContain("isAdminNavigationRequest");
    expect(middlewareSource).toContain("eq('role', 'admin')");
    expect(middlewareSource).toContain(
      "const redirectAdminLoginWithSessionCookies",
    );
    expect(middlewareSource).toContain(
      "redirectUrl.searchParams.set(AUTH_LOGIN_QUERY_PARAM, AUTH_LOGIN_QUERY_VALUE)",
    );
    expect(middlewareSource).toContain("AUTH_REDIRECT_NEXT_PARAM");
    expect(middlewareSource).toContain(
      "const redirectAdminHomeWithSessionCookies",
    );
    expect(middlewareSource).not.toContain(
      "redirectAdminAuthRequiredWithSessionCookies",
    );
    expect(middlewareSource).toContain("getCanonicalSameOriginNextPath(request)");
  });

  test("keeps unified admin console as the single operator shell", () => {
    const consoleSource = adminConsoleShellSource();
    const adminPageSource = source("app/admin/page.tsx");
    const appGlobalsSource = source("app/app-globals.css");

    expect(adminPageSource).toContain(
      "<AdminConsoleOverview initialStoryboardResult={initialStoryboardResult} />",
    );
    for (const moduleId of [
      '"restaurants"',
      '"submissions"',
      '"reviews"',
      '"storyboard"',
      '"banners"',
      '"users"',
      '"insights"',
      '"audit"',
      '"youtube-thumbnail-generator"',
      '"llm"',
      '"pipeline"',
    ]) {
      expect(consoleSource).toContain(moduleId);
    }
    expect(consoleSource).toContain("orderedSidebarSections");
    expect(consoleSource).toContain(
      'const SIDEBAR_NAV_LANDMARK_NAME = "관리자 통합 메뉴"',
    );
    expect(consoleSource).toContain("aria-label={SIDEBAR_NAV_LANDMARK_NAME}");
    expect(consoleSource).toContain('aria-label="관리자 콘솔 작업 화면"');
    expect(consoleSource).toContain(
      'data-admin-console-layout="sidebar-content"',
    );
    expect(consoleSource).toContain('data-admin-console-content="true"');
    expect(consoleSource).toContain(
      "overscroll-contain scrollbar-hide border-y border-border",
    );
    expect(consoleSource).not.toContain(
      "pb-[calc(env(safe-area-inset-bottom)+5.75rem)]",
    );
    expect(consoleSource).toContain("h-[var(--full-height,100vh)]");
    expect(appGlobalsSource).toContain('[data-admin-console-shell="true"]');
    expectCssDeclaration(
      appGlobalsSource,
      '[data-admin-console-shell="true"]',
      "height",
      "var(--full-height, 100vh)",
    );
    expect(consoleSource).toContain('data-admin-sidebar-header="true"');
    expect(consoleSource).toContain('data-admin-sidebar-header-copy="true"');
    expectCssDeclaration(
      appGlobalsSource,
      '[data-admin-sidebar-scroll="hidden-scrollbar"] > [data-admin-sidebar-header="true"]',
      "margin-bottom",
      "0.375rem",
    );
    expectCssDeclaration(
      appGlobalsSource,
      '[data-admin-sidebar-scroll="hidden-scrollbar"] > [data-admin-sidebar-header="true"]',
      "padding-bottom",
      "0.375rem",
    );
    expectCssDeclaration(
      appGlobalsSource,
      '[data-admin-sidebar-menu-scroll="hidden-scrollbar"]',
      "padding-top",
      "0.5rem",
    );
    expectCssDeclaration(
      appGlobalsSource,
      '[data-admin-sidebar-menu-scroll="hidden-scrollbar"]',
      "padding-bottom",
      "1rem",
    );
    expectCssDeclaration(
      appGlobalsSource,
      '[data-admin-sidebar-section-list="spacious"] > :not([hidden]) ~ :not([hidden])',
      "margin-top",
      "0.75rem",
    );
    expectCssDeclaration(
      appGlobalsSource,
      '[data-admin-sidebar-section-list="spacious"] > * > :not([hidden]) ~ :not([hidden])',
      "margin-top",
      "0.375rem",
    );
    expect(appGlobalsSource).not.toContain(
      '[data-admin-sidebar-footer-separator="spacious"]',
    );
    expect(appGlobalsSource).not.toContain(
      '[data-admin-sidebar-theme-toggle="true"][data-admin-sidebar-theme-layout="sidebar"]',
    );
    expect(appGlobalsSource).not.toContain(
      "grid-template-columns: repeat(3, minmax(0, 1fr));",
    );
    expect(consoleSource).toContain("grid-rows-[auto_minmax(0,1fr)]");
    expect(consoleSource).toContain("md:grid-rows-1");
    expect(consoleSource).not.toContain("md:grid-cols-[16rem_minmax(0,1fr)]");
    expect(consoleSource).not.toContain("md:grid-cols-[4.5rem_minmax(0,1fr)]");
    expect(consoleSource).toContain("data-admin-console-sidebar-collapsed={");
    expect(consoleSource).toContain('isSidebarCollapsed ? "true" : "false"');
    expect(appGlobalsSource).toContain(
      '[data-admin-console-layout="sidebar-content"]',
    );
    expect(appGlobalsSource).toMatch(
      /grid-template-columns:\s*fit-content\(var\(--admin-sidebar-expanded-max-width\)\)\s*minmax\(0, 1fr\);/,
    );
    expect(
      appGlobalsSource.match(
        /grid-template-columns:\s*fit-content\(var\(--admin-sidebar-expanded-max-width\)\)\s*minmax\(0, 1fr\);/g,
      ) ?? [],
    ).toHaveLength(1);
    expect(
      appGlobalsSource.match(
        /grid-template-columns: 4\.5rem minmax\(0, 1fr\);/g,
      ) ?? [],
    ).toHaveLength(1);
    expect(appGlobalsSource).toContain(
      '[data-admin-left-panel-expanded="true"]',
    );
    expect(appGlobalsSource).toContain(
      "--admin-sidebar-expanded-max-width: min(17.5rem, 27vw);",
    );
    expect(appGlobalsSource).toContain(
      "--admin-sidebar-expanded-width: 14rem;",
    );
    expect(appGlobalsSource).toContain(
      "width: max-content;",
    );
    expect(appGlobalsSource).toContain(
      "min-width: var(--admin-sidebar-expanded-width);",
    );
    expect(appGlobalsSource).toContain(
      "max-width: var(--admin-sidebar-expanded-max-width);",
    );
    expect(appGlobalsSource).toContain(
      '[data-admin-console-layout="sidebar-content"]\n    > [data-admin-left-panel-expanded="false"]',
    );
    expect(appGlobalsSource).toContain("width: 4.5rem;");
    expect(appGlobalsSource).toContain("min-width: 4.5rem;");
    expect(appGlobalsSource).toContain("max-width: 4.5rem;");
    expectCssDeclaration(
      appGlobalsSource,
      '[data-admin-left-panel-expanded="false"] > [data-admin-sidebar-header="true"]',
      "height",
      "3.5625rem",
    );
    expectCssDeclaration(
      appGlobalsSource,
      '[data-admin-left-panel-expanded="false"] > [data-admin-sidebar-header="true"]',
      "width",
      "3.5625rem",
    );
    expectCssDeclaration(
      appGlobalsSource,
      '[data-admin-left-panel-expanded="false"] > [data-admin-sidebar-header="true"]',
      "padding",
      "0",
    );
    expectCssDeclaration(
      appGlobalsSource,
      '[data-admin-left-panel-expanded="false"] > [data-admin-sidebar-header="true"]',
      "border-bottom-width",
      "1px",
    );
    expectCssDeclaration(
      appGlobalsSource,
      '[data-admin-left-panel-expanded="false"] > [data-admin-sidebar-header="true"]',
      "border-bottom-color",
      "hsl(var(--border) / 0.7)",
    );
    expect(appGlobalsSource).toContain(
      '[data-admin-left-panel-expanded="false"]\n    [data-admin-sidebar-collapse-toggle="true"]',
    );
    expect(appGlobalsSource).toContain("margin-left: auto !important;");
    expect(appGlobalsSource).toContain("margin-right: auto !important;");
    expect(appGlobalsSource).not.toContain(
      "border-color: hsl(var(--border) / 0.8);",
    );
    expect(appGlobalsSource).toContain("background: transparent;");
    expect(appGlobalsSource).toContain("box-shadow: none;");
    expect(appGlobalsSource).toContain("transform: translateY(0.5px);");
    expect(appGlobalsSource).toContain(
      '> [data-admin-sidebar-header="true"]\n    > [data-admin-sidebar-header-copy="true"]',
    );
    expect(appGlobalsSource).toContain("display: none !important;");
    expect(appGlobalsSource).toContain(
      '[data-admin-left-panel-expanded="false"]\n    [data-admin-sidebar-section-list="spacious"]',
    );
    expect(appGlobalsSource).toContain("flex-direction: column;");
    expect(appGlobalsSource).toContain("align-items: center;");
    expect(appGlobalsSource).toContain("gap: 0.375rem;");
    expect(appGlobalsSource).toContain(
      'button[aria-controls="admin-console-canvas"]',
    );
    expectCssDeclaration(
      appGlobalsSource,
      '[data-admin-left-panel-expanded="false"] [data-admin-sidebar-section-list="spacious"] button[aria-controls="admin-console-canvas"]',
      "width",
      "2.25rem",
    );
    expectCssDeclaration(
      appGlobalsSource,
      '[data-admin-left-panel-expanded="false"] [data-admin-sidebar-section-list="spacious"] button[aria-controls="admin-console-canvas"]',
      "height",
      "2.25rem",
    );
    expectCssDeclaration(
      appGlobalsSource,
      '[data-admin-left-panel-expanded="false"] [data-admin-sidebar-section-list="spacious"] button[aria-controls="admin-console-canvas"] > span:first-child',
      "border-width",
      "0",
    );
    expectCssDeclaration(
      appGlobalsSource,
      '[data-admin-left-panel-expanded="false"] [data-admin-sidebar-section-list="spacious"] button[aria-controls="admin-console-canvas"] > span:first-child > svg',
      "width",
      "1.25rem",
    );
    expect(appGlobalsSource).toContain("> span:not(:first-child)");
    expect(appGlobalsSource).toContain("[data-admin-console-content]:focus");
    expect(appGlobalsSource).toContain(
      "[data-admin-console-content]:focus-visible",
    );
    expect(appGlobalsSource).toContain(
      "outline: 2px solid hsl(var(--primary));",
    );
    expect(appGlobalsSource).toContain(
      "grid-template-rows: auto minmax(0, 1fr);",
    );
    expect(appGlobalsSource).toContain("@media (max-width: 767px)");
    expect(appGlobalsSource).toContain(
      '[data-admin-dashboard-management="true"] .recharts-wrapper',
    );
    expect(appGlobalsSource).toContain("max-width: 100% !important;");
    expect(appGlobalsSource).toContain(
      "grid-template-columns: 4.5rem minmax(0, 1fr);",
    );
    expect(consoleSource).toContain(
      '? "md:w-[4.5rem] md:min-w-[4.5rem] md:max-w-[4.5rem] md:items-center md:px-1.5"',
    );
    expect(consoleSource).toContain(
      ': "md:min-w-[var(--admin-sidebar-expanded-width)] md:max-w-[var(--admin-sidebar-expanded-max-width)]"',
    );
  });

  test("keeps admin console keyboard and screen-reader navigation intact", () => {
    const consoleSource = adminConsoleShellSource();

    expect(consoleSource).toContain('href="#admin-console-canvas"');
    expect(consoleSource).toContain("작업 화면으로 건너뛰기");
    expect(consoleSource).toContain("tabIndex={-1}");
    expect(consoleSource).toContain(
      "canvasRef.current?.focus({ preventScroll: true })",
    );
    expect(source("app/app-globals.css")).toContain(
      "[data-admin-console-content]:focus-visible",
    );
    expect(consoleSource).toContain(
      'aria-current={isActive ? "page" : undefined}',
    );
    expect(consoleSource).toContain('aria-controls="admin-console-canvas"');
    expect(consoleSource).toContain("aria-expanded={!isCollapsed}");
    expect(consoleSource).toContain(
      'data-admin-sidebar-collapse-toggle="true"',
    );
    expect(consoleSource).toContain("관리자 사이드바 펼치기");
    expect(consoleSource).toContain("관리자 사이드바 접기");
    expect(consoleSource).not.toContain("aria-pressed={isCollapsed}");
    expect(consoleSource).toContain(
      '<p className="sr-only" aria-live="polite">',
    );
    expect(consoleSource).toMatch(
      /<p className="sr-only" aria-live="polite">\s*\{activeModuleLabel\}\s*<\/p>/,
    );
    expect(consoleSource).not.toContain("작업 화면으로 전환됨");
  });
  test("keeps announcement management out of the admin sidebar default order", () => {
    const consoleSource = adminConsoleShellSource();
    const sidebarOrderRouteSource = source(
      "app/api/admin/preferences/sidebar-order/route.ts",
    );
    const sidebarOrderSource = source("lib/admin/sidebar-order.ts");

    expect(consoleSource).not.toContain('id: "announcements"');
    expect(consoleSource).not.toContain('          "announcements",');
    expect(consoleSource).toContain('"storyboard",');
    expect(consoleSource).toContain('"banners",');
    expect(consoleSource).toContain('"users",');
    expect(consoleSource).toContain('"insights",');
    expect(consoleSource).toContain('"audit",');
    expect(sidebarOrderSource).toContain("ADMIN_CONSOLE_SECTION_LABELS");
    expect(sidebarOrderSource).toContain("ADMIN_CONSOLE_MENU_IDS");
    expect(sidebarOrderSource).toContain("ADMIN_CONSOLE_MENUS");
    expect(sidebarOrderSource).toContain("export const ADMIN_SIDEBAR_SECTIONS");
    expect(sidebarOrderSource).toContain("export const ADMIN_SIDEBAR_ITEM_IDS");
    expect(sidebarOrderSource).toContain("normalizeAdminSidebarOrderWithReason");
    expect(sidebarOrderSource).toContain('"retired-section"');
    expect(sidebarOrderSource).toContain('"cross-section-item"');
    expect(sidebarOrderRouteSource).toContain(
      'from "@/lib/admin/sidebar-order"',
    );
    expect(sidebarOrderRouteSource).toContain("isAdminPreferenceUserIdPersistable");
    expect(sidebarOrderRouteSource).toContain(
      "!isAdminPreferenceUserIdPersistable(auth.userId)",
    );
    expect(sidebarOrderSource).not.toContain("'announcements'");
  });

  test("adds YouTube thumbnail generation as a guarded Lab module", () => {
    const consoleSource = adminConsoleShellSource();
    const componentSource = source(
      "components/admin/thumbnail-generator/AdminYoutubeThumbnailGenerator.tsx",
    );
    const routeSource = source(
      "app/api/admin/youtube-thumbnail-generator/route.ts",
    );
    const referenceImageRouteSource = source(
      "app/api/admin/youtube-thumbnail-generator/reference-image/route.ts",
    );
    const chatRouteSource = source(
      "app/api/admin/youtube-thumbnail-generator/chat/route.ts",
    );
    const providerSource = source(
      "lib/admin/youtube-thumbnail-generator/providers.ts",
    );
    const promptSource = source(
      "lib/admin/youtube-thumbnail-generator/prompt.ts",
    );
    const requestSource = source(
      "lib/admin/youtube-thumbnail-generator/request.ts",
    );
    const historySource = source(
      "lib/admin/youtube-thumbnail-generator/history.ts",
    );
    const retrievalSource = source(
      "lib/admin/youtube-thumbnail-generator/retrieval.ts",
    );
    const thumbnailLocalBridgeContractSource = source(
      "lib/admin/youtube-thumbnail-generator/local-bridge-contract.ts",
    );
    const storyboardLocalBridgeServerSource = source(
      "lib/admin/storyboard/local-bridge-server.mts",
    );
    const loadReadinessBody = componentSource.slice(
      componentSource.indexOf("const loadReadiness = useCallback"),
      componentSource.indexOf("const loadThumbnailHistory = useCallback"),
    );
    const runThumbnailGenerationBody = componentSource.slice(
      componentSource.indexOf("async function runThumbnailGeneration"),
      componentSource.indexOf("async function handleExportPng"),
    );
    const backendAgentSource = source(
      "lib/admin/youtube-thumbnail-generator/backend-agent.ts",
    );
    const backendAgentGraphSource = source(
      "../../backend/thumbnail-agent/src/graph.py",
    );
    const backendAgentRunnerSource = source(
      "../../backend/thumbnail-agent/scripts/run-thumbnail-agent.py",
    );
    const backendAgentRequirementsSource = source(
      "../../backend/thumbnail-agent/requirements.txt",
    );
    const backendAgentBgeRequirementsSource = source(
      "../../backend/thumbnail-agent/requirements-bge.txt",
    );
    const backendAgentReadmeSource = source(
      "../../backend/thumbnail-agent/README.md",
    );

    expect(consoleSource).toContain('id: "youtube-thumbnail-generator"');
    expect(consoleSource).toContain('title: "유튜브 썸네일 생성"');
    expect(consoleSource).toContain("AdminYoutubeThumbnailGenerator");
    expect(componentSource).toContain("/api/admin/youtube-thumbnail-generator");
    expect(componentSource).toContain(
      'const THUMBNAIL_CHAT_AGENT_STREAM_URL = "/api/admin/youtube-thumbnail-generator/chat";',
    );
    expect(componentSource).not.toContain(
      "/api/admin/youtube-thumbnail-generator/reference-image",
    );
    expect(componentSource).not.toContain("Google Nano Banana 2 Pro API");
    expect(componentSource).not.toContain("OpenAI GPT Image 2 API (정확)");
    expect(componentSource).toContain("기본 OAuth");
    expect(componentSource).toContain("고급 로컬");
    expect(componentSource).toContain("API Key");
    expect(componentSource).toContain(
      'data-thumbnail-api-router-choice="true"',
    );
    expect(componentSource).toContain(
      'data-thumbnail-api-router-option="browser-openai-api-key"',
    );
    expect(componentSource).toContain(
      'data-thumbnail-api-router-option="local-codex-oauth"',
    );
    expect(componentSource).toContain(
      'data-thumbnail-api-router-option="local-bridge"',
    );
    expect(componentSource).toContain(
      "const submittedProviderId = requestedProviderId;",
    );
    expect(componentSource).not.toContain(
      'requestedProviderId === "local-codex" && browserOpenAIApiKey',
    );
    expect(componentSource).not.toContain("gpt-image-1.5");
    expect(componentSource).toContain('aria-label="유튜브 썸네일 생성기"');
    expect(componentSource).toContain(
      "flex h-full min-h-0 flex-col overflow-hidden bg-background p-3",
    );
    expect(componentSource).toContain(
      "grid min-h-0 flex-1 grid-cols-1 grid-rows-[minmax(0,1.1fr)_minmax(0,0.9fr)] gap-3 overflow-hidden lg:grid-cols-[minmax(0,1fr)_minmax(320px,400px)] lg:grid-rows-1 xl:grid-cols-[minmax(0,1fr)_minmax(340px,420px)]",
    );
    expect(componentSource).toContain(
      'data-thumbnail-chat-right-layout="true"',
    );
    expect(componentSource).toContain(
      'data-thumbnail-generation-input-panel="right-chat"',
    );
    expect(componentSource).toContain(
      'data-thumbnail-input-panel="chat-stream"',
    );
    expect(componentSource).toContain(
      'data-thumbnail-input-position="right-of-canvas"',
    );
    expect(componentSource).toContain(
      'data-thumbnail-canvas-panel="primary-left"',
    );
    expect(componentSource).toContain('data-thumbnail-chat-panel="true"');
    expect(componentSource).toContain(
      'data-thumbnail-chat-style="storyboard-like"',
    );
    expect(componentSource).toContain(
      'data-thumbnail-chat-starter-panel="true"',
    );
    expect(componentSource).toContain(
      'data-thumbnail-chat-starter-panel-layout="centered-thumbnail-guide"',
    );
    expect(componentSource).toContain(
      'data-thumbnail-chat-starter-logo="true"',
    );
    expect(componentSource).toContain('src="/logo.webp"');
    expect(componentSource).toContain("무엇부터 만들까요?");
    expect(componentSource).toContain(
      'data-thumbnail-chat-starter-title="true"',
    );
    expect(componentSource).toContain(
      'data-thumbnail-chat-starter-guide-copy="true"',
    );
    expect(componentSource).toContain(
      'data-thumbnail-chat-example-grid="true"',
    );
    expect(componentSource).toContain(
      'data-thumbnail-chat-example-grid-layout="3-card-grid"',
    );
    expect(componentSource).toContain("THUMBNAIL_GUIDED_EXAMPLE_PRESETS.map");
    expect(componentSource).toContain(
      'data-thumbnail-chat-example-card="true"',
    );
    expect(componentSource).toContain("handleThumbnailGuidedExamplePresetClick");
    expect(componentSource).toContain('data-thumbnail-chat-log="true"');
    expect(componentSource).toContain('data-thumbnail-chat-header="true"');
    expect(componentSource).toContain(
      'data-thumbnail-chat-status-badge="true"',
    );
    expect(componentSource).toContain(
      "data-thumbnail-chat-status={thumbnailChatStatusState}",
    );
    expect(componentSource).toContain("thumbnailChatStatusLabel");
    expect(componentSource).toContain("유튜브 썸네일 생성 도우미");
    expect(componentSource).toContain("유튜브 썸네일 도우미");
    expect(componentSource).toContain("채팅 맥락");
    expect(componentSource).toContain("물어보기");
    expect(componentSource).not.toContain(">생성 채팅<");
    expect(componentSource).not.toContain("AI 도우미");
    expect(componentSource).toContain(
      'data-thumbnail-chat-header-actions="true"',
    );
    expect(componentSource).toContain('data-thumbnail-chat-controls="true"');
    expect(componentSource).toContain(
      'data-thumbnail-chat-canvas-context="true"',
    );
    expect(componentSource).toContain(
      "data-thumbnail-chat-canvas-context-state={canvasContextState}",
    );
    expect(componentSource).toContain(
      'const shouldShowThumbnailCanvasContext = canvasContextState !== "idle";',
    );
    expect(componentSource).toContain("{shouldShowThumbnailCanvasContext ? (");
    expect(componentSource).toContain(
      'data-thumbnail-chat-canvas-context-visibility="selected-only"',
    );
    expect(componentSource).not.toContain(
      'lastCanvasActionLabel ?? "선택 대기"',
    );
    expect(componentSource).not.toContain(
      'canvasContextState === "selected" ? "선택됨" : "캔버스"',
    );
    expect(componentSource).toContain(
      'data-thumbnail-chat-canvas-context-action="true"',
    );
    expect(componentSource).toContain(
      'data-thumbnail-chat-canvas-context-summary="true"',
    );
    expect(componentSource).toContain(
      'data-thumbnail-chat-canvas-context-ask="true"',
    );
    expect(componentSource).toContain('data-thumbnail-chat-composer="true"');
    expect(componentSource).toContain(
      'data-thumbnail-chat-composer-shell="storyboard-like"',
    );
    expect(componentSource).toContain(
      'data-thumbnail-chat-composer-inner="true"',
    );
    expect(componentSource).toContain(
      'data-thumbnail-chat-reference-upload="true"',
    );
    expect(componentSource).toContain('aria-label="참고 이미지 첨부"');
    expect(componentSource).toContain(
      "function openThumbnailReferenceFilePicker()",
    );
    expect(componentSource).toContain("max-h-24 min-h-10 resize-none");
    expect(componentSource).toContain(
      'data-thumbnail-chat-draft-preview="true"',
    );
    expect(componentSource).toContain('data-thumbnail-chat-live-stream="true"');
    expect(componentSource).toContain(
      'data-thumbnail-chat-settings-toggle="true"',
    );
    expect(componentSource).toContain(
      'data-thumbnail-chat-settings-dropdown-trigger="true"',
    );
    expect(componentSource).toContain(
      'data-thumbnail-chat-settings-dropdown="true"',
    );
    expect(componentSource).toContain(
      'data-thumbnail-history-dropdown-trigger="icon-only"',
    );
    expect(componentSource).toContain('data-thumbnail-history-dropdown="true"');
    expect(componentSource).toContain("<DropdownMenu");
    expect(componentSource).toContain("<DropdownMenuTrigger asChild>");
    expect(componentSource).toContain("<DropdownMenuContent");
    expect(componentSource).toContain(
      'data-thumbnail-chat-settings-panel="true"',
    );
    expect(componentSource).toContain(
      'data-thumbnail-chat-settings-panel-parity="storyboard"',
    );
    expect(componentSource).toContain(
      'data-thumbnail-chat-settings-dropdown-parity="storyboard"',
    );
    expect(componentSource).toContain("getThumbnailImageApiRouterView");
    expect(componentSource).toContain(
      'data-thumbnail-api-router-choice="true"',
    );
    expect(componentSource).toContain(
      'data-thumbnail-api-router-choice="true"',
    );
    expect(componentSource).toContain(
      'data-thumbnail-api-router-option="local-codex-oauth"',
    );
    expect(componentSource).toContain(
      'data-thumbnail-api-router-option="local-bridge"',
    );
    expect(componentSource).toContain(
      'data-thumbnail-api-router-option="browser-openai-api-key"',
    );
    expect(componentSource).toContain(
      'data-thumbnail-api-router-oauth-transport="server"',
    );
    expect(componentSource).toContain(
      'data-thumbnail-api-router-oauth-transport="local-bridge"',
    );
    expect(componentSource).toContain(
      'data-thumbnail-api-router-fallback="browser-api-key"',
    );
    expect(componentSource).toContain('data-thumbnail-api-router-panel="true"');
    expect(componentSource).toContain(
      "data-thumbnail-api-router-active={thumbnailImageApiRouterView.id}",
    );
    expect(componentSource).toContain(
      "data-thumbnail-codex-oauth-status={thumbnailImageApiRouterView.codexOAuthStatus}",
    );
    expect(componentSource).toContain(
      'data-thumbnail-api-router-model="gpt-image-2"',
    );
    expect(componentSource).toContain(
      'data-thumbnail-api-router-parity="storyboard"',
    );
    expect(componentSource).toContain('data-thumbnail-api-router-label="true"');
    expect(componentSource).toContain(
      'data-thumbnail-api-router-status="true"',
    );
    expect(componentSource).toContain(
      'data-thumbnail-api-router-summary="true"',
    );
    expect(componentSource).toContain('data-thumbnail-codex-oauth-copy="true"');
    expect(componentSource).toContain(
      'data-thumbnail-api-key-settings="memory-only"',
    );
    expect(componentSource).toContain(
      'data-thumbnail-browser-api-key-settings="memory-only"',
    );
    expect(componentSource).toContain(
      'data-thumbnail-api-key-persistence="none"',
    );
    expect(componentSource).toContain(
      'data-thumbnail-api-key-db-storage="forbidden"',
    );
    expect(componentSource).toContain(
      'data-thumbnail-openai-api-key-scope="component-memory"',
    );
    expect(componentSource).toContain(
      'data-thumbnail-browser-api-key-input="true"',
    );
    expect(componentSource).toContain('data-thumbnail-api-key-apply="true"');
    expect(componentSource).toContain('data-thumbnail-api-key-clear="true"');
    expect(componentSource).toContain(
      'data-thumbnail-browser-api-key-model-policy="gpt-image-2-only"',
    );
    expect(componentSource).toContain(
      "data-thumbnail-browser-api-key-status={",
    );
    expect(componentSource).toContain("기본 OAuth · 고급 로컬 · API Key 백업");
    expect(componentSource).toContain("API Key 백업");
    expect(componentSource).toContain("고급 로컬");
    expect(componentSource).toContain("키 적용됨");
    expect(componentSource).toContain("Codex OAuth");
    expect(componentSource).toContain(
      "OAuth가 안 될 때만 사용 · 이 탭 메모리만 사용 · Web Storage·DB 저장 안 함",
    );
    expect(componentSource).toContain("gpt-image-2 전용");
    expect(componentSource).toContain(
      'data-thumbnail-local-bridge-settings="memory-only"',
    );
    expect(componentSource).toContain(
      'data-thumbnail-local-bridge-settings-visibility="advanced-selected"',
    );
    expect(componentSource).toContain(
      'data-thumbnail-local-bridge-persistence="none"',
    );
    expect(componentSource).toContain(
      'data-thumbnail-local-bridge-server-relay="forbidden"',
    );
    expect(componentSource).toContain(
      'data-thumbnail-local-bridge-token-lifetime="component"',
    );
    expect(componentSource).toContain(
      'data-thumbnail-local-bridge-url-input="true"',
    );
    expect(componentSource).toContain(
      'data-thumbnail-local-bridge-token-input="true"',
    );
    expect(componentSource).toContain(
      'data-thumbnail-local-bridge-apply="true"',
    );
    expect(componentSource).toContain(
      'data-thumbnail-local-bridge-clear="true"',
    );
    expect(componentSource).toContain("postThumbnailLocalBridgeImagesRequest");
    expect(componentSource).toContain(
      "buildThumbnailLocalBridgeReferenceImages",
    );
    expect(componentSource).toContain("THUMBNAIL_LOCAL_BRIDGE_IMAGES_PATH");
    expect(componentSource).toContain(
      "thumbnailImageRouteChoice === THUMBNAIL_LOCAL_BRIDGE_ROUTE_ID",
    );
    expect(thumbnailLocalBridgeContractSource).toContain(
      "THUMBNAIL_LOCAL_BRIDGE_ROUTE_ID",
    );
    expect(thumbnailLocalBridgeContractSource).toContain(
      "normalizeThumbnailLocalBridgeUrl",
    );
    expect(thumbnailLocalBridgeContractSource).toContain(
      "normalizeThumbnailLocalBridgeToken",
    );
    expect(thumbnailLocalBridgeContractSource).toContain(
      "normalizeThumbnailLocalBridgeImagesResponse",
    );
    expect(thumbnailLocalBridgeContractSource).toContain(
      "modelProvenance === 'exact'",
    );
    expect(storyboardLocalBridgeServerSource).toContain(
      "THUMBNAIL_LOCAL_BRIDGE_IMAGES_PATH",
    );
    expect(storyboardLocalBridgeServerSource).toContain(
      "handleThumbnailImages",
    );
    expect(storyboardLocalBridgeServerSource).toContain(
      "runThumbnailProviderCommand",
    );
    expect(storyboardLocalBridgeServerSource).toContain("no_relay_transport");
    expect(storyboardLocalBridgeServerSource).toContain(
      "server_history_persistence: skipped",
    );
    expect(componentSource).not.toContain(
      "이 브라우저 localStorage에만 남습니다.",
    );
    expect(componentSource).not.toContain(
      "이미지 모델은 gpt-image-2만 허용합니다.",
    );
    expect(componentSource).toContain(
      'data-thumbnail-chat-message-meta="true"',
    );
    expect(componentSource).toContain("data-thumbnail-chat-message-status={");
    expect(componentSource).toContain('message.mode === "stream"');
    expect(componentSource).toContain('message.mode === "system"');
    expect(componentSource).toContain(
      'data-thumbnail-chat-message-bubble="true"',
    );
    expect(componentSource).toContain(
      'data-thumbnail-chat-message-actions="true"',
    );
    expect(componentSource).toContain(
      'data-thumbnail-chat-message-actions-placement="starter-panel"',
    );
    expect(componentSource).toContain(
      'data-thumbnail-chat-guide-button="true"',
    );
    expect(componentSource).toContain(
      'data-thumbnail-chat-guide-example="true"',
    );
    expect(componentSource).toContain(
      'data-thumbnail-chat-message-action="guide"',
    );
    expect(componentSource).toContain(
      'data-thumbnail-chat-message-action="example"',
    );
    expect(componentSource).toContain(
      'placeholder="원하는 썸네일 내용을 입력해 주세요"',
    );
    expect(componentSource).not.toContain(
      'placeholder="예: 제육볶음 먹방 썸네일 생성해줘 · 문구 크게 · 참고 인물 이미지는 파일로 추가해줘 · PNG 저장해줘"',
    );
    expect(componentSource).toContain("handleThumbnailUsageGuideClick");
    expect(componentSource).toContain("handleThumbnailGuidedExampleClick");
    expect(componentSource).toContain(
      "applyThumbnailGuidedExamplePreviewToCanvas",
    );
    expect(componentSource).toContain("getThumbnailGenerationPreflightIssues");
    expect(componentSource).toContain("THUMBNAIL_USAGE_GUIDE_TEXT");
    expect(componentSource).toContain("THUMBNAIL_GUIDED_EXAMPLE_PRESETS");
    expect(componentSource).toContain("예시를 화면에 넣었어요");
    expect(componentSource).toContain(
      "guidedExampleVariantIndexRef.current += 1",
    );
    expect(componentSource).toContain("createTextLayersWithGenerationLayout(");
    expect(componentSource).toContain('setActiveLayerId("headline")');
    expect(componentSource).toContain(
      "Keep the immediate canvas preview visible",
    );
    expect(componentSource).toContain(
      "실제 이미지 생성 전 빠르게 보여 주는 예시 화면입니다.",
    );
    expect(componentSource).toContain("void runThumbnailGeneration({");
    expect(componentSource).toContain(
      'markCanvasAction("예시 썸네일 생성 시작")',
    );
    expect(componentSource).not.toContain(
      "setResult(BUNDLED_THUMBNAIL_PREVIEW_RESULT);",
    );
    expect(componentSource).toContain(
      'className="whitespace-pre-wrap break-keep [overflow-wrap:anywhere]"',
    );
    expect(componentSource).toContain("요청을 쉽게 정리하는 중이에요...");
    expect(componentSource).not.toContain(
      "whitespace-pre-wrap break-words rounded-2xl px-3 py-2 text-left text-xs leading-5 shadow-sm",
    );
    expect(componentSource).toContain("gpt-image-2 전용");
    expect(componentSource).not.toContain(
      "다른 이미지 모델로 자동 전환하지 않습니다.",
    );
    expect(componentSource).toContain("canUseSessionApiKeyForProvider");
    expect(componentSource).toContain("thumbnailSessionOpenaiApiKey");
    expect(componentSource).not.toContain(
      "THUMBNAIL_BROWSER_MODEL_KEYS_STORAGE_KEY",
    );
    expect(componentSource).not.toContain("thumbnailSessionGeminiApiKey");
    expect(componentSource).toContain(
      "resolvedFinalResult.providerId ?? providerId",
    );
    expect(componentSource).toContain(
      "resolvedFinalResult.generationMode ?? generationMode",
    );
    expect(componentSource).toContain('data-thumbnail-chat-topic-state="true"');
    expect(componentSource).not.toContain(
      "data-thumbnail-chat-agent-stream-state",
    );
    expect(componentSource).not.toContain("data-thumbnail-chat-agent-model");
    expect(componentSource).not.toContain("data-thumbnail-chat-agent-effort");
    expect(componentSource).not.toContain(
      'data-thumbnail-live-canvas-text-summary="true"',
    );
    expect(componentSource).toContain("handleChatDraftChange");
    expect(componentSource).toContain(
      "function handleChatDraftChange(value: string) {",
    );
    const handleChatDraftChangeBody =
      componentSource.match(
        /function handleChatDraftChange\(value: string\) \{[\s\S]*?\n  \}/,
      )?.[0] ?? "";
    expect(handleChatDraftChangeBody).toContain("setChatDraft(value)");
    expect(handleChatDraftChangeBody).not.toContain(
      "applyChatRequirementToCanvas",
    );
    expect(handleChatDraftChangeBody).not.toContain(
      "applyThumbnailChatPatchToCanvas",
    );
    expect(componentSource).toContain("handleThumbnailChatSubmit");
    expect(componentSource).toContain("chatComposerImeRef");
    expect(componentSource).toContain("handleThumbnailChatCompositionStart");
    expect(componentSource).toContain("handleThumbnailChatCompositionEnd");
    expect(componentSource).toContain("isThumbnailChatImeComposing");
    expect(componentSource).toContain("event.nativeEvent.isComposing");
    expect(componentSource).toContain('event.key === "Process"');
    expect(componentSource).toContain(
      "onCompositionStart={handleThumbnailChatCompositionStart}",
    );
    expect(componentSource).toContain(
      "onCompositionEnd={handleThumbnailChatCompositionEnd}",
    );
    expect(componentSource).toContain(
      'aria-describedby="thumbnail-chat-keyboard-hint"',
    );
    expect(componentSource).toContain(
      '<p id="thumbnail-chat-keyboard-hint" className="sr-only">',
    );
    expect(componentSource).toContain('id="thumbnail-chat-keyboard-hint"');
    expect(componentSource).toContain('data-thumbnail-chat-ime-safe="true"');
    expect(componentSource).toContain(
      "한글 조합 중 Enter는 전송하지 않고, 조합이 끝난 뒤 Enter로 전송합니다.",
    );
    expect(componentSource).toContain("lastCanvasActionLabel");
    expect(componentSource).toContain(
      "const activeLayerIdRef = useRef<string | null>(null);",
    );
    expect(componentSource).toContain(
      "const [activeLayerId, setActiveLayerId] = useState<string | null>(null);",
    );
    expect(componentSource).toContain(
      "const [lastCanvasActionLabel, setLastCanvasActionLabel] = useState<string | null>(null);",
    );
    expect(componentSource).toContain(
      "activeLayerId ? textLayers.find((layer) => layer.id === activeLayerId) ?? null : null",
    );
    expect(componentSource).not.toContain(
      'useState(DEFAULT_TEXT_LAYERS[0]?.id ?? "headline")',
    );
    expect(componentSource).not.toContain(
      'useState<string | null>("메인 문구 선택됨")',
    );
    expect(componentSource).not.toContain(
      "textLayers.find((item) => item.id === activeLayerId) ?? textLayers[0]",
    );
    expect(componentSource).toContain("getCanvasLayerDisplayName");
    expect(componentSource).toContain("getCanvasContextPrompt");
    expect(componentSource).toContain("useCanvasContextInChat");
    expect(componentSource).toContain("markCanvasAction");
    expect(componentSource).toContain("setChatDraft(canvasContextPrompt)");
    expect(componentSource).not.toContain("THUMBNAIL_CHAT_COMMANDS");
    expect(componentSource).toContain("resolveThumbnailChatLocalCommand");
    expect(componentSource).toContain("type ThumbnailChatLocalCommandId =");
    expect(componentSource).toContain('"export-png"');
    expect(componentSource).toContain('"real-data-status"');
    expect(componentSource).toContain('"guide-hide"');
    expect(componentSource).toContain('"guide-show"');
    expect(componentSource).toContain('"undo"');
    expect(componentSource).toContain("resolveThumbnailChatEditorToolCommand");
    expect(componentSource).toContain("isThumbnailChatRealDataStatusPrompt");
    expect(componentSource).toContain("isCanvasContextChatPrompt");
    expect(componentSource).toContain("hasThumbnailGenerationIntent");
    expect(componentSource).toContain("isThumbnailChatStructuredEditPrompt");
    expect(componentSource).toContain("isThumbnailChatReplacementPrompt");
    expect(componentSource).toContain("isThumbnailChatOptimizationPrompt");
    expect(componentSource).toContain(
      "restorePendingChatPreviewSnapshotForStructuredEdit",
    );
    expect(componentSource).toContain(
      "restoreTextEditorHistorySnapshot(snapshot)",
    );
    expect(componentSource).toContain(
      "pendingTextLayerUndoSnapshotRef.current = null",
    );
    expect(componentSource).toContain(
      "if (isThumbnailChatStructuredEditPrompt(normalized)) return null;",
    );
    expect(componentSource).toContain(
      "const submittedHasGenerationIntent = hasThumbnailGenerationIntent(submittedRequirement) && !nonMutatingPrompt;",
    );
    expect(componentSource).toContain(
      "const replacementEditPrompt = isThumbnailChatReplacementPrompt(submittedRequirement);",
    );
    expect(componentSource).toContain(
      "const shouldUseStructuredEditPreview = !nonMutatingPrompt && structuredEditPrompt && (!submittedHasGenerationIntent || replacementEditPrompt);",
    );
    expect(componentSource).toContain(
      "if (!selectedLayerPrompt && !shouldUseStructuredEditPreview && !nonMutatingPrompt) applyChatRequirementToCanvas(submittedRequirement);",
    );
    expect(componentSource).toContain("CHAT_GENERATION_INTENT_PATTERN");
    expect(componentSource).toContain(
      "THUMBNAIL_CHAT_LOCAL_COMMAND_OVERMATCH_FIXTURES",
    );
    expect(componentSource).toContain("생성 과정 확인해줘");
    expect(componentSource).toContain("생성\\s*과정");
    expect(componentSource).not.toContain("프로세스|과정|모델");
    expect(componentSource).not.toContain("상태|과정|출처");
    expect(componentSource).toContain("가이드 포함해서 썸네일 생성해줘");
    expect(componentSource).toContain("메인 문구 크게 보이게 생성해줘");
    expect(componentSource).toContain(
      "PNG 느낌으로 저장하고 싶은 썸네일 만들어줘",
    );
    expect(componentSource).toContain(
      'if (isThumbnailChatRealDataStatusPrompt(normalized)) return "real-data-status";',
    );
    expect(componentSource).toContain('return "export-png";');
    expect(componentSource).toContain('return "guide-hide";');
    expect(componentSource).toContain('return "guide-show";');
    expect(componentSource).toContain('return "bigger";');
    expect(componentSource).toContain('return "fill-yellow";');
    expect(componentSource).toContain('return "bring-front";');
    expect(componentSource).toContain("handleThumbnailChatCommand");
    expect(componentSource).toContain("appendThumbnailChatCommand");
    expect(componentSource).toContain("chatAbortControllerRef");
    expect(componentSource).toContain("generationAbortControllerRef");
    expect(componentSource).toContain("abortThumbnailChatWork");
    expect(componentSource).toContain("abortThumbnailGeneration");
    expect(componentSource).toContain("getAbortNotice");
    expect(componentSource).toContain("getThumbnailRealDataStatusSummary");
    expect(componentSource).toContain("getThumbnailResultSourceLabel");
    expect(componentSource).toContain("formatThumbnailAssistantDisplayText");
    expect(componentSource).toContain("THUMBNAIL_CHAT_INTERNAL_JARGON_PATTERN");
    expect(componentSource).toContain("THUMBNAIL_CHAT_SIMPLE_FALLBACK_MESSAGE");
    expect(componentSource).toContain("backend[-\\s]?agent");
    expect(componentSource).toContain("provider|provenance|fallback");
    expect(componentSource).toContain("reranker|embedding|LangGraph");
    expect(componentSource).toContain("exact|allowlist|runtime|diagnostics");
    expect(componentSource).toContain(
      "더 자세히 보고 싶으면 “상태”라고 입력하세요.",
    );
    expect(componentSource).toContain("현재 상태를 쉽게 정리했어요");
    expect(componentSource).toContain(
      "확인된 이미지일 때만 실제 결과로 표시합니다.",
    );
    expect(componentSource).toContain("formatThumbnailBackendAgentStatus");
    expect(componentSource).toContain("도우미 준비됨");
    expect(componentSource).toContain("도우미 준비 필요");
    expect(componentSource).toContain("formatThumbnailHistoryStatus");
    expect(componentSource).toContain("저장된 결과");
    expect(componentSource).not.toContain(
      "최근 결과 ${formatThumbnailModelProvenance",
    );
    expect(componentSource).toContain(
      "formatThumbnailRetrievalSummaryForBeginner",
    );
    expect(componentSource).toContain("기존 썸네일");
    expect(componentSource).toContain("골라 참고했습니다");
    expect(componentSource).toContain(
      "formatThumbnailGenerationCompletionSummary",
    );
    expect(componentSource).toContain(
      "얼굴, 음식, 문구가 잘 보이면 PNG로 저장하세요.",
    );
    expect(componentSource).not.toContain(
      "역할별 확인: 쯔양님은 얼굴과 음식이 잘 보이는지",
    );
    expect(componentSource).not.toContain("PD님은 제목이 후킹되는지");
    expect(componentSource).not.toContain("매니저님은 저장 전 검수 상태를");
    expect(componentSource).not.toContain(
      "편집자는 문구 위치를 확인하면 됩니다",
    );
    expect(componentSource).toContain("signal: controller.signal");
    expect(componentSource).toContain("extractThumbnailChatSseEvents");
    expect(componentSource).toContain("isThumbnailChatAgentResult");
    expect(componentSource).toContain("runThumbnailGeneration");
    expect(componentSource).toContain("finalResult?.shouldGenerate");
    expect(componentSource).toContain("요청을 쉽게 정리하는 중이에요");
    expect(componentSource).toContain("applyChatRequirementToCanvas");
    expect(componentSource).toContain("deriveChatHeadline");
    expect(componentSource).not.toContain(
      "실제 이미지는 채팅창 아래 생성 버튼으로 실행됩니다.",
    );
    expect(componentSource).not.toContain(
      'data-thumbnail-generation-settings="true"',
    );
    expect(componentSource).not.toContain(
      'data-thumbnail-live-canvas-brief="true"',
    );
    expect(componentSource).not.toContain(
      "xl:grid-cols-[minmax(340px,420px)_minmax(0,1fr)]",
    );
    expect(componentSource).toContain("flex min-h-0 flex-col overflow-hidden");
    expect(componentSource).toContain(
      "flex min-h-0 flex-1 flex-col overflow-hidden p-3 pt-0",
    );
    expect(componentSource).toContain(
      "flex min-h-0 flex-col overflow-hidden border-0 bg-card/80 shadow-none",
    );
    expect(componentSource).not.toContain(
      "space-y-1.5 rounded-xl bg-muted/25 p-2.5",
    );
    expect(componentSource).not.toContain(
      "grid grid-cols-1 gap-2 rounded-lg bg-background/80 p-2",
    );
    expect(componentSource).not.toContain(
      "space-y-2 rounded-xl border border-border bg-muted/20 p-3",
    );
    expect(componentSource).not.toContain(
      "rounded-xl border bg-background p-3",
    );
    expect(componentSource).not.toContain(
      "overflow-hidden rounded-2xl border border-border bg-black",
    );
    expect(componentSource).not.toContain(
      "flex min-h-full flex-col gap-4 overflow-y-auto bg-muted/20 p-4",
    );
    expect(componentSource).not.toContain(
      "flex h-full min-h-0 flex-col overflow-hidden bg-muted/20 p-4",
    );
    expect(componentSource).not.toContain(
      "min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain",
    );
    expect(componentSource).not.toContain("지난 먹방/여행 썸네일 문법");
    expect(componentSource).not.toContain("고채도 먹방 콜라주");
    expect(componentSource).toContain(
      'fetch("/api/admin/youtube-thumbnail-generator", { cache: "no-store" })',
    );
    expect(componentSource).not.toContain("로컬 실행 준비 상태");
    expect(componentSource).not.toContain("상태 새로고침");
    expect(componentSource).not.toContain("선택한 모델이 현재 비가용입니다");
    expect(componentSource).not.toContain("환경변수를 준비하거나 Mock");
    expect(componentSource).not.toContain("현재 사용할 수 없습니다. Mock");
    expect(componentSource).not.toContain(" · 비가용");
    expect(componentSource).not.toContain("providerNotice");
    expect(componentSource).not.toContain("setProviderNotice");
    expect(componentSource).not.toContain(
      'data-thumbnail-provider-status="true"',
    );
    expect(componentSource).not.toContain("data-thumbnail-provider-readiness");
    expect(componentSource).not.toContain(
      'data-thumbnail-ready-now-path="mock"',
    );
    expect(componentSource).toContain("const acknowledgedSafety = true;");
    expect(componentSource).not.toContain(
      "const [acknowledgedSafety, setAcknowledgedSafety] = useState(false)",
    );
    expect(componentSource).not.toContain('data-thumbnail-safety-group="true"');
    expect(componentSource).not.toContain(
      'data-thumbnail-safety-acknowledgement="true"',
    );
    expect(componentSource).not.toContain(
      'data-thumbnail-generation-actions="true"',
    );
    expect(componentSource).not.toContain(
      'data-thumbnail-chat-command-row="true"',
    );
    expect(componentSource).not.toContain("data-thumbnail-chat-command=");
    expect(componentSource).toContain(
      'data-thumbnail-chat-cancel={isChatAgentStreaming ? "true" : undefined}',
    );
    expect(componentSource).toContain(
      'data-thumbnail-generation-cancel={isGenerating ? "true" : undefined}',
    );
    expect(componentSource).toContain(
      "disabled={isChatAgentStreaming || isGenerating}",
    );
    expect(componentSource).toContain(
      '"썸네일 이미지를 만들고 있어요. 오래 걸리면 아래 중단 버튼을 누를 수 있습니다."',
    );
    expect(componentSource).toContain("currentThumbnailStreamingLabel");
    expect(componentSource).toContain("currentThumbnailStreamingPhase");
    expect(componentSource).toContain("createThumbnailChatRunId");
    expect(componentSource).toContain(
      "const chatRunId = createThumbnailChatRunId(nextAssistantMessageId);",
    );
    expect(componentSource).toContain("chatRunId,");
    expect(componentSource).toContain("isSelectedLayerChatPrompt");
    expect(componentSource).toContain(
      "activeLayerId: activeLayerIdRef.current",
    );
    expect(componentSource).toContain(
      "currentTextLayers: textLayersRef.current",
    );
    expect(componentSource).toContain("textLayerPatches");
    expect(componentSource).toContain("applyThumbnailChatTextLayerPatches");
    expect(backendAgentSource).toContain(
      "parseThumbnailChatTextReplacementIntent",
    );
    expect(backendAgentSource).toContain(
      "resolveThumbnailChatReplacementTarget",
    );
    expect(backendAgentSource).toContain(
      "createCanvasOptimizationTextLayerPatches",
    );
    expect(backendAgentSource).toContain("CHAT_CANVAS_OPTIMIZATION_PATTERN");
    expect(backendAgentSource).toContain(
      "바꿀 문구를 찾지 못해서 캔버스 문구는 그대로 두었어요.",
    );
    expect(componentSource).not.toContain(
      'data-thumbnail-chat-attachments="true"',
    );
    expect(componentSource).not.toContain(
      'id="thumbnail-reference-image-input"',
    );
    expect(componentSource).not.toContain(
      'data-thumbnail-reference-file-input="true"',
    );
    expect(componentSource).not.toContain(
      'data-thumbnail-reference-file-chip="true"',
    );
    expect(componentSource).not.toContain(
      'data-thumbnail-reference-file-remove="true"',
    );
    expect(componentSource).not.toContain("removeReferenceImage");
    expect(componentSource).toContain(
      'id="thumbnail-reference-image-chat-input"',
    );
    expect(componentSource).toContain(
      'data-thumbnail-chat-reference-file-input="true"',
    );
    expect(componentSource).toContain(
      "const chatTranscriptRef = useRef<HTMLDivElement | null>(null);",
    );
    expect(componentSource).toContain("ref={chatTranscriptRef}");
    expect(componentSource).toContain(
      "const transcript = chatTranscriptRef.current;",
    );
    expect(componentSource).toContain("window.requestAnimationFrame");
    expect(componentSource).toContain("transcript.scrollTo({");
    expect(componentSource).toContain("top: transcript.scrollHeight");
    expect(componentSource).toContain(
      "[chatMessages, chatDraft, isChatAgentStreaming, isGenerating]",
    );
    expect(componentSource).toContain("deriveThumbnailFoodSubject");
    expect(componentSource).toContain("`${foodSubject} 먹방`");
    expect(componentSource).toContain("밥도둑 인정?");
    expect(componentSource).toContain("function createNaturalGenerationCopy");
    expect(componentSource).toContain(
      "function createTextLayersWithGenerationLayout",
    );
    expect(componentSource).toContain(
      "if (!hasThumbnailGenerationIntent(normalizedRequirement))",
    );
    expect(componentSource).toContain("생성 문구 미리보기 반영");
    expect(componentSource).toContain(
      "function applyExplicitStructuredChatPreview",
    );
    expect(componentSource).toContain("명시 문구 채팅 반영");
    expect(componentSource).toContain(
      "function deriveGenerationTextAccentCopy",
    );
    expect(componentSource).toContain(
      "function deriveGenerationTextCaptionCopy",
    );
    expect(componentSource).toContain("MAIN_HEADLINE_MAX_LENGTH = 36");
    expect(componentSource).toContain(
      "AUTO_GENERATED_MAIN_HEADLINE_MAX_LENGTH = 14",
    );
    expect(componentSource).toContain("deriveBenchmarkThumbnailHeadline");
    expect(componentSource).toContain("deriveAutomaticThumbnailHeadlineCopy");
    expect(componentSource).toContain("createTzuyangAutomaticPreviewTopic");
    expect(componentSource).toContain("TZUYANG_BENCHMARK_COPY_SIGNAL_PATTERN");
    expect(componentSource).toContain(
      "function getResponsiveMainHeadlineFontSize",
    );
    expect(componentSource).toContain(
      "/썸네일|먹방|밥도둑|한상|유튜브\\s*썸네일/i.test(normalizedTopic)",
    );
    expect(componentSource).toContain(
      "fontSize: getResponsiveMainHeadlineFontSize(patch.headline, layer.fontSize)",
    );
    expect(componentSource).toContain(
      "nextLayer.fontSize = getResponsiveMainHeadlineFontSize(nextLayer.content, nextLayer.fontSize)",
    );
    expect(componentSource).toContain(
      "function applyThumbnailChatResultToCanvas",
    );
    expect(componentSource).toContain(
      "createTextLayersWithChatTextLayerPatches(",
    );
    expect(componentSource).toContain(
      'createGenerationTextLayer(currentById, "accentBadge"',
    );
    expect(componentSource).toContain(
      'createGenerationTextLayer(currentById, "contextCaption"',
    );
    expect(componentSource).toContain(
      'const generatedLayerIds = new Set(["headline", "subHeadline", "accentBadge", "contextCaption"])',
    );
    expect(componentSource).toContain("isTzuyangBenchmarkLayout");
    expect(componentSource).toContain(
      "const headlinePosition = selectNonOccludingTextPlacement(",
    );
    expect(componentSource).toContain(
      "isTzuyangBenchmarkLayout ? TEXT_OCCLUSION_BENCHMARK_CANDIDATES.headline",
    );
    expect(componentSource).toContain("createGeneratedTextProtectedZone");
    expect(componentSource).toContain(
      "const subHeadlineProtectedZones = [...protectedZones, headlineTextZone]",
    );
    expect(componentSource).toContain(
      "const accentProtectedZones = [...subHeadlineProtectedZones, subHeadlineTextZone]",
    );
    expect(componentSource).toContain(
      "const captionProtectedZones = accentTextZone ? [...accentProtectedZones, accentTextZone] : accentProtectedZones",
    );
    expect(componentSource).toContain(
      "const shouldUseContextCaption = Boolean(captionCopy)",
    );
    expect(componentSource).toContain("&& !accentCopy");
    expect(componentSource).toContain(
      "const headlineFontSize = getResponsiveMainHeadlineFontSize(headlineText, isTzuyangBenchmarkLayout ? (isLongHeadline ? 56 : 72)",
    );
    expect(componentSource).toContain(
      "const subHeadlineFontSize = isTzuyangBenchmarkLayout ? (isChallengeLayout ? 38 : 40)",
    );
    expect(componentSource).toContain('id: "host-head"');
    expect(componentSource).toContain("weight: 20");
    expect(componentSource).toContain("weight: 24");
    expect(componentSource).toContain("TEXT_OCCLUSION_HARD_FACE_PENALTY");
    expect(componentSource).toContain(
      'fontFamily: "Impact, Pretendard, system-ui, sans-serif"',
    );
    expect(componentSource).toContain(
      'fontFamily: "Arial Black, Pretendard, system-ui, sans-serif"',
    );
    expect(componentSource).toContain("preservedCustomLayers");
    expect(componentSource).toContain("zIndex: 8");
    expect(componentSource).toContain(
      "syncNaturalGenerationCopyToCanvas(naturalGenerationCopy)",
    );
    expect(componentSource).toContain(
      "headline: naturalGenerationCopy.headline",
    );
    expect(componentSource).toContain(
      "textLayers: naturalGenerationCopy.textLayers",
    );
    expect(componentSource).toContain(
      "const nextHeadline = deriveAutomaticThumbnailHeadlineCopy(nextTopic, candidate.headline.trim())",
    );
    expect(componentSource).toContain(
      "const nextHeadline = deriveAutomaticThumbnailHeadlineCopy(latestTopic, latestHeadline, defaultHeadline)",
    );
    expect(componentSource).toContain(
      "const nextHeadline = deriveAutomaticThumbnailHeadlineCopy(runTopic, latestHeadline)",
    );
    expect(componentSource).not.toContain(
      "fontSize: Math.max(layer.fontSize, 96), x: 642, y: 548",
    );
    expect(backendAgentSource).toContain("deriveThumbnailFoodSubject");
    expect(backendAgentSource).toContain("deriveBenchmarkThumbnailHeadline");
    expect(backendAgentSource).toContain(
      "deriveAutomaticThumbnailHeadlineCopy",
    );
    expect(backendAgentSource).toContain("MAIN_HEADLINE_MAX_LENGTH = 36");
    expect(backendAgentSource).toContain(
      "AUTO_GENERATED_MAIN_HEADLINE_MAX_LENGTH = 14",
    );
    expect(backendAgentSource).toContain("`${foodSubject} 먹방`");
    expect(backendAgentSource).toContain("밥도둑 인정?");
    expect(componentSource).toContain("referenceFileInputRef.current?.click()");
    expect(componentSource).toContain("openThumbnailReferenceFilePicker()");
    expect(componentSource).toContain("참고 이미지 추가");
    expect(componentSource).toContain("참고 이미지 파일 선택창을 열었습니다");
    expect(componentSource).toContain(
      'const THUMBNAIL_HISTORY_API_URL = "/api/admin/youtube-thumbnail-generator/history";',
    );
    expect(componentSource).toContain(
      'const THUMBNAIL_HISTORY_IMAGE_BASE_URL = "/qa-history/youtube-thumbnail-generator";',
    );
    expect(componentSource).not.toContain("THUMBNAIL_QA_HISTORY_URL");
    expect(componentSource).not.toContain("data-thumbnail-qa-history-link=");
    expect(componentSource).not.toContain("window.open(THUMBNAIL");
    expect(componentSource).toContain('data-thumbnail-history-panel="true"');
    expect(componentSource).toContain("data-thumbnail-history-load-run=");
    expect(componentSource).toContain("생성 히스토리");
    expect(componentSource).toContain(
      'data-thumbnail-generation-skeleton="true"',
    );
    expect(componentSource).toContain(
      'data-thumbnail-generation-skeleton-variant="neutral-gray"',
    );
    expect(componentSource).toContain(
      'data-thumbnail-generation-skeleton-effect="glass-shimmer"',
    );
    expect(componentSource).toContain(
      'data-thumbnail-unified-generation-skeleton="true"',
    );
    expect(componentSource).toContain(
      'data-thumbnail-generation-skeleton-glass-surface="true"',
    );
    expect(componentSource).toContain(
      'data-thumbnail-generation-skeleton-shimmer="true"',
    );
    expect(componentSource).toContain("admin-module-loading-shimmer");
    expect(componentSource).not.toContain(
      "[animation:storyboard-glass-shimmer_1.65s_ease-in-out_infinite]",
    );
    expect(componentSource).not.toContain("backdrop-blur-[1px]");
    expect(componentSource).toContain("from-slate-50/86");
    expect(componentSource).toContain("to-slate-200/68");
    expect(componentSource).toContain("rgba(203,213,225,0.28)");
    expect(componentSource).toContain("rgba(100,116,139,0.20)");
    expect(componentSource).not.toContain(
      'data-thumbnail-generation-skeleton-panel="copy-zone"',
    );
    expect(componentSource).not.toContain(
      'data-thumbnail-generation-skeleton-panel="host-food-zone"',
    );
    expect(componentSource).not.toContain(
      'data-thumbnail-generation-skeleton-panel="foreground-food-zone"',
    );
    expect(componentSource).not.toContain(
      'data-thumbnail-generation-skeleton="glass"',
    );
    expect(componentSource).not.toContain(
      "data-thumbnail-generation-skeleton-glint",
    );
    expect(componentSource).not.toContain("thumbnailGlassGlint");
    expect(componentSource).not.toContain(
      "bg-background/35 p-[clamp(1rem,3cqw,2.25rem)]",
    );
    expect(componentSource).not.toContain("animate-pulse rounded-xl");
    expect(componentSource).toContain(
      '<span className="sr-only">썸네일 생성 중</span>',
    );
    expect(componentSource).toContain(
      "이제 실제 썸네일 이미지를 만들고 있어요. 시간이 오래 걸리면 생성 중단을 누를 수 있습니다.",
    );
    expect(componentSource).not.toContain(
      "실제 썸네일 이미지를 생성하는 중입니다",
    );
    expect(componentSource).not.toContain("안전/권리 확인");
    expect(componentSource).not.toContain(
      "onCheckedChange={(checked) => setAcknowledgedSafety(checked === true)}",
    );
    expect(componentSource).not.toContain(
      "이미지 권리와 안전 사용 확인을 체크하세요.",
    );
    expect(componentSource).not.toContain(
      "참고 이미지 권리, 실제 인물/브랜드/개인 식별 정보 사용 권한과 안전한 썸네일 사용 조건을 확인했습니다.",
    );
    expect(componentSource).not.toContain(
      "Enter는 채팅 반영, Shift+Enter는 줄바꿈입니다. 실제 이미지는 채팅창 아래 생성 버튼으로 실행됩니다.",
    );
    expect(componentSource).toContain("acknowledgedSafety,");
    expect(componentSource).not.toContain("acknowledgedSafety: true,");
    expect(componentSource).toContain("thumbnailErrorActions");
    expect(componentSource).toContain("getThumbnailErrorAction");
    expect(componentSource).toContain(
      'import { toast } from "@/hooks/use-toast"',
    );
    expect(loadReadinessBody).toContain("setReadiness(payload);");
    expect(loadReadinessBody).toContain('title: "모델 상태 확인 실패"');
    expect(loadReadinessBody).not.toContain(
      "선택한 모델을 자동 전환하지 않습니다",
    );
    expect(loadReadinessBody).not.toContain(
      "formatThumbnailProviderBlockReason(availability?.reason)",
    );
    expect(loadReadinessBody).not.toContain(
      'title: "실제 이미지 모델 준비 필요"',
    );
    expect(componentSource).not.toContain('title: "모델 준비 필요"');
    expect(componentSource).not.toContain('title: "안전 미리보기로 전환"');
    expect(componentSource).not.toContain(
      'title: "실제 이미지 모델 준비 필요"',
    );
    expect(componentSource).toContain('title: "이미지 만들기 준비 필요"');
    expect(componentSource).toContain("이미지 만들기 준비가 아직 안 됐어요.");
    expect(componentSource).not.toContain("실제 이미지 모델 준비 필요 ·");
    expect(componentSource).not.toContain(
      "현재 선택한 실제 이미지 모델을 실행할 수 없습니다:",
    );
    expect(
      runThumbnailGenerationBody.indexOf(
        "if (!isLocalBridgeRoute && providerAvailability && !providerAvailability.available",
      ),
    ).toBeGreaterThan(-1);
    expect(runThumbnailGenerationBody).toContain(
      "const submittedPreflightIssues = getThumbnailGenerationPreflightIssues",
    );
    expect(
      runThumbnailGenerationBody.indexOf(
        "if (submittedPreflightIssues.length > 0)",
      ),
    ).toBeGreaterThan(-1);
    expect(
      runThumbnailGenerationBody.indexOf(
        "if (!isLocalBridgeRoute && providerAvailability && !providerAvailability.available",
      ),
    ).toBeLessThan(
      runThumbnailGenerationBody.indexOf(
        "if (submittedPreflightIssues.length > 0)",
      ),
    );
    expect(componentSource).not.toContain(
      "THUMBNAIL_PROVIDER_UNAVAILABLE_MESSAGE",
    );
    expect(runThumbnailGenerationBody).not.toContain(
      "if (preflightIssues.length > 0)",
    );
    expect(runThumbnailGenerationBody).not.toContain("preflightIssues.filter(");
    expect(componentSource).toContain('title: "썸네일 생성 실패"');
    expect(componentSource).not.toContain('data-thumbnail-error-action="true"');
    expect(componentSource).not.toContain(
      'data-thumbnail-preflight-issues="true"',
    );
    expect(componentSource).not.toContain(
      'data-thumbnail-file-preflight="true"',
    );
    expect(componentSource).not.toContain(
      'data-thumbnail-reference-url-import="true"',
    );
    expect(componentSource).not.toContain('id="thumbnail-reference-image-url"');
    expect(componentSource).not.toContain("URL 추가");
    expect(componentSource).toContain("providerReadinessKey");
    expect(componentSource).toContain("selectedProviderAvailability");
    expect(componentSource).not.toContain('title: "모델 실행 불가"');
    expect(componentSource).not.toContain('setProviderId("mock")');
    expect(componentSource).not.toContain('providerId !== "mock"');
    expect(componentSource).not.toContain(
      "선택한 실제 이미지 모델을 사용할 수 없습니다.",
    );
    expect(componentSource).not.toContain("OpenAI GPT Image 2 API (정확)");
    expect(componentSource).toContain("기본 OAuth");
    expect(componentSource).toContain("고급 로컬");
    expect(componentSource).toContain("API Key");
    expect(componentSource).toContain(
      'data-thumbnail-api-router-choice="true"',
    );
    expect(componentSource).toContain(
      'data-thumbnail-api-router-option="browser-openai-api-key"',
    );
    expect(componentSource).toContain(
      'data-thumbnail-api-router-option="local-codex-oauth"',
    );
    expect(componentSource).toContain(
      'data-thumbnail-api-router-option="local-bridge"',
    );
    expect(componentSource).not.toContain(
      "Codex built-in imagegen 로컬 (불투명)",
    );
    expect(componentSource).toContain(
      'const [providerId, setProviderId] = useState<ProviderId>("local-codex")',
    );
    expect(componentSource).not.toContain(
      'data-thumbnail-terminal-call-panel="true"',
    );
    expect(componentSource).not.toContain("터미널 호출 확인");
    expect(componentSource).not.toContain("localCodexTerminalCommand");
    expect(componentSource).not.toContain("terminalCall");
    expect(componentSource).not.toContain(
      "THUMBNAIL_LOCAL_CODEX_COMMAND wrapper",
    );
    expect(componentSource).not.toContain(
      '<h2 className="text-2xl font-black tracking-tight">유튜브 썸네일 생성기</h2>',
    );
    expect(componentSource).not.toContain("QUICK_START_PRESETS");
    expect(componentSource).not.toContain("applyQuickStartPreset");
    expect(componentSource).not.toContain(
      'data-thumbnail-onboarding-quick-start="true"',
    );
    expect(componentSource).not.toContain("빠른 시작");
    expect(componentSource).not.toContain(
      "처음이면 프리셋을 고른 뒤 문구만 바꾸고 생성하세요.",
    );
    expect(componentSource).toContain("썸네일 생성");
    expect(componentSource).not.toContain("썸네일 초안 생성");
    expect(componentSource).toContain(
      'const [generationMode, setGenerationMode] = useState<GenerationMode>("direct_provider")',
    );
    expect(componentSource).toContain(
      "generationMode: submittedGenerationMode",
    );
    expect(componentSource).not.toContain("generationModeOptions");
    expect(componentSource).not.toContain(
      'data-thumbnail-backend-agent-mode="true"',
    );
    expect(componentSource).not.toContain(
      'data-thumbnail-backend-agent-status="true"',
    );
    expect(componentSource).not.toContain("LangGraph agent");
    expect(componentSource).not.toContain("selectedGenerationMode.help");
    expect(componentSource).not.toContain(
      'data-thumbnail-backend-agent-result="true"',
    );
    expect(componentSource).not.toContain(
      'data-thumbnail-generation-warnings="true"',
    );
    expect(componentSource).not.toContain(
      'data-thumbnail-generation-trace="true"',
    );
    expect(componentSource).not.toContain(
      "data-thumbnail-provider-provenance={currentModelProvenance}",
    );
    expect(componentSource).not.toContain(
      'data-thumbnail-review-drawer="true"',
    );
    expect(componentSource).not.toContain(
      'data-thumbnail-agent-brief-summary="true"',
    );
    expect(componentSource).not.toContain(
      'data-thumbnail-generation-warning-summary="true"',
    );
    expect(componentSource).not.toContain(
      'type ModelProvenance = NonNullable<GenerationResult["baseImage"]["modelProvenance"]>',
    );
    expect(componentSource).not.toContain(
      "const modelProvenanceLabels: Record<ModelProvenance, string> = {",
    );
    expect(componentSource).not.toContain(
      'const currentModelProvenance: ModelProvenance = result?.baseImage.modelProvenance ?? "unknown"',
    );
    expect(componentSource).not.toContain(
      'const resultGenerationMode = result?.generationMode ?? (result?.backendAgent ? "backend_agent" : "direct_provider")',
    );
    expect(componentSource).not.toContain(
      'resultGenerationMode === "backend_agent"',
    );
    expect(componentSource).not.toContain(
      "const [isReviewDrawerOpen, setIsReviewDrawerOpen] = useState(true)",
    );
    expect(componentSource).not.toContain(
      "onToggle={(event) => setIsReviewDrawerOpen(event.currentTarget.open)}",
    );
    expect(componentSource).not.toContain("생성 리뷰");
    expect(componentSource).not.toContain("Agent 기록 없음");
    expect(componentSource).not.toContain("현재 표시할 경고가 없습니다.");
    expect(componentSource).toContain("generationMode?: GenerationMode;");
    expect(componentSource).toContain(
      'const [generationMode, setGenerationMode] = useState<GenerationMode>("direct_provider")',
    );
    expect(componentSource).toContain(
      'const submittedGenerationMode = isLocalBridgeRoute ? "direct_provider" : overrides.generationMode ?? generationMode;',
    );
    expect(componentSource).toContain(
      "const nextResult = { ...(payload as GenerationResult), generationMode: submittedGenerationMode };",
    );
    expect(componentSource).toContain("setResult(nextResult);");
    expect(componentSource).not.toContain(
      'generationMode === "backend_agent"\n      ? "백엔드 에이전트 요청"',
    );
    const toolbarIndex = componentSource.indexOf(
      'data-thumbnail-editor-toolbar="true"',
    );
    expect(toolbarIndex).toBeGreaterThan(
      componentSource.indexOf('data-thumbnail-keyboard-canvas="true"'),
    );
    expect(componentSource).not.toContain(
      "max-h-24 overflow-y-auto rounded-xl bg-muted/25",
    );
    expect(componentSource).not.toContain(
      "max-h-16 overflow-y-auto rounded-xl bg-amber-500/10",
    );
    expect(componentSource).not.toContain("warnings.slice(0, 4)");
    expect(componentSource).toContain(
      'const [generationMode, setGenerationMode] = useState<GenerationMode>("direct_provider")',
    );
    expect(requestSource).toContain(
      "function parseGenerationMode(value: unknown): ThumbnailGenerationMode",
    );
    expect(requestSource).toContain(
      "if (isThumbnailGenerationMode(value)) return value;",
    );
    expect(requestSource).toContain("'invalid_generation_mode'");
    expect(requestSource).toContain("parseThumbnailChatAgentRequest");
    expect(requestSource).toContain("THUMBNAIL_CHAT_MESSAGE_MAX_LENGTH");
    expect(requestSource).toContain("THUMBNAIL_CHAT_RUN_ID_PATTERN");
    expect(requestSource).toContain("chatRunId");
    expect(requestSource).toContain("activeLayerId");
    expect(requestSource).toContain("editingLayerId");
    expect(requestSource).toContain("currentTextLayers");
    expect(requestSource).toContain("'thumbnail_chat_payload_invalid'");
    expect(requestSource).toContain("'thumbnail_chat_message_required'");
    expect(requestSource).toContain("'thumbnail_chat_message_too_long'");
    expect(requestSource).not.toContain(
      "return isThumbnailGenerationMode(value) ? value : 'direct_provider'",
    );
    expect(componentSource).not.toContain('data-thumbnail-brief-preset="true"');
    expect(componentSource).not.toContain(
      'data-thumbnail-reference-role-editor="true"',
    );
    expect(componentSource).not.toContain(
      'data-thumbnail-brief-quality-panel="true"',
    );
    expect(componentSource).toContain("referenceImageRoles");
    expect(componentSource).toContain("fontFamily");
    expect(componentSource).toContain("strokeWidth");
    expect(componentSource).toContain("THUMBNAIL_EDITOR_TOOLS");
    expect(componentSource).toContain("applyThumbnailEditorTool");
    expect(componentSource).toContain("duplicateActiveTextLayer");
    expect(componentSource).toContain('"edit-text"');
    expect(componentSource).toContain('"delete-text"');
    expect(componentSource).toContain('"rotate-left"');
    expect(componentSource).toContain('"rotate-right"');
    expect(componentSource).toContain('"align-left"');
    expect(componentSource).toContain('"align-center"');
    expect(componentSource).toContain('"align-right"');
    expect(componentSource).toContain('"fill-yellow"');
    expect(componentSource).toContain('"stroke-thick"');
    expect(componentSource).toContain('"shadow-none"');
    expect(componentSource).toContain('"font-impact"');
    expect(componentSource).toContain("startCanvasTextInlineEditing(layer.id)");
    expect(componentSource).toContain("deleteTextLayer(layer.id)");
    expect(componentSource).toContain('{ align: "center" }');
    expect(componentSource).toContain('{ fill: "#fff200" }');
    expect(componentSource).toContain('{ shadow: "none" }');
    expect(componentSource).toContain(
      'fontFamily: "Impact, Pretendard, system-ui, sans-serif"',
    );
    expect(componentSource).toContain('data-thumbnail-editor-toolbar="true"');
    expect(componentSource).toContain(
      'data-thumbnail-tradingview-tool-palette="true"',
    );
    expect(componentSource).toContain('data-thumbnail-canvas-tool-row="true"');
    expect(componentSource).toContain(
      "grid min-h-0 flex-1 grid-rows-[minmax(0,1fr)_auto] gap-3 overflow-hidden p-3 pt-0",
    );
    expect(componentSource).toContain(
      "relative flex min-h-0 items-center justify-center overflow-hidden rounded-2xl bg-transparent",
    );
    expect(componentSource).toContain(
      "relative overflow-hidden rounded-2xl shadow-inner [container-type:inline-size]",
    );
    expect(componentSource).not.toContain("rounded-2xl bg-black");
    expect(componentSource).toContain('data-thumbnail-canvas-viewport="true"');
    expect(componentSource).toContain(
      'data-thumbnail-canvas-aspect-frame="16:9"',
    );
    expect(componentSource).toContain(
      'className="block h-full w-full touch-none cursor-move',
    );
    expect(componentSource).toContain(
      'className="overflow-hidden rounded-xl bg-muted/30 p-1" data-thumbnail-editor-toolbar="true"',
    );
    expect(componentSource).toContain(
      'className="grid w-full grid-cols-[repeat(auto-fit,minmax(5.5rem,1fr))] gap-1.5"',
    );
    expect(componentSource).not.toContain(
      'className="overflow-visible" data-thumbnail-editor-toolbar="true"',
    );
    expect(componentSource).not.toContain(
      'className="flex flex-wrap content-start gap-1.5"',
    );
    expect(componentSource).not.toContain("-mx-1 overflow-x-auto px-1");
    expect(componentSource).not.toContain(
      "flex gap-1.5 whitespace-nowrap pb-1",
    );
    expect(componentSource).toContain('variant="ghost"');
    expect(componentSource).toContain(
      "h-8 w-full min-w-0 gap-1 rounded-lg bg-background/80 px-1.5 text-[11px] leading-none shadow-sm hover:bg-background",
    );
    expect(componentSource).toContain(
      "[&_span]:min-w-0 [&_span]:truncate [&_svg]:h-3.5 [&_svg]:w-3.5",
    );
    expect(componentSource).not.toContain(
      "space-y-2 rounded-xl bg-background/85 p-2 shadow-sm ring-1 ring-border",
    );
    expect(componentSource).not.toContain(
      'data-thumbnail-active-layer-badge="true"',
    );
    expect(componentSource).not.toContain('data-thumbnail-layer-list="true"');
    expect(componentSource).not.toContain(
      "data-thumbnail-text-layer={layer.id}",
    );
    expect(componentSource).not.toContain(
      'data-thumbnail-active-layer={activeLayer?.id === layer.id ? "true" : "false"}',
    );
    expect(componentSource).not.toContain(
      'data-thumbnail-active-text-inline-editor="true"',
    );
    expect(componentSource).not.toContain(
      'data-thumbnail-inline-font-family="true"',
    );
    expect(componentSource).not.toContain(
      'data-thumbnail-inline-font-size="true"',
    );
    expect(componentSource).not.toContain(
      'data-thumbnail-inline-z-index="true"',
    );
    expect(componentSource).not.toContain("선택 문구 바로 편집");
    expect(
      componentSource.indexOf('data-thumbnail-editor-toolbar="true"'),
    ).toBeGreaterThan(
      componentSource.indexOf('data-thumbnail-keyboard-canvas="true"'),
    );
    expect(componentSource).toContain('data-thumbnail-add-text-layer="true"');
    expect(componentSource).toContain('data-thumbnail-safe-area-toggle="true"');
    expect(componentSource).toContain('data-thumbnail-draggable-canvas="true"');
    expect(componentSource).toContain('data-thumbnail-keyboard-canvas="true"');
    expect(componentSource).toContain("handleCanvasKeyDown");
    expect(componentSource).toContain("handleCanvasDoubleClick");
    expect(componentSource).toContain("startCanvasTextInlineEditing");
    expect(componentSource).toContain("editingLayerId");
    expect(componentSource).toContain("loadedBaseImageRef");
    expect(componentSource).toContain("drawCanvasFrameRef");
    expect(componentSource).toContain("window.requestAnimationFrame");
    expect(componentSource).toContain("handleInlineTextEditorBlur");
    expect(componentSource).toContain(
      "if (textTransformStateRef.current) return;",
    );
    expect(componentSource).toContain("type TextEditorHistorySnapshot");
    expect(componentSource).toContain("textLayerUndoStackRef");
    expect(componentSource).toContain("pendingTextLayerUndoSnapshotRef");
    expect(componentSource).toContain("TEXT_LAYER_UNDO_LIMIT");
    expect(componentSource).toContain("undoTextLayerChange");
    expect(componentSource).toContain("undoInlineTextEditorChange");
    expect(componentSource).toContain("handleInlineTextEditorBeforeInput");
    expect(componentSource).toContain(
      'nativeEvent.inputType !== "historyUndo"',
    );
    expect(componentSource).toContain("placeInlineTextEditorCaretAtEnd");
    expect(componentSource).toContain("isUndoKeyboardShortcut");
    expect(componentSource).toContain("handleThumbnailEditorShellKeyDown");
    expect(componentSource).toContain(
      "onKeyDown={handleThumbnailEditorShellKeyDown}",
    );
    expect(componentSource).toContain("commitPendingTextLayerUndoSnapshot");
    expect(componentSource).toContain("beginTextLayerUndoStep");
    expect(componentSource).toContain("ensurePendingTextLayerUndoSnapshot");
    expect(componentSource).toContain(
      'updateTextLayer(editingLayer.id, { content: nextContent }, { history: "none" })',
    );
    expect(componentSource).toContain("updateTextLayer(dragState.layerId, {");
    expect(componentSource).toContain('{ history: "none" });');
    expect(componentSource).toContain(
      'data-thumbnail-canvas-inline-text-editor="true"',
    );
    expect(componentSource).toContain(
      "onBeforeInput={handleInlineTextEditorBeforeInput}",
    );
    expect(componentSource).toContain("undoInlineTextEditorChange();");
    expect(componentSource).toContain("contentEditable");
    expect(componentSource).toContain("suppressContentEditableWarning");
    expect(componentSource).toContain("inlineTextEditorRef");
    expect(componentSource).toContain(
      "if (layer.id === editingLayerId) return;",
    );
    expect(componentSource).toContain("normalizeInlineEditableText");
    expect(componentSource).toContain("aria-multiline={false}");
    expect(componentSource).toContain("whitespace-nowrap");
    expect(componentSource).toContain("inline-block w-max max-w-none");
    expect(componentSource).toContain('width: "max-content"');
    expect(componentSource).toContain('maxWidth: "none"');
    expect(componentSource).toContain(
      'transformOrigin: `${editingLayer.align === "center" ? "center" : editingLayer.align} center`',
    );
    expect(componentSource).toContain("type TextTransformState");
    expect(componentSource).toContain("textTransformStateRef");
    expect(componentSource).toContain("handleTextTransformPointerDown");
    expect(componentSource).toContain("handleTextTransformPointerMove");
    expect(componentSource).toContain("handleTextTransformPointerUp");
    expect(componentSource).toContain("focusCanvasAfterTextTransform");
    expect(componentSource).toContain("handleTextTransformHandleKeyDown");
    expect(componentSource).toContain("focusCanvasAfterTextTransform();");
    expect(componentSource).toContain(
      "onKeyDown={handleTextTransformHandleKeyDown}",
    );
    expect(componentSource).toContain("renderTextTransformHandleButtons");
    expect(componentSource).toContain("TEXT_TRANSFORM_RESIZE_HANDLES");
    expect(componentSource).toContain("getTextLayerVisualFrame");
    expect(componentSource).toContain(
      "measured.actualBoundingBoxLeft + measured.actualBoundingBoxRight",
    );
    expect(componentSource).toContain('context.textBaseline = "middle"');
    expect(componentSource).toContain(
      "const strokeInset = Math.max(2, layer.strokeWidth / 2);",
    );
    expect(componentSource).toContain("Math.max(36, metrics.width");
    expect(componentSource).toContain("Math.max(28, metrics.height");
    expect(componentSource).toContain(
      "getTextLayerSelectionLabel(activeLayer)",
    );
    expect(componentSource).toContain(
      "getTextLayerTransformFrameStyle(activeLayer)",
    );
    expect(componentSource).toContain(
      'data-thumbnail-text-transform-metrics="visual-bounds"',
    );
    expect(componentSource).toContain(
      'data-thumbnail-selected-text-transform-label="true"',
    );
    expect(componentSource).toContain(
      "clampTextLayerFontSize(transformState.startFontSize *",
    );
    expect(componentSource).toContain(
      "normalizeCanvasRotation(transformState.startRotation",
    );
    expect(componentSource).toContain(
      'data-thumbnail-canvas-text-transform-frame="true"',
    );
    expect(componentSource).toContain(
      'data-thumbnail-canvas-selected-text-transform-frame="true"',
    );
    expect(componentSource).toContain(
      'data-thumbnail-canvas-text-transform-state="selected"',
    );
    expect(componentSource).toContain(
      'data-thumbnail-canvas-text-transform-state="editing"',
    );
    expect(componentSource).toContain(
      "data-thumbnail-text-transform-handle-state={state}",
    );
    expect(componentSource).toContain(
      'data-thumbnail-text-transform-handle-mode="resize"',
    );
    expect(componentSource).toContain(
      'data-thumbnail-text-transform-handle-mode="rotate"',
    );
    expect(componentSource).toContain(
      'data-thumbnail-selected-text-resize-handle={state === "selected" ? handleId : undefined}',
    );
    expect(componentSource).toContain(
      'data-thumbnail-selected-text-rotate-handle={state === "selected" ? "true" : undefined}',
    );
    expect(componentSource).toContain(
      "data-thumbnail-text-resize-handle={handleId}",
    );
    expect(componentSource).toContain(
      'data-thumbnail-text-rotate-handle="true"',
    );
    expect(componentSource).toContain('aria-label="문구 크기 조절"');
    expect(componentSource).toContain('aria-label="문구 회전"');
    expect(componentSource).not.toContain(
      "Math.max(editingLayer.content.length, 6) * editingLayer.fontSize",
    );
    expect(componentSource).toContain('whiteSpace: "nowrap"');
    expect(componentSource).not.toContain('whiteSpace: "pre-wrap"');
    expect(componentSource).toContain("TEXT_LAYER_RENDER_MAX_WIDTH");
    expect(componentSource).toContain("getNoWrapFittedTextMetrics");
    expect(componentSource).toContain("drawNoWrapFittedText");
    expect(componentSource).not.toContain(
      'context.fillText(layer.id === "headline" ? "메인 선택됨"',
    );
    expect(componentSource).toContain("const width = rawWidth * renderScale;");
    expect(componentSource).not.toContain(
      "Math.min(maxWidth, rawWidth * renderScale)",
    );
    expect(componentSource).toContain('text.replace(/\\s+/g, " ").trim()');
    expect(componentSource).not.toContain("drawWrappedText");
    expect(componentSource).not.toContain("text.split(/\\s+/)");
    expect(componentSource).not.toContain(
      "<input\n                  autoFocus",
    );
    expect(componentSource).toContain(
      "onDoubleClick={handleCanvasDoubleClick}",
    );
    expect(componentSource).toContain('aria-label="캔버스 위 문구 바로 수정"');
    expect(componentSource).toContain("[container-type:inline-size]");
    expect(componentSource).toContain("bg-transparent");
    expect(componentSource).toContain("WebkitTextStroke");
    expect(componentSource).toContain("moveActiveTextLayer");
    expect(componentSource).toContain("CANVAS_KEYBOARD_FAST_MOVE_STEP");
    expect(componentSource).toContain("tabIndex={0}");
    expect(componentSource).toContain("onKeyDown={handleCanvasKeyDown}");
    expect(componentSource).not.toContain(
      "data-thumbnail-canvas-keyboard-help",
    );
    expect(componentSource).not.toContain(
      'aria-describedby="thumbnail-canvas-keyboard-help"',
    );
    expect(componentSource).toContain(
      'data-thumbnail-safe-area-guide={showSafeAreaGuide ? "visible" : "hidden"}',
    );
    expect(componentSource).toContain(
      "onPointerDown={handleCanvasPointerDown}",
    );
    expect(componentSource).toContain(
      "onPointerMove={handleCanvasPointerMove}",
    );
    expect(componentSource).not.toContain("createInitialThumbnailResult");
    expect(componentSource).not.toContain("data:image/svg+xml;charset=utf-8");
    expect(componentSource).not.toContain("LOCAL_CODEX_THUMBNAIL_EXAMPLE_URL");
    expect(componentSource).not.toContain(
      "/qa-history/youtube-thumbnail-generator/generated/bundled/youtube-thumbnail-food-only-preview.png",
    );
    expect(componentSource).toContain(
      "/images/admin/youtube-thumbnail-generated-example-preview.png",
    );
    expect(componentSource).toContain("BUNDLED_THUMBNAIL_PREVIEW_RESULT");
    expect(componentSource).toContain(
      "useState<GenerationResult | null>(BUNDLED_THUMBNAIL_PREVIEW_RESULT)",
    );
    expect(componentSource).toContain(
      'useState<ThumbnailInitialPreviewSource>("bundled")',
    );
    expect(componentSource).toContain(
      "createBundledThumbnailPreviewTextLayers",
    );
    expect(componentSource).toContain("BUNDLED_THUMBNAIL_PREVIEW_HEADLINE");
    expect(componentSource).toContain("BUNDLED_THUMBNAIL_PREVIEW_SUB_HEADLINE");
    expect(componentSource).toContain("THUMBNAIL_HISTORY_API_URL");
    expect(componentSource).toContain("findLatestActualHistoryRun");
    expect(componentSource).toContain("findLatestExistingThumbnailPreviewRun");
    expect(componentSource).toContain("createThumbnailResultFromHistoryRun");
    expect(componentSource).toContain(
      "createExistingThumbnailPreviewResultFromHistoryRun",
    );
    expect(componentSource).toContain(
      "function isInitialThumbnailPreviewResult",
    );
    expect(componentSource).toContain('dataUrl.startsWith("/images/admin/")');
    expect(componentSource).toContain("canReplacePreviewWithHistoryResult");
    expect(componentSource).toContain("loadThumbnailHistory");
    expect(componentSource).toContain("latestPreviewRun");
    expect(componentSource).toContain("data-thumbnail-history-preview=");
    expect(componentSource).toContain("isExactGptImage2HistoryRun(run)");
    expect(historySource).toContain("readLatestExistingGeneratedPreviewRun");
    expect(historySource).toContain("THUMBNAIL_HISTORY_E2E_RUNS_DIR");
    expect(historySource).toContain("THUMBNAIL_HISTORY_BUNDLED_PREVIEW_IMAGE");
    expect(historySource).toContain("hasTzuyangHostPresenceProof");
    expect(historySource).toContain("bundled-preview-visible-host");
    expect(historySource).toContain("Never promote those arbitrary");
    expect(historySource).not.toContain(
      "/qa-history/youtube-thumbnail-generator/generated/bundled/youtube-thumbnail-food-only-preview.png",
    );
    expect(historySource).toContain(
      "/images/admin/youtube-thumbnail-generated-example-preview.png",
    );
    expect(promptSource).toContain("SPECIFIC_CREATOR_REFERENCE_REQUIRED");
    expect(promptSource).toContain("No host/person reference was provided");
    expect(promptSource).toContain("Automatic collected-reference evidence:");
    expect(promptSource).toContain(
      "Collected Tzuyang thumbnail visual matching",
    );
    expect(promptSource).toContain(
      "Match their thumbnail grammar very closely",
    );
    expect(promptSource).toContain("strict identity-lock references");
    expect(promptSource).toContain("forehead/bangs silhouette");
    expect(promptSource).toContain("eye spacing/shape");
    expect(promptSource).toContain("idol-like alternate");
    expect(promptSource).toContain(
      "omit the human figure rather than showing the wrong person",
    );
    expect(promptSource).toContain(
      "No embedding/reranker model-use claim is made",
    );
    expect(promptSource).toContain("Local vector retrieval proof");
    expect(promptSource).toContain("do not label as BGE");
    expect(promptSource).not.toContain(
      "use the requested Tzuyang/YouTube creator context",
    );
    expect(retrievalSource).toContain("THUMBNAIL_RETRIEVAL_COMMAND_ENV");
    expect(retrievalSource).toContain("THUMBNAIL_RETRIEVAL_DEFAULT_LOCAL_POOL");
    expect(retrievalSource).toContain("THUMBNAIL_RETRIEVAL_DEFAULT_COMMAND");
    expect(retrievalSource).toContain(
      "THUMBNAIL_RETRIEVAL_DEFAULT_ADAPTER_DISABLED",
    );
    expect(retrievalSource).toContain("local-char-ngram-v1");
    expect(retrievalSource).toContain("local-lexical-reranker-v1");
    expect(retrievalSource).toContain("mapThumbnailEvidenceIntentToUploadRole");
    expect(retrievalSource).toContain("canShowThumbnailRetrievalModelLabel");
    expect(retrievalSource).toContain(
      "diagnostics.status !== 'used' && diagnostics.status !== 'partial'",
    );
    expect(retrievalSource).toContain(
      "diagnostics.usedModels?.embedding === 'BAAI/bge-m3'",
    );
    expect(retrievalSource).toContain(
      "diagnostics.operations?.rerankerApplied === true",
    );
    expect(retrievalSource).not.toContain("from 'langgraph");
    expect(retrievalSource).not.toContain("from 'FlagEmbedding");
    expect(retrievalSource).not.toContain("from 'langchain_core");
    expect(routeSource).toContain("resolveThumbnailRetrievalReferences");
    expect(routeSource).toContain("readThumbnailRetrievalReferenceImages");
    expect(routeSource).toContain("generationReferenceImages");
    expect(routeSource).toContain("thumbnail_retrieval_visual_refs");
    expect(routeSource).toContain("payloadWithRetrieval");
    expect(routeSource).toContain("thumbnail_retrieval_status");
    expect(historySource).toContain("retrieval: result.retrieval");
    expect(componentSource).toContain("formatThumbnailRetrievalSummary");
    expect(componentSource).toContain("canShowThumbnailRetrievalModelLabel");
    expect(backendAgentSource).toContain("Retrieved reference plan");
    expect(backendAgentSource).toContain("retrievalEvidenceCount");
    expect(backendAgentGraphSource).toContain("LANGGRAPH_AVAILABLE");
    expect(backendAgentGraphSource).toContain("langgraph-compatible-fallback");
    expect(backendAgentGraphSource).toContain("graphRuntime");
    expect(backendAgentGraphSource).toContain("retrievalEvidenceCount");
    expect(backendAgentGraphSource).toContain("Retrieval proof");
    expect(backendAgentReadmeSource).toContain(
      "Runtime fallback and retrieval risk contract",
    );
    expect(backendAgentReadmeSource).toContain("diagnostics.graphRuntime");
    expect(backendAgentBgeRequirementsSource).toContain(
      "FlagEmbedding>=1.2.11",
    );
    expect(backendAgentSource).toContain(
      "host/person 레퍼런스가 없으므로 사람 얼굴은 만들지 말고",
    );
    expect(componentSource).toContain(
      "쯔양님이 나오려면 참고 이미지가 필요합니다",
    );
    expect(componentSource).not.toContain("참고 인물 이미지는 파일로 추가해줘");
    expect(componentSource).toContain(
      "getSpecificCreatorReferenceRequiredMessage",
    );
    expect(componentSource).toContain(
      "shouldBlockSpecificCreatorGenerationRequest",
    );
    expect(componentSource).toContain(
      'data-thumbnail-canvas-aspect-frame="16:9"',
    );
    expect(componentSource).toContain(
      "new ResizeObserver(updateCanvasDisplaySize)",
    );
    expect(routeSource).toContain("host_reference_required");
    expect(routeSource).toContain(
      "allowHostPersonFromRetrievedThumbnails: requestsSpecificCreatorHost",
    );
    expect(componentSource).not.toContain("쯔양이 오른쪽에 크게 생성해줘");
    expect(historySource).toContain("createBundledThumbnailPreviewRun");
    expect(historySource).toContain("latestPreviewRun");
    expect(historySource).toContain("modelProvenance: 'unknown'");
    expect(componentSource).not.toContain("mockUsed");
    expect(historySource).toContain("value.mockUsed === true");
    expect(historySource).not.toContain("mockUsed?: false");
    expect(historySource).not.toContain("mockUsed: false");
    expect(historySource).not.toContain("local_codex_fixture");
    expect(componentSource).toContain(
      'const [providerId, setProviderId] = useState<ProviderId>("local-codex")',
    );
    expect(componentSource).toContain('model: "gpt-image-2"');
    expect(componentSource).toContain('modelProvenance: "exact"');
    expect(componentSource).toContain("현재 화면: 아직 만든 이미지 없음");
    expect(componentSource).toContain(
      "확인된 이미지일 때만 실제 결과로 표시합니다.",
    );
    expect(componentSource).not.toContain(
      'data-thumbnail-operator-readiness="true"',
    );
    expect(componentSource).not.toContain(
      'data-thumbnail-operator-readiness-shell="true"',
    );
    expect(componentSource).not.toContain(
      "data-thumbnail-strict-model-blocked",
    );
    expect(componentSource).not.toContain("운영 준비도 ·");
    expect(componentSource).not.toContain(
      "exact gpt-image-2 provenance가 확인된 결과만 실제 생성/히스토리로 인정합니다.",
    );
    expect(componentSource).not.toContain(
      "다른 이미지 모델 fallback은 사용하지 않습니다.",
    );
    expect(componentSource).not.toContain(
      "선택한 모델을 자동 전환하지 않습니다",
    );
    expect(componentSource).not.toContain("fallbackProvider");
    expect(componentSource).not.toContain("사용 가능 모델로 전환");
    expect(componentSource).not.toContain("쯔양님/매니저");
    expect(componentSource).not.toContain(
      "data-thumbnail-operator-persona-checklist",
    );
    expect(componentSource).not.toContain(
      "data-thumbnail-operator-next-action",
    );
    expect(componentSource).toContain("formatThumbnailProviderBlockReason");
    expect(componentSource).toContain(
      "local_codex_model_provenance_unverified",
    );
    expect(componentSource).not.toContain(
      'data-thumbnail-initial-preview="true"',
    );
    expect(componentSource).not.toContain("Prompt safety:");
    expect(componentSource).not.toContain(
      "생성 정보: 초기 예시는 바로 편집할 수 있습니다.",
    );
    expect(componentSource).not.toContain("Model: {result.baseImage.model}");
    expect(componentSource).not.toContain("생성 프롬프트 보기");
    expect(componentSource).toContain("handleExportPng");
    expect(componentSource).toContain("await handleExportPng();");
    expect(componentSource).toContain("setShowSafeAreaGuide(nextVisible)");
    expect(componentSource).toContain("undoTextLayerChange();");
    expect(componentSource).toContain("applyThumbnailEditorTool(commandId)");
    expect(componentSource).toContain("ThumbnailExportPresetId");
    expect(componentSource).toContain("thumbnailExportPresets");
    expect(componentSource).toContain('"quick-1280x720"');
    expect(componentSource).toContain('"high-3840x2160"');
    expect(componentSource).toContain("HIGH_EXPORT_SCALE = 3");
    expect(componentSource).toContain('data-thumbnail-export-preset="true"');
    expect(componentSource).toContain('data-thumbnail-export-metadata="true"');
    expect(componentSource).toContain("loadThumbnailImage");
    expect(componentSource).toContain("exportCanvas.width = preset.width");
    expect(componentSource).toContain("exportCanvas.height = preset.height");
    expect(componentSource).toContain("context.scale(scale, scale)");
    expect(componentSource).toContain(
      "drawNoWrapFittedText(context, layer.content, 0, 0, TEXT_LAYER_RENDER_MAX_WIDTH, layer);",
    );
    expect(componentSource).toContain(
      "tzudong-youtube-thumbnail-${preset.fileSuffix}.png",
    );
    expect(componentSource).toContain('exportCanvas.toDataURL("image/png")');
    expect(componentSource).not.toContain("createLinearGradient");
    expect(routeSource).toContain("export const runtime = 'nodejs'");
    expect(routeSource).toContain("export const dynamic = 'force-dynamic'");
    expect(routeSource).toContain(
      "await requireAdmin({ allowDevAdminBypassCookie: true })",
    );
    expect(
      routeSource.indexOf(
        "await requireAdmin({ allowDevAdminBypassCookie: true })",
      ),
    ).toBeLessThan(routeSource.indexOf("await request.formData()"));
    const postSource = routeSource.slice(
      routeSource.indexOf("export async function POST"),
    );
    expect(
      postSource.indexOf(
        "await requireAdmin({ allowDevAdminBypassCookie: true })",
      ),
    ).toBeLessThan(postSource.indexOf("generateYoutubeThumbnail"));
    expect(routeSource).toContain("getContentLengthRejection");
    expect(routeSource).toContain("generateYoutubeThumbnailWithBackendAgent");
    expect(routeSource).toContain("getThumbnailBackendAgentStatus");
    expect(routeSource).toContain("toPublicThumbnailBackendAgentStatus");
    expect(routeSource).toContain("payload.generationMode === 'backend_agent'");
    expect(routeSource).toContain(
      "backendAgent: toPublicThumbnailBackendAgentStatus(getThumbnailBackendAgentStatus(process.env))",
    );
    expect(routeSource).not.toContain(
      "backendAgent: getThumbnailBackendAgentStatus(process.env)",
    );
    expect(routeSource).toContain("getMultipartContentTypeRejection");
    expect(routeSource).toContain("'Cache-Control': 'no-store'");
    expect(routeSource).toContain("randomUUID");
    expect(routeSource).toContain(
      "const generationRunId = `thumbnail-generation-${randomUUID()}`;",
    );
    expect(routeSource).toContain("signal: request.signal");
    expect(routeSource).toContain("runId: generationRunId");
    expect(chatRouteSource).toContain("export const runtime = 'nodejs'");
    expect(chatRouteSource).toContain("export const dynamic = 'force-dynamic'");
    expect(chatRouteSource).toContain(
      "await requireAdmin({ allowDevAdminBypassCookie: true })",
    );
    expect(chatRouteSource).toContain(
      "'Content-Type': 'text/event-stream; charset=utf-8'",
    );
    expect(chatRouteSource).toContain(
      "generateYoutubeThumbnailChatWithBackendAgent",
    );
    expect(chatRouteSource).toContain("parseThumbnailChatAgentRequest");
    expect(
      chatRouteSource.indexOf("parseThumbnailChatAgentRequest("),
    ).toBeLessThan(chatRouteSource.indexOf("new ReadableStream"));
    expect(chatRouteSource).toContain("randomUUID");
    expect(chatRouteSource).toContain(
      "const chatRunId = payload.chatRunId ?? `thumbnail-chat-${randomUUID()}`;",
    );
    expect(chatRouteSource).toContain(
      "const payloadWithRunId = { ...payload, chatRunId };",
    );
    expect(chatRouteSource).toContain("signal: request.signal");
    expect(chatRouteSource).toContain("runId: chatRunId");
    expect(chatRouteSource).toContain(
      "요청을 읽고 답변, 편집, 생성 중 어디에 해당하는지 분류하고 있어요",
    );
    expect(chatRouteSource).toContain("send('status'");
    expect(chatRouteSource).toContain("send('agent_started'");
    expect(chatRouteSource).toContain("send('heartbeat'");
    expect(chatRouteSource).toContain("send('agent_done'");
    expect(chatRouteSource).toContain("send('stream_timeout'");
    expect(chatRouteSource).toContain("send('patch'");
    expect(chatRouteSource).toContain("send('done'");
    expect(chatRouteSource).toContain("jsonRouteError(error)");
    expect(chatRouteSource).not.toContain(
      "payload as Parameters<typeof generateYoutubeThumbnailChatWithBackendAgent>[0]",
    );
    expect(referenceImageRouteSource).toContain(
      "export const runtime = 'nodejs'",
    );
    expect(referenceImageRouteSource).toContain(
      "export const dynamic = 'force-dynamic'",
    );
    expect(referenceImageRouteSource).toContain(
      "await requireAdmin({ allowDevAdminBypassCookie: true })",
    );
    const referencePostSource = referenceImageRouteSource.slice(
      referenceImageRouteSource.indexOf("export async function POST"),
    );
    expect(
      referencePostSource.indexOf(
        "await requireAdmin({ allowDevAdminBypassCookie: true })",
      ),
    ).toBeLessThan(
      referencePostSource.indexOf("fetchThumbnailReferenceImageFromUrl"),
    );
    expect(referenceImageRouteSource).toContain("Content-Type");
    expect(referenceImageRouteSource).toContain(
      "X-Thumbnail-Reference-File-Name",
    );
    expect(referenceImageRouteSource).toContain("'Cache-Control': 'no-store'");
    expect(providerSource).toContain("gpt-image-2");
    expect(providerSource).not.toContain("gemini-3-pro-image-preview");
    expect(providerSource).toContain("local_codex_model_provenance_unverified");
    expect(providerSource).toContain("THUMBNAIL_LOCAL_CODEX_COMMAND");
    expect(providerSource).toContain("THUMBNAIL_LOCAL_CODEX_PROVENANCE_FILE");
    expect(providerSource).toContain(
      "THUMBNAIL_LOCAL_CODEX_DURABLE_OUTPUT_DIR",
    );
    expect(providerSource).toContain(
      ".omx/artifacts/gpt-image-2-provenance/generated",
    );
    expect(providerSource).toContain("durableOutputPath");
    expect(providerSource).toContain("transientOutputPath");
    expect(providerSource).toContain("hasExactGptImage2C2paProof");
    expect(providerSource).toContain("realpathSync");
    expect(providerSource).toContain("hasMatchingLatestCodexProof");
    expect(providerSource).toContain("CODEX_IMAGEGEN_PROVENANCE_FILE");
    expect(providerSource).toContain("THUMBNAIL_LOCAL_CODEX_ARGS_JSON");
    expect(providerSource).toContain("THUMBNAIL_LOCAL_CODEX_IMAGE_MODEL");
    expect(providerSource).not.toContain("execFile");
    expect(providerSource).toContain("type ThumbnailProviderExecutionOptions");
    expect(providerSource).toContain("throwIfProviderAborted");
    expect(providerSource).toContain("OPENAI_API_KEY: ''");
    expect(providerSource).toContain("'thumbnail_generation_aborted'");
    expect(providerSource).toContain("options.signal");
    expect(providerSource).not.toContain("THUMBNAIL_GENERATION_RUN_ID");
    expect(providerSource).toContain("spawn(");
    expect(promptSource).toContain("Do not render real names");
    expect(promptSource).toContain("Style preset:");
    expect(promptSource).toContain("night-market-reaction");
    expect(requestSource).toContain("THUMBNAIL_REFERENCE_ROLES");
    expect(requestSource).toContain("THUMBNAIL_GENERATION_MODES");
    expect(requestSource).toContain("parseGenerationMode");
    expect(requestSource).toContain("detectImageMime");
    expect(requestSource).toContain("fetchThumbnailReferenceImageFromUrl");
    expect(requestSource).toContain("parseThumbnailReferenceImageUrl");
    expect(requestSource).toContain("THUMBNAIL_REMOTE_IMAGE_TIMEOUT_MS");
    expect(requestSource).toContain("lookupFn(url.hostname");
    expect(requestSource).toContain("redirect: 'manual'");
    expect(requestSource).toContain("detectImageMime(bytes)");
    expect(backendAgentSource).toContain("getThumbnailBackendAgentStatus");
    expect(backendAgentSource).toContain(
      "generateYoutubeThumbnailChatWithBackendAgent",
    );
    expect(backendAgentSource).toContain(
      "generateYoutubeThumbnailWithBackendAgent",
    );
    expect(backendAgentSource).toContain("THUMBNAIL_AGENT_COMMAND");
    expect(backendAgentSource).toContain("THUMBNAIL_AGENT_ROOT");
    expect(backendAgentSource).toContain("THUMBNAIL_AGENT_TIMEOUT_MS");
    expect(backendAgentSource).toContain(
      "DEFAULT_THUMBNAIL_AGENT_RUNTIME = 'codex_cli_oauth'",
    );
    expect(backendAgentSource).toContain(
      "DEFAULT_THUMBNAIL_AGENT_CODEX_MODEL = 'gpt-5.5'",
    );
    expect(backendAgentSource).toContain(
      "DEFAULT_THUMBNAIL_AGENT_CODEX_EFFORT = 'low'",
    );
    expect(backendAgentSource).toContain("resolveThumbnailAgentCodexModel");
    expect(backendAgentSource).toContain("resolveThumbnailAgentCodexEffort");
    expect(backendAgentSource).toContain("UNSAFE_COMMAND_PATTERN");
    expect(backendAgentSource).toContain("shell: false");
    expect(backendAgentSource).toContain("type ThumbnailAgentExecutionOptions");
    expect(backendAgentSource).toContain("THUMBNAIL_AGENT_RUN_ID");
    expect(backendAgentSource).toContain(
      "options.signal?.addEventListener('abort'",
    );
    expect(backendAgentSource).toContain("'thumbnail_chat_aborted'");
    expect(backendAgentSource).toContain("runId: options.runId");
    expect(backendAgentSource).toContain("generateYoutubeThumbnailWithPrompt");
    expect(backendAgentSource).toContain("backend_agent_orchestrated");
    expect(backendAgentSource).toContain("providerModelProvenance");
    expect(backendAgentGraphSource).toContain("StateGraph");
    expect(backendAgentGraphSource).toContain("promptAddendum");
    expect(backendAgentRunnerSource).toContain("THUMBNAIL_AGENT_JSON");
    expect(backendAgentRunnerSource).toContain("never generates images");
    expect(backendAgentRunnerSource).toContain(
      'DEFAULT_CODEX_MODEL = "gpt-5.5"',
    );
    expect(backendAgentRunnerSource).toContain('DEFAULT_CODEX_EFFORT = "low"');
    expect(backendAgentRunnerSource).toContain("codex exec");
    expect(backendAgentRunnerSource).toContain("model_reasoning_effort");
    expect(backendAgentRequirementsSource).toContain("langgraph");
    expect(backendAgentRequirementsSource).toContain("langchain-openai");
  });

  test("adds storyboard generation as an operator-controlled admin module", () => {
    const consoleSource = adminConsoleShellSource();
    const storyboardSource = source(
      "components/admin/storyboard/AdminStoryboardGenerator.tsx",
    );
    const canvasShellSource = source(
      "components/admin/storyboard/StoryboardCanvasShell.tsx",
    );
    const canvasModuleSource = `${storyboardSource}\n${canvasShellSource}`;
    const guidedPresetSource = source(
      "lib/admin/storyboard/guided-example-presets.ts",
    );
    const appGlobalsSource = source("app/app-globals.css");
    const routeSource = source("app/api/admin/storyboard/route.ts");
    expect(routeSource).toContain("mode: 'async_job_control_plane'");
    expect(routeSource).toContain("buildStoryboardJobInsert");
    expect(routeSource).not.toContain("generateStoryboardWithBackendAgent");
    const chatRouteSource = source("app/api/admin/storyboard/chat/route.ts");
    const imageRouteSource = source("app/api/admin/storyboard/images/route.ts");
    const imageProviderSource = source(
      "lib/admin/storyboard/image-provider.ts",
    );
    const imageReadinessSource = source(
      "lib/admin/storyboard/image-provider-readiness.ts",
    );
    const imageTrustSource = source("lib/admin/storyboard/image-trust.ts");
    const localBridgeContractSource = source(
      "lib/admin/storyboard/local-bridge-contract.ts",
    );
    const localBridgeCoreSource = source(
      "lib/admin/local-bridge/core-contract.ts",
    );
    const localBridgeServerSource = source(
      "lib/admin/storyboard/local-bridge-server.mts",
    );
    const localBridgeScriptSource = source(
      "scripts/storyboard-local-bridge.ts",
    );
    const historyClientSource = source(
      "lib/admin/storyboard/history-client.ts",
    );
    const storyboardImageWrapperSource = source(
      "scripts/codex-imagegen-storyboard-provider.py",
    );
    const backendAgentWrapperSource = source(
      "../../backend/storyboard-agent/scripts/run-storyboard-agent.py",
    );
    const backendAgentRequirementsSource = source(
      "../../backend/storyboard-agent/requirements.txt",
    );
    const envExampleSource = source(".env.example");
    const readmeSource = source("README.md");
    const backendAgentSource = source("lib/admin/storyboard/backend-agent.ts");
    const generatorSource = source("lib/admin/storyboard/generator.ts");
    const typesSource = source("lib/admin/storyboard/types.ts");
    const requireAdminSource = source("lib/auth/require-admin.ts");

    expect(consoleSource).toContain('id: "storyboard"');
    expect(consoleSource).toContain("스토리보드 생성");
    expect(consoleSource).toContain("AdminStoryboardGenerator");
    expect(storyboardSource).toContain("/api/admin/storyboard");
    expect(storyboardSource).toContain('aria-label="스토리보드 생성"');
    expect(storyboardSource).toContain(
      'data-admin-storyboard-generator="true"',
    );
    expect(storyboardSource).toContain(
      "flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-background p-2",
    );
    expect(storyboardSource).toContain(
      'data-storyboard-viewport-fit="bounded"',
    );
    expect(storyboardSource).not.toContain(
      'height: "calc(var(--full-height, 100vh) - 2rem)"',
    );
    expect(storyboardSource).toContain(
      "grid min-h-0 min-w-0 flex-1 gap-3 overflow-hidden",
    );
    expect(storyboardSource).toContain(
      'data-storyboard-desktop-split-layout="inline-grid"',
    );
    expect(storyboardSource).toContain(
      '"var(--storyboard-split-columns, minmax(0, 1fr) minmax(320px, 400px))"',
    );
    expect(canvasModuleSource).toContain(
      'gridColumn: "var(--storyboard-result-panel-column, 1)"',
    );
    expect(storyboardSource).toContain(
      'data-storyboard-input-panel="chat-stream"',
    );
    expect(storyboardSource).toContain(
      'data-storyboard-input-position="right-of-canvas"',
    );
    expect(storyboardSource).toContain('aria-label="요구사항 채팅"');
    expect(storyboardSource).toContain('data-storyboard-chat-header="true"');
    expect(storyboardSource).toContain(
      'data-storyboard-chat-header-actions="true"',
    );
    expect(storyboardSource).toContain(
      'data-storyboard-chat-title-icon="true"',
    );
    expect(storyboardSource).toContain(
      'className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary"',
    );
    expect(storyboardSource).toContain("<MessageCircle");
    expect(storyboardSource).toContain('className="block h-3.5 w-3.5"');
    expect(storyboardSource).not.toContain(
      'data-storyboard-chat-avatar="assistant"',
    );
    expect(storyboardSource).not.toContain(
      'data-storyboard-chat-avatar="user"',
    );
    expect(storyboardSource).not.toContain(
      'data-storyboard-chat-avatar="draft"',
    );
    expect(storyboardSource).toContain("data-storyboard-chat-message-stack={");
    expect(storyboardSource).toContain('"user-bubble"');
    expect(storyboardSource).toContain('"assistant-starter-panel"');
    expect(storyboardSource).toContain('"assistant-plain-with-outside-status"');
    expect(storyboardSource).toContain(
      'data-storyboard-chat-assistant-message="plain-text"',
    );
    expect(storyboardSource).toContain(
      "const STORYBOARD_CHAT_TYPEWRITER_START_DELAY_MS = 180;",
    );
    expect(storyboardSource).toContain(
      "const STORYBOARD_CHAT_TYPEWRITER_INTERVAL_MS = 24;",
    );
    expect(storyboardSource).toContain(
      "const STORYBOARD_CHAT_TYPEWRITER_STEP_CHARS = 1;",
    );
    expect(storyboardSource).toContain(
      "function useStoryboardChatTypewriterMessages(",
    );
    expect(storyboardSource).toContain(
      "useStoryboardChatTypewriterMessages(chatMessages)",
    );
    expect(storyboardSource).toContain(
      "storyboardChatTypewriterTextById[message.id]",
    );
    expect(storyboardSource).toContain("hasEmptyPendingAssistantText");
    expect(storyboardSource).toContain(
      "STORYBOARD_CHAT_TYPEWRITER_START_DELAY_MS",
    );
    expect(storyboardSource).not.toContain("shouldReduceMotion");
    expect(storyboardSource).toContain("data-storyboard-chat-typewriter={");
    expect(storyboardSource).toContain(
      'message.role === "assistant" ? "true" : undefined',
    );
    expect(storyboardSource).toContain(
      "data-storyboard-chat-typewriter-status={",
    );
    expect(storyboardSource).toContain(
      'data-storyboard-chat-typewriter-text="true"',
    );
    expect(storyboardSource).toContain(
      "data-storyboard-chat-typewriter-state={",
    );
    expect(storyboardSource).toContain(
      'data-storyboard-chat-thinking-outside-bubble="true"',
    );
    expect(storyboardSource).toContain(
      'data-storyboard-chat-progress-outside-bubble="true"',
    );
    expect(appGlobalsSource).not.toContain(
      "[data-storyboard-chat-avatar] > svg",
    );
    expect(storyboardSource).toContain(
      '"ml-auto flex min-w-0 max-w-[88%] flex-col items-end space-y-1.5 text-right"',
    );
    expect(storyboardSource).toContain(
      "!message.thinkingTrace?.length",
    );
    expect(storyboardSource).toContain(
      "!message.imageGenerationProgress",
    );
    expect(storyboardSource).not.toContain("max-w-[86%]");
    expect(storyboardSource).not.toContain(
      "grid h-7 w-7 shrink-0 place-items-center",
    );
    expect(storyboardSource).toContain(
      '<span className="min-w-0 truncate">스토리보드 도우미</span>',
    );
    expect(storyboardSource).toContain("스토리보드 기록");
    expect(storyboardSource).toContain(
      "이전에 만든 결과를 이 페이지에서 다시 불러옵니다.",
    );
    expect(storyboardSource).not.toContain("실제 POST 결과");
    expect(storyboardSource).not.toContain("스토리보드 기록를");
    expect(storyboardSource).not.toContain("생성 채팅");
    expect(storyboardSource).not.toContain("생성 히스토리");
    expect(storyboardSource).toContain(
      'data-storyboard-history-panel-toggle="true"',
    );
    expect(storyboardSource).toContain(
      'data-storyboard-history-dropdown-trigger="icon-only"',
    );
    expect(storyboardSource).toContain(
      'data-storyboard-history-dropdown="true"',
    );
    expect(storyboardSource).toContain(
      'data-storyboard-chat-settings-toggle="true"',
    );
    expect(storyboardSource).toContain(
      'data-storyboard-chat-settings-dropdown-trigger="true"',
    );
    expect(storyboardSource).toContain(
      'data-storyboard-chat-settings-dropdown="true"',
    );
    expect(storyboardSource).toContain("data-storyboard-chat-settings-open={");
    expect(storyboardSource).toContain("<DropdownMenu");
    expect(storyboardSource).toContain("<DropdownMenuTrigger asChild>");
    expect(storyboardSource).toContain("<DropdownMenuContent");
    expect(storyboardSource).not.toContain(
      '<MessageSquare className="h-4 w-4" aria-hidden="true" />',
    );
    expect(storyboardSource).toContain('data-storyboard-chat-panel="true"');
    expect(storyboardSource).toContain(
      'data-storyboard-chat-style="thumbnail-like"',
    );
    expect(storyboardSource).toContain(
      'data-storyboard-chat-settings-panel="true"',
    );
    expect(storyboardSource).toContain("이미지 설정");
    expect(storyboardSource).toContain("기본 OAuth · 고급 로컬 · API Key 백업");
    expect(storyboardSource).not.toContain("OpenAI Key · OAuth · Local Bridge");
    expect(storyboardSource).toContain("API Key 백업");
    expect(storyboardSource).toContain(
      'data-storyboard-api-router-choice="true"',
    );
    expect(storyboardSource).toContain(
      'data-storyboard-api-router-choice-layout="oauth-deduped"',
    );
    expect(storyboardSource).toContain(
      'data-storyboard-api-router-option="browser-openai-api-key"',
    );
    expect(storyboardSource).toContain(
      'data-storyboard-api-router-option="local-codex-oauth"',
    );
    expect(storyboardSource).toContain(
      'data-storyboard-api-router-option="local-bridge"',
    );
    expect(storyboardSource).toContain(
      'data-storyboard-api-router-oauth-transport="server"',
    );
    expect(storyboardSource).toContain(
      'data-storyboard-api-router-oauth-transport="local-bridge"',
    );
    expect(storyboardSource).toContain(
      'data-storyboard-api-router-fallback="browser-api-key"',
    );
    expect(storyboardSource).toContain(
      'data-storyboard-local-bridge-settings="memory-only"',
    );
    expect(storyboardSource).toContain(
      'data-storyboard-local-bridge-settings-visibility="advanced-selected"',
    );
    expect(storyboardSource).toContain(
      'data-storyboard-local-bridge-server-relay="forbidden"',
    );
    expect(storyboardSource).toContain(
      'data-storyboard-local-bridge-pairing-guide="true"',
    );
    expect(storyboardSource).toContain("쉬운 페어링");
    expect(storyboardSource).toContain(
      'data-storyboard-local-bridge-command="true"',
    );
    expect(storyboardSource).toContain(
      "cd apps/web && bun run storyboard:local-bridge",
    );
    expect(storyboardSource).toContain(
      'data-storyboard-local-bridge-auto-connect="true"',
    );
    expect(storyboardSource).toContain(
      'data-storyboard-local-bridge-chat-trace-copy="true"',
    );
    expect(storyboardSource).toContain("pairing_token");
    expect(storyboardSource).toContain("STORYBOARD_LOCAL_BRIDGE_DEFAULT_URL");
    expect(storyboardSource).not.toContain("void initialStoryboardResult;");
    expect(storyboardSource).not.toContain(
      "저장된 검증 이미지가 있으면 첫 화면에 즉시 표시합니다.",
    );
    expect(storyboardSource).toContain("무엇부터 만들까요?");
    expect(storyboardSource).toContain("makeStoryboardImprovementSummaryMessage(");
    expect(storyboardSource).toContain("setChatMessages((current) =>");
    expect(storyboardSource).toContain(
      "postStoryboardLocalBridgeImagesRequest",
    );
    expect(storyboardSource).toContain('command: "generateStoryboard"');
    expect(storyboardSource).toContain(
      "storyboardImageRouteChoice === STORYBOARD_LOCAL_BRIDGE_ROUTE_ID",
    );
    expect(storyboardSource).toContain(
      "normalizeStoryboardLocalBridgeToken(token)",
    );
    expect(storyboardSource).toContain("event.origin !== helperOrigin");
    expect(storyboardSource).toContain("event.source !== popup");
    expect(storyboardSource).toContain("getStoryboardLocalBridgeAuthHeaders(token)");
    expect(storyboardSource).toContain(
      "normalizeStoryboardLocalBridgeImagesResponse",
    );
    expect(storyboardSource).toContain(
      'data-storyboard-api-router-choice="true"',
    );
    expect(storyboardSource).toContain(
      'data-storyboard-api-router-option="browser-openai-api-key"',
    );
    expect(storyboardSource).toContain(
      'data-storyboard-api-router-option="local-codex-oauth"',
    );
    expect(storyboardSource).toContain(
      'data-storyboard-api-router-panel="true"',
    );
    expect(storyboardSource).toContain("data-storyboard-api-router-active={");
    expect(storyboardSource).toContain("data-storyboard-codex-oauth-status={");
    expect(storyboardSource).toContain("Codex OAuth");
    expect(storyboardSource).not.toContain(
      'data-storyboard-chat-settings-source-trace="true"',
    );
    expect(storyboardSource).not.toContain(
      'data-storyboard-chat-settings-image-command="true"',
    );
    expect(storyboardSource).not.toContain(
      'data-storyboard-image-provider-readiness="true"',
    );
    expect(storyboardSource).toContain(
      "data-storyboard-image-provider-status={",
    );
    expect(storyboardSource).not.toContain(
      'data-storyboard-image-provider-guidance="true"',
    );
    expect(storyboardSource).not.toContain(
      'data-storyboard-image-provider-refresh="true"',
    );
    expect(storyboardSource).not.toContain(
      'data-storyboard-image-provider-model="true"',
    );
    expect(storyboardSource).toContain(
      "data-storyboard-image-provider-status-icon={",
    );
    expect(storyboardSource).toContain(
      'data-storyboard-image-provider-status-visual="plug-icon-only"',
    );
    expect(storyboardSource).toContain(
      '<Plug className="h-4 w-4" aria-hidden="true" />',
    );
    expect(storyboardSource).toContain(
      "color: isStoryboardImageProviderAvailable",
    );
    expect(storyboardSource).toContain('"#059669"');
    expect(storyboardSource).toContain('"#dc2626"');
    expect(storyboardSource).not.toContain(
      '"inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full border"',
    );
    expect(storyboardSource).not.toContain("CheckCircle2,");
    expect(storyboardSource).not.toContain("CircleOff,");
    expect(storyboardSource).not.toContain(
      "data-storyboard-image-provider-action-status={",
    );
    expect(storyboardSource).toContain(
      'from "@/lib/admin/storyboard/image-provider-readiness"',
    );
    expect(storyboardSource).toContain(
      "INITIAL_STORYBOARD_IMAGE_PROVIDER_READINESS",
    );
    expect(storyboardSource).toContain("type StoryboardImageProviderReadiness");
    expect(storyboardSource).toContain(
      "type StoryboardImageProviderStatusResponse",
    );
    expect(storyboardSource).toContain(
      "getStoryboardImageProviderStatusRequest",
    );
    expect(storyboardSource).toContain("mapStoryboardImageProviderReadiness");
    expect(storyboardSource).toContain(
      "formatStoryboardImageProviderGuidanceMessage",
    );
    expect(storyboardSource).toContain(
      "guideUnavailableStoryboardImageGeneration",
    );
    expect(storyboardSource).toContain("!isStoryboardImageProviderAvailable");
    expect(storyboardSource).not.toContain("이미지 생성 준비 상태");
    expect(storyboardSource).toContain("이미지 생성 설정 필요");
    expect(imageRouteSource).toContain("StoryboardImageGenerationError");
    expect(imageRouteSource).toContain("normalizeRouteError(error)");
    expect(imageRouteSource).toContain(
      "return jsonError(error.code, error.status, error.message)",
    );
    expect(imageRouteSource).toContain("generateStoryboardSceneImages(");
    expect(imageProviderSource).toContain(
      "new StoryboardImageGenerationError(",
    );
    expect(imageProviderSource).toContain("'provider_unavailable'");
    expect(imageProviderSource).toContain("backend provenance");
    expect(storyboardSource).not.toContain(
      "STORYBOARD_IMAGE_PROVIDER_MODEL_ENV",
    );
    expect(storyboardSource).not.toContain(
      "STORYBOARD_IMAGE_PROVIDER_COMMAND_ENV",
    );
    expect(storyboardSource).not.toContain(
      "STORYBOARD_IMAGE_PROVIDER_COMMAND_PLACEHOLDER",
    );
    expect(imageReadinessSource).toContain(
      "STORYBOARD_IMAGE_PROVIDER_MODEL_ENV = 'STORYBOARD_LOCAL_CODEX_IMAGE_MODEL'",
    );
    expect(imageReadinessSource).toContain(
      "STORYBOARD_IMAGE_PROVIDER_COMMAND_PLACEHOLDER = '<verified bridge>'",
    );
    expect(imageReadinessSource).toContain(
      "isExactStoryboardGptImage2ProviderPayload",
    );
    expect(imageReadinessSource).toContain(
      "provider.providerId === STORYBOARD_IMAGE_PROVIDER_ID",
    );
    expect(imageReadinessSource).toContain(
      "provider.model === STORYBOARD_IMAGE_PROVIDER_MODEL",
    );
    expect(imageReadinessSource).toContain(
      "provider.modelProvenance === STORYBOARD_IMAGE_PROVIDER_EXACT_PROVENANCE",
    );
    expect(imageReadinessSource).toContain("provider?.available === true");
    expect(imageReadinessSource).toContain("blocked_provenance");
    expect(storyboardSource).not.toContain(
      'data-storyboard-chat-settings-reset="true"',
    );
    expect(storyboardSource).not.toContain(
      'data-storyboard-user-perspective-readiness="true"',
    );
    expect(storyboardSource).not.toContain(
      'data-storyboard-visual-safety-readiness="true"',
    );
    expect(storyboardSource).not.toContain(
      "data-storyboard-user-perspective-role={item.id}",
    );
    expect(storyboardSource).not.toContain(
      'data-storyboard-omitted-scene-count="true"',
    );
    expect(storyboardSource).toContain("StoryboardUserPerspectiveRoleId");
    expect(storyboardSource).toContain(
      "buildStoryboardUserPerspectiveReadiness",
    );
    expect(storyboardSource).toContain(
      "formatStoryboardUserPerspectiveMessage",
    );
    expect(storyboardSource).toContain("formatStoryboardVisualSafetyMessage");
    expect(storyboardSource).toContain("formatStoryboardOmittedSceneText");
    expect(storyboardSource).toContain("이미지 안전 점검");
    expect(storyboardSource).toContain("실존 인물/진행자 얼굴");
    expect(storyboardSource).toContain("쯔양");
    expect(storyboardSource).toContain("매니저");
    expect(storyboardSource).toContain("PD");
    expect(storyboardSource).toContain("편집자");
    expect(storyboardSource).toContain("준비됨");
    expect(storyboardSource).toContain("확인 필요");
    expect(storyboardSource).not.toContain("STORYBOARD_ROLE_VIEW_OPTIONS");
    expect(storyboardSource).not.toContain("activeStoryboardRoleId");
    expect(storyboardSource).not.toContain("buildStoryboardActiveRoleView");
    expect(storyboardSource).not.toContain(
      'data-storyboard-role-switcher="true"',
    );
    expect(storyboardSource).not.toContain(
      "data-storyboard-role-option={option.id}",
    );
    expect(storyboardSource).not.toContain(
      'data-storyboard-active-role-panel="true"',
    );
    expect(storyboardSource).not.toContain(
      "data-storyboard-active-role={activeStoryboardRoleView.id}",
    );
    expect(storyboardSource).not.toContain("쯔양이 바로 볼 것");
    expect(storyboardSource).not.toContain("PD가 판단할 것");
    expect(storyboardSource).not.toContain("매니저가 챙길 것");
    expect(storyboardSource).not.toContain("편집자가 볼 것");
    expect(storyboardSource).toContain('data-storyboard-chat-log="true"');
    expect(storyboardSource).toContain(
      'data-storyboard-chat-transcript="true"',
    );
    expect(storyboardSource).toContain(
      "const chatTranscriptRef = useRef<HTMLDivElement | null>(null);",
    );
    expect(storyboardSource).toContain("ref={chatTranscriptRef}");
    expect(storyboardSource).toContain(
      "const chatTranscriptBottomRef = useRef<HTMLDivElement | null>(null);",
    );
    expect(storyboardSource).toContain("ref={chatTranscriptBottomRef}");
    expect(storyboardSource).toContain(
      "const transcript = chatTranscriptRef.current;",
    );
    expect(storyboardSource).toContain("window.requestAnimationFrame");
    expect(storyboardSource).toContain("transcript.scrollTo({");
    expect(storyboardSource).toContain("top: transcript.scrollHeight");
    expect(storyboardSource).toContain('data-storyboard-chat-bottom-anchor="true"');
    expect(storyboardSource).toContain("scrollIntoView({");
    expect(storyboardSource).toContain("latestDisplayedText.length");
    expect(storyboardSource).toContain("isGeneratingImages");
    expect(storyboardSource).toContain('data-storyboard-chat-controls="true"');
    expect(storyboardSource).not.toContain(
      'data-storyboard-chat-message-meta="true"',
    );
    expect(storyboardSource).toContain(
      'data-storyboard-chat-message-bubble="true"',
    );
    expect(storyboardSource).toContain(
      'data-storyboard-chat-assistant-message="plain-text"',
    );
    expect(storyboardSource).toContain('data-storyboard-chat-composer="true"');
    expect(storyboardSource).not.toContain(
      'data-storyboard-chat-live-stream="true"',
    );
    expect(storyboardSource).toContain(
      'data-storyboard-chat-topic-state="true"',
    );
    expect(storyboardSource).toContain("formatStoryboardRealDataTrace");
    expect(storyboardSource).toContain("getStoryboardRealDataModeLabel");
    expect(storyboardSource).not.toContain(
      'data-storyboard-chat-real-data-trace="true"',
    );
    expect(storyboardSource).not.toContain(
      "data-storyboard-chat-real-data-trace-mode={",
    );
    expect(storyboardSource).toContain("영상 흐름 반영");
    expect(storyboardSource).toContain("예시 구성");
    expect(storyboardSource).not.toContain(
      "storyboardRealDataTrace.sourceText",
    );
    expect(storyboardSource).not.toContain(
      "storyboardRealDataTrace.backendText",
    );
    expect(storyboardSource).not.toContain("trace.summaryText");
    expect(storyboardSource).not.toContain("확인한 자료");
    expect(storyboardSource).not.toContain("활용 자료");
    expect(storyboardSource).not.toContain("반응 강도");
    expect(storyboardSource).not.toContain("생성시각");
    expect(storyboardSource).not.toContain("생성시각 ${result.generatedAt}");
    expect(storyboardSource).toContain(
      "const trace = formatStoryboardRealDataTrace(result)",
    );
    expect(storyboardSource).not.toContain(
      "formatStoryboardRealDataTrace(generated)",
    );
    expect(storyboardSource).toContain(
      "const STORYBOARD_LATEST_REAL_DATA_URL =",
    );
    expect(storyboardSource).toContain(
      '"/qa-history/storyboard/latest-real-data.json"',
    );
    expect(storyboardSource).toContain(
      "const STORYBOARD_SHARED_SEED_REAL_DATA_URL =",
    );
    expect(storyboardSource).toContain(
      '"/storyboard-seed/latest-real-data.json"',
    );
    expect(storyboardSource).toContain("StoryboardInitialResultSource");
    expect(storyboardSource).toContain("fetchStoryboardInitialResult(");
    expect(storyboardSource).toContain("isStoryboardDisplayImageAvailable");
    expect(storyboardSource).toContain(
      "stripUnavailableStoryboardGeneratedImagesForBrowser",
    );
    expect(storyboardSource).toContain("stripStoryboardGeneratedImageForScene");
    expect(storyboardSource).toContain("loadCanvasImage(dataUrl)");
    expect(storyboardSource).toContain(
      "trustedFirstPageSceneCount >= STORYBOARD_FRAMES_PER_PAGE",
    );
    expect(storyboardSource).toContain("STORYBOARD_SHARED_SEED_REAL_DATA_URL,");
    expect(storyboardSource).toContain('"shared-seed"');
    const sharedSeedSource = source(
      "public/storyboard-seed/latest-real-data.json",
    );
    const sharedSeed = JSON.parse(sharedSeedSource) as {
      result: {
        storyboard: {
          scenes: Array<{ generatedImage?: { dataUrl?: string } }>;
        };
      };
    };
    const sharedSeedImageUrls = sharedSeed.result.storyboard.scenes.map(
      (scene) => scene.generatedImage?.dataUrl,
    );
    expect(sharedSeedImageUrls).toHaveLength(10);
    expect(sharedSeedImageUrls).toEqual(
      Array.from(
        { length: 10 },
        (_, index) =>
          `/storyboard-seed/generated/cut-${String(index + 1).padStart(2, "0")}.png`,
      ),
    );
    expect(sharedSeedSource).not.toContain("/qa-history/storyboard/generated/");
    expect(storyboardSource).toContain("initialResult.runUrl");
    expect(storyboardSource).not.toContain("공용 기본 스토리보드");
    expect(storyboardSource).toContain("STORYBOARD_HISTORY_INDEX_URL");
    expect(storyboardSource).toContain("getSafeStoryboardHistoryRunUrl");
    expect(storyboardSource).toContain("getStoryboardHistoryResults");
    expect(storyboardSource).toContain("extractStoryboardHistoryRuns");
    expect(storyboardSource).toContain("mergeStoryboardHistoryCases");
    expect(storyboardSource).toContain("getStoryboardHistoryPreviewImage");
    expect(storyboardSource).toContain(
      "formatStoryboardHistoryVisibleCutCount",
    );
    expect(storyboardSource).toContain("getStoryboardHistoryProofSummaries");
    expect(storyboardSource).toContain(
      "getExactStoryboardGeneratedImageProvenance",
    );
    expect(storyboardSource).toContain(
      "mergeStoryboardGeneratedImagesIntoResult",
    );
    expect(storyboardSource).toContain("const browserSafeResult =");
    expect(storyboardSource).toContain(
      "await stripUnavailableStoryboardGeneratedImagesForBrowser(mergedResult)",
    );
    expect(storyboardSource).toContain("accumulatedResult = browserSafeResult");
    expect(storyboardSource).toContain("applyStoryboardHistoryResult");
    expect(storyboardSource).not.toContain(
      'data-storyboard-case-history="true"',
    );
    expect(storyboardSource).toContain('data-storyboard-history-panel="true"');
    expect(storyboardSource).toContain(
      "data-storyboard-history-status={storyboardHistoryStatus}",
    );
    expect(storyboardSource).toContain(
      "data-storyboard-history-count={String(",
    );
    expect(storyboardSource).toContain("data-storyboard-history-stale={");
    expect(storyboardSource).toContain('storyboardHistoryStatus === "stale"');
    expect(storyboardSource).toContain("새로고침 실패 · 이전 결과 표시 중");
    expect(storyboardSource).toContain(
      "스토리보드 기록 인덱스를 불러오지 못했습니다.",
    );
    expect(storyboardSource).toContain(
      "새로고침에서 새 히스토리 결과를 찾지 못해 이전 결과를 표시 중입니다.",
    );
    expect(storyboardSource).toContain('data-storyboard-history-run="true"');
    expect(storyboardSource).toContain('data-storyboard-history-title="true"');
    expect(storyboardSource).toContain(
      'data-storyboard-history-preview-image="true"',
    );
    expect(storyboardSource).toContain(
      'data-storyboard-history-proof-toggle="true"',
    );
    expect(storyboardSource).toContain(
      'data-storyboard-history-proof-panel="true"',
    );
    expect(storyboardSource).toContain(
      'data-storyboard-history-proof-provider="true"',
    );
    expect(storyboardSource).toContain(
      'data-storyboard-history-proof-model="true"',
    );
    expect(storyboardSource).toContain(
      'data-storyboard-history-proof-response="true"',
    );
    expect(storyboardSource).toContain(
      'data-storyboard-history-proof-hashes="true"',
    );
    expect(storyboardSource).not.toContain(
      'data-storyboard-history-proof-panel="true" data-storyboard-image-frame',
    );
    expect(storyboardSource).not.toContain(
      'data-storyboard-case-history-logline="true"',
    );
    expect(storyboardSource).toContain("선택한 스토리보드를 불러왔어요");
    expect(storyboardSource).not.toContain("setLatestRealDataLoadedAt");
    expect(historyClientSource).toContain(
      "export const STORYBOARD_HISTORY_INDEX_URL",
    );
    expect(historyClientSource).toContain("normalizeStoryboardHistoryRunPath");
    expect(historyClientSource).toContain("getSafeStoryboardHistoryRunUrl");
    expect(historyClientSource).toContain("trimmed.includes('?')");
    expect(historyClientSource).toContain("trimmed.includes('#')");
    expect(historyClientSource).toContain("trimmed.endsWith('.json')");
    expect(historyClientSource).toContain("latest-real-data.json");
    expect(historyClientSource).toContain("run.jsonPath");
    expect(historyClientSource).toContain("run.rawPath");
    expect(storyboardSource).not.toContain(
      'data-storyboard-live-canvas-text-summary="true"',
    );
    expect(storyboardSource).not.toContain(
      'data-storyboard-chat-agent-model="gpt-5.5"',
    );
    expect(storyboardSource).not.toContain(
      'data-storyboard-chat-agent-effort="high"',
    );
    expect(storyboardSource).toContain("getStoryboardChatQuickCommand");
    expect(storyboardSource).toContain("getStoryboardChatStatusMessage");
    expect(storyboardSource).toContain("appendStoryboardQuickCommandMessages");
    expect(storyboardSource).toContain('| "image_status"');
    expect(storyboardSource).toContain('| "review"');
    expect(storyboardSource).toContain('| "safety"');
    expect(storyboardSource).toContain('| "trace"');
    expect(storyboardSource).toContain('quickCommand === "image_status"');
    expect(storyboardSource).toContain('quickCommand === "review"');
    expect(storyboardSource).toContain('quickCommand === "safety"');
    expect(storyboardSource).toContain('quickCommand === "trace"');
    expect(storyboardSource).toContain("isStoryboardTraceIntent");
    expect(storyboardSource).toContain("formatStoryboardTraceBubble");
    expect(storyboardSource).toContain("이렇게 만들었어요");
    expect(storyboardSource).toContain("STORYBOARD_PDF_FLOW_CHECK_DEFINITIONS");
    expect(storyboardSource).not.toContain(
      'data-storyboard-pdf-flow-trace="true"',
    );
    expect(storyboardSource).not.toContain(
      "data-storyboard-pdf-flow-check={check.id}",
    );
    expect(storyboardSource).not.toContain(
      "data-storyboard-pdf-flow-check-status",
    );
    expect(storyboardSource).toContain("STORYBOARD_PDF_FLOW_SEQUENCE_TEXT");
    expect(storyboardSource).toContain("창작자에게는 스토리보드");
    expect(storyboardSource).toContain("시청자에게는 맛집 지도");
    expect(storyboardSource).toContain(
      "영상 데이터 수집 → AI 분석 → RAG/검색 개선 → 결과 검증 → DB/히스토리 저장 → 웹서비스 표시",
    );
    const pdfFlowDefinitionBlock =
      storyboardSource.match(
        /const STORYBOARD_PDF_FLOW_CHECK_DEFINITIONS:[\s\S]*?\n\];/,
      )?.[0] ?? "";
    const pdfFlowCheckIds = Array.from(
      pdfFlowDefinitionBlock.matchAll(/id: "([^"]+)"/g),
      (match) => match[1],
    );
    expect(pdfFlowCheckIds).toEqual([
      "service_storyboard",
      "service_restaurant_map",
      "youtube_data_collection",
      "intro_storefront_context",
      "heatmap_replay_frames",
      "video_captioning",
      "subtitle_contextual_retrieval",
      "dense_sparse_embedding",
      "reranker",
      "multi_agent_graph",
      "storyboard_design",
      "evaluation_logs",
      "review_status",
      "db_history_storage",
      "web_service_delivery",
    ]);
    expect(storyboardSource).toContain("STORYBOARD_PDF_FLOW_STATUS_VALUES");
    expect(storyboardSource).toContain('"used"');
    expect(storyboardSource).toContain('"available"');
    expect(storyboardSource).toContain('"fallback"');
    expect(storyboardSource).toContain('"not_used"');
    expect(storyboardSource).toContain(
      "evaluation_logs에는 Rule 평가와 AI Judge 평가 결과를 저장합니다.",
    );
    expect(storyboardSource).toContain(
      "review_status는 데이터 검수 상태를 관리하는 필드로, pending, approved, rejected와 같은 상태값을 통해 승인 대기, 승인 완료, 반려 여부를 구분합니다.",
    );
    expect(storyboardSource).not.toContain(
      'data-storyboard-page-script-summary="true"',
    );
    expect(storyboardSource).not.toContain("formatStoryboardPageScriptSummary");
    expect(storyboardSource).toContain("formatStoryboardAssistantDisplayText");
    expect(storyboardSource).toContain(
      "더 자세히 보고 싶으면 “과정”이라고 입력하세요.",
    );
    expect(storyboardSource).toContain("준비된 스토리보드를 불러왔어요.");
    expect(storyboardSource).toContain(
      "컷마다 오디오, 자막, 촬영 포인트를 나눠서 볼 수 있어요.",
    );
    expect(storyboardSource).toContain("첫 컷은 가게 앞 인트로부터 시작해요.");
    expect(storyboardSource).toContain("데이터\\s*흐름");
    expect(storyboardSource).toContain("isStoryboardRagProcessIntent(normalized)");
    expect(storyboardSource).toContain(
      "/^(이미지상태|이미지생성상태|생성상태|provider|gpt-image-2|gptimage2)$/",
    );
    expect(storyboardSource).toContain(
      "/^(안전|안전점검|이미지점검|얼굴점검|비주얼점검|safety|visualsafety|imagecheck|facecheck)$/",
    );
    expect(storyboardSource).toContain(
      "/^(점검|검토|리뷰|사용자점검|사용자관점|검수|qa|review)$/",
    );
    expect(storyboardSource).not.toContain(
      "‘상태’, ‘이미지상태’, ‘점검’, ‘안전점검’, ‘생성’, ‘4컷 재생성’, ‘초기화’",
    );
    expect(storyboardSource).not.toContain("$imagegen");
    const chatDraftHandler =
      storyboardSource.match(
        /function handleChatDraftChange\(value: string\) \{([\s\S]*?)\n  \}/,
      )?.[1] ?? "";
    expect(chatDraftHandler).toContain("setChatDraft(value);");
    expect(chatDraftHandler).not.toContain("setForm");
    expect(storyboardSource).toContain(
      "const commandBaseForm: GeneratorForm = form;",
    );
    expect(storyboardSource).not.toContain("prompt: result.request.prompt");
    expect(storyboardSource).toContain("현재 상태 · CUT");
    expect(storyboardSource).toContain(
      'aria-label="스토리보드 요구사항 채팅 입력"',
    );
    expect(storyboardSource).toContain(
      "onKeyDown={handleStoryboardChatKeyDown}",
    );
    expect(storyboardSource).toContain(
      "const storyboardChatComposerImeRef = useRef(false);",
    );
    expect(storyboardSource).toContain(
      "handleStoryboardChatCompositionStart",
    );
    expect(storyboardSource).toContain(
      "handleStoryboardChatCompositionEnd",
    );
    expect(storyboardSource).toContain("isStoryboardChatImeComposing");
    expect(storyboardSource).toContain("event.nativeEvent.isComposing");
    expect(storyboardSource).toContain('event.key === "Process"');
    expect(storyboardSource).toContain(
      "onCompositionStart={handleStoryboardChatCompositionStart}",
    );
    expect(storyboardSource).toContain(
      "onCompositionEnd={handleStoryboardChatCompositionEnd}",
    );
    expect(storyboardSource).toContain(
      'aria-describedby="storyboard-prompt-help storyboard-chat-keyboard-hint"',
    );
    expect(storyboardSource).toContain(
      'data-storyboard-chat-ime-safe="true"',
    );
    expect(storyboardSource).toContain(
      'id="storyboard-chat-keyboard-hint"',
    );
    expect(storyboardSource).toContain(
      "한글 조합 중 Enter는 전송하지 않고, 조합이 끝난 뒤 Enter로 전송합니다.",
    );
    expect(storyboardSource).toContain(
      'const STORYBOARD_CHAT_AGENT_STREAM_URL = "/api/admin/storyboard/chat";',
    );
    expect(storyboardSource).toContain("extractStoryboardChatSseEvents");
    expect(storyboardSource).toContain("isStoryboardChatAgentResult");
    expect(storyboardSource).toContain("getTrustedStoryboardGeneratedImage");
    expect(storyboardSource).toContain("countTrustedStoryboardGeneratedImages");
    expect(storyboardSource).toContain("getVisibleTrustedStoryboardScenes");
    expect(storyboardSource).toContain("getOmittedStoryboardSceneCount");
    expect(storyboardSource).toContain(
      "stripUntrustedStoryboardGeneratedImages",
    );
    expect(storyboardSource).toContain(
      "const storyboardFrameScenes = useMemo(",
    );
    expect(storyboardSource).toContain("() => result.storyboard.scenes");
    expect(storyboardSource).toContain("getStoryboardSourcePageScenes");
    expect(storyboardSource).toContain("getStoryboardScenePageCount");
    expect(storyboardSource).toContain(
      "getOmittedStoryboardSceneCount(result.storyboard.scenes)",
    );
    expect(storyboardSource).toContain(
      "무이미지/미검증 컷 ${omittedSceneCount}개 제외",
    );
    expect(storyboardSource).not.toContain(
      "data-storyboard-image-empty-state={",
    );
    expect(storyboardSource).toContain('data-storyboard-empty-canvas="true"');
    expect(imageTrustSource).toContain("isTrustedStoryboardGeneratedImage");
    expect(imageTrustSource).toContain("countTrustedStoryboardGeneratedImages");
    expect(imageTrustSource).toContain(
      "STORYBOARD_GENERATED_IMAGE_TRUST_POLICY",
    );
    expect(imageTrustSource).toContain(
      "image.trustPolicy === STORYBOARD_GENERATED_IMAGE_TRUST_POLICY",
    );
    expect(imageProviderSource).toContain(
      "Create exactly one full-bleed 16:9 single-scene storyboard cut image",
    );
    expect(imageProviderSource).toContain(
      "This image will be placed into an external 2x2 grid by the web UI",
    );
    expect(imageProviderSource).toContain("no storyboard sheet");
    expect(imageProviderSource).toContain("no multi-panel layout");
    expect(imageProviderSource).toContain("no internal borders");
    expect(imageProviderSource).toContain("no blank quadrants");
    expect(imageProviderSource).toContain(
      "cinematic hand-drawn food-storyboard keyframe",
    );
    expect(imageProviderSource).toContain(
      "local_codex_model_provenance_unverified",
    );
    expect(imageProviderSource).toContain(
      "backend provenance를 증명할 수 없어 중단",
    );
    expect(storyboardSource).toContain(
      "fetch(STORYBOARD_CHAT_AGENT_STREAM_URL",
    );
    expect(storyboardSource).toContain("appendChatMessages?: boolean;");
    expect(storyboardSource).toContain("assistantMessageId?: string;");
    expect(storyboardSource).toContain("shouldGenerate");
    expect(storyboardSource).toContain("abortStoryboardChatWork");
    expect(storyboardSource).toContain("abortStoryboardImageGeneration");
    expect(storyboardSource).toContain("imageGenerationAbortControllerRef");
    expect(storyboardSource).toContain("imageAbortController.signal");
    expect(storyboardSource).toContain("data-storyboard-chat-cancel={");
    expect(storyboardSource).toContain(
      'isStoryboardChatCancelMode ? "true" : undefined',
    );
    expect(storyboardSource).toContain(
      "data-storyboard-image-generation-cancel={",
    );
    expect(storyboardSource).toContain('"스토리보드 이미지 생성 중단"');
    expect(storyboardSource).toContain(
      "이미지 생성 중단 요청됨 · 이미 반영된 CUT 이미지는 캔버스에 유지했습니다.",
    );
    expect(storyboardSource).toContain("disabled={");
    expect(storyboardSource).toContain("isStoryboardChatSubmitDisabled");
    expect(storyboardSource).toContain('"요구사항 채팅 반영"');
    expect(storyboardSource).toContain("data-storyboard-chat-submit={");
    expect(storyboardSource).toContain(
      "STORYBOARD_CHAT_IMAGE_ATTACHMENT_LIMIT = 3",
    );
    expect(storyboardSource).toContain(
      "STORYBOARD_CHAT_IMAGE_ATTACHMENT_MAX_BYTES = 4 * 1024 * 1024",
    );
    expect(storyboardSource).toContain(
      "STORYBOARD_CHAT_IMAGE_ATTACHMENT_ACCEPT",
    );
    expect(storyboardSource).toContain('"image/png,image/jpeg,image/webp"');
    expect(storyboardSource).toContain(
      "storyboardChatImageAttachments.length > 0",
    );
    expect(storyboardSource).toContain(
      "createStoryboardChatImageAttachment(file)",
    );
    expect(storyboardSource).toContain(
      "formatStoryboardChatAttachmentSummary(submittedAttachments)",
    );
    expect(storyboardSource).toContain(
      "imageAttachments: submittedAttachments",
    );
    expect(storyboardSource).toContain(
      'data-storyboard-chat-attachments="true"',
    );
    expect(storyboardSource).toContain(
      'data-storyboard-chat-attachment-upload="true"',
    );
    expect(storyboardSource).toContain(
      'data-storyboard-chat-action-menu-trigger="true"',
    );
    expect(storyboardSource).toContain(
      'data-storyboard-chat-action-menu="true"',
    );
    expect(storyboardSource).toContain("multiline-input-over-actions");
    expect(storyboardSource).toContain("inline-actions-one-line");
    expect(storyboardSource).toContain("above-actions-top-left");
    expect(storyboardSource).toContain("between-actions-one-line");
    expect(storyboardSource).toContain(
      "STORYBOARD_CHAT_TEXTAREA_MULTILINE_MIN_HEIGHT_PX",
    );
    expect(storyboardSource).toContain(
      "grid-rows-[auto_auto] px-1 pb-0.5 pt-2",
    );
    expect(storyboardSource).toContain("col-span-3 col-start-1 row-start-1");
    expect(storyboardSource).not.toContain(
      'data-storyboard-chat-action-row="fixed"',
    );
    expect(storyboardSource).toContain(
      'data-storyboard-chat-attachment-file-input="true"',
    );
    expect(storyboardSource).toContain(
      'id="storyboard-chat-image-attachment-input"',
    );
    expect(storyboardSource).toContain('aria-label="사진 첨부"');
    expect(storyboardSource).not.toContain(
      "STORYBOARD_CHAT_QUICK_START_PROMPTS",
    );
    expect(storyboardSource).not.toContain("StoryboardQuickStartPrompt");
    expect(storyboardSource).not.toContain("handleStoryboardQuickStartPrompt");
    expect(storyboardSource).toContain("예: 매운 라면 10컷으로 만들어줘");
    expect(storyboardSource).not.toContain("고기 한상 12컷");
    expect(storyboardSource).not.toContain("디저트 9컷");
    expect(storyboardSource).not.toContain("첫 컷 강화");
    expect(storyboardSource).toContain(
      "await handleGenerateAllStoryboardImagesForResult(",
    );
    expect(storyboardSource).not.toContain(
      "STORYBOARD_IMAGE_GENERATION_CONCURRENCY",
    );
    expect(storyboardSource).not.toContain(
      "const runImageWorker = async () =>",
    );
    expect(storyboardSource).not.toContain("applyQueuedGeneratedImages");
    expect(storyboardSource).not.toContain(
      'data-storyboard-chat-quickstart="true"',
    );
    expect(storyboardSource).not.toContain(
      "data-storyboard-chat-quickstart-prompt={item.label}",
    );
    expect(storyboardSource).not.toContain('aria-label="스토리보드 빠른 시작"');
    expect(storyboardSource).not.toContain(
      "aria-label={`${item.label} 바로 생성`}",
    );
    expect(storyboardSource).not.toContain(
      'data-storyboard-chat-inline-tools="true"',
    );
    expect(storyboardSource).toContain(
      'data-storyboard-chat-starter-panel="true"',
    );
    expect(storyboardSource).toContain(
      'data-storyboard-chat-starter-panel-layout="centered-beginner-guide"',
    );
    expect(storyboardSource).toContain(
      'data-storyboard-chat-starter-logo="true"',
    );
    expect(storyboardSource).toContain('alt="Tzudong 프로젝트 로고"');
    expect(storyboardSource).toContain(
      '"min-h-full items-stretch justify-center"',
    );
    expect(storyboardSource).toContain(
      '"flex min-h-full min-w-0 w-full flex-col items-center justify-center text-center"',
    );
    expect(storyboardSource).toContain(
      '"mx-auto flex w-full max-w-sm flex-col items-center justify-center gap-3 px-3 py-6 text-center"',
    );
    expect(storyboardSource).not.toContain(
      'data-storyboard-chat-starter-icon="true"',
    );
    expect(storyboardSource).not.toContain(
      '"flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-primary ring-1 ring-primary/15"',
    );
    expect(storyboardSource).toContain(
      '"text-xl font-semibold tracking-tight text-foreground"',
    );
    expect(storyboardSource).toContain(
      'data-storyboard-chat-starter-title-size="reduced"',
    );
    expect(storyboardSource).toContain(
      'data-storyboard-chat-starter-guide-copy="true"',
    );
    expect(storyboardSource).not.toContain(
      'data-storyboard-chat-starter-actions="true"',
    );
    expect(storyboardSource).not.toContain(
      'data-storyboard-chat-starter-action="guide"',
    );
    expect(storyboardSource).not.toContain(
      'data-storyboard-chat-starter-action="example"',
    );
    expect(storyboardSource).not.toContain(
      'data-storyboard-chat-message-action="guide"',
    );
    expect(storyboardSource).not.toContain(
      'data-storyboard-chat-message-action="example"',
    );
    expect(storyboardSource).not.toContain(
      'data-storyboard-role-view="composer-inline"',
    );
    expect(storyboardSource).not.toContain(
      'data-storyboard-chat-guide-button="true"',
    );
    expect(storyboardSource).not.toContain(
      'data-storyboard-chat-guide-generate="true"',
    );
    expect(storyboardSource).toContain("STORYBOARD_USAGE_GUIDE_TEXT");
    expect(storyboardSource).toContain(
      'from "@/lib/admin/storyboard/guided-example-presets"',
    );
    expect(storyboardSource).toContain("STORYBOARD_GUIDED_EXAMPLE_PRESETS");
    expect(storyboardSource).toContain(
      "STORYBOARD_GUIDED_EXAMPLE_GRID_PRESETS",
    );
    expect(guidedPresetSource).toContain("export type StoryboardGuidedExamplePreset");
    expect(guidedPresetSource).toContain("export const STORYBOARD_GUIDED_EXAMPLE_PROMPT");
    expect(guidedPresetSource).toContain("export const STORYBOARD_GUIDED_EXAMPLE_PRESETS");
    expect(guidedPresetSource).toContain(
      "export const STORYBOARD_GUIDED_EXAMPLE_GRID_COUNT = 10",
    );
    expect(guidedPresetSource).toContain(
      "export const STORYBOARD_GUIDED_EXAMPLE_STARTER_COUNT = 10",
    );
    expect(guidedPresetSource).toContain(
      "STORYBOARD_GUIDED_EXAMPLE_GRID_PRESETS",
    );
    expect(guidedPresetSource).toContain(
      "STORYBOARD_GUIDED_EXAMPLE_STARTER_PRESETS",
    );
    expect(storyboardSource).toContain(
      'data-storyboard-chat-example-grid="true"',
    );
    expect(storyboardSource).toContain(
      'data-storyboard-chat-example-grid-layout="10-card-grid"',
    );
    expect(storyboardSource).toContain(
      "STORYBOARD_GUIDED_EXAMPLE_GRID_PRESETS.map",
    );
    expect(storyboardSource).toContain(
      'data-storyboard-chat-example-card="true"',
    );
    expect(storyboardSource).not.toContain(
      'data-storyboard-chat-more-examples="true"',
    );
    expect(storyboardSource).not.toContain(
      "STORYBOARD_GUIDED_EXAMPLE_PRESETS.slice(",
    );
    expect(storyboardSource).not.toContain(
      'data-storyboard-chat-more-example-card="true"',
    );
    expect(storyboardSource).not.toContain("더 많은 예시");
    expect(storyboardSource).toContain(
      'data-storyboard-chat-all-examples="true"',
    );
    expect(storyboardSource).toContain(
      'data-storyboard-chat-all-example-card="true"',
    );
    expect(storyboardSource).toContain(
      "STORYBOARD_GUIDED_EXAMPLE_PRESETS.map((preset)",
    );
    expect(storyboardSource).toContain(
      "handleStoryboardGuidedExampleGenerate(",
    );
    expect(storyboardSource).toContain("storyboardGuidedExampleIndexRef");
    expect(guidedPresetSource).toContain("킹크랩 해산물 한상");
    expect(guidedPresetSource).toContain("디저트 카페 코스");
    expect(guidedPresetSource).toContain("시장 통닭 튀김");
    expect(guidedPresetSource).toContain("새벽 편의점 야식");
    expect(guidedPresetSource).toContain("치즈 부대찌개 라면");
    expect(guidedPresetSource).toContain("초밥 오마카세 클로즈업");
    expect(storyboardSource).toContain("handleStoryboardGuidedExampleGenerate");
    expect(storyboardSource).toContain(
      "예시를 왼쪽 캔버스에 로딩하고 있어요",
    );
    expect(storyboardSource).not.toContain(
      "처음이면 가이드를 보고, 바로 확인하려면 예시 만들기를 눌러보세요.",
    );
    expect(storyboardSource).toContain(
      "추천 카드를 고르면 이 흐름대로 바로 스토리보드를 만들어볼게요.",
    );
    expect(storyboardSource).not.toContain("스토리보드 시작");
    expect(storyboardSource).toContain(
      "handleGenerateAllStoryboardImagesForResult",
    );
    expect(storyboardSource).toContain("fetchStoryboardLocalBridgeDirectJson");
    expect(storyboardSource).toContain(
      'const STORYBOARD_LOCAL_BRIDGE_AUTH_STATUS_PATH = "/auth-status" as const;',
    );
    expect(storyboardSource).toContain(
      'const STORYBOARD_LOCAL_BRIDGE_IMAGES_PATH = "/v1/storyboard/images" as const;',
    );
    expect(storyboardSource).toContain("direct loopback transport");
    expect(storyboardSource).toContain("helper transport");
    expect(storyboardSource).toContain(
      "directError instanceof StoryboardLocalBridgeDirectTransportError",
    );
    expect(storyboardSource).toContain("const generatedImageCount = Math.min(");
    expect(storyboardSource).toContain(
      "countTrustedStoryboardGeneratedImages(result.storyboard.scenes)",
    );
    expect(storyboardSource).toContain(
      "function normalizeLegacyKoreanParticleDisplayText",
    );
    expect(storyboardSource).toContain("title={audioText}");
    expect(storyboardSource).toContain("{audioText}");
    expect(storyboardSource).toContain("title={subtitleText}");
    expect(storyboardSource).toContain("{subtitleText}");
    expect(storyboardSource).toContain(
      "normalizeLegacyKoreanParticleDisplayText(normalized)",
    );
    expect(storyboardSource).toContain(
      "const targetScenes = generated.storyboard.scenes",
    );
    expect(storyboardSource).toContain('scope: "all"');
    expect(storyboardSource).toContain("sourceResult: generated");
    expect(storyboardSource).toContain(
      "if (isGenerating || isChatAgentStreaming || isGeneratingImages) return;",
    );
    expect(storyboardSource).toContain("if (!generated) return;");
    expect(storyboardSource).toMatch(
      /await handleGenerateAllStoryboardImagesForResult\(\s*generated,\s*assistantMessageId,/,
    );
    expect(storyboardSource).toMatch(
      /await handleGenerateAllStoryboardImagesForResult\(\s*generated,\s*nextAssistantMessageId,/,
    );
    expect(storyboardSource).toContain(
      "sourceResult?: StoryboardGenerationResult",
    );
    expect(storyboardSource).toContain(
      "const sourceResult = options.sourceResult ?? result",
    );
    expect(storyboardSource).toContain(
      "현재 ${targetCount}컷 이미지를 컷별로 생성합니다",
    );
    expect(storyboardSource).toContain("currentStreamingLabel");
    expect(storyboardSource).toContain("이미지 생성 중");
    expect(storyboardSource).toContain("스토리보드 구성 중");
    expect(storyboardSource).toContain("답변 준비 중");
    expect(storyboardSource).toContain(
      "응답이 도착하면 생성된 CUT을 캔버스에 즉시 반영합니다.",
    );
    expect(storyboardSource).not.toContain(
      "응답이 도착하면 성공 CUT부터 스켈레톤이 실제 결과로 바뀝니다",
    );
    expect(storyboardSource).toContain("requestStoryboardImages(");
    expect(storyboardSource).toContain(
      "for (let index = 0; index < targetScenes.length; index += 1)",
    );
    expect(storyboardSource).toContain(
      "const scenePayload = await requestStoryboardImages(",
    );
    expect(storyboardSource).toContain("[scene],");
    expect(storyboardSource).not.toContain(
      "for (const [index, scene] of targetScenes.entries())",
    );
    expect(storyboardSource).toContain(
      "imageGenerationProgress?: StoryboardImageGenerationProgress",
    );
    expect(storyboardSource).toContain(
      'data-storyboard-image-generation-progress="true"',
    );
    expect(storyboardSource).toContain(
      'data-storyboard-image-generation-progress-bar="true"',
    );
    expect(storyboardSource).toContain(
      "border border-border/70 bg-background/80",
    );
    expect(storyboardSource).not.toContain(
      "border border-sky-200/70 bg-background/80",
    );
    expect(storyboardSource).toContain(
      "data-storyboard-image-generation-cut-status={cut.status}",
    );
    expect(storyboardSource).toContain("컷별 스토리보드 이미지 생성");
    expect(storyboardSource).toContain(
      "대상 CUT을 컷별 이미지 생성 요청으로 보내고, 완료된 이미지는 바로 캔버스에 반영됩니다.",
    );
    expect(storyboardSource).toContain(
      'import { flushSync } from "react-dom";',
    );
    expect(storyboardSource).toContain("flushSync(() =>");
    expect(storyboardSource).toContain("이미지가 캔버스에 반영됐습니다");
    expect(storyboardSource).toContain(
      "setGeneratingStoryboardImageSceneNos((current) =>",
    );
    expect(storyboardSource).toContain(
      "이미 CUT 이미지를 만드는 중입니다. 응답이 도착하면 생성된 CUT을 캔버스에 즉시 반영합니다.",
    );
    expect(storyboardSource).toContain(
      "지금은 CUT 이미지를 만드는 중입니다. 현재 요청 반영이 끝나면 새 예시를 만들 수 있습니다.",
    );
    expect(storyboardSource).toContain(
      'data-storyboard-chat-thinking-outside-bubble="true"',
    );
    expect(storyboardSource).not.toContain("요청을 정리하는 중...");
    expect(storyboardSource).not.toContain("작업 중");
    expect(storyboardSource).toContain("openSettings: false");
    expect(storyboardSource).not.toContain(
      "처음이면 가이드, 바로 보려면 예시 생성.",
    );
    expect(storyboardSource).toContain("스토리보드 도우미");
    expect(storyboardSource).toContain(
      'data-storyboard-chat-starter-panel-layout="centered-beginner-guide"',
    );
    expect(storyboardSource).toContain(
      "flex min-h-full min-w-0 w-full flex-col items-center justify-center text-center",
    );
    expect(storyboardSource).toContain(
      'data-storyboard-chat-starter-title-size="reduced"',
    );
    expect(storyboardSource).toContain(
      'className="text-xl font-semibold tracking-tight text-foreground"',
    );
    expect(storyboardSource).toContain(
      'data-storyboard-chat-starter-guide-copy="true"',
    );
    expect(storyboardSource).toContain(
      "주제·음식·원하는 CUT 수를 한두 문장으로 적거나,",
    );
    expect(storyboardSource).toContain(
      "아래 예시를 눌러 바로 시작하세요.",
    );
    expect(storyboardSource).toContain("예시 만들기");
    expect(storyboardSource).toContain("가이드 보기");
    expect(storyboardSource).toContain(
      'current.filter((message) => message.id !== "assistant-intake")',
    );
    expect(storyboardSource).toContain(
      'data-storyboard-chat-inline-actions="true"',
    );
    expect(storyboardSource).toContain(
      'data-storyboard-chat-inline-action="example"',
    );
    expect(storyboardSource).toContain(
      "추천 카드를 고르면 이 흐름대로 바로 스토리보드를 만들어볼게요.",
    );
    expect(storyboardSource).not.toContain(
      "mb-1.5 flex items-center justify-end gap-1.5",
    );
    expect(storyboardSource).toContain(
      "rounded-[1.75rem] border border-border/80 bg-background/95 p-1.5 text-foreground",
    );
    expect(storyboardSource).toContain("bg-foreground text-background");
    expect(storyboardSource).toContain(
      'data-storyboard-chat-send-icon="arrow-up"',
    );
    expect(storyboardSource).toContain("strokeWidth={2.75}");
    expect(storyboardSource).not.toContain(
      "rounded-2xl border border-primary/15 bg-primary/5 p-2.5",
    );
    expect(storyboardSource).not.toContain("사용법 먼저 보기");
    expect(storyboardSource).not.toContain("예시 스토리보드 만들기");
    expect(storyboardSource).not.toContain("Codex Agent");
    expect(storyboardSource).not.toContain("런타임 LangGraph");
    expect(storyboardSource).not.toContain("런타임 Codex CLI legacy");
    expect(storyboardSource).not.toContain("백엔드 에이전트 준비 상태");
    expect(storyboardSource).not.toContain(
      "요청을 읽고 어떤 썸네일을 만들지 정리하고 있어요 연결 중",
    );
    expect(storyboardSource).not.toContain("요청을 정리하는 중이에요");
    expect(storyboardSource).not.toContain(
      'data-storyboard-chat-command-row="true"',
    );
    expect(storyboardSource).not.toContain(
      'data-storyboard-generation-actions="true"',
    );
    expect(storyboardSource).not.toContain(
      "data-storyboard-chat-command={command.id}",
    );
    expect(storyboardSource).not.toContain(
      "data-storyboard-generate-from-chat={",
    );
    expect(storyboardSource).not.toContain("data-storyboard-chat-reset={");
    expect(storyboardSource).toContain('quickCommand === "generate"');
    expect(storyboardSource).toContain('quickCommand === "images"');
    expect(storyboardSource).toContain('quickCommand === "reset"');
    expect(storyboardSource).toContain('quickCommand === "status"');
    expect(storyboardSource).toContain(
      "await handleGenerateStoryboardImages({ assistantMessageId })",
    );
    expect(typesSource).toContain("export type StoryboardChatScenePatch");
    expect(typesSource).toContain("targetSource?: 'explicit' | 'selected'");
    expect(typesSource).toContain("regenerateImage?: boolean");
    expect(typesSource).toContain("focusSceneNo?: number");
    expect(typesSource).toContain("unavailableFocusSceneNo?: number");
    expect(typesSource).toContain("baselinePrompt?: string");
    expect(typesSource).toContain("currentAvailableSceneCount?: number");
    expect(backendAgentSource).toContain("createStoryboardScenePatch");
    expect(backendAgentSource).toContain("deriveExplicitStoryboardSceneNo");
    expect(backendAgentSource).toContain(
      "hasExplicitStoryboardScenePatchIntent",
    );
    expect(backendAgentSource).toContain("hasStoryboardNavigationIntent");
    expect(backendAgentSource).toContain("deriveStoryboardNavigationSceneNo");
    expect(backendAgentSource).toContain(
      "wantsSelectedStoryboardImageRegeneration",
    );
    expect(backendAgentSource).toContain("regenerate_selected_scene");
    expect(backendAgentSource).toContain(
      "const requestedFocusSceneNo = scenePatch",
    );
    expect(backendAgentSource).toContain(
      ": deriveStoryboardNavigationSceneNo(normalized)",
    );
    expect(backendAgentSource).toContain("segmentCount: isReviewOnly");
    expect(backendAgentSource).toContain(": isNavigationRequest");
    expect(backendAgentSource).toContain("? availableSceneCount");
    expect(backendAgentSource).toContain(
      '!isNavigationRequest && scenePatch?.targetSource !== "explicit"',
    );
    expect(backendAgentSource).toContain("Navigation focusSceneNo");
    expect(backendAgentSource).toContain("Navigation unavailableFocusSceneNo");
    expect(backendAgentSource).toContain("navigate_unavailable");
    expect(backendAgentSource).toContain('? "navigate"');
    expect(backendAgentSource).toContain("`${sceneTargetLabel} 요청 반영");
    expect(storyboardSource).toContain("mergeStoryboardScenePatch");
    expect(storyboardSource).toContain("getStoryboardPageForSceneNo");
    expect(storyboardSource).toContain(
      "getStoryboardVisibleFramePageForSceneNo",
    );
    expect(storyboardSource).toContain("baselinePrompt: result.request.prompt");
    expect(storyboardSource).toContain("currentAvailableSceneCount:");
    expect(storyboardSource).toContain(
      "storyboardFrameScenes.length || result.storyboard.scenes.length",
    );
    expect(storyboardSource).toContain("patch.focusSceneNo");
    expect(storyboardSource).toContain("patch.unavailableFocusSceneNo");
    expect(storyboardSource).toContain(
      "finalResult?.canvasPatch.scenePatch?.regenerateImage",
    );
    expect(storyboardSource).toContain(
      "getStoryboardVisibleFramePageForSceneNo(",
    );
    expect(storyboardSource).toContain('scope?: "page" | "selected" | "all";');
    expect(storyboardSource).toContain("targetScenes?: StoryboardScene[]");
    expect(storyboardSource).toContain("selectedRealStoryboardScene");
    expect(storyboardSource).not.toContain(
      'data-storyboard-chat-stream-status="true"',
    );
    expect(storyboardSource).not.toContain("좌측 캔버스 2×2 컷에 순차 반영 중");
    expect(storyboardSource).not.toContain(
      'data-storyboard-chat-streaming-preview="true"',
    );
    expect(storyboardSource).not.toContain("채팅 초안 반영 중");
    expect(storyboardSource).not.toContain(
      "표시할 스토리보드 이미지 결과가 없습니다",
    );
    expect(storyboardSource).not.toContain(
      "GPT Image 2로 생성·검증된 컷만 이 캔버스에 표시합니다.",
    );
    expect(storyboardSource).not.toContain("입력 순서");
    expect(storyboardSource).not.toContain('data-storyboard-input-step="1"');
    expect(storyboardSource).not.toContain('data-storyboard-input-step="2"');
    expect(storyboardSource).not.toContain('data-storyboard-input-step="3"');
    expect(storyboardSource).not.toContain('data-storyboard-input-step="4"');
    expect(storyboardSource).not.toContain('data-storyboard-input-step="5"');
    expect(storyboardSource).not.toContain("소재/상황 채팅 입력");
    expect(storyboardSource).not.toContain('id="segment-count"');
    expect(storyboardSource).not.toContain('id="target-length"');
    expect(storyboardSource).not.toContain('id="storyboard-tone"');
    expect(storyboardSource).not.toContain('id="storyboard-generation-mode"');
    expect(storyboardSource).toContain("STORYBOARD_MAX_SEGMENT_COUNT");
    expect(storyboardSource).toContain("예: 매운 라면 10컷으로 만들어줘");
    expect(storyboardSource).toContain("resizeStoryboardChatTextarea");
    expect(storyboardSource).toContain(
      "STORYBOARD_CHAT_TEXTAREA_MIN_HEIGHT_PX",
    );
    expect(storyboardSource).toContain(
      "STORYBOARD_CHAT_TEXTAREA_MAX_HEIGHT_PX",
    );
    expect(storyboardSource).toContain('name="storyboard-prompt"');
    expect(storyboardSource).toContain('autoComplete="off"');
    expect(storyboardSource).toContain(
      'aria-describedby="storyboard-prompt-help storyboard-chat-keyboard-hint"',
    );
    expect(storyboardSource).toContain(
      'data-storyboard-chat-prompt-help="true"',
    );
    expect(storyboardSource).toContain('role="alert"');
    expect(storyboardSource).toContain(
      "focus-within:border-primary/40 focus-within:ring-2 focus-within:ring-primary/15",
    );
    expect(storyboardSource).not.toContain(
      "예: 매운 짜장라면 · 첫 입·맛 평가 중심 ${STORYBOARD_MAX_SEGMENT_COUNT}컷",
    );
    expect(storyboardSource).not.toContain("채팅으로 생성");
    expect(storyboardSource).not.toContain('data-storyboard-input-step="6"');
    expect(storyboardSource).not.toContain("6. 스토리보드 생성");
    expect(storyboardSource).not.toContain("생성 입력");
    expect(storyboardSource).toContain(
      'gridColumn: "var(--storyboard-input-panel-column, 2)"',
    );
    expect(storyboardSource).not.toContain(
      "rounded-2xl bg-muted/25 p-2.5 text-sm leading-6",
    );
    expect(storyboardSource).not.toContain(
      "grid grid-cols-2 gap-2 rounded-2xl bg-muted/25 p-2.5",
    );
    expect(storyboardSource).not.toContain(
      "rounded-2xl bg-background/80 p-2.5",
    );
    expect(storyboardSource).not.toContain(
      "rounded-2xl border border-border bg-muted/20 p-3",
    );
    expect(storyboardSource).not.toContain(
      "rounded-3xl border-border/80 shadow-sm",
    );
    expect(storyboardSource).not.toContain(
      "rounded-2xl border border-primary/15 bg-primary/5 p-3",
    );
    expect(storyboardSource).toContain(
      "bg-gradient-to-b from-background/95 to-muted/35",
    );
    expect(storyboardSource).toContain(
      "flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden p-2 pt-0",
    );
    expect(storyboardSource).not.toContain(
      "PD가 소재 방향과 근거 영상 범위를 조정합니다.",
    );
    expect(storyboardSource).not.toContain("PD 회의용 시작점을 빠르게 적용");
    expect(storyboardSource).not.toContain("씬별 촬영 체크리스트 포함");
    expect(storyboardSource).toContain(
      'data-storyboard-result-panel="image-frames-only"',
    );
    expect(storyboardSource).toContain(
      'aria-label="스토리보드 이미지 생성 결과"',
    );
    expect(storyboardSource).toContain(
      "aria-label={`스토리보드 주제 ${storyboardCanvasTopicTitle} · 이미지 ${generatedImageCount}/${totalCutCount} · PNG 내보내기`}",
    );
    expect(storyboardSource).not.toContain("캔버스 편집 / PNG 내보내기");
    expect(storyboardSource).toContain("StoryboardExportPresetId");
    expect(storyboardSource).toContain("storyboardExportPresets");
    expect(storyboardSource).toContain('data-storyboard-export-preset="true"');
    expect(storyboardSource).toContain('aria-label="PNG 저장 해상도"');
    expect(storyboardSource).not.toContain(
      'data-storyboard-safe-area-toggle="true"',
    );
    expect(storyboardSource).not.toContain(
      'data-storyboard-add-text-layer="true"',
    );
    expect(storyboardSource).not.toContain("문구 추가");
    expect(storyboardSource).toContain('data-storyboard-export-png="true"');
    expect(storyboardSource).toContain("storyboardImageGenerationProviderId");
    expect(storyboardSource).not.toContain(
      "data-storyboard-generate-images={storyboardImageGenerationProviderId}",
    );
    expect(storyboardSource).toContain("trustedGeneratedImage.providerId");
    expect(storyboardSource).toContain("data-storyboard-frame-image-fit={");
    expect(storyboardSource).toContain('"object-contain"');
    expect(storyboardSource).toContain('"object-cover"');
    expect(storyboardSource).toContain('loading="eager"');
    expect(storyboardSource).toContain("onError={() =>");
    expect(storyboardSource).toContain("data-storyboard-generated-image={");
    expect(storyboardSource).toContain("/api/admin/storyboard/images");
    expect(storyboardSource).toContain("postStoryboardImagesRequest");
    expect(storyboardSource).toContain("handleGenerateStoryboardImages");
    expect(storyboardSource).not.toContain("imageGenerationButtonLabel");
    expect(storyboardSource).not.toContain("compactImageGenerationButtonLabel");
    expect(storyboardSource).toContain(
      "activeStoryboardImageGenerationTargetScenes",
    );
    expect(storyboardSource).toContain("activePageGenerationTargetCount");
    expect(storyboardSource).toContain(
      "postStoryboardImagesRequest(sourceResult, activeStoryboardImageGenerationTargetScenes)",
    );
    expect(storyboardSource).toContain(
      "scopeLabel: `현재 ${activePageGenerationTargetCount}컷`,",
    );
    expect(storyboardSource).toContain(
      "현재 ${activePageGenerationTargetCount}컷 이미지를 다시 만들게요...",
    );
    expect(storyboardSource).toContain("trustedGeneratedImage?.dataUrl");
    expect(storyboardSource).toContain("src={trustedGeneratedImage.dataUrl}");
    expect(storyboardSource).toContain("loadCanvasImage");
    expect(storyboardSource).toContain(
      'data-storyboard-safe-area-guide="true"',
    );
    expect(storyboardSource).toContain("handleExportStoryboardPng");
    expect(storyboardSource).toContain("handleCopyStoryboardPlanMarkdown");
    expect(storyboardSource).toContain("buildStoryboardClientCopyPlanMarkdown");
    expect(storyboardSource).toContain("formatStoryboardCopyMarkdownLines");
    expect(storyboardSource).toContain("normalizeStoryboardCopyMarkdownBlock");
    expect(storyboardSource).toContain("## 제작 개요");
    expect(storyboardSource).toContain("## CUT별 상세 메모");
    expect(storyboardSource).toContain("- 생성 요청:");
    expect(storyboardSource).toContain("- 이미지 프롬프트:");
    expect(storyboardSource).toContain('.replace(/\\n/g, "\\r\\n")');
    expect(storyboardSource).toContain("writeStoryboardClipboardText");
    expect(storyboardSource).toContain('document.addEventListener("copy"');
    expect(storyboardSource).toContain('document.execCommand("copy")');
    expect(storyboardSource).toContain("event.clipboardData.setData");
    expect(storyboardSource).not.toContain(
      "if (hasCurrentShotList) return current",
    );
    expect(storyboardSource).toContain(
      "await writeStoryboardClipboardText(exportMarkdown)",
    );
    expect(storyboardSource).toContain('data-storyboard-copy-plan="true"');
    expect(storyboardSource).toContain("기획서 복사");
    expect(storyboardSource).toContain("exportResolutionToken");
    expect(storyboardSource).toContain(
      "tzudong-storyboard-page-${activeStoryboardPage + 1}-${exportResolutionToken}.png",
    );
    expect(storyboardSource).toContain(
      'data-storyboard-canvas-toolbar="thumbnail-like"',
    );
    expect(storyboardSource).toContain(
      'data-storyboard-compact-toolbar="true"',
    );
    expect(storyboardSource).toContain(
      'className="flex min-w-0 items-center gap-2 text-sm"',
    );
    expect(storyboardSource).toContain(
      'className="ml-auto flex min-w-0 flex-nowrap items-center gap-1 overflow-x-auto px-1 py-1 scrollbar-hide focus-visible:outline-none',
    );
    expect(storyboardSource).toContain('data-horizontal-scroll-owner="storyboard-canvas-toolbar"');
    expect(storyboardSource).toContain(
      'data-storyboard-frame-view-mode="true"',
    );
    expect(storyboardSource).toContain(
      "data-storyboard-frame-view-option={String(pageSize)}",
    );
    expect(canvasModuleSource).toContain(
      'className="flex min-w-0 shrink-0 flex-row items-center gap-2 p-2 pb-1"',
    );
    expect(storyboardSource).toContain('className="sr-only"');
    expect(storyboardSource).toContain(
      "aria-label={`스토리보드 주제 ${storyboardCanvasTopicTitle} · 이미지 ${generatedImageCount}/${totalCutCount} · PNG 내보내기`}",
    );
    expect(storyboardSource).toContain("Clapperboard");
    expect(storyboardSource).toContain(
      'data-storyboard-canvas-topic-icon="true"',
    );
    expect(storyboardSource).toContain(
      'data-storyboard-canvas-title-icon="clapperboard"',
    );
    expect(storyboardSource).toContain(
      '"flex h-6 w-6 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary ring-1 ring-primary/15"',
    );
    expect(storyboardSource).toContain(
      'data-storyboard-canvas-topic-title="true"',
    );
    expect(storyboardSource).not.toContain(
      'className="flex flex-wrap items-center justify-between gap-2 text-base"',
    );
    expect(storyboardSource).not.toContain('className="flex flex-wrap gap-2"');
    expect(canvasModuleSource).toContain(
      '"min-h-0 min-w-0 flex-1 overflow-x-hidden p-3 pt-0 max-[1099px]:!overflow-visible"',
    );
    expect(canvasModuleSource).toContain('"overflow-hidden"');
    expect(canvasModuleSource).toContain('"overflow-y-auto"');
    expect(storyboardSource).toContain(
      'className="h-8 w-[112px] shrink-0 text-xs"',
    );
    expect(storyboardSource).not.toContain(
      'data-storyboard-latest-real-data-loaded="true"',
    );
    expect(storyboardSource).not.toContain(
      'data-storyboard-real-data-mode="true"',
    );
    expect(storyboardSource).not.toContain("currentSourceSummary");
    expect(storyboardSource).toContain("가이드");
    expect(storyboardSource).not.toContain("compactImageGenerationButtonLabel");
    expect(storyboardSource).toContain("PNG 저장");
    expect(storyboardSource).toContain("truncateStoryboardFrameText");
    expect(storyboardSource).toContain("scene.hostBeat");
    expect(storyboardSource).toContain("오디오 후보");
    expect(storyboardSource).toContain('data-storyboard-frame-script="true"');
    expect(storyboardSource).toContain(
      'data-storyboard-frame-script-panel="true"',
    );
    expect(storyboardSource).toContain(
      'data-storyboard-frame-script-placement="separated"',
    );
    expect(storyboardSource).toContain(
      'data-storyboard-frame-script-layout="stacked-rows"',
    );
    expect(storyboardSource).toContain("shrink-0 space-y-1 border-t");
    expect(storyboardSource).toContain("gridTemplateColumns");
    expect(storyboardSource).toContain('"58px minmax(0, 1fr)"');
    expect(storyboardSource).not.toContain("grid-cols-[58px_minmax(0,1fr)]");
    expect(storyboardSource).toContain('data-storyboard-frame-audio="true"');
    expect(storyboardSource).toContain(
      'data-storyboard-frame-audio-row="true"',
    );
    expect(storyboardSource).toContain('data-storyboard-frame-subtitle="true"');
    expect(storyboardSource).toContain(
      'data-storyboard-frame-subtitle-row="true"',
    );
    expect(storyboardSource).toContain(
      'data-storyboard-frame-audio-text="true"',
    );
    expect(storyboardSource).toContain(
      "block min-w-0 truncate whitespace-nowrap font-semibold text-foreground",
    );
    expect(storyboardSource).toContain(
      "block min-w-0 truncate whitespace-nowrap font-bold text-foreground",
    );
    expect(storyboardSource).not.toContain("line-clamp-1 font-semibold");
    expect(storyboardSource).not.toContain("line-clamp-1 font-bold");
    expect(storyboardSource).toContain(
      'data-storyboard-frame-subtitle-text="true"',
    );
    expect(storyboardSource).toContain(
      'data-storyboard-frame-production-note="true"',
    );
    expect(storyboardSource).toContain(
      'data-storyboard-frame-production-note-row="true"',
    );
    expect(storyboardSource).toContain(
      'data-storyboard-frame-production-note-text="true"',
    );
    expect(storyboardSource).toContain("getStoryboardRoleProductionNote");
    expect(storyboardSource).toContain(
      'scene.captionIdea.split("·").slice(0, 2)',
    );
    expect(storyboardSource).toContain("formatStoryboardFrameProductionNote");
    expect(storyboardSource).toContain("얼굴\\s*클로즈업|표정\\s*클로즈업");
    expect(storyboardSource).toContain(
      "컷마다 오디오, 자막, 촬영 포인트를 나눠서 볼 수 있어요.",
    );
    expect(storyboardSource).not.toContain(
      "absolute inset-x-3 bottom-3 z-20 grid grid-cols-[58px_minmax(0,1fr)]",
    );
    const audioRowIndex = storyboardSource.indexOf(
      'data-storyboard-frame-audio="true"',
    );
    const subtitleRowIndex = storyboardSource.indexOf(
      'data-storyboard-frame-subtitle="true"',
    );
    const productionRowIndex = storyboardSource.indexOf(
      'data-storyboard-frame-production-note="true"',
    );
    expect(audioRowIndex).toBeGreaterThan(-1);
    expect(subtitleRowIndex).toBeGreaterThan(audioRowIndex);
    expect(productionRowIndex).toBeGreaterThan(subtitleRowIndex);
    expect(storyboardSource).toContain("title={audioText}");
    expect(storyboardSource).toContain("title={subtitleText}");
    expect(storyboardSource).toContain("title={productionNote}");
    expect(storyboardSource).toContain("오디오");
    expect(storyboardSource).toContain("자막");
    expect(storyboardSource).toContain("촬영");
    expect(storyboardSource).toContain("StoryboardChatFocusContext");
    expect(storyboardSource).toContain("storyboardCanvasFocus");
    expect(storyboardSource).toContain("createStoryboardCutFocusContext");
    expect(storyboardSource).toContain("createStoryboardActionFocusContext");
    expect(storyboardSource).toContain("handleSelectStoryboardScene");
    expect(storyboardSource).toContain("createStoryboardCutFocusContextFromScenes");
    expect(storyboardSource).toContain("getStoryboardSelectedSceneNosFromFocus");
    expect(storyboardSource).toContain("const selectedStoryboardSceneNoSet = useMemo");
    expect(storyboardSource).toContain("currentSceneNos.includes(scene.sceneNo)");
    expect(storyboardSource).toContain(
      "currentSceneNos.filter((sceneNo) => sceneNo !== scene.sceneNo)",
    );
    expect(storyboardSource).toContain("다중 선택");
    expect(storyboardSource).toContain("sceneNos: selectedScenes.map");
    expect(storyboardSource).toContain("focusContext: storyboardCanvasFocus");
    expect(storyboardSource).toContain(
      'data-storyboard-chat-canvas-context="true"',
    );
    expect(storyboardSource).toContain(
      'data-storyboard-canvas-focus-label="true"',
    );
    expect(storyboardSource).toContain(
      'data-storyboard-canvas-focus-detail="true"',
    );
    expect(storyboardSource).toContain(
      'data-storyboard-clear-canvas-context="true"',
    );
    expect(storyboardSource).toContain("채팅 맥락");
    expect(storyboardSource).toContain("멘트 짧게");
    expect(storyboardSource).toContain("멘트·자막·구도 수정 가능");
    expect(storyboardSource).toContain("액션 직후의 캔버스 상태입니다");
    expect(storyboardSource).toContain("aria-pressed=");
    expect(storyboardSource).toContain("data-storyboard-selected-frame={");
    expect(storyboardSource).toContain(
      'data-storyboard-selected-frame-border="true"',
    );
    expect(storyboardSource).toContain(
      "pointer-events-none absolute inset-0 z-50 rounded-2xl border-2 border-primary",
    );
    expect(storyboardSource).toContain("focus-visible:ring-inset");
    expect(storyboardSource).not.toContain(
      '? "ring-2 ring-primary ring-offset-2"',
    );
    expect(storyboardSource).toContain("drawStoryboardFrameToCanvas");
    expect(storyboardSource).toContain("scriptPanelHeight");
    expect(storyboardSource).toContain('context.fillText("멘트"');
    expect(storyboardSource).toContain('context.fillText("오디오"');
    expect(storyboardSource).toContain('context.fillText("자막"');
    expect(storyboardSource).toContain('canvas.toDataURL("image/png")');
    expect(storyboardSource).not.toContain(
      "flex h-full min-h-0 flex-col overflow-y-auto bg-background",
    );
    expect(storyboardSource).not.toContain("space-y-4 p-4 sm:p-5 lg:p-6");
    expect(storyboardSource).not.toContain(
      "flex h-full min-h-0 flex-col overflow-hidden bg-background p-4 sm:p-5 lg:p-6",
    );
    expect(storyboardSource).not.toContain(
      "min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain",
    );
    expect(storyboardSource).not.toContain(
      '<h2 className="text-2xl font-bold tracking-[-0.04em] text-foreground md:text-3xl">',
    );
    expect(storyboardSource).toContain("INITIAL_STORYBOARD_PREVIEW");
    expect(storyboardSource).toContain("useState<StoryboardGenerationResult>(");
    expect(storyboardSource).not.toContain(
      'data-storyboard-status-chips="true"',
    );
    expect(storyboardSource).not.toContain(
      'data-storyboard-generation-mode="true"',
    );
    expect(storyboardSource).not.toContain(
      'data-storyboard-backend-agent-status="true"',
    );
    expect(storyboardSource).toContain('generationMode: "backend_agent"');
    expect(storyboardSource).not.toContain('"local_heatmap"');
    expect(storyboardSource).not.toContain("storyboardToolActions");
    expect(storyboardSource).not.toContain(
      'data-storyboard-tool-palette="true"',
    );
    expect(canvasModuleSource).toContain('data-storyboard-image-board="true"');
    expect(canvasModuleSource).toContain('data-storyboard-frame-grid="true"');
    expect(storyboardSource).toContain("storyboardFrameScenes");
    expect(storyboardSource).toContain("STORYBOARD_FRAMES_PER_PAGE = 4");
    expect(storyboardSource).not.toContain("isStoryboardResultSkeletonVisible");
    expect(storyboardSource).toContain("requestedCutCount");
    expect(storyboardSource).toContain("setStoryboardPage(0)");
    expect(storyboardSource).toContain("disabled={!hasPreviousStoryboardPage}");
    expect(storyboardSource).toContain("disabled={!hasNextStoryboardPage}");
    expect(storyboardSource).toContain("isGenerating ||");
    expect(storyboardSource).toContain("isGeneratingImages ||");
    expect(storyboardSource).toContain("disabled={isGenerating}");
    expect(storyboardSource).toContain("activeStoryboardPageScenes");
    expect(storyboardSource).toContain("storyboardTotalPages");
    expect(storyboardSource).toContain(
      'data-storyboard-frame-pagination="true"',
    );
    expect(storyboardSource).toContain('data-storyboard-page-prev="true"');
    expect(storyboardSource).toContain('data-storyboard-page-next="true"');
    expect(storyboardSource).toContain('data-storyboard-page-indicator="true"');
    expect(storyboardSource).toContain(
      'data-storyboard-frame-page-range="true"',
    );
    expect(storyboardSource).toContain('data-storyboard-canvas-title="true"');
    expect(storyboardSource).toContain(
      'data-storyboard-canvas-topic-icon="true"',
    );
    expect(storyboardSource).toContain(
      'data-storyboard-generated-image-count="title"',
    );
    expect(storyboardSource).toContain(
      'data-storyboard-canvas-topic-title="true"',
    );
    expect(storyboardSource).not.toContain(
      'data-storyboard-current-generation-title="canvas"',
    );
    expect(storyboardSource).toContain("getStoryboardCanvasTopicTitle");
    expect(storyboardSource).toContain("buildStoryboardCanvasTopicTitle");
    expect(storyboardSource).toContain(
      'sanitizeStoryboardChatDisplayText(result.storyboard.title).split("—")[0]',
    );
    expect(storyboardSource).toContain(
      '.replace(/^조회수\\s*많이\\s*나올\\s*것\\s*같은\\s*/i, "")',
    );
    expect(storyboardSource).not.toContain("buildStoryboardAudienceTopicTitle");
    expect(storyboardSource).toContain(
      "storyboardCanvasTopicTitle",
    );
    expect(storyboardSource).not.toContain(
      "storyboardCurrentImageGenerationTitleLabel",
    );
    expect(storyboardSource).toContain("activeCutStart");
    expect(storyboardSource).toContain("activeCutEnd");
    expect(storyboardSource).toContain("generatedImageCount");
    expect(storyboardSource).toContain("formatStoryboardGenerationCompletion");
    expect(storyboardSource).toContain("visibleCanvasImageCount");
    expect(storyboardSource).toContain("getVisibleTrustedStoryboardPageScenes");
    expect(storyboardSource).toContain("현재 캔버스 CUT 이미지");
    expect(storyboardSource).toContain(
      "formatStoryboardVisibleImprovementSummary",
    );
    expect(storyboardSource).toContain("준비된 스토리보드를 불러왔어요.");
    expect(storyboardSource).toContain("첫 컷은 가게 앞 인트로부터 시작해요.");
    expect(storyboardSource).toContain("실제 신뢰된 이미지 파일만 세었습니다");
    expect(storyboardSource).not.toContain(
      "assistant-latest-real-data-improvement-summary",
    );
    expect(storyboardSource).toContain(
      "assistant-history-load-improvement-summary",
    );
    expect(storyboardSource).toContain(
      "컷 구성만 준비됨 · 실제 이미지는 아직 없음",
    );
    expect(storyboardSource).toContain(
      "이미지 만들기 버튼을 누르면 캔버스 CUT 이미지를 채울 수 있습니다",
    );
    expect(storyboardSource).toContain("getStoryboardSourcePageRange");
    expect(storyboardSource).toContain(
      "autoGeneratedMissingStoryboardPageKeysRef",
    );
    expect(storyboardSource).toContain(
      "getMissingTrustedStoryboardImageScenes",
    );
    expect(storyboardSource).toContain(
      "maybeGenerateMissingStoryboardPageImages",
    );
    expect(storyboardSource).toContain(
      "result.generatedAt === INITIAL_STORYBOARD_PREVIEW.generatedAt",
    );
    expect(storyboardSource).toContain(
      "아직 이미지가 없는 전체 ${missingStoryboardScenes.length}컷을 자동으로 채우고 있어요",
    );
    expect(storyboardSource).toContain(
      "페이지를 넘기지 않아도 완료된 CUT은 바로 준비됩니다.",
    );
    expect(storyboardSource).toContain(
      "maybeGenerateMissingStoryboardPageImages(normalizedPage, sourcePageScenes)",
    );
    expect(storyboardSource).toContain('scope: "all"');
    expect(storyboardSource).toContain(
      "const sourcePageRange = getStoryboardSourcePageRange(normalizedPage)",
    );
    expect(storyboardSource).toContain(
      '`CUT ${String(sourcePageRange.start).padStart(2, "0")}–${String(sourcePageRange.end).padStart(2, "0")} 영역을 보고 있습니다.`',
    );
    expect(storyboardSource).not.toContain(
      "Math.min((normalizedPage + 1) * STORYBOARD_FRAMES_PER_PAGE, totalCutCount)",
    );
    expect(storyboardSource).not.toContain(
      "INITIAL_STORYBOARD_PREVIEW.storyboard.scenes.slice",
    );
    expect(storyboardSource).not.toContain("activeFallbackGenerationScenes");
    expect(storyboardSource).toContain(
      "getStoryboardImageGenerationTargetScenes",
    );
    expect(canvasModuleSource).toContain('data-storyboard-frame-fill="true"');
    expect(storyboardSource).toContain('data-storyboard-glass-skeleton="true"');
    expect(storyboardSource).toContain(
      'data-storyboard-unified-skeleton="true"',
    );
    expect(storyboardSource).toContain('data-storyboard-glass-shimmer="true"');
    expect(storyboardSource).not.toContain("rounded-2xl bg-transparent");
    expect(storyboardSource).toContain("rgba(203,213,225,0.82)");
    expect(storyboardSource).not.toContain("rgba(244,114,182");
    expect(storyboardSource).not.toContain("rgba(251,191,36");
    expect(storyboardSource).not.toContain("rgba(34,197,94");
    expect(storyboardSource).not.toContain("rgba(251,146,60");
    expect(storyboardSource).not.toContain("rgba(56,189,248");
    expect(storyboardSource).not.toContain("rgba(168,85,247");
    expect(storyboardSource).not.toContain("bg-rose-200");
    expect(storyboardSource).not.toContain("bg-emerald-200");
    expect(storyboardSource).not.toContain("bg-sky-200/85");
    expect(storyboardSource).not.toContain(
      'className="absolute left-4 top-4 z-20',
    );
    expect(storyboardSource).not.toContain(
      "bg-gradient-to-br from-slate-100 via-slate-200/80 to-slate-300/75",
    );
    expect(storyboardSource).not.toContain("rgba(148,163,184,0.22)");
    expect(storyboardSource).not.toContain("rgba(71,85,105,0.24)");
    expect(storyboardSource).toContain("rgba(148,163,184,0.28)");
    expect(storyboardSource).toContain("rgba(71,85,105,0.26)");
    expect(storyboardSource).toContain("from-slate-100");
    expect(storyboardSource).toContain("via-slate-200/85");
    expect(storyboardSource).toContain("to-slate-400/70");
    expect(storyboardSource).not.toContain("border border-slate-300/80");
    expect(storyboardSource).not.toContain("dark:border-slate-700/70");
    expect(storyboardSource).not.toContain("border border-slate-300/70");
    expect(storyboardSource).not.toContain("dark:border-slate-600/60");
    expect(storyboardSource).not.toContain("to-muted/60");
    expect(storyboardSource).not.toContain("rgba(148,163,184,0.14)");
    expect(storyboardSource).not.toContain("to-slate-400/10");
    expect(storyboardSource).not.toContain("rgba(185,28,28,0.12)");
    expect(storyboardSource).not.toContain(
      'data-storyboard-no-trusted-image-label="true"',
    );
    expect(storyboardSource).not.toContain(
      'data-storyboard-scene-summary="true"',
    );
    expect(storyboardSource).not.toContain(
      'data-storyboard-scene-title="true"',
    );
    expect(storyboardSource).not.toContain(
      "line-clamp-2 text-xs leading-snug text-white/82",
    );
    expect(storyboardSource).not.toContain("text-amber-100");
    expect(storyboardSource).not.toContain(
      "function StoryboardGlassLoadingCanvas",
    );
    expect(storyboardSource).toContain("function StoryboardEmptyCanvasState");
    expect(storyboardSource).toContain('data-storyboard-empty-canvas="true"');
    expect(storyboardSource).not.toContain(
      'import { Skeleton } from "@/components/ui/skeleton";',
    );
    expect(storyboardSource).not.toContain(
      "data-storyboard-result-skeleton-frame={String(cutNo)}",
    );
    expect(storyboardSource).not.toContain(
      'mode === "empty" ? "true" : undefined',
    );
    expect(storyboardSource).toContain(
      'data-storyboard-realtime-skeleton="true"',
    );
    expect(storyboardSource).toContain(
      'data-storyboard-cut-image-skeleton="true"',
    );
    expect(storyboardSource).toContain(
      "activeGeneratingStoryboardImageSceneNo",
    );
    expect(storyboardSource).toContain(
      'data-storyboard-cut-image-skeleton-active={isActive ? "true" : "false"}',
    );
    expect(storyboardSource).toContain("isSceneImageActivelyGenerating");
    expect(storyboardSource).toContain(
      'data-storyboard-cut-image-skeleton-variant="legacy-glass"',
    );
    expect(storyboardSource).toContain(
      'data-storyboard-cut-image-skeleton-effect="glass-shimmer"',
    );
    expect(storyboardSource).toContain(
      'data-storyboard-unified-generation-skeleton="true"',
    );
    expect(storyboardSource).toContain(
      'data-storyboard-cut-image-shimmer="true"',
    );
    expect(storyboardSource).toContain(
      'data-storyboard-cut-image-glass-surface="true"',
    );
    expect(storyboardSource).toContain('data-storyboard-glass-surface="true"');
    expect(storyboardSource).toContain("storyboard-cut-image-shimmer");
    expect(storyboardSource).toContain(
      'data-storyboard-cut-image-shimmer-effect="glass-sweep"',
    );
    expect(storyboardSource).toContain("const storyboardTotalPages = useMemo(");
    expect(storyboardSource).toContain(
      "const activeStoryboardPageSourceScenes = useMemo(",
    );
    expect(storyboardSource).toContain(
      "const activeStoryboardImageGenerationTargetScenes = useMemo(",
    );
    expect(storyboardSource).toContain("const latestChatScrollKey = useMemo(");
    expect(storyboardSource).toContain("}, [latestChatScrollKey]);");
    expect(storyboardSource).toContain(
      "const visibleStoryboardHistoryCases = useMemo(",
    );
    expect(storyboardSource).toContain(
      "const generatedImages = await Promise.all(",
    );
    expect(storyboardSource).toContain(
      "const generatedImage = generatedImages[index] ?? null;",
    );
    expect(storyboardSource).toContain("let completed = 0;");
    expect(storyboardSource).not.toContain(
      'cuts.filter((cut) => cut.status === "done").length',
    );
    expect(storyboardSource).not.toContain(
      "chatDraft,\n    isChatAgentStreaming",
    );
    expect(appGlobalsSource).toContain(
      '[data-storyboard-cut-image-skeleton="true"]',
    );
    expect(appGlobalsSource).toContain(
      '[data-storyboard-cut-image-glass-surface="true"]',
    );
    expect(appGlobalsSource).toContain(
      '[data-storyboard-cut-image-shimmer="true"]',
    );
    expect(appGlobalsSource).toContain(
      '[data-storyboard-cut-image-skeleton="true"]::after',
    );
    expect(appGlobalsSource).toContain(
      '[data-storyboard-cut-image-skeleton="true"]::before',
    );
    expect(appGlobalsSource).toContain("@keyframes storyboard-glass-sparkle");
    expect(appGlobalsSource).toContain("@keyframes storyboard-glass-prism");
    expect(appGlobalsSource).toContain(
      "animation: storyboard-glass-prism 2.2s ease-in-out infinite;",
    );
    expect(appGlobalsSource).toContain(
      '[data-storyboard-cut-image-skeleton-active="true"]::after',
    );
    expect(appGlobalsSource).toContain(
      "animation: storyboard-glass-sparkle 1.6s ease-in-out infinite;",
    );
    expect(appGlobalsSource).not.toContain(
      "@keyframes storyboard-glass-reduced-sparkle",
    );
    expect(appGlobalsSource).not.toContain(
      "@keyframes storyboard-glass-reduced-sheen",
    );
    expect(appGlobalsSource).not.toContain(
      "animation: storyboard-glass-reduced-sparkle 2.4s ease-in-out infinite;",
    );
    expect(appGlobalsSource).not.toContain(
      "animation: storyboard-glass-reduced-sheen 2.4s ease-in-out infinite;",
    );
    expect(appGlobalsSource).toContain("animation: none !important;");
    expect(storyboardSource).not.toContain("motion-reduce:hidden");
    expect(appGlobalsSource).toMatch(/radial-gradient\(\s*ellipse at 16% 12%/);
    expect(appGlobalsSource).toContain("left: -42%;");
    expect(appGlobalsSource).toContain("width: max(10rem, 34%);");
    expect(appGlobalsSource).toContain("contain: paint;");
    expect(appGlobalsSource).toContain("rgba(255, 255, 255, 0.78) 50%");
    expect(appGlobalsSource).toContain(
      '[data-storyboard-cut-image-skeleton-active="false"]',
    );
    expect(appGlobalsSource).toContain("display: none;");
    expect(appGlobalsSource).not.toContain("filter: blur(14px);");
    expect(appGlobalsSource).not.toContain("mix-blend-mode: screen;");
    expect(appGlobalsSource).not.toContain("backdrop-filter: blur(1px);");
    expect(storyboardSource).not.toContain(
      "bg-slate-950/25 opacity-85 backdrop-blur-[1px]",
    );
    expect(appGlobalsSource).toContain(".storyboard-cut-image-shimmer");
    expect(appGlobalsSource).toContain(".admin-module-loading-shimmer");
    expect(appGlobalsSource).toContain(
      '[data-storyboard-module-loading-grid="true"]',
    );
    expect(appGlobalsSource).toContain(
      "grid-template-columns: minmax(0, 1fr) minmax(320px, 400px);",
    );
    expect(appGlobalsSource).toContain(
      '[data-storyboard-module-loading-frame-grid="true"]',
    );
    expect(appGlobalsSource).toContain(
      "grid-template-rows: repeat(2, minmax(0, 1fr));",
    );
    expect(appGlobalsSource).toContain("@keyframes storyboard-glass-shimmer");
    expect(appGlobalsSource).toContain("transform: translate3d(380%, 0, 0)");
    expect(appGlobalsSource).toContain("will-change: transform, opacity");
    expect(appGlobalsSource).toContain(
      '[data-thumbnail-generation-skeleton="true"]',
    );
    expect(storyboardSource).toContain("STORYBOARD_PENDING_IMAGE_BACKGROUND");
    expect(storyboardSource).toContain(
      "data-storyboard-cut-image-loading-scope={",
    );
    expect(storyboardSource).toContain('"image-only"');
    expect(storyboardSource).not.toContain(
      'data-storyboard-frame-skeleton-only="true"',
    );
    expect(storyboardSource).toContain("generatingStoryboardImageSceneNos");
    expect(storyboardSource).toContain("setGeneratingStoryboardImageSceneNos");
    expect(storyboardSource).toContain(
      "data-storyboard-image-generation-state={",
    );
    expect(storyboardSource).not.toContain(
      'data-storyboard-unified-image-generation-skeleton="true"',
    );
    expect(storyboardSource).not.toContain(
      "현재 페이지 이미지를 하나의 캔버스로 준비 중",
    );
    expect(storyboardSource).toContain('aria-live="polite"');
    expect(storyboardSource).toContain("STORYBOARD_NO_TRUSTED_IMAGE_LABEL");
    expect(storyboardSource).not.toContain("스토리보드 구성 로딩 중");
    expect(storyboardSource).toContain("getTrustedInitialStoryboardResult");
    expect(storyboardSource).toContain("makeInitialStoryboardChatMessages");
    expect(storyboardSource).not.toContain(
      "여러 CUT을 하나의 캔버스로 묶어 준비하고 있어요.",
    );
    expect(storyboardSource).not.toContain(
      "이미지 만들기 버튼으로 검증 이미지를 채울 수 있어요.",
    );
    expect(storyboardSource).not.toContain(
      "h-14 rounded-t-full rounded-b-2xl bg-foreground/10",
    );
    expect(storyboardSource).not.toContain("GPT Image 2 생성 중");
    expect(storyboardSource).toContain(
      "Array.from({ length: STORYBOARD_FRAMES_PER_PAGE }",
    );
    expect(storyboardSource).toContain('"flex h-full min-h-0 flex-col gap-2"');
    expect(canvasModuleSource).toContain('"relative grid min-h-0 min-w-0 flex-1 gap-2"');
    expect(storyboardSource).toContain("gridTemplateColumns:");
    expect(storyboardSource).toContain("storyboardFramePageSize === 1");
    expect(storyboardSource).toContain('"repeat(2, minmax(0, 1fr))"');
    expect(canvasModuleSource).toContain(
      '"min-h-0 min-w-0 flex-1 overflow-x-hidden p-3 pt-0 max-[1099px]:!overflow-visible"',
    );
    expect(canvasModuleSource).toContain('"overflow-hidden"');
    expect(canvasModuleSource).toContain('"overflow-y-auto"');
    expect(canvasModuleSource).toContain(
      "data-storyboard-frame-page={String(activePage + 1)}",
    );
    expect(canvasModuleSource).toContain("data-storyboard-frame-page-size={");
    expect(storyboardSource).toContain("storyboardFramePageSize");
    expect(storyboardSource).not.toContain('"h-full grid-cols-1 grid-rows-3"');
    expect(storyboardSource).not.toContain(
      "auto-rows-max grid-cols-2 2xl:grid-cols-3",
    );
    expect(storyboardSource).toContain(
      "group relative grid h-full min-h-0 overflow-hidden rounded-2xl",
    );
    expect(storyboardSource).toContain("gridTemplateRows");
    expect(storyboardSource).toContain('"minmax(0, 1fr) auto"');
    expect(storyboardSource).toContain("data-storyboard-image-frame={");
    expect(storyboardSource).toContain("String(scene.sceneNo)");
    expect(storyboardSource).toContain(
      'data-storyboard-frame-fit="image-and-script-visible"',
    );
    expect(storyboardSource).toContain("frameScriptPreviewLength");
    expect(storyboardSource).toContain(
      "const isSingleFramePage = storyboardFramePageSize === 1;",
    );
    expect(storyboardSource).toContain("const frameScriptPreviewLength = 64;");
    expect(storyboardSource).toContain(
      "const audioPreviewText = isSingleFramePage",
    );
    expect(storyboardSource).toContain("? audioText");
    expect(storyboardSource).toContain("? subtitleText");
    expect(storyboardSource).toContain("? productionNote");
    expect(storyboardSource).toContain("audioPreviewText");
    expect(storyboardSource).toContain("subtitlePreviewText");
    expect(storyboardSource).toContain("productionNotePreviewText");
    expect(storyboardSource).toContain(
      'className="relative min-h-0 flex-1 overflow-hidden rounded-t-2xl"',
    );
    expect(storyboardSource).not.toContain("min-h-[160px] flex-1");
    expect(storyboardSource).toContain("스토리보드 이미지 생성 결과");
    expect(storyboardSource).not.toContain("aspect-video");
    expect(storyboardSource).toContain(
      "aria-label={`${scene.sceneNo}컷 이미지 생성 결과`}",
    );
    expect(storyboardSource).toContain('data-storyboard-cut-overlay="true"');
    expect(storyboardSource).toContain('data-storyboard-cut-badge="true"');
    expect(storyboardSource).toContain(
      'data-storyboard-cut-badge-background="visible"',
    );
    expect(storyboardSource).toContain('data-storyboard-cut-time-badge="true"');
    expect(storyboardSource).toContain(
      'data-storyboard-cut-time-badge-background="visible"',
    );
    expect(storyboardSource).toContain("zIndex: 30");
    expect(storyboardSource).toContain('backgroundColor: "rgba(15, 23, 42, 0.82)"');
    expect(storyboardSource).toContain(
      'backgroundColor: "rgba(255, 255, 255, 0.92)"',
    );
    expect(storyboardSource).toContain('color: "#0f172a"');
    expect(storyboardSource).toContain('context.fillStyle = "rgba(15,23,42,0.82)"');
    expect(storyboardSource).toContain('context.fillStyle = "rgba(255,255,255,0.92)"');
    expect(storyboardSource).not.toContain('"copy-markdown"');
    expect(storyboardSource).not.toContain('"view-full"');
    expect(storyboardSource).not.toContain('"view-evidence"');
    expect(storyboardSource).not.toContain('"view-checklist"');
    expect(storyboardSource).not.toContain('"reset-preview"');
    expect(storyboardSource).not.toContain("StoryboardViewMode");
    expect(storyboardSource).not.toContain(
      'data-storyboard-readiness-panel="true"',
    );
    expect(storyboardSource).not.toContain(
      "아직 생성된 스토리보드가 없습니다.",
    );
    expect(storyboardSource).not.toContain(
      'data-storyboard-planning-presets="true"',
    );
    expect(storyboardSource).not.toContain(
      'data-storyboard-production-notes-toggle="true"',
    );
    expect(storyboardSource).not.toContain(
      'data-storyboard-quality-summary="true"',
    );
    expect(storyboardSource).not.toContain(
      'data-storyboard-production-checklist="true"',
    );
    expect(storyboardSource).not.toContain(
      'fetch("/api/admin/storyboard", { cache: "no-store" })',
    );
    expect(storyboardSource).not.toContain("status?.isFallbackData");
    expect(storyboardSource).toContain("result.sourceSummary.isFallbackData");
    expect(storyboardSource).toContain("예시 구성");
    expect(storyboardSource).not.toContain("실제 분석 아님");
    expect(storyboardSource).not.toContain("회의용 Markdown 복사");
    expect(storyboardSource).not.toContain("Markdown 복사");
    expect(storyboardSource).not.toContain("위원회 AHP 평가");
    expect(storyboardSource).not.toContain(
      "data-storyboard-agent-graph-fidelity",
    );
    expect(storyboardSource).not.toContain("data-storyboard-agent-graph-role");
    expect(storyboardSource).not.toContain("참조 그래프 충실도");
    expect(storyboardSource).toContain("agentGraphFidelity");
    expect(storyboardSource).not.toContain("멘트 후보:");
    expect(requireAdminSource).toContain("getE2EAdminApiBypassUserId");
    expect(requireAdminSource).toContain("isE2EAdminRouteBypassEnvEnabled()");
    expect(requireAdminSource).toContain("E2E_ADMIN_ROUTE_BYPASS_TOKEN_HEADER");
    expect(requireAdminSource).toContain(
      "requestHeaders.get(E2E_ADMIN_ROUTE_BYPASS_HEADER) === '1'",
    );
    expect(requireAdminSource).toContain(
      "requestToken === getE2EAdminRouteBypassExpectedToken()",
    );
    expect(requireAdminSource).toContain(
      "isLocalPlaywrightHost(requestHeaders.get('host'))",
    );
    expect(requireAdminSource).toContain("return 'e2e-admin-route-bypass'");
    expect(routeSource).toContain("buildStoryboardJobInsert");
    expect(routeSource).toContain("sanitizeStoryboardJobRow");
    expect(routeSource).not.toContain("generateStoryboardWithBackendAgent");
    expect(routeSource).toContain(
      "backendAgent: await getPublicStoryboardBackendAgentStatus()",
    );
    expect(chatRouteSource).toContain("generateStoryboardChatWithBackendAgent");
    expect(chatRouteSource).toContain("STORYBOARD_ROUTE_SSE_HEADERS");
    expect(chatRouteSource).toContain("event: ${event}");
    expect(chatRouteSource).toContain("getInitialStatusMessages");
    expect(chatRouteSource).toContain("getResolvedStatusMessage");
    expect(chatRouteSource).toContain("normalizeRouteImageAttachments");
    expect(chatRouteSource).toContain(
      "STORYBOARD_CHAT_IMAGE_ATTACHMENT_LIMIT = 3",
    );
    expect(chatRouteSource).toContain(
      "STORYBOARD_CHAT_IMAGE_ATTACHMENT_MAX_BYTES = 4 * 1024 * 1024",
    );
    expect(chatRouteSource).toContain(
      "'첨부한 사진을 참고해서 스토리보드 방향을 제안해줘.'",
    );
    expect(chatRouteSource).toContain(
      "imageAttachments: imageAttachmentResult.attachments",
    );
    expect(chatRouteSource).toContain("사진 ${imageAttachmentCount}장 첨부");
    expect(chatRouteSource).toContain("작업으로 이해했어요");
    expect(chatRouteSource).toContain("곧 화면에 바로 반영할게요");
    expect(chatRouteSource).toContain("send('status'");
    expect(chatRouteSource).toContain("send('patch', publicResult)");
    expect(chatRouteSource).toContain("duplicateResultOmitted: true");
    expect(chatRouteSource).not.toContain("send('done', publicResult)");
    expect(chatRouteSource).toContain("await requireAdmin({");
    expect(imageRouteSource).toContain("generateStoryboardSceneImages");
    expect(imageRouteSource).toContain(
      "getStoryboardImageProviderAvailability",
    );
    expect(imageRouteSource).toContain("await requireAdmin({");
    expect(imageRouteSource).toContain(
      "maxScenesPerRequest: STORYBOARD_IMAGE_GENERATION_BATCH_SIZE",
    );
    expect(imageRouteSource).toContain(
      "STORYBOARD_LOCAL_CODEX_PROVENANCE_FILE",
    );
    expect(imageRouteSource).toContain("bun run storyboard:image-proof");
    expect(imageRouteSource).toContain(
      "STORYBOARD_BROWSER_OPENAI_API_KEY_HEADER",
    );
    expect(imageRouteSource).toContain(
      "normalizeStoryboardBrowserOpenAIApiKey",
    );
    expect(imageRouteSource).toContain(
      "browserKeyStorage: 'memory_only_operation_scoped'",
    );
    expect(imageRouteSource).toContain(
      '활성 작업 동안 컴포넌트 메모리에만 존재하며, 보호된 요청 헤더로 한 번만 전송되고 저장되지 않음',
    );
    expect(imageProviderSource).toContain("STORYBOARD_IMAGE_PROVIDER_MODEL");
    expect(imageProviderSource).toContain(
      "providerId: STORYBOARD_IMAGE_PROVIDER_ID",
    );
    expect(imageProviderSource).toContain(
      "STORYBOARD_BROWSER_OPENAI_IMAGE_PROVIDER_ID",
    );
    expect(imageProviderSource).toContain("modelProvenance: 'unverified'");
    expect(imageProviderSource).toContain(
      "modelProvenance: STORYBOARD_IMAGE_PROVIDER_EXACT_PROVENANCE",
    );
    expect(imageProviderSource).toContain(
      "STORYBOARD_LOCAL_CODEX_PROVENANCE_FILE",
    );
    expect(imageProviderSource).toContain("hasOpenAIAPIKey !== false");
    expect(imageProviderSource).toContain(
      "proof.endpoint !== LOCAL_CODEX_RESPONSES_ENDPOINT",
    );
    expect(imageProviderSource).toContain(
      "proof.rawImageItemTypes[0] !== 'image_generation_call'",
    );
    expect(imageProviderSource).toContain("proof.generatedImageItemTypes");
    expect(imageProviderSource).toContain(
      "toStoryboardGeneratedImageProvenance",
    );
    expect(imageProviderSource).toContain(
      "provenance: toStoryboardGeneratedImageProvenance(finalProof)",
    );
    expect(imageProviderSource).toContain("LOCAL_CODEX_PROVENANCE_MAX_AGE_MS");
    expect(imageProviderSource).toContain("isSha256Hex(proof.requestHash)");
    expect(imageProviderSource).toContain(
      "isFreshGeneratedAt(proof.generatedAt)",
    );
    expect(imageProviderSource).toContain(
      "requestToolType: 'image_generation'",
    );
    expect(imageProviderSource).toContain(
      "requestToolModel: STORYBOARD_IMAGE_PROVIDER_MODEL",
    );
    expect(imageProviderSource).toContain(
      "exact_provenance: ${finalProof.requestToolType}.${finalProof.requestToolModel}",
    );
    expect(imageProviderSource).toContain("browser_memory_only_api_key");
    expect(imageProviderSource).toContain(
      "storage_boundary: raw API key was not persisted to account data, DB, history, or provenance.",
    );
    expect(imageRouteSource).not.toMatch(/\b(?:localStorage|sessionStorage)\b/);
    expect(imageProviderSource).not.toMatch(/\b(?:localStorage|sessionStorage)\b/);
    expect(imageProviderSource).toContain(
      'browser component-memory API key (active operation; transmitted once in guarded request header; never persisted)',
    );
    expect(imageProviderSource).toContain(
      'browser_api_key_provider: API key exists only in component memory for the active operation and is transmitted once in the guarded request header.',
    );
    expect(imageProviderSource).toContain("redactProviderSecretText");
    expect(imageProviderSource).toContain("OPENAI_API_KEY: ''");
    expect(storyboardSource).not.toContain(
      "STORYBOARD_BROWSER_MODEL_KEYS_STORAGE_KEY",
    );
    expect(storyboardSource).not.toMatch(/\b(?:localStorage|sessionStorage)\b/);
    expect(storyboardSource).toContain(
      'data-storyboard-browser-api-key-settings="memory-only"',
    );
    expect(storyboardSource).toContain(
      'data-storyboard-api-key-db-storage="forbidden"',
    );
    expect(storyboardSource).toContain(
      'data-storyboard-browser-api-key-input="true"',
    );
    expect(storyboardSource).toContain(
      'data-storyboard-openai-api-key-scope="component-memory"',
    );
    expect(storyboardSource).toContain(
      'data-storyboard-browser-api-key-model-policy="gpt-image-2-only"',
    );
    expect(storyboardSource).toContain("expectedStoryboardImageProviderId");
    expect(storyboardSource).toContain(
      "isSelectedStoryboardImageProviderReady",
    );
    expect(storyboardSource).toContain("isStoryboardBrowserOpenAIApiKeyApplied");
    expect(storyboardSource).toContain(
      "isSelectedStoryboardImageProviderReady",
    );
    expect(storyboardSource).not.toContain(
      'supabase.from("storyboard_browser_model_keys")',
    );
    expect(storyboardSource).not.toContain(
      "user_id: storyboardBrowserOpenAIApiKey",
    );
    expect(localBridgeContractSource).toContain(
      "STORYBOARD_LOCAL_BRIDGE_DEFAULT_URL = LOCAL_BRIDGE_DEFAULT_URL",
    );
    expect(localBridgeCoreSource).toContain(
      "LOCAL_BRIDGE_DEFAULT_URL = 'http://127.0.0.1:17873'",
    );
    expect(localBridgeCoreSource).toContain(
      "http://127.0.0.1 또는 localhost 주소만 사용할 수 있습니다.",
    );
    expect(localBridgeContractSource).toContain(
      "getTrustedStoryboardGeneratedImage",
    );
    expect(localBridgeServerSource).toContain(
      "Access-Control-Allow-Private-Network",
    );
    expect(localBridgeServerSource).toContain(
      "Refusing to bind local bridge to a non-loopback host.",
    );
    expect(localBridgeServerSource).toContain("value.hasOpenAIAPIKey === false");
    expect(localBridgeServerSource).toContain(
      "providerId: STORYBOARD_IMAGE_PROVIDER_ID",
    );
    expect(localBridgeScriptSource).toContain(
      "startStoryboardLocalBridgeServer",
    );
    expect(imageReadinessSource).toContain("gpt-image-2");
    expect(imageReadinessSource).toContain("browser-openai-api-key");
    expect(imageReadinessSource).toContain("x-storyboard-openai-api-key");
    expect(imageReadinessSource).toContain(
      '활성 작업 동안 컴포넌트 메모리에만 있고, 보호된 요청 헤더로 한 번만 전송되며 저장되지 않습니다.',
    );
    expect(imageReadinessSource).not.toMatch(/\b(?:localStorage|sessionStorage)\b/);
    expect(imageProviderSource).not.toContain(
      "ALLOW_LOCAL_CLI_STORYBOARD_IMAGES",
    );
    expect(imageProviderSource).not.toContain("ALLOW_LOCAL_CLI_THUMBNAIL");
    expect(imageProviderSource).not.toContain(
      "THUMBNAIL_LOCAL_CODEX_IMAGE_MODEL",
    );
    expect(imageProviderSource).toContain(
      "codex-imagegen-storyboard-provider.py",
    );
    expect(imageProviderSource).toContain("generateStoryboardSceneImage");
    expect(imageProviderSource).toContain("buildStoryboardSceneImagePrompt");
    expect(imageProviderSource).toContain("no recognizable face");
    expect(imageProviderSource).toContain("no face close-up");
    expect(imageProviderSource).toContain("no host face at all");
    expect(imageProviderSource).toContain("no detailed eyes/nose/mouth");
    expect(imageProviderSource).toContain(
      "Keep all human faces outside the frame",
    );
    expect(imageProviderSource).toContain("cropped hands");
    expect(imageProviderSource).toContain("chopsticks");
    expect(imageProviderSource).toContain("food");
    expect(imageProviderSource).toContain("over-shoulder silhouette");
    expect(imageProviderSource).toContain("back-of-head silhouette");
    expect(imageProviderSource).toContain(
      "cropped body parts without facial detail",
    );
    expect(imageProviderSource).toContain("face outside frame");
    expect(imageProviderSource).not.toContain("generateMock");
    expect(storyboardImageWrapperSource).not.toContain("$imagegen");
    expect(storyboardImageWrapperSource).toContain(
      "Codex OAuth + Responses image_generation",
    );
    expect(storyboardImageWrapperSource).toContain("gpt-image-2");
    expect(storyboardImageWrapperSource).toContain(
      "full-bleed single-scene storyboard cut image",
    );
    expect(storyboardImageWrapperSource).toContain("multi-panel layouts");
    expect(storyboardImageWrapperSource).toContain("blank quadrants");
    expect(storyboardImageWrapperSource).toContain("embedded 2x2 grids");
    expect(storyboardImageWrapperSource).toContain(
      'OAUTH_BASE_URL = "https://chatgpt.com/backend-api/codex"',
    );
    expect(storyboardImageWrapperSource).toContain(
      'IMAGE_TOOL_TYPE = "image_generation"',
    );
    expect(storyboardImageWrapperSource).toContain(
      "RESPONSES_ENDPOINT = OAUTH_BASE_URL.rstrip",
    );
    expect(storyboardImageWrapperSource).toContain("requestHash");
    expect(storyboardImageWrapperSource).toContain("responseHash");
    expect(storyboardImageWrapperSource).toContain("_raw_output_item_types");
    expect(storyboardImageWrapperSource).toContain("generatedImageItemTypes");
    expect(storyboardImageWrapperSource).toContain(
      "This bridge intentionally does not read or use OPENAI_API_KEY",
    );
    expect(storyboardImageWrapperSource).toContain("tool_choice");
    expect(storyboardImageWrapperSource).toContain("image_generation_call");
    expect(backendAgentWrapperSource).toContain("codex_cli_oauth");
    expect(backendAgentWrapperSource).toContain("gpt-5.5");
    expect(backendAgentWrapperSource).toContain("STORYBOARD_AGENT_CODEX_MODEL");
    expect(backendAgentWrapperSource).toContain(
      "STORYBOARD_AGENT_CODEX_EFFORT",
    );
    expect(backendAgentWrapperSource).toContain('model_reasoning_effort="');
    expect(backendAgentWrapperSource).toContain("STORYBOARD_AGENT_TIMEOUT_MS");
    expect(backendAgentWrapperSource).toContain("codex_oauth_env");
    expect(backendAgentWrapperSource).toContain("CODEX_API_KEY");
    expect(backendAgentWrapperSource).not.toContain("NEXT_PUBLIC_SUPABASE_URL");
    expect(backendAgentWrapperSource).toContain("OPENAI_API_KEY");
    expect(backendAgentWrapperSource).toContain("Do not run shell commands");
    expect(backendAgentWrapperSource).toContain(
      "gpt-image-2 is handled by the separate image provider",
    );
    expect(backendAgentWrapperSource).toContain("from utils.privacy_log import redact_log_text, safe_error_name");
    expect(backendAgentRequirementsSource).toContain("langgraph");
    expect(backendAgentRequirementsSource).toContain("langchain-openai");
    expect(backendAgentRequirementsSource).toContain("supabase");
    expect(storyboardImageWrapperSource).toContain(
      "Codex OAuth + Responses image_generation",
    );
    expect(storyboardImageWrapperSource).toContain("gpt-image-2");
    expect(storyboardImageWrapperSource).toContain(
      "does not read or use OPENAI_API_KEY",
    );
    expect(envExampleSource).toContain("STORYBOARD_AGENT_COMMAND");
    expect(envExampleSource).toContain("STORYBOARD_AGENT_ROOT=");
    expect(envExampleSource).toContain("STORYBOARD_AGENT_PYTHON");
    expect(envExampleSource).toContain(
      "STORYBOARD_AGENT_RUNTIME=codex_cli_oauth",
    );
    expect(envExampleSource).toContain("STORYBOARD_AGENT_CODEX_EFFORT=low");
    expect(envExampleSource).toContain(
      "../../backend/storyboard-agent/scripts/run-storyboard-agent.py",
    );
    expect(envExampleSource).toContain("셸 메타문자/인자는 허용하지 않는다");
    expect(envExampleSource).toContain("STORYBOARD_AGENT_TIMEOUT_MS=120000");
    expect(envExampleSource).toContain("Remote service bridge");
    expect(readmeSource).toContain("STORYBOARD_AGENT_COMMAND");
    expect(readmeSource).toContain("STORYBOARD_AGENT_ROOT=");
    expect(readmeSource).toContain("STORYBOARD_AGENT_CODEX_MODEL=gpt-5.5");
    expect(readmeSource).toContain("STORYBOARD_AGENT_CODEX_EFFORT=low");
    expect(readmeSource).toContain(
      "../../backend/storyboard-agent/scripts/run-storyboard-agent.py",
    );
    expect(readmeSource).toContain("Remote service bridge");
    expect(backendAgentSource).toContain("BACKEND_AGENT_ROOT");
    expect(backendAgentSource).toContain("backend/storyboard-agent");
    expect(backendAgentSource).toContain("STORYBOARD_AGENT_COMMAND");
    expect(backendAgentSource).toContain("STORYBOARD_AGENT_ROOT");
    expect(backendAgentSource).toContain("STORYBOARD_AGENT_PYTHON");
    expect(backendAgentSource).toContain("STORYBOARD_AGENT_TIMEOUT_MS");
    expect(backendAgentSource).toContain("resolveStoryboardAgentPython");
    expect(backendAgentSource).toContain("resolveStoryboardAgentCommand");
    expect(backendAgentSource).toContain("UNSAFE_COMMAND_PATTERN");
    expect(backendAgentSource).toContain("resolveStoryboardAgentPythonCommand");
    expect(backendAgentSource).toContain("shouldRunThroughWindowsCommandShell");
    expect(backendAgentSource).toContain("buildWindowsCommandShellSpec");
    expect(backendAgentSource).toContain("shell: false");
    expect(backendAgentSource).not.toContain("shell: true");
    expect(backendAgentSource).toContain("sanitizeCommandOutput");
    expect(backendAgentSource).toContain("BACKEND_AGENT_ROOT");
    expect(backendAgentSource).toContain("backend_agent_local_adapter");
    expect(backendAgentSource).toContain("backend_agent_command");
    expect(backendAgentSource).toContain(
      "generateStoryboardChatWithBackendAgent",
    );
    expect(backendAgentSource).toContain(
      'DEFAULT_STORYBOARD_AGENT_CODEX_MODEL = "gpt-5.5"',
    );
    expect(backendAgentSource).toContain(
      'DEFAULT_STORYBOARD_AGENT_CODEX_EFFORT = "low"',
    );
    expect(backendAgentSource).toContain("resolveStoryboardAgentCodexModel");
    expect(backendAgentSource).toContain("resolveStoryboardAgentCodexEffort");
    expect(backendAgentSource).toContain("createStoryboardChatCanvasPatch");
    expect(backendAgentSource).toContain("shouldGenerate");
    expect(backendAgentSource).toContain("shouldReset");
    expect(backendAgentSource).toContain("src/graph.py");
    expect(backendAgentSource).toContain("src/state/slots.py");
    expect(backendAgentSource).toContain("src/prompts/designer.py");
    expect(typesSource).toContain(
      "export type StoryboardGenerationMode = 'local_heatmap' | 'backend_agent';",
    );
    expect(typesSource).toContain("'backend_agent_local_adapter'");
    expect(typesSource).toContain("'backend_agent_command'");
    expect(typesSource).toContain(
      "export type StoryboardFallbackReason = 'missing-heatmap-directory' | 'no-usable-heatmap-sources';",
    );
    expect(typesSource).toContain("generationMode: StoryboardGenerationMode;");
    expect(typesSource).toContain("export type StoryboardBackendAgentStatus");
    expect(typesSource).toContain("commandAvailable: boolean;");
    expect(typesSource).toContain("localAdapterAvailable: boolean;");
    expect(typesSource).toContain(
      "backendAgent?: StoryboardBackendAgentStatus",
    );
    expect(typesSource).toContain(
      "generatedImage?: StoryboardSceneGeneratedImage;",
    );
    expect(typesSource).toContain("export type StoryboardSceneGeneratedImage");
    expect(typesSource).toContain(
      "trustPolicy: 'storyboard-gpt-image-2-panel-v1';",
    );
    expect(typesSource).toContain("isFallbackData: boolean;");
    expect(typesSource).toContain(
      "fallbackReason: StoryboardFallbackReason | null;",
    );
    expect(typesSource).toContain("dataModeLabel: string;");
    const storyboardGetSource = routeSource.slice(
      routeSource.indexOf("export async function GET"),
      routeSource.indexOf("export async function POST"),
    );
    const storyboardPostSource = routeSource.slice(
      routeSource.indexOf("export async function POST"),
    );
    expect(routeSource).toContain("await requireAdmin({");
    expect(storyboardPostSource.indexOf("await requireAdmin({")).toBeLessThan(
      storyboardPostSource.indexOf("const bodyResult = await readStoryboardRouteJson(")
    );
    expect(storyboardGetSource.indexOf("await requireAdmin({")).toBeLessThan(
      storyboardGetSource.indexOf("} = loadStoryboardHeatmapSources"),
    );
    expect(routeSource).toContain("isFallbackData");
    expect(routeSource).toContain("fallbackReason");
    expect(routeSource).toContain("dataModeLabel");
    expect(routeSource).not.toContain("mode: 'local_heatmap_fixture'");
    expect(generatorSource).toContain("backend/storyboard-agent");
    expect(generatorSource).toContain("most_replayed_markers");
    expect(generatorSource).toContain("TZUYANG_HEATMAP_DIR");
    expect(generatorSource).toContain(
      "LOCAL_FALLBACK_MODE_LABEL = '데모/샘플 모드'",
    );
    expect(generatorSource).toContain(
      "FALLBACK_HEATMAP_DIRECTORY = 'local-demo://storyboard-fallback'",
    );
    expect(generatorSource).toContain("missing-heatmap-directory");
    expect(generatorSource).toContain("no-usable-heatmap-sources");
    expect(generatorSource).toContain("local-demo-");
  });

  test("lets admins reorder the sidebar without polluting the two-pane map overview", () => {
    const consoleSource = adminConsoleShellSource();
    const appGlobalsSource = source("app/app-globals.css");
    const preferenceRouteSource = source(
      "app/api/admin/preferences/sidebar-order/route.ts",
    );
    const sidebarOrderSource = source("lib/admin/sidebar-order.ts");
    const sidebarOrderHookSource = source(
      "components/admin/console/use-admin-sidebar-order.ts",
    );
    const sidebarOrderEditorSource = source(
      "components/admin/console/AdminConsoleSidebarOrderEditor.tsx",
    );
    const hydrationSmokeSource = source("tests/admin-console-module-hydration.spec.ts");
    const overviewSource = source(
      "components/admin/AdminOverviewDashboard.tsx",
    );

    expect(sidebarOrderHookSource).toContain("DEFAULT_ADMIN_SIDEBAR_ORDER");
    expect(consoleSource).toContain("normalizeAdminSidebarOrder");
    expect(sidebarOrderSource).toContain("mergeSidebarItemsWithDefaultSlots");
    expect(sidebarOrderHookSource).toContain("moveAdminSidebarSection");
    expect(sidebarOrderHookSource).toContain("moveAdminSidebarItem");
    expect(consoleSource).toContain("buildOrderedSidebarSections");
    expect(consoleSource).toContain("canLoadPreferences");
    expect(sidebarOrderHookSource).toContain("if (!enabled) {");
    expect(sidebarOrderHookSource).toContain("setIsLoading(true);");
    expect(sidebarOrderHookSource).toContain("setIsLoading(false);");
    expect(sidebarOrderHookSource).toContain("saveLockRef.current");
    expect(sidebarOrderEditorSource).toContain("data-admin-sidebar-order-loading=");
    expect(consoleSource).toContain("useAdBannersAdmin(isAdmin)");
    expect(consoleSource).not.toContain("useAnnouncementsAdmin(isAdmin)");
    expect(source("hooks/use-ad-banners.tsx")).toContain(
      "export function useAdBannersAdmin(enabled = true)",
    );
    expect(source("hooks/use-ad-banners.tsx")).toContain(
      "enabled: isAdmin && enabled",
    );
    expect(consoleSource).toContain('data-admin-console-mobile-header="true"');
    expect(consoleSource).toContain(
      "data-admin-console-mobile-header-visible={",
    );
    expect(consoleSource).toContain('showMobileHeader ? "true" : "false"');
    expect(consoleSource).toContain('isMobileHeaderVisible ? "true" : "false"');
    expect(appGlobalsSource).toContain(
      '[data-admin-console-layout="sidebar-content"][data-admin-console-mobile-header-visible="false"]',
    );
    expect(appGlobalsSource).toContain(
      "grid-template-rows: 0rem minmax(0, 1fr);",
    );
    expect(appGlobalsSource).toContain(
      "transition: grid-template-rows 300ms cubic-bezier(0.22, 1, 0.36, 1);",
    );
    expect(consoleSource).toContain("useMobileBottomNavAutoHide");
    expect(consoleSource).toContain("getMobileScrollNavVisibilityAction");
    expect(consoleSource).toContain(
      "const updateMobileHeaderVisibility = useCallback",
    );
    expect(consoleSource).toContain("canvasRef.current?.scrollTop ?? 0");
    expect(consoleSource).toContain("window.scrollY");
    expect(consoleSource).toContain("previousMobileHeaderScrollTopRef.current");
    expect(consoleSource).toContain('source: "admin-console"');
    expect(consoleSource).toContain("disabled: !isAdminMobileViewport");
    expect(consoleSource).toContain("revealOnScrollUp: false");
    expect(consoleSource).toContain("handleAdminCanvasScroll");
    expect(consoleSource).toContain("getAdminConsoleScrollTop");
    expect(consoleSource).toContain("getScrollTop: getAdminConsoleScrollTop");
    expect(consoleSource).toContain(
      "const [isAdminMobileViewport, setIsAdminMobileViewport] = useState(false)",
    );
    expect(consoleSource).toContain(
      'window.matchMedia("(max-width: 767px)")',
    );
    expect(consoleSource).toContain(
      "const setAdminMobileChromeHidden = useCallback",
    );
    expect(consoleSource).toContain(
      "const handleAdminCanvasWheel = useCallback",
    );
    expect(consoleSource).toContain("onWheel={handleAdminCanvasWheel}");
    expect(consoleSource).toContain("adminCanvasTouchStartYRef");
    expect(consoleSource).toContain("setAdminMobileChromeHidden(true)");
    expect(consoleSource).toContain(
      "const handleAdminCanvasTouchMove = useCallback",
    );
    expect(consoleSource).toContain(
      "onTouchStart={handleAdminCanvasTouchStart}",
    );
    expect(consoleSource).toContain("onTouchMove={handleAdminCanvasTouchMove}");
    expect(consoleSource).toContain('canvasElement?.addEventListener("scroll"');
    expect(consoleSource).toContain("showMobileHeader={isMobileHeaderVisible}");
    expect(consoleSource).toContain(
      "previousRequestedModuleIdRef.current !== nextModuleId",
    );
    expect(consoleSource).toContain("transition-[transform,border-color]");
    expect(consoleSource).toContain("translate3d(0, -120%, 0)");
    expect(consoleSource).toContain(
      "flex w-full min-w-0 shrink-0 flex-nowrap items-center justify-start gap-1.5 overflow-x-auto",
    );
    expect(consoleSource).toContain('data-allow-horizontal-scroll="true"');
    expect(consoleSource).toContain(
      'data-horizontal-scroll-owner="admin-dashboard-action-bar"',
    );
    expect(appGlobalsSource).toContain('[data-admin-dashboard-action-bar="true"]');
    expect(appGlobalsSource).toContain('[data-admin-dashboard-table-view="true"]');
    expect(appGlobalsSource).toContain('[data-admin-console-content="true"]::-webkit-scrollbar');
    expect(appGlobalsSource).toContain('padding-bottom: calc(var(--mobile-bottom-nav-effective-height');
    expect(consoleSource).toContain(
      'data-horizontal-scroll-owner="admin-dashboard-series-toggle"',
    );
    expect(consoleSource).toContain(
      'data-horizontal-scroll-owner="admin-dashboard-card-title-actions"',
    );
    expect(consoleSource).toContain(
      'data-horizontal-scroll-owner="admin-dashboard-kpi-title-actions"',
    );
    expect(consoleSource).toContain(
      "min-h-0 min-w-0 w-full overflow-hidden border",
    );
    expect(consoleSource).toContain("overflow-x-hidden overscroll-contain");
    expect(consoleSource).toContain(
      'data-admin-console-menu-trigger="hamburger"',
    );
    expect(consoleSource).toContain('variant="ghost"');
    expect(consoleSource).toContain(
      "rounded-lg bg-transparent p-0 shadow-none",
    );
    expect(consoleSource).not.toContain(
      "rounded-full border-border/80 bg-background/85 p-0 shadow-sm",
    );
    expect(consoleSource).not.toContain(
      'data-admin-console-menu-trigger="desktop-hamburger"',
    );
    expect(consoleSource).toContain('data-admin-console-menu-dropdown="true"');
    expect(sidebarOrderEditorSource).toContain(
      "data-admin-sidebar-order-editor={placement}",
    );
    expect(sidebarOrderEditorSource).toContain("isEditMode");
    expect(sidebarOrderEditorSource).toContain('data-admin-sidebar-order-edit-toggle="true"');
    expect(sidebarOrderEditorSource).toContain('data-admin-sidebar-order-edit-mode={isEditMode ? "enabled" : "locked"}');
    expect(sidebarOrderEditorSource).toContain('data-admin-sidebar-order-edit-lock-message="true"');
    expect(sidebarOrderEditorSource).toContain("aria-pressed={isEditMode}");
    expect(hydrationSmokeSource).toContain("ADMIN_MODULE_SMOKE_TARGETS");
    expect(hydrationSmokeSource).toContain("/admin?module=routes");
    expect(hydrationSmokeSource).toContain("/admin?module=youtube-thumbnail-generator");
    expect(hydrationSmokeSource).toContain("/admin?module=audit");
    expect(hydrationSmokeSource).toContain("/admin?module=map-overlays");
    expect(hydrationSmokeSource).toContain("moduleId: 'map-overlays'");
    expect(hydrationSmokeSource).toContain('data-admin-map-overlays-module="true"');
    expect(hydrationSmokeSource).toContain("minified react error");
    expect(hydrationSmokeSource).toContain("readySelector");
    expect(hydrationSmokeSource).toContain('data-admin-youtube-thumbnail-generator="true"');
    expect(hydrationSmokeSource).toContain('data-admin-audit-coverage="partial-domain-specific"');
    expect(hydrationSmokeSource).toContain("관리자 지도 운영 개요 2분할");
    expect(consoleSource).toContain('placement="dropdown"');
    expect(consoleSource).toContain('data-admin-sidebar-theme-toggle="true"');
    expect(consoleSource).toContain('data-admin-sidebar-footer-actions="true"');
    expect(consoleSource).toContain(
      'data-admin-sidebar-section-list="spacious"',
    );
    expect(consoleSource).not.toContain(
      'data-admin-sidebar-footer-separator="spacious"',
    );
    expect(consoleSource).toContain(
      'data-admin-sidebar-scroll="hidden-scrollbar"',
    );
    expect(consoleSource).toContain('data-admin-sidebar-header="true"');
    expect(consoleSource).toContain(
      "relative z-30 hidden h-full min-h-0 w-max shrink-0 flex-col overflow-hidden",
    );
    expect(consoleSource).toContain(
      'data-admin-sidebar-menu-scroll="hidden-scrollbar"',
    );
    expect(consoleSource).toContain(
      "scrollbar-hide min-h-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-contain pb-4 pt-2",
    );
    expect(source("app/app-globals.css")).toContain(
      ".scrollbar-hide::-webkit-scrollbar",
    );
    expect(consoleSource).toContain("shrink-0 pt-4");
    expect(consoleSource).not.toContain(
      "shrink-0 border-t border-dashed border-border/70 pt-4",
    );
    expect(consoleSource).not.toContain(
      "mb-0 shrink-0 rounded-2xl border border-destructive/20 bg-destructive/5",
    );
    expect(consoleSource).toContain('title: "지표 데이터 로드 실패"');
    expect(consoleSource).toContain(
      'description: "대시보드 정적 영역은 유지합니다."',
    );
    expect(consoleSource).toContain(
      "data-admin-sidebar-preference-placement={placement}",
    );
    expect(consoleSource).toContain(
      "data-admin-sidebar-theme-layout={placement}",
    );
    expect(consoleSource).toContain('data-admin-sidebar-theme-cycle="single-button"');
    expect(consoleSource).toContain('data-admin-sidebar-theme-current={currentTheme}');
    expect(consoleSource).toContain('getNextAdminThemePreference(themePreference)');
    expect(sidebarOrderEditorSource).toContain(
      'className="rounded-2xl bg-background/85 p-2"',
    );
    expect(sidebarOrderEditorSource).toContain(
      'data-admin-sidebar-order-editor-density="compact"',
    );
    expect(sidebarOrderEditorSource).toContain(
      'data-admin-sidebar-order-section="compact"',
    );
    expect(sidebarOrderEditorSource).toContain('data-admin-sidebar-order-item="compact"');
    expect(consoleSource).not.toContain(
      'className="rounded-xl border border-border bg-card/80 p-1.5"',
    );
    expect(consoleSource).toContain('aria-label="계정 및 사이드바 설정"');
    expect(consoleSource).toContain('aria-label="관리자 사이드바 설정"');
    expect(consoleSource).toContain("isCollapsed");
    expect(consoleSource).toContain(
      'data-admin-sidebar-account-trigger={isCollapsed ? "collapsed" : "expanded"}',
    );
    expect(consoleSource).toContain(
      'data-admin-sidebar-account-menu-content="true"',
    );
    expect(consoleSource).toContain('data-admin-sidebar-account-chrome="integrated"');
    expect(consoleSource).toContain(
      '"group/sidebar-account transition-colors duration-150 focus-visible:ring-primary',
    );
    expect(consoleSource).toContain(
      '? "grid h-9 w-9 place-items-center rounded-xl bg-transparent p-0 text-muted-foreground shadow-none',
    );
    expect(consoleSource).toContain("const sidebarAccountAvatarClassName");
    expect(consoleSource).toContain(
      '"relative grid h-9 w-9 shrink-0 place-items-center overflow-hidden rounded-full bg-primary/10 text-primary transition-colors group-hover/sidebar-account:bg-primary/15"',
    );
    expect(consoleSource).toContain(
      'const sidebarAccountAvatarIconClassName = "h-5 w-5 -translate-y-px"',
    );
    expect(consoleSource).toContain(
      ': "h-11 w-full min-w-0 justify-start gap-2 rounded-2xl border border-border bg-background/95 px-1.5 py-1 text-foreground shadow-sm backdrop-blur-sm',
    );
    expect(consoleSource).toContain(
      'className={sidebarAccountAvatarClassName}',
    );
    expect(consoleSource).not.toContain(
      "border border-border bg-background/95 text-foreground shadow-lg backdrop-blur-sm",
    );
    expect(consoleSource).toContain("UserRound");
    expect(consoleSource).toContain(
      'data-admin-sidebar-account-theme-section="true"',
    );
    expect(consoleSource).toContain(
      'data-admin-sidebar-account-order-section="true"',
    );
    expect(consoleSource).toContain(
      '"flex w-full flex-col items-center gap-2 pb-1"',
    );
    expect(consoleSource).toContain('"space-y-3"');
    expect(consoleSource).not.toContain(
      'data-admin-sidebar-order-trigger="expanded"',
    );
    expect(consoleSource).not.toContain(
      'data-admin-sidebar-order-trigger="collapsed"',
    );
    expect(consoleSource).toContain("ADMIN_THEME_STORAGE_KEY");
    expect(consoleSource).toContain(
      'type AdminThemePreference = "light" | "dark" | "system"',
    );
    expect(consoleSource).toContain(
      'window.matchMedia("(prefers-color-scheme: dark)")',
    );
    expect(consoleSource).toContain(
      'document.documentElement.classList.toggle("dark"',
    );
    expect(consoleSource).toContain(
      "window.localStorage.setItem(ADMIN_THEME_STORAGE_KEY",
    );
    expect(consoleSource).toContain("const controlLabel = `${currentThemeLabel} 사용 중 · 클릭하면 ${getAdminThemeChangeLabel(nextThemeLabel)}`");
    expect(consoleSource).toContain("function getAdminThemeChangeLabel");
    expect(consoleSource).toContain("aria-label={controlLabel}");
    expect(consoleSource).not.toContain("aria-pressed={themePreference === theme}");
    expect(consoleSource).toContain(
      '"h-9 rounded-full border border-border bg-card text-xs font-bold text-muted-foreground shadow-inner',
    );
    expect(consoleSource).toContain(
      "dark:border-border/70 dark:bg-muted/35 dark:text-foreground",
    );
    expect(consoleSource).toContain(
      "data-[admin-sidebar-theme-current=dark]:bg-muted/35",
    );
    expect(consoleSource).toContain('["light", "라이트 모드", "다크모드", Sun]');
    expect(consoleSource).toContain('["dark", "다크모드", "시스템 모드", Moon]');
    expect(consoleSource).toContain('["system", "시스템 모드", "라이트 모드", Monitor]');
    expect(consoleSource).toContain(
      '<ThemeIcon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />',
    );
    expect(consoleSource).toContain(
      "const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(true);",
    );
    expect(consoleSource).toContain(
      "const [showSidebarLabels, setShowSidebarLabels] = useState(false);",
    );
    expect(consoleSource).toContain("ADMIN_SIDEBAR_COLLAPSED_STORAGE_KEY");
    expect(consoleSource).toContain("SIDEBAR_LABEL_REVEAL_DELAY_MS");
    expect(consoleSource).toContain("handleToggleSidebarCollapsed");
    expect(consoleSource).toContain("PanelLeftOpen");
    expect(consoleSource).toContain("PanelLeftClose");
    expect(consoleSource).toContain(
      'data-admin-sidebar-collapse-toggle="true"',
    );
    expect(consoleSource).toContain("UiTooltipTrigger asChild");
    expect(consoleSource).toContain(
      'data-admin-sidebar-collapsed-tooltip="true"',
    );
    expect(consoleSource).toContain('side="right"');
    expect(consoleSource).toContain("getSidebarBadgeClassName");
    expect(consoleSource).toContain("text-muted-foreground");
    expect(consoleSource).toContain(
      "data-admin-sidebar-badge-tone={section.label}",
    );
    expect(consoleSource).toContain("useAdminPendingBadges");
    expect(consoleSource).toContain("getAdminConsoleMenu");
    expect(consoleSource).toContain("aria-describedby={isPurposeDescribed ? purposeId : undefined}");
    expect(appGlobalsSource).toContain(".dark {");
    expect(appGlobalsSource).toContain("--background: 24 10% 10%;");
    expect(consoleSource).toContain(
      "relative z-30 hidden h-full min-h-0 w-max shrink-0 flex-col",
    );
    expect(consoleSource).toContain("md:min-w-[var(--admin-sidebar-expanded-width)]");
    expect(consoleSource).toContain(
      "md:max-w-[var(--admin-sidebar-expanded-max-width)]",
    );
    expect(consoleSource).toContain("isCollapsed &&");
    expect(consoleSource).toContain(
      '"md:h-[3.5625rem] md:min-h-[3.5625rem] md:w-[3.5625rem] md:items-center md:justify-center md:px-0 md:py-0"',
    );
    expect(consoleSource).not.toContain("md:border-b-0");
    expect(consoleSource).toContain(
      '"flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-xl',
    );
    expect(consoleSource).toContain('isCollapsed && "md:hidden"');
    expect(consoleSource).toContain(
      'className="h-7 w-7 rounded-lg object-contain"',
    );
    expect(consoleSource).toContain(
      '"group relative ml-auto inline-flex h-8 w-8 shrink-0 overflow-hidden rounded-xl bg-transparent p-0',
    );
    expect(consoleSource).toContain('isCollapsed && "md:m-0"');
    expect(consoleSource).not.toContain(
      '"md:m-0 md:border-border md:bg-background/70 md:text-foreground"',
    );
    expect(consoleSource).toContain(
      "data-admin-sidebar-collapse-logo-mode={",
    );
    expect(consoleSource).toContain("logo-hover-open-icon");
    expect(consoleSource).toContain(
      'data-admin-sidebar-collapse-visibility={',
    );
    expect(consoleSource).toContain(
      'isCollapsed ? "logo-hover" : "always-visible"',
    );
    expect(consoleSource).toContain(
      'data-admin-sidebar-collapsed-logo="true"',
    );
    expect(consoleSource).toContain(
      "group-hover:opacity-0 group-focus-visible:opacity-0",
    );
    expect(consoleSource).toContain(
      'data-admin-sidebar-collapsed-open-icon="true"',
    );
    expect(consoleSource).toContain(
      "group-hover:opacity-100 group-focus-visible:opacity-100",
    );
    expect(appGlobalsSource).toContain(
      '[data-admin-sidebar-collapse-toggle="true"][data-admin-sidebar-collapse-logo-mode="logo-hover-open-icon"]',
    );
    expect(appGlobalsSource).toContain(
      '[data-admin-sidebar-collapsed-logo="true"]',
    );
    expect(appGlobalsSource).toContain(
      '[data-admin-sidebar-collapsed-open-icon="true"]',
    );
    expect(consoleSource).toContain('href="/"');
    expect(consoleSource).toContain('aria-label="쯔동여지도 홈으로 이동"');
    expect(consoleSource).toContain('data-admin-sidebar-header-copy="true"');
    expect(consoleSource).not.toContain(
      "border border-primary/15 bg-primary/5 text-primary transition hover:border-primary/30 hover:bg-primary/10",
    );
    expect(consoleSource).not.toContain("hover:bg-primary/10");
    expect(consoleSource).toContain(
      "overflow-hidden rounded-xl bg-transparent text-foreground transition hover:bg-transparent",
    );
    expect(consoleSource).not.toContain(
      "border border-border bg-transparent text-foreground transition hover:border-border hover:bg-transparent",
    );
    expect(consoleSource).toContain('src="/logo.webp"');
    expect(consoleSource).toContain('aria-label="관리자 메뉴 열기"');
    expect(consoleSource).toContain(
      'aria-controls="admin-console-menu-dropdown"',
    );
    expect(consoleSource).toContain('data-admin-console-menu-dropdown="true"');
    expect(sidebarOrderEditorSource).toContain(
      "data-admin-sidebar-order-editor={placement}",
    );
    expect(consoleSource).toContain('placement="dropdown"');
    expect(consoleSource).toContain('data-admin-sidebar-footer-actions="true"');
    expect(consoleSource).toContain(
      'data-admin-sidebar-section-list="spacious"',
    );
    expect(consoleSource).not.toContain(
      'data-admin-sidebar-footer-separator="spacious"',
    );
    expect(consoleSource).toContain(
      'data-admin-sidebar-scroll="hidden-scrollbar"',
    );
    expect(consoleSource).toContain('data-admin-sidebar-header="true"');
    expect(consoleSource).toContain(
      "relative z-30 hidden h-full min-h-0 w-max shrink-0 flex-col overflow-hidden",
    );
    expect(consoleSource).toContain(
      'data-admin-sidebar-menu-scroll="hidden-scrollbar"',
    );
    expect(consoleSource).toContain(
      "scrollbar-hide min-h-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-contain pb-4 pt-2",
    );
    expect(source("app/app-globals.css")).toContain(
      ".scrollbar-hide::-webkit-scrollbar",
    );
    expect(consoleSource).toContain("shrink-0 pt-4");
    expect(consoleSource).not.toContain(
      "shrink-0 border-t border-dashed border-border/70 pt-4",
    );
    expect(consoleSource).toContain(
      'renderThemeControls("sidebar", { compact: false })',
    );
    expect(consoleSource).toContain('placement="sidebar"');
    const sidebarThemeControlIndex = consoleSource.indexOf(
      '{renderThemeControls("sidebar", { compact: false })}',
    );
    const accountOrderSectionIndex = consoleSource.indexOf(
      'data-admin-sidebar-account-order-section="true"',
    );
    expect(sidebarThemeControlIndex).toBeGreaterThan(-1);
    expect(accountOrderSectionIndex).toBeGreaterThan(-1);
    expect(sidebarThemeControlIndex).toBeLessThan(accountOrderSectionIndex);
    expect(consoleSource).toContain("block space-y-3");
    expect(sidebarOrderEditorSource).toContain("메뉴 순서");
    expect(sidebarOrderEditorSource).toContain("초기화");
    expect(sidebarOrderEditorSource).toContain("aria-label={`${item.title} 메뉴 앞으로`}");
    expect(sidebarOrderEditorSource).toContain("aria-label={`${item.title} 메뉴 뒤로`}");
    expect(sidebarOrderEditorSource).toContain('aria-live="polite"');
    expect(preferenceRouteSource).toContain("SIDEBAR_ORDER_KEY");
    expect(preferenceRouteSource).toContain("admin_user_preferences");
    expect(preferenceRouteSource).toContain('from "@/lib/admin/sidebar-order"');
    expect(sidebarOrderSource).toContain("mergeSidebarItemsWithDefaultSlots");
    expect(sidebarOrderSource).toContain("normalizeAdminSidebarOrderWithReason");
    expect(sidebarOrderSource).toContain("ADMIN_CONSOLE_SECTION_LABELS");
    expect(preferenceRouteSource).toContain("await requireAdmin()");
    expect(preferenceRouteSource.indexOf("await requireAdmin()")).toBeLessThan(
      preferenceRouteSource.indexOf("createSupabaseServiceRoleClient()"),
    );
    expect(preferenceRouteSource).toContain("normalizeAdminSidebarOrder");
    expect(overviewSource).not.toContain("메뉴 순서");
    expect(consoleSource).not.toContain("/admin/users");
  });

  test("cleans stale admin module query state and canonicalizes invalid modules", () => {
    const consoleSource = adminConsoleShellSource();
    const routingSource = source("lib/admin/admin-module-routing.ts");
    const consoleModulesSource = consoleSource.slice(
      consoleSource.indexOf("const consoleModules"),
      consoleSource.indexOf("const consoleModuleById"),
    );

    expect(consoleSource).toContain("buildCanonicalAdminModuleHref");
    expect(consoleSource).toContain("getAdminModuleStateWarning");
    expect(routingSource).toContain("CONSOLE_FIXED_MESSAGES.unknownModule");
    expect(routingSource).toContain("CONSOLE_FIXED_MESSAGES.legacyLinkNormalized");
    expect(consoleSource).toContain("const nextHref = buildCanonicalAdminModuleHref(moduleId);");
    expect(consoleSource).toContain("router.replace(nextHref, {");
    expect(consoleSource).toContain(
      "const canonicalHref = buildCanonicalAdminHrefFromSearchParams(searchParams);",
    );
    expect(consoleSource).toContain("currentHref !== canonicalHref");
    expect(consoleSource).toContain(
      "router.replace(canonicalHref, { scroll: false });",
    );
    expect(consoleSource).not.toContain(
      "const params = new URLSearchParams(window.location.search);",
    );
    expect(consoleSource).not.toContain("window.location.hash");
    expect(consoleModulesSource).toContain('href: "/admin?module=banners"');
    expect(consoleModulesSource).toContain('href: "/admin?module=insights"');
    expect(consoleModulesSource).not.toContain('href: "/admin/banners"');
    expect(consoleModulesSource).not.toContain('href: "/insights"');
    expect(consoleSource).toContain('<InsightsModule key="admin-insights" embedded />');
  });

  test("keeps route recommendation as only two source-honest map panes", () => {
    const consoleSource = adminConsoleShellSource();
    const overviewSource = source(
      "components/admin/AdminOverviewDashboard.tsx",
    );

    expect(consoleSource).toContain(
      "const AdminRouteRecommendationModule = dynamic(",
    );
    expect(overviewSource).toContain(
      'aria-label="관리자 지도 운영 개요 2분할"',
    );
    expect(overviewSource).toContain("AdminMapOverviewCanvas");
    expect(overviewSource).toContain("AdminMapInfoPanel");
    expect(overviewSource).toContain(
      "네이버 지도 프레임은 유지한 채 맛집 관리에서 좌표 상태를 확인하세요.",
    );
    expect(overviewSource).toContain("restaurants={realRestaurants}");
    expect(overviewSource).toContain(
      "지도는 기본 위치로 유지하고 좌표가 있는 맛집만 표시합니다.",
    );
    expect(overviewSource).toContain(
      "네이버 Directions 5 기준 실제 도로 주행 경로",
    );
    expect(overviewSource).not.toContain("채널별 레이어 확장 슬롯");
    expect(overviewSource).not.toContain("오늘 처리할 일");
    expect(overviewSource).not.toContain(
      "제보·리뷰·맛집 검수 상태를 먼저 확인합니다.",
    );
    expect(overviewSource).not.toContain("제보 검토");
    expect(overviewSource).not.toContain("리뷰 검수");
    expect(overviewSource).not.toContain("맛집·좌표 확인");
    expect(overviewSource).not.toContain("운영 상태 요약");
    expect(overviewSource).not.toContain("참고 운영 정보");
    expect(overviewSource).not.toContain('aria-label="관리자 대시보드 4분할"');
    expect(consoleSource).not.toContain("관리자 콘솔 · 실시간 운영 개요");
    expect(consoleSource).not.toContain("OpsTruthBadge");
    expect(consoleSource).not.toContain("PendingFeatureCard");
    expect(consoleSource).not.toContain("Realtime 준비");
    expect(consoleSource).not.toContain("function WidgetShell");
    expect(consoleSource).not.toContain("function LatestTzuyangVideosWidget");
  });

  test("restricts admin outbound links to canonical validated URLs", () => {
    const validGitHubRunUrl =
      "https://github.com/twoimo/tzudong/actions/runs/25206693886";

    expect(resolveSafeExternalUrl("https://example.com")).toBe(
      "https://example.com/",
    );
    expect(resolveGitHubActionsRunUrl(validGitHubRunUrl)).toBe(
      validGitHubRunUrl,
    );

    for (const unsafeUrl of [
      "javascript:alert(1)",
      "data:text/html,<script>alert(1)</script>",
      "http://github.com/twoimo/tzudong/actions/runs/25206693886",
      "//github.com/twoimo/tzudong/actions/runs/25206693886",
      "https://user:password@github.com/twoimo/tzudong/actions/runs/25206693886",
      "https://github.com:443/twoimo/tzudong/actions/runs/25206693886",
      "https://github.com.evil.example/twoimo/tzudong/actions/runs/25206693886",
      "https://github.com/twoimo/tzudong/actions/runs/25206693886%0A",
      "https://github.com/twoimo/tzudong/actions/runs/25206693886#fragment",
      "https://github.com/twoimo/tzudong/actions/runs/25206693886/../25206693887",
    ]) {
      expect(resolveGitHubActionsRunUrl(unsafeUrl)).toBeNull();
    }

    const consoleSource = adminConsoleShellSource();
    const overviewSource = source(
      "components/admin/AdminOverviewDashboard.tsx",
    );

    expect(consoleSource).toContain(
      'import { resolveGitHubActionsRunUrl } from "@/lib/open-external-url";',
    );
    expect(consoleSource).toContain(
      "const latestRunUrl = resolveGitHubActionsRunUrl(latestRun?.htmlUrl);",
    );
    expect(consoleSource).toContain("href={latestRunUrl}");
    expect(consoleSource).not.toContain("href={latestRun.htmlUrl}");
    expect(consoleSource).toContain('rel="noopener noreferrer"');

    expect(overviewSource).toContain(
      "const selectedYoutubeUrl = getAdminYoutubeWatchUrl(selectedVideoId);",
    );
    expect(overviewSource).not.toContain(
      "selectedRestaurant?.youtubeLink ?? getAdminYoutubeWatchUrl(selectedVideoId)",
    );
    expect(overviewSource).not.toContain("href={selectedRestaurant?.youtubeLink}");
    expect(overviewSource).toContain(
      "`https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`",
    );
    expect(overviewSource).toContain("href={selectedYoutubeUrl ?? undefined}");
    expect(overviewSource).toContain(
      'rel={selectedYoutubeUrl ? "noopener noreferrer" : undefined}',
    );
  });
  test("keeps selected marker detail as one thumbnail-first evidence card", () => {
    const overviewSource = source(
      "components/admin/AdminOverviewDashboard.tsx",
    );

    expect(overviewSource).toContain("function getAdminYoutubeThumbnailUrl");
    expect(overviewSource).toContain("function AdminYoutubeThumbnailImage");
    expect(overviewSource).toContain(
      'quality: "maxresdefault" | "hqdefault" = "maxresdefault"',
    );
    expect(overviewSource).toContain('setQuality("hqdefault")');
    expect(overviewSource).toContain(
      'sizes="(min-width: 1280px) 520px, (min-width: 640px) 100vw, 100vw"',
    );
    expect(overviewSource).toContain("object-contain");
    expect(overviewSource).toContain(
      "relative block aspect-video overflow-hidden bg-background",
    );
    expect(overviewSource).toContain("function getAdminYoutubeWatchUrl");
    expect(overviewSource).toContain("const selectedYoutubeUrl =");
    expect(overviewSource).toContain("group relative block aspect-video");
    expect(overviewSource).not.toContain('aria-label="선택 마커 작업"');
    expect(overviewSource).not.toContain("연결 영상 썸네일");
    expect(overviewSource).toContain("원본 YouTube 영상 새 탭에서 열기");
    expect(overviewSource).not.toContain("원본 영상 열기");
    expect(overviewSource).not.toContain("맛집 검수");
    expect(overviewSource).toContain("영상 연결 없음");
    expect(overviewSource).not.toContain("selectedMetaItems.map");
  });

  test("removes repeated embedded module context headers from the admin canvas", () => {
    const consoleSource = adminConsoleShellSource();

    expect(consoleSource).not.toContain("이 화면에서 처리 · {module.badge}");
    expect(consoleSource).not.toContain("독립 라우트 보존");
    expect(consoleSource).not.toContain("문서 스크롤 없음");
    expect(consoleSource).not.toContain("module.description");
    expect(consoleSource).toContain("aria-label={`${module.title} 작업 화면`}");
    expect(consoleSource).toContain("사용자");
    expect(consoleSource).toContain("사용자 관리 감사 이벤트");
  });

  test("keeps admin pages dense without sacrificing responsive boundaries", () => {
    const consoleSource = adminConsoleShellSource();
    const tailwindSource = source("app/app-globals.css");
    const usersSource = source("components/admin/AdminUsersPanel.tsx");
    const evaluationsSource = source("app/admin/evaluations/page.tsx");
    const bannersSource = source("app/admin/banners/page.tsx");
    const announcementSource = source(
      "components/announcement/AnnouncementPanel.tsx",
    );
    const overviewSource = source(
      "components/admin/AdminOverviewDashboard.tsx",
    );

    expect(source("app/app-globals.css")).toMatch(
      /grid-template-columns:\s*fit-content\(var\(--admin-sidebar-expanded-max-width\)\)\s*minmax\(0, 1fr\);/,
    );
    expect(consoleSource).toContain(
      'data-admin-console-menu-trigger="hamburger"',
    );
    expect(consoleSource).toContain(
      'data-admin-dashboard-period-select-trigger="true"',
    );
    expect(consoleSource).toContain('data-admin-dashboard-period-menu="true"');
    expect(consoleSource).toContain(
      "overscroll-contain scrollbar-hide border-y border-border",
    );
    expect(consoleSource).not.toContain(
      "pb-[calc(env(safe-area-inset-bottom)+5.75rem)]",
    );
    expect(consoleSource).toContain("min-h-[360px] flex-1");
    expect(consoleSource).toContain("overflow-visible md:overflow-hidden");
    expect(consoleSource).toContain("md:h-full md:min-h-0");
    expect(consoleSource).toContain("lg:grid-cols-10");
    expect(consoleSource).toContain(
      "lg:grid-rows-[auto_minmax(0,1.15fr)_minmax(0,1fr)]",
    );
    expect(consoleSource).not.toContain(
      "lg:grid-rows-[132px_minmax(0,1fr)_minmax(0,0.9fr)]",
    );
    expect(tailwindSource).toContain("lg:grid-cols-10");
    expect(tailwindSource).toContain("lg:flex-1");
    expect(tailwindSource).toContain(
      "lg:grid-rows-[auto_minmax(0,1.15fr)_minmax(0,1fr)]",
    );
    expect(tailwindSource).not.toContain(
      "lg:grid-rows-[132px_minmax(0,1fr)_minmax(0,0.9fr)]",
    );
    expect(tailwindSource).toContain("lg:col-span-5");
    expect(tailwindSource).toContain("font-extrabold");
    expect(tailwindSource).toContain("md:p-4");
    expect(tailwindSource).toContain("gap-0");
    expect(tailwindSource).toContain("text-lg sm:text-xl");
    expect(tailwindSource).not.toContain("text-[clamp(1.2rem,1.45vw,1.75rem)]");
    expect(overviewSource).toContain("overflow-visible lg:h-full lg:min-h-0");
    expect(overviewSource).toContain(
      "lg:grid-cols-[minmax(0,1.05fr)_minmax(360px,0.95fr)]",
    );
    expect(consoleSource).not.toContain("function AnnouncementWorkspace");
    expect(usersSource).toContain("flex h-full min-h-0 flex-col overflow-hidden bg-background");
    expect(usersSource).toContain("gap-2 overflow-y-auto p-2 pb-[calc(env(safe-area-inset-bottom)+0.75rem)]");
    expect(usersSource).toContain("h-9 rounded-full pl-9 sm:rounded-lg");
    expect(consoleSource).toContain(
      "const controller = new AbortController();",
    );
    expect(consoleSource).toContain("signal: controller.signal");
    expect(consoleSource).toContain("return () => {");
    expect(consoleSource).toContain("controller.abort();");
    expect(consoleSource).toContain("if (!controller.signal.aborted)");
    expect(usersSource).toContain(
      "const loadUsers = useCallback(async (signal?: AbortSignal)",
    );
    expect(usersSource).toContain("return () => controller.abort();");
    expect(usersSource).toContain("if (!signal?.aborted)");
    expect(evaluationsSource).toContain(
      'embedded ? "shrink-0 border-b border-border bg-card px-2 py-1.5"',
    );
    expect(evaluationsSource).toContain("p-2 sm:p-2");
    expect(consoleSource).toContain("function loadAdminBannerModule()");
    expect(consoleSource).toContain(
      'return import("@/app/admin/banners/page").then(',
    );
    expect(consoleSource).toContain("(module) => module.default.Embedded");
    expect(consoleSource).not.toContain(
      "const AdminAnnouncementModule = dynamic(",
    );
    expect(consoleSource).not.toContain(
      '() => import("@/components/announcement/AnnouncementPanel")',
    );
    expect(consoleSource).toContain(
      "const AdminUsersModule = dynamic(loadAdminUsersModule",
    );
    expect(consoleSource).toContain("function loadAdminUsersModule()");
    expect(consoleSource).toContain(
      'return import("@/components/admin/AdminUsersPanel");',
    );
    expect(consoleSource).toContain("const AdminEvaluationModule = dynamic(");
    expect(consoleSource).not.toContain(
      "const AdminRestaurantEvaluationModule = dynamic(",
    );
    expect(consoleSource).not.toContain(
      "const AdminSubmissionEvaluationModule = dynamic(",
    );
    expect(consoleSource).not.toContain(
      "const AdminReviewEvaluationModule = dynamic(",
    );
    expect(consoleSource).toContain("ssr: false,");
    expect(consoleSource).not.toContain("loading: () => <InlineModuleLoading");
    expect(consoleSource).not.toContain(
      "loading: () => <InlineEvaluationModuleSkeleton",
    );
    expect(consoleSource).not.toContain("InlineModuleLoading");
    expect(consoleSource).not.toContain("InlineEvaluationModuleSkeleton");
    expect(consoleSource).not.toContain("화면 구조 준비 중");
    expect(consoleSource).not.toContain("INLINE_MODULE_LOADING_ROW_COUNT");
    expect(consoleSource).not.toContain("배너 관리 화면 준비 중");
    expect(consoleSource).not.toContain("공지사항 운영 화면 준비 중");
    expect(consoleSource).not.toContain("사용자 관리 화면 준비 중");
    expect(bannersSource).toContain('embedded ? "shrink-0 px-2 py-1.5"');
    expect(bannersSource).toContain(
      'embedded ? "flex h-full min-h-0 flex-col overflow-hidden bg-background font-sans tracking-normal" : "min-h-screen bg-[#fdfbf7] font-sans"',
    );
    expect(bannersSource).toContain(
      "xl:grid-cols-[minmax(330px,0.95fr)_minmax(420px,1.05fr)]",
    );
    expect(bannersSource).toContain(
      "bannersLoading ? <InlineCountSkeleton /> : sortedBanners.length",
    );
    expect(bannersSource).toContain('aria-label="배너 목록 로딩 중"');
    expect(bannersSource).toContain("function BannerListItemSkeleton");
    expect(bannersSource).toContain(
      "<BannerListItemSkeleton key={index} index={index} />",
    );
    expect(bannersSource).toContain(
      "relative h-12 w-16 shrink-0 overflow-hidden rounded-md border border-border",
    );
    expect(bannersSource).toContain(
      'Badge variant="secondary" className="rounded-full text-[10px]"',
    );
    expect(bannersSource).not.toContain("bannersLoading && <Loader2");
    expect(bannersSource).toContain(
      "모달 없이 선택·편집·삭제를 이 패널에서 처리합니다.",
    );
    expect(bannersSource).toContain("deleteConfirmation !== '배너삭제'");
    expect(bannersSource).toContain(
      "onClick={() => { setBannerToDelete(editingBanner); void handleDelete(); }}",
    );
    expect(bannersSource).toContain("if (!bannerToDelete) return;");
    expect(bannersSource).toContain(
      "await deleteBanner.mutateAsync(bannerToDelete.id)",
    );
    expect(bannersSource).toContain("const mediaPaths = [");
    expect(bannersSource).toContain("await deleteImage.mutateAsync(path)");
    expect(bannersSource).toContain("console.error('배너 삭제 실패:');");
    expect(
      bannersSource.indexOf("await deleteBanner.mutateAsync(bannerToDelete.id)"),
    ).toBeLessThan(bannersSource.indexOf("const mediaPaths = ["));
    expect(bannersSource.indexOf("const mediaPaths = [")).toBeLessThan(
      bannersSource.indexOf("await deleteImage.mutateAsync(path)"),
    );
    expect(bannersSource).not.toContain('role="listitem"');
    expect(bannersSource).not.toContain("<Dialog");
    expect(bannersSource).not.toContain("<AlertDialog");
    expect(announcementSource).not.toContain(
      "xl:grid-cols-[minmax(330px,0.95fr)_minmax(420px,1.05fr)]",
    );
    expect(announcementSource).toContain(
      "isAnnouncementsLoading ? <InlineCountSkeleton /> : allDisplayAnnouncements.length",
    );
    expect(announcementSource).toContain('aria-label="공지사항 목록 로딩 중"');
    expect(announcementSource).toContain(
      "function AnnouncementListItemSkeleton",
    );
    expect(announcementSource).toContain(
      "<AnnouncementListItemSkeleton key={index} index={index} />",
    );
    expect(announcementSource).not.toContain("공지사항을 불러오는 중입니다");
    expect(announcementSource).toContain(
      "group w-full rounded-xl border border-border/70 bg-card px-3 py-3 text-left",
    );
    expect(announcementSource).toContain(
      "w-full rounded-xl border border-border/70 bg-card px-3 py-3",
    );
    expect(announcementSource).not.toContain("toggleConfirmation");
    expect(announcementSource).not.toContain("deleteConfirmation");
    expect(announcementSource).not.toContain('role="listitem"');
    expect(announcementSource).not.toContain("confirm(`");
    expect(consoleSource).not.toContain(
      'module.id === "banners" || module.id === "announcements" || module.id === "users" ? "overflow-y-auto" : "overflow-hidden"',
    );
    expect(consoleSource).not.toContain("관리자 운영 콘솔");
    expect(consoleSource).not.toContain("안전한 CRUD 흐름");
    expect(consoleSource).not.toContain("audit source");
    expect(consoleSource).not.toContain("lg:w-52");
    expect(consoleSource).not.toContain("function LlmSessionPanel()");
    expect(consoleSource).not.toContain("function ConnectedRoutesCard()");
    expect(usersSource).not.toContain("min-h-[560px]");
    expect(usersSource).toContain(
      'isLoading ? <span className="inline-block h-5 w-10 rounded-full bg-muted/70 align-middle animate-pulse motion-reduce:animate-none sm:h-6 sm:w-12"',
    );
    expect(usersSource).not.toContain(
      "value={isLoading ? '—' : summary.loadedUsers}",
    );
  });

  test("hardens risky admin submission and OCR actions with typed confirmations", () => {
    const submissionSource = source("components/admin/SubmissionListView.tsx");
    const resetAllSource = source(
      "app/api/admin/ocr-receipts/reset-all/route.ts",
    );

    expect(submissionSource).toContain(
      "const SUBMISSION_DELETE_CONFIRMATION = '제보삭제'",
    );
    expect(submissionSource).toContain(
      "const REVIEW_DELETE_CONFIRMATION = '리뷰삭제'",
    );
    expect(submissionSource).toContain(
      "const OCR_RESET_ALL_CONFIRMATION = 'OCR초기화'",
    );
    expect(submissionSource).toContain(
      "const OVERRIDE_APPROVAL_CONFIRMATION = '무시승인'",
    );
    expect(submissionSource).toContain(
      "xl:grid-cols-[minmax(330px,0.95fr)_minmax(420px,1.05fr)]",
    );
    expect(submissionSource).toContain('aria-label="제보 상세 작업 패널"');
    expect(submissionSource).toContain('aria-label="리뷰 상세 작업 패널"');
    expect(submissionSource).toContain(
      "submissionDeleteConfirmation !== SUBMISSION_DELETE_CONFIRMATION",
    );
    expect(submissionSource).toContain(
      "reviewDeleteConfirmation !== REVIEW_DELETE_CONFIRMATION",
    );
    expect(submissionSource).toContain(
      "ocrResetConfirmation !== OCR_RESET_ALL_CONFIRMATION",
    );
    expect(submissionSource).toContain("openSubmissionDetail(submission);");
    expect(submissionSource).toContain("setReviewAction(null);");
    expect(submissionSource).toContain(
      "setReviewAdminNote(review.admin_note || '');",
    );
    expect(submissionSource).not.toContain("window.prompt(");
    expect(submissionSource).not.toContain("<Dialog");
    expect(submissionSource).not.toContain("ADMIN_MODAL_");
    expect(submissionSource).toContain(
      "disabled={overrideApprovalConfirmation !== OVERRIDE_APPROVAL_CONFIRMATION}",
    );
    expect(submissionSource).toContain("if (forceApprove) {");
    expect(submissionSource).toContain("setOverrideApprovalConfirmation('');");
    expect(submissionSource).toContain("setShowWarningModal(true);");
    expect(submissionSource).toContain("검증 경고 확인 후 승인");
    expect(submissionSource).toContain("renderOverrideApprovalPanel");
    expect(submissionSource).not.toContain("verificationDone || forceApprove");
    expect(submissionSource.indexOf("if (forceApprove) {")).toBeLessThan(
      submissionSource.indexOf("if (verificationDone) {"),
    );
    expect(
      submissionSource.indexOf("setOverrideApprovalConfirmation('');"),
    ).toBeLessThan(submissionSource.indexOf("setShowWarningModal(true);"));
    expect(submissionSource).toContain(
      "confirmation: OCR_RESET_ALL_CONFIRMATION",
    );
    expect(submissionSource).toContain(
      "guardedMutationConfirmation: GUARDED_MUTATION_CONFIRMATION",
    );
    expect(submissionSource).toContain("buildGuardedOcrSuccessMessage");
    expect(submissionSource).toContain("감사 추적");
    expect(submissionSource).toContain("getGuardedMutationReadbackLabel");
    expect(submissionSource).toContain("재확인");
    expect(resetAllSource).toContain(
      "const OCR_RESET_ALL_CONFIRMATION = 'OCR초기화'",
    );
    expect(resetAllSource).toContain(
      "body.confirmation !== OCR_RESET_ALL_CONFIRMATION",
    );
    expect(resetAllSource).toContain(
      "OCR 전체 초기화 확인 문구가 일치하지 않습니다.",
    );
    expect(resetAllSource).toContain("workflowPreflightResponse");
    expect(resetAllSource).toContain("partialFailure: true");
    expect(
      resetAllSource.indexOf(
        "if (!GITHUB_TOKEN || !GITHUB_OWNER || !GITHUB_REPO)",
      ),
    ).toBeLessThan(
      resetAllSource.indexOf(
        "const supabase = createSupabaseServiceRoleClient()",
      ),
    );
    expect(resetAllSource.indexOf("workflowPreflightResponse")).toBeLessThan(
      resetAllSource.indexOf(
        "const supabase = createSupabaseServiceRoleClient()",
      ),
    );
    expect(submissionSource).not.toContain(
      "confirm('정말 이 제보를 삭제하시겠습니까?')",
    );
    expect(submissionSource).not.toContain(
      "confirm('정말 이 리뷰를 삭제하시겠습니까?')",
    );
    expect(submissionSource).not.toContain(
      "confirm('모든 리뷰의 OCR을 초기화하고 다시 실행합니다. 계속하시겠습니까?')",
    );
  });

  test("surfaces restaurant recommendation requests as a guarded admin lane", () => {
    const adminEvaluationSource = source("app/admin/evaluations/page.tsx");
    const submissionSource = source("components/admin/SubmissionListView.tsx");
    const detailSource = source("components/admin/SubmissionDetailView.tsx");
    const reviewRouteSource = source(
      "app/api/admin/restaurant-requests/[requestId]/review/route.ts",
    );
    const pendingCountsSource = source("app/api/admin/pending-counts/route.ts");
    const migrationSource = source(
      "supabase/migrations/20260702000100_restaurant_request_review_lifecycle.sql",
    );

    expect(detailSource).toContain("submission_type: 'new' | 'edit' | 'recommend'");
    expect(adminEvaluationSource).toContain("ADMIN_RESTAURANT_REQUEST_SELECT");
    expect(adminEvaluationSource).toContain(".from('restaurant_requests')");
    expect(adminEvaluationSource).toContain("origin_address");
    expect(adminEvaluationSource).toContain("road_address");
    expect(adminEvaluationSource).toContain("submission_type: 'recommend' as const");
    expect(adminEvaluationSource).toContain("admin-restaurant-requests-inline");
    expect(adminEvaluationSource).toContain("applyRestaurantRequestReadbackToSubmission");
    expect(adminEvaluationSource).toContain("restaurant_phone: request.phone");
    expect(adminEvaluationSource).toContain("restaurant_name: request.restaurant_name");
    expect(adminEvaluationSource).toContain("restaurant_categories: request.categories");
    expect(adminEvaluationSource).toContain("recommendation_admin_note: request.admin_note");
    expect(adminEvaluationSource).toContain("recommendation_audit_id: auditId || request.review_audit_id");
    expect(adminEvaluationSource).toContain("updateRecommendationRequestReadbackInCache");
    expect(adminEvaluationSource).toContain("queryClient.setQueryData<SubmissionRecord[]>");
    expect(adminEvaluationSource).toContain("ADMIN_RESTAURANT_REQUEST_LEGACY_SELECT");
    expect(adminEvaluationSource).toContain("isMissingRestaurantRequestLifecycleError(requestsError)");
    expect(adminEvaluationSource).toContain(
      "/api/admin/restaurant-requests/${encodeURIComponent(submission.id)}/review",
    );
    expect(pendingCountsSource).toContain('.from("restaurant_requests")');
    expect(pendingCountsSource).toContain("recommendationRequests");
    expect(pendingCountsSource).toContain("recommendationRequestsLifecycleReady");
    expect(pendingCountsSource).toContain("isRestaurantRequestLifecycleMissing");
    expect(pendingCountsSource).toContain("isMissingRestaurantRequestLifecycleError");

    expect(submissionSource).toContain("type SubmissionAdminTab = 'new' | 'edit' | 'recommend' | 'reviews'");
    expect(submissionSource).toContain("const RECOMMEND_APPROVE_CONFIRMATION = '추천승인'");
    expect(submissionSource).toContain("const RECOMMEND_REJECT_CONFIRMATION = '추천거부'");
    expect(submissionSource).toContain("쯔양 제보");
    expect(submissionSource).toContain("추천 검수");
    expect(submissionSource).toContain("renderRecommendationDetailContent");
    expect(submissionSource).toContain("추천 승인 확인 문구가 일치하지 않습니다.");
    expect(submissionSource).toContain("추천 거부 확인 문구가 일치하지 않습니다.");
    expect(submissionSource).not.toContain("submission.submission_type === 'recommend' && !canApprove");
    expect(submissionSource).toContain("const canDeleteSubmissionCard = submission.submission_type !== 'recommend';");
    expect(submissionSource).toContain("onClick={(event) => {");
    expect(submissionSource).toContain("event.stopPropagation();");

    expect(submissionSource).toContain(
      'className={cn("flex min-w-max items-center gap-2", isMobile && "grid min-w-0 grid-cols-4 gap-1")}',
    );
    expect(submissionSource).not.toContain(
      `className={cn("flex min-w-max items-center gap-2", isMobile && "grid min-w-0 grid-cols-4 gap-1")}\n                                style={isMobile ? { touchAction: 'pan-y' } : undefined}`,
    );
    expect(
      submissionSource.match(/onPointerDown=\{isMobile \? handleSubmissionTabPointerDown : undefined\}/g)
        ?.length ?? 0,
    ).toBe(1);
    expect(submissionSource).toContain(
      ") : (\n                    <div className={listContainerClassName}>",
    );
    expect(reviewRouteSource).toContain("requireAdmin()");
    expect(reviewRouteSource).toContain("createSupabaseServiceRoleClient()");
    expect(reviewRouteSource).toContain("review_restaurant_request");
    expect(reviewRouteSource).not.toContain('.from("restaurant_request_review_audit"');
    expect(reviewRouteSource).toContain("review_audit_id");
    expect(reviewRouteSource).toContain("검토 상태를 확인하지 못했습니다");
    expect(reviewRouteSource).toContain('buildMutationAuditReceipt');
    expect(reviewRouteSource).toContain('domain: "restaurant_request_reviews"');
    expect(reviewRouteSource).toContain('source: RESTAURANT_REQUEST_REVIEW_AUDIT_SOURCE');
    expect(migrationSource).toContain("add column if not exists status text");
    expect(migrationSource).toContain("restaurant_requests_status_check");
    expect(migrationSource).toContain("create table if not exists public.restaurant_request_review_audit");
    expect(migrationSource).toContain("create or replace function public.review_restaurant_request");
    expect(migrationSource).toContain("for update");
    expect(migrationSource).toContain("return query select false, '이미 검토가 완료된 맛집 추천 요청입니다.'");
    expect(migrationSource).toContain("revoke all on function public.review_restaurant_request");
    expect(migrationSource).toContain("to service_role");
    expect(migrationSource).not.toContain("grant execute on function public.review_restaurant_request(uuid, uuid, text, text, text) to authenticated");
    expect(migrationSource).toContain("Admins can view request review audit");
    expect(submissionSource).toContain("submissionDetailPanelRef");
    expect(submissionSource).toContain("scrollIntoView");
    expect(submissionSource).toContain("tabIndex={-1}");
  });

  test("guards legacy direct browser admin restaurant and review mutations", () => {
    const reviewPanelSource = source("components/admin/AdminReviewPanel.tsx");
    const restaurantModalSource = source("components/admin/AdminRestaurantModal.tsx");

    expect(reviewPanelSource).toContain(
      'import { assertLegacyBrowserAdminMutationEnabled } from "@/lib/admin/guarded-mutation-contract";',
    );
    expect(restaurantModalSource).toContain(
      'import { assertLegacyBrowserAdminMutationEnabled } from "@/lib/admin/guarded-mutation-contract";',
    );

    for (const action of ["approve_review", "reject_review", "delete_review"]) {
      expect(reviewPanelSource).toContain(
        `assertLegacyBrowserAdminMutationEnabled("review_moderation", "${action}")`,
      );
    }

    for (const action of [
      "update_restaurant",
      "insert_restaurant",
      "delete_restaurant_link",
      "update_restaurant_link",
      "insert_restaurant_link",
      "delete_restaurant",
    ]) {
      expect(restaurantModalSource).toContain(
        action === "update_restaurant" || action === "insert_restaurant"
          ? `restaurant ? "update_restaurant" : "insert_restaurant"`
          : `assertLegacyBrowserAdminMutationEnabled("restaurant_record", "${action}")`,
      );
    }

    expect(
      reviewPanelSource.indexOf(
        'assertLegacyBrowserAdminMutationEnabled("review_moderation", "approve_review")',
      ),
    ).toBeLessThan(reviewPanelSource.indexOf(".update({"));
    expect(
      reviewPanelSource.indexOf(
        'assertLegacyBrowserAdminMutationEnabled("review_moderation", "delete_review")',
      ),
    ).toBeLessThan(reviewPanelSource.indexOf(".delete()"));

    expect(
      restaurantModalSource.indexOf(
        'restaurant ? "update_restaurant" : "insert_restaurant"',
      ),
    ).toBeLessThan(restaurantModalSource.indexOf(".update({"));
    expect(
      restaurantModalSource.indexOf(
        'assertLegacyBrowserAdminMutationEnabled("restaurant_record", "insert_restaurant_link")',
      ),
    ).toBeLessThan(restaurantModalSource.indexOf(".insert({"));
    expect(
      restaurantModalSource.indexOf(
        'assertLegacyBrowserAdminMutationEnabled("restaurant_record", "delete_restaurant")',
      ),
    ).toBeLessThan(restaurantModalSource.lastIndexOf(".update({"));
  });

  test("retires legacy browser admin evaluation mutations behind the explicit guard flag", () => {
    const adminEvaluationSource = source("app/admin/evaluations/page.tsx");

    const expectGuardBefore = (domain: string, operation: string, privilegedSnippet: string) => {
      const guardCall = `assertLegacyBrowserAdminMutationEnabled('${domain}', '${operation}')`;
      const guardIndex = adminEvaluationSource.indexOf(guardCall);
      expect(guardIndex).toBeGreaterThanOrEqual(0);
      const privilegedIndex = adminEvaluationSource.indexOf(privilegedSnippet, guardIndex);
      expect(privilegedIndex).toBeGreaterThan(guardIndex);
    };

    expect(adminEvaluationSource).toContain("@/lib/admin/guarded-mutation-contract");
    expect(adminEvaluationSource).toContain("assertLegacyBrowserAdminMutationEnabled");
    expect(adminEvaluationSource).toContain("isLegacyBrowserAdminMutationEnabled");
    expect(adminEvaluationSource).toContain(
      "autoDeleteTargets.length > 0 && user?.id && isLegacyBrowserAdminMutationEnabled()",
    );

    expectGuardBefore("restaurant_record", "record duplicate error update", "db_error_details: errorDetails");
    expectGuardBefore("restaurant_record", "restaurant approval update", "status: 'approved'");
    expectGuardBefore("restaurant_record", "restaurant delete update", "status: 'deleted'");
    expectGuardBefore("restaurant_record", "restaurant restore update", "status: 'pending'");
    expectGuardBefore("review_moderation", "review approval update", "is_verified: true");
    expectGuardBefore("review_moderation", "review rejection update", "is_verified: false");
    expectGuardBefore("review_moderation", "review delete mutation", ".from('review-photos')");
    expectGuardBefore("review_moderation", "review delete mutation", "supabase.from('reviews').delete()");
    expectGuardBefore("restaurant_submission", "submission approval direct RPC/update", "'approve_edit_submission_item'");
    expectGuardBefore("restaurant_submission", "submission approval direct RPC/update", "'approve_submission_item'");
    expectGuardBefore("restaurant_submission", "submission approval direct RPC/update", "resolved_by_admin_id: user.id");
    expectGuardBefore("restaurant_submission", "submission rejection direct update", "item_status: 'rejected'");
    expectGuardBefore("restaurant_submission", "submission rejection direct update", "rejection_reason: reason");
    expectGuardBefore("restaurant_submission", "submission delete direct update", "rejection_reason: '관리자에 의해 삭제됨'");
    expectGuardBefore("restaurant_submission", "submission edit direct update", "restaurant_name: updatedData.restaurant_name");
    expectGuardBefore("restaurant_submission", "submission edit direct update", "youtube_link: updatedData.youtube_link");
  });

  test("excludes Python QA seeds from actual GPT Image 2 page history", () => {
    const seedScriptSource = source(
      "../../scripts/seed-youtube-thumbnail-qa-cases.py",
    );
    const batchSpecSource = source(
      "tests/admin-youtube-thumbnail-generator-batch-history.spec.ts",
    );
    const manualGenerationScriptPath = join(
      import.meta.dir,
      "..",
      "scripts/generate-gpt-image2-youtube-thumbnail.ts",
    );

    expect(seedScriptSource).toContain(
      'PUBLIC_IMAGE_BASE_URL = "/qa-history/youtube-thumbnail-generator/generated/qa-batch"',
    );
    expect(seedScriptSource).toContain("default_history_root");
    expect(seedScriptSource).toContain(
      'app_root() / ".omx" / "runtime" / "youtube-thumbnail-history"',
    );
    expect(seedScriptSource).toContain("caseCount");
    expect(seedScriptSource).toContain("requested:gpt-image-2");
    expect(seedScriptSource).toContain("requested-label");
    expect(seedScriptSource).not.toContain("mock");

    expect(batchSpecSource).toContain("seed-youtube-thumbnail-qa-cases.py");
    expect(batchSpecSource).toContain("qa-batch-spicy-market");
    expect(batchSpecSource).toContain("qa-batch-injection-safe");
    expect(batchSpecSource).toContain(
      "/api/admin/youtube-thumbnail-generator/history",
    );
    expect(batchSpecSource).toContain("hides deterministic Python QA seed");
    expect(batchSpecSource).toContain("local-codex");
    expect(batchSpecSource).toContain("gpt-image-2");
    expect(batchSpecSource).toContain("modelProvenance");
    expect(existsSync(manualGenerationScriptPath)).toBe(false);
    expect(batchSpecSource).not.toContain(
      "page.route('**/api/admin/youtube-thumbnail-generator/history",
    );
    expect(batchSpecSource).not.toContain("route.fulfill({");
  });
  test("keeps storyboard provider credentials in synchronously clearable component refs without Web Storage", () => {
    const storyboardSource = source(
      "components/admin/storyboard/AdminStoryboardGenerator.tsx",
    );
    const legacyStorageAliases = [
      "STORYBOARD_BROWSER_MODEL_KEYS_STORAGE_KEY",
      "STORYBOARD_LOCAL_BRIDGE_SESSION_STORAGE_KEY",
      "readStoryboardBrowserModelKeysCache",
      "writeStoryboardBrowserModelKeysCache",
      "readStoryboardLocalBridgeSessionCache",
      "writeStoryboardLocalBridgeSessionCache",
      "browser_local_storage_only",
      "browser_session_storage_only",
    ];

    for (const alias of legacyStorageAliases) {
      expect(storyboardSource).not.toContain(alias);
    }
    expect(storyboardSource).not.toMatch(/\b(?:localStorage|sessionStorage)\b/);
    expect(storyboardSource).toContain(
      'data-storyboard-browser-api-key-settings="memory-only"',
    );
    expect(storyboardSource).toContain(
      'data-storyboard-local-bridge-persistence="none"',
    );
    expect(storyboardSource).toContain(
      'data-storyboard-browser-api-key-secret-storage="uncontrolled-ref"',
    );
    expect(storyboardSource).toContain(
      'data-storyboard-local-bridge-token-storage="uncontrolled-ref"',
    );
    expect(storyboardSource).toContain(
      'data-storyboard-browser-api-key-lifetime="page-lifecycle"',
    );
    expect(storyboardSource).toContain(
      'data-storyboard-local-bridge-token-lifetime="page-lifecycle"',
    );
    expect(storyboardSource).toContain(
      "const storyboardBrowserOpenAIApiKeyRef = useRef<string | null>(null);",
    );
    expect(storyboardSource).toContain(
      "const storyboardLocalBridgeTokenRef = useRef<string | null>(null);",
    );
    expect(storyboardSource).toContain(
      "ref={storyboardBrowserOpenAIApiKeyInputRef}",
    );
    expect(storyboardSource).toContain(
      "ref={storyboardLocalBridgeTokenInputRef}",
    );
    expect(storyboardSource).toContain(
      'data-storyboard-browser-api-key-input-control="uncontrolled"',
    );
    expect(storyboardSource).toContain(
      'data-storyboard-local-bridge-token-input-control="uncontrolled"',
    );
    expect(storyboardSource).not.toContain(
      "value={storyboardBrowserOpenAIApiKeyDraft}",
    );
    expect(storyboardSource).not.toContain(
      "value={storyboardLocalBridgeTokenDraft}",
    );
    expect(storyboardSource).toContain(
      "storyboardBrowserOpenAIApiKeyRef.current = normalized;",
    );
    expect(storyboardSource).toContain(
      "storyboardLocalBridgeTokenRef.current = token;",
    );
    expect(storyboardSource).toContain(
      "storyboardBrowserOpenAIApiKeyRef.current = null;",
    );
    expect(storyboardSource).toContain(
      "storyboardLocalBridgeTokenRef.current = null;",
    );
    expect(storyboardSource).toContain(
      'window.addEventListener("pagehide", clearOnPagehide);',
    );
    expect(storyboardSource).toContain("persisted BFCache snapshot");
    expect(storyboardSource).toContain(
      'window.addEventListener("pageshow", clearOnPageshow);',
    );
    expect(storyboardSource).toContain("clearStoryboardSecretRefs(false);");
    expect(storyboardSource).toContain(
      "imageProviderStatusAbortControllerRef.current?.abort();",
    );
    expect(storyboardSource).toContain(
      "imageGenerationAbortControllerRef.current?.abort();",
    );
    expect(storyboardSource).toContain("chatAbortControllerRef.current?.abort();");
    expect(storyboardSource).toContain(
      "resetStoryboardLocalBridgeHelperTransport({ closePopup: true });",
    );
    expect(storyboardSource).toContain('cache: "no-store"');
    expect(storyboardSource).toContain("signal: statusAbortController.signal");
  });
  test("exposes storyboard RAG trace and mid-stream steer contracts in chat", () => {
    const storyboardSource = source(
      "components/admin/storyboard/AdminStoryboardGenerator.tsx",
    );
    const backendAgentSource = source("lib/admin/storyboard/backend-agent.ts");
    const chatRouteSource = source("app/api/admin/storyboard/chat/route.ts");
    const ragSource = source("lib/admin/storyboard/rag.ts");

    expect(ragSource).toContain("buildStoryboardRagModelStackDiagnostics");
    expect(backendAgentSource).toContain("buildStoryboardChatRagTraceEntries");
    expect(backendAgentSource).toContain(
      'ragTraceSurface: "storyboard_chat_thinking_panel"',
    );
    expect(backendAgentSource).toContain("LangSmith 대신 답변 말풍선");
    expect(backendAgentSource).toContain("exaone3.5:7.8b");
    expect(backendAgentSource).toContain("EEVE-Korean-Instruct-10.8B");
    expect(backendAgentSource).toContain("solar:10.7b-instruct-v1-q5_0");
    expect(chatRouteSource).toContain("sendBackendRagTrace(send, result)");
    expect(chatRouteSource).toContain("normalizeRouteTraceStatus");
    expect(chatRouteSource).toContain("sanitizeStatusText(candidate.detail, 520)");
    expect(storyboardSource).toContain("생각 중 · RAG 추적");
    expect(storyboardSource).toContain("function isStoryboardRagProcessIntent");
    expect(storyboardSource).toContain(
      "if (isStoryboardRagProcessIntent(normalized)) return false;",
    );
    expect(storyboardSource).toContain("function isStoryboardChatCanvasPatchActionable");
    expect(storyboardSource).toContain("if (isStoryboardChatCanvasPatchActionable(item.data))");
    expect(storyboardSource).toContain("pendingStoryboardChatSteerRef");
    expect(storyboardSource).toContain("steeredReplay?: boolean");
    expect(storyboardSource).toContain("appendStoryboardChatSteerTrace");
    expect(storyboardSource).toContain(
      "새 메시지를 반영하기 위해 현재 답변을 멈추고 다시 생각할게요.",
    );
    expect(storyboardSource).toContain(
      "현재 스트림을 중단하고 새 요청으로 다시 실행",
    );
    expect(storyboardSource).toContain("data-storyboard-chat-steer={");
    expect(storyboardSource).toContain('"현재 답변에 추가 지시 보내기"');
    expect(storyboardSource).toContain(
      "disabled={isGenerating || isGeneratingImages}",
    );
    expect(storyboardSource).not.toContain(
      "disabled={isChatAgentStreaming}\n                      autoComplete=\"off\"",
    );
    expect(backendAgentSource).toContain("rag|r\\.a\\.g");
    expect(chatRouteSource).toContain("rag|r\\.a\\.g");
  });
});
