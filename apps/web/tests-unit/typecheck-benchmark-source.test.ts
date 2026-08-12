import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdir, mkdtemp, rm, truncate, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { buildBenchmarkDecision, TYPECHECK_BENCHMARK_BUDGETS, TYPECHECK_BENCHMARK_MAX_PUBLICATION_BYTES } from "../scripts/measure-typecheck.mjs";
import { validateBenchmarkReportDocument, verifyPublishedBenchmarkDirectory } from "../scripts/verify-typecheck-benchmark-report.mjs";

const root = resolve(import.meta.dir, "..");
const read = (file: string) => readFileSync(resolve(root, file), "utf8");
const typecheck = read("scripts/run-typecheck.mjs");
const verify = read("scripts/verify-typescript-toolchain.mjs");
const measure = read("scripts/measure-typecheck.mjs");
const reportVerifier = read("scripts/verify-typecheck-benchmark-report.mjs");
const sampler = `${read("scripts/process-tree-rss-sampler.mjs")}\n${read("scripts/process-tree-rss-core.mjs")}`;
const repositoryGuidance = readFileSync(resolve(root, "..", "..", "AGENTS.md"), "utf8");

function decisionRuns(nativeDurations: number[], compatDurations: number[], nativeRss = 512 * 1024 * 1024, compatRss = 512 * 1024 * 1024) {
  const runs: Array<{ kind: "native" | "compat"; durationMs: number; samplerSummary: { peakRssBytes: number } }> = [];
  for (let index = 0; index < nativeDurations.length; index += 1) {
    runs.push({ kind: "native", durationMs: nativeDurations[index], samplerSummary: { peakRssBytes: nativeRss } });
    runs.push({ kind: "compat", durationMs: compatDurations[index], samplerSummary: { peakRssBytes: compatRss } });
  }
  return runs;
}

const digest = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
function benchmarkReport(nativeDurations: number[], compatDurations: number[]) {
  const tree = "a".repeat(40);
  const unorderedInputs = decisionRuns(nativeDurations, compatDurations);
  const byKind = {
    native: unorderedInputs.filter((run) => run.kind === "native"),
    compat: unorderedInputs.filter((run) => run.kind === "compat"),
  };
  const indexes = { native: 0, compat: 0 };
  const offset = createHash("sha256").update(tree).digest()[0] % 2;
  const inputs = Array.from({ length: nativeDurations.length * 2 }, (_, index) => {
    const kind = (index + offset) % 2 === 0 ? "native" : "compat";
    return byKind[kind][indexes[kind]++];
  });
  const initialNoise = nativeDurations.length === 9;
  const decision = buildBenchmarkDecision(inputs, initialNoise);
  const runs = inputs.map((run, index) => ({
    position: index + 1,
    retry: 1,
    kind: run.kind,
    durationMs: run.durationMs,
    peakRssBytes: run.samplerSummary.peakRssBytes,
    samples: 3,
    maximumGapMs: 10,
    rawOutput: `${String(index + 1).padStart(2, "0")}-${run.kind}-attempt-1.ndjson`,
    rawSha256: "b".repeat(64),
  }));
  const receipts = {
    verification: {
      sha256: "",
      value: {
        status: "passed",
        nativeCli: "7.0.2",
        compatCli: "6.0.2",
        programmaticApi: "6.0.2",
        stableApiManifest: "node_modules/typescript/package.json",
        stableApiDependencyManifest: "node_modules/typescript/node_modules/@typescript/old/package.json",
        nativeCliEntrypointSha256: "4".repeat(64),
        compatCliEntrypointSha256: "5".repeat(64),
        platformPackage: "@typescript/typescript-linux-x64",
        nativeBinShims: [{ path: "node_modules/.bin/tsc", sha256: "6".repeat(64) }],
        compatBinShims: [{ path: "node_modules/.bin/tsc6", sha256: "7".repeat(64) }],
        platformBinarySha256: "8".repeat(64),
      },
    },
    parity: {
      sha256: "",
      value: {
        status: "passed",
        diagnostics: 0,
        logicalInputs: 2307,
        logicalInputNamesSha256: "9".repeat(64),
        nonLibraryContentSha256: "a".repeat(64),
        standardLibraryContentSha256: { native: "b".repeat(64), compat: "c".repeat(64) },
      },
    },
  };
  receipts.verification.sha256 = digest(JSON.stringify(receipts.verification.value));
  receipts.parity.sha256 = digest(JSON.stringify(receipts.parity.value));
  return {
    schemaVersion: 4,
    releaseId: tree,
    candidate: {
      tree,
      repositoryTopLevelSha256: "e".repeat(64),
      headCommit: "f".repeat(40),
      headTree: tree,
      provenanceSha256: "1".repeat(64),
      platform: "linux-x64",
      installer: "npm",
      profile: "ubuntu-npm",
      node: "v24.0.0",
      arch: "x64",
      installerUserAgentSha256: "d".repeat(64),
    },
    receipts,
    contracts: {
      retryCapPerPosition: 2,
      invalidRunCapPerCompiler: 3,
      publication: "atomic-directory-rename",
      publicationMaximumBytes: TYPECHECK_BENCHMARK_MAX_PUBLICATION_BYTES,
      metadataMaximumBytes: 1024 * 1024,
      rawFileMaximumBytes: 8 * 1024 * 1024,
      rawRowMaximum: 20_000,
      requestedSamplerCadenceMs: 10,
      maximumObservedGapMs: 60,
      hostPressureMaximumPercent: 80,
      budgets: TYPECHECK_BENCHMARK_BUDGETS,
    },
    warmups: [
      { kind: "native", durationMs: 1000, rawSha256: "2".repeat(64) },
      { kind: "compat", durationMs: 1000, rawSha256: "3".repeat(64) },
    ],
    sequence: runs.map((run) => run.kind),
    initialNoise,
    invalidRuns: { native: 0, compat: 0 },
    runs,
    rawEvidence: {},
    profiles: decision.measured,
    evidenceDecision: decision.evidenceDecision,
    comparison: decision.comparison,
    acceptance: { diagnosticsEqual: true, toolchainVerified: true, ...decision.acceptance },
  };
}

