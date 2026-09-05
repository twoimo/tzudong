// Feature: platform-modernization, Property 11: 의존성 후보 분류.
// Validates: Requirements 4.7, 4.11.
//
// Property-style check of the Dependency_Freshness_Workflow candidate split and
// hold-range classification enforced by
// apps/web/scripts/verify-dependency-freshness.mjs (task 31, design section C2).
//
// Invariants (design Property 11):
//   - 메이저 단독 분리: every major-version bump becomes its own standalone
//     one-package-per-PR candidate (packages length 1, standalone true), while
//     minor/patch bumps for a unit stay grouped in a single non-standalone
//     candidate. (Requirement 4.7)
//   - 보류 범위 거부: a candidate raising a version inside a preserved
//     .github/dependabot.yml hold range (next/@next/bundle-analyzer/
//     eslint-config-next >=16.3.0, eslint major, @types/node major,
//     typescript-eslint >8.63.0) is classified dependency_hold_violation, and a
//     bump below/outside every hold is admitted (code null). (Requirement 4.11)
//
// tests-unit carries no fast-check dependency, so cases are produced by a small
// deterministic seeded PRNG (mulberry32) that emits well over 100 candidates per
// invariant. Each case carries its expected classification by construction — the
// version tuples are chosen so the intended bump/hold is known independently of
// the module under test, so the generator is the oracle and the assertions are
// genuine iffs rather than tautologies.

import { describe, expect, test } from "bun:test";

import {
  bumpType,
  classifyCandidate,
  isHoldRangeBump,
  splitMajorBumps,
} from "../scripts/verify-dependency-freshness.mjs";

// --- Deterministic PRNG (mulberry32): fixed seed => stable case set. ---

function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pick = <T>(rng: () => number, arr: readonly T[]): T =>
  arr[Math.floor(rng() * arr.length)]!;

const randint = (rng: () => number, min: number, max: number): number =>
  min + Math.floor(rng() * (max - min + 1));

// --- Package descriptors carrying an independently-known intent. ---

type Bump = "major" | "minor" | "patch";

interface SplitPkg {
  name: string;
  fromVersion: string;
  toVersion: string;
  intendedBump: Bump;
}

interface HoldPkg {
  name: string;
  fromVersion: string;
  toVersion: string;
  intendedHold: boolean;
}

// Build a (from, to) pair that genuinely realizes `bump` under bumpType().
function bumpVersions(rng: () => number, bump: Bump): { from: string; to: string } {
  const a = randint(rng, 0, 20);
  const b = randint(rng, 0, 20);
  const c = randint(rng, 0, 20);
  const from = `${a}.${b}.${c}`;
  if (bump === "major") return { from, to: `${a + 1}.0.0` };
  if (bump === "minor") return { from, to: `${a}.${b + 1}.0` };
  return { from, to: `${a}.${b}.${c + 1}` };
}

// Names irrelevant to the split invariant; the split is purely by bump size.
// Includes hold-list and Pin_Contract names to prove they split like any other.
const SPLIT_NAME_POOL = [
  "react",
  "react-dom",
  "lodash",
  "zod",
  "next",
  "@next/bundle-analyzer",
  "eslint-config-next",
  "eslint",
  "@types/node",
  "typescript-eslint",
  "@typescript/native",
  "typescript",
] as const;

const BUMPS: readonly Bump[] = ["major", "minor", "patch"];

// --- Split case set (Requirement 4.7). ---

function buildSplitCases(): { packages: SplitPkg[]; targetBranch: string }[] {
  const rng = makeRng(0x5f3759df);
  const cases: { packages: SplitPkg[]; targetBranch: string }[] = [];
  for (let i = 0; i < 220; i += 1) {
    const n = randint(rng, 0, 5);
    const packages: SplitPkg[] = [];
    for (let j = 0; j < n; j += 1) {
      const intendedBump = pick(rng, BUMPS);
      const { from, to } = bumpVersions(rng, intendedBump);
      packages.push({
        name: pick(rng, SPLIT_NAME_POOL),
        fromVersion: from,
        toVersion: to,
        intendedBump,
      });
    }
    // Vary the surrounding candidate fields to prove they are preserved.
    const targetBranch = pick(rng, ["develop", "main", "data"]);
    cases.push({ packages, targetBranch });
  }
  return cases;
}

// --- Hold-classification case set (Requirement 4.11). ---

// next-family hold is a version-range hold at >=16.3.0 (bump size irrelevant).
const NEXT_FAMILY = ["next", "@next/bundle-analyzer", "eslint-config-next"] as const;

function genNextFamily(rng: () => number): HoldPkg {
  const name = pick(rng, NEXT_FAMILY);
  const inside = rng() < 0.5;
  const to = inside
    ? pick(rng, ["16.3.0", "16.4.2", "16.9.0", "17.0.0", "18.2.1"])
    : pick(rng, ["16.2.9", "16.0.0", "15.9.9", "14.1.0"]);
  return { name, fromVersion: "0.0.0", toVersion: to, intendedHold: inside };
}

// eslint / @types/node holds are semver-major holds (major bump => held).
const MAJOR_HOLD_NAMES = ["eslint", "@types/node"] as const;

