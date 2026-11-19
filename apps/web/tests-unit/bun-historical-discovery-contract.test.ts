import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const webRoot = path.resolve(import.meta.dir, "..");
const configuredBunVersion = "1.4.0";

function activeTestSource(name: string, marker: string) {
  return [
    'import { expect, test } from "bun:test";',
    'import { appendFileSync } from "node:fs";',
    `test(${JSON.stringify(name)}, () => {`,
    `  appendFileSync(${JSON.stringify(marker)}, ${JSON.stringify(`${name}\n`)});`,
    "  expect(1).toBe(1);",
    "});",
    "",
  ].join("\n");
}

describe("Bun historical evidence discovery boundary", () => {
  test("runs active tests under tests-unit and performance without loading historical archives", () => {
    expect(Bun.version).toBe(configuredBunVersion);
    const root = mkdtempSync(path.join(os.tmpdir(), "tzudong-bun-discovery-"));
    try {
      const activeMarker = path.join(root, "active.marker");
      const archiveMarker = path.join(root, "archive.marker");
      const activeUnit = path.join(root, "tests-unit", "active-unit.test.ts");
      const activePerformance = path.join(root, "performance", "active-performance.test.ts");
      const archived = path.join(
        root,
        "performance",
        "fixture",
        "historical-deadbeef",
        "archived-failure.test.ts",
      );
      const preload = path.join("tests-unit", "support", "server-only.ts");
      for (const file of [activeUnit, activePerformance, archived, path.join(root, preload)]) {
        mkdirSync(path.dirname(file), { recursive: true });
      }
      writeFileSync(path.join(root, "bunfig.toml"), readFileSync(path.join(webRoot, "bunfig.toml")));
      writeFileSync(path.join(root, preload), readFileSync(path.join(webRoot, preload)));
      writeFileSync(activeUnit, activeTestSource("active-unit", activeMarker));
      writeFileSync(activePerformance, activeTestSource("active-performance", activeMarker));
      writeFileSync(archived, [
        'import { expect, test } from "bun:test";',
        'import { appendFileSync } from "node:fs";',
        `appendFileSync(${JSON.stringify(archiveMarker)}, "loaded\\n");`,
        'test("archived-failure", () => expect(1).toBe(2));',
        "",
      ].join("\n"));

      const environment: Record<string, string> = { CI: "1", NO_COLOR: "1" };
      for (const key of ["PATH", "Path", "SYSTEMROOT", "SystemRoot", "TMPDIR", "TEMP", "TMP"]) {
        const value = process.env[key];
        if (value) environment[key] = value;
      }
      const result = spawnSync(process.execPath, ["test"], {
        cwd: root,
        encoding: "utf8",
        env: environment,
        shell: false,
        windowsHide: true,
      });

      expect(result.error).toBeUndefined();
      expect(result.signal).toBeNull();
      expect(result.status).toBe(0);
      expect(readFileSync(activeMarker, "utf8").trim().split("\n").sort()).toEqual([
        "active-performance",
        "active-unit",
      ]);
      expect(existsSync(archiveMarker)).toBe(false);
      const boundedSummary = `${result.stdout}\n${result.stderr}`;
      expect(boundedSummary).toContain("2 pass");
      expect(boundedSummary).toContain("0 fail");
      expect(boundedSummary).toContain("Ran 2 tests across 2 files");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, 15_000);
});