function samplerEvidence(rawOutput: string) {
  const rootPid = 100;
  const rootStartIdentity = "1000";
  const peakRssBytes = 512 * 1024 * 1024;
  const rows = [0, 10, 20].map((monotonicMs) => ({
    monotonicMs,
    wallUtc: `2026-01-01T00:00:00.${String(monotonicMs).padStart(3, "0")}Z`,
    processes: [{ pid: rootPid, parentPid: 1, startIdentity: rootStartIdentity, rssBytes: peakRssBytes }],
    errors: [],
    totalPhysicalBytes: 2 * 1024 * 1024 * 1024,
    availablePhysicalBytes: 1024 * 1024 * 1024,
    rootIdentity: rootStartIdentity,
    samplerIdentity: "999",
    included: [`${rootPid}:${rootStartIdentity}`],
    includedRssBytes: peakRssBytes,
    hostPressurePercent: 50,
    observedGapMs: monotonicMs === 0 ? 0 : 10,
  }));
  return {
    contents: `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`,
    summary: {
      schemaVersion: 2,
      rootPid,
      rootStartIdentity,
      requestedIntervalMs: 10,
      maximumAllowedGapMs: 60,
      samples: 3,
      peakRssBytes,
      maximumGapMs: 10,
      terminalObserved: true,
      valid: true,
      invalidReasons: [],
      output: rawOutput,
    },
  };
}

