import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parseTopLevelSuites, runBunTestFiles, verifyFileResults } from "../scripts/unit-test-results.mjs";

const fixtures = resolve(import.meta.dir, "fixtures/bun-junit");
const twoFiles = readFileSync(join(fixtures, "two-files.xml"), "utf8");
const alphaOnly = readFileSync(join(fixtures, "alpha-only.xml"), "utf8");
const cwd = "/repo/apps/web";
const alpha = "tests-unit/alpha.test.ts";
const beta = "tests-unit/nested/beta.test.ts";

describe("bun junit file results", () => {
  test("reads top-level suites and ignores nested describe suites", () => {
    expect(parseTopLevelSuites(twoFiles)).toEqual(new Map([[alpha, 2], [beta, 1]]));
  });

  test("matches relative, dot-prefixed and absolute arguments to bun's cwd-relative file attribute", () => {
    expect(verifyFileResults(twoFiles, [alpha, `./${beta}`], cwd)).toEqual({ missing: [], unexpected: [] });
    expect(verifyFileResults(twoFiles, [`${cwd}/${alpha}`, beta], cwd)).toEqual({ missing: [], unexpected: [] });
  });

  test("reports a nonexistent path or an empty file that bun silently dropped", () => {
    expect(verifyFileResults(alphaOnly, [alpha, "tests-unit/missing.test.ts"], cwd).missing).toEqual(["tests-unit/missing.test.ts"]);
    expect(verifyFileResults(alphaOnly, [alpha, "tests-unit/empty.test.ts"], cwd).missing).toEqual(["tests-unit/empty.test.ts"]);
  });

  test("reports a suite with zero tests as without results", () => {
    const zero = twoFiles.replace(`file="${beta}" tests="1"`, `file="${beta}" tests="0"`);
    expect(zero).not.toBe(twoFiles);
    expect(verifyFileResults(zero, [alpha, beta], cwd).missing).toEqual([beta]);
  });

  test("treats an absent or truncated report as no results for every file", () => {
    expect(verifyFileResults(null, [beta, alpha], cwd).missing).toEqual([alpha, beta]);
    const truncated = twoFiles.slice(0, twoFiles.indexOf("</testsuites>"));
    expect(parseTopLevelSuites(truncated)).toBeNull();
    expect(verifyFileResults(truncated, [alpha, beta], cwd).missing).toEqual([alpha, beta]);
  });

  test("reports result files that were not assigned to the process", () => {
    expect(verifyFileResults(twoFiles, [alpha], cwd)).toEqual({ missing: [], unexpected: [beta] });
  });
});

describe("verified bun process", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  function inventory(files: Record<string, string>) {
    const dir = mkdtempSync(join(tmpdir(), "tzudong-unit-results-"));
    dirs.push(dir);
    mkdirSync(join(dir, "tests-unit"));
    for (const [name, source] of Object.entries(files)) writeFileSync(join(dir, "tests-unit", name), source);
    return dir;
  }

  function errorsOf(run: () => number) {
    const spy = spyOn(console, "error").mockImplementation(() => {});
    try {
      return { status: run(), errors: spy.mock.calls.map((call) => String(call[0])) };
    } finally {
      spy.mockRestore();
    }
  }

  const passing = 'import { expect, test } from "bun:test";\ntest("ok", () => expect(1).toBe(1));\n';

  test("passes when every assigned file reports tests", () => {
    const dir = inventory({ "a.test.ts": passing, "b.test.ts": passing });
    expect(errorsOf(() => runBunTestFiles(["tests-unit/a.test.ts", "tests-unit/b.test.ts"], { cwd: dir }))).toEqual({ status: 0, errors: [] });
  });

  test("fails when a file calls process.exit(0) before bun writes results", () => {
    const dir = inventory({
      "a.test.ts": passing,
      "exit.test.ts": 'import { test } from "bun:test";\nprocess.exit(0);\ntest("never", () => {});\n',
    });
    expect(errorsOf(() => runBunTestFiles(["tests-unit/a.test.ts", "tests-unit/exit.test.ts"], { cwd: dir }))).toEqual({
      status: 1,
      errors: ["[unit-tests] files without results: tests-unit/a.test.ts, tests-unit/exit.test.ts"],
    });
  });

  test("fails before spawning when an assigned path does not exist", () => {
    const dir = inventory({ "a.test.ts": passing });
    expect(errorsOf(() => runBunTestFiles(["tests-unit/a.test.ts", "tests-unit/missing.test.ts"], { cwd: dir }))).toEqual({
      status: 1,
      errors: ["[unit-tests] test files not found: tests-unit/missing.test.ts"],
    });
  });
});
