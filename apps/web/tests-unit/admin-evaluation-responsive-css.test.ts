import { afterAll, describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

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
  "lg:m-0",
  "lg:px-1.5",
  "lg:w-14",
  "lg:w-60",
  "lg:grid",
  "lg:place-items-center",
] as const;

const criticalKpiDashboardProductionUtilities = [
  {
    utility: "font-extrabold",
    declarations: ["font-weight:800"],
  },
  {
    utility: "font-black",
    declarations: ["font-weight:900"],
  },
  {
    utility: "md:p-4",
    declarations: ["padding:1rem"],
  },
  {
    utility: "gap-0",
    declarations: ["gap:0px"],
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
    utility: "text-[clamp(1.42rem,1.75vw,2.1rem)]",
    declarations: ["font-size:clamp(1.42rem,1.75vw,2.1rem)"],
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


afterAll(() => {
  for (const dir of tempDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function escapeCssClass(className: string) {
  return className
    .replace(/,/g, "\\2c ")
    .replace(/([:.[\]()/%])/g, "\\$1");
}

function compactCss(value: string) {
  return value.replace(/\s+/g, "");
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

describe("admin responsive CSS guard", () => {
  test("keeps desktop admin display and sidebar layout utilities in the generated app Tailwind CSS", () => {
    const workDir = mkdtempSync(join(tmpdir(), "tzudong-admin-css-"));
    tempDirs.push(workDir);

    const inputPath = join(workDir, "input.css");
    const outputPath = join(workDir, "output.css");
    writeFileSync(inputPath, "@tailwind utilities;\n");

    execFileSync(
      "node",
      [
        "./node_modules/tailwindcss/lib/cli.js",
        "-i",
        inputPath,
        "-o",
        outputPath,
        "--config",
        "./tailwind.config.ts",
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

    const compactedCss = compactCss(css);
    for (const rule of criticalKpiDashboardProductionUtilities) {
      expect(css, `${rule.utility} should be emitted`).toContain(
        `.${escapeCssClass(rule.utility)}`,
      );

      const declarations = [...rule.declarations];
      const hasDeclaration = declarations.some((declaration) =>
        compactedCss.includes(compactCss(declaration)),
      );
      expect(
        hasDeclaration,
        `${rule.utility} should include one of ${declarations.join(", ")}`,
      ).toBe(true);
    }
  }, 20_000);
});
