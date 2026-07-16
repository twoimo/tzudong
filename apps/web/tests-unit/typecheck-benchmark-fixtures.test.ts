import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createSamplerState, createTerminalSummary, enrichSample, nextDeadlineDelayMs } from "../scripts/process-tree-rss-core.mjs";
import { parseLinuxChildren } from "../scripts/process-tree-rss-sampler.mjs";

type ProcessRow = { pid: number; parentPid: number; startIdentity: string; rssBytes: number };
type Sample = { monotonicMs: number; totalPhysicalBytes: number; availablePhysicalBytes: number; errors: string[]; processes: ProcessRow[] };
type ExpectedSample = { included: string[]; includedRssBytes: number; errors: string[] };
type FixtureCase = { id: string; rootPid: number; samples: Sample[]; expectedSamples: ExpectedSample[]; expected: { invalidReasons: string[]; terminalObserved: boolean; valid: boolean } };
type Fixture = { schemaVersion: 1; platforms: ("win32" | "linux")[]; cases: FixtureCase[] };

const fixturePath = resolve(import.meta.dir, "../fixtures/typecheck-benchmark/process-tree-cases.v1.json");
const fixture = JSON.parse(readFileSync(fixturePath, "utf8")) as unknown;

function keys(value: Record<string, unknown>, expected: string[]) {
  expect(Object.keys(value).sort()).toEqual([...expected].sort());
}
function record(value: unknown): Record<string, unknown> {
  expect(typeof value === "object" && value !== null && !Array.isArray(value)).toBe(true);
  return value as Record<string, unknown>;
}

function validateFixture(value: unknown): asserts value is Fixture {
  const document = record(value);
  keys(document, ["schemaVersion", "platforms", "cases"]);
  expect(document.schemaVersion).toBe(1);
  expect(document.platforms).toEqual(["win32", "linux"]);
  expect(Array.isArray(document.cases)).toBe(true);
  for (const item of document.cases as unknown[]) {
    const fixtureCase = record(item);
    keys(fixtureCase, ["id", "rootPid", "samples", "expectedSamples", "expected"]);
    expect(typeof fixtureCase.id).toBe("string");
    expect((fixtureCase.id as string).length).toBeGreaterThan(0);
    expect(Number.isInteger(fixtureCase.rootPid)).toBe(true);
    expect(Array.isArray(fixtureCase.samples)).toBe(true);
    expect(Array.isArray(fixtureCase.expectedSamples)).toBe(true);
    expect((fixtureCase.samples as unknown[]).length).toBe((fixtureCase.expectedSamples as unknown[]).length);
    for (const sample of fixtureCase.samples as unknown[]) {
      const row = record(sample);
      keys(row, ["monotonicMs", "totalPhysicalBytes", "availablePhysicalBytes", "errors", "processes"]);
      expect(typeof row.monotonicMs).toBe("number");
      expect(typeof row.totalPhysicalBytes).toBe("number");
      expect(typeof row.availablePhysicalBytes).toBe("number");
      expect(Array.isArray(row.errors) && row.errors.every((error) => typeof error === "string")).toBe(true);
      expect(Array.isArray(row.processes)).toBe(true);
      for (const process of row.processes as unknown[]) {
        const processRow = record(process);
        keys(processRow, ["pid", "parentPid", "startIdentity", "rssBytes"]);
        expect(Object.prototype.hasOwnProperty.call(processRow, "pid")).toBe(true);
        expect(Object.prototype.hasOwnProperty.call(processRow, "parentPid")).toBe(true);
        expect(Object.prototype.hasOwnProperty.call(processRow, "startIdentity")).toBe(true);
        expect(Object.prototype.hasOwnProperty.call(processRow, "rssBytes")).toBe(true);
      }
    }
    for (const expectedSample of fixtureCase.expectedSamples as unknown[]) {
      const row = record(expectedSample);
      keys(row, ["included", "includedRssBytes", "errors"]);
      expect(Array.isArray(row.included)).toBe(true);
      expect((row.included as unknown[]).every((identity) => typeof identity === "string")).toBe(true);
      expect(typeof row.includedRssBytes).toBe("number");
      expect(Array.isArray(row.errors)).toBe(true);
      expect((row.errors as unknown[]).every((error) => typeof error === "string")).toBe(true);
    }
    const expected = record(fixtureCase.expected);
    keys(expected, ["invalidReasons", "terminalObserved", "valid"]);
    expect(Array.isArray(expected.invalidReasons) && expected.invalidReasons.every((reason) => typeof reason === "string")).toBe(true);
    expect(typeof expected.terminalObserved).toBe("boolean");
    expect(typeof expected.valid).toBe("boolean");
  }
}

validateFixture(fixture);

