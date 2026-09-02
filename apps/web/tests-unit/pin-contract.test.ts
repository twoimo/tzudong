// Feature: platform-modernization, Property 12: 핀 권위 불변식.
// Validates: Requirements 5.2, 5.3, 5.4, 5.6, 5.7, 5.8.
//
// Web-side property check of the Pin_Contract authority invariant enforced by
// apps/web/scripts/verify-pin-contract.mjs (task 30, design section C2). The
// verifier is a fail-closed CLI that reads (never writes) the release-authority
// files; it exports no pure predicate. Following the tests-unit convention used
// by image-tag-fixity.test.ts, this test replicates the per-item match logic as
// small pure helpers — byte-for-byte equivalent to the verifier's pinItems()
// branches — and property-checks them against a large, deterministically
// generated set of declared/resolved candidates across the four declaration
// positions (@typescript/native alias, compat bridge TypeScript, npm
// packageManager, node engines).
//
// Invariant: a pin passes IFF its declared value (and, where a resolved value
// exists, that resolved value too) is the exact fixed contract string — no
// range specifier, no tag, no version bump, no whitespace, no case variation.
// Any deviation fails. The npm-side release authority (package.json /
// package-lock.json) is never mutated by the check — asserted as a
// source-contract on the verifier. Each generated case carries its expected
// classification by construction, so the generator is the oracle and the
// assertion is the iff. No fast-check dependency exists in tests-unit, so cases
// are enumerated with a deterministic seeded PRNG (mulberry32), well over 100
// per position, in the established bun:test style.

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const WEB_ROOT = resolve(import.meta.dir, "..");
const read = (relativePath: string) => readFileSync(resolve(WEB_ROOT, relativePath), "utf8");

// ---------------------------------------------------------------------------
// Fixed Pin_Contract strings. Mirror of the frozen EXPECTED object in
// apps/web/scripts/verify-pin-contract.mjs. These are the ONLY passing values.
// ---------------------------------------------------------------------------

const CONTRACT = Object.freeze({
  npmDeclared: "npm@11.6.2",
  npmResolved: "11.6.2",
  nodeRange: "24.x",
  nodeMajor: 24,
  nativeAlias: "npm:typescript@7.0.2",
  nativeResolvedName: "typescript",
  nativeResolved: "7.0.2",
  compatAlias: "npm:@typescript/typescript6@6.0.2",
  compatResolvedName: "@typescript/typescript6",
  compatResolved: "6.0.2",
});

// nodeMajor(version) replica from the verifier.
function nodeMajor(version: string): number {
  const match = /^v?(\d+)\./.exec(version);
  return match ? Number(match[1]) : Number.NaN;
}

// Per-item match predicates. Byte-for-byte equivalent to the corresponding
// branches of pinItems() in verify-pin-contract.mjs.
function npmMatch(declared: unknown, runtime: unknown): boolean {
  return declared === CONTRACT.npmDeclared && runtime === CONTRACT.npmResolved;
}
function nodeMatchFn(declared: unknown, runtimeVersion: string): boolean {
  return declared === CONTRACT.nodeRange && nodeMajor(runtimeVersion) === CONTRACT.nodeMajor;
}
function nativeMatch(declared: unknown, resolvedName: unknown, resolvedVersion: unknown): boolean {
  return (
    declared === CONTRACT.nativeAlias &&
    resolvedName === CONTRACT.nativeResolvedName &&
    resolvedVersion === CONTRACT.nativeResolved
  );
}
function compatMatch(declared: unknown, resolvedName: unknown, resolvedVersion: unknown): boolean {
  return (
    declared === CONTRACT.compatAlias &&
    resolvedName === CONTRACT.compatResolvedName &&
    resolvedVersion === CONTRACT.compatResolved
  );
}

// ---------------------------------------------------------------------------
// Deterministic PRNG (mulberry32): a fixed seed yields a stable case set.
// ---------------------------------------------------------------------------

function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pick = <T>(rng: () => number, arr: readonly T[]): T => arr[Math.floor(rng() * arr.length)]!;
const randint = (rng: () => number, min: number, max: number): number =>
  min + Math.floor(rng() * (max - min + 1));

// Range/tag decorations that must never appear in a Pin_Contract string
// (requirement 5.2: exact fixed strings, no range specifiers, no tags).
const RANGE_PREFIXES = ["^", "~", ">=", ">", "<", "<=", "=", "*", "x", " "] as const;
const TAG_SUFFIXES = ["-latest", "-next", "-beta.1", "-rc.0", "@latest", " "] as const;