describe("TypeScript 7 dual-toolchain and benchmark contract", () => {
  test("pins independent TS7 CLI and exact stable TS6 bridge", () => {
    expect(verify).toContain("native: '7.0.2'");
    expect(verify).toContain("compat: '6.0.2'");
    expect(verify).toContain("npm:typescript@7.0.2");
    expect(verify).toContain("npm:@typescript/typescript6@6.0.2");
    expect(verify).toContain("npm:typescript@6.0.2");
    expect(verify).toContain("TOOLCHAIN_OLD_OVERRIDE_FORBIDDEN");
    expect(verify).toContain("bin', 'tsc6'");
    expect(verify).toContain("require('typescript').version");
    expect(typecheck).toContain("createRequire");
    expect(typecheck).toContain("'--checkers', '4'");
    expect(typecheck).toContain("'--stableTypeOrdering'");
    expect(typecheck).toContain("'--noEmit', '--pretty', 'false', '--incremental', 'false'");
    expect(typecheck).not.toContain("from 'typescript'");
  });

  test("requires zero diagnostics and actual logical-input parity", () => {
    expect(typecheck).toContain("--listFilesOnly");
    expect(typecheck).toContain("Logical input parity failed");
    expect(typecheck).toContain("Logical input content-hash parity failed");
    expect(typecheck).toContain("lib:${path.posix.basename(normalized)}");
    expect(typecheck).toContain("${metadata.name}@${metadata.version}");
    expect(typecheck).toContain("conflicting content for logical input");
    expect(typecheck).toContain("logicalInputNamesSha256");
    expect(typecheck).toContain("standardLibraryContentSha256");
    expect(typecheck).toContain("Both diagnostic streams must be empty");
  });

  test("prewarms the sampler before spawning either compiler", () => {
    expect(measure).toContain("Sampler readiness timed out");
    expect(measure).toContain("message.control === 'ready' && message.schemaVersion === 1");
    expect(measure).toContain("ready = true; clearTimeout(readyTimer); startCompiler();");
    expect(measure).toContain("Sampler readiness protocol failed");
    expect(measure).toContain("Sampler summary protocol failed");
    expect(measure).toContain("terminateAndWait(child)");
    expect(measure).toContain("sampler.stdin.end");
    expect(measure).toContain("Sampler protocol was incomplete");
    expect(measure).toContain("Sampler summary was invalid");
    expect(measure).toContain("logCliError(error)");
    expect(measure).toContain("sampleOutcomeFailureCode(error)");
    expect(measure).not.toContain("safeCliErrorName(error)");
    expect(measure).not.toContain("error.message");
    expect(measure).toContain("runProcess(process.execPath, [VERIFY])");
    expect(measure).toContain("runProcess(process.execPath, [PARITY, 'parity'])");
    expect(measure).not.toContain("runProcess(VERIFY, [])");
    expect(measure).not.toContain("runProcess(PARITY, ['parity'])");
    expect(measure).not.toContain("summary?.invalidReasons?.join");
    expect(measure).toContain("samplerStderr = `${samplerStderr}${chunk}`.slice(-4096)");
    expect(sampler).toContain("await withTimeout(worker.ready, 30_000)");
    expect(sampler).toContain("Console.In.ReadLine()");
    expect(sampler).toContain("control: 'ready'");
    expect(measure).toContain("WINDOWS_COMPILER_GATE");
    expect(measure).toContain("recordedSamples < samplesAtCompilerStart + 3");
    expect(measure).toContain("TYPECHECK_SAMPLER_EVIDENCE_TIMEOUT");
    expect(measure).toContain("WINDOWS_COMPILER_EVIDENCE_TIMEOUT_MS = 120_000");
    expect(measure).toContain("did not retain root-identity evidence through compiler completion");
    expect(measure).toContain("TYPECHECK_SAMPLER_EVIDENCE_PROTOCOL");
    expect(measure).toContain("message.control === 'sample' && message.schemaVersion === 1");
    expect(sampler).toContain("RSS_SAMPLER_RECORDING_FAILED");
    expect(sampler).toContain("recordedSamples += 1");
    expect(sampler).toContain("callbacks = callbacks.then(() => onSample(message))");
    expect(sampler).toContain("await callbacks");
    expect(sampler).toContain("RSS_SAMPLER_NATIVE_BUILD_FAILED");
    expect(measure).toContain("failure-receipt.json");
    expect(measure).toContain("TYPECHECK_SAMPLER_INCOMPLETE");
    expect(measure).toContain("summaryPresent: Boolean(summary)");
    expect(measure).toContain("maximumHostPressurePercent");
    expect(measure).toContain("evidenceTimeout: evidence?.timeoutDiagnostic ?? null");
    expect(measure).toContain("samplerStdoutBytes");
    expect(measure).toContain("samplerStderrBytes");
    expect(measure).toContain("lastControlFrame");
    expect(measure).toContain("remainingBudgetMs");
    expect(measure).toContain("errorCode: typeof evidence?.errorCode");
    expect(measure).toContain("code=(RSS_SAMPLER_[A-Z_]+)");
    expect(measure).toContain("schemaVersion: 2");
    expect(measure).toContain("lastFailure: lastFailure ? {");
    expect(measure).toContain("error?.lastFailure ?? error?.cause?.lastFailure");
    expect(measure).toContain("cause: { lastFailure }");
    expect(measure).toContain("failureCode: lastFailure.failureCode");
    expect(measure).toContain("sampler: await samplerFailureReceipt(lastFailure.samplerEvidence)");
    expect(measure).toContain("mustAbortSampleRetries(lastError)");
    expect(measure).toContain("TYPECHECK_SAMPLER_EVIDENCE_TIMEOUT");
    expect(measure).toContain("throw sampleFailure(position + 1, retry + 1, kind, lastError)");
    expect(measure).toContain("SAMPLER_FAILURE_REASONS");
    expect(measure).toContain("flag: 'wx'");
    expect(measure).toContain("requestedIntervalMs !== 10");
    expect(measure).toContain("'--interval-ms', '10'");
    expect(measure).toContain("requestedSamplerCadenceMs: 10");
    expect(reportVerifier).toContain("report.contracts.requestedSamplerCadenceMs !== 10");
    expect(measure).toContain("maximumAllowedGapMs !== 60");
    expect(sampler).toContain("C:/Windows/Microsoft.NET/Framework64/v4.0.30319/csc.exe");
    expect(sampler).toContain("/target:exe");
    expect(sampler).toContain("CreateWaitableTimerEx");
    expect(sampler).toContain("CaptureJson");
    expect(sampler).toContain("GlobalMemoryStatusEx");
    expect(sampler).toContain("powershellPid>0?Descendants");
  });
  test("yields the high-priority Windows sampler when an overloaded snapshot misses its deadline", () => {
    expect(sampler).toContain("if(milliseconds<=0) { System.Threading.Thread.Sleep(1); return; }");
  });

  test("isolates caches and uses release-seeded seven plus noise-only nine samples", () => {
    expect(measure).toContain("path.join(cacheRoot, kind)");
    expect(measure).toContain("path.join(process.env.RUNNER_TEMP || tmpdir(), 'ts7-release', result.releaseId, result.profile");
    expect(measure).toContain("BUN_INSTALL_CACHE_DIR");
    expect(measure).toContain("npm_config_cache");
    expect(measure).toContain("await executeSamples(7)");
    expect(measure).toContain("executeSamples(9)");
    expect(measure).not.toContain("Persistent benchmark noise after nine samples");
    expect(measure).toContain("status: boundedNoise ? 'inconclusive_noise'");
    expect(measure).toContain("admittedSlices: aggregateBreaches.length > 0 ? 0 : 2");
    expect(measure).toContain("performanceClaimsAllowed: aggregateBreaches.length === 0 && acceptancePassed");
    expect(measure).toContain("independentNoiseWindows(runs)");
    expect(measure).toContain("independentWindows.every((window) => window.breaches.includes(breach))");
    expect(measure).toContain("measured.native.durationMs.count === 9");
    expect(measure).toContain("Array.from({ length: 3 }");
    expect(measure).toContain("seededOrder(options.releaseId");
    expect(measure).toContain("retry <= 2");
    expect(measure).toContain("invalidRuns[kind] > 3");
    expect(measure).toContain("warmup-${kind}.ndjson");
    expect(measure).toContain("cleanProvenance(options.releaseId)");
    expect(measure).toContain("headTree: tree");
    expect(measure).toContain("RUNNER_TEMP");
    expect(measure).toContain("env: { ...process.env, LC_ALL: 'C', LANG: 'C' }");
    expect(measure).not.toContain("env: profile.env, shell: false, stdio: ['pipe', 'pipe', 'pipe']");
    expect(measure).toContain("await rm(cacheRoot, { recursive: true, force: true })");
    expect(measure).toContain("Benchmark publication boundary does not match the exact allowlist");
    expect(reportVerifier).toContain("Benchmark publication boundary does not match the exact allowlist");
    expect(reportVerifier).toContain("Inconclusive noise must be bounded, non-regressing, and admit no performance slices or claims");
    expect(reportVerifier).toContain("Benchmark publication exceeds the aggregate size bound");
    expect(reportVerifier).toContain("entry.isSymbolicLink()");
    expect(reportVerifier).toContain("TYPECHECK_BENCHMARK_MAX_RAW_FILE_BYTES = 8 * 1024 * 1024");
    expect(reportVerifier).toContain("line !== JSON.stringify(row)");
  });

  test("locks exact time, RSS, noise, and nearest-rank semantics", () => {
    expect(measure).toContain("Math.ceil(quantile * sorted.length) - 1");
    expect(TYPECHECK_BENCHMARK_BUDGETS.durationMedian).toEqual({ absoluteMs: 250, relative: 0.05 });
    expect(TYPECHECK_BENCHMARK_BUDGETS.durationP75).toEqual({ absoluteMs: 250, relative: 0.10 });
    expect(TYPECHECK_BENCHMARK_BUDGETS.noise).toEqual({ durationMadRelative: 0.05, peakRssMadRelative: 0.05 });
    expect(TYPECHECK_BENCHMARK_BUDGETS.rssP95).toEqual({ absoluteBytes: 128 * 1024 * 1024, relative: 0.15 });
    expect(measure).toContain("128 * 1024 * 1024");
    expect(measure).toContain("speedupMs >= 200");
    expect(measure).toContain("speedupRatio >= 0.10");
    expect(measure).toContain("2 * pooledMad");
    expect(measure).toContain("profile.durationMs.mad > profile.durationMs.median * TYPECHECK_BENCHMARK_BUDGETS.noise.durationMadRelative");
    expect(sampler).toContain("ProcessPriorityClass.High");
    expect(sampler).toContain("ThreadPriority.Highest");
  });

  test("treats bounded aggregate noise as zero admitted slices without hiding an observed regression", () => {
    expect(repositoryGuidance).toContain("treat zero admitted slices as a valid result");
    expect(repositoryGuidance).toContain("No current G003 measured improvement is established without retained raw and scored artifacts");
    const stable = buildBenchmarkDecision(decisionRuns(Array(7).fill(1000), Array(7).fill(1000)), false);
    expect(stable.evidenceDecision).toMatchObject({ status: "conclusive", admittedSlices: 2, performanceClaimsAllowed: true });
    expect(stable.acceptance).toEqual({ durationRegression: false, rssRegression: false, passed: true });

    const noisyValues = [800, 1000, 1200, 800, 1000, 1200, 800, 1000, 1200];
    const inconclusive = buildBenchmarkDecision(decisionRuns(noisyValues, noisyValues), true);
    expect(inconclusive.evidenceDecision).toMatchObject({
      status: "inconclusive_noise",
      admittedSlices: 0,
      boundedSamplesPerCompiler: 9,
      performanceClaimsAllowed: false,
      cachePublished: false,
    });
    expect(inconclusive.evidenceDecision.independentWindows).toHaveLength(3);
    expect(inconclusive.evidenceDecision.persistentBreaches).toContain("native.durationMs");
    expect(inconclusive.comparison.positiveSpeedClaimProfileEvidence.eligible).toBe(false);
    expect(inconclusive.acceptance.passed).toBe(true);

    const driftAcrossWindows = [800, 800, 800, 1000, 1000, 1000, 1200, 1200, 1200];
    const isolatedCompatNoise = [1000, 1000, 1000, 900, 1000, 1100, 1000, 1000, 1000];
    const inconsistentNoise = buildBenchmarkDecision(
      decisionRuns(driftAcrossWindows, isolatedCompatNoise),
      true,
    );
    expect(inconsistentNoise.evidenceDecision).toMatchObject({
      status: "inconclusive_noise",
      aggregateBreaches: ["native.durationMs"],
      admittedSlices: 0,
      performanceClaimsAllowed: false,
      cachePublished: false,
    });
    expect(inconsistentNoise.evidenceDecision.independentWindows.map((window) => window.breaches)).toEqual([
      [],
      ["compat.durationMs"],
      [],
    ]);
    expect(inconsistentNoise.evidenceDecision.persistentBreaches).toEqual([]);
    expect(inconsistentNoise.acceptance.passed).toBe(true);

    const unextendedNoise = buildBenchmarkDecision(
      decisionRuns([800, 1000, 1200, 800, 1000, 1200, 1000], Array(7).fill(1000)),
      true,
    );
    expect(unextendedNoise.evidenceDecision.status).toBe("invalid_noise");
    expect(unextendedNoise.acceptance.passed).toBe(false);

    const inconsistentNoisyRegression = buildBenchmarkDecision(
      decisionRuns(driftAcrossWindows.map((value) => value + 500), isolatedCompatNoise),
      true,
    );
    expect(inconsistentNoisyRegression.evidenceDecision.status).toBe("inconclusive_noise");
    expect(inconsistentNoisyRegression.acceptance).toMatchObject({ durationRegression: true, passed: false });

    const noisyRegression = buildBenchmarkDecision(
      decisionRuns(noisyValues.map((value) => value + 500), noisyValues),
      true,
    );
    expect(noisyRegression.evidenceDecision.status).toBe("inconclusive_noise");
    expect(noisyRegression.acceptance).toMatchObject({ durationRegression: true, passed: false });
  });

  test("verifies conclusive and zero-admitted inconclusive reports while rejecting false claims", () => {
    const expected = { tree: "a".repeat(40), profile: "ubuntu-npm", platform: "linux-x64", installer: "npm" };
    const conclusive = benchmarkReport(Array(7).fill(1000), Array(7).fill(1000));
    expect(conclusive.schemaVersion).toBe(4);
    expect(Object.keys(conclusive)).toEqual(expect.arrayContaining([
      "schemaVersion", "releaseId", "candidate", "receipts", "contracts", "warmups", "sequence", "initialNoise", "invalidRuns", "runs", "rawEvidence", "profiles", "comparison", "acceptance",
    ]));
    expect(conclusive.contracts).toMatchObject({
      requestedSamplerCadenceMs: 10,
      maximumObservedGapMs: 60,
      hostPressureMaximumPercent: 80,
      retryCapPerPosition: 2,
      invalidRunCapPerCompiler: 3,
      publication: "atomic-directory-rename",
    });
    expect(validateBenchmarkReportDocument(conclusive, expected)).toEqual({ status: "conclusive", admittedSlices: 2 });
    expect(() => validateBenchmarkReportDocument({ ...conclusive, unexpected: true }, expected)).toThrow("release binding");
    expect(() => validateBenchmarkReportDocument({ ...conclusive, candidate: { ...conclusive.candidate, unexpected: true } }, expected)).toThrow("candidate binding");
    const verificationWithExtra = { ...conclusive.receipts.verification.value, unexpected: "hidden" };
    expect(() => validateBenchmarkReportDocument({
      ...conclusive,
      receipts: {
        ...conclusive.receipts,
        verification: { value: verificationWithExtra, sha256: digest(JSON.stringify(verificationWithExtra)) },
      },
    }, expected)).toThrow("compiler or parity receipts");
    const parityFailure = { ...conclusive.receipts.parity.value, diagnostics: 1 };
    expect(() => validateBenchmarkReportDocument({
      ...conclusive,
      receipts: {
        ...conclusive.receipts,
        parity: { value: parityFailure, sha256: digest(JSON.stringify(parityFailure)) },
      },
    }, expected)).toThrow("compiler or parity receipts");

    const noisyValues = [800, 1000, 1200, 800, 1000, 1200, 800, 1000, 1200];
    const inconclusive = benchmarkReport(noisyValues, noisyValues);
    expect(validateBenchmarkReportDocument(inconclusive, expected)).toEqual({ status: "inconclusive_noise", admittedSlices: 0 });
    expect(() => validateBenchmarkReportDocument({
      ...inconclusive,
      comparison: {
        ...inconclusive.comparison,
        positiveSpeedClaimProfileEvidence: { ...inconclusive.comparison.positiveSpeedClaimProfileEvidence, eligible: true },
      },
    }, expected)).toThrow("statistics or decision");

    const noisyRegression = benchmarkReport(noisyValues.map((value) => value + 500), noisyValues);
    expect(() => validateBenchmarkReportDocument(noisyRegression, expected)).toThrow("non-regressing");

    const driftAcrossWindows = [800, 800, 800, 1000, 1000, 1000, 1200, 1200, 1200];
    const isolatedCompatNoise = [1000, 1000, 1000, 900, 1000, 1100, 1000, 1000, 1000];
    const inconsistentNoise = benchmarkReport(driftAcrossWindows, isolatedCompatNoise);
    expect(validateBenchmarkReportDocument(inconsistentNoise, expected)).toEqual({ status: "inconclusive_noise", admittedSlices: 0 });
    expect(() => validateBenchmarkReportDocument(
      benchmarkReport(driftAcrossWindows.map((value) => value + 500), isolatedCompatNoise),
      expected,
    )).toThrow("non-regressing");
  });

  test("readbacks every raw hash and rejects any cache or extra publication file", async () => {
    const directory = await mkdtemp(join(tmpdir(), "tzudong-typecheck-report-"));
    try {
      await mkdir(join(directory, "raw"));
      const report = benchmarkReport(Array(7).fill(1000), Array(7).fill(1000));
      const outcomes: Array<Record<string, unknown>> = [];
      for (const kind of ["native", "compat"] as const) {
        const rawOutput = `warmup-${kind}.ndjson`;
        const evidence = samplerEvidence(rawOutput);
        await writeFile(join(directory, "raw", rawOutput), evidence.contents);
        outcomes.push({ phase: "warmup", kind, durationMs: 1000, rawOutput, rawSha256: digest(evidence.contents), summary: evidence.summary });
      }
      for (const run of report.runs) {
        const evidence = samplerEvidence(run.rawOutput);
        await writeFile(join(directory, "raw", run.rawOutput), evidence.contents);
        outcomes.push({ phase: "measured", position: run.position, retry: run.retry, kind: run.kind, accepted: true, durationMs: run.durationMs, rawOutput: run.rawOutput, rawSha256: digest(evidence.contents), summary: evidence.summary, failure: null });
      }
      for (const run of report.runs) run.rawSha256 = outcomes.find((outcome) => outcome.rawOutput === run.rawOutput)!.rawSha256;
      for (const warmup of report.warmups) warmup.rawSha256 = outcomes.find((outcome) => outcome.rawOutput === `warmup-${warmup.kind}.ndjson`)!.rawSha256;
      const preflight = `${JSON.stringify(report.receipts, null, 2)}\n`;
      const serializedOutcomes = `${JSON.stringify(outcomes, null, 2)}\n`;
      await writeFile(join(directory, "preflight-receipts.json"), preflight);
      await writeFile(join(directory, "attempt-outcomes.json"), serializedOutcomes);
      report.rawEvidence = {
        preflight: "preflight-receipts.json",
        preflightSha256: digest(preflight),
        outcomes: "attempt-outcomes.json",
        outcomesSha256: digest(serializedOutcomes),
        attempts: outcomes.map(({ rawOutput, rawSha256 }) => ({ rawOutput, rawSha256 })),
      };
      await writeFile(join(directory, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
      const options = { report: join(directory, "report.json"), tree: "a".repeat(40), profile: "ubuntu-npm", platform: "linux-x64", installer: "npm" };
      expect(await verifyPublishedBenchmarkDirectory(options)).toEqual({ status: "conclusive", admittedSlices: 2 });

      const publishOutcomes = async () => {
        const serialized = `${JSON.stringify(outcomes, null, 2)}\n`;
        report.rawEvidence.outcomesSha256 = digest(serialized);
        await writeFile(join(directory, "attempt-outcomes.json"), serialized);
        await writeFile(join(directory, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
        return serialized;
      };
      outcomes[2].unexpected = "hidden";
      await publishOutcomes();
      await expect(verifyPublishedBenchmarkDirectory(options)).rejects.toThrow("attempt manifest");
      delete outcomes[2].unexpected;

      outcomes[2].accepted = false;
      outcomes[2].failure = "free-form failure";
      await publishOutcomes();
      await expect(verifyPublishedBenchmarkDirectory(options)).rejects.toThrow("attempt manifest");
      outcomes[2].failure = "TYPECHECK_COMPILER_EVIDENCE_INVALID";
      await publishOutcomes();
      await expect(verifyPublishedBenchmarkDirectory(options)).rejects.toThrow("attempt manifest");
      outcomes[2].accepted = true;
      outcomes[2].failure = null;
      await publishOutcomes();

      outcomes[2].durationMs = (outcomes[2].durationMs as number) + 1;
      await publishOutcomes();
      await expect(verifyPublishedBenchmarkDirectory(options)).rejects.toThrow("accepted compiler outcomes");
      outcomes[2].durationMs = (outcomes[2].durationMs as number) - 1;
      await publishOutcomes();

      (outcomes[2].summary as Record<string, number>).peakRssBytes += 1;
      await publishOutcomes();
      await expect(verifyPublishedBenchmarkDirectory(options)).rejects.toThrow("accepted compiler outcomes");
      (outcomes[2].summary as Record<string, number>).peakRssBytes -= 1;
      await publishOutcomes();

      outcomes[0].durationMs = (outcomes[0].durationMs as number) + 1;
      await publishOutcomes();
      await expect(verifyPublishedBenchmarkDirectory(options)).rejects.toThrow("warm-up outcomes");
      outcomes[0].durationMs = (outcomes[0].durationMs as number) - 1;
      await publishOutcomes();

      const warmupRaw = join(directory, "raw", "warmup-native.ndjson");
      const cleanWarmup = samplerEvidence("warmup-native.ndjson").contents;
      const rawRows = cleanWarmup.trimEnd().split("\n").map((line) => JSON.parse(line));
      rawRows[0].unexpected = "hidden";
      const invalidWarmup = `${rawRows.map((row) => JSON.stringify(row)).join("\n")}\n`;
      await writeFile(warmupRaw, invalidWarmup);
      outcomes[0].rawSha256 = digest(invalidWarmup);
      report.rawEvidence.attempts[0].rawSha256 = outcomes[0].rawSha256;
      report.warmups[0].rawSha256 = outcomes[0].rawSha256;
      await publishOutcomes();
      await expect(verifyPublishedBenchmarkDirectory(options)).rejects.toThrow("raw evidence row");
      await writeFile(warmupRaw, cleanWarmup);
      outcomes[0].rawSha256 = digest(cleanWarmup);
      report.rawEvidence.attempts[0].rawSha256 = outcomes[0].rawSha256;
      report.warmups[0].rawSha256 = outcomes[0].rawSha256;
      await publishOutcomes();

      const firstRaw = join(directory, "raw", report.runs[0].rawOutput);
      const firstRawContents = samplerEvidence(report.runs[0].rawOutput).contents;
      await writeFile(firstRaw, "tampered\n");
      await expect(verifyPublishedBenchmarkDirectory(options)).rejects.toThrow("raw attempt hash");
      await writeFile(firstRaw, firstRawContents);

      await writeFile(join(directory, "attempt-outcomes.json"), `${serializedOutcomes} `);
      await expect(verifyPublishedBenchmarkDirectory(options)).rejects.toThrow("receipt hashes");
      await writeFile(join(directory, "attempt-outcomes.json"), serializedOutcomes);

      const originalRawOutput = report.rawEvidence.attempts[0].rawOutput;
      report.rawEvidence.attempts[0].rawOutput = "../escape.ndjson";
      await writeFile(join(directory, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
      await expect(verifyPublishedBenchmarkDirectory(options)).rejects.toThrow("raw attempt reference");
      report.rawEvidence.attempts[0].rawOutput = originalRawOutput;
      await writeFile(join(directory, "report.json"), `${JSON.stringify(report, null, 2)}\n`);

      await mkdir(join(directory, "cache"));
      await expect(verifyPublishedBenchmarkDirectory(options)).rejects.toThrow("exact allowlist");
      await writeFile(join(directory, "cache", "must-not-publish"), "forbidden\n");
      await expect(verifyPublishedBenchmarkDirectory(options)).rejects.toThrow("exact allowlist");
      await rm(join(directory, "cache"), { recursive: true, force: true });
      const maximumRawFileBytes = TYPECHECK_BENCHMARK_MAX_PUBLICATION_BYTES / 8;
      await truncate(join(directory, "raw", "warmup-native.ndjson"), maximumRawFileBytes + 1);
      await expect(verifyPublishedBenchmarkDirectory(options)).rejects.toThrow("file size is outside its bound");
      for (const attempt of report.rawEvidence.attempts.slice(0, 8)) {
        await truncate(join(directory, "raw", attempt.rawOutput), maximumRawFileBytes);
      }
      await expect(verifyPublishedBenchmarkDirectory(options)).rejects.toThrow("aggregate size bound");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  test("uses only approved Windows and Linux process sources", () => {
    expect(sampler).toContain("CreateToolhelp32Snapshot");
    expect(sampler).toContain("Process32First");
    expect(sampler).toContain("Process32Next");
    expect(sampler).toContain("WorkingSet64");
    expect(sampler).toContain("StartTime.ToUniversalTime().Ticks");
    expect(sampler).toContain("GlobalMemoryStatusEx");
    expect(sampler).toContain("ProcessPriorityClass.High");
    expect(sampler).toContain("ThreadPriority.Highest");
    expect(sampler).not.toContain("Win32_Process");
    expect(sampler).not.toContain("CIM_");
    expect(sampler).toContain("fields[19]");
    expect(sampler).toContain("fields[1]");
    expect(sampler).toContain("VmRSS");
    expect(sampler).toContain("MemTotal");
    expect(sampler).toContain("MemAvailable");
    expect(sampler).toContain("var parents=Parents()");
    expect(sampler).toContain("CaptureJson(rootPid,self.Id,0");
    expect(sampler).not.toContain("foreach($pid");
    expect(sampler).toContain("await readFile(`/proc/${pid}/task/${pid}/children`, 'utf8')");
    expect(sampler).not.toContain("readdir('/proc'");
    expect(sampler).not.toContain("Promise.all(pids.map(async (pid) => {");
  });

  test("persists identity evidence and invalidates bad samples", () => {
    expect(sampler).toContain("DEFAULT_INTERVAL_MS = 20");
    expect(sampler).toContain("MAX_GAP_MS = 60");
    expect(sampler).toContain("root-identity-reused");
    expect(sampler).toContain("missing-root-identity");
    expect(sampler).toContain("sampling-gap-exceeded");
    expect(sampler).toContain("hostPressurePercent > 80.000");
    expect(sampler).toContain("state.samples >= 3");
    expect(sampler).toContain("samplerIdentity");
    expect(sampler).toContain("includedRssBytes");
    expect(sampler).toContain("RSS_SAMPLER_ROOT_UNOBSERVED");
  });
  test("fails closed on provenance, malformed evidence, and immutable publication hazards", () => {
    expect(measure).toContain("/^[a-f0-9]{40}$/");
    expect(measure).toContain("Benchmark requires Node 24 x64");
    expect(measure).toContain("bun\\/1\\.2\\.16");
    expect(measure).toContain("npm\\/11\\.6\\.2");
    expect(measure).toContain("Repository provenance is not the requested clean release tree");
    expect(measure).toContain("repositoryTopLevelSha256");
    expect(measure).toContain("headCommit");
    expect(measure).toContain("headTree");
    expect(measure).toContain("path.basename(summary.output)");
    expect(measure).toContain("Publication directory must not already exist");
    expect(measure).toContain("Publication destination appeared during staging");
    expect(measure).toContain("Benchmark output resolved inside the repository");
    expect(measure).toContain("inside(await realpath(publicationParent), await realpath(REPO_ROOT))");
    expect(measure).toContain("randomUUID()");
    expect(measure).toContain("await rename(stage, publicationDirectory)");
    expect(measure).toContain("path.join(process.env.RUNNER_TEMP || tmpdir(), 'ts7-release'");
    expect(measure).toContain("rawSha256");
    expect(measure).toContain("outcomesSha256");
    expect(measure).toContain("validateRawOutput");
    expect(measure).toContain("Sampler raw evidence violates numeric, identity, gap, pressure, or collector invariants");
    expect(typecheck).toContain("Both diagnostic streams must be empty");
    expect(sampler).toContain("malformed-process-identity");
    expect(sampler).toContain("process-identity-reused");
    expect(sampler).toContain("observedGapMs < 0");
    expect(sampler).toContain("typeof row.rssBytes === 'number'");
    expect(sampler).toContain("terminalObserved: true");
  });
});