describe("process-tree RSS fixture core", () => {
  for (const platform of fixture.platforms) {
    describe(platform, () => {
      for (const fixtureCase of fixture.cases) {
        test(fixtureCase.id, () => {
          const configuration: { rootPid: number; rootStartIdentity?: string } = { rootPid: fixtureCase.rootPid };
          const state = createSamplerState();
          const observed = fixtureCase.samples.map((sample) => enrichSample(sample, state, configuration, `fixture-${platform}`));

          for (let index = 0; index < observed.length; index += 1) {
            expect(observed[index].included).toEqual(fixtureCase.expectedSamples[index].included);
            expect(observed[index].includedRssBytes).toBe(fixtureCase.expectedSamples[index].includedRssBytes);
            expect(observed[index].errors).toEqual(fixtureCase.expectedSamples[index].errors);
            expect(observed[index].samplerIdentity).toBe(`fixture-${platform}`);
          }

          const summary = createTerminalSummary(state, configuration, 20, "fixture.ndjson", fixtureCase.expected.terminalObserved);
          expect(summary.invalidReasons).toEqual(fixtureCase.expected.invalidReasons);
          expect(summary.terminalObserved).toBe(fixtureCase.expected.terminalObserved);
          expect(summary.valid).toBe(fixtureCase.expected.valid);
        });
      }
    });
  }
});

test("cannot mark a clean sample set valid before terminal root disappearance is observed", () => {
  const configuration: { rootPid: number; rootStartIdentity?: string } = { rootPid: 100 };
  const state = createSamplerState();
  for (const monotonicMs of [0, 20, 40]) {
    enrichSample({
      monotonicMs,
      totalPhysicalBytes: 1000,
      availablePhysicalBytes: 500,
      errors: [],
      processes: [{ pid: 100, parentPid: 1, startIdentity: "1000", rssBytes: 100 }],
    }, state, configuration, "fixture-terminal");
  }
  const summary = createTerminalSummary(state, configuration, 20, "fixture.ndjson", false);
  expect(summary.terminalObserved).toBe(false);
  expect(summary.valid).toBe(false);
});
test("rejects a reused root identity before the first accepted sample", () => {
  const state = createSamplerState();
  const configuration = { rootPid: 100, rootStartIdentity: "1000" };
  const observed = enrichSample({
    monotonicMs: 0,
    totalPhysicalBytes: 1000,
    availablePhysicalBytes: 500,
    errors: [],
    processes: [{ pid: 100, parentPid: 1, startIdentity: "2000", rssBytes: 100 }],
  }, state, configuration, "fixture-preflight");
  expect(observed.errors).toContain("root-identity-reused");
});

test("collector errors remain invalid evidence and do not become terminal success", () => {
  const state = createSamplerState();
  const configuration = { rootPid: 100, rootStartIdentity: "1000" };
  const observed = enrichSample({
    monotonicMs: 0,
    totalPhysicalBytes: 1000,
    availablePhysicalBytes: 500,
    errors: ["inaccessible-root-record:100"],
    processes: [],
  }, state, configuration, "fixture-collector");
  expect(observed.errors).toEqual(["inaccessible-root-record:100", "missing-root-identity"]);
  expect(createTerminalSummary(state, configuration, 20, "fixture.ndjson", true).valid).toBe(false);
});
test("parses only bounded Linux task children and rejects malformed records", () => {
  expect(parseLinuxChildren("101 202\n303\n")).toEqual([101, 202, 303]);
  expect(parseLinuxChildren("\n")).toEqual([]);
  expect(() => parseLinuxChildren("101 not-a-pid")).toThrow("RSS_SAMPLER_PROC_CHILDREN_MALFORMED");
  expect(() => parseLinuxChildren("1e3")).toThrow("RSS_SAMPLER_PROC_CHILDREN_MALFORMED");
  expect(() => parseLinuxChildren("0")).toThrow("RSS_SAMPLER_PROC_CHILDREN_MALFORMED");
});

test("uses cumulative monotonic deadlines without snapshot-duration drift", () => {
  expect(nextDeadlineDelayMs(20, 7)).toBe(13);
  expect(nextDeadlineDelayMs(40, 39.9)).toBe(0);
  expect(nextDeadlineDelayMs(60, 65)).toBe(0);
});

test("summary aggregates are derived from every accepted raw sample", () => {
  const state = createSamplerState();
  const configuration = { rootPid: 100 };
  for (const [monotonicMs, rssBytes] of [[0, 100], [20, 250], [40, 150]] as const) {
    enrichSample({ monotonicMs, totalPhysicalBytes: 1000, availablePhysicalBytes: 500, errors: [], processes: [{ pid: 100, parentPid: 1, startIdentity: "1000", rssBytes }] }, state, configuration, "fixture-aggregate");
  }
  const summary = createTerminalSummary(state, configuration, 20, "fixture.ndjson", true);
  expect(summary.peakRssBytes).toBe(250);
  expect(summary.maximumGapMs).toBe(20);
  expect(summary.rootStartIdentity).toBe("1000");
});