function genMajorHold(rng: () => number): HoldPkg {
  const name = pick(rng, MAJOR_HOLD_NAMES);
  const inside = rng() < 0.5;
  const a = randint(rng, 1, 20);
  if (inside) {
    // A real major bump is inside the hold.
    return { name, fromVersion: `${a}.5.0`, toVersion: `${a + 1}.0.0`, intendedHold: true };
  }
  // A minor or patch bump (never major) is outside the hold.
  const to = rng() < 0.5 ? `${a}.6.0` : `${a}.5.1`;
  return { name, fromVersion: `${a}.5.0`, toVersion: to, intendedHold: false };
}

// typescript-eslint hold is a version-range hold at >8.63.0.
function genTsEslint(rng: () => number): HoldPkg {
  const inside = rng() < 0.5;
  const to = inside
    ? pick(rng, ["8.64.0", "8.70.1", "9.0.0", "10.2.3"])
    : pick(rng, ["8.63.0", "8.62.5", "8.60.0", "8.50.1"]);
  return { name: "typescript-eslint", fromVersion: "8.0.0", toVersion: to, intendedHold: inside };
}

// Arbitrary non-hold, non-Pin_Contract packages: never held.
const ARBITRARY_NAMES = [
  "react",
  "react-dom",
  "lodash",
  "zod",
  "vite",
  "tailwindcss",
  "@types/react",
  "playwright",
] as const;

function genArbitrary(rng: () => number): HoldPkg {
  const intendedBump = pick(rng, BUMPS);
  const { from, to } = bumpVersions(rng, intendedBump);
  return { name: pick(rng, ARBITRARY_NAMES), fromVersion: from, toVersion: to, intendedHold: false };
}

const HOLD_GENERATORS = [genNextFamily, genMajorHold, genTsEslint, genArbitrary] as const;

function buildHoldCases(): { packages: HoldPkg[]; expectedCode: string | null }[] {
  const rng = makeRng(0x9e3779b9);
  const cases: { packages: HoldPkg[]; expectedCode: string | null }[] = [];
  for (let i = 0; i < 240; i += 1) {
    const n = randint(rng, 1, 4);
    const packages: HoldPkg[] = [];
    for (let j = 0; j < n; j += 1) {
      packages.push(pick(rng, HOLD_GENERATORS)(rng));
    }
    const expectedCode = packages.some((p) => p.intendedHold)
      ? "dependency_hold_violation"
      : null;
    cases.push({ packages, expectedCode });
  }
  return cases;
}

describe("dependency candidate split + hold classification (Property 11)", () => {
  const splitCases = buildSplitCases();
  const holdCases = buildHoldCases();

  test("generates broad case sets exceeding the 100-example floor", () => {
    expect(splitCases.length).toBeGreaterThan(100);
    expect(holdCases.length).toBeGreaterThan(100);
    // Both classification outcomes are actually exercised.
    expect(holdCases.some((c) => c.expectedCode === "dependency_hold_violation")).toBe(true);
    expect(holdCases.some((c) => c.expectedCode === null)).toBe(true);
    // Split cases actually contain major bumps to exercise standalone splitting.
    expect(
      splitCases.some((c) => c.packages.some((p) => p.intendedBump === "major")),
    ).toBe(true);
  });

  test("every major bump becomes a standalone one-package candidate; minor/patch stay grouped", () => {
    for (const { packages, targetBranch } of splitCases) {
      const candidate = { targetBranch, unit: "/apps/web", title: "chore: bump", packages };
      const majors = packages.filter((p) => p.intendedBump === "major");
      const nonMajors = packages.filter((p) => p.intendedBump !== "major");

      const result = splitMajorBumps(candidate);
      const standalone = result.filter((r: any) => r.standalone === true);
      const grouped = result.filter((r: any) => r.standalone === false);

      // One standalone candidate per major bump, each with exactly one package.
      expect(standalone.length).toBe(majors.length);
      for (const entry of standalone) {
        expect(entry.packages.length).toBe(1);
        const pkg = entry.packages[0];
        expect(bumpType(pkg.fromVersion, pkg.toVersion)).toBe("major");
        // Surrounding candidate fields are preserved on the split-out candidate.
        expect(entry.targetBranch).toBe(targetBranch);
        expect(entry.unit).toBe("/apps/web");
      }

      // Minor/patch bumps collapse into exactly one non-standalone candidate.
      expect(grouped.length).toBe(nonMajors.length > 0 ? 1 : 0);
      if (nonMajors.length > 0) {
        expect(grouped[0].packages).toEqual(nonMajors);
        for (const pkg of grouped[0].packages) {
          expect(bumpType(pkg.fromVersion, pkg.toVersion)).not.toBe("major");
        }
        expect(grouped[0].targetBranch).toBe(targetBranch);
      }

      // No package is dropped or duplicated across the split.
      const emitted = result.flatMap((r: any) => r.packages);
      expect(emitted.length).toBe(packages.length);
      expect(emitted).toEqual([...majors, ...nonMajors]);
    }
  });

  test("a bump inside a preserved hold range is rejected; a bump outside is admitted", () => {
    for (const { packages, expectedCode } of holdCases) {
      const candidate = {
        targetBranch: "develop",
        unit: "/apps/web",
        title: "chore: bump dependencies",
        packages,
      };
      // Classification matches the by-construction expectation.
      expect(classifyCandidate(candidate).code).toBe(expectedCode);

      // The per-package hold predicate agrees with the intended hold membership.
      for (const pkg of packages) {
        const bumped = bumpType(pkg.fromVersion, pkg.toVersion);
        expect(isHoldRangeBump(pkg.name, pkg.toVersion, bumped)).toBe(pkg.intendedHold);
      }
    }
  });
});