// Produce a set of {value, expected} deviations for a fixed contract string.
// `value === fixed` is the sole passing case; every other value is guaranteed
// to differ from `fixed`, so its expected classification is false.
function mutations(rng: () => number, fixed: string, count: number): { value: string; expected: boolean }[] {
  const out: { value: string; expected: boolean }[] = [{ value: fixed, expected: true }];
  for (let i = 0; i < count; i += 1) {
    const kind = randint(rng, 0, 6);
    let value: string;
    switch (kind) {
      case 0:
        value = `${pick(rng, RANGE_PREFIXES)}${fixed}`;
        break;
      case 1:
        value = `${fixed}${pick(rng, TAG_SUFFIXES)}`;
        break;
      case 2:
        // Bump a digit within the version tail.
        value = fixed.replace(/(\d+)(?!.*\d)/, (m) => String(Number(m) + randint(rng, 1, 9)));
        break;
      case 3:
        // Change the very first digit run.
        value = fixed.replace(/\d+/, (m) => String(Number(m) + randint(rng, 1, 3)));
        break;
      case 4:
        value = fixed.toUpperCase();
        break;
      case 5:
        value = `${fixed}${randint(rng, 0, 9)}`;
        break;
      default:
        // Random junk identifier.
        value = Array.from({ length: randint(rng, 1, 12) }, () =>
          pick(rng, "abcdefghijklmnopqrstuvwxyz0123456789.@:/-^~".split("")),
        ).join("");
        break;
    }
    // Enforce the guarantee: only the literal fixed string is a pass.
    out.push({ value, expected: value === fixed });
  }
  return out;
}

