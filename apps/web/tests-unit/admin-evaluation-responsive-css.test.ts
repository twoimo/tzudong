import { afterAll, describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { shouldRenderSpeedInsights } from "../app/app-speed-insights";
import { shouldEnableRootSpeedInsights } from "../app/root-speed-insights";
import {
  ADMIN_SIDEBAR_MARKER,
  HOME_ROUTE_CSS_MAX_BYTES,
} from "../scripts/verify-route-css-boundaries.mjs";

const appRoot = resolve(import.meta.dir, "..");
const tempDirs: string[] = [];

const criticalDisplayUtilities = [
  ["md:block", "block"],
  ["md:flex", "flex"],
  ["md:hidden", "none"],
  ["md:inline-flex", "inline-flex"],
  ["lg:table-cell", "table-cell"],
] as const;

const criticalAdminConsoleLayoutUtilities = [
  "lg:border-r",
  "lg:grid",
  "lg:overflow-y-auto",
  "lg:px-0",
  "lg:sticky",
] as const;

const criticalKpiDashboardProductionUtilities = [
  {
    utility: "font-extrabold",
    declarations: ["font-weight:var(--font-weight-extrabold)"],
  },
  {
    utility: "font-black",
    declarations: ["font-weight:var(--font-weight-black)"],
  },
  {
    utility: "md:p-4",
    declarations: ["padding:calc(var(--spacing)*4)"],
  },
  {
    utility: "md:border-y-0",
    declarations: ["border-block-width:0px"],
  },
  {
    utility: "gap-0",
    declarations: ["gap:0"],
  },
  {
    utility: "tracking-[0.01em]",
    declarations: ["letter-spacing:.01em", "letter-spacing:0.01em"],
    match: "any",
  },
  {
    utility: "tracking-[0.04em]",
    declarations: ["letter-spacing:.04em", "letter-spacing:0.04em"],
    match: "any",
  },
  {
    utility: "tracking-[-0.035em]",
    declarations: ["letter-spacing:-.035em", "letter-spacing:-0.035em"],
    match: "any",
  },
  {
    utility: "text-[clamp(1.2rem,1.45vw,1.75rem)]",
    declarations: ["font-size:clamp(1.2rem,1.45vw,1.75rem)"],
  },
  {
    utility: "min-h-[132px]",
    declarations: ["min-height:132px"],
  },
  {
    utility: "grid-rows-[auto_minmax(0,1fr)_auto]",
    declarations: ["grid-template-rows:auto minmax(0,1fr) auto"],
  },
  {
    utility: "grid-cols-[5.5rem_minmax(0,1fr)_3rem]",
    declarations: ["grid-template-columns:5.5rem minmax(0,1fr) 3rem"],
  },
] as const;
const criticalMobileMapOverlayPositionUtilities = [
  {
    utility: "top-[calc(env(safe-area-inset-top)_+_126px)]",
    declarations: ["top:calc(env(safe-area-inset-top) + 126px)"],
  },
  {
    utility: "bottom-[calc(var(--mobile-bottom-nav-effective-height,var(--mobile-bottom-nav-height,60px))_+_env(safe-area-inset-bottom)_+_0.75rem)]",
    declarations: [
      "bottom:calc(var(--mobile-bottom-nav-effective-height,var(--mobile-bottom-nav-height,60px)) + env(safe-area-inset-bottom) + .75rem)",
      "bottom:calc(var(--mobile-bottom-nav-effective-height,var(--mobile-bottom-nav-height,60px)) + env(safe-area-inset-bottom) + 0.75rem)",
    ],
    match: "any",
  },
  {
    utility: "z-[61]",
    declarations: ["z-index:61"],
  },
  {
    utility: "z-[70]",
    declarations: ["z-index:70"],
  },
] as const;


afterAll(() => {
  for (const dir of tempDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function escapeCssClass(className: string) {
  return className.replace(/([:,.[\]()+/%])/g, "\\$1");
}

function compactCss(value: string) {
  return value.replace(/\s+/g, "");
}
function getRuleBlock(css: string, escapedClass: string) {
  const selector = `.${escapedClass}`;
  let searchFrom = 0;

  while (searchFrom < css.length) {
    const selectorIndex = css.indexOf(selector, searchFrom);
    if (selectorIndex === -1) {
      break;
    }

    const before = css.slice(0, selectorIndex).trimEnd().at(-1);
    const afterSelector = css.slice(selectorIndex + selector.length);
    const after = afterSelector.trimStart().at(0);
    const isStandaloneRule =
      (before === undefined || before === "{" || before === "}") &&
      after === "{";

    if (isStandaloneRule) {
      const blockStart = css.indexOf("{", selectorIndex + selector.length);
      const blockEnd = css.indexOf("}", blockStart);
      expect(blockStart, `${selector} should open a CSS rule`).toBeGreaterThan(
        selectorIndex,
      );
      expect(blockEnd, `${selector} should close a CSS rule`).toBeGreaterThan(
        blockStart,
      );

      return css.slice(blockStart + 1, blockEnd);
    }

    searchFrom = selectorIndex + selector.length;
  }

  throw new Error(`${selector} should be emitted as a standalone CSS rule`);
}


function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

describe("admin responsive CSS guard", () => {
  test("keeps desktop admin display and sidebar layout utilities in the generated app Tailwind CSS", () => {
    const workDir = mkdtempSync(join(tmpdir(), "tzudong-admin-css-"));
    tempDirs.push(workDir);

    const inputPath = join(appRoot, "app", "app-globals.css");
    const outputPath = join(workDir, "output.css");

    execFileSync(
      "node",
      [
        "./node_modules/@tailwindcss/cli/dist/index.mjs",
        "-i",
        inputPath,
        "-o",
        outputPath,
        "--cwd",
        appRoot,
      ],
      {
        cwd: appRoot,
        env: {
          ...process.env,
          BASELINE_BROWSER_MAPPING_IGNORE_OLD_DATA: "true",
          BROWSERSLIST_IGNORE_OLD_DATA: "true",
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );

    const css = readFileSync(outputPath, "utf8");
    expect(compactCss(css)).toContain("--spacing:0.25rem");
    expect(compactCss(css)).toContain("--font-weight-extrabold:800");
    expect(compactCss(css)).toContain("--font-weight-black:900");

    for (const [utility, displayValue] of criticalDisplayUtilities) {
      const escapedClass = escapeCssClass(utility);
      expect(css, `${utility} should be emitted`).toContain(`.${escapedClass}`);
      expect(css, `${utility} should set display: ${displayValue}`).toMatch(
        new RegExp(
          `${escapeRegExp(`.${escapedClass}`)}\\s*\\{[^}]*display:\\s*${displayValue}`,
        ),
      );
    }

    for (const utility of criticalAdminConsoleLayoutUtilities) {
      expect(css, `${utility} should be emitted`).toContain(
        `.${escapeCssClass(utility)}`,
      );
    }

    for (const rule of criticalKpiDashboardProductionUtilities) {
      const escapedClass = escapeCssClass(rule.utility);
      const ruleBlock = getRuleBlock(css, escapedClass);
      const compactedRuleBlock = compactCss(ruleBlock);

      const declarations = [...rule.declarations];
      const hasDeclaration = declarations.some((declaration) =>
        compactedRuleBlock.includes(compactCss(declaration)),
      );
      expect(
        hasDeclaration,
        `${rule.utility} should include one of ${declarations.join(", ")} in its own generated rule`,
      ).toBe(true);
    }

    for (const rule of criticalMobileMapOverlayPositionUtilities) {
      const escapedClass = escapeCssClass(rule.utility);
      const ruleBlock = getRuleBlock(css, escapedClass);
      const compactedRuleBlock = compactCss(ruleBlock);

      const declarations = [...rule.declarations];
      const hasDeclaration = declarations.some((declaration) =>
        compactedRuleBlock.includes(compactCss(declaration)),
      );
      expect(
        hasDeclaration,
        `${rule.utility} should include one of ${declarations.join(", ")} in its own generated rule`,
      ).toBe(true);
    }
  }, 20_000);
  test("keeps generated Tailwind output out of the root CSS boundary", () => {
    const workDir = mkdtempSync(join(tmpdir(), "tzudong-route-css-boundary-"));
    tempDirs.push(workDir);

    const rootOutputPath = join(workDir, "root.css");
    const homeOutputPath = join(workDir, "home.css");
    const appOutputPath = join(workDir, "app.css");
    const deferredOutputPath = join(workDir, "deferred.css");
    const detailOutputPath = join(workDir, "detail.css");
    const compile = (inputPath: string, outputPath: string) => {
      execFileSync(
        "node",
        [
          "./node_modules/@tailwindcss/cli/dist/index.mjs",
          "-i",
          inputPath,
          "-o",
          outputPath,
          "--cwd",
          appRoot,
          "--minify",
        ],
        {
          cwd: appRoot,
          env: {
            ...process.env,
            BASELINE_BROWSER_MAPPING_IGNORE_OLD_DATA: "true",
            BROWSERSLIST_IGNORE_OLD_DATA: "true",
          },
          stdio: ["ignore", "pipe", "pipe"],
        },
      );
    };

    const homeEntrySource = readFileSync(join(appRoot, "app", "home-app-globals.css"), "utf8");
    const homeSourcePaths = [...homeEntrySource.matchAll(/^@source "([^"]+)";$/gm)].map(
      (match) => match[1],
    );
    expect(homeSourcePaths.length).toBeGreaterThan(0);
    for (const sourcePath of homeSourcePaths) {
      expect(
        existsSync(resolve(appRoot, "app", sourcePath)),
        `home @source path should exist: ${sourcePath}`,
      ).toBe(true);
    }

    compile(join(appRoot, "app", "globals.css"), rootOutputPath);
    compile(join(appRoot, "app", "home-app-globals.css"), homeOutputPath);
    compile(join(appRoot, "app", "home-deferred-globals.css"), deferredOutputPath);
    compile(join(appRoot, "app", "home-detail-globals.css"), detailOutputPath);
    compile(join(appRoot, "app", "app-globals.css"), appOutputPath);

    const rootCss = readFileSync(rootOutputPath, "utf8");
    const homeCss = readFileSync(homeOutputPath, "utf8");
    const deferredCss = readFileSync(deferredOutputPath, "utf8");
    const detailCss = readFileSync(detailOutputPath, "utf8");
    const appCss = readFileSync(appOutputPath, "utf8");
    expect(Buffer.byteLength(rootCss)).toBeLessThanOrEqual(16 * 1024);
    expect(rootCss).toContain("--background:");
    expect(rootCss).not.toContain("--tw-");
    expect(rootCss).not.toContain(".md\\:");
    expect(homeCss).not.toContain(ADMIN_SIDEBAR_MARKER);
    expect(Buffer.byteLength(homeCss)).toBeLessThanOrEqual(HOME_ROUTE_CSS_MAX_BYTES);
    expect(deferredCss).toContain(".scrollbar-hide");
    expect(detailCss.length).toBeGreaterThan(0);
    expect(appCss).toContain("--tw-");
    expect(appCss).toContain(ADMIN_SIDEBAR_MARKER);
    expect(appCss).toContain(".md\\:hidden");
    expect(Buffer.byteLength(appCss)).toBeGreaterThan(Buffer.byteLength(rootCss));
  }, 30_000);
});


describe("Speed Insights runtime gate", () => {
  test("activates the deferred client module only for an enabled production root gate", () => {
    expect(shouldEnableRootSpeedInsights({ VERCEL: "1" })).toBe(true);
    expect(
      shouldEnableRootSpeedInsights({
        NEXT_PUBLIC_ENABLE_SPEED_INSIGHTS: "true",
      }),
    ).toBe(true);
    expect(shouldEnableRootSpeedInsights({})).toBe(false);

    expect(shouldRenderSpeedInsights(true, "production")).toBe(true);
    expect(shouldRenderSpeedInsights(true, "development")).toBe(false);
    expect(shouldRenderSpeedInsights(false, "production")).toBe(false);
  });
});