// Arbitrary node runtime version strings paired with their true major.
function nodeRuntimeCases(rng: () => number, count: number): { version: string; expectedMajor: number }[] {
  const out: { version: string; expectedMajor: number }[] = [
    { version: "v24.0.0", expectedMajor: 24 },
    { version: "v24.9.1", expectedMajor: 24 },
    { version: "24.5.0", expectedMajor: 24 },
  ];
  for (let i = 0; i < count; i += 1) {
    const major = randint(rng, 18, 30);
    const minor = randint(rng, 0, 30);
    const patch = randint(rng, 0, 30);
    const prefix = rng() < 0.5 ? "v" : "";
    out.push({ version: `${prefix}${major}.${minor}.${patch}`, expectedMajor: major });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Tests.
// ---------------------------------------------------------------------------

describe("Pin_Contract authority invariant (Property 12)", () => {
  const rng = makeRng(0x50c0_12ac); // fixed seed => reproducible run.

  const npmCases = mutations(rng, CONTRACT.npmDeclared, 140);
  const npmRuntimeCases = mutations(rng, CONTRACT.npmResolved, 140);
  const nodeDeclaredCases = mutations(rng, CONTRACT.nodeRange, 140);
  const nativeCases = mutations(rng, CONTRACT.nativeAlias, 140);
  const compatCases = mutations(rng, CONTRACT.compatAlias, 140);
  const nodeRuntimes = nodeRuntimeCases(rng, 140);

  test("generates a broad case set exceeding the 100-example floor per position", () => {
    expect(npmCases.length).toBeGreaterThan(100);
    expect(nodeDeclaredCases.length).toBeGreaterThan(100);
    expect(nativeCases.length).toBeGreaterThan(100);
    expect(compatCases.length).toBeGreaterThan(100);
    expect(nodeRuntimes.length).toBeGreaterThan(100);
  });

  test("npm pin passes iff declaration and runtime both equal the exact fixed string", () => {
    for (const { value, expected } of npmCases) {
      // Declaration varies, runtime held at the fixed value.
      expect(npmMatch(value, CONTRACT.npmResolved), `declared=${JSON.stringify(value)}`).toBe(expected);
    }
    for (const { value, expected } of npmRuntimeCases) {
      // Runtime varies, declaration held at the fixed value.
      expect(npmMatch(CONTRACT.npmDeclared, value), `runtime=${JSON.stringify(value)}`).toBe(expected);
    }
    // A drifted runtime against a correct declaration still fails.
    expect(npmMatch(CONTRACT.npmDeclared, "11.6.3")).toBe(false);
    expect(npmMatch(CONTRACT.npmDeclared, "11.6.2")).toBe(true);
  });

  test("node pin passes iff engines is exactly 24.x and the runtime major is 24", () => {
    for (const { value, expected } of nodeDeclaredCases) {
      expect(nodeMatchFn(value, "v24.3.0"), `declared=${JSON.stringify(value)}`).toBe(expected);
    }
    for (const { version, expectedMajor } of nodeRuntimes) {
      // Declaration held exact; a pass requires the runtime major to be 24.
      expect(nodeMatchFn(CONTRACT.nodeRange, version), `runtime=${version}`).toBe(
        expectedMajor === CONTRACT.nodeMajor,
      );
    }
    // Major 25 is out of the 24.x band even with the correct declaration.
    expect(nodeMatchFn(CONTRACT.nodeRange, "v25.0.0")).toBe(false);
    expect(nodeMatchFn(CONTRACT.nodeRange, "v24.0.0")).toBe(true);
  });

  test("@typescript/native alias passes iff declared alias and resolved name+version are exact", () => {
    for (const { value, expected } of nativeCases) {
      expect(
        nativeMatch(value, CONTRACT.nativeResolvedName, CONTRACT.nativeResolved),
        `declared=${JSON.stringify(value)}`,
      ).toBe(expected);
    }
    // Resolved-side drift fails even when the declared alias is exact.
    expect(nativeMatch(CONTRACT.nativeAlias, "typescript", "7.0.3")).toBe(false);
    expect(nativeMatch(CONTRACT.nativeAlias, "@typescript/typescript6", "7.0.2")).toBe(false);
    expect(nativeMatch(CONTRACT.nativeAlias, "typescript", "7.0.2")).toBe(true);
  });

  test("compat bridge TypeScript passes iff declared alias and resolved name+version are exact", () => {
    for (const { value, expected } of compatCases) {
      expect(
        compatMatch(value, CONTRACT.compatResolvedName, CONTRACT.compatResolved),
        `declared=${JSON.stringify(value)}`,
      ).toBe(expected);
    }
    expect(compatMatch(CONTRACT.compatAlias, "@typescript/typescript6", "6.0.3")).toBe(false);
    expect(compatMatch(CONTRACT.compatAlias, "typescript", "6.0.2")).toBe(false);
    expect(compatMatch(CONTRACT.compatAlias, "@typescript/typescript6", "6.0.2")).toBe(true);
  });

  test("the verifier never mutates the npm-side release authority (source-contract)", () => {
    const source = read("scripts/verify-pin-contract.mjs");
    // Only read primitives are imported from the filesystem module.
    expect(source).toContain("import { access, readFile, realpath } from 'node:fs/promises'");
    // No write / delete / truncate primitive appears anywhere in the verifier.
    for (const forbidden of [
      "writeFile",
      "writeFileSync",
      "appendFile",
      "createWriteStream",
      "unlink",
      "truncate",
      "rm(",
      "rmSync",
    ]) {
      expect(source, `verifier must not call ${forbidden}`).not.toContain(forbidden);
    }
    // bun.lock adjustment is report-only; package.json/package-lock.json untouched.
    expect(source).toContain("bunLockAdjusted: false");
  });

  test("the real tree's declared and resolved values match the fixed contract", () => {
    const manifest = JSON.parse(read("package.json")) as {
      packageManager?: string;
      engines?: { node?: string };
      devDependencies?: Record<string, string>;
    };
    const lock = JSON.parse(read("package-lock.json")) as {
      packages?: Record<string, { name?: string; version?: string }>;
    };

    expect(manifest.packageManager).toBe(CONTRACT.npmDeclared);
    expect(manifest.engines?.node).toBe(CONTRACT.nodeRange);
    expect(manifest.devDependencies?.["@typescript/native"]).toBe(CONTRACT.nativeAlias);
    expect(manifest.devDependencies?.typescript).toBe(CONTRACT.compatAlias);

    const nativeLock = lock.packages?.["node_modules/@typescript/native"] ?? {};
    const compatLock = lock.packages?.["node_modules/typescript"] ?? {};

    expect(nativeMatch(manifest.devDependencies?.["@typescript/native"], nativeLock.name, nativeLock.version)).toBe(true);
    expect(compatMatch(manifest.devDependencies?.typescript, compatLock.name, compatLock.version)).toBe(true);
    expect(nodeMatchFn(manifest.engines?.node, "v24.0.0")).toBe(true);
    expect(npmMatch(manifest.packageManager, CONTRACT.npmResolved)).toBe(true);
  });
});
